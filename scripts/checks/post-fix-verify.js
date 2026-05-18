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
//   blocking: 仅在 fixed=0 && still_failing>0 时 true(零进展才阻断)
//   — 部分进展(fixed>0 即使 still_failing>0)不 block,reviewer + critic 在 PR body 里看剩下的自己决策

import fs from 'fs';
import path from 'path';
import { canonicalizeUrlHost } from '../lib/community-map.js';
import { checkSchema } from './schema.js';
import { checkTdk } from './tdk.js';

// 解析 agent 写到 output.md 的丰格式修复清单(geo-fix-prompt.md 定义的结构)
// 从 ## ✅/⏭/❌ 状态段 + ### N. {url} ({dim}) 项里:
//   - 优先读项体内的 **维度**: `<具体 dim>` 行(精确,如 tdk.description / static_render.h1_missing)
//   - 项体内 **修复文件**: `<file>` 行;dim 跟 file 按 markdown 顺序 zip
//   - 都没有时回落到 H3 头括号里的 dim(粗粒度,如 schema/tdk)
export function parseAgentOutput(md) {
  if (!md) return [];
  const records = [];
  const lines = md.split(/\r?\n/);

  let currentStatus = null; // ✅ | ⏭ | ❌ | null
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // H2 状态段
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const txt = h2[1];
      if (/^✅/.test(txt)) currentStatus = '✅';
      else if (/^⏭/.test(txt)) currentStatus = '⏭';
      else if (/^❌/.test(txt)) currentStatus = '❌';
      else currentStatus = null;
      i++;
      continue;
    }

    if (!currentStatus) {
      i++;
      continue;
    }

    // H3 项:### N. {url} ({dim[+dim]})
    const h3 = line.match(/^###\s+\d+\.\s+(\S+?)\s*\(([^)]+)\)\s*$/);
    if (!h3) {
      i++;
      continue;
    }

    const url = h3[1];
    const dimensionRaw = h3[2].trim();

    // 项体内:抽 **维度** + **修复文件** + ⏭/❌ 跳过/失败原因
    const dims = [];
    const files = [];
    let reason = null;
    let j = i + 1;
    while (j < lines.length && !/^##\s|^###\s/.test(lines[j])) {
      const dimM = lines[j].match(/^\*\*维度\*\*\s*[:：]\s*`?([^`\n]+?)`?\s*(?:[-—–]\s*.*)?$/);
      if (dimM) dims.push(dimM[1].trim());
      const fileM = lines[j].match(/^\*\*修复文件\*\*\s*[:：]\s*`?([^`\n]+?)`?\s*$/);
      if (fileM) files.push(fileM[1].trim());
      const reasonM = lines[j].match(/^\*\*(?:跳过原因|失败原因)\*\*\s*[:：]\s*(.+?)\s*$/);
      if (reasonM) reason = reasonM[1].trim();
      j++;
    }

    // 项体里没明示 dim 时,回落到 H3 头里的(粗粒度)
    const finalDims =
      dims.length > 0
        ? dims
        : dimensionRaw
            .split(/\s*[+,、,]\s*/)
            .map((s) => s.replace(/^`|`$/g, '').trim())
            .filter(Boolean);

    const n = Math.max(finalDims.length, files.length, 1);
    for (let k = 0; k < n; k++) {
      records.push({
        icon: currentStatus,
        url,
        dimension: finalDims[k] || finalDims[0] || dimensionRaw,
        file: files[k] || files[0] || null,
        reason,
        raw: `${currentStatus} ${url} (${dimensionRaw})`,
      });
    }

    i = j;
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

// 把 URL pathname 映射到 build 产物里的 HTML 文件 — 试常见 SSG 输出布局
// /zh/security/vulnerability-reporting/ →
//   1) <outputDir>/zh/security/vulnerability-reporting/index.html (vitepress / nuxt full-static)
//   2) <outputDir>/zh/security/vulnerability-reporting.html (vite ssg)
//   3) <outputDir>/zh/security/vulnerability-reporting (无后缀,有的框架直出)
function resolveBuiltHtml(url, outputDir) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const stripped = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (stripped === '') {
    const root = path.join(outputDir, 'index.html');
    return fs.existsSync(root) ? root : null;
  }
  const candidates = [
    path.join(outputDir, stripped, 'index.html'),
    path.join(outputDir, stripped + '.html'),
    path.join(outputDir, stripped),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// 用已构建的 HTML 跑该维度对应的 check,把 "deferred(build 后才能验)" 推到 fixed / still_failing
function verifyFromBuiltHtml({ url, dimension, outputDir, beforeProblem }) {
  const file = resolveBuiltHtml(url, outputDir);
  if (!file) {
    return {
      status: 'still_failing',
      before: beforeProblem?.description || '-',
      after: `build 产物里找不到 ${new URL(url).pathname} 对应的 HTML`,
      note: `URL 没在 build output 中产页面 — 可能 prerender 路由没配上 / URL 错填 / 框架不出该路径`,
    };
  }
  const html = fs.readFileSync(file, 'utf-8');
  if (dimension === 'schema') {
    const r = checkSchema(html);
    return r.pass
      ? {
          status: 'fixed',
          before: beforeProblem?.description || 'schema 缺失',
          after: `已嵌入 JSON-LD (${r.types.join(', ') || `${r.block_count} 块`})`,
          file: path.relative(outputDir, file),
        }
      : {
          status: 'still_failing',
          before: beforeProblem?.description || 'schema 缺失',
          after: `build 产物 ${r.block_count} 块 JSON-LD,${r.problems[0]?.description || '仍未通过'}`,
          file: path.relative(outputDir, file),
        };
  }
  if (dimension && dimension.startsWith('tdk')) {
    const r = checkTdk(html);
    return r.pass
      ? {
          status: 'fixed',
          before: beforeProblem?.description || '-',
          after: `title=${r.title_length}/desc=${r.description_length}(build 后达标)`,
          file: path.relative(outputDir, file),
        }
      : {
          status: 'still_failing',
          before: beforeProblem?.description || '-',
          after: r.problems[0]?.description || '仍不达标',
          file: path.relative(outputDir, file),
        };
  }
  if (dimension === 'static_render') {
    // 有 HTML 文件本身就是静态化通过(SSG 出了页面);进一步看是否有 h1 + 正文长度
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').trim();
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyText = (bodyMatch?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (h1 && bodyText.length > 500) {
      return {
        status: 'fixed',
        before: beforeProblem?.description || '内容差异',
        after: `静态 HTML 已含 h1 + ${bodyText.length} 字符正文`,
        file: path.relative(outputDir, file),
      };
    }
    return {
      status: 'still_failing',
      before: beforeProblem?.description || '内容差异',
      after: `build 产物 h1=${h1 ? '有' : '无'} / body=${bodyText.length} 字符,静态化仍未达标`,
      file: path.relative(outputDir, file),
    };
  }
  return {
    status: 'unverifiable',
    note: `dimension=${dimension} 没有 build-aware 校验逻辑`,
  };
}

function verifyTdk({ url, dimension, file, workDir, beforeProblem }) {
  if (!file) {
    return {
      status: 'unverifiable',
      before: beforeProblem?.description || '-',
      after: 'agent 未给出可定位的改动文件',
      note: 'agent output 未给出 file 路径,无法在 workDir 定位',
    };
  }
  const abs = path.isAbsolute(file) ? file : path.join(workDir, file);
  const tdk = extractTdkFromFile(abs);
  if (!tdk) {
    return {
      status: 'unverifiable',
      before: beforeProblem?.description || '-',
      after: `读不到 ${file}`,
      note: `读不到 ${file}`,
    };
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

export function verifyFixesInWorkDir({ workDir, agentOutput, problems, community, outputDir }) {
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
        after: '⏭ agent 跳过未改',
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
      if (r.status === 'still_failing') {
        console.log(`[post-fix-verify] sitemap still_failing: ${JSON.stringify(r, null, 2)}`);
      }
      checks.push({ url: p.url, dimension: p.dimension, ...r });
    } else if (p.dimension && p.dimension.startsWith('tdk')) {
      // build 产物存在时优先用 build 后 HTML(frontmatter 改了但是否真生效要看渲染)
      if (outputDir) {
        const r = verifyFromBuiltHtml({ url: p.url, dimension: p.dimension, outputDir, beforeProblem: p });
        console.log(`[post-fix-verify] verifyFromBuiltHtml1 still_failing: ${JSON.stringify(r, null, 2)}`);
        checks.push({ url: p.url, dimension: p.dimension, ...r });
      } else {
        const r = verifyTdk({
          url: p.url,
          dimension: p.dimension,
          file: agentRec?.file || null,
          workDir,
          beforeProblem: p,
        });
        console.log(`[post-fix-verify] verifyTdk still_failing: ${JSON.stringify(r, null, 2)}`);
        checks.push({ url: p.url, dimension: p.dimension, ...r });
      }
    } else if (p.dimension === 'schema' || p.dimension === 'static_render') {
      if (outputDir) {
        // 有 build 产物 → 真验
        const r = verifyFromBuiltHtml({ url: p.url, dimension: p.dimension, outputDir, beforeProblem: p });
        console.log(`[post-fix-verify] verifyFromBuiltHtml2 still_failing: ${JSON.stringify(r, null, 2)}`);
        checks.push({ url: p.url, dimension: p.dimension, ...r });
      } else {
        // 没 build(build_disabled / build 失败 / 仓没有 build 脚本)→ 延后到线上闭环
        checks.push({
          url: p.url,
          dimension: p.dimension,
          status: 'deferred',
          before: p.description,
          after: 'build 未跑,延后由 geo-poll 线上重验闭环',
          note: 'schema / static_render 必须看构建产物,本次未跑 build',
        });
      }
    } else {
      checks.push({
        url: p.url,
        dimension: p.dimension,
        status: 'unverifiable',
        before: p.description,
        after: `未知 dimension=${p.dimension},无验法`,
      });
    }
  }

  const summary = {
    total: checks.length,
    fixed: checks.filter((c) => c.status === 'fixed').length,
    still_failing: checks.filter((c) => c.status === 'still_failing').length,
    deferred: checks.filter((c) => c.status === 'deferred').length,
    unverifiable: checks.filter((c) => c.status === 'unverifiable').length,
  };
  // 仅在 fixed=0 && still_failing>0 时 block — 零进展 / 全错才拒推
  // 任何进展(fixed>=1)都允许推 PR,留下的 still_failing 让 reviewer + critic 看 verify 表自己决策
  const blocking = summary.fixed === 0 && summary.still_failing > 0;
  return { checks, summary, blocking };
}
