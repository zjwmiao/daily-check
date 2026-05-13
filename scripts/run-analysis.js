#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { analyzeUrl } from './analyze-discoverability.js';

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
        process.stderr.write(`[${analyzed + 1}/${total}+] ${issue.community} #${issue.geo_issue_number} ${q.id} ${url}\n`);
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

  out.summary = {
    issue_count: out.issues.length,
    url_count: total,
    analyzed,
  };

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(out, null, 2));
  console.error(`✅ ${analyzed}/${total} URL(s) analyzed → ${args.output}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
