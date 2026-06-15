#!/usr/bin/env node
/*
 * GEO 页面配置检查脚本 - 配置驱动多项目版
 *
 * 功能说明:
 *   1. 从 daily-check-config.yaml 读取所有待检项目(仓库地址/分支/构建命令/产物目录/SEO 配置目录等)
 *   2. 逐个项目: 克隆/更新仓库 -> 按配置构建 -> 运行各检查项 -> 向对应仓库提 issue 报告问题
 *   3. 检查项以可插拔方式注册(checkTDK / checkSchema / checkRobots / checkSitemap ...)
 *
 * 使用方式:
 *   node check-single.js [--config=<path>] [--project=<name>] [--dryRun]
 *
 * 参数说明:
 *   --config=<path>   可选。配置文件路径,默认 仓库根/daily-check-config.yaml
 *   --project=<name>  可选。只跑配置里 name 匹配的单个项目(便于调试)
 *   --dryRun          可选。仅检查、打印汇总,不提 issue
 *
 * 环境变量:
 *   ATOMGIT_TOKEN       atomgit/gitcode OAuth2 token (提 issue 必需;克隆私有仓库时注入 repo_url)
 *   ATOMGIT_API_BASE    issue API 基址(见 lib/atomgit-api.js)
 *
 * 备注: gitcode.com 与 atomgit.com 为同一平台的两个域名, API/鉴权通用。
 */

import fs from 'fs';
import os from 'os';
import path, { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { createIssue, findIssueByTitlePrefix, updateIssue } from '../lib/atomgit-api.js';
import { fetchHttp } from '../lib/html-fetch.js';
import { getSitemapUrls } from '../checks/sitemap-inclusion.js';
import { url } from 'inspector';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'daily-check-config.yaml');
const CACHE_BASE_DIR = path.join(os.tmpdir(), '.cache/geo-bot/projects');

