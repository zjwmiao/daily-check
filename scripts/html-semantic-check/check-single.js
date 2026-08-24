#!/usr/bin/env node
/*
 * HTML 语义化检查脚本 - 配置驱动多项目版
 *
 * 功能说明:
 *   1. 从 projects-config.yaml 读取待检项目
 *   2. 逐个项目: 克隆/更新仓库 -> 构建 -> 收集构建产物 HTML -> 运行可插拔检查项 -> 提 issue
 *   3. 检查项以可插拔方式自动发现 (checks/ 目录下每个 .js 文件即一个检查项)
 *
 * 使用方式:
 *   node check-single.js [--config=<path>] [--project=<name>] [--dryRun]
 *
 * 参数说明:
 *   --config=<path>   可选。配置文件路径, 默认 仓库根/projects-config.yaml
 *   --project=<name>  可选。只跑配置里 name 匹配的单个项目
 *   --dryRun          可选。仅检查、打印汇总, 不提 issue
 *
 * 环境变量:
 *   ATOMGIT_TOKEN     atomgit/gitcode OAuth2 token (提 issue 必需; 克隆私有仓库时注入 repo_url)
 */

import fs from 'fs';
import { globSync } from 'node:fs';
import os from 'os';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { parse as parseYaml } from 'yaml';
import {
  createIssue,
  findAllIssuesByTitlePrefix,
  updateIssue,
  addIssueComment,
} from '../lib/atomgit-api.js';
import {
  log,
  DIMENSION_DESCRIPTIONS,
  shouldIgnore,
  matchGlob,
  HTML_IGNORE,
} from './utils.js';
import { loadChecks, runAllChecks } from './registry.js';
import { needBuild } from '../lib/build-skip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'projects-config.yaml');
const CACHE_BASE_DIR = path.join(os.tmpdir(), '.cache/geo-bot/projects');

const ISSUE_TITLE_PREFIX = '[GEO HTML Semantic]';
const MAX_ISSUE_FINDINGS = 300;

// ============ 参数 / 配置 ============

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
  projects.forEach((p) => {
    if (p.ignore_routes) {
      p.ignore_routes = p.ignore_routes.map((r) => new RegExp(r));
    }
  });
  return projects;
}

