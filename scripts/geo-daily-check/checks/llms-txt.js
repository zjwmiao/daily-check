import { fetchHttp } from '../../lib/html-fetch.js';
import { log } from '../utils.js';

export async function checkLlmsTxt(project, { skip }) {
  if (skip.includes('llms-txt')) return { findings: [], skipped: true };

  const home = project.home?.[0] || project.home;
  if (!home) return { findings: [], skipped: true };

  const findings = [];
  const files = ['/llms.txt', '/llms-full.txt'];

  for (const f of files) {
    const url = new URL(f, home).toString();
    try {
      const res = await fetchHttp(url, { timeout: 15000 });
      if (!res.html?.trim()) {
        findings.push({ url, check: 'llms-txt', message: `${f} 文件为空或无内容` });
      }
    } catch (err) {
      findings.push({ url, check: 'llms-txt', message: `${f} 无法访问: ${err.message}` });
    }
  }

  return { findings };
}