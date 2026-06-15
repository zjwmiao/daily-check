#!/usr/bin/env node

import { parseArgs, log, readInput } from '../lib/utils.js';
import { 
  listIssueComments, 
  addIssueComment,
  findIssueByTitlePrefix,
  createIssue,
  updateIssue
} from '../lib/atomgit-api.js';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { 
  matchProjectByUrl, 
  runAllChecks,
  checkUrlInSitemap,
  checkUrlInLlmsTxt,
  checkTdkSchemaExists
} from './url-checks.js';

const ANALYZE_SKIP_MARKER = '<!-- geo-analyze-skip -->';
const ANALYZE_RESULT_MARKER = '<!-- geo-analyze-result -->';
const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'issue-analyze');
const PROJECTS_CACHE_DIR = path.join(process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot'), 'projects');

function parseAnalyzeResult(content) {
  const match = content.match(/```json\s*\n<!-- ANALYZE_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) {
    log('⚠ 未找到 ANALYZE_RESULT JSON block');
    return null;
  }
  
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    log(`⚠ 解析 JSON 失败: ${err.message}`);
    return null;
  }
}

function loadProjectsConfig() {
  const configPath = path.join(process.cwd(), 'projects-config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`projects-config.yaml 不存在: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  const cfg = yaml.parse(content);
  return cfg.projects || [];
}

function extractUrlsFromIssue(body) {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const urls = body.match(urlPattern) || [];
  return [...new Set(urls)].filter(u => {
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });
}

async function prepareProjectWorkDir(project) {
  const { owner, repo, repo_url } = project;
  const projectDir = path.join(PROJECTS_CACHE_DIR, `${owner}-${repo}`);
  
  if (!repo_url) {
    log(`项目 ${project.name} 缺少 repo_url，无法 clone`);
    return null;
  }
  
  const authUrl = repo_url.replace(/^https:\/\//, `https://oauth2:${process.env.ATOMGIT_TOKEN}@`);
  
  fs.mkdirSync(PROJECTS_CACHE_DIR, { recursive: true });
  
  if (fs.existsSync(projectDir)) {
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      log(`项目目录已存在: ${projectDir}, 尝试更新`);
      try {
        execSync('git pull --rebase', { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
        log(`✅ 项目已更新`);
      } catch (err) {
        log(`⚠ git pull 失败，清理后重新克隆`);
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
      if (fs.existsSync(projectDir)) {
        return projectDir;
      }
    } else {
      log(`目录存在但非 git 仓库，删除`);
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch (err) {
        log(`⚠ 删除失败: ${err.message}`);
        return null;
      }
    }
  }
  
  log(`克隆项目: ${owner}/${repo}`);
  
  try {
    execSync(`git clone --depth=50 "${authUrl}" "${projectDir}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 120000
    });
    log(`✅ 项目已克隆`);
    return projectDir;
  } catch (err) {
    log(`❌ 克隆失败: ${err.message}`);
    return null;
  }
}

async function runProgramChecks(urls, projects) {
  const results = [];
  const warnings = [];
  
  for (const url of urls) {
    const project = matchProjectByUrl(url, projects);
    
    if (!project) {
      warnings.push({ url, message: 'URL 域名未匹配到已知项目，跳过检查' });
      continue;
    }
    
    let workDir = null;
    if (project.project_type !== 'docs' && project.repo_url) {
      workDir = await prepareProjectWorkDir(project);
    }
    
    const checkResult = await runAllChecks(url, project, workDir || '');
    results.push(checkResult);
    
    log(`程序检查 ${url}: project=${project.name}, isDocs=${checkResult.isDocs}`);
  }
  
  return { results, warnings };
}

function buildProblemsFromCheckResults(checkResults) {
  const problems = [];
  
  for (const r of checkResults) {
    const url = r.url;
    const checks = r.checks;
    
    if (checks.sitemap && !checks.sitemap.covered && !checks.sitemap.ignored) {
      problems.push({
        url,
        dimension: 'sitemap',
        description: 'sitemap.xml 中未收录该页面',
        source: 'program'
      });
    }
    
    if (checks.llmsTxt && !checks.llmsTxt.covered) {
      if (!checks.llmsTxt.llmsTxtExists && !checks.llmsTxt.llmsFullTxtExists) {
        problems.push({
          url,
          dimension: 'llms.txt',
          description: '/llms.txt 和 /llms-full.txt 均不存在',
          source: 'program'
        });
      } else {
        problems.push({
          url,
          dimension: 'llms.txt',
          description: `/llms.txt 和 /llms-full.txt 中均未列出该页面`,
          source: 'program'
        });
      }
    }
    
    if (checks.tdkSchema) {
      if (!checks.tdkSchema.tdkExists && !checks.tdkSchema.ignored) {
        problems.push({
          url,
          dimension: 'tdk',
          description: '缺少 TDK 配置文件',
          source: 'program'
        });
      }
      if (!checks.tdkSchema.schemaExists && !checks.tdkSchema.ignored) {
        problems.push({
          url,
          dimension: 'schema',
          description: '缺少 JSON-LD Schema 配置文件',
          source: 'program'
        });
      }
    }
  }
  
  return problems;
}

function needsLLMAnalysis(checkResults) {
  for (const r of checkResults) {
    if (r.isDocs) continue;
    
    const checks = r.checks;
    if (checks.tdkSchema?.tdkExists || checks.tdkSchema?.schemaExists) {
      return true;
    }
  }
  return false;
}

function buildLLMInputContent(issue, checkResults, projects) {
  const urls = checkResults.map(r => r.url);
  const urlsWithConfig = checkResults.filter(r => 
    !r.isDocs && (r.checks.tdkSchema?.tdkExists || r.checks.tdkSchema?.schemaExists)
  );
  
  const configInfo = urlsWithConfig.map(r => {
    const lines = [`URL: ${r.url}`];
    if (r.checks.tdkSchema?.tdkContent) {
      lines.push(`TDK 配置: ${JSON.stringify(r.checks.tdkSchema.tdkContent)}`);
    }
    if (r.checks.tdkSchema?.schemaContent) {
      lines.push(`Schema 配置: ${JSON.stringify(r.checks.tdkSchema.schemaContent)}`);
    }
    return lines.join('\n');
  }).join('\n\n');
  
  return `请使用 issue-analyze skill 对以下 issue 进行 **TDK/Schema 语义分析**（Phase 2）:

- **owner**: ${issue.owner}
- **repo**: ${issue.repo}
- **issue_number**: ${issue.number}

Issue 文件路径: ${issue.cache_file}

## 已完成的程序检查（Phase 1）

已通过程序检查的 URL：
${urls.map(u => `- ${u}`).join('\n')}

## 需要进行语义分析的 URL（已有 TDK/Schema 配置）

${configInfo || '无'}

## 语义分析要求

请只针对**已有 TDK/Schema 配置**的 URL 进行内容质量分析：
1. 检查 TDK/Schema 内容是否与页面实际内容一致
2. 确保不出现不存在于页面内容中的信息
3. 检查 description 是否过长/过短、keywords 是否合理

分析完成后，请将结果写入: ${issue.cache_file.replace('.md', '-result.md')}
`;
}

async function runOpencodeAnalyze(issue, checkResults, projects) {
  const inputFile = path.join(CACHE_DIR, `input-${issue.owner}-${issue.repo}-${issue.number}.txt`);
  
  const inputContent = buildLLMInputContent(issue, checkResults, projects);
  
  fs.writeFileSync(inputFile, inputContent, 'utf-8');
  log(`LLM 输入文件: ${inputFile}`);
  
  const outputFile = issue.cache_file.replace('.md', '-result.md');
  
  return new Promise((resolve, reject) => {
    log(`▶ 启动 LLM 语义分析...`);
    
    const proc = spawn('opencode', [
      'run', inputFile,
      '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
      '--agent', process.env.AI_AGENT || 'build',
      '--dangerously-skip-permissions'
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env }
    });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`opencode exited with code ${code}`));
      } else {
        resolve({ outputFile });
      }
    });
    
    proc.on('error', err => {
      reject(err);
    });
  });
}

function mergeProgramAndLLMResults(programProblems, llmResult) {
  const allProblems = [...programProblems];
  
  if (llmResult?.problems) {
    for (const p of llmResult.problems) {
      if (!['sitemap', 'llms.txt', 'tdk', 'schema'].includes(p.dimension)) {
        allProblems.push({ ...p, source: 'llm' });
      }
    }
  }
  
  return allProblems;
}

function buildNoProblemComment(result) {
  const urls = result.analyzed_urls || [];
  const urlList = urls.map(u => `- ${u}`).join('\n');
  const warnings = result.warnings || [];
  const warningList = warnings.map(w => `- ${w.url}: ${w.message}`).join('\n');
  
  return `## GEO 分析结果

经分析，此 issue **不涉及GEO基础配置问题**（TDK/JSON-LD/sitemap/llms.txt）。

**分析详情**:

${result.message || '所有检查项均通过'}

**涉及页面**:
${urlList || '未识别到具体页面'}

${warnings.length > 0 ? `**警告**:\n${warningList}` : ''}

建议关注：页面内容质量、HTML结构优化、用户体验等。

${ANALYZE_SKIP_MARKER}`;
}

function buildProblemIssueBody(result, sourceIssue) {
  const problems = result.problems || [];
  
  const problemTable = problems.map(p => 
    `| ${p.dimension} | ${p.url || '-'} | ${p.description} |`
  ).join('\n');
  
  return `## GEO 分析发现的问题

此 issue 由自动化分析流程发现，来源: [${sourceIssue.owner}/${sourceIssue.repo} #${sourceIssue.number}](${sourceIssue.url})

### 问题列表

| 维度 | 页面 | 问题描述 |
| --- | --- | --- |
${problemTable}

---

### 分析详情

共发现 **${problems.length}** 个 GEO 配置问题，请逐一排查修复。

${ANALYZE_RESULT_MARKER}`;
}

async function checkAlreadyProcessed(owner, repo, issueNumber) {
  const comments = await listIssueComments({ owner, repo, issue_number: issueNumber });
  return comments.some(c => 
    (c.body || '').includes(ANALYZE_SKIP_MARKER) ||
    (c.body || '').includes(ANALYZE_RESULT_MARKER)
  );
}

async function handleNoProblems(issue, result, dryRun = false) {
  const { owner, repo, number } = issue;
  
  if (dryRun) {
    log('DryRun: 模拟评论到原 issue');
    return {
      status: 'dry_run',
      would_do: 'add_comment',
      target: { owner, repo, issue_number: number },
      message: result.message || '不涉及GEO基础配置问题',
      analyzed_urls: result.analyzed_urls || [],
      warnings: result.warnings || []
    };
  }
  
  const alreadyProcessed = await checkAlreadyProcessed(owner, repo, number);
  if (alreadyProcessed) {
    log('跳过: 已有分析评论');
    return { status: 'skipped', reason: 'already_processed' };
  }
  
  const commentBody = buildNoProblemComment(result);
  
  log(`▶ 评论到原 issue #${number}`);
  const comment = await addIssueComment({ 
    owner, repo, 
    issue_number: number, 
    body: commentBody 
  });
  
  log(`✅ 评论已添加`);
  return { status: 'commented', comment_url: comment.html_url };
}

async function handleHasProblems(issue, result, dryRun = false) {
  const { owner, repo, number, url } = issue;
  const targetOwner = result.target_owner;
  const targetRepo = result.target_repo;
  
  if (!targetOwner || !targetRepo) {
    log('⚠ 缺少 target_owner/target_repo，跳过创建 issue');
    return { status: 'error', reason: 'missing_target_repo' };
  }
  
  const problems = result.problems || [];
  const shortDesc = problems.length > 0 
    ? problems[0].description.slice(0, 50)
    : 'GEO配置问题';
  
  const title = `[GEO-ANALYZE] ${shortDesc} (from #${number})`;
  const body = buildProblemIssueBody(result, issue);
  
  if (dryRun) {
    log('DryRun: 模拟创建 issue');
    return {
      status: 'dry_run',
      would_do: 'create_issue',
      target: { owner: targetOwner, repo: targetRepo },
      title,
      problems_count: problems.length,
      problems: problems.map(p => ({
        url: p.url,
        dimension: p.dimension,
        description: p.description,
        source: p.source
      }))
    };
  }
  
  log(`▶ 检查目标仓库 ${targetOwner}/${targetRepo} 是否已有相关 issue`);
  
  const existing = await findIssueByTitlePrefix({
    owner: targetOwner,
    repo: targetRepo,
    prefix: `[GEO-ANALYZE]`,
    state: 'open'
  });
  
  const exactMatch = existing && existing.title.includes(`(from #${number})`);
  
  if (exactMatch) {
    log(`已有 issue #${existing.number}, 更新内容`);
    await updateIssue({
      owner: targetOwner,
      repo: targetRepo,
      issue_number: existing.number,
      body
    });
    log(`✅ Issue #${existing.number} 已更新`);
    return { 
      status: 'updated', 
      issue_number: existing.number,
      issue_url: existing.html_url
    };
  } else {
    log(`▶ 创建新 issue: ${title}`);
    const newIssue = await createIssue({
      owner: targetOwner,
      repo: targetRepo,
      title,
      body
    });
    log(`✅ Issue #${newIssue.number} 已创建`);
    return { 
      status: 'created', 
      issue_number: newIssue.number,
      issue_url: newIssue.html_url
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun || process.env.DRY_RUN === 'true';
  
  if (dryRun) {
    log('=== DryRun Mode: Analysis only, no API calls ===');
  }
  
  if (!process.env.ATOMGIT_TOKEN) {
    console.error('❌ ATOMGIT_TOKEN 未设置');
    process.exit(1);
  }
  
  const issue = await readInput(args);
  log(`处理 issue: ${issue.owner}/${issue.repo} #${issue.number}`);
  
  const projects = loadProjectsConfig();
  log(`加载 ${projects.length} 个项目配置`);
  
  try {
    const urls = extractUrlsFromIssue(issue.body);
    log(`从 issue 提取 ${urls.length} 个 URL`);
    
    if (urls.length === 0) {
      log('issue 中未包含 URL，跳过分析');
      const result = {
        has_problems: false,
        source_issue_id: issue.number,
        source_issue_url: issue.url,
        analyzed_urls: [],
        message: 'issue 中未包含可识别的 URL'
      };
      
      const outcome = await handleNoProblems(issue, result, dryRun);
      console.log(JSON.stringify({ run_at: new Date().toISOString(), result, outcome }, null, 2));
      return;
    }
    
    log('\n========== Phase 1: 程序化检查 ==========');
    const { results: checkResults, warnings } = await runProgramChecks(urls, projects);
    
    const programProblems = buildProblemsFromCheckResults(checkResults);
    log(`程序检查发现 ${programProblems.length} 个问题`);
    
    let llmResult = null;
    let llmProblems = [];
    
    const needLLM = needsLLMAnalysis(checkResults);
    
    if (needLLM) {
      log('\n========== Phase 2: LLM 语义分析 ==========');
      const { outputFile } = await runOpencodeAnalyze(issue, checkResults, projects);
      
      if (fs.existsSync(outputFile)) {
        const content = fs.readFileSync(outputFile, 'utf-8');
        log('=============== LLM output ===============');
        log(content);
        
        llmResult = parseAnalyzeResult(content);
        if (llmResult?.problems) {
          llmProblems = llmResult.problems.filter(p => 
            !['sitemap', 'llms.txt', 'tdk', 'schema'].includes(p.dimension)
          );
          log(`LLM 语义分析发现 ${llmProblems.length} 个问题`);
        }
      }
    } else {
      log('\n跳过 Phase 2 (无需要语义分析的 URL)');
    }
    
    const allProblems = [...programProblems, ...llmProblems];
    
    const firstResult = checkResults[0];
    const targetProject = firstResult ? 
      projects.find(p => p.name === firstResult.project) : null;
    
    const finalResult = {
      has_problems: allProblems.length > 0,
      source_issue_id: issue.number,
      source_issue_url: issue.url,
      target_owner: targetProject?.owner || null,
      target_repo: targetProject?.repo || null,
      analyzed_urls: urls,
      warnings,
      problems: allProblems,
      message: allProblems.length === 0 ? '所有 GEO 配置检查通过' : undefined
    };
    
    log(`\n========== 分析结果 ==========`);
    log(`总问题数: ${allProblems.length} (程序: ${programProblems.length}, LLM: ${llmProblems.length})`);
    
    let outcome;
    if (finalResult.has_problems) {
      outcome = await handleHasProblems(issue, finalResult, dryRun);
    } else {
      outcome = await handleNoProblems(issue, finalResult, dryRun);
    }
    
    const output = {
      run_at: new Date().toISOString(),
      dry_run: dryRun,
      source_issue: {
        owner: issue.owner,
        repo: issue.repo,
        number: issue.number,
        url: issue.url
      },
      check_results: checkResults,
      analyze_result: finalResult,
      outcome
    };
    
    if (dryRun) {
      const dryRunDir = path.join(CACHE_DIR, 'dryrun-results');
      fs.mkdirSync(dryRunDir, { recursive: true });
      const dryRunFile = path.join(dryRunDir, `${issue.owner}-${issue.repo}-${issue.number}.json`);
      fs.writeFileSync(dryRunFile, JSON.stringify(output, null, 2), 'utf-8');
      log(`DryRun 结果保存到: ${dryRunFile}`);
    }
    
    console.log(JSON.stringify(output, null, 2));
    log(`\n🏁 完成: ${outcome.status}`);
    
  } catch (err) {
    log(`❌ 处理失败: ${err.message}`);
    
    const errorResult = {
      run_at: new Date().toISOString(),
      dry_run: dryRun,
      source_issue: {
        owner: issue.owner,
        repo: issue.repo,
        number: issue.number
      },
      error: err.message,
      status: 'failed'
    };
    
    if (dryRun) {
      const dryRunDir = path.join(CACHE_DIR, 'dryrun-results');
      fs.mkdirSync(dryRunDir, { recursive: true });
      const dryRunFile = path.join(dryRunDir, `${issue.owner}-${issue.repo}-${issue.number}-error.json`);
      fs.writeFileSync(dryRunFile, JSON.stringify(errorResult, null, 2), 'utf-8');
    }
    
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});