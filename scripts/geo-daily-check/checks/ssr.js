import { fetchHttp } from '../../lib/html-fetch.js';
import { shouldIgnore, pickRandom, log } from '../utils.js';

export function detectSsr(html, framework) {
  if (framework === 'VitePress') {
    if (/class="VPContent"/.test(html) && /class=["']vpi/.test(html)) {
      return { isSsr: true, reason: 'VitePress 预渲染检测通过' };
    }
    if (/class="VPContent"/.test(html)) {
      const vpMatch = /class="VPContent"[\s\S]*?class="vp-doc"/.test(html);
      if (vpMatch) return { isSsr: true, reason: 'VitePress 预渲染检测通过' };
    }
  }

  if (framework === 'Nuxt') {
    const hasNuxtData = /window\.__NUXT__|data-n-head/.test(html);
    const nuxtMatch = /id="__nuxt"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    const hasNuxtContent = nuxtMatch && nuxtMatch[1].replace(/<[^>]+>/g, '').trim().length > 100;
    if (hasNuxtData || hasNuxtContent) {
      return { isSsr: true, reason: 'Nuxt SSR 检测通过' };
    }
  }

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!bodyMatch) return { isSsr: false, reason: '无 body 标签' };

  const bodyContent = bodyMatch[1];
  const plainText = bodyContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length >= 500) {
    return { isSsr: true, reason: `body 内容丰富 (${plainText.length} 字符)` };
  }

  const csrPatterns = [
    [/<div\s+id="app"\s*>\s*<\/div>/, 'Vue SPA 空挂载点'],
    [/<div\s+id="root"\s*>\s*<\/div>/, 'React SPA 空挂载点'],
    [/<div\s+id="__nuxt"\s*>\s*<\/div>/, 'Nuxt CSR 模式'],
  ];

  for (const [p, desc] of csrPatterns) {
    if (p.test(html)) {
      return { isSsr: false, reason: `检测到 CSR 特征: ${desc}` };
    }
  }

  return { isSsr: false, reason: `body 内容不足 (${plainText.length} 字符)` };
}

export async function checkSsrRendering(project, sitemapUrls, { skip }) {
  if (skip.includes('ssr-rendering')) return { findings: [], skipped: true };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true };

  const framework = project.framework;
  const sampleUrls = [home];

  if (sitemapUrls?.length) {
    const extra = pickRandom(
      sitemapUrls.filter(u => {
        try { return !shouldIgnore(new URL(u).pathname, project.ignore_routes); } catch { return false; }
      }),
      10
    );
    sampleUrls.push(...extra);
  }

  log(`${project.name} SSR渲染检查: ${sampleUrls.length} 个URL`);

  const findings = [];
  for (const url of sampleUrls) {
    try {
      const { html } = await fetchHttp(url, { timeout: 20000 });
      const result = detectSsr(html, framework);
      if (!result.isSsr) {
        findings.push({ url, check: 'ssr-rendering', message: result.reason });
      }
    } catch (err) {
      findings.push({ url, check: 'ssr-rendering', message: `检测失败: ${err.message}` });
    }
  }

  return { findings };
}