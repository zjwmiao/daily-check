#!/usr/bin/env node

/**
 * tdk.js — TDK 检测工具（Title / Description / Keywords）
 *
 * 抓取目标页面，检测 TDK 是否正确配置：
 *   - Title：存在、长度（10–60 字符）、不重复 Description
 *   - Description：存在、长度（50–160 字符）
 *   - Keywords：存在性（仅提示，现代搜索引擎已忽略）
 *   - Open Graph：og:title / og:description 是否配置
 *   - Twitter Card：twitter:card / twitter:title 是否配置
 *
 * 用法：
 *   node scripts/tdk.js <URL> [选项]
 *
 * 选项：
 *   --mode=http      纯 HTTP 抓取（默认）
 *   --mode=browser   无头浏览器抓取，适用于 JS 渲染页面
 *   --out=<路径>     将报告保存为 .md 文件（不含扩展名）
 *
 * 示例：
 *   node scripts/tdk.js https://example.com
 *   node scripts/tdk.js https://example.com --mode=browser
 *   node scripts/tdk.js https://example.com --out=reports/example-tdk
 */

import axios from 'axios';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { URL, fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
用法：node scripts/tdk.js <URL> [选项]

选项：
  --mode=http      纯 HTTP 抓取（默认）
  --mode=browser   无头浏览器抓取（JS 渲染页面）
  --out=<路径>     将报告保存为 .md 文件（不含扩展名）

示例：
  node scripts/tdk.js https://example.com
  node scripts/tdk.js https://example.com --mode=browser
  node scripts/tdk.js https://example.com --out=reports/example-tdk
`);
  process.exit(0);
}

const targetUrl = args[0];
const options = {};
for (const arg of args.slice(1)) {
  const [key, val] = arg.replace(/^--/, '').split('=');
  options[key] = val ?? true;
}

const mode = options.mode || 'http';
const outPath = options.out
  ? (options.out.includes('/') || options.out.includes(path.sep)
      ? options.out.replace(/\.md$/, '')
      : path.join(REPORTS_DIR, options.out.replace(/\.md$/, '')))
  : null;

try {
  const p = new URL(targetUrl);
  if (!['http:', 'https:'].includes(p.protocol)) throw new Error();
} catch {
  console.error(`❌ 无效的 URL：${targetUrl}`);
  process.exit(1);
}

// ─── 抓取 ─────────────────────────────────────────────────────────────────────

async function fetchHttp(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    timeout: 30000,
    maxRedirects: 10,
    validateStatus: s => s < 400,
    responseType: 'text',
  });
  const finalUrl = res.request?.res?.responseUrl || url;
  return { html: res.data, finalUrl };
}

async function fetchBrowser(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('❌ playwright-core 未安装，请运行：pnpm add playwright-core');
    process.exit(1);
  }

  const possiblePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const executablePath = possiblePaths.find(p => fs.existsSync(p));

  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const finalUrl = page.url();
  const html = await page.content();
  await browser.close();
  return { html, finalUrl };
}

// ─── 提取 meta ────────────────────────────────────────────────────────────────

function getMeta(doc, name) {
  return (
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
    doc.querySelector(`meta[name='${name}']`)?.getAttribute('content') ||
    null
  );
}

function getOg(doc, property) {
  return (
    doc.querySelector(`meta[property="og:${property}"]`)?.getAttribute('content') ||
    doc.querySelector(`meta[property='og:${property}']`)?.getAttribute('content') ||
    null
  );
}

function getTwitter(doc, name) {
  return (
    doc.querySelector(`meta[name="twitter:${name}"]`)?.getAttribute('content') ||
    doc.querySelector(`meta[name='twitter:${name}']`)?.getAttribute('content') ||
    null
  );
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN  = 50;
const DESC_MAX  = 160;

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const reportLines = [];
  const log = (line = '') => {
    console.log(line);
    reportLines.push(line);
  };

  // 抓取
  let html, finalUrl;
  try {
    if (mode === 'browser') {
      ({ html, finalUrl } = await fetchBrowser(targetUrl));
    } else {
      ({ html, finalUrl } = await fetchHttp(targetUrl));
    }
  } catch (err) {
    console.error(`❌ 抓取失败：${err.message}`);
    process.exit(1);
  }

  const doc = new JSDOM(html).window.document;

  log('\n══════════════════════════════════════════════════════');
  log('  TDK 检测报告');
  log(`  URL：${finalUrl}`);
  log('══════════════════════════════════════════════════════\n');

  const issues = [];
  const warnings = [];

  // ── Title ──────────────────────────────────────────────────────────────────
  log('── Title ───────────────────────────────────────────────');
  const title = doc.title?.trim() || null;

  if (!title) {
    log(`${FAIL} 缺失`);
    issues.push('Title 缺失');
  } else {
    const len = title.length;
    if (len < TITLE_MIN) {
      log(`${FAIL} 过短（${len} 字符，建议 ${TITLE_MIN}–${TITLE_MAX}）`);
      log(`     "${title}"`);
      issues.push(`Title 过短（${len} 字符）`);
    } else if (len > TITLE_MAX) {
      log(`${FAIL} 过长（${len} 字符，建议 ≤${TITLE_MAX}）`);
      log(`     "${title}"`);
      issues.push(`Title 过长（${len} 字符）`);
    } else {
      log(`${PASS} 长度合规（${len} 字符）`);
      log(`     "${title}"`);
    }
  }

  // ── Description ───────────────────────────────────────────────────────────
  log('\n── Description ─────────────────────────────────────────');
  const description = getMeta(doc, 'description');

  if (!description) {
    log(`${FAIL} 缺失`);
    issues.push('Description 缺失');
  } else {
    const len = description.length;
    if (len < DESC_MIN) {
      log(`${FAIL} 过短（${len} 字符，建议 ${DESC_MIN}–${DESC_MAX}）`);
      log(`     "${description}"`);
      issues.push(`Description 过短（${len} 字符）`);
    } else if (len > DESC_MAX) {
      log(`${FAIL} 过长（${len} 字符，建议 ≤${DESC_MAX}，超出部分搜索引擎会截断）`);
      log(`     "${description.slice(0, 160)}…"`);
      issues.push(`Description 过长（${len} 字符）`);
    } else {
      log(`${PASS} 长度合规（${len} 字符）`);
      log(`     "${description}"`);
    }

    // Title 与 Description 重复检测
    if (title && description === title) {
      log(`${FAIL} Description 与 Title 完全相同`);
      issues.push('Description 与 Title 重复');
    }
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  log('\n── Keywords ────────────────────────────────────────────');
  const keywords = getMeta(doc, 'keywords');

  if (!keywords) {
    log(`${WARN} 缺失（现代搜索引擎已忽略此字段，缺失不影响排名，但部分垂直搜索引擎仍参考）`);
    warnings.push('Keywords 缺失');
  } else {
    const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
    log(`${PASS} 存在，共 ${kws.length} 个关键词`);
    log(`     ${kws.join(' / ')}`);
    if (kws.length > 10) {
      log(`${WARN} 关键词过多（${kws.length} 个），建议不超过 10 个`);
      warnings.push(`Keywords 过多（${kws.length} 个）`);
    }
  }

  // ── Open Graph ────────────────────────────────────────────────────────────
  log('\n── Open Graph ──────────────────────────────────────────');
  const ogTitle       = getOg(doc, 'title');
  const ogDescription = getOg(doc, 'description');
  const ogImage       = getOg(doc, 'image');
  const ogType        = getOg(doc, 'type');

  if (!ogTitle) {
    log(`${FAIL} og:title 缺失`);
    issues.push('og:title 缺失');
  } else {
    log(`${PASS} og:title    "${ogTitle}"`);
  }

  if (!ogDescription) {
    log(`${FAIL} og:description 缺失`);
    issues.push('og:description 缺失');
  } else {
    log(`${PASS} og:description    "${ogDescription.slice(0, 80)}${ogDescription.length > 80 ? '…' : ''}"`);
  }

  if (!ogImage) {
    log(`${FAIL} og:image 缺失（社交分享时无缩略图）`);
    issues.push('og:image 缺失');
  } else {
    log(`${PASS} og:image    ${ogImage}`);
  }

  log(`${ogType ? PASS : WARN} og:type     ${ogType || '缺失'}`);
  if (!ogType) warnings.push('og:type 缺失');

  // ── Twitter Card ──────────────────────────────────────────────────────────
  log('\n── Twitter / X Card ────────────────────────────────────');
  const twitterCard  = getTwitter(doc, 'card');
  const twitterTitle = getTwitter(doc, 'title');

  if (!twitterCard) {
    log(`${FAIL} twitter:card 缺失`);
    issues.push('twitter:card 缺失');
  } else {
    log(`${PASS} twitter:card    ${twitterCard}`);
  }

  if (!twitterTitle) {
    log(`${WARN} twitter:title 缺失（未设置时回落到 og:title）`);
    if (!ogTitle) warnings.push('twitter:title 缺失且无 og:title 兜底');
  } else {
    log(`${PASS} twitter:title    "${twitterTitle}"`);
  }

  // ── 总评 ──────────────────────────────────────────────────────────────────
  log('\n══════════════════════════════════════════════════════');
  if (issues.length === 0 && warnings.length === 0) {
    log('  总评：PASS');
  } else if (issues.length === 0) {
    log(`  总评：PASS（${warnings.length} 个警告）`);
    warnings.forEach(w => log(`  ${WARN} ${w}`));
  } else {
    log(`  总评：FAIL（${issues.length} 个错误${warnings.length > 0 ? `，${warnings.length} 个警告` : ''}）`);
    issues.forEach(e => log(`  ${FAIL} ${e}`));
    warnings.forEach(w => log(`  ${WARN} ${w}`));
  }
  log('══════════════════════════════════════════════════════\n');

  if (outPath) {
    const filepath = `${outPath}.md`;
    fs.mkdirSync(path.dirname(path.resolve(filepath)), { recursive: true });
    fs.writeFileSync(filepath, reportLines.join('\n'), 'utf-8');
    console.log(`📄 报告已保存：${path.resolve(filepath)}`);
  }
}

main().catch(err => {
  console.error(`❌ 检测失败：${err.message}`);
  process.exit(1);
});
