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
 *   6. 向 atomgit 提 issue 报告问题
 * 
 * 使用方式:
 *   node check-single.js --repo=<repo_url> [--branch=<branch>] [--since=<time>] [--output=<file>] [--dryRun]
 * 
 * 参数说明:
 *   --repo=<url>        必填。Git 仓库 URL，支持格式:
 *                         - https://atomgit.com/owner/repo.git
 *                         - owner/repo (简写格式)
 *   --branch=<branch>   可选。指定分支，默认自动检测或 'main'
 *   --since=<time>      可选。检查时间范围，默认 '1 day ago'
 *                         示例: '2 days ago', '2024-01-01'
 *   --output=<file>     可选。输出结果 JSON 文件路径
 *   --dryRun            可选。仅检查不生成配置、不提 issue
 *   --model=<model>     可选。opencode 模型，默认从环境变量读取
 *   --agent=<agent>     可选。opencode agent，默认 'build'
 *   --extraArgs=<args>  可选。opencode 额外参数
 * 
 * 输出文件:
 *   JSON 格式，包含以下字段:
 *   - run_at: 执行时间
 *   - project: owner/repo
 *   - branch: 分支名
 *   - projectDir: 本地项目目录路径
 *   - since: 时间范围
 *   - summary: { totalNewFiles, needsConfig, missingJsonld, missingTdk }
 *   - pages: 各页面检测结果数组
 *   - issue: 提交的 issue 信息 (如有)
 *   - build: 构建结果信息 (如有)
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
 *   node check-single.js --repo=openEuler/portal --dryRun --output=result.json
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { createIssue, findIssueByTitlePrefix, updateIssue } from '../lib/atomgit-api.js';
import { buildPortal } from '../lib/portal-build.js';

const CACHE_BASE_DIR = '/tmp/.cache/geo-bot/projects';

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