// ============ clone / build ============

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
    const installCmd =
      pm === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : pm === 'yarn'
          ? 'yarn install --immutable'
          : 'npm ci';
    const buildCmd = buildScript || 'npm run build';
    const fullScript = `${installCmd} && ${buildCmd}`;

    log(`启动构建子进程: ${fullScript}`);
    const child = spawn(fullScript, [], {
      cwd: workDir,
      shell: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('close', (code) => {
      const buildDir = outputDirRel ? path.join(workDir, outputDirRel) : null;
      if (code === 0 && buildDir && fs.existsSync(buildDir)) {
        resolve({ ok: true, buildDir });
      } else {
        resolve({
          ok: false,
          error: code === 0 ? 'build dir not found' : `exit code ${code}`,
        });
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
        return { dir: projectDir, hasNewCommits };
      } catch (err) {
        log(`⚠ 更新失败，重新克隆: ${err.message}`);
        fs.rmSync(projectDir, { recursive: true, force: true });
        fs.mkdirSync(projectDir, { recursive: true });
        runCmd(`git clone --depth=100 "${authUrl}" "${projectDir}"`);
        log(`✅ 项目已重新克隆`);
        return { dir: projectDir, hasNewCommits: true };
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

  return { dir: projectDir, hasNewCommits: true };
}

// ============ HTML 文件收集 ============

function collectHtmlPages(buildDir, project) {
  const files = [...globSync('**/*.html', { cwd: buildDir })]
    .filter((rel) => !HTML_IGNORE.some((re) => re.test(rel)));

  const pages = files
    .map((rel) => {
      const filePath = path.join(buildDir, rel);
      const normalized = rel.replace(/\\/g, '/');
      let key = normalized.replace(/^\//, '').replace(/(\/index)?\.html$/, '');
      if (key === '') key = 'index';
      const url = key === 'index' ? '/' : '/' + key;
      return { url, filePath };
    })
    .filter((page) => !shouldIgnore(page.url, project.ignore_routes));

  if (project.accessible_routes?.length) {
    return pages.filter((page) =>
      project.accessible_routes.some((p) => matchGlob(p, page.url))
    );
  }

  return pages;
}

// ============ issue 上报 ============

function buildIssueTitle(owner, repo, count) {
  return `${ISSUE_TITLE_PREFIX} ${owner}/${repo}: ${count}项HTML语义问题`;
}

function buildIssueBody(findings, project) {
  const { owner, repo } = project;
  const rawFindings = findings.filter((f) => f.raw);
  const structuredFindings = findings.filter((f) => !f.raw);

  const lines = [
    `**项目**: ${owner}/${repo}`,
    '',
  ];

  // 结构化问题 → 表格
  if (structuredFindings.length > 0) {
    lines.push('检测到以下页面存在 HTML 语义化问题:', '');
    lines.push('| 维度 | 页面路径 | 问题描述 |', '| --- | --- | --- |');
    for (const f of structuredFindings) {
      lines.push(`| ${f.check} | ${f.url} | ${f.message} |`);
    }
    lines.push('');

    lines.push('### 维度说明', '');
    const dims = [...new Set(structuredFindings.map((f) => f.check))];
    for (const dim of dims) {
      const desc = DIMENSION_DESCRIPTIONS[dim];
      if (desc) {
        lines.push(`- **${dim}**: ${desc}`);
      }
    }
    lines.push('');
  }

  // AI agent 输出 → 直接贴
  for (const f of rawFindings) {
    lines.push(f.message);
    lines.push('');
  }

  // 建议操作（仅当有结构化问题时）
  if (structuredFindings.length > 0) {
    lines.push('### 建议操作', '');
    lines.push('1. 参考上述维度说明修复对应的 HTML 语义化问题');
    lines.push('2. 语义化 HTML 有助于 SEO/GEO 爬虫理解页面结构，同时提升无障碍体验');
    lines.push('');
  }

  lines.push(`<sub>由 geo-develop HTML 语义化检查自动生成 · 修复后将自动关闭本 issue。</sub>`);

  return lines.join('\n');
}

async function createOrUpdateIssue(project, findings, { dryRun = true } = {}) {
  const { owner, repo } = project;

  if (dryRun) {
    log(`[dryRun] 将提交 ${findings.length} 个问题`);
    const title = buildIssueTitle(owner, repo, findings.length);
    const body = buildIssueBody(findings, project);
    log(`================== issue body (${project.name}) ==================`);
    log(`标题: ${title}`);
    log(body + '\n\n');
    return { success: true, url: '', action: 'dryRun' };
  }

  if (!process.env.ATOMGIT_TOKEN) {
    log(`⚠ 未设置 ATOMGIT_TOKEN, 跳过 issue 上报`);
    return { success: false, action: 'skipped' };
  }

  const totalBatches = Math.ceil(findings.length / MAX_ISSUE_FINDINGS);
  const existingIssues = await findAllIssuesByTitlePrefix({
    owner,
    repo,
    prefix: ISSUE_TITLE_PREFIX,
    state: 'open',
  });

  const results = [];
  const usedIssueNumbers = new Set();

  for (let i = 0; i < findings.length; i += MAX_ISSUE_FINDINGS) {
    const batchIndex = Math.floor(i / MAX_ISSUE_FINDINGS) + 1;
    const batch = findings.slice(i, i + MAX_ISSUE_FINDINGS);

    let title = buildIssueTitle(owner, repo, batch.length);
    if (totalBatches > 1) {
      title = `${title} (${batchIndex}/${totalBatches})`;
    }
    const body = buildIssueBody(batch, project);

    log(`================== issue body (${project.name}) 批次${batchIndex}/${totalBatches} ==================`);
    log(`标题: ${title}`);
    log(body + '\n\n');

    const idx = batchIndex - 1;
    let result;
    let action;

    if (idx < existingIssues.length) {
      const existing = existingIssues[idx];
      usedIssueNumbers.add(existing.number);
      log(`♻️  更新已存在的 issue #${existing.number}`);
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
      result = await createIssue({ owner, repo, title, body });
      action = 'created';
    }

    const url =
      result.html_url ||
      result.url ||
      `https://atomgit.com/${owner}/${repo}/issues/${result.number}`;
    log(`✅ issue ${action}: ${url}`);
    results.push({ success: true, url, number: result.number, action });
  }

  for (const ex of existingIssues) {
    if (!usedIssueNumbers.has(ex.number)) {
      log(`🔒 关闭多余 issue #${ex.number} (评论 /close)`);
      try {
        await addIssueComment({
          owner,
          repo,
          issue_number: ex.number,
          body: '/close',
        });
      } catch (err) {
        log(`⚠️ 评论关闭 issue #${ex.number} 失败: ${err.message}`);
      }
    }
  }

  return {
    success: true,
    url: results.map((r) => r.url).join('\n'),
    action: 'done',
  };
}

// ============ 单项目流程 ============

async function runProject(project, checks, { dryRun }) {
  const { name, owner, repo, repo_url: repoUrl, project_type } = project;
  log(`\n========== 项目: ${name} (${owner}/${repo}) [${project_type || 'portal'}] ==========`);

  const skip = Array.isArray(project.skip_check) ? project.skip_check : [];
  const isDocsProject = project_type === 'docs' || project_type === 'docs-website';

  if (skip.includes('all')) {
    log(`⏭️ ${name} 配置了 skip_check: ['all']，跳过所有检查`);
    return { name, ok: true, findings: 0, skipped: true };
  }

  if (isDocsProject) {
    log(`📖 docs 类型项目，跳过 HTML 语义检查`);
    return { name, ok: true, findings: 0, skipped: true };
  }

  if (!repoUrl) {
    log(`❌ ${name} 缺少 repo_url`);
    return { name, ok: false, error: 'missing repo_url' };
  }

  let workDir;
  try {
    const prepared = prepareProjectDir(owner, repo, repoUrl);
    workDir = prepared.dir;
  } catch (err) {
    return { name, ok: false, error: err.message };
  }

  // const expectedBuildDir = project.build_dir
  //   ? path.join(workDir, project.build_dir)
  //   : null;

  // let buildDir;

  // if (needBuild(workDir, expectedBuildDir)) {
  //   log(`等待构建完成...`);
  //   const buildResult = await spawnBuild(workDir, project.build_cmd, project.build_dir);

  //   if (!buildResult.ok) {
  //     log(`⚠️ ${name} 构建失败: ${buildResult.error}，跳过 HTML 语义检查`);
  //     return { name, ok: false, error: `build failed: ${buildResult.error}` };
  //   }

  //   buildDir = buildResult.buildDir;
  //   log(`✅ 构建完成: ${buildDir}`);
  // } else {
  //   buildDir = expectedBuildDir;
  //   log(`⏭️ ${name} 跳过构建，使用已有构建产物: ${buildDir}`);
  // }

  // 收集构建产物 HTML 文件
  // const htmlPages = collectHtmlPages(buildDir, project);
  // log(`📦 收集到 ${htmlPages.length} 个 HTML 页面`);

  // if (htmlPages.length === 0) {
  //   log(`⚠️ ${name} 未找到任何 HTML 页面，跳过检查`);
  //   return { name, ok: true, findings: 0, byDim: {} };
  // }

  // 运行所有可插拔检查项
  const context = {
    project,
    workDir,
    // buildDir,
    // htmlPages,
  };

  const { findings } = await runAllChecks(checks, context, { skip });

  // 汇总统计
  const byDim = {};
  for (const f of findings) byDim[f.check] = (byDim[f.check] || 0) + 1;
  const dimStr =
    Object.entries(byDim).map(([d, n]) => `${d}:${n}`).join(' ') || '无';
  log(`=== ${name} 检查完成, 问题统计: ${dimStr} ===`);

  // 提 issue
  let issueUrl = '';
  if (findings.length > 0) {
    const issueRes = await createOrUpdateIssue(project, findings, { dryRun });
    if (issueRes.success) issueUrl = issueRes.url;
  }

  return { name, ok: true, findings: findings.length, byDim, issueUrl };
}

// ============ 入口 ============

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const projectFilter = args.project || null;
  const dryRun = args.dryRun || false;

  log(`配置文件: ${configPath}`);
  log(`模式: ${dryRun ? 'dry-run' : 'normal'}`);

  // 加载检查项
  log(`\n加载 HTML 语义检查项...`);
  const checks = await loadChecks();
  log(`已加载 ${checks.length} 个检查项\n`);

  if (checks.length === 0) {
    log(`❌ 未加载到任何检查项，退出`);
    process.exit(1);
  }

  // 加载配置
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
      summaries.push(await runProject(project, checks, { dryRun }));
    } catch (err) {
      log(`❌ ${project.name} 处理异常: ${err.message}`);
      summaries.push({ name: project.name, ok: false, error: err.message });
    }
  }

  log(`\n===== 总汇总 =====`);
  const failed = summaries.filter((s) => !s.ok);
  log(
    `项目总数: ${summaries.length}  成功: ${summaries.length - failed.length}  失败: ${failed.length}`
  );
  for (const s of summaries) {
    if (s.ok) {
      const dimStr = s.byDim
        ? Object.entries(s.byDim).map(([d, n]) => `${d}:${n}`).join(' ')
        : '';
      log(`  ✅ ${s.name}  问题数: ${s.findings ?? 0}  ${dimStr}`);
    } else {
      log(`  ❌ ${s.name}  ${s.error || ''}`);
    }
  }

}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
});
