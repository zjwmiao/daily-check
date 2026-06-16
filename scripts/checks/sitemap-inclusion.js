import { fetchHttp } from '../lib/html-fetch.js';
import { normalizeUrlForSitemap } from '../lib/url-normalize.js';

const SITEMAP_CACHE = new Map();

function normalizeLocUrl(loc, baseUrl) {
  if (loc.startsWith('http://') || loc.startsWith('https://')) {
    return loc;
  }
  
  try {
    const base = new URL(baseUrl);
    
    // 如果 loc 以 / 开头，解析为相对于 sitemap 文件目录的路径
    // 例如：baseUrl = https://docs.opengauss.org/docs/5.0.0/sitemap.xml
    //       loc = /en/sitemap.xml
    //       结果 = https://docs.opengauss.org/docs/5.0.0/en/sitemap.xml
    if (loc.startsWith('/')) {
      const basePathname = base.pathname;
      const dir = basePathname.substring(0, basePathname.lastIndexOf('/') + 1);
      return `${base.origin}${dir}${loc.substring(1)}`;
    }
    
    // 否则使用标准 URL 解析（相对于当前目录）
    return new URL(loc, baseUrl).href;
  } catch {
    return loc;
  }
}

export async function getSitemapUrls(sitemapUrl) {
  if (SITEMAP_CACHE.has(sitemapUrl)) return SITEMAP_CACHE.get(sitemapUrl);

  const urls = new Set();
  const queue = [sitemapUrl];
  const visited = new Set();
  const failedUrls = [];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);

    let xml;
    try {
      const res = await fetchHttp(cur, { timeout: 30000 });
      xml = res.html;
    } catch (err) {
      failedUrls.push({ url: cur, error: err.message });
      continue;
    }

    const isIndex = /<sitemapindex/i.test(xml);
    const rawLocs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const locs = rawLocs.map(loc => normalizeLocUrl(loc, cur));

    if (isIndex) {
      for (const loc of locs) queue.push(loc);
    } else {
      for (const loc of locs) urls.add(loc);
    }
  }

  const result = { urls: [...urls], failedUrls };
  SITEMAP_CACHE.set(sitemapUrl, result);
  return result;
}

export async function checkSitemapInclusion(targetUrl, sitemapUrl, community) {
  if (!sitemapUrl) {
    return {
      dimension: 'sitemap_inclusion',
      problems: [
        { category: 'sitemap.config', description: '未配置 sitemap URL' },
      ],
      pass: false,
    };
  }

  let result;
  try {
    result = await getSitemapUrls(sitemapUrl);
  } catch (err) {
    return {
      dimension: 'sitemap_inclusion',
      sitemap_url: sitemapUrl,
      error: err.message,
      problems: [
        {
          category: 'sitemap.fetch',
          description: `sitemap 拉取失败: ${err.message}`,
        },
      ],
      pass: false,
    };
  }

  const urls = result.urls;

  const target = normalizeUrlForSitemap(targetUrl, community);
  const normalizedSet = new Set(urls.map((u) => normalizeUrlForSitemap(u, community)));
  const included = normalizedSet.has(target);

  const problems = included
    ? []
    : [
        {
          category: 'sitemap.not_included',
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
