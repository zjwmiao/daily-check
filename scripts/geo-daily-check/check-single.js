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
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { createIssue, findIssueByTitlePrefix, updateIssue } from '../lib/atomgit-api.js';
import { log, CHECK_DIMENSIONS } from './utils.js';
import { checkRobotsTxt } from './checks/robots.js';
import { checkSitemapAccessible, checkSitemapConfig } from './checks/sitemap.js';
import { checkUrlAccessibility } from './checks/url-access.js';
import { checkLlmsTxt } from './checks/llms-txt.js';
import { checkBuildSitemapCoverage } from './checks/coverage.js';
import { checkSsrRendering } from './checks/ssr.js';
import { checkRenderChange } from './checks/render-change.js';
import { checkTdkSchemaSemantic } from './checks/tdk-schema-semantic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'projects-config.yaml');
const CACHE_BASE_DIR = path.join(os.tmpdir(), '.cache/geo-bot/projects');

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

function getProjectDir(owner, repo) {
  return path.join(CACHE_BASE_DIR, `${owner}-${repo}`);
}

function injectToken(repoUrl, token) {
  if (!token) return repoUrl;
  const clean = repoUrl.replace(/^https:\/\/oauth2:[^@]+@/, 'https://');
  return clean.replace(/^https:\/\//, `https://oauth2:${token}@`);
}

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
        const hasNewCommits = !res.includes('Already up to date.');
        const buildDir = authUrl.includes('openEuler-portal') 
          ? path.join(projectDir, 'app/.vitepress/dist')
          : null;
        const skipBuild = !hasNewCommits && buildDir && fs.existsSync(buildDir);
        return { skipBuild, dir: projectDir, hasNewCommits };
      } catch (err) {
        log(`⚠ 更新失败，重新克隆: ${err.message}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.mkdirSync(projectDir, { recursive: true });
        runCmd(`git clone --depth=100 "${authUrl}" "${projectDir}"`);
        log(`✅ 项目已重新克隆`);
        return { skipBuild: false, dir: projectDir, hasNewCommits: true };
      }
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

  return { skipBuild: false, dir: projectDir, hasNewCommits: true };
}

function hasConfig(workDir, seoDir, key) {
  return fs.existsSync(path.join(workDir, seoDir, key, 'index.json'));
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
  lines.push('- **tdk-schema-semantic**: TDK/Schema 语义不一致，内容与页面实际内容不符');
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
  const titlePrefix = '[GEO Daily Check]';
  const title = `${titlePrefix} ${owner}/${repo}: ${findings.length} 项检查未通过`;
  const body = buildIssueBody(findings, project);

  log(`================== issue body (${project.name}) ==================`);
  log(body + '\n\n');

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
  const { name, owner, repo, repo_url: repoUrl, project_type } = project;
  log(`\n========== 项目: ${name} (${owner}/${repo}) [${project_type || 'portal'}] ==========`);

  const skip = Array.isArray(project.skip_check) ? project.skip_check : [];
  const isDocsProject = project_type === 'docs' || project_type === 'docs-website';

  // skip_check 包含 'all' 则跳过整个项目
  if (skip.includes('all')) {
    log(`⏭️ ${name} 配置了 skip_check: ['all']，跳过所有检查`);
    return { name, ok: true, findings: 0, skipped: true };
  }

  // 1. 准备项目目录
  if (!repoUrl) {
    log(`❌ ${name} 缺少 repo_url`);
    return { name, ok: false, error: 'missing repo_url' };
  }

  let workDir, hasNewCommits;
  try {
    const prepared = prepareProjectDir(owner, repo, repoUrl);
    workDir = prepared.dir;
    hasNewCommits = prepared.hasNewCommits;
  } catch (err) {
    return { name, ok: false, error: err.message };
  }

  // 2. 启动构建子进程（非阻塞） - docs 类型跳过构建
  let buildPromise = null;
  if (!isDocsProject) {
    buildPromise = spawnBuild(workDir, `pnpm ${project.build_script}`, project.build_dir);
  }

  // 3. 并行执行线上检查
  const onlineFindings = [];
  let sitemapUrls = [];

  // 3a. robots.txt检查
  const robotsRes = await checkRobotsTxt(project, { skip });
  onlineFindings.push(...robotsRes.findings);

  // 3b. sitemap可访问性检查（只检查 URL 本身）
  const sitemapAccessRes = await checkSitemapAccessible(project, robotsRes.robotsContent, { skip });
  onlineFindings.push(...sitemapAccessRes.findings);

  // 3c. TDK/Schema配置检查（内部获取所有条目）
  const configRes = await checkSitemapConfig(project, workDir, sitemapAccessRes.sitemapIndexUrls, { skip });
  onlineFindings.push(...configRes.findings);
  sitemapUrls = configRes.sitemapUrls;

  // 3d. URL可访问性抽样
  if (sitemapUrls.length > 0) {
    const accessRes = await checkUrlAccessibility(project, sitemapUrls, { skip });
    onlineFindings.push(...accessRes.findings);
  }

  // 3e. llms.txt检查
  const llmsRes = await checkLlmsTxt(project, { skip });
  onlineFindings.push(...llmsRes.findings);

  // 3f. SSR渲染检查
  const ssrRes = await checkSsrRendering(project, sitemapUrls, { skip });
  onlineFindings.push(...ssrRes.findings);

  // docs 类型项目：跳过构建，直接汇总线上检查结果
  if (isDocsProject) {
    log(`📖 docs 项目，跳过构建和构建产物检查`);
    const allFindings = [...onlineFindings];

    // 统计
    const byDim = {};
    for (const f of allFindings) byDim[f.check] = (byDim[f.check] || 0) + 1;
    const dimStr = Object.entries(byDim).map(([d, n]) => `${d}:${n}`).join(' ') || '无';
    log(`=== ${name} 检查完成, 问题统计: ${dimStr} ===`);
    log(JSON.stringify(allFindings.slice(0, 20), null, 2));

    // 提 issue
    if (allFindings.length > 0 && !dryRun && process.env.ATOMGIT_TOKEN) {
      await createOrUpdateIssue(project, allFindings);
    }

    return { name, ok: true, findings: allFindings.length, byDim };
  }

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
    const coverageRes = await checkBuildSitemapCoverage(project, buildDir, sitemapUrls, { skip });
    allFindings.push(...coverageRes.findings);
  }

  // 6. render-change 分析 + TDK/Schema 语义检查
  if (hasNewCommits && project.enable_render_change_analysis) {
    log(`${name} 检测到代码变更，运行 render-change 分析...`);
    const renderChangeRes = await checkRenderChange(project, workDir, { skip });
    const affectedPages = renderChangeRes.affectedPages;
    
    if (affectedPages.length > 0) {
      log(`render-change 分析完成: ${affectedPages.length} 个受影响页面`);
      const semanticRes = await checkTdkSchemaSemantic(project, buildDir, affectedPages, { skip });
      allFindings.push(...semanticRes.findings);
    } else {
      log(`render-change 分析完成: 无受影响页面`);
    }
  }

  // 7. 汇总 + 提issue
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
  log(JSON.stringify(allFindings.slice(0, 20), null, 2));

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