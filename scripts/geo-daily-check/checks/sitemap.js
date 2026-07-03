import path from 'path';
import fs from 'fs';
import { getSitemapUrls } from '../../checks/sitemap-inclusion.js';
import { fetchHttp } from '../../lib/html-fetch.js';
import { log, shouldIgnore, pathnameToKey, pickRandom } from '../utils.js';

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

export async function checkSitemapConfig(project, workDir, sitemapIndexUrls, { skip }) {
  if (skip.includes('sitemap-tdk') && skip.includes('sitemap-schema') && skip.includes('sitemap-priority')) {
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
  for (const entry of entries) {
    let pathname;
    try { pathname = new URL(entry.loc).pathname; } catch { continue; }

    const key = decodeURIComponent(pathnameToKey(pathname));

    if (!skip.includes('sitemap-tdk') && project.seo_config_dir?.tdk) {
      const tdkPath = path.join(workDir, project.seo_config_dir.tdk, key, 'index.json');
      if (!fs.existsSync(tdkPath)) {
        findings.push({ url: entry.loc, check: 'sitemap-tdk', message: 'sitemap条目缺少TDK配置文件' });
      }
    }

    if (!skip.includes('sitemap-schema') && project.seo_config_dir?.schema) {
      const schemaPath = path.join(workDir, project.seo_config_dir.schema, key, 'index.json');
      if (!fs.existsSync(schemaPath)) {
        findings.push({ url: entry.loc, check: 'sitemap-schema', message: 'sitemap条目缺少Schema配置文件' });
      }
    }
  }

  if (!skip.includes('sitemap-priority') && entries.length > 0) {
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