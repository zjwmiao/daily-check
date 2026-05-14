#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { analyzeUrl } from './analyze-discoverability.js';
import { isOfficialHost } from './lib/community-map.js';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    console.error('Usage: node scripts/run-analysis.js --input=candidates.json --output=analysis.json [--skip-browser]');
    process.exit(1);
  }
  const skipBrowser = !!args['skip-browser'];

  const candidates = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const out = {
    run_at: new Date().toISOString(),
    source: path.basename(args.input),
    skip_browser: skipBrowser,
    issues: [],
    ...(candidates.note ? { upstream_note: candidates.note } : {}),
  };

  let total = 0;
  let analyzed = 0;
  for (const issue of candidates.issues) {
    const issueOut = {
      ...issue,
      questions: [],
    };
    for (const q of issue.questions) {
      const qOut = {
        id: q.id,
        question: q.question,
        notes: q.notes,
        urls: [],
      };
      for (const url of q.official_urls) {
        total++;
        if (!isOfficialHost(issue.community, url)) {
          process.stderr.write(`[${analyzed}/${total}] ⏭ scope-skip(非官网): ${issue.community} ${url}\n`);
          qOut.urls.push({
            url,
            ok: true,
            scope_skipped: true,
            scope_skipped_reason: 'non-official host (e.g. forum/discuss/news)',
            checks: {},
            problems: [],
            summary: { total: 0, critical: 0, important: 0, minor: 0 },
            pass: true,
          });
          continue;
        }
        process.stderr.write(`[${analyzed + 1}/${total}] ${issue.community} #${issue.geo_issue_number} ${q.id} ${url}\n`);
        try {
          const analysis = await analyzeUrl(url, { skipBrowser, communityHint: issue.community });
          qOut.urls.push(analysis);
          analyzed++;
        } catch (err) {
          qOut.urls.push({ url, ok: false, error: err.message });
        }
      }
      issueOut.questions.push(qOut);
    }
    out.issues.push(issueOut);
  }

  // 统计错误(scope_skipped 不算错)
  const errored = [];
  for (const issue of out.issues) {
    for (const q of issue.questions) {
      for (const u of q.urls) {
        if (!u.ok && !u.scope_skipped) {
          errored.push({ community: issue.community, geo_issue: issue.geo_issue_number, q: q.id, url: u.url, error: u.error });
        }
      }
    }
  }

  out.summary = {
    issue_count: out.issues.length,
    url_count: total,
    analyzed,
    errored: errored.length,
  };

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(out, null, 2));
  console.error(`✅ ${analyzed}/${total} URL(s) analyzed (${errored.length} errored) → ${args.output}`);

  // strict: 任一 URL 抓取/分析失败 → 让 workflow step 失败
  if (errored.length > 0) {
    const summary = errored.slice(0, 5).map((e) => `${e.community}#${e.geo_issue}/${e.q} ${e.url}: ${e.error}`).join('\n');
    throw new Error(
      `run-analysis 有 ${errored.length} 个 URL 失败(已写入 analysis.json,继续看上下文需打开制品):\n${summary}${errored.length > 5 ? `\n... 还有 ${errored.length - 5} 条` : ''}`
    );
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
