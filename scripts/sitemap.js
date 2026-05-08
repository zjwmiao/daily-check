#!/usr/bin/env node

/**
 * sitemap.js — Sitemap 检测工具
 *
 * 检测网站是否正确配置了 sitemap：
 *   - robots.txt 是否声明 Sitemap 地址
 *   - sitemap.xml 是否可访问
 *   - XML 格式是否合法（urlset / sitemapindex）
 *   - URL 总数、lastmod / changefreq / priority 覆盖率
 *   - 随机抽样 N 条 URL 做 HEAD 请求，统计状态码分布
 *
 * 用法：
 *   node scripts/sitemap.js <域名或完整URL> [选项]
 *
 * 选项：
 *   --sample=N    抽样检查 URL 数量（默认 20，0 = 跳过）
 *   --out=<路径>  将报告保存为 .md 文件（不含扩展名）
 *   --verbose     打印所有抽样 URL 的状态码
 *
 * 示例：
 *   node scripts/sitemap.js https://example.com
 *   node scripts/sitemap.js https://example.com --sample=50 --out=reports/example-sitemap
 *   node scripts/sitemap.js https://example.com --sample=0 --verbose
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
用法：node scripts/sitemap.js <域名或URL> [选项]

选项：
  --sample=N    抽样检查 URL 数量（默认 20，0 = 跳过）
  --out=<路径>  将报告保存为 .md 文件（不含扩展名）
  --verbose     打印所有抽样 URL 的状态码

示例：
  node scripts/sitemap.js https://example.com
  node scripts/sitemap.js https://example.com --sample=50 --out=reports/example-sitemap
  node scripts/sitemap.js https://example.com --sample=0
`);
  process.exit(0);
}

const rawInput = args[0];
const options = {};
for (const arg of args.slice(1)) {
  const [key, val] = arg.replace(/^--/, '').split('=');
  options[key] = val ?? true;
}

const sampleSize = options.sample !== undefined ? parseInt(options.sample, 10) : 20;
const verbose = options.verbose === true;
const outPath = options.out
  ? (options.out.includes('/') || options.out.includes(path.sep)
      ? options.out.replace(/\.md$/, '')
      : path.join(REPORTS_DIR, options.out.replace(/\.md$/, '')))
  : null;

// 规范化输入：补全 https:// 前缀
function normalizeUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

const baseUrl = normalizeUrl(rawInput);
let origin;
try {
  origin = new URL(baseUrl).origin;
} catch {
  console.error(`❌ 无效的域名或 URL：${rawInput}`);
  process.exit(1);
}

// ─── HTTP 工具 ───────────────────────────────────────────────────────────────

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SitemapChecker/1.0)',
  'Accept': 'text/html,application/xml,text/xml,*/*',
};

async function fetchText(url, timeout = 15000) {
  const res = await axios.get(url, {
    headers: HTTP_HEADERS,
    timeout,
    maxRedirects: 5,
    validateStatus: () => true,  // 不抛出，让调用方判断状态码
    responseType: 'text',
  });
  return { status: res.status, data: res.data, finalUrl: res.request?.res?.responseUrl || url };
}

