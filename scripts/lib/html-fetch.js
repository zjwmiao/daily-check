import axios from 'axios';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export async function fetchHttp(url, { timeout = 30000 } = {}) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    timeout,
    maxRedirects: 10,
    validateStatus: (s) => s < 400,
    responseType: 'text',
  });
  return {
    html: res.data,
    finalUrl: res.request?.res?.responseUrl || url,
    status: res.status,
  };
}

const BROWSER_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export async function fetchBrowser(url, { timeout = 60000 } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('playwright-core not installed. Run: pnpm add playwright-core');
  }

  const executablePath = BROWSER_PATHS.find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage({ userAgent: UA });
  await page.goto(url, { waitUntil: 'networkidle', timeout });
  const finalUrl = page.url();
  const html = await page.content();
  await browser.close();
  return { html, finalUrl, status: 200 };
}

export async function fetchDual(url, opts = {}) {
  const http = await fetchHttp(url, opts);
  const browser = await fetchBrowser(url, opts);
  return { http, browser };
}

export function parseHtml(html) {
  return new JSDOM(html).window.document;
}
