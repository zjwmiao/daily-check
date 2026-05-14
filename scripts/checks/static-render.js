import { fetchHttp, fetchBrowser, parseHtml } from '../lib/html-fetch.js';

function extractSignals(html) {
  const doc = parseHtml(html);
  const h1 = [...doc.querySelectorAll('h1')].map((n) => n.textContent.trim()).filter(Boolean);
  const h2 = [...doc.querySelectorAll('h2')].map((n) => n.textContent.trim()).filter(Boolean);
  const paragraphs = [...doc.querySelectorAll('p')]
    .map((n) => n.textContent.trim())
    .filter((t) => t.length > 20);
  const bodyText = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return {
    h1_count: h1.length,
    h2_count: h2.length,
    paragraph_count: paragraphs.length,
    body_length: bodyText.length,
    has_h1: h1.length > 0,
    first_h1: h1[0] || null,
  };
}

export async function checkStaticRender(url, { skipBrowser = false } = {}) {
  const http = await fetchHttp(url);
  const httpSignals = extractSignals(http.html);

  if (skipBrowser) {
    const problems = [];
    if (httpSignals.body_length < 500) {
      problems.push({
        category: 'static.empty_body',
        description: `HTTP 抓取正文不足 500 字符(${httpSignals.body_length} 字符)`,
        suggestion: '页面可能完全依赖 JS 渲染,改 SSR/SSG',
      });
    }
    if (!httpSignals.has_h1) {
      problems.push({
        category: 'static.no_h1',
        description: 'HTTP 抓取无 H1 标签(skip-browser 模式下无法确认是否 JS 渲染缺失)',
        suggestion: '若 Browser 抓取有 H1 则需 SSR;否则需补 H1',
      });
    }
    return {
      dimension: 'static_render',
      mode: 'http-only',
      http: httpSignals,
      problems,
      pass: problems.length === 0,
    };
  }

  let browserSignals = null;
  try {
    const browser = await fetchBrowser(url);
    browserSignals = extractSignals(browser.html);
  } catch (err) {
    return {
      dimension: 'static_render',
      mode: 'http-fallback',
      http: httpSignals,
      browser_error: err.message,
      problems: [],
      pass: true,
      note: 'browser 抓取失败,仅 HTTP 信号',
    };
  }

  const problems = [];
  const ratio = httpSignals.body_length / Math.max(1, browserSignals.body_length);
  const h1Diff = !httpSignals.has_h1 && browserSignals.has_h1;
  const contentLoss = ratio < 0.5;

  if (h1Diff) {
    problems.push({
      category: 'static.h1_missing',
      description: 'HTTP 抓取无 H1,Browser 抓取有 H1(需 JS 渲染)',
      suggestion: '改 SSR/SSG,确保 H1 在静态 HTML 中',
    });
  }
  if (contentLoss) {
    problems.push({
      category: 'static.content_loss',
      description: `HTTP 正文长度仅为 Browser 的 ${Math.round(ratio * 100)}%(< 50%)`,
      suggestion: '关键内容必须在静态 HTML 中输出',
      http_length: httpSignals.body_length,
      browser_length: browserSignals.body_length,
    });
  }

  return {
    dimension: 'static_render',
    mode: 'dual',
    http: httpSignals,
    browser: browserSignals,
    content_ratio: Math.round(ratio * 100) / 100,
    problems,
    pass: problems.length === 0,
  };
}
