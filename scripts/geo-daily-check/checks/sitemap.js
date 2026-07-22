import { getSitemapUrls } from '../../checks/sitemap-inclusion.js';
import { fetchHttp, parseHtml } from '../../lib/html-fetch.js';
import { log, shouldIgnore, pickRandom } from '../utils.js';

export async function checkSitemapAccessible(project, robotsContent, { skip }) {
  if (skip.includes('sitemap-access')) return { findings: [], skipped: true, sitemapIndexUrls: [] };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true, sitemapIndexUrls: [] };

  // 从 robots.txt 解析 sitemap URL
  let sitemapIndexUrls = [];
  if (robotsContent) {
    sitemapIndexUrls = [...robotsContent.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1].trim());
  }
  if (!sitemapIndexUrls.length) {
    sitemapIndexUrls = [new URL('/sitemap.xml', home).toString()];
  }

  log(`${project.name} sitemap 可访问性检查: ${sitemapIndexUrls.length} 个地址`);

  const findings = [];

  // GET 请求检查每个 sitemap URL 是否可访问
  for (const url of sitemapIndexUrls) {
    try {
      const res = await fetchHttp(url, { timeout: 30000 });
      if (!res.html) {
        findings.push({ url, check: 'sitemap-access', message: 'sitemap 返回空内容' });
      }
    } catch (err) {
      findings.push({ url, check: 'sitemap-access', message: `sitemap 无法访问: ${err.message}` });
    }
  }

  return { findings, sitemapIndexUrls };
}

async function fetchAllSitemapEntries(sitemapIndexUrls, project) {
  const allEntries = [];
  const failedUrls = [];

  for (const sm of sitemapIndexUrls) {
    try {
      const result = await getSitemapUrls(sm);
      for (const entry of result.entries) {
        let pathname;
        try { pathname = new URL(entry.loc).pathname; } catch { continue; }
        if (shouldIgnore(pathname, project.ignore_routes)) continue;
        allEntries.push(entry);
      }
      for (const failed of result.failedUrls) {
        failedUrls.push(failed);
      }
    } catch (err) {
      failedUrls.push({ url: sm, error: err.message });
    }
  }

  const urls = allEntries.map(e => e.loc);
  return { urls, entries: allEntries, failedUrls };
}

const TDK_CONCURRENCY = 10;
const HOMEPAGE_TDK_CACHE = new Map();

function normalizePathnameOf(urlStr) {
  try {
    return (new URL(urlStr).pathname.replace(/\/+$/, '') || '/');
  } catch {
    return (urlStr || '').toLowerCase();
  }
}

function isSamePage(a, b) {
  return normalizePathnameOf(a) === normalizePathnameOf(b);
}

// 依据 projects-config.yaml 的 home_pages（{lang, url} 列表）推断页面所属同语言首页。
// 命中规则（同 origin 优先，跨 origin 兜底）：
//   1. 路径段语言匹配：任一路径段 == 配置的 lang —— 覆盖前缀 /zh/foo 与后缀 /foo/en 两种结构
//   2. 路径前缀匹配：首页 pathname 为页面路径前缀；根(/) 视为该语言 catch-all（默认语言）
//   3. 无命中回退 home[0]
function getSameLangHomepage(pageUrl, project) {
  let u;
  try { u = new URL(pageUrl); } catch { return project.home?.[0] || project.home; }
  const pagePath = u.pathname.replace(/\/+$/, '') || '/';
  const segments = pagePath === '/' ? [] : pagePath.split('/').filter(Boolean);

  const buildCands = (list) => list
    .map(p => {
      let homePath;
      try { homePath = new URL(p.url).pathname.replace(/\/+$/, '') || '/'; } catch { return null; }
      return { url: p.url, lang: p.lang, homePath };
    })
    .filter(Boolean);

  const resolve = (cands) => {
    // 1. 路径段语言匹配（大小写不敏感）：前缀 /zh/foo 与后缀 /foo/en 均命中
    for (const seg of segments) {
      const m = cands.find(p => p.lang && p.lang.toLowerCase() === seg.toLowerCase());
      if (m) return m.url;
    }
    // 2. 路径前缀匹配（最长优先；根 / 为默认语言 catch-all）
    const byPrefix = [...cands].sort((a, b) => b.homePath.length - a.homePath.length);
    for (const c of byPrefix) {
      if (c.homePath === '/') return c.url;
      if (pagePath === c.homePath || pagePath.startsWith(c.homePath + '/')) return c.url;
    }
    return null;
  };

  const sameOrigin = buildCands((project.home_pages || []).filter(p => {
    try { return new URL(p.url).origin === u.origin; } catch { return false; }
  }));
  const same = resolve(sameOrigin);
  if (same) return same;

  const cross = resolve(buildCands(project.home_pages || []));
  if (cross) return cross;

  return project.home?.[0] || project.home;
}

function getMetaContent(doc, name) {
  for (const m of doc.querySelectorAll('meta')) {
    if ((m.getAttribute('name') || '').toLowerCase() === name) {
      return (m.getAttribute('content') || '').trim();
    }
  }
  return '';
}

