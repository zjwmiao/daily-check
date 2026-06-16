#!/usr/bin/env node

import { parseArgs, log, readInput } from '../lib/utils.js';
import { 
  listIssueComments, 
  addIssueComment,
  findIssueByTitlePrefix,
  createIssue,
  updateIssue
} from '../lib/atomgit-api.js';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { matchProjectByUrl, runAllChecks } from './url-checks.js';

const ANALYZE_SKIP_MARKER = '<!-- geo-analyze-skip -->';
const ANALYZE_RESULT_MARKER = '<!-- geo-analyze-result -->';
const ANALYZE_IGNORED_MARKER = '<!-- geo-analyze-ignored -->';
const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'issue-analyze');

function saveAndPrintGeneratedBody(issue, generatedBody, type = 'comment') {
  const bodyDir = path.join(CACHE_DIR, 'generated-bodies');
  fs.mkdirSync(bodyDir, { recursive: true });
  const bodyFile = path.join(bodyDir, `${issue.owner}-${issue.repo}-${issue.number}-${type}.md`);
  
  const bodyContent = `=== Generated ${type} for Issue #${issue.number} (${issue.owner}/${issue.repo}) ===
Source: ${issue.url}

${generatedBody}
`;
  
  fs.writeFileSync(bodyFile, bodyContent, 'utf-8');
  console.log('\n' + bodyContent);
}

