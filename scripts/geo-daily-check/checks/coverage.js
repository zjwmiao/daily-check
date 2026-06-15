import { iterateFiles, shouldIgnore, normalizePathname, matchGlob, log, HTML_IGNORE } from '../utils.js';

export async function checkBuildSitemapCoverage(project, buildDir, sitemapUrls, { skip }) {
  if (skip.includes('sitemap-coverage')) return { findings: [], skipped: true };
  if (!project.accessible_routes?.length) return { findings: [], skipped: true };
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const pages = [...iterateFiles(buildDir, /\.html$/, HTML_IGNORE)]
    .map(file => {
      const rel = file.slice(buildDir.length).replace(/\\/g, '/');
      let key = rel.replace(/^\//, '').replace(/(\/index)?\.html$/, '');
      if (key === '') key = 'index';
      const url = key === 'index' ? '/' : '/' + key;
      return { url };
    })
    .filter(page => !shouldIgnore(page.url, project.ignore_routes));
  const sitemapSet = new Set(sitemapUrls.map(u => {
    try { return normalizePathname(new URL(u).pathname); } catch { return ''; }
  }).filter(Boolean));

  log(`${project.name} 构建产物sitemap覆盖检查: 页面 ${pages.length}, sitemap条目 ${sitemapSet.size}`);
  const findings = [];

  for (const page of pages) {
    const shouldCheck = project.accessible_routes.some(p => matchGlob(p, page.url));
    if (shouldCheck && !sitemapSet.has(normalizePathname(page.url))) {
      findings.push({ url: page.url, check: 'sitemap-coverage', message: '构建页面未被sitemap收录' });
    }
  }

  return { findings };
}