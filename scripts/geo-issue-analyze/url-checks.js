import path from 'path';
import fs from 'fs';
import { fetchHttp } from '../lib/html-fetch.js';
import { getSitemapUrls } from '../checks/sitemap-inclusion.js';
import { pathnameToKey, shouldIgnore } from '../geo-daily-check/utils.js';
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

async function fetchLlmsTxt(home) {
  if (LLMS_CACHE.has(home)) return LLMS_CACHE.get(home);
  
  const result = { llmsTxt: null, llmsFullTxt: null };
  
  try {
    const res1 = await fetchHttp(new URL('/llms.txt', home).toString(), { timeout: 15000 });
    result.llmsTxt = res1.html;
  } catch {}
  
  try {
    const res2 = await fetchHttp(new URL('/llms-full.txt', home).toString(), { timeout: 15000 });
    result.llmsFullTxt = res2.html;
  } catch {}
  
  LLMS_CACHE.set(home, result);
  return result;
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
      allEntries.push(...await getSitemapUrls(sm));
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
  
  const llms = await fetchLlmsTxt(home);
  const inFiles = [];
  let covered = false;
  
  const urlNorm = url.toLowerCase().replace(/#.*$/, '').replace(/\?.*$/, '');
  
  if (llms.llmsTxt && llms.llmsTxt.toLowerCase().includes(urlNorm)) {
    covered = true;
    inFiles.push('llms.txt');
  }
  
  if (llms.llmsFullTxt && llms.llmsFullTxt.toLowerCase().includes(urlNorm)) {
    covered = true;
    inFiles.push('llms-full.txt');
  }
  
  return { covered, inFiles, llmsTxtExists: !!llms.llmsTxt, llmsFullTxtExists: !!llms.llmsFullTxt };
}

export async function checkTdkSchemaExists(url, project, workDir) {
  const result = { tdkExists: false, schemaExists: false, tdkContent: null, schemaContent: null };
  
  if (!project.seo_config_dir) {
    return { ...result, error: '项目未配置 seo_config_dir' };
  }
  
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return { ...result, error: 'URL 格式无效' };
  }
  
  const pathname = urlObj.pathname;
  if (shouldIgnore(pathname, project.ignore_routes)) {
    return { ...result, ignored: true, message: 'URL 在 ignore_routes 中' };
  }
  
  const key = pathnameToKey(pathname);
  
  if (project.seo_config_dir.tdk) {
    const tdkPath = path.join(workDir, project.seo_config_dir.tdk, key, 'index.json');
    if (fs.existsSync(tdkPath)) {
      result.tdkExists = true;
      try {
        result.tdkContent = JSON.parse(fs.readFileSync(tdkPath, 'utf-8'));
      } catch {}
    }
  }
  
  if (project.seo_config_dir.schema) {
    const schemaPath = path.join(workDir, project.seo_config_dir.schema, key, 'index.json');
    if (fs.existsSync(schemaPath)) {
      result.schemaExists = true;
      try {
        result.schemaContent = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      } catch {}
    }
  }
  
  return result;
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

export async function runAllChecks(url, project, workDir) {
  const isDocs = project.project_type === 'docs';
  const results = {
    url,
    project: project.name,
    isDocs,
    checks: {}
  };
  
  results.checks.sitemap = await checkUrlInSitemap(url, project);
  results.checks.llmsTxt = await checkUrlInLlmsTxt(url, project);
  
  if (!isDocs) {
    results.checks.tdkSchema = await checkTdkSchemaExists(url, project, workDir);
  }
  
  return results;
}