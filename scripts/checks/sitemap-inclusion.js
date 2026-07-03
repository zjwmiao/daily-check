import { fetchHttp } from '../lib/html-fetch.js';

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

function parseUrlEntry(xml) {
  const entry = {};
  
  const locMatch = xml.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i);
  if (locMatch) entry.loc = locMatch[1].trim();
  
  const lastmodMatch = xml.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i);
  if (lastmodMatch) entry.lastmod = lastmodMatch[1].trim();
  
  const changefreqMatch = xml.match(/<changefreq>\s*([^<\s]+)\s*<\/changefreq>/i);
  if (changefreqMatch) entry.changefreq = changefreqMatch[1].trim();
  
  const priorityMatch = xml.match(/<priority>\s*([^<\s]+)\s*<\/priority>/i);
  if (priorityMatch) {
    const val = parseFloat(priorityMatch[1].trim());
    if (!isNaN(val)) entry.priority = val;
  }
  
  return entry;
}

export async function getSitemapUrls(sitemapUrl) {
  if (SITEMAP_CACHE.has(sitemapUrl)) return SITEMAP_CACHE.get(sitemapUrl);

  const urls = new Set();
  const entries = [];
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

    if (isIndex) {
      const rawLocs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      const locs = rawLocs.map(loc => normalizeLocUrl(loc, cur));
      for (const loc of locs) queue.push(loc);
    } else {
      const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
      for (const block of urlBlocks) {
        const entry = parseUrlEntry(block);
        if (entry.loc) {
          const normalizedLoc = normalizeLocUrl(entry.loc, cur);
          entry.loc = normalizedLoc;
          urls.add(normalizedLoc);
          entries.push(entry);
        }
      }
    }
  }

  const result = { urls: [...urls], entries, failedUrls };
  SITEMAP_CACHE.set(sitemapUrl, result);
  return result;
}
