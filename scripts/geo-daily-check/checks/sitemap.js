import path from 'path';
import fs from 'fs';
import { getSitemapUrls } from '../../checks/sitemap-inclusion.js';
import { log, shouldIgnore, pathnameToKey } from '../utils.js';

export async function checkSitemapAccessible(project, robotsContent, { skip }) {
  if (skip.includes('sitemap-access')) return { findings: [], skipped: true, sitemapUrls: [] };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true, sitemapUrls: [] };

  let sitemapUrls = [];
  if (robotsContent) {
    sitemapUrls = [...robotsContent.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1].trim());
  }
  if (!sitemapUrls.length) {
    sitemapUrls = [new URL('/sitemap.xml', home).toString()];
  }

  log(`${project.name} sitemap 可访问性检查: ${sitemapUrls.length} 个地址`);

  const findings = [];
  const allEntries = [];

  for (const sm of sitemapUrls) {
    try {
      const result = await getSitemapUrls(sm);
      // 使用循环避免大数组 spread 导致栈溢出
      for (const url of result.urls) {
        allEntries.push(url);
      }
      
      for (const failed of result.failedUrls) {
        findings.push({ 
          url: failed.url, 
          check: 'sitemap-access', 
          message: `sitemap 无法访问: ${failed.error}` 
        });
      }
    } catch (err) {
      findings.push({ url: sm, check: 'sitemap-access', message: `sitemap 处理异常: ${err.message}` });
    }
  }

  if (allEntries.length === 0 && sitemapUrls.length > 0) {
    findings.push({ url: home, check: 'sitemap-access', message: '所有 sitemap 地址均无法访问，SEO/GEO 将无法发现页面' });
  }

  return { findings, sitemapUrls: allEntries };
}

export async function checkSitemapConfig(project, workDir, sitemapUrls, { skip }) {
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

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
  return { findings };
}