function prepareProjectDir(owner, repo, branch = 'main') {
  const projectDir = getProjectDir(owner, repo);
  const repoUrl = getRepoUrl(owner, repo);
  
  if (fs.existsSync(projectDir)) {
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      log(`项目目录已存在: ${projectDir}`);
      log(`执行 git pull --rebase ...`);
      
      try {
        runCmd(`git fetch origin ${branch}`, projectDir, { silent: true });
        runCmd(`git checkout ${branch}`, projectDir, { silent: true });
        runCmd(`git pull --rebase origin ${branch}`, projectDir);
        log(`✅ 项目已更新`);
      } catch (err) {
        log(`⚠ 更新失败，重新克隆: ${err.message}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.mkdirSync(projectDir, { recursive: true });
        runCmd(`git clone --depth=100 --branch ${branch} "${repoUrl}" "${projectDir}"`);
        log(`✅ 项目已重新克隆`);
      }
      return projectDir;
    } else {
      log(`目录存在但非 Git 仓库，删除并重新克隆`);
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
  
  fs.mkdirSync(projectDir, { recursive: true });
  log(`克隆项目: ${owner}/${repo} -> ${projectDir}`);
  
  try {
    runCmd(`git clone --depth=100 --branch ${branch} "${repoUrl}" "${projectDir}"`);
    log(`✅ 项目已克隆`);
  } catch (err) {
    log(`❌ 克隆失败: ${err.message}`);
    throw err;
  }
  
  return projectDir;
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

function getNewMdFiles(workDir, since) {
  const sinceArg = since ? `--since="${since}"` : '--since="1 day ago"';
  const cmd = `git log ${sinceArg} --name-only --pretty=format: --diff-filter=A -- "app/**/*.md"`;
  const output = runCmd(cmd, workDir, { silent: true });
  const files = output
    .split('\n')
    .map(f => f.trim())
    .filter(f => f.length > 0 && f.startsWith('app/') && f.endsWith('.md'));
  return [...new Set(files)];
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return parseYaml(match[1]) || {};
  } catch (err) {
    log(`解析 frontmatter 失败: ${err.message}`);
    return {};
  }
}

function hasFrontmatterConfig(frontmatter, type) {
  if (!frontmatter || typeof frontmatter !== 'object') return false;
  
  if (type === 'jsonld') {
    const head = frontmatter.head;
    if (!Array.isArray(head)) return false;
    return head.some(item => {
      if (!Array.isArray(item) || item.length < 2) return false;
      const [tag, attrs] = item;
      if (tag !== 'script') return false;
      return attrs && attrs.type === 'application/ld+json';
    });
  }
  
  if (type === 'tdk') {
    const hasTitle = !!frontmatter.title;
    const head = frontmatter.head;
    if (!Array.isArray(head)) return hasTitle;
    
    const hasDescription = head.some(item => {
      if (!Array.isArray(item) || item.length < 2) return false;
      const [tag, attrs] = item;
      if (tag !== 'meta') return false;
      return attrs && attrs.name === 'description' && attrs.content;
    });
    
    const hasKeywords = head.some(item => {
      if (!Array.isArray(item) || item.length < 2) return false;
      const [tag, attrs] = item;
      if (tag !== 'meta') return false;
      return attrs && attrs.name === 'keywords' && attrs.content;
    });
    
    return hasTitle || hasDescription || hasKeywords;
  }
  
  return false;
}

function checkConfigExists(workDir, mdPath, type) {
  const configDir = type === 'jsonld' ? '.geo/jsonld' : '.geo/tdks';
  const mdBaseName = path.basename(mdPath, '.md');
  const mdRelDir = path.dirname(mdPath).replace(/^app\/?/, '');
  const configPath = path.join(workDir, configDir, mdRelDir, mdBaseName, 'index.json');
  return fs.existsSync(configPath);
}

function mdPathToPageUrl(mdPath) {
  let url = mdPath
    .replace(/^app\//, '')
    .replace(/\.md$/, '/')
    .replace(/\/index\/$/, '/');
  if (!url.endsWith('/')) url += '/';
  return url;
}

function mdPathToBuildHtml(mdPath, buildOutputDir) {
  if (!buildOutputDir) return null;
  let relPath = mdPath
    .replace(/^app\//, '')
    .replace(/\.md$/, '');
  if (relPath === 'index' || relPath.endsWith('/index')) {
    relPath = relPath.replace(/\/index$/, '').replace(/^index$/, '');
    if (relPath === '') relPath = 'index';
    else relPath = `${relPath}/index`;
  } else {
    relPath = `${relPath}/index`;
  }
  const htmlPath = path.join(buildOutputDir, `${relPath}.html`);
  return fs.existsSync(htmlPath) ? htmlPath : null;
}

function buildIssueBody(pages, owner, repo) {
  const lines = [
    `**项目**: ${owner}/${repo}`,
    '',
    '检测到以下页面缺少 SEO/GEO 配置:',
    '',
    '| Dimension | 页面路径 | 页面 URL | 问题描述 |',
    '| --- | --- | --- | --- |',
  ];
  
  for (const page of pages) {
    const urlMd = `[${page.url}](${page.url})`;
    
    if (page.needsTdk) {
      lines.push(`| tdk | ${page.file} | ${urlMd} | 缺少 TDK (title, description, keywords) 配置 |`);
    }
    
    if (page.needsJsonld) {
      lines.push(`| schema | ${page.file} | ${urlMd} | 缺少 JSON-LD 结构化数据配置 |`);
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

async function generateConfig(workDir, mdPath, type, args, buildOutputDir) {
  const fullPath = path.join(workDir, mdPath);
  const pageUrl = mdPathToPageUrl(mdPath);
  
  const skill = type === 'jsonld' ? 'schema-markup-generator' : 'meta-tags-optimizer';
  const configDir = type === 'jsonld' ? '.geo/jsonld' : '.geo/tdks';
  const mdBaseName = path.basename(mdPath, '.md');
  const mdRelDir = path.dirname(mdPath).replace(/^app\/?/, '');
  const outputDir = path.join(workDir, configDir, mdRelDir, mdBaseName);
  const outputPath = path.join(outputDir, 'index.json');
  
  const buildHtmlPath = mdPathToBuildHtml(mdPath, buildOutputDir);
  
  log(`  生成 ${type} 配置: ${mdPath} -> ${outputPath}`);
  if (buildHtmlPath) {
    log(`  构建产物 HTML: ${buildHtmlPath}`);
  }
  
  if (args.dryRun) {
    log(`  [dry-run] 跳过实际生成`);
    return { success: true, dryRun: true };
  }
  
  const model = args.model || 'alibaba-cn/glm-5';
  const agent = args.agent || 'build';
  const extraArgs = args.extraArgs || '--dangerously-skip-permissions';
  
  let prompt;
  if (buildHtmlPath) {
    prompt = `为页面 ${buildHtmlPath} 生成${type === 'jsonld' ? 'JSON-LD结构化数据' : 'TDK meta标签'}配置。生成合适的配置保存到 ${outputPath}。使用 ${skill} skill 完成任务。`;
  } else {
    prompt = `为页面 ${mdPath} 生成${type === 'jsonld' ? 'JSON-LD结构化数据' : 'TDK meta标签'}配置。生成合适的配置保存到 ${outputPath}。请使用 ${skill} skill 完成任务。`;
  }
  
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    
    const cmd = `echo "${prompt.replace(/"/g, '\\"')}" | stdbuf -oL -eL opencode run --model "${model}" --agent "${agent}" ${extraArgs}`;
    log(`  执行: opencode run ...`);
    
    runCmd(cmd, workDir, { timeout: 300000 });
    
    return { success: true, outputPath, buildHtmlPath };
  } catch (err) {
    log(`  ❌ 生成失败: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoUrl = args.repo;
  const branch = args.branch || null;
  const since = args.since || null;
  const outputFile = args.output || null;
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

  const workDir = prepareProjectDir(owner, repo, branch);
  
  const actualBranch = branch || getDefaultBranch(workDir);
  log(`分支: ${actualBranch}`);

  const newMdFiles = getNewMdFiles(workDir, since);
  log(`发现 ${newMdFiles.length} 个新增的 md 页面文件`);

  if (newMdFiles.length === 0) {
    const output = {
      run_at: new Date().toISOString(),
      repo_url: repoUrl,
      project: `${owner}/${repo}`,
      branch: actualBranch,
      projectDir: workDir,
      since: since || '1 day ago',
      summary: {
        totalNewFiles: 0,
        needsConfig: 0,
        missingJsonld: 0,
        missingTdk: 0,
      },
      pages: [],
    };
    
    const json = JSON.stringify(output, null, 2);
    if (outputFile) {
      fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
      fs.writeFileSync(outputFile, json);
    }
    console.log(json);
    return;
  }

  const results = [];
  let missingJsonld = 0;
  let missingTdk = 0;

  for (const mdFile of newMdFiles) {
    const fullPath = path.join(workDir, mdFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    
    const hasFrontmatterJsonld = hasFrontmatterConfig(frontmatter, 'jsonld');
    const hasFrontmatterTdk = hasFrontmatterConfig(frontmatter, 'tdk');
    const hasConfigJsonld = hasFrontmatterJsonld || checkConfigExists(workDir, mdFile, 'jsonld');
    const hasConfigTdk = hasFrontmatterTdk || checkConfigExists(workDir, mdFile, 'tdk');
    
    const pageResult = {
      file: mdFile,
      url: mdPathToPageUrl(mdFile),
      frontmatter: {
        hasJsonld: hasFrontmatterJsonld,
        hasTdk: hasFrontmatterTdk,
      },
      configFile: {
        hasJsonld: checkConfigExists(workDir, mdFile, 'jsonld'),
        hasTdk: checkConfigExists(workDir, mdFile, 'tdk'),
      },
      needsJsonld: !hasConfigJsonld,
      needsTdk: !hasConfigTdk,
    };
    
    results.push(pageResult);
    
    if (!hasConfigJsonld) missingJsonld++;
    if (!hasConfigTdk) missingTdk++;
    
    log(`检查 ${mdFile}: jsonld=${hasConfigJsonld ? '✓' : '✗'}, tdk=${hasConfigTdk ? '✓' : '✗'}`);
  }

  const needsConfig = results.filter(r => r.needsJsonld || r.needsTdk);

  const output = {
    run_at: new Date().toISOString(),
    project: `${owner}/${repo}`,
    branch: actualBranch,
    projectDir: workDir,
    since: since || '1 day ago',
    summary: {
      totalNewFiles: newMdFiles.length,
      needsConfig: needsConfig.length,
      missingJsonld,
      missingTdk,
    },
    pages: results,
  };

  if (needsConfig.length > 0 && !dryRun) {
    log(`\n创建 issue 报告缺失配置...`);
    const issueResult = await createOrUpdateIssue(owner, repo, needsConfig);
    output.issue = issueResult;
  }

  const json = JSON.stringify(output, null, 2);

  if (outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, json);
    log(`✅ 结果已保存到: ${outputFile}`);
  } else {
    console.log(json);
  }

  if (needsConfig.length > 0 && !dryRun) {
    log(`\n构建项目以获取渲染产物...`);
    
    let buildOutputDir = null;
    try {
      const buildResult = await buildPortal(workDir);
      if (buildResult.ok) {
        buildOutputDir = buildResult.output_dir;
        log(`✅ 构建完成: ${buildResult.output_dir_rel} (${(buildResult.duration_ms / 1000).toFixed(1)}s)`);
        output.build = { output_dir: buildOutputDir, duration_ms: buildResult.duration_ms };
      } else if (buildResult.skipped) {
        log(`⚠ 构建跳过: ${buildResult.reason}`);
        output.build = { skipped: true, reason: buildResult.reason };
      } else {
        log(`⚠ 构建失败: ${buildResult.error}`);
        output.build = { failed: true, error: buildResult.error };
      }
    } catch (err) {
      log(`⚠ 构建异常: ${err.message}`);
      output.build = { failed: true, error: err.message };
    }
    
    log(`\n开始为 ${needsConfig.length} 个页面生成配置...`);
    
    for (const page of needsConfig) {
      log(`\n处理: ${page.file}`);
      
      if (page.needsTdk) {
        const result = await generateConfig(workDir, page.file, 'tdk', { dryRun, model, agent, extraArgs }, buildOutputDir);
        page.tdkGenerated = result;
      }
      
      if (page.needsJsonld) {
        const result = await generateConfig(workDir, page.file, 'jsonld', { dryRun, model, agent, extraArgs }, buildOutputDir);
        page.jsonldGenerated = result;
      }
    }
    
    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    }
  }

  log(`\n=== 检查完成 ===`);
  log(`项目: ${owner}/${repo}`);
  log(`新增页面: ${newMdFiles.length}`);
  log(`需要配置: ${needsConfig.length}`);
  log(`缺失 JSON-LD: ${missingJsonld}`);
  log(`缺失 TDK: ${missingTdk}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});