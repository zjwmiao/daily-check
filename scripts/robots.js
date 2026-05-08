#!/usr/bin/env node

/**
 * robots.js — robots.txt 检测工具
 *
 * 检测网站 robots.txt 是否正确配置：
 *   - /robots.txt 是否可访问（200）
 *   - 语法合法性（每条规则前须有 User-agent）
 *   - 是否有通配符规则（User-agent: *）
 *   - 是否声明了 Sitemap
 *   - 是否存在"封锁全站"的危险规则（Disallow: /）
 *   - 是否封锁了常见 SEO 重要路径
 *   - 主流爬虫（Googlebot / Bingbot）是否被封锁
 *
 * 用法：
 *   node scripts/robots.js <域名或完整URL> [选项]
 *
 * 选项：
 *   --out=<路径>  将报告保存为 .md 文件（不含扩展名）
 *   --verbose     打印解析后的完整规则列表
 *
 * 示例：
 *   node scripts/robots.js https://example.com
 *   node scripts/robots.js example.com --out=reports/example-robots
 *   node scripts/robots.js https://example.com --verbose
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { URL, fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
用法：node scripts/robots.js <域名或URL> [选项]

选项：
  --out=<路径>  将报告保存为 .md 文件（不含扩展名）
  --verbose     打印解析后的完整规则列表

示例：
  node scripts/robots.js https://example.com
  node scripts/robots.js example.com --out=reports/example-robots
  node scripts/robots.js https://example.com --verbose
`);
  process.exit(0);
}

const rawInput = args[0];
const options = {};
for (const arg of args.slice(1)) {
  const [key, val] = arg.replace(/^--/, '').split('=');
  options[key] = val ?? true;
}

const verbose = options.verbose === true;
const outPath = options.out
  ? (options.out.includes('/') || options.out.includes(path.sep)
      ? options.out.replace(/\.md$/, '')
      : path.join(REPORTS_DIR, options.out.replace(/\.md$/, '')))
  : null;

function normalizeUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

let origin;
try {
  origin = new URL(normalizeUrl(rawInput)).origin;
} catch {
  console.error(`❌ 无效的域名或 URL：${rawInput}`);
  process.exit(1);
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

// 常见 SEO 重要路径：若被 Disallow 则提示
const SEO_IMPORTANT_PATHS = ['/', '/blog', '/products', '/categories', '/search'];

// 主流爬虫
const MAJOR_BOTS = ['googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider'];

// ─── 解析 robots.txt ──────────────────────────────────────────────────────────

/**
 * 解析 robots.txt 文本，返回规则组列表：
 * [{ agents: ['*', 'googlebot'], disallow: ['/admin'], allow: ['/public'] }, ...]
 * 以及 sitemapUrls: string[]
 */
