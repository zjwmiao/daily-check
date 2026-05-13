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
      problems: [{ category: 'fetch', severity: 'critical', description: err.message }],
    };
  }

  const html = httpResult.html;
  const [staticResult, schemaResult, tdkResult, sitemapResult] = await Promise.all([
    checkStaticRender(url, { skipBrowser }),
    Promise.resolve(checkSchema(html)),
    Promise.resolve(checkTdk(html)),
    checkSitemapInclusion(url, sitemapUrl),
  ]);

  const checks = {
    static_render: staticResult,
    schema: schemaResult,
    tdk: tdkResult,
    sitemap_inclusion: sitemapResult,
  };
  const problems = flattenProblems(checks);
  const criticals = problems.filter((p) => p.severity === 'critical').length;

  return {
    url,
    final_url: httpResult.finalUrl,
    community: communityName,
    ok: true,
    checks,
    problems,
    summary: {
      total: problems.length,
      critical: criticals,
      important: problems.filter((p) => p.severity === 'important').length,
      minor: problems.filter((p) => p.severity === 'minor').length,
    },
    pass: criticals === 0,
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