function parseAnalyzeResult(content) {
  const match = content.match(/```json\s*\n<!-- ANALYZE_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
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

async function runProgramChecks(urls, projects) {
  const results = [];
  const warnings = [];
  
  for (const url of urls) {
    const project = matchProjectByUrl(url, projects);
    
    if (!project) {
      warnings.push({ url, message: 'URL 域名未匹配到已知项目，跳过检查' });
      continue;
    }
    
    const checkResult = await runAllChecks(url, project);
    results.push(checkResult);
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
      if (!checks.llmsTxt.llmsFullTxtExists) {
        problems.push({
          url,
          dimension: 'llms.txt',
          description: '/llms-full.txt 不存在',
          source: 'program'
        });
      } else {
        problems.push({
          url,
          dimension: 'llms.txt',
          description: '/llms-full.txt 中未列出该页面',
          source: 'program'
        });
      }
    }
  }
  
  return problems;
}

function isAllUrlsIgnored(checkResults) {
  return checkResults.length > 0 && 
    checkResults.every(r => r.checks.sitemap?.ignored === true);
}

function buildIgnoredComment(urls) {
  const urlList = urls.map(u => `- ${u}`).join('\n');
  
  return `## GEO 分析结果

**非GEO优化范围**，建议单独分析处理。

**涉及页面**:
${urlList}

${ANALYZE_IGNORED_MARKER}`;
}

async function handleAllUrlsIgnored(issue, urls, dryRun = false) {
  const { owner, repo, number } = issue;
  
  if (dryRun) {
    return {
      status: 'dry_run',
      would_do: 'add_comment',
      target: { owner, repo, issue_number: number },
      message: '所有 URL 被 ignore_routes 跳过，建议单独分析',
      ignored_urls: urls
    };
  }
  
  const alreadyProcessed = await checkAlreadyProcessed(owner, repo, number);
  if (alreadyProcessed) {
    return { status: 'skipped', reason: 'already_processed' };
  }
  
  const commentBody = buildIgnoredComment(urls);
  
  const comment = await addIssueComment({
    owner, repo,
    issue_number: number,
    body: commentBody
  });
  
  return { status: 'commented_ignored', comment_url: comment.html_url };
}

function buildLLMPrompt(issue, urlsToAnalyze, projects) {
  const urlList = urlsToAnalyze.map(u => `- ${u}`).join('\n');
  const firstUrl = urlsToAnalyze[0];
  const project = matchProjectByUrl(firstUrl, projects);
  const outputFile = issue.cache_file?.replace('.md', '-result.md') || 
    path.join(CACHE_DIR, 'exist-issues', `${issue.owner}-${issue.repo}-${issue.number}-result.md`);
  
  return `请分析以下 URL 的 TDK 和 JSON-LD Schema 语义质量。

## 待分析 URL

${urlList}

## 分析要求

1. **抓取页面**：访问每个 URL，获取 HTML 内容
2. **提取信息**：
   - 从 HTML 提取 <title>、<meta name="description">、<meta name="keywords">
   - 提取 <script type="application/ld+json"> 中的 JSON-LD 内容
3. **语义分析**：
   - TDK/Schema 内容是否与页面实际内容一致
   - 是否包含不存在于页面中的信息（如其他社区名称、无关关键词）
   - description 长度是否合理（建议 100-200 字符）
   - JSON-LD schema 类型是否合适

## 输出格式

分析完成后，请将结果写入文件：${outputFile}

文件内容末尾必须包含以下结构化 JSON block：

\`\`\`json
<!-- ANALYZE_RESULT -->
{
  "has_problems": true,
  "source_issue_id": ${issue.number},
  "source_issue_url": "${issue.url}",
  "target_owner": "${project?.owner || 'null'}",
  "target_repo": "${project?.repo || 'null'}",
  "analyzed_urls": ${JSON.stringify(urlsToAnalyze)},
  "problems": [
    {
      "url": "具体URL",
      "dimension": "tdk-quality",
      "description": "问题描述：例如 description 包含无关的 openEuler 社区名称",
      "source": "llm"
    }
  ],
  "message": null
}
\`\`\`

**如果无问题**，输出：

\`\`\`json
<!-- ANALYZE_RESULT -->
{
  "has_problems": false,
  "source_issue_id": ${issue.number},
  "source_issue_url": "${issue.url}",
  "target_owner": "${project?.owner || 'null'}",
  "target_repo": "${project?.repo || 'null'}",
  "analyzed_urls": ${JSON.stringify(urlsToAnalyze)},
  "problems": [],
  "message": "TDK 和 Schema 语义检查通过，内容与页面一致"
}
\`\`\`

**注意事项**：
- \`<!-- ANALYZE_RESULT -->\` 标记必须放在 \`\`\`json 代码块内第一行
- \`dimension\` 只能是 \`tdk-quality\` 或 \`schema-quality\`
- 如果 URL 涉及的域名不属于已知项目，target_owner/target_repo 设为 null
- description 字段要具体说明问题，便于后续修复
`;
}

async function runOpencodeAnalyze(issue, urlsToAnalyze, projects) {
  const inputFile = path.join(CACHE_DIR, `input-${issue.owner}-${issue.repo}-${issue.number}.txt`);
  const prompt = buildLLMPrompt(issue, urlsToAnalyze, projects);
  
  fs.writeFileSync(inputFile, prompt, 'utf-8');
  
  const outputFile = issue.cache_file?.replace('.md', '-result.md') || 
    path.join(CACHE_DIR, 'exist-issues', `${issue.owner}-${issue.repo}-${issue.number}-result.md`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn('opencode', [
      'run', inputFile,
      '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
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

function buildNoProblemComment(result) {
  const urls = result.analyzed_urls || [];
  const urlList = urls.map(u => `- ${u}`).join('\n');
  const warnings = result.warnings || [];
  const warningList = warnings.length > 0 ? warnings.map(w => `- ${w.url}: ${w.message}`).join('\n') : '';
  
  return `## GEO 分析结果

经分析，此 issue **不涉及GEO基础配置问题**（sitemap/llms.txt/TDK/Schema）。

**分析详情**:

${result.message || '所有检查项均通过'}

**涉及页面**:
${urlList || '未识别到具体页面'}

${warningList ? `**警告**:\n${warningList}` : ''}

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
    (c.body || '').includes(ANALYZE_RESULT_MARKER) ||
    (c.body || '').includes(ANALYZE_IGNORED_MARKER)
  );
}

async function handleNoProblems(issue, result, dryRun = false) {
  const { owner, repo, number } = issue;
  
  if (dryRun) {
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
    return { status: 'skipped', reason: 'already_processed' };
  }
  
  const commentBody = buildNoProblemComment(result);
  
  const comment = await addIssueComment({ 
    owner, repo, 
    issue_number: number, 
    body: commentBody 
  });
  
  return { status: 'commented', comment_url: comment.html_url };
}

async function handleHasProblems(issue, result, dryRun = false) {
  const { owner, repo, number, url } = issue;
  const targetOwner = result.target_owner;
  const targetRepo = result.target_repo;
  
  if (!targetOwner || !targetRepo) {
    return { status: 'error', reason: 'missing_target_repo' };
  }
  
  const problems = result.problems || [];
  const shortDesc = problems.length > 0 
    ? problems[0].description.slice(0, 50)
    : 'GEO配置问题';
  
  const title = `[GEO-ANALYZE] ${shortDesc} (from #${number})`;
  const body = buildProblemIssueBody(result, issue);
  
  if (dryRun) {
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
  
  const existing = await findIssueByTitlePrefix({
    owner: targetOwner,
    repo: targetRepo,
    prefix: `[GEO-ANALYZE]`,
    state: 'open'
  });
  
  const exactMatch = existing && existing.title.includes(`(from #${number})`);
  
  if (exactMatch) {
    await updateIssue({
      owner: targetOwner,
      repo: targetRepo,
      issue_number: existing.number,
      body
    });
    return { 
      status: 'updated', 
      issue_number: existing.number,
      issue_url: existing.html_url
    };
  } else {
    const newIssue = await createIssue({
      owner: targetOwner,
      repo: targetRepo,
      title,
      body
    });
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
  
  const projects = loadProjectsConfig();
  
  try {
    const urls = extractUrlsFromIssue(issue.body);
    
    if (urls.length === 0) {
      const result = {
        has_problems: false,
        source_issue_id: issue.number,
        source_issue_url: issue.url,
        analyzed_urls: [],
        message: 'issue 中未包含可识别的 URL'
      };
      
      const outcome = await handleNoProblems(issue, result, dryRun);
      const commentBody = buildNoProblemComment(result);
      saveAndPrintGeneratedBody(issue, commentBody, 'comment');
      console.log(JSON.stringify({
        issue: `${issue.owner}/${issue.repo} #${issue.number}`,
        status: outcome.status,
        message: result.message
      }, null, 2));
      return;
    }
    
    const { results: checkResults, warnings } = await runProgramChecks(urls, projects);
    
    if (isAllUrlsIgnored(checkResults)) {
      const outcome = await handleAllUrlsIgnored(issue, urls, dryRun);
      const ignoredBody = buildIgnoredComment(urls);
      saveAndPrintGeneratedBody(issue, ignoredBody, 'comment');
      console.log(JSON.stringify({
        issue: `${issue.owner}/${issue.repo} #${issue.number}`,
        status: outcome.status,
        message: '所有 URL 被 ignore_routes 跳过，建议单独分析'
      }, null, 2));
      return;
    }
    
    const programProblems = buildProblemsFromCheckResults(checkResults);
    
    let llmProblems = [];
    let llmResult = null;
    
    const urlsToAnalyze = checkResults.filter(r => !r.isDocs).map(r => r.url);
    
    if (urlsToAnalyze.length > 0) {
      const { outputFile } = await runOpencodeAnalyze(issue, urlsToAnalyze, projects);
      
      if (fs.existsSync(outputFile)) {
        const content = fs.readFileSync(outputFile, 'utf-8');
        llmResult = parseAnalyzeResult(content);
        if (llmResult?.problems) {
          llmProblems = llmResult.problems;
        }
      }
    }
    
    const allProblems = [...programProblems, ...llmProblems];
    
    const firstCheck = checkResults.find(r => !r.isDocs) || checkResults[0];
    const targetProject = firstCheck ? matchProjectByUrl(firstCheck.url, projects) : null;
    
    const finalResult = {
      has_problems: allProblems.length > 0,
      source_issue_id: issue.number,
      source_issue_url: issue.url,
      target_owner: llmResult?.target_owner || targetProject?.owner || null,
      target_repo: llmResult?.target_repo || targetProject?.repo || null,
      analyzed_urls: urls,
      warnings,
      problems: allProblems,
      message: allProblems.length === 0 ? '所有 GEO 配置检查通过' : undefined
    };
    
    let outcome;
    if (finalResult.has_problems) {
      outcome = await handleHasProblems(issue, finalResult, dryRun);
    } else {
      outcome = await handleNoProblems(issue, finalResult, dryRun);
    }
    
    if (dryRun) {
      const dryRunDir = path.join(CACHE_DIR, 'dryrun-results');
      fs.mkdirSync(dryRunDir, { recursive: true });
      const dryRunFile = path.join(dryRunDir, `${issue.owner}-${issue.repo}-${issue.number}.json`);
      const output = {
        run_at: new Date().toISOString(),
        dry_run: dryRun,
        source_issue: { owner: issue.owner, repo: issue.repo, number: issue.number, url: issue.url },
        check_results: checkResults,
        analyze_result: finalResult,
        outcome
      };
      fs.writeFileSync(dryRunFile, JSON.stringify(output, null, 2), 'utf-8');
    }
    
    let generatedBody, bodyType;
    if (finalResult.has_problems) {
      generatedBody = buildProblemIssueBody(finalResult, issue);
      bodyType = 'issue';
    } else {
      generatedBody = buildNoProblemComment(finalResult);
      bodyType = 'comment';
    }
    saveAndPrintGeneratedBody(issue, generatedBody, bodyType);
    console.log(JSON.stringify({
      issue: `${issue.owner}/${issue.repo} #${issue.number}`,
      status: outcome.status,
      problems: allProblems.length,
      urls: urls.length,
      message: finalResult.message
    }, null, 2));
    
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
    
    const errorBody = `## 处理失败

**Issue**: ${issue.owner}/${issue.repo} #${issue.number}
**URL**: ${issue.url}
**错误**: ${err.message}

处理过程中发生错误，请检查日志或手动分析。
`;
    saveAndPrintGeneratedBody(issue, errorBody, 'error');
    console.log(JSON.stringify({
      issue: `${issue.owner}/${issue.repo} #${issue.number}`,
      status: 'failed',
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});