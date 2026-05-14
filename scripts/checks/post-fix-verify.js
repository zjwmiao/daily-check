// Post-fix verifier — agent 改完后,在 workDir(portal 本地 clone)就地把"可静态校验"的维度再跑一遍,
// 用来兜底 prompt 没遵守 / 改错地方 / 没改到位 等问题。
//
// 能验:
//   - sitemap_inclusion:在 workDir 找 sitemap.xml(或 sitemap 生成器配置中能 grep 到的 URL 清单)
//   - tdk.* :agent 在 output.md 自报了改的文件,在该文件中找 title/description/keywords
// 不能验(标记 deferred):
//   - schema:需要页面构建后才有 application/ld+json
//   - static_render:同样,需要 SSR/SSG 出 HTML 才能验
//
// 返回:{ checks: [{ url, dimension, before, after, status }], blocking: bool }
//   status: 'fixed' | 'still_failing' | 'deferred' | 'unverifiable'
//   blocking: 有 status === 'still_failing' 的就 true,上游用来决定是否阻止 push

import fs from 'fs';
import path from 'path';
import { canonicalizeUrlHost } from '../lib/community-map.js';

// agent prompt 约定每行格式:`✅ <url> <dimension> — 改 path/to/file (原因)`
// 我们容忍点空格/全角差别,但需要拿出 url / dimension / file
const OUTPUT_LINE_RE = /^([✅⏭❌])\s+(\S+)\s+(\S+)\s+[—\-]\s+(?:改|跳过|失败)?\s*([^\s(（]+)?/u;

export function parseAgentOutput(md) {
  const records = [];
  if (!md) return records;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(OUTPUT_LINE_RE);
    if (!m) continue;
    const [, icon, url, dimension, file] = m;
    records.push({
      icon,
      url,
      dimension,
      file: file || null,
      raw: line,
    });
  }
  return records;
}