function extractPageInfo(html, { needTdk, needSchema }) {
  const doc = parseHtml(html);
  const info = {};
  if (needTdk) {
    info.tdk = {
      title: (doc.querySelector('title')?.textContent || '').trim(),
      description: getMetaContent(doc, 'description'),
      keywords: getMetaContent(doc, 'keywords'),
    };
  }
  if (needSchema) {
    info.hasJsonLd = doc.querySelectorAll('script[type="application/ld+json"]').length > 0;
  }
  return info;
}

async function fetchHomepageTDK(homeUrl) {
  if (HOMEPAGE_TDK_CACHE.has(homeUrl)) return HOMEPAGE_TDK_CACHE.get(homeUrl);
  try {
    const { html } = await fetchHttp(homeUrl, { timeout: 20000 });
    const { tdk } = extractPageInfo(html, { needTdk: true, needSchema: false });
    HOMEPAGE_TDK_CACHE.set(homeUrl, tdk);
    return tdk;
  } catch (err) {
    const result = { error: err.message };
    HOMEPAGE_TDK_CACHE.set(homeUrl, result);
    return result;
  }
}

async function checkPageTdkAndSchema(entry, project, { checkTdk, checkSchema }) {
  const url = entry.loc;
  const findings = [];

  let html;
  try {
    const res = await fetchHttp(url, { timeout: 20000 });
    html = res.html;
  } catch (err) {
    if (checkTdk) {
      findings.push({ url, check: 'sitemap-tdk', message: `页面无法获取，跳过TDK检查: ${err.message}` });
    }
    return findings;
  }

  const info = extractPageInfo(html, { needTdk: checkTdk, needSchema: checkSchema });

  if (checkSchema && !info.hasJsonLd) {
    findings.push({ url, check: 'sitemap-schema', message: '页面缺少JSON-LD结构化数据script' });
  }

  if (!checkTdk) return findings;

  const tdk = info.tdk;
  const issues = [];

  const empties = [];
  if (!tdk.title) empties.push('title');
  if (!tdk.description) empties.push('description');
  if (empties.length) issues.push(`缺少 ${empties.join('/')}`);

  const homeUrl = getSameLangHomepage(url, project);
  if (homeUrl && !isSamePage(homeUrl, url)) {
    const homeTdk = await fetchHomepageTDK(homeUrl);
    if (!homeTdk.error) {
      const matches = [];
      if (tdk.title && homeTdk.title && tdk.title === homeTdk.title) matches.push('title');
      if (tdk.description && homeTdk.description && tdk.description === homeTdk.description) matches.push('description');
      if (tdk.keywords && homeTdk.keywords && tdk.keywords === homeTdk.keywords) matches.push('keywords');
      if (matches.length) issues.push(`${matches.join('/')}与同语言首页一致`);
    }
  }

  if (issues.length) {
    findings.push({ url, check: 'sitemap-tdk', message: `未配置页面专属TDK: ${issues.join('；')}` });
  }

  return findings;
}

export async function checkSitemapConfig(project, workDir, sitemapIndexUrls, { skip }) {
  const skipTdk = skip.includes('sitemap-tdk');
  const skipSchema = skip.includes('sitemap-schema');
  const skipPriority = skip.includes('sitemap-priority');

  if (skipTdk && skipSchema && skipPriority) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  if (!sitemapIndexUrls?.length) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  const { urls: sitemapUrls, entries, failedUrls } = await fetchAllSitemapEntries(sitemapIndexUrls, project);

  if (failedUrls.length > 0) {
    log(`sitemap 条目获取失败: ${failedUrls.length} 个`);
  }

  if (!sitemapUrls.length) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  const findings = [];

  if (!skipTdk || !skipSchema) {
    const targets = entries.filter(e => e.loc);
    log(`${project.name} TDK/Schema 在线检查: ${targets.length} 个页面（并发 ${TDK_CONCURRENCY}）`);

    if (!skipTdk) {
      const homeUrls = [...new Set(targets.map(e => getSameLangHomepage(e.loc, project)).filter(Boolean))];
      log(`${project.name} 预取同语言首页 TDK: ${homeUrls.length} 个`);
      await Promise.all(homeUrls.map(u => fetchHomepageTDK(u)));
    }

    for (let i = 0; i < targets.length; i += TDK_CONCURRENCY) {
      const batch = targets.slice(i, i + TDK_CONCURRENCY);
      const results = await Promise.all(batch.map(e =>
        checkPageTdkAndSchema(e, project, { checkTdk: !skipTdk, checkSchema: !skipSchema })
      ));
      for (const fs of results) findings.push(...fs);
    }
  }

  if (!skipPriority && entries.length > 0) {
    const SAMPLE_SIZE = 10;
    const samples = pickRandom(entries, SAMPLE_SIZE);
    for (const entry of samples) {
      if (entry.priority === undefined || entry.priority === null) {
        findings.push({ url: entry.loc, check: 'sitemap-priority', message: 'sitemap 条目缺少 priority 属性' });
      }
    }
  }

  log(`${project.name} TDK/Schema/Priority 配置检查完成: 条目 ${sitemapUrls.length}, 问题 ${findings.length}`);
  return { findings, sitemapUrls };
}