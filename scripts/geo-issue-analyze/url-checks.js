import { fetchHttp } from '../lib/html-fetch.js';
import { getSitemapUrls } from '../checks/sitemap-inclusion.js';
import { shouldIgnore } from '../geo-daily-check/utils.js';
import { log } from '../lib/utils.js';

const ROBOTS_CACHE = new Map();
const LLMS_CACHE = new Map();
const SITEMAP_URLS_CACHE = new Map();

async function fetchRobots(home) {
  if (ROBOTS_CACHE.has(home)) return ROBOTS_CACHE.get(home);
  
  const robotsUrl = new URL('/robots.txt', home).toString();
  try {
    const res = await fetchHttp(robotsUrl, { timeout: 15000 });
    ROBOTS_CACHE.set(home, { content: res.html, url: robotsUrl });
    return ROBOTS_CACHE.get(home);
  } catch (err) {
    ROBOTS_CACHE.set(home, { content: null, url: robotsUrl, error: err.message });
    return ROBOTS_CACHE.get(home);
  }
}

async function fetchLlmsFullTxt(home) {
  if (LLMS_CACHE.has(home)) return LLMS_CACHE.get(home);
  
  let llmsFullTxt = null;
  try {
    const res = await fetchHttp(new URL('/llms-full.txt', home).toString(), { timeout: 15000 });
    llmsFullTxt = res.html;
  } catch {}
  
  LLMS_CACHE.set(home, llmsFullTxt);
  return llmsFullTxt;
}

async function getSitemapUrlsFromRobots(home) {
  if (SITEMAP_URLS_CACHE.has(home)) return SITEMAP_URLS_CACHE.get(home);
  
  const robots = await fetchRobots(home);
  let sitemapUrls = [];
  
  if (robots.content) {
    sitemapUrls = [...robots.content.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1].trim());
  }
  
  if (!sitemapUrls.length) {
    sitemapUrls = [new URL('/sitemap.xml', home).toString()];
  }
  
  SITEMAP_URLS_CACHE.set(home, sitemapUrls);
  return sitemapUrls;
}

export async function checkUrlInSitemap(url, project) {
  const home = project.home?.[0] || project.home;
  if (!home) {
    return { covered: false, error: '项目未配置 home URL' };
  }
  
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return { covered: false, error: 'URL 格式无效' };
  }
  
  const pathname = urlObj.pathname;
  if (shouldIgnore(pathname, project.ignore_routes)) {
    return { covered: true, ignored: true, message: 'URL 在 ignore_routes 中，跳过检查' };
  }
  
  const sitemapUrls = await getSitemapUrlsFromRobots(home);
  const allEntries = [];
  
  for (const sm of sitemapUrls) {
    try {
      const result = await getSitemapUrls(sm);
      for (const url of result.urls) {
        allEntries.push(url);
      }
    } catch (err) {
      log(`sitemap ${sm} 获取失败: ${err.message}`);
    }
  }
  
  if (!allEntries.length) {
    return { covered: false, error: '无法获取 sitemap 内容', sitemapUrls };
  }
  
  const urlNorm = url.replace(/#.*$/, '').replace(/\?.*$/, '').toLowerCase();
  const covered = allEntries.some(e => {
    const eNorm = e.replace(/#.*$/, '').replace(/\?.*$/, '').toLowerCase();
    return eNorm === urlNorm || eNorm === urlNorm + '/' || urlNorm === eNorm + '/';
  });
  
  return { covered, sitemapUrls, totalEntries: allEntries.length };
}

export async function checkUrlInLlmsTxt(url, project) {
  const home = project.home?.[0] || project.home;
  if (!home) {
    return { covered: false, error: '项目未配置 home URL' };
  }
  
  const llmsFullTxt = await fetchLlmsFullTxt(home);
  
  const urlPath = new URL(url).pathname.replace(/(\/index)?\.html$/, '');
  
  const covered = llmsFullTxt && llmsFullTxt.includes(urlPath);
  
  return { covered, llmsFullTxtExists: !!llmsFullTxt };
}

export function matchProjectByUrl(url, projects) {
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }
  
  const hostname = urlObj.hostname;
  
  for (const p of projects) {
    const homes = Array.isArray(p.home) ? p.home : [p.home];
    for (const h of homes) {
      if (!h) continue;
      try {
        const homeHost = new URL(h).hostname;
        if (hostname === homeHost) {
          return p;
        }
      } catch {}
    }
  }
  
  return null;
}

export async function runAllChecks(url, project) {
  const isDocs = project.project_type === 'docs' || project.project_type === 'docs-website';
  return {
    url,
    project: project.name,
    isDocs,
    checks: {
      sitemap: await checkUrlInSitemap(url, project),
      llmsTxt: await checkUrlInLlmsTxt(url, project)
    }
  };
}