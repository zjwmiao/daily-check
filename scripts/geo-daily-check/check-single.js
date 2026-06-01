#!/usr/bin/env node
/*
 * GEO 页面配置检查脚本 - 单仓库版本
 * 
 * 功能说明:
 *   1. 克隆/更新指定的 VitePress 项目仓库
 *   2. 检查近期新增的 app 目录下所有 .md 页面文件
 *   3. 检测页面是否缺少 TDK 和 JSON-LD 配置
 *   4. 构建项目获取渲染产物
 *   5. 调用 opencode CLI 生成缺失的配置
 *   6. 向 atomgit 提 issue 报告问题并创建 PR
 * 
 * 使用方式:
 *   node check-single.js --repo=<repo_url> [--branch=<branch>] [--since=<time>] [--dryRun]
 * 
 * 参数说明:
 *   --repo=<url>        必填。Git 仓库 URL，支持格式:
 *                         - https://atomgit.com/owner/repo.git
 *                         - owner/repo (简写格式)
 *   --since=<time>      可选。检查时间范围，默认 '1 day ago'
 *                         示例: '2 days ago', '2024-01-01'
 *   --dryRun            可选。仅检查不生成配置、不提 issue、不创建 PR
 *   --model=<model>     可选。opencode 模型，默认从环境变量读取
 *   --agent=<agent>     可选。opencode agent，默认 'build'
 *   --extraArgs=<args>  可选。opencode 额外参数
 * 
 * 环境变量:
 *   ATOMGIT_TOKEN       atomgit OAuth2 token (必需)
 *   OPENCODE_MODEL      opencode 模型
 *   OPENCODE_AGENT      opencode agent
 *   OPENCODE_EXTRA_ARGS opencode 额外参数
 * 
 * 示例:
 *   node check-single.js --repo=https://atomgit.com/openEuler/portal.git
 *   node check-single.js --repo=openEuler/portal --branch=dev --since="3 days ago"
 *   node check-single.js --repo=openEuler/portal --dryRun
 */

import fs from 'fs';
import path, { join } from 'path';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { createIssue, findIssueByTitlePrefix, updateIssue, createPullRequest, updatePullRequest, listPullRequests } from '../lib/atomgit-api.js';
import { buildPortal } from '../lib/portal-build.js';

const CACHE_BASE_DIR = '/tmp/.cache/geo-bot/projects';

const appDirCandidates = [
  'app',
  'packages/website',
];

const buildDirCandidates = [
  '.output/public',
  'dist',
  'app/.vitepress/dist',
  'packages/website/.output/public'
];

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

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

function runCmd(cmd, cwd, options = {}) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: options.silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      timeout: options.timeout || 60000,
    })?.trim() || '';
  } catch (err) {
    if (options.silent) return '';
    throw err;
  }
}

function getProjectDir(owner, repo) {
  return path.join(CACHE_BASE_DIR, `${owner}-${repo}`);
}

function parseRepoUrl(repoUrl) {
  if (!repoUrl) return null;
  
  let url = repoUrl.trim();
  
  url = url.replace(/^https:\/\/oauth2:[^@]+@/, 'https://');
  url = url.replace(/\.git$/, '');
  
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    
    if (host !== 'atomgit.com' && host !== 'git.atomgit.com') {
      log(`⚠ 非标准 atomgit.com 域名: ${host}`);
    }
    
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      throw new Error(`无法从 URL 解析 owner/repo: ${repoUrl}`);
    }
    
    const owner = pathParts[0];
    const repo = pathParts[1];
    
    return { owner, repo, host };
  } catch (err) {
    const simpleMatch = url.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (simpleMatch) {
      return { owner: simpleMatch[1], repo: simpleMatch[2], host: 'atomgit.com' };
    }
    
    throw new Error(`无法解析仓库 URL: ${repoUrl}`);
  }
}

function getRepoUrl(owner, repo) {
  const token = process.env.ATOMGIT_TOKEN;
  if (!token) {
    throw new Error('ATOMGIT_TOKEN 环境变量未设置');
  }
  return `https://oauth2:${token}@atomgit.com/${owner}/${repo}.git`;
}

