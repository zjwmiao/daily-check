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
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { createIssue, findIssueByTitlePrefix, updateIssue } from '../lib/atomgit-api.js';
import { buildPortal } from '../lib/portal-build.js';

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

function* scanFiles(rootPath, pattern, ignore) {
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

// 扫一次构建产物, 归一化出页面列表。每项 { key, url }:
//   key —— 用于定位 SEO 配置 {seoDir}/{key}/index.json, 约定同源码侧:
//          foo/index.html -> 'foo'、about/index.html -> 'about'、首页 index.html -> 'index'
//   url —— 展示用路径('/'、'/about'、'/en/docs')
function enumeratePages(buildDir) {
  const pages = [];
  for (const file of scanFiles(buildDir, /\.html$/, HTML_IGNORE)) {
    const rel = file.slice(buildDir.length).replace(/\\/g, '/');
    let key = rel.replace(/^\//, '').replace(/\.html$/, '').replace(/\/index$/, '');
    if (key === '') key = 'index';
    const url = key === 'index' ? '/' : '/' + key;
    pages.push({ key, url });
  }
  return pages;
}

// 判断某页面是否存在 SEO 配置文件 {seoDir}/{key}/index.json
function hasConfig(workDir, seoDir, key) {
  return fs.existsSync(path.join(workDir, seoDir, key, 'index.json'));
}

// ============ 检查项实现 ============
// 每个检查项: async (ctx) => { findings: [{ url, message }], skipped?, todo? }
// ctx = { project, workDir, buildDir, pages, log }

async function checkTDK(ctx) {
  const seoDir = ctx.project.seo_config_dir?.tdk;
  if (!seoDir) {
    ctx.log(`⚠ ${ctx.project.name} 未配置 seo_config_dir.tdk, 跳过 TDK 检查`);
    return { findings: [], skipped: true };
  }
  const findings = [];
  for (const page of ctx.pages) {
    if (!hasConfig(ctx.workDir, seoDir, page.key)) {
      findings.push({ url: page.url, message: '缺少 TDK (title, description, keywords) 配置' });
    }
  }
  return { findings };
}

async function checkSchema(ctx) {
  const seoDir = ctx.project.seo_config_dir?.schema;
  if (!seoDir) {
    ctx.log(`⚠ ${ctx.project.name} 未配置 seo_config_dir.schema, 跳过 Schema 检查`);
    return { findings: [], skipped: true };
  }
  const findings = [];
  for (const page of ctx.pages) {
    if (!hasConfig(ctx.workDir, seoDir, page.key)) {
      findings.push({ url: page.url, message: '缺少 JSON-LD 结构化数据配置' });
    }
  }
  return { findings };
}

// TODO: 后续实现 —— 拉取 project.home 各站点的 robots.txt, 校验是否存在/是否合理(允许爬取、声明 sitemap 等)
// 可复用 lib/html-fetch.js 的 fetchHttp。
async function checkRobots(ctx) {
  ctx.log(`ℹ ${ctx.project.name} robots.txt 检查尚未实现 (占位)`);
  return { findings: [], todo: true };
}

// TODO: 后续实现 —— 拉取 project.home 的 sitemap.xml, 与构建产物页面比对收录覆盖率。
// 可复用 lib/html-fetch.js 与 lib/url-normalize.js(normalizeUrlForSitemap)。
async function checkSitemap(ctx) {
  ctx.log(`ℹ ${ctx.project.name} sitemap 覆盖检查尚未实现 (占位)`);
  return { findings: [], todo: true };
}

// 检查项注册表。needsBuild 表示该项依赖构建产物(需克隆+构建);
// dimension 用于 issue 表格的维度列与提示。
const CHECKS = {
  tdk: { needsBuild: true, dimension: 'tdk', run: checkTDK },
  schema: { needsBuild: true, dimension: 'schema', run: checkSchema },
  robots: { needsBuild: false, dimension: 'robots', run: checkRobots },
  sitemap: { needsBuild: false, dimension: 'sitemap', run: checkSitemap },
};

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
  const activeChecks = Object.entries(CHECKS).filter(([key]) => !skip.includes(key));
  if (activeChecks.length === 0) {
    log(`${name} 所有检查项均被 skip_check 跳过`);
    return { name, ok: true, findings: 0 };
  }
  const needsBuild = activeChecks.some(([, c]) => c.needsBuild);

  let workDir = null;
  let buildDir = null;
  let pages = [];

  if (needsBuild) {
    if (!repoUrl) {
      log(`❌ ${name} 缺少 repo_url, 无法克隆`);
      return { name, ok: false, error: 'missing repo_url' };
    }
    let prep;
    try {
      prep = prepareProjectDir(owner, repo, repoUrl);
    } catch (err) {
      log(`❌ ${name} 克隆/更新失败: ${err.message}`);
      return { name, ok: false, error: err.message };
    }
    workDir = prep.dir;

    const outputDirRel = project.build_dir;
    const expectedBuildDir = outputDirRel ? path.join(workDir, outputDirRel) : null;
    const canReuse = prep.skipBuild && expectedBuildDir && fs.existsSync(expectedBuildDir);

    if (canReuse) {
      log(`${name} 仓库无更新且产物已存在, 跳过构建`);
      buildDir = expectedBuildDir;
    } else {
      const res = await buildPortal(workDir, {
        buildScript: project.build_script,
        outputDirRel,
      });
      if (!res.ok) {
        log(`❌ ${name} 构建失败: ${res.error || res.reason}`);
        return { name, ok: false, error: res.error || res.reason };
      }
      buildDir = res.output_dir;
    }

    pages = enumeratePages(buildDir);
    log(`${name} 共发现 ${pages.length} 个页面`);
  }

  const ctx = { project, workDir, buildDir, pages, log };
  const allFindings = [];

  for (const [key, check] of activeChecks) {
    try {
      const { findings = [] } = await check.run(ctx);
      for (const f of findings) {
        allFindings.push({ check: check.dimension, url: f.url, message: f.message });
      }
      if (findings.length) {
        log(`${name} [${key}] 发现 ${findings.length} 处问题`);
      }
    } catch (err) {
      log(`⚠ ${name} [${key}] 检查异常: ${err.message}`);
    }
  }

  if (allFindings.length > 0 && !dryRun) {
    if (!process.env.ATOMGIT_TOKEN) {
      log(`⚠ 未设置 ATOMGIT_TOKEN, 跳过 issue 上报`);
    } else {
      log(`\n创建 issue 报告问题...`);
      await createOrUpdateIssue(project, allFindings);
    }
  }

  // 按维度统计
  const byDim = {};
  for (const f of allFindings) byDim[f.check] = (byDim[f.check] || 0) + 1;
  const dimStr = Object.entries(byDim).map(([d, n]) => `${d}:${n}`).join(' ') || '无';
  log(`=== ${name} 检查完成, 问题统计: ${dimStr} ===`);

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
