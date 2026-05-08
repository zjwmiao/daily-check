#!/usr/bin/env node

/**
 * crawl.js — 网页抓取工具
 *
 * 用法：
 *   node scripts/crawl.js <URL> [选项]
 *
 * 选项：
 *   --mode=http      纯 HTTP 抓取，速度快，SPA 页面内容不完整（默认）
 *   --mode=browser   无头浏览器抓取，可获取 JS 渲染后的完整内容
 *   --out=<路径>     指定输出文件路径（默认：自动根据 URL 生成文件名）
 *   --format=html    保存原始 HTML（默认）
 *   --format=text    保存纯文本（去除 HTML 标签）
 *   --format=both    同时保存 HTML 和纯文本
 *
 * 示例：
 *   node scripts/crawl.js https://www.openeuler.org/zh/
 *   node scripts/crawl.js https://www.openeuler.org/zh/ --mode=browser
 *   node scripts/crawl.js https://www.openeuler.org/zh/ --out=output.html --format=both
 */

import axios from 'axios';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { URL, fileURLToPath } from 'url';
import { htmlToText } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRAWLED_DIR = path.resolve(__dirname, '..', 'crawled');

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
用法：node scripts/crawl.js <URL> [选项]

选项：
  --mode=http      纯 HTTP 抓取（默认，速度快）
  --mode=browser   无头浏览器抓取（JS 渲染，需要 playwright + Chromium）
  --out=<路径>     指定输出文件路径
  --format=html    保存 HTML（默认）
  --format=text    保存纯文本
  --format=both    同时保存 HTML 和纯文本

示例：
  node scripts/crawl.js https://www.openeuler.org/zh/
  node scripts/crawl.js https://www.openeuler.org/zh/ --mode=browser --format=both
`);
  process.exit(0);
}

const targetUrl = args[0];
const options = {};
for (const arg of args.slice(1)) {
  const [key, val] = arg.replace(/^--/, '').split('=');
  options[key] = val ?? true;
}

const mode   = options.mode   || 'http';
const format = options.format || 'html';

// 根据 URL 自动生成文件名
function makeFilename(url, ext) {
  const parsed = new URL(url);
  const slug = (parsed.hostname + parsed.pathname)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}.${ext}`;
}

const autoName = makeFilename(targetUrl, '').replace(/\.$/, '');
const outBase = options.out
  ? (options.out.includes('/') || options.out.includes(path.sep)
      ? options.out.replace(/\.(html|txt)$/, '')                        // 含路径分隔符：直接用
      : path.join(CRAWLED_DIR, options.out.replace(/\.(html|txt)$/, ''))) // 纯文件名：放入 crawled/
  : path.join(CRAWLED_DIR, autoName);                                    // 未指定：自动名放入 crawled/

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function saveFile(filepath, content) {
  fs.mkdirSync(path.dirname(path.resolve(filepath)), { recursive: true });
  fs.writeFileSync(filepath, content, 'utf-8');
  console.log(`✅ 已保存：${path.resolve(filepath)}`);
}

function printMeta(jsdom, finalUrl) {
  const title       = jsdom.window.document.title.trim();
  const description = jsdom.window.document.head.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const canonical   = jsdom.window.document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
  const h1          = jsdom.window.document.body.querySelector('h1')?.textContent?.trim();

  console.log('\n─── 页面基本信息 ───────────────────────────────');
  console.log(`URL:         ${finalUrl}`);
  console.log(`Title:       ${title || '（未找到）'}`);
  console.log(`Description: ${description || '（未找到）'}`);
  console.log(`Canonical:   ${canonical || '（未找到）'}`);
  console.log(`H1:          ${h1 || '（未找到）'}`);
  console.log('─────────────────────────────────────────────\n');
}

// ─── HTTP 模式 ───────────────────────────────────────────────────────────────

async function crawlHttp(url) {
  console.log(`\n🌐 HTTP 模式抓取：${url}`);

  const response = await axios.get(url, {
    maxRedirects: 10,      // 自动跟随最多 10 次重定向
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    validateStatus: (status) => status < 400,
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  if (finalUrl !== url) {
    console.log(`↪ 重定向至：${finalUrl}`);
  }

  const html = response.data;
  const jsdom = new JSDOM(html);

  printMeta(jsdom, finalUrl);

  return { html, jsdom };
}

// ─── Browser 模式 ────────────────────────────────────────────────────────────

async function crawlBrowser(url) {
  console.log(`\n🖥  Browser 模式抓取（JS 渲染）：${url}`);

  let chromium, browser;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('❌ playwright-core 未安装，请运行：pnpm add playwright-core');
    process.exit(1);
  }

  // 尝试查找系统已安装的 Chrome/Chromium
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  let executablePath;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      console.log(`📍 使用浏览器：${p}`);
      break;
    }
  }

  if (!executablePath) {
    console.log('⚠  未找到系统 Chrome，尝试使用 playwright 自带 Chromium...');
    console.log('   如果失败，请运行：npx playwright install chromium');
  }

  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  // 监听重定向
  let finalUrl = url;
  page.on('response', (response) => {
    if ([301, 302, 303, 307, 308].includes(response.status())) {
      console.log(`↪ 重定向：${response.status()} → ${response.headers()['location'] || ''}`);
    }
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  finalUrl = page.url();

  if (finalUrl !== url) {
    console.log(`↪ 最终 URL：${finalUrl}`);
  }

  const html = await page.content();
  await browser.close();

  const jsdom = new JSDOM(html);
  printMeta(jsdom, finalUrl);

  return { html, jsdom };
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  // 验证 URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    console.error(`❌ 无效的 URL：${targetUrl}`);
    process.exit(1);
  }

  let html, jsdom;

  try {
    if (mode === 'browser') {
      ({ html, jsdom } = await crawlBrowser(targetUrl));
    } else {
      ({ html, jsdom } = await crawlHttp(targetUrl));
    }
  } catch (err) {
    console.error(`❌ 抓取失败：${err.message}`);
    if (err.response) {
      console.error(`   HTTP 状态码：${err.response.status}`);
    }
    process.exit(1);
  }

  // 保存文件
  if (format === 'html' || format === 'both') {
    saveFile(`${outBase}.html`, html);
  }

  if (format === 'text' || format === 'both') {
    const text = htmlToText(jsdom);
    saveFile(`${outBase}.txt`, text);
  }

  console.log('✨ 完成');
}

main();