function normalizeUrlForSitemap(url, community) {
  try {
    const canonical = community ? canonicalizeUrlHost(community, url) : url;
    const u = new URL(canonical);
    let pathname = u.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.hostname}${pathname}`;
  } catch {
    return url;
  }
}

// 在 workDir 下找静态 sitemap.xml(可能多份/多语言);返回所有 <loc> 集合
function collectSitemapLocs(workDir) {
  const set = new Set();
  const queue = [workDir];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) queue.push(path.join(dir, ent.name));
      } else if (/sitemap[^/]*\.xml$/i.test(ent.name)) {
        const fp = path.join(dir, ent.name);
        try {
          const xml = fs.readFileSync(fp, 'utf-8');
          for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
            set.add(m[1]);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return [...set];
}

function verifySitemap({ url, community }, locs) {
  const target = normalizeUrlForSitemap(url, community);
  const present = locs.some((l) => normalizeUrlForSitemap(l, community) === target);
  return {
    status: present ? 'fixed' : 'still_failing',
    before: 'not_included',
    after: present ? 'included' : 'still_not_included',
    note: present
      ? `target 在 workDir 的 sitemap.xml 中找到`
      : `在 workDir 内的 sitemap*.xml(${locs.length} 个 URL)未找到 target;agent 可能改了生成器但没产 sitemap.xml,或没改到点子上`,
  };
}

// frontmatter / html meta 提取(轻量,不引依赖)
function extractTdkFromFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let title = null;
  let description = null;
  let keywords = null;
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^(title|description|keywords)\s*[:：]\s*(.*?)\s*$/i);
      if (!m) continue;
      const v = m[2].replace(/^["'](.*)["']$/, '$1');
      if (m[1].toLowerCase() === 'title') title = v;
      else if (m[1].toLowerCase() === 'description') description = v;
      else if (m[1].toLowerCase() === 'keywords') keywords = v;
    }
  }
  // 没 frontmatter 就找 <title> + <meta>
  if (!title) {
    const m = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) title = m[1].trim();
  }
  if (!description) {
    const m = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    if (m) description = m[1].trim();
  }
  if (!keywords) {
    const m = content.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i);
    if (m) keywords = m[1].trim();
  }
  return { title, description, keywords };
}

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

function verifyTdk({ url, dimension, file, workDir, beforeProblem }) {
  if (!file) {
    return {
      status: 'unverifiable',
      note: 'agent output 未给出 file 路径,无法在 workDir 定位',
    };
  }
  const abs = path.isAbsolute(file) ? file : path.join(workDir, file);
  const tdk = extractTdkFromFile(abs);
  if (!tdk) {
    return { status: 'unverifiable', note: `读不到 ${file}` };
  }
  // 对应字段
  const sub = dimension.split('.')[1] || 'title';
  const val = tdk[sub] || '';
  const len = val.length;
  let after;
  let ok;
  if (sub === 'title') {
    ok = len >= TITLE_MIN && len <= TITLE_MAX;
    after = `${len}字符 (${TITLE_MIN}-${TITLE_MAX})`;
  } else if (sub === 'description') {
    ok = len >= DESC_MIN && len <= DESC_MAX;
    after = `${len}字符 (${DESC_MIN}-${DESC_MAX})`;
  } else if (sub === 'keywords') {
    ok = len > 0;
    after = len > 0 ? `${len}字符` : '仍缺失';
  } else {
    return { status: 'unverifiable', note: `未知 tdk 子项 ${sub}` };
  }
  return {
    status: ok ? 'fixed' : 'still_failing',
    before: beforeProblem?.description || '不达标',
    after,
    file,
    note: ok ? `${sub} 已达阈值` : `${sub} 仍不达阈值`,
  };
}

export function verifyFixesInWorkDir({ workDir, agentOutput, problems, community }) {
  const records = parseAgentOutput(agentOutput);
  // url -> first record from agent
  const byUrlDim = new Map();
  for (const r of records) {
    byUrlDim.set(`${r.url}|${r.dimension}`, r);
  }

  const sitemapLocs = collectSitemapLocs(workDir);

  const checks = [];
  for (const p of problems) {
    const key = `${p.url}|${p.dimension}`;
    const agentRec = byUrlDim.get(key) || null;
    // agent 自报跳过 → 我们也跳过验
    if (agentRec?.icon === '⏭') {
      checks.push({
        url: p.url,
        dimension: p.dimension,
        status: 'deferred',
        before: p.description,
        after: '-',
        note: 'agent 自报跳过',
      });
      continue;
    }
    // agent 自报失败 → 不验,标 still_failing
    if (agentRec?.icon === '❌') {
      checks.push({
        url: p.url,
        dimension: p.dimension,
        status: 'still_failing',
        before: p.description,
        after: 'agent 失败',
        note: agentRec.raw,
      });
      continue;
    }

    if (p.dimension === 'sitemap_inclusion') {
      const r = verifySitemap({ url: p.url, community }, sitemapLocs);
      checks.push({ url: p.url, dimension: p.dimension, ...r });
    } else if (p.dimension && p.dimension.startsWith('tdk')) {
      const r = verifyTdk({
        url: p.url,
        dimension: p.dimension,
        file: agentRec?.file || null,
        workDir,
        beforeProblem: p,
      });
      checks.push({ url: p.url, dimension: p.dimension, ...r });
    } else {
      // schema / static_render → 需要 build 才能验
      checks.push({
        url: p.url,
        dimension: p.dimension,
        status: 'deferred',
        before: p.description,
        after: '-',
        note: '需 build 后才可静态校验,延后到 portal CI / geo-poll 重验',
      });
    }
  }

  const blocking = checks.some((c) => c.status === 'still_failing');
  const summary = {
    total: checks.length,
    fixed: checks.filter((c) => c.status === 'fixed').length,
    still_failing: checks.filter((c) => c.status === 'still_failing').length,
    deferred: checks.filter((c) => c.status === 'deferred').length,
    unverifiable: checks.filter((c) => c.status === 'unverifiable').length,
  };
  return { checks, summary, blocking };
}