async function headUrl(url, timeout = 10000) {
  try {
    const res = await axios.head(url, {
      headers: HTTP_HEADERS,
      timeout,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return res.status;
  } catch {
    return 0;  // 超时 / 连接失败
  }
}

// ─── 检测逻辑 ────────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

// 从 robots.txt 提取 Sitemap 声明
async function checkRobots() {
  const robotsUrl = `${origin}/robots.txt`;
  let result = { found: false, sitemapUrls: [], robotsAccessible: false };

  try {
    const { status, data } = await fetchText(robotsUrl);
    if (status === 200) {
      result.robotsAccessible = true;
      const lines = data.split('\n');
      for (const line of lines) {
        const m = line.match(/^Sitemap:\s*(.+)/i);
        if (m) result.sitemapUrls.push(m[1].trim());
      }
      result.found = result.sitemapUrls.length > 0;
    }
  } catch {
    // robots.txt 不可访问，忽略
  }

  return result;
}

// 尝试常见路径发现 sitemap
async function discoverSitemaps(robotsSitemapUrls) {
  const candidates = [...robotsSitemapUrls];

  // 若 robots.txt 没有声明，尝试常见路径
  if (candidates.length === 0) {
    candidates.push(
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
    );
  }

  const accessible = [];
  for (const url of candidates) {
    const { status, data } = await fetchText(url).catch(() => ({ status: 0, data: '' }));
    if (status === 200 && data) {
      accessible.push({ url, data });
    }
  }
  return accessible;
}

// 解析 sitemap XML，返回 URL 列表（支持 sitemap index 递归）
async function parseSitemap(xml, sourceUrl, depth = 0) {
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  const doc = dom.window.document;

  const urlEntries = [];

  // sitemap index：递归抓取子 sitemap
  const sitemapLocs = [...doc.querySelectorAll('sitemapindex > sitemap > loc')];
  if (sitemapLocs.length > 0 && depth === 0) {
    for (const loc of sitemapLocs) {
      const subUrl = loc.textContent.trim();
      const { status, data } = await fetchText(subUrl).catch(() => ({ status: 0, data: '' }));
      if (status === 200 && data) {
        const sub = await parseSitemap(data, subUrl, depth + 1);
        urlEntries.push(...sub);
      }
    }
    return urlEntries;
  }

  // urlset
  const urlNodes = [...doc.querySelectorAll('urlset > url')];
  for (const node of urlNodes) {
    const loc        = node.querySelector('loc')?.textContent?.trim();
    const lastmod    = node.querySelector('lastmod')?.textContent?.trim();
    const changefreq = node.querySelector('changefreq')?.textContent?.trim();
    const priority   = node.querySelector('priority')?.textContent?.trim();
    if (loc) urlEntries.push({ loc, lastmod, changefreq, priority });
  }

  return urlEntries;
}

// 随机抽样 URL
function sampleUrls(urls, n) {
  if (n >= urls.length) return [...urls];
  const shuffled = [...urls].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// ─── 报告生成 ────────────────────────────────────────────────────────────────

function buildReport(lines) {
  return lines.join('\n');
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const reportLines = [];
  const log = (line = '') => {
    console.log(line);
    reportLines.push(line);
  };

  log('\n══════════════════════════════════════════════════════');
  log(`  Sitemap 检测报告`);
  log(`  目标：${origin}`);
  log('══════════════════════════════════════════════════════\n');

  // 1. 发现可访问的 sitemap（内部通过 robots.txt + 常见路径）
  const robots = await checkRobots();

  // 2. 发现可访问的 sitemap
  log('\n── Sitemap 可访问性 ───────────────────────────────────');
  const sitemaps = await discoverSitemaps(robots.sitemapUrls);

  if (sitemaps.length === 0) {
    log(`${FAIL} 未发现可访问的 sitemap（已检查 robots.txt 声明路径及 /sitemap.xml 等常见路径）`);
    log('\n══════════════════════════════════════════════════════');
    log('  总评：FAIL — 未找到 sitemap');
    log('══════════════════════════════════════════════════════\n');
    if (outPath) saveReport(outPath, reportLines);
    process.exit(1);
  }

  sitemaps.forEach(({ url }) => log(`${PASS} 可访问：${url}`));

  // 3. 解析所有 sitemap，合并 URL 列表
  log('\n── 内容解析 ───────────────────────────────────────────');
  let allUrls = [];
  let parseErrors = 0;

  for (const { url, data } of sitemaps) {
    try {
      const entries = await parseSitemap(data, url);
      log(`${PASS} ${url}`);
      log(`     解析出 ${entries.length} 条 URL`);
      allUrls.push(...entries);
    } catch (err) {
      log(`${FAIL} ${url} 解析失败：${err.message}`);
      parseErrors++;
    }
  }

  if (allUrls.length === 0) {
    log(`\n${FAIL} 所有 sitemap 均无有效 URL`);
    if (outPath) saveReport(outPath, reportLines);
    process.exit(1);
  }

  // 去重
  const seen = new Set();
  allUrls = allUrls.filter(({ loc }) => {
    if (seen.has(loc)) return false;
    seen.add(loc);
    return true;
  });

  // 4. 规模与字段覆盖率
  log('\n── 规模与字段覆盖率 ────────────────────────────────────');
  const total = allUrls.length;
  const withLastmod    = allUrls.filter(u => u.lastmod).length;
  const withChangefreq = allUrls.filter(u => u.changefreq).length;
  const withPriority   = allUrls.filter(u => u.priority).length;
  const lastmodPct     = Math.round(withLastmod / total * 100);
  const changefreqPct  = Math.round(withChangefreq / total * 100);
  const priorityPct    = Math.round(withPriority / total * 100);

  const sizeStatus = total > 50000 ? FAIL : PASS;
  log(`${sizeStatus} URL 总数：${total.toLocaleString()}${total > 50000 ? '（超过 50,000 条单文件限制，需拆分为 sitemap index）' : ''}`);
  log(`${lastmodPct >= 90 ? PASS : FAIL} lastmod 覆盖率：${lastmodPct}%（${withLastmod} / ${total}）${lastmodPct < 90 ? '  需 ≥90%' : ''}`);
  log(`${changefreqPct >= 90 ? PASS : FAIL} changefreq 覆盖率：${changefreqPct}%（${withChangefreq} / ${total}）${changefreqPct < 90 ? '  需 ≥90%' : ''}`);
  log(`${priorityPct >= 90 ? PASS : FAIL} priority 覆盖率：${priorityPct}%（${withPriority} / ${total}）${priorityPct < 90 ? '  需 ≥90%' : ''}`);

  // 5. URL 抽样健康检查
  let sampleResults = { ok: 0, redirect: 0, clientError: 0, serverError: 0, timeout: 0 };
  let sampledUrls = [];

  if (sampleSize > 0) {
    log(`\n── URL 抽样健康检查（${Math.min(sampleSize, total)} 条）───────────────────`);
    sampledUrls = sampleUrls(allUrls, sampleSize);

    const checks = await Promise.all(
      sampledUrls.map(async ({ loc }) => {
        const status = await headUrl(loc);
        return { loc, status };
      })
    );

    for (const { loc, status } of checks) {
      if (status === 0) {
        sampleResults.timeout++;
      } else if (status >= 200 && status < 300) {
        sampleResults.ok++;
      } else if (status >= 300 && status < 400) {
        sampleResults.redirect++;
      } else if (status >= 400 && status < 500) {
        sampleResults.clientError++;
      } else {
        sampleResults.serverError++;
      }

      if (verbose) {
        const isOk = status >= 200 && status < 300;
        log(`  ${isOk ? PASS : FAIL} [${status || 'timeout'}] ${loc}`);
      }
    }

    const sampleTotal = checks.length;
    const errorCount = sampleResults.clientError + sampleResults.serverError + sampleResults.timeout + sampleResults.redirect;
    const sampleStatus = errorCount === 0 ? PASS : FAIL;

    log(`${sampleStatus} 抽样 ${sampleTotal} 条 URL：`);
    log(`     2xx 正常：${sampleResults.ok}`);
    if (sampleResults.redirect > 0)    log(`     3xx 重定向：${sampleResults.redirect}`);
    if (sampleResults.clientError > 0) log(`     4xx 客户端错误：${sampleResults.clientError}`);
    if (sampleResults.serverError > 0) log(`     5xx 服务端错误：${sampleResults.serverError}`);
    if (sampleResults.timeout > 0)     log(`     超时/无响应：${sampleResults.timeout}`);
  } else {
    log('\n── URL 抽样健康检查：已跳过（--sample=0）─────────────');
  }

  // 6. 总评
  log('\n══════════════════════════════════════════════════════');

  const issues = [];
  const warnings = [];

  if (total > 50000)                    issues.push(`URL 总数 ${total} 超过 50,000 单文件限制`);
  if (lastmodPct < 90)                  issues.push(`lastmod 覆盖率 ${lastmodPct}%，需 ≥90%`);
  if (changefreqPct < 90)              issues.push(`changefreq 覆盖率 ${changefreqPct}%，需 ≥90%`);
  if (priorityPct < 90)                issues.push(`priority 覆盖率 ${priorityPct}%，需 ≥90%`);
  if (parseErrors > 0)                  issues.push(`${parseErrors} 个 sitemap 解析失败`);

  const errorCount = sampleResults.clientError + sampleResults.serverError + sampleResults.timeout + sampleResults.redirect;
  const sampleTotal = sampledUrls.length;
  if (sampleTotal > 0 && errorCount > 0) {
    issues.push(`抽样 URL 存在 ${errorCount} 条非 2xx 响应（${errorCount}/${sampleTotal}）`);
  }

  if (issues.length === 0 && warnings.length === 0) {
    log('  总评：PASS');
  } else if (issues.length === 0) {
    log(`  总评：PASS（${warnings.length} 个警告）`);
    warnings.forEach(w => log(`  ${WARN} ${w}`));
  } else {
    log(`  总评：FAIL（${issues.length} 个错误，${warnings.length} 个警告）`);
    issues.forEach(e => log(`  ${FAIL} ${e}`));
    warnings.forEach(w => log(`  ${WARN} ${w}`));
  }

  log('══════════════════════════════════════════════════════\n');

  // 保存报告
  if (outPath) {
    saveReport(outPath, reportLines);
  }
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
