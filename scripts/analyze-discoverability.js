#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fetchHttp } from './lib/html-fetch.js';
import { checkTdk } from './checks/tdk.js';
import { checkSchema } from './checks/schema.js';
import { checkStaticRender } from './checks/static-render.js';
import { checkSitemapInclusion } from './checks/sitemap-inclusion.js';
import { inferCommunityFromUrl, getCommunity } from './lib/community-map.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function flattenProblems(checks) {
  const all = [];
  for (const [dim, result] of Object.entries(checks)) {
    if (!result?.problems) continue;
    for (const p of result.problems) {
      all.push({ ...p, dimension: dim });
    }
  }
  return all;
}

// URL preflight — 在跑 4 维度之前先确认 URL 是"真活着"的
// 失败/疑似失败的 URL 直接标 url_unreachable,不进入维度判定,避免假问题污染下游
// 决策由 preflight 自己负责,4 维度只跑确认健康的 URL
function preflightUrl(requestedUrl, httpResult) {
  if (!httpResult) {
    return { ok: false, reason: 'no response', detail: null };
  }
  const status = httpResult.status;
  // fetchHttp 已经 validateStatus<400,这里再保险一次:status 200 是唯一接受
  if (status !== 200) {
    return {
      ok: false,
      reason: 'non-2xx',
      detail: `HTTP ${status}`,
    };
  }
  const body = (httpResult.html || '').trim();
  if (body.length < 200) {
    return {
      ok: false,
      reason: 'empty-body',
      detail: `body length ${body.length} 字符,疑似空响应`,
    };
  }
  // 重定向到根 / 完全不同路径 → 视为"原 URL 已不存在":比较请求 path 跟 final path 的首段
  try {
    const a = new URL(requestedUrl);
    const b = new URL(httpResult.finalUrl || requestedUrl);
    const reqPath = a.pathname.replace(/\/+$/, '');
    const finPath = b.pathname.replace(/\/+$/, '');
    // 只要请求路径非根,而最终路径是根("/"),就算被吞了
    if (reqPath && reqPath !== '/' && finPath === '') {
      return {
        ok: false,
        reason: 'redirected-to-root',
        detail: `${a.pathname} → ${b.pathname}`,
      };
    }
  } catch {
    /* malformed URL — let downstream 4 dims handle */
  }
  return { ok: true };
}

export async function analyzeUrl(url, { skipBrowser = false, communityHint } = {}) {
  const communityName = communityHint || inferCommunityFromUrl(url);
  const community = communityName ? getCommunity(communityName) : null;
  const sitemapUrl = community?.sitemap_url;

  let httpResult;
  try {
    httpResult = await fetchHttp(url);
  } catch (err) {
    return {
      url,
      community: communityName,
      ok: false,
      error: `fetch failed: ${err.message}`,
      problems: [{ category: 'fetch', description: err.message }],
    };
  }

  // P1: preflight — URL 异常(404 / 空响应 / 跳根)直接标 url_unreachable,不跑 4 维度。
  // 这一步是上游数据问题(official_urls 误填、页面下线、改路由),不算 analyzer "判错";
  // 但也不算"没问题",要传到下游标识本 URL 需人审/上游修正,而不是 fix
  const pre = preflightUrl(url, httpResult);
  if (!pre.ok) {
    return {
      url,
      final_url: httpResult.finalUrl,
      community: communityName,
      ok: true,
      preflight_failed: true,
      preflight_reason: pre.reason,
      preflight_detail: pre.detail,
      problems: [
        {
          category: `preflight.${pre.reason}`,
          dimension: 'preflight',
          description: `URL preflight 未通过: ${pre.detail || pre.reason} — 视为上游 official_urls 异常,不进入 fix payload`,
        },
      ],
      summary: { total: 0 },
      pass: false,
    };
  }

  const html = httpResult.html;
  const [staticResult, schemaResult, tdkResult, sitemapResult] = await Promise.all([
    checkStaticRender(url, { skipBrowser }),
    Promise.resolve(checkSchema(html)),
    Promise.resolve(checkTdk(html)),
    checkSitemapInclusion(url, sitemapUrl, communityName),
  ]);

  const checks = {
    static_render: staticResult,
    schema: schemaResult,
    tdk: tdkResult,
    sitemap_inclusion: sitemapResult,
  };
  const problems = flattenProblems(checks);

  return {
    url,
    final_url: httpResult.finalUrl,
    community: communityName,
    ok: true,
    checks,
    problems,
    summary: { total: problems.length },
    pass: problems.length === 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length === 0 || args.help) {
    console.log(`Usage: node scripts/analyze-discoverability.js <url> [--community=X] [--skip-browser] [--output=path]`);
    process.exit(args.help ? 0 : 1);
  }
  const result = await analyzeUrl(args._[0], {
    skipBrowser: !!args['skip-browser'],
    communityHint: args.community,
  });

  const json = JSON.stringify(result, null, 2);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, json);
    console.error(`✅ Saved: ${args.output}`);
  } else {
    console.log(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
