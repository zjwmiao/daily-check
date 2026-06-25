import { fetchHead } from '../../lib/html-fetch.js';
import { shouldIgnore, log } from '../utils.js';

const CONCURRENCY_LIMIT = 10;

async function checkSingleUrl(url) {
  try {
    const res = await fetchHead(url, { timeout: 20000 });
    
    if (res.status === 200) {
      return { url, ok: true };
    }
    
    if (res.status >= 300 && res.status < 400) {
      const location = res.location || '';
      return { url, ok: false, message: `发生重定向(${res.status}): ${url} -> ${location}` };
    }
    
    return { url, ok: false, message: `HTTP状态码非200: ${res.status}` };
  } catch (err) {
    return { url, ok: false, message: `URL无法访问: ${err.message}` };
  }
}

async function runBatch(urls) {
  return Promise.all(urls.map(checkSingleUrl));
}

export async function checkUrlAccessibility(project, sitemapUrls, { skip }) {
  if (skip.includes('url-access')) return { findings: [], skipped: true };
  if (!sitemapUrls?.length) return { findings: [], skipped: true };

  const filtered = sitemapUrls.filter(url => {
    try { return !shouldIgnore(new URL(url).pathname, project.ignore_routes); } catch { return false; }
  });

  if (!filtered.length) return { findings: [], skipped: true };

  log(`${project.name} URL可访问性全量检查: ${filtered.length} 个`);

  const findings = [];
  
  for (let i = 0; i < filtered.length; i += CONCURRENCY_LIMIT) {
    const batch = filtered.slice(i, i + CONCURRENCY_LIMIT);
    const results = await runBatch(batch);
    
    for (const r of results) {
      if (!r.ok) {
        findings.push({ url: r.url, check: 'url-access', message: r.message });
      }
    }
  }

  return { findings };
}