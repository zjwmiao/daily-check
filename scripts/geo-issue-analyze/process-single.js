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
import path from 'path';

const ANALYZE_SKIP_MARKER = '<!-- geo-analyze-skip -->';
const ANALYZE_RESULT_MARKER = '<!-- geo-analyze-result -->';

function parseAnalyzeResult(content) {
  // 兼容两种格式：
  // 1. <!-- ANALYZE_RESULT --> ```json ... ```
  // 2. ```json <!-- ANALYZE_RESULT --> ... ```
  const markerIdx = content.indexOf('<!-- ANALYZE_RESULT -->');
  if (markerIdx === -1) {
    log('⚠ 未找到 ANALYZE_RESULT 标记');
    return null;
  }
  
  // 从标记位置开始，查找最近的 ```json 和 ``` 代码块
  const afterMarker = content.slice(markerIdx);
  const jsonBlockMatch = afterMarker.match(/```json\s*\n([\s\S]*?)\n```/);
  
  // 如果标记后面没有找到，尝试往前找
  if (!jsonBlockMatch) {
    const beforeMarker = content.slice(0, markerIdx);
    const beforeMatch = beforeMarker.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!beforeMatch) {
      log('⚠ 未找到 JSON 代码块');
      return null;
    }
    try {
      return JSON.parse(beforeMatch[1]);
    } catch (err) {
      log(`⚠ 解析 JSON 失败: ${err.message}`);
      return null;
    }
  }
  
  try {
    return JSON.parse(jsonBlockMatch[1]);
  } catch (err) {
    log(`⚠ 解析 JSON 失败: ${err.message}`);
    return null;
  }
}

function buildNoProblemComment(result) {
  const urls = result.analyzed_urls || [];
  const urlList = urls.map(u => `- ${u}`).join('\n');
  
  return `## GEO 分析结果

经分析，此 issue **不涉及GEO基础配置问题**（TDK/JSON-LD/sitemap/llms.txt）。

**分析详情**:

${result.message || '所有检查项均通过'}

**涉及页面**:
${urlList || '未识别到具体页面'}

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

async function runOpencodeAnalyze(issue) {
  const { owner, repo, number, cache_file } = issue;
  
  const inputFile = path.join(process.env.CACHE_DIR || '/tmp/.cache/geo-bot/issue-analyze', 
    `input-${owner}-${repo}-${number}.txt`);
  
  const inputContent = `请使用 issue-analyze skill 分析以下 AtomGit issue:

- **owner**: ${owner}
- **repo**: ${repo}
- **issue_number**: ${number}

Issue 文件路径: ${cache_file}

分析完成后，请将结果写入: ${cache_file.replace('.md', '-result.md')}
`;
  
  fs.writeFileSync(inputFile, inputContent, 'utf-8');
  log(`输入文件: ${inputFile}`);
  
  const outputFile = cache_file.replace('.md', '-result.md');
  
  return new Promise((resolve, reject) => {
    log(`▶ 启动 opencode 分析...`);
    
    const proc = spawn('opencode', [
      'run', inputFile,
      '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
      '--agent', process.env.AI_AGENT || 'build',
      '--dangerously-skip-permissions'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', data => {
      stdout += data.toString();
      process.stdout.write(data);
    });
    
    proc.stderr.on('data', data => {
      stderr += data.toString();
      process.stderr.write(data);
    });
    
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`opencode exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr, outputFile });
      }
    });
    
    proc.on('error', err => {
      reject(err);
    });
  });
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
      analyzed_urls: result.analyzed_urls || []
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
        description: p.description
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
  
  if (!process.env.ATOMGIT_TOKEN) {
    console.error('❌ ATOMGIT_TOKEN 未设置');
    process.exit(1);
  }
  
  const issue = await readInput(args);
  log(`处理 issue: ${issue.owner}/${issue.repo} #${issue.number}`);
  
  try {
    const { outputFile } = await runOpencodeAnalyze(issue);
    
    if (!fs.existsSync(outputFile)) {
      throw new Error(`分析结果文件不存在: ${outputFile}`);
    }
    
    const content = fs.readFileSync(outputFile, 'utf-8');
    const result = parseAnalyzeResult(content);
    
    if (!result) {
      throw new Error('无法解析分析结果 JSON');
    }
    
    log(`分析结果: has_problems=${result.has_problems}`);
    
    let outcome;
    if (result.has_problems === false) {
      outcome = await handleNoProblems(issue, result);
    } else {
      outcome = await handleHasProblems(issue, result);
    }
    
    const finalResult = {
      run_at: new Date().toISOString(),
      source_issue: {
        owner: issue.owner,
        repo: issue.repo,
        number: issue.number,
        url: issue.url
      },
      analyze_result: result,
      outcome
    };
    
    console.log(JSON.stringify(finalResult, null, 2));
    log(`🏁 完成: ${outcome.status}`);
    
  } catch (err) {
    log(`❌ 处理失败: ${err.message}`);
    
    const errorResult = {
      run_at: new Date().toISOString(),
      source_issue: {
        owner: issue.owner,
        repo: issue.repo,
        number: issue.number
      },
      error: err.message,
      status: 'failed'
    };
    
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});