function parseRobots(text) {
  const groups = [];
  const sitemapUrls = [];
  const syntaxErrors = [];

  let current = null;
  let pendingNewGroup = false;  // 空行后遇到 User-agent 才真正开启新组

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, '').trim();  // 去注释
    if (!line) {
      pendingNewGroup = true;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      syntaxErrors.push(`第 ${i + 1} 行：缺少冒号 — ${raw.trim()}`);
      continue;
    }

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'sitemap') {
      sitemapUrls.push(value);
      continue;
    }

    if (field === 'user-agent') {
      if (pendingNewGroup || !current) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      pendingNewGroup = false;
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === 'disallow' || field === 'allow') {
      if (!current) {
        syntaxErrors.push(`第 ${i + 1} 行：${field} 前缺少 User-agent — ${raw.trim()}`);
        continue;
      }
      pendingNewGroup = false;
      current[field].push(value);
      continue;
    }

    // crawl-delay 等其他字段：忽略，不报错
  }

  return { groups, sitemapUrls, syntaxErrors };
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const reportLines = [];
  const log = (line = '') => {
    console.log(line);
    reportLines.push(line);
  };

  log('\n══════════════════════════════════════════════════════');
  log(`  robots.txt 检测报告`);
  log(`  目标：${origin}`);
  log('══════════════════════════════════════════════════════\n');

  // 1. 可访问性
  log('── 可访问性 ────────────────────────────────────────────');
  const robotsUrl = `${origin}/robots.txt`;
  let text = '';

  try {
    const res = await axios.get(robotsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RobotsChecker/1.0)' },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      responseType: 'text',
    });

    if (res.status === 200) {
      text = res.data;
      // 确认内容类型是文本（防止返回 HTML 错误页）
      const ct = res.headers['content-type'] || '';
      if (ct.includes('text/html') && !text.includes('User-agent')) {
        log(`${FAIL} ${robotsUrl} 返回了 HTML 页面而非 robots.txt`);
        finalize([], true, reportLines, outPath, log);
        return;
      }
      log(`${PASS} 可访问（HTTP 200）：${robotsUrl}`);
    } else if (res.status === 404) {
      log(`${FAIL} robots.txt 不存在（HTTP 404）：${robotsUrl}`);
      finalize([], true, reportLines, outPath, log);
      return;
    } else {
      log(`${FAIL} robots.txt 返回异常状态码 ${res.status}：${robotsUrl}`);
      finalize([], true, reportLines, outPath, log);
      return;
    }
  } catch (err) {
    log(`${FAIL} 无法访问 robots.txt：${err.message}`);
    finalize([], true, reportLines, outPath, log);
    return;
  }

  // 2. 语法检查
  log('\n── 语法检查 ────────────────────────────────────────────');
  const { groups, sitemapUrls, syntaxErrors } = parseRobots(text);

  if (syntaxErrors.length === 0) {
    log(`${PASS} 语法合法，共解析 ${groups.length} 个规则组`);
  } else {
    syntaxErrors.forEach(e => log(`${FAIL} ${e}`));
  }

  // verbose：打印完整规则
  if (verbose) {
    log('');
    groups.forEach((g, i) => {
      log(`  [规则组 ${i + 1}] User-agent: ${g.agents.join(', ')}`);
      g.disallow.forEach(d => log(`    Disallow: ${d || '（空，即允许全部）'}`));
      g.allow.forEach(a => log(`    Allow: ${a}`));
    });
  }

  // 3. 通配符规则
  log('\n── 通配符规则（User-agent: *）──────────────────────────');
  const wildcardGroup = groups.find(g => g.agents.includes('*'));
  if (wildcardGroup) {
    log(`${PASS} 存在 User-agent: * 规则`);
  } else {
    log(`${FAIL} 缺少 User-agent: * 通配符规则（所有未列出的爬虫将无规则可循）`);
  }

  // 4. Sitemap 声明
  log('\n── Sitemap 声明 ────────────────────────────────────────');
  if (sitemapUrls.length > 0) {
    log(`${PASS} 声明了 ${sitemapUrls.length} 个 Sitemap`);
    sitemapUrls.forEach(u => log(`     ${u}`));
  } else {
    log(`${FAIL} 未声明 Sitemap（建议添加 Sitemap: https://example.com/sitemap.xml）`);
  }

  // 5. 危险规则：封锁全站
  log('\n── 危险规则检测 ────────────────────────────────────────');
  const issues = [];

  const blockAllGroups = groups.filter(
    g => g.disallow.includes('/') && g.agents.some(a => a === '*' || MAJOR_BOTS.includes(a))
  );
  if (blockAllGroups.length > 0) {
    blockAllGroups.forEach(g => {
      log(`${FAIL} User-agent: ${g.agents.join(', ')} — Disallow: /（封锁全站，所有页面将无法被索引）`);
      issues.push(`Disallow: / 封锁了 ${g.agents.join(', ')}`);
    });
  } else {
    log(`${PASS} 未发现全站封锁规则`);
  }

  // 6. SEO 重要路径封锁检测
  log('\n── SEO 重要路径 ────────────────────────────────────────');
  const allDisallowedPaths = groups
    .filter(g => g.agents.includes('*') || g.agents.some(a => MAJOR_BOTS.includes(a)))
    .flatMap(g => g.disallow.map(d => ({ path: d, agents: g.agents })));

  const blockedImportant = SEO_IMPORTANT_PATHS.filter(p =>
    allDisallowedPaths.some(({ path: d }) => d && p.startsWith(d))
  );

  if (blockedImportant.length > 0) {
    blockedImportant.forEach(p => {
      log(`${FAIL} 重要路径被封锁：${p}`);
      issues.push(`重要路径 ${p} 被 Disallow`);
    });
  } else {
    log(`${PASS} 常见 SEO 重要路径未被封锁`);
  }

  // 7. 主流爬虫封锁检测
  log('\n── 主流爬虫 ────────────────────────────────────────────');
  const blockedBots = MAJOR_BOTS.filter(bot => {
    const g = groups.find(grp => grp.agents.includes(bot));
    if (!g) return false;
    return g.disallow.includes('/') || g.disallow.some(d => d === '/*');
  });

  if (blockedBots.length > 0) {
    blockedBots.forEach(bot => {
      log(`${FAIL} ${bot} 被全站封锁`);
      issues.push(`${bot} 被全站封锁`);
    });
  } else {
    log(`${PASS} 主流爬虫（Googlebot / Bingbot 等）未被封锁`);
  }

  // 8. 总评
  const hasSyntaxErrors = syntaxErrors.length > 0;
  const missingWildcard = !wildcardGroup;
  const missingSitemap = sitemapUrls.length === 0;

  const allIssues = [
    ...issues,
    ...(hasSyntaxErrors ? [`语法错误 ${syntaxErrors.length} 处`] : []),
    ...(missingWildcard ? ['缺少 User-agent: * 规则'] : []),
  ];
  const allWarnings = [
    ...(missingSitemap ? ['未声明 Sitemap'] : []),
  ];

  log('\n══════════════════════════════════════════════════════');
  if (allIssues.length === 0 && allWarnings.length === 0) {
    log('  总评：PASS');
  } else if (allIssues.length === 0) {
    log(`  总评：PASS（${allWarnings.length} 个警告）`);
    allWarnings.forEach(w => log(`  ${WARN} ${w}`));
  } else {
    log(`  总评：FAIL（${allIssues.length} 个错误${allWarnings.length > 0 ? `，${allWarnings.length} 个警告` : ''}）`);
    allIssues.forEach(e => log(`  ${FAIL} ${e}`));
    allWarnings.forEach(w => log(`  ${WARN} ${w}`));
  }
  log('══════════════════════════════════════════════════════\n');

  if (outPath) saveReport(outPath, reportLines);
}

function finalize(issues, fatal, reportLines, outPath, log) {
  log('\n══════════════════════════════════════════════════════');
  log('  总评：FAIL — robots.txt 不可访问');
  log('══════════════════════════════════════════════════════\n');
  if (outPath) saveReport(outPath, reportLines);
  if (fatal) process.exit(1);
}

function saveReport(outBase, lines) {
  const filepath = `${outBase}.md`;
  fs.mkdirSync(path.dirname(path.resolve(filepath)), { recursive: true });
  fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
  console.log(`📄 报告已保存：${path.resolve(filepath)}`);
}

main().catch(err => {
  console.error(`❌ 检测失败：${err.message}`);
  process.exit(1);
});
