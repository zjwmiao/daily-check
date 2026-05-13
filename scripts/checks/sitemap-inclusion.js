import { fetchHttp } from '../lib/html-fetch.js';

const SITEMAP_CACHE = new Map();

async function getSitemapUrls(sitemapUrl) {
  if (SITEMAP_CACHE.has(sitemapUrl)) return SITEMAP_CACHE.get(sitemapUrl);

  const urls = new Set();
  const queue = [sitemapUrl];
  const visited = new Set();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);

    let xml;
    try {
      const res = await fetchHttp(cur, { timeout: 30000 });
      xml = res.html;
    } catch (err) {
      throw new Error(`fetch sitemap ${cur} failed: ${err.message}`);
    }

    const isIndex = /<sitemapindex/i.test(xml);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

    if (isIndex) {
      for (const loc of locs) queue.push(loc);
    } else {
      for (const loc of locs) urls.add(loc);
    }
  }

  const arr = [...urls];
  SITEMAP_CACHE.set(sitemapUrl, arr);
  return arr;
}

function normalize(url) {
  try {
    const u = new URL(url);
    let pathname = u.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.hostname}${pathname}`;
  } catch {
    return url;
  }
}

export async function checkSitemapInclusion(targetUrl, sitemapUrl) {
  if (!sitemapUrl) {
    return {
      dimension: 'sitemap_inclusion',
      problems: [
        { category: 'sitemap.config', severity: 'critical', description: '未配置 sitemap URL' },
      ],
      pass: false,
    };
  }

  let urls;
  try {
    urls = await getSitemapUrls(sitemapUrl);
  } catch (err) {
    return {
      dimension: 'sitemap_inclusion',
      sitemap_url: sitemapUrl,
      error: err.message,
      problems: [
        {
          category: 'sitemap.fetch',
          severity: 'critical',
          description: `sitemap 拉取失败: ${err.message}`,
        },
      ],
      pass: false,
    };
  }

  const target = normalize(targetUrl);
  const normalizedSet = new Set(urls.map(normalize));
  const included = normalizedSet.has(target);

  const problems = included
    ? []
    : [
        {
          category: 'sitemap.not_included',
          severity: 'critical',
          description: 'URL 未被 sitemap 收录',
          suggestion: '将该 URL 加入 sitemap.xml,并填写合理 priority/lastmod',
          target_url: target,
        },
      ];

  return {
    dimension: 'sitemap_inclusion',
    sitemap_url: sitemapUrl,
    sitemap_total_urls: urls.length,
    target_url: target,
    included,
    problems,
    pass: included,
  };
}
