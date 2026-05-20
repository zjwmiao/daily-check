#!/usr/bin/env node
/*
 * GEO 页面配置检查脚本 - 批量版本
 * 
 * 功能说明:
 *   批量检查多个仓库的页面配置情况，作为入口脚本调用 check-single.js
 *   支持逗号分隔的多个仓库 URL，顺序执行避免输出混乱
 * 
 * 使用方式:
 *   node check-batch.js --repo=<repo_urls> [--branch=<branch>] [--since=<time>] [--output=<file>] [--dryRun]
 * 
 * 参数说明:
 *   --repo=<urls>       必填。Git 仓库 URL，支持多个(逗号分隔):
 *                         - https://atomgit.com/owner1/repo1.git,https://atomgit.com/owner2/repo2.git
 *                         - owner1/repo1,owner2/repo2
 *   --branch=<branch>   可选。指定分支，应用于所有仓库，默认 'main'
 *   --since=<time>      可选。检查时间范围，默认 '1 day ago'
 *   --output=<file>     可选。输出结果文件路径前缀
 *                         实际输出: {prefix}-{owner}-{repo}.json 和 {prefix}-summary.json
 *   --dryRun            可选。仅检查不生成配置、不提 issue
 *   --model=<model>     可选。opencode 模型
 *   --agent=<agent>     可选。opencode agent
 *   --extraArgs=<args>  可选。opencode 额外参数
 * 
 * 输出文件:
 *   1. 每个仓库结果: {outputPrefix}-{owner}-{repo}.json (同 check-single.js 输出格式)
 *   2. 汇总文件: {outputPrefix}-summary.json，包含:
 *      - run_at: 执行时间
 *      - total_repos: 仓库总数
 *      - succeeded: 成功数
 *      - failed: 失败数
 *      - duration_seconds: 总耗时
 *      - results: 各仓库执行结果摘要
 * 
 * 环境变量:
 *   ATOMGIT_TOKEN       atomgit OAuth2 token (必需)
 *   OPENCODE_MODEL      opencode 模型
 *   OPENCODE_AGENT      opencode agent
 *   OPENCODE_EXTRA_ARGS opencode 额外参数
 * 
 * 示例:
 *   node check-batch.js --repo=https://atomgit.com/openEuler/portal.git
 *   node check-batch.js --repo=openEuler/portal,openeuler/docs
 *   node check-batch.js --repo=openEuler/portal,openeuler/docs --since="3 days ago" --output=result
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function log(prefix, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${prefix} ${msg}`);
}

function getRepoName(repoUrl) {
  const url = repoUrl.trim().replace(/\.git$/, '').replace(/^https:\/\/oauth2:[^@]+@/, 'https://');
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`;
    }
  } catch {}
  const simpleMatch = url.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (simpleMatch) {
    return `${simpleMatch[1]}-${simpleMatch[2]}`;
  }
  return url.replace(/[^a-zA-Z0-9_-]/g, '-');
}

async function runCheckSingle(repoUrl, baseArgs, index, total) {
  const scriptPath = path.join(__dirname, 'check-single.js');
  const prefix = `[${index}/${total}]`;
  
  const cmdArgs = [`--repo=${repoUrl}`];
  if (baseArgs.branch) cmdArgs.push(`--branch=${baseArgs.branch}`);
  if (baseArgs.since) cmdArgs.push(`--since=${baseArgs.since}`);
  if (baseArgs.dryRun) cmdArgs.push('--dryRun');
  if (baseArgs.model) cmdArgs.push(`--model=${baseArgs.model}`);
  if (baseArgs.agent) cmdArgs.push(`--agent=${baseArgs.agent}`);
  if (baseArgs.extraArgs) cmdArgs.push(`--extraArgs=${baseArgs.extraArgs}`);
  
  let outputFile = null;
  if (baseArgs.output) {
    const outputDir = path.dirname(baseArgs.output);
    const repoName = getRepoName(repoUrl);
    outputFile = path.join(outputDir, `${baseArgs.output}-${repoName}.json`);
    cmdArgs.push(`--output=${outputFile}`);
  }
  
  log(prefix, `仓库: ${repoUrl}`);
  log(prefix, `执行: node check-single.js ...`);
  
  const child = spawn('node', [scriptPath, ...cmdArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  
  return new Promise((resolve) => {
    child.on('close', (code) => {
      const success = code === 0;
      log(prefix, success ? '✅ 完成' : `❌ 失败 (code ${code})`);
      resolve({
        repo: repoUrl,
        repoName: getRepoName(repoUrl),
        success,
        code,
        outputFile,
      });
    });
    
    child.on('error', (err) => {
      log(prefix, `❌ 启动失败: ${err.message}`);
      resolve({
        repo: repoUrl,
        repoName: getRepoName(repoUrl),
        success: false,
        error: err.message,
        outputFile,
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (!args.repo) {
    log('', `❌ 缺少必要参数: --repo`);
    log('', `用法: node check-batch.js --repo=<repo_urls>`);
    log('', `支持多个仓库，用逗号分隔:`);
    log('', `  --repo=https://atomgit.com/owner1/repo1.git,https://atomgit.com/owner2/repo2.git`);
    log('', `  --repo=owner1/repo1,owner2/repo2`);
    log('', '');
    log('', `可选参数:`);
    log('', `  --branch=<branch>        指定分支 (默认: main)`);
    log('', `  --since=<time>           时间范围 (默认: 1 day ago)`);
    log('', `  --output=<file>          输出结果文件前缀`);
    log('', `  --dryRun                 仅检查不生成配置、不提 issue`);
    process.exit(1);
  }
  
  const repos = args.repo.split(',').map(r => r.trim()).filter(r => r);
  
  if (repos.length === 0) {
    log('', `❌ 无有效仓库 URL`);
    process.exit(1);
  }
  
  log('', `检查 ${repos.length} 个仓库: ${repos.map(r => getRepoName(r)).join(', ')}`);
  
  const startTime = Date.now();
  
  const results = [];
  for (let i = 0; i < repos.length; i++) {
    const result = await runCheckSingle(repos[i], args, i + 1, repos.length);
    results.push(result);
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  log('', '');
  log('', `=== 执行汇总 ===`);
  log('', `总仓库数: ${repos.length}`);
  log('', `成功: ${succeeded.length}`);
  log('', `失败: ${failed.length}`);
  log('', `耗时: ${duration}s`);
  
  if (failed.length > 0) {
    log('', `失败仓库:`);
    for (const f of failed) {
      log('', `  - ${f.repoName}: ${f.error || `exit code ${f.code}`}`);
    }
  }
  
  if (args.output) {
    const outputDir = path.dirname(args.output);
    const summaryPath = `${args.output}-summary.json`;
    
    const summary = {
      run_at: new Date().toISOString(),
      total_repos: repos.length,
      succeeded: succeeded.length,
      failed: failed.length,
      duration_seconds: parseFloat(duration),
      results,
    };
    
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    log('', `汇总结果: ${summaryPath}`);
  }
  
  if (failed.length > 0) {
    process.exit(1);
  }
}

main();