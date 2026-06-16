import path from 'path';
import fs from 'fs';
import { getSitemapUrls } from '../../checks/sitemap-inclusion.js';
import { fetchHttp } from '../../lib/html-fetch.js';
import { log, shouldIgnore, pathnameToKey } from '../utils.js';

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

async function fetchAllSitemapEntries(sitemapIndexUrls) {
  const allUrls = [];
  const failedUrls = [];

  for (const sm of sitemapIndexUrls) {
    try {
      const result = await getSitemapUrls(sm);
      // 使用 for 循环避免大数组 spread 导致栈溢出
      for (const url of result.urls) {
        allUrls.push(url);
      }
      for (const failed of result.failedUrls) {
        failedUrls.push(failed);
      }
    } catch (err) {
      failedUrls.push({ url: sm, error: err.message });
    }
  }

  return { urls: allUrls, failedUrls };
}

export async function checkSitemapConfig(project, workDir, sitemapIndexUrls, { skip }) {
  // 如果跳过 TDK/Schema 检查，直接返回
  if (skip.includes('sitemap-tdk') && skip.includes('sitemap-schema')) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  if (!sitemapIndexUrls?.length) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  // 获取所有 sitemap 条目
  const { urls: sitemapUrls, failedUrls } = await fetchAllSitemapEntries(sitemapIndexUrls);

  if (failedUrls.length > 0) {
    log(`sitemap 条目获取失败: ${failedUrls.length} 个`);
  }

  if (!sitemapUrls.length) {
    return { findings: [], skipped: true, sitemapUrls: [] };
  }

  const findings = [];
  for (const url of sitemapUrls) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { continue; }
    if (shouldIgnore(pathname, project.ignore_routes)) continue;

    const key = pathnameToKey(pathname);

    if (!skip.includes('sitemap-tdk') && project.seo_config_dir?.tdk) {
      const tdkPath = path.join(workDir, project.seo_config_dir.tdk, key, 'index.json');
      if (!fs.existsSync(tdkPath)) {
        findings.push({ url, check: 'sitemap-tdk', message: 'sitemap条目缺少TDK配置文件' });
      }
    }

    if (!skip.includes('sitemap-schema') && project.seo_config_dir?.schema) {
      const schemaPath = path.join(workDir, project.seo_config_dir.schema, key, 'index.json');
      if (!fs.existsSync(schemaPath)) {
        findings.push({ url, check: 'sitemap-schema', message: 'sitemap条目缺少Schema配置文件' });
      }
    }
  }

  log(`${project.name} TDK/Schema 配置检查完成: 条目 ${sitemapUrls.length}, 问题 ${findings.length}`);
  return { findings, sitemapUrls };
}