// 扫描构建产物 HTML 时忽略的文件/目录
const HTML_IGNORE = [
  /(200|404|error)\.html$/,
  /baidu_verify/,
  /\b(blog|blogs|news|showcase|showcases)\b/,
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

function detectPm(workDir) {
  if (fs.existsSync(path.join(workDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(workDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(workDir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function spawnBuild(workDir, buildScript, outputDirRel) {
  return new Promise((resolve) => {
    const pm = detectPm(workDir);
    const installCmd = pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --immutable' : 'npm ci';
    const buildCmd = buildScript || 'npm run build';
    const fullScript = `${installCmd} && ${buildCmd}`;
    
    log(`启动构建子进程: ${fullScript}`);
    const child = spawn(fullScript, [], { cwd: workDir, shell: true, stdio: 'ignore' });
    child.on('close', (code) => {
      const buildDir = outputDirRel ? path.join(workDir, outputDirRel) : null;
      if (code === 0 && buildDir && fs.existsSync(buildDir)) {
        resolve({ ok: true, buildDir });
      } else {
        resolve({ ok: false, error: code === 0 ? 'build dir not found' : `exit code ${code}` });
      }
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

function shouldIgnore(pathname, ignorePatterns) {
  if (!ignorePatterns?.length) return false;
  for (const pattern of ignorePatterns) {
    try { if (new RegExp(pattern).test(pathname)) return true; } catch {}
  }
  return false;
}

function pickRandom(arr, n) {
  if (arr.length <= n) return arr.slice();
  const shuffled = arr.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

function pathnameToKey(pathname) {
  let s = pathname.replace(/^\//, '').replace(/\/$/, '').replace(/(\/index)?\.html$/i, '');
  return s || 'index';
}

function matchGlob(pattern, pathname) {
  const re = pattern
    .replace(/\*\*/g, '(.*)')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`).test(pathname);
}

function getProjectDir(owner, repo) {
  return path.join(CACHE_BASE_DIR, `${owner}-${repo}`);
}

// 把 token 注入 https 仓库地址: https://gitcode.com/o/r.git -> https://oauth2:<token>@gitcode.com/o/r.git
// 无 token 则原样返回(公开仓库可直接克隆)
function injectToken(repoUrl, token) {
  if (!token) return repoUrl;
  const clean = repoUrl.replace(/^https:\/\/oauth2:[^@]+@/, 'https://');
  return clean.replace(/^https:\/\//, `https://oauth2:${token}@`);
}

// 克隆或更新项目仓库。返回 { dir, skipBuild }
function prepareProjectDir(owner, repo, repoUrl) {
  const projectDir = getProjectDir(owner, repo);
  const authUrl = injectToken(repoUrl, process.env.ATOMGIT_TOKEN);

  if (fs.existsSync(projectDir)) {
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      log(`项目目录已存在: ${projectDir}`);
      log(`执行 git pull --rebase ...`);
      try {
        const res = execSync('git pull --rebase', {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'inherit'],
        }).trim();
        log(`✅ 项目已更新`);
        if (res.includes('Already up to date.')) {
          return { skipBuild: true, dir: projectDir };
        }
      } catch (err) {
        log(`⚠ 更新失败，重新克隆: ${err.message}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.mkdirSync(projectDir, { recursive: true });
        runCmd(`git clone --depth=100 "${authUrl}" "${projectDir}"`);
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
    runCmd(`git clone --depth=100 "${authUrl}" "${projectDir}"`);
    log(`✅ 项目已克隆`);
  } catch (err) {
    log(`❌ 克隆失败: ${err.message}`);
    throw err;
  }

  return { skipBuild: false, dir: projectDir };
}

/**
 * 
 * @param {string} rootPath 遍历初始目录
 * @param {string|RegExp|(string|RegExp)[]} pattern 要include的文件pattern
 * @param {string|RegExp|(string|RegExp)[]} ignore 跳过pattern
 * @returns {Generator<string>} 迭代器
 */
function* iterateFiles(rootPath, pattern, ignore) {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return;
  }
  if (!pattern) {
    return;
  }

  const ignores = Array.isArray(ignore) ? ignore : (ignore ? [ignore] : []);
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  function* itr(p) {
    outer: for (const file of fs.readdirSync(p, { withFileTypes: true })) {
      const filePath = join(p, file.name);
      for (const ig of ignores) {
        if (ig.test(filePath)) {
          continue outer;
        }
      }
      for (const pat of patterns) {
        if (pat.test(filePath)) {
          yield filePath;
        }
      }
      if (file.isDirectory()) {
        yield* itr(filePath);
      }
    }
  }

  yield* itr(rootPath);
}

// 判断某页面是否存在 SEO 配置文件 {seoDir}/{key}/index.json
function hasConfig(workDir, seoDir, key) {
  return fs.existsSync(path.join(workDir, seoDir, key, 'index.json'));
}

// ============ 检查项实现（新版） ============

async function checkRobotsTxt(project, skip) {
  if (skip.includes('robots-txt')) return { findings: [], skipped: true, robotsContent: null };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true, robotsContent: null };

  const robotsUrl = new URL('/robots.txt', home).toString();
  const findings = [];
  let robotsContent = null;

  log(`${project.name} robots.txt 检查: ${robotsUrl}`);

  try {
    const { html } = await fetchHttp(robotsUrl, { timeout: 20000 });
    robotsContent = html;

    if (blocksAllCrawlers(html)) {
      findings.push({ url: robotsUrl, check: 'robots-txt', message: 'robots.txt 对 User-agent:* 全站 Disallow: /，禁止爬虫访问' });
    }

    const hasSitemap = /^\s*sitemap:\s*\S+/gim.test(html);
    if (!hasSitemap) {
      findings.push({ url: robotsUrl, check: 'robots-txt', message: 'robots.txt 未声明 Sitemap 地址' });
    }
  } catch (err) {
    findings.push({ url: robotsUrl, check: 'robots-txt', message: `robots.txt 无法访问: ${err.message}` });
  }

  return { findings, robotsContent };
}

async function checkSitemapAccessible(project, robotsContent, skip) {
  if (skip.includes('sitemap-access')) return { findings: [], skipped: true, sitemapUrls: [] };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true, sitemapUrls: [] };

  let sitemapUrls = [];
  if (robotsContent) {
    sitemapUrls = [...robotsContent.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1].trim());
  }
  if (!sitemapUrls.length) {
    sitemapUrls = [new URL('/sitemap.xml', home).toString()];
  }

  log(`${project.name} sitemap 可访问性检查: ${sitemapUrls.length} 个地址`);

  const findings = [];
  const accessibleSitemaps = [];

  for (const sm of sitemapUrls) {
    try {
      await getSitemapUrls(sm);
      accessibleSitemaps.push(sm);
    } catch (err) {
      findings.push({ url: sm, check: 'sitemap-access', message: `sitemap 无法访问或无有效内容: ${err.message}` });
    }
  }

  if (!accessibleSitemaps.length && sitemapUrls.length > 0) {
    findings.push({ url: home, check: 'sitemap-access', message: '所有 sitemap 地址均无法访问，SEO/GEO 将无法发现页面' });
  }

  let allEntries = [];
  for (const sm of accessibleSitemaps) {
    try {
      allEntries.push(...await getSitemapUrls(sm));
    } catch {}
  }

  return { findings, sitemapUrls: allEntries };
}

async function checkSitemapConfig(project, workDir, sitemapUrls, skip) {
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const findings = [];
  for (const url of sitemapUrls) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { continue; }
    if (shouldIgnore(pathname, project.ignore_routes)) continue;

    const key = pathnameToKey(pathname);

    if (!skip.includes('sitemap-tdk') && project.seo_config_dir?.tdk) {
      const tdkPath = path.join(workDir, project.seo_config_dir.tdk, key, 'index.json');
      if (!fs.existsSync(tdkPath)) {
        findings.push({ url, check: 'sitemap-tdk', message: 'sitemap条目缺少TDK配置文件' });
      }
    }

    if (!skip.includes('sitemap-schema') && project.seo_config_dir?.schema) {
      const schemaPath = path.join(workDir, project.seo_config_dir.schema, key, 'index.json');
      if (!fs.existsSync(schemaPath)) {
        findings.push({ url, check: 'sitemap-schema', message: 'sitemap条目缺少Schema配置文件' });
      }
    }
  }

  log(`${project.name} TDK/Schema 配置检查完成: 条目 ${sitemapUrls.length}, 问题 ${findings.length}`);
  return { findings };
}

async function checkUrlAccessibility(project, sitemapUrls, skip) {
  if (skip.includes('url-access')) return { findings: [], skipped: true };
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const filtered = sitemapUrls.filter(url => {
    try { return !shouldIgnore(new URL(url).pathname, project.ignore_routes); } catch { return false; }
  });

  const sampleUrls = pickRandom(filtered, 50);
  if (!sampleUrls.length) return { findings: [], skipped: true };

  log(`${project.name} URL可访问性抽样检查: ${sampleUrls.length} 个`);
  const findings = [];

  for (const url of sampleUrls) {
    try {
      await fetchHttp(url, { timeout: 20000 });
    } catch (err) {
      findings.push({ url, check: 'url-access', message: `URL无法访问: ${err.message}` });
    }
  }

  return { findings };
}

async function checkLlmsTxt(project, skip) {
  if (skip.includes('llms-txt')) return { findings: [], skipped: true };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true };

  const findings = [];
  const files = ['/llms.txt', '/llms-full.txt'];

  for (const f of files) {
    const url = new URL(f, home).toString();
    try {
      const res = await fetchHttp(url, { timeout: 15000 });
      if (!res.html?.trim()) {
        findings.push({ url, check: 'llms-txt', message: `${f} 文件为空或无内容` });
      }
    } catch (err) {
      findings.push({ url, check: 'llms-txt', message: `${f} 无法访问: ${err.message}` });
    }
  }

  return { findings };
}

async function checkBuildSitemapCoverage(project, buildDir, sitemapUrls, skip) {
  if (skip.includes('sitemap-coverage')) return { findings: [], skipped: true };
  if (!project.accessible_routes?.length) return { findings: [], skipped: true };
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const pages = iterateFiles(buildDir, /\.html$/, HTML_IGNORE)
    .map(file => {
      const rel = file.slice(buildDir.length).replace(/\\/g, '/');
      let key = rel.replace(/^\//, '').replace(/(\/index)?\.html$/, '');
      if (key === '') key = 'index';
      const url = key === 'index' ? '/' : '/' + key;
      return url;
    })
    .filter(url => !shouldIgnore(url, project.ignore_routes))
    .toArray();
  const sitemapSet = new Set(sitemapUrls.map(u => {
    try { return normalizePathname(new URL(u).pathname); } catch { return ''; }
  }).filter(Boolean));

  log(`${project.name} 构建产物sitemap覆盖检查: 页面 ${pages.length}, sitemap条目 ${sitemapSet.size}`);
  const findings = [];

  for (const page of pages) {
    // if (shouldIgnore(page.url, project.ignore_routes)) continue;

    const shouldCheck = project.accessible_routes.some(p => matchGlob(p, page.url));
    if (shouldCheck && !sitemapSet.has(normalizePathname(page.url))) {
      findings.push({ url: page.url, check: 'sitemap-coverage', message: '构建页面未被sitemap收录' });
    }
  }

  return { findings };
}

// 判断 robots.txt 是否对通配 User-agent(*) 全站封禁(Disallow: / 且未被 Allow: / 放开)。
// 按 robots 分组规则切组: 连续的 User-agent 行 + 其后的规则行为一组, 规则行后再现 User-agent 即新组。
function blocksAllCrawlers(text) {
  const groups = [];
  let cur = null;
  let lastWasRule = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      if (!cur || lastWasRule) {
        cur = { agents: [], disallowRoot: false, allowRoot: false };
        groups.push(cur);
      }
      cur.agents.push(value);
      lastWasRule = false;
    } else if (cur) {
      if (field === 'disallow' && value === '/') cur.disallowRoot = true;
      if (field === 'allow' && value === '/') cur.allowRoot = true;
      lastWasRule = true;
    }
  }

  return groups.some((g) => g.agents.includes('*') && g.disallowRoot && !g.allowRoot);
}

// 归一化 pathname 用于跨域名比对: 解码、去尾斜杠、去 .html、空串视为根
function normalizePathname(p) {
  let s = p;
  try {
    s = decodeURIComponent(p);
  } catch {
    // 保留原值
  }
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  s = s.replace(/\.html$/i, '');
  return s === '' ? '/' : s;
}

// 检查项注册表
const CHECK_DIMENSIONS = ['robots-txt', 'sitemap-access', 'sitemap-tdk', 'sitemap-schema', 'url-access', 'llms-txt', 'sitemap-coverage', 'ssr-rendering'];

/**
 * 检测页面是否为 SSR/SSG 渲染
 * @param {string} html 页面 HTML 内容
 * @param {string} framework 框架标识 'VitePress' | 'Nuxt' | undefined
 * @returns {{ isSsr: boolean, reason: string }}
 */
function detectSsr(html, framework) {
  // 1. 框架特定检测
  if (framework === 'VitePress') {
    if (/class="VPContent"/.test(html) && /class=["']vpi/.test(html)) {
      return { isSsr: true, reason: 'VitePress 预渲染检测通过' };
    }
    if (/class="VPContent"/.test(html)) {
      const vpMatch = /class="VPContent"[\s\S]*?class="vp-doc"/.test(html);
      if (vpMatch) return { isSsr: true, reason: 'VitePress 预渲染检测通过' };
    }
  }

  if (framework === 'Nuxt') {
    const hasNuxtData = /window\.__NUXT__|data-n-head/.test(html);
    const nuxtMatch = /id="__nuxt"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const hasNuxtContent = nuxtMatch && nuxtMatch[1].replace(/<[^>]+>/g, '').trim().length > 100;
    if (hasNuxtData || hasNuxtContent) {
      return { isSsr: true, reason: 'Nuxt SSR 检测通过' };
    }
  }

  // 2. 通用内容丰富度检测
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!bodyMatch) return { isSsr: false, reason: '无 body 标签' };

  const bodyContent = bodyMatch[1];
  const plainText = bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length >= 500) {
    return { isSsr: true, reason: `body 内容丰富 (${plainText.length} 字符)` };
  }

  // 3. CSR 典型特征检测
  const csrPatterns = [
    [/<div\s+id="app"\s*>\s*<\/div>/, 'Vue SPA 空挂载点'],
    [/<div\s+id="root"\s*>\s*<\/div>/, 'React SPA 空挂载点'],
    [/<div\s+id="__nuxt"\s*>\s*<\/div>/, 'Nuxt CSR 模式'],
  ];

  for (const [p, desc] of csrPatterns) {
    if (p.test(html)) {
      return { isSsr: false, reason: `检测到 CSR 特征: ${desc}` };
    }
  }

  // 4. 默认判断: 内容稀疏但无明确 CSR 标记
  return { isSsr: false, reason: `body 内容不足 (${plainText.length} 字符)` };
}

async function checkSsrRendering(project, sitemapUrls, skip) {
  if (skip.includes('ssr-rendering')) return { findings: [], skipped: true };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true };

  const framework = project.framework;
  const sampleUrls = [home];

  if (sitemapUrls?.length) {
    const extra = pickRandom(
      sitemapUrls.filter(u => {
        try { return !shouldIgnore(new URL(u).pathname, project.ignore_routes); } catch { return false; }
      }),
      10
    );
    sampleUrls.push(...extra);
  }

  log(`${project.name} SSR渲染检查: ${sampleUrls.length} 个URL`);

  const findings = [];
  for (const url of sampleUrls) {
    try {
      const { html } = await fetchHttp(url, { timeout: 20000 });
      const result = detectSsr(html, framework);
      if (!result.isSsr) {
        findings.push({ url, check: 'ssr-rendering', message: result.reason });
      }
    } catch (err) {
      findings.push({ url, check: 'ssr-rendering', message: `检测失败: ${err.message}` });
    }
  }

  return { findings };
}

// ============ issue 上报 ============

function buildIssueBody(findings, project) {
  const { owner, repo, seo_config_dir: seo = {} } = project;
  const lines = [
    `**项目**: ${owner}/${repo}`,
    '',
    '检测到以下页面/检查项存在问题:',
    '',
    '| Dimension | 页面路径 | 问题描述 |',
    '| --- | --- | --- |',
  ];

  for (const f of findings) {
    lines.push(`| ${f.check} | ${f.url} | ${f.message} |`);
  }

  lines.push('');
  lines.push('### 维度说明');
  lines.push('');
  lines.push('- **robots-txt**: robots.txt 不存在、全站封禁爬虫或未声明 Sitemap');
  lines.push('- **sitemap-access**: sitemap 无法访问或无有效内容');
  lines.push('- **sitemap-tdk**: sitemap条目缺少TDK配置文件');
  lines.push('- **sitemap-schema**: sitemap条目缺少Schema配置文件');
  lines.push('- **url-access**: URL无法访问');
  lines.push('- **llms-txt**: llms.txt/llms-full.txt缺失或为空');
  lines.push('- **sitemap-coverage**: 构建页面未被sitemap收录');
  lines.push('- **ssr-rendering**: 页面疑似客户端渲染(CSR)，不利于SEO/GEO');
  lines.push('');
  lines.push('### 建议操作');
  lines.push('');
  lines.push('1. 为缺失配置的页面补齐对应配置文件');
  lines.push('2. 配置文件存放路径:');
  if (seo.tdk) lines.push(`   - TDK: \`${seo.tdk}/{页面路径}/index.json\``);
  if (seo.schema) lines.push(`   - JSON-LD: \`${seo.schema}/{页面路径}/index.json\``);
  lines.push('');
  lines.push(`<sub>由 geo-develop 自动检测生成 · 配置完成后将自动关闭本 issue。</sub>`);

  return lines.join('\n');
}

async function createOrUpdateIssue(project, findings) {
  const { owner, repo } = project;
  const titlePrefix = '[GEO配置缺失]';
  const title = `${titlePrefix} ${owner}/${repo}: ${findings.length} 项检查未通过`;
  const body = buildIssueBody(findings, project);

  try {
    log(`🔍 查找已存在的 issue: "${titlePrefix}" on ${owner}/${repo}`);
    const existing = await findIssueByTitlePrefix({ owner, repo, prefix: titlePrefix });

    let result, action;
    if (existing) {
      log(`♻️  找到已存在的 issue #${existing.number}, 更新内容`);
      result = await updateIssue({ owner, repo, issue_number: existing.number, title, body });
      action = 'updated';
      if (!result) result = existing;
    } else {
      log(`✨ 创建新 issue`);
      result = await createIssue({ owner, repo, title, body });
      action = 'created';
    }

    const url = result.html_url || result.url || `https://atomgit.com/${owner}/${repo}/issues/${result.number}`;
    log(`✅ issue ${action}: ${url}`);
    return { success: true, url, number: result.number, action };
  } catch (err) {
    log(`❌ 创建/更新 issue 失败: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============ 单项目流程 ============

async function runProject(project, { dryRun }) {
  const { name, owner, repo, repo_url: repoUrl } = project;
  log(`\n========== 项目: ${name} (${owner}/${repo}) ==========`);

  const skip = Array.isArray(project.skip_check) ? project.skip_check : [];

  // 1. 准备项目目录
  if (!repoUrl) {
    log(`❌ ${name} 缺少 repo_url`);
    return { name, ok: false, error: 'missing repo_url' };
  }

  let workDir;
  try {
    workDir = prepareProjectDir(owner, repo, repoUrl).dir;
  } catch (err) {
    return { name, ok: false, error: err.message };
  }

  // 2. 启动构建子进程（非阻塞）
  const buildPromise = spawnBuild(workDir, `pnpm ${project.build_script}`, project.build_dir);

  // 3. 并行执行线上检查
  const onlineFindings = [];
  let sitemapUrls = [];

  // 3a. robots.txt检查
  const robotsRes = await checkRobotsTxt(project, skip);
  onlineFindings.push(...robotsRes.findings);

  // 3b. sitemap可访问性检查
  const sitemapAccessRes = await checkSitemapAccessible(project, robotsRes.robotsContent, skip);
  onlineFindings.push(...sitemapAccessRes.findings);
  sitemapUrls = sitemapAccessRes.sitemapUrls;

  // 3c. TDK/Schema配置检查
  const configRes = await checkSitemapConfig(project, workDir, sitemapUrls, skip);
  onlineFindings.push(...configRes.findings);

  // 3d. URL可访问性抽样
  if (sitemapUrls.length > 0) {
    const accessRes = await checkUrlAccessibility(project, sitemapUrls, skip);
    onlineFindings.push(...accessRes.findings);
  }

  // 3e. llms.txt检查
  const llmsRes = await checkLlmsTxt(project, skip);
  onlineFindings.push(...llmsRes.findings);

  // 3f. SSR渲染检查
  const ssrRes = await checkSsrRendering(project, sitemapUrls, skip);
  onlineFindings.push(...ssrRes.findings);

  // 4. 等待构建完成
  log(`等待构建完成...`);
  const buildResult = await buildPromise;

  const allFindings = [...onlineFindings];

  if (!buildResult.ok) {
    log(`❌ ${name} 构建失败: ${buildResult.error}`);
    // 构建失败仍报告线上检查结果
    if (allFindings.length > 0 && !dryRun && process.env.ATOMGIT_TOKEN) {
      await createOrUpdateIssue(project, allFindings);
    }
    return { name, ok: false, error: buildResult.error, findings: allFindings.length };
  }

  const buildDir = buildResult.buildDir;
  log(`✅ 构建完成: ${buildDir}`);

  // 5. 构建产物sitemap覆盖检查
  if (project.accessible_routes?.length && sitemapUrls.length > 0) {
    const coverageRes = await checkBuildSitemapCoverage(project, buildDir, sitemapUrls, skip);
    allFindings.push(...coverageRes.findings);
  }

  // 6. 汇总 + 提issue
  if (allFindings.length > 0 && !dryRun) {
    if (!process.env.ATOMGIT_TOKEN) {
      log(`⚠ 未设置 ATOMGIT_TOKEN, 跳过 issue 上报`);
    } else {
      log(`\n创建 issue 报告问题...`);
      await createOrUpdateIssue(project, allFindings);
    }
  }

  // 统计
  const byDim = {};
  for (const f of allFindings) byDim[f.check] = (byDim[f.check] || 0) + 1;
  const dimStr = Object.entries(byDim).map(([d, n]) => `${d}:${n}`).join(' ') || '无';
  log(`=== ${name} 检查完成, 问题统计: ${dimStr} ===`);
  log(JSON.stringify(allFindings, null, 2));

  return { name, ok: true, findings: allFindings.length, byDim };
}

// ============ 入口 ============

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const cfg = parseYaml(raw);
  const projects = Array.isArray(cfg?.projects) ? cfg.projects : [];
  if (projects.length === 0) {
    throw new Error(`配置文件未包含 projects: ${configPath}`);
  }
  return projects;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const projectFilter = args.project || null;
  const dryRun = args.dryRun || false;

  log(`配置文件: ${configPath}`);
  log(`模式: ${dryRun ? 'dry-run' : 'normal'}`);

  let projects;
  try {
    projects = loadConfig(configPath);
  } catch (err) {
    log(`❌ ${err.message}`);
    process.exit(1);
  }

  if (projectFilter) {
    projects = projects.filter((p) => p.name === projectFilter);
    if (projects.length === 0) {
      log(`❌ 配置里找不到 name=${projectFilter} 的项目`);
      process.exit(1);
    }
  }

  log(`待检项目: ${projects.map((p) => p.name).join(', ')}`);

  const summaries = [];
  for (const project of projects) {
    try {
      summaries.push(await runProject(project, { dryRun }));
    } catch (err) {
      log(`❌ ${project.name} 处理异常: ${err.message}`);
      summaries.push({ name: project.name, ok: false, error: err.message });
    }
  }

  log(`\n===== 总汇总 =====`);
  const failed = summaries.filter((s) => !s.ok);
  log(`项目总数: ${summaries.length}  成功: ${summaries.length - failed.length}  失败: ${failed.length}`);
  for (const s of summaries) {
    if (s.ok) {
      const dimStr = s.byDim ? Object.entries(s.byDim).map(([d, n]) => `${d}:${n}`).join(' ') : '';
      log(`  ✅ ${s.name}  问题数: ${s.findings ?? 0}  ${dimStr}`);
    } else {
      log(`  ❌ ${s.name}  ${s.error || ''}`);
    }
  }

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