function prepareProjectDir(owner, repo) {
  const projectDir = getProjectDir(owner, repo);
  const repoUrl = getRepoUrl(owner, repo);
  
  if (fs.existsSync(projectDir)) {
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      log(`项目目录已存在: ${projectDir}`);
      log(`执行 git pull --rebase ...`);

      try {
        const res = execSync('git pull --rebase', {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'inherit']
        }).trim();
        log(`✅ 项目已更新`);
        if (res.includes('Already up to date.')) {
          return { skipBuild: true, dir: projectDir };
        }
      } catch (err) {
        log(`⚠ 更新失败，重新克隆: ${err.message}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.mkdirSync(projectDir, { recursive: true });
        runCmd(`git clone --depth=100 "${repoUrl}" "${projectDir}"`);
        log(`✅ 项目已重新克隆`);
      }
      return { skipBuild: false, dir: projectDir };
    } else {
      log(`目录存在但非 Git 仓库，删除并重新克隆`);
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
  
  fs.mkdirSync(projectDir, { recursive: true });
  log(`克隆项目: ${owner}/${repo} -> ${projectDir}`);
  
  try {
    runCmd(`git clone --depth=100 "${repoUrl}" "${projectDir}"`);
    log(`✅ 项目已克隆`);
  } catch (err) {
    log(`❌ 克隆失败: ${err.message}`);
    throw err;
  }
  
  return { skipBuild: false, dir: projectDir };
}

function getDefaultBranch(workDir) {
  try {
    const result = runCmd('git symbolic-ref refs/remotes/origin/HEAD', workDir, { silent: true });
    if (result) {
      return result.replace('refs/remotes/origin/', '');
    }
  } catch {}
  
  try {
    const result = runCmd('git rev-parse --abbrev-ref HEAD', workDir, { silent: true });
    if (result && result !== 'HEAD') {
      return result;
    }
  } catch {}
  
  return 'main';
}

function* scanFiles(path, pattern, ignore) {
  if (!fs.existsSync(path) || !fs.statSync(path).isDirectory()) {
    return;
  }

  if (!pattern) {
    return;
  }

  const ignores = Array.isArray(ignore) ? ignore : (ignore ? [ignore] : []);
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  function* itr(path) {
    outer: for (const file of fs.readdirSync(path, { withFileTypes: true })) {
      const filePath = join(path, file.name);
      for (const ig of ignores) {
        if (ig.test(filePath)) {
          continue outer;
        }
      }

      for (const p of patterns) {
        if (p.test(filePath)) {
          yield filePath;
        }
      }

      if (file.isDirectory()) {
        yield* itr(filePath);
      }
    }
  }

  yield* itr(path);
}

function checkConfigExists(workDir, mdPath, type) {
  const configDir = type === 'jsonld' ? '.geo/jsonld' : '.geo/tdks';
  let relPath = mdPath.replace(/^app\/?/, '').replace(/\.md$/, '');
  if (relPath.endsWith('/index') || relPath === 'index') {
    relPath = relPath.replace(/\/index$/, '').replace(/^index$/, '');
    if (relPath === '') relPath = 'index';
  }
  const configPath = path.join(workDir, configDir, relPath, 'index.json');
  return fs.existsSync(configPath);
}

function buildIssueBody(pages, owner, repo) {
  const lines = [
    `**项目**: ${owner}/${repo}`,
    '',
    '检测到以下页面缺少 SEO/GEO 配置:',
    '',
    '| Dimension | 页面路径 | 问题描述 |',
    '| --- | --- | --- |',
  ];
  
  for (const page of pages) {
    if (page.needsTdk) {
      lines.push(`| tdk | ${page.url} | 缺少 TDK (title, description, keywords) 配置 |`);
    }
    
    if (page.needsJsonld) {
      lines.push(`| schema | ${page.url} | 缺少 JSON-LD 结构化数据配置 |`);
    }
  }
  
  lines.push('');
  lines.push('### 建议操作');
  lines.push('');
  lines.push('1. 为每个页面生成 TDK 和 JSON-LD 配置');
  lines.push('2. 配置文件存放路径:');
  lines.push('   - TDK: `.geo/tdks/{页面路径}/index.json`');
  lines.push('   - JSON-LD: `.geo/jsonld/{页面路径}/index.json`');
  lines.push('');
  lines.push(
    `<sub>由 geo-develop 自动检测生成 · 配置完成后将自动关闭本 issue。</sub>`
  );
  
  return lines.join('\n');
}

async function createOrUpdateIssue(owner, repo, pages) {
  const titlePrefix = '[GEO配置缺失]';
  const title = `${titlePrefix} ${owner}/${repo}: ${pages.length} 个页面需要 SEO/GEO 配置`;
  const body = buildIssueBody(pages, owner, repo);
  
  const dryRun = !process.env.ATOMGIT_TOKEN;
  
  if (dryRun) {
    log(`[dry-run] would create/update issue on ${owner}/${repo}: ${title}`);
    return { dryRun: true, title };
  }
  
  try {
    log(`🔍 查找已存在的 issue: "${titlePrefix}" on ${owner}/${repo}`);
    const existing = await findIssueByTitlePrefix({
      owner,
      repo,
      prefix: titlePrefix,
    });
    
    let result, action;
    if (existing) {
      log(`♻️  找到已存在的 issue #${existing.number}, 更新内容`);
      result = await updateIssue({
        owner,
        repo,
        issue_number: existing.number,
        title,
        body,
      });
      action = 'updated';
      if (!result) result = existing;
    } else {
      log(`✨ 创建新 issue`);
      result = await createIssue({
        owner,
        repo,
        title,
        body,
      });
      action = 'created';
    }
    
    const url = result.html_url || result.url || `https://atomgit.com/${owner}/${repo}/issues/${result.number}`;
    log(`✅ issue ${action}: ${url}`);
    
    return {
      success: true,
      url,
      number: result.number,
      action,
    };
  } catch (err) {
    log(`❌ 创建/更新 issue 失败: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoUrl = args.repo;
  const since = args.since || null;
  const dryRun = args.dryRun || false;
  const model = args.model || process.env.OPENCODE_MODEL || 'alibaba-cn/glm-5';
  const agent = args.agent || process.env.OPENCODE_AGENT || 'build';
  const extraArgs = args.extraArgs || process.env.OPENCODE_EXTRA_ARGS || '--dangerously-skip-permissions';

  if (!repoUrl) {
    log(`❌ 缺少必要参数: --repo`);
    log(`用法: node check-single.js --repo=<repo_url>`);
    log(`示例: --repo=https://atomgit.com/owner/repo.git`);
    log(`或: --repo=owner/repo`);
    process.exit(1);
  }

  let owner, repo;
  try {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      throw new Error('无法解析仓库 URL');
    }
    owner = parsed.owner;
    repo = parsed.repo;
    log(`解析仓库: ${owner}/${repo} (from ${repoUrl})`);
  } catch (err) {
    log(`❌ 解析仓库 URL 失败: ${err.message}`);
    process.exit(1);
  }

  log(`项目: ${owner}/${repo}`);
  log(`时间范围: ${since || '1 day ago'}`);
  log(`模式: ${dryRun ? 'dry-run' : 'normal'}`);

  const { dir: workDir, skipBuild } = prepareProjectDir(owner, repo);

  if (!skipBuild) {
    try {
      await buildPortal(workDir);
    } catch {
      log(`${owner}/${repo} build失败`);
      return;
    }
  }

  const buildDir = buildDirCandidates.map(dir => join(workDir, dir)).find(dir => fs.existsSync(dir));
  if (!buildDir) {
    log(`${owner}/${repo} 找不到构建产物目录`);
    return;
  }

  const results = [];

  let missingJsonld = 0;
  let missingTdk = 0;


  for (const file of scanFiles(buildDir, /.html$/, [/(200|404|error)\.html$/, /baidu_verify/, /\b(blog|blogs|news|showcase|showcases)\b/])) {
    const relPath = file.slice(buildDir.length);
    const filePath = relPath.replace('.html', '').replace(/index$/, '');
    const pageResult = {
      url: filePath.endsWith('/') && filePath !== '/' ? filePath.slice(0, -1) : filePath,
      needsJsonld: false,
      needsTdk: false,
    };
    if (!fs.existsSync(join(workDir, '.geo/tdks', filePath))) {
      pageResult.needsJsonld = true;
      missingJsonld += 1;
    }
    if (!fs.existsSync(join(workDir, '.geo/jsonld', filePath))) {
      pageResult.needsTdk = true;
      missingTdk += 1;
    }
    if (pageResult.needsJsonld || pageResult.needsTdk) {
      log(`${relPath}: tdk ${pageResult.needsTdk ? '❌' : '✅'} jsonld ${pageResult.needsJsonld ? '❌' : '✅'}`);
    }
    results.push(pageResult);
  }

  const needsConfig = results.filter(r => r.needsJsonld || r.needsTdk);

  if (needsConfig.length > 0 && !dryRun) {
    log(`\n创建 issue 报告缺失配置...`);
    const issueResult = await createOrUpdateIssue(owner, repo, needsConfig);
  }

  log(`\n=== 检查完成 ===`);
  log(`项目: ${owner}/${repo}`);
  log(`需要配置: ${needsConfig.length}`);
  log(`缺失 JSON-LD: ${missingJsonld}`);
  log(`缺失 TDK: ${missingTdk}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});