import { fetchHttp } from '../../lib/html-fetch.js';
import { shouldIgnore, pickRandom, log } from '../utils.js';

export async function checkUrlAccessibility(project, sitemapUrls, { skip }) {
  if (skip.includes('url-access')) return { findings: [], skipped: true };
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const filtered = sitemapUrls.filter(url => {
    try { return !shouldIgnore(new URL(url).pathname, project.ignore_routes); } catch { return false; }
  });

  const sampleUrls = pickRandom(filtered, 50);
  if (!sampleUrls.length) return { findings: [], skipped: true };

  log(`${project.name} URL可访问性抽样检查: ${sampleUrls.length} 个`);
  const findings = [];

  for (const url of sampleUrls) {
    try {
      await fetchHttp(url, { timeout: 20000 });
    } catch (err) {
      findings.push({ url, check: 'url-access', message: `URL无法访问: ${err.message}` });
    }
  }

  return { findings };
}