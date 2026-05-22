import { canonicalizeUrlHost } from './community-map.js';

// 用于 sitemap 收录判断的 URL 归一化：把 /b.html、/b、/b/ 视为同一个 URL。
export function normalizeUrlForSitemap(url, community) {
  const canonical = community ? canonicalizeUrlHost(community, url) : url;
  try {
    const u = new URL(canonical);
    let pathname = u.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    if (/\.html$/i.test(pathname)) pathname = pathname.slice(0, -'.html'.length);
    return `${u.protocol}//${u.hostname}${pathname}`;
  } catch {
    return canonical;
  }
}
