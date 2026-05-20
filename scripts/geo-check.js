#!/usr/bin/env node

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

async function runCheckNewFiles(repoUrl, baseArgs, index, total) {
  const scriptPath = path.join(__dirname, 'check-new-files.js');
  const prefix = `[${index}/${total}]`;
  
  const cmdArgs = [`--repo=${repoUrl}`];
  if (baseArgs.branch) cmdArgs.push(`--branch=${baseArgs.branch}`);
  if (baseArgs.since) cmdArgs.push(`--since=${baseArgs.since}`);
  if (baseArgs.dryRun) cmdArgs.push('--dryRun');
  if (baseArgs.skipGenerate) cmdArgs.push('--skipGenerate');
  if (baseArgs.model) cmdArgs.push(`--model=${baseArgs.model}`);
  if (baseArgs.agent) cmdArgs.push(`--agent=${baseArgs.agent}`);
  if (baseArgs.extraArgs) cmdArgs.push(`--extraArgs=${baseArgs.extraArgs}`);
  
  let outputFile = null;
  if (baseArgs.output) {
    const outputDir = path.dirname(baseArgs.output);
    const repoName = getRepoName(repoUrl);
    
    // 始终生成带 repo 名的结果文件
    outputFile = path.join(outputDir, `check-result-${repoName}.json`);
    cmdArgs.push(`--output=${outputFile}`);
  }
  
  log(prefix, `仓库: ${repoUrl}`);
  log(prefix, `执行: node check-new-files.js ${cmdArgs.slice(0, 3).join(' ')} ...`);
  
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
    log('', `用法: node geo-check.js --repo=<repo_url>`);
    log('', `支持多个仓库，用逗号分隔:`);
    log('', `  --repo=https://atomgit.com/owner1/repo1.git,https://atomgit.com/owner2/repo2.git`);
    log('', `  --repo=owner1/repo1,owner2/repo2`);
    log('', '');
    log('', `可选参数:`);
    log('', `  --branch=<branch>        指定分支 (默认: main)`);
    log('', `  --since=<time>           时间范围 (默认: 1 day ago)`);
    log('', `  --output=<file>          输出结果文件 (多个仓库时自动追加 repo 名)`);
    log('', `  --dryRun                 仅检查不生成`);
    log('', `  --skipGenerate           跳过配置生成`);
    process.exit(1);
  }
  
  const repos = args.repo.split(',').map(r => r.trim()).filter(r => r);
  
  if (repos.length === 0) {
    log('', `❌ 无有效仓库 URL`);
    process.exit(1);
  }
  
  log('', `检查 ${repos.length} 个仓库: ${repos.map(r => getRepoName(r)).join(', ')}`);
  
  const startTime = Date.now();
  
  // 顺序执行避免输出混乱
  const results = [];
  for (let i = 0; i < repos.length; i++) {
    const result = await runCheckNewFiles(repos[i], args, i + 1, repos.length);
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
  
  // 始终生成汇总文件
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