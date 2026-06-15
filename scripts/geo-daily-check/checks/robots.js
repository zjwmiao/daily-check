import { fetchHttp } from '../../lib/html-fetch.js';
import { log } from '../utils.js';

export function blocksAllCrawlers(text) {
  const groups = [];
  let cur = null;
  let lastWasRule = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      if (!cur || lastWasRule) {
        cur = { agents: [], disallowRoot: false, allowRoot: false };
        groups.push(cur);
      }
      cur.agents.push(value);
      lastWasRule = false;
    } else if (cur) {
      if (field === 'disallow' && value === '/') cur.disallowRoot = true;
      if (field === 'allow' && value === '/') cur.allowRoot = true;
      lastWasRule = true;
    }
  }

  return groups.some((g) => g.agents.includes('*') && g.disallowRoot && !g.allowRoot);
}

export async function checkRobotsTxt(project, { skip }) {
  if (skip.includes('robots-txt')) return { findings: [], skipped: true, robotsContent: null };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true, robotsContent: null };

  const robotsUrl = new URL('/robots.txt', home).toString();
  const findings = [];
  let robotsContent = null;

  log(`${project.name} robots.txt 检查: ${robotsUrl}`);

  try {
    const { html } = await fetchHttp(robotsUrl, { timeout: 20000 });
    robotsContent = html;

    if (blocksAllCrawlers(html)) {
      findings.push({ url: robotsUrl, check: 'robots-txt', message: 'robots.txt 对 User-agent:* 全站 Disallow: /，禁止爬虫访问' });
    }

    const hasSitemap = /^\s*sitemap:\s*\S+/gim.test(html);
    if (!hasSitemap) {
      findings.push({ url: robotsUrl, check: 'robots-txt', message: 'robots.txt 未声明 Sitemap 地址' });
    }
  } catch (err) {
    findings.push({ url: robotsUrl, check: 'robots-txt', message: `robots.txt 无法访问: ${err.message}` });
  }

  return { findings, robotsContent };
}