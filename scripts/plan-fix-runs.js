#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getCommunity } from './lib/community-map.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    console.error('Usage: --input=analysis.json --run-dir=... --output=fix-plan.json');
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const runDir = args['run-dir'] || '.';

  let portalIssueIndex = {};
  const portalPath = path.join(runDir, 'portal-issues.json');
  if (fs.existsSync(portalPath)) {
    const data = JSON.parse(fs.readFileSync(portalPath, 'utf-8'));
    for (const r of data.records || []) {
      portalIssueIndex[`${r.community}#${r.geo_issue_number}`] = {
        portal_issue_url: r.portal_issue_url,
        portal_issue_number: r.portal_issue_number,
      };
    }
  }

  const runs = [];
  for (const issue of analysis.issues) {
    const community = getCommunity(issue.community);
    if (!community) continue;

    const criticalProblems = [];
    for (const q of issue.questions) {
      for (const u of q.urls) {
        if (!u.ok) continue;
        for (const p of u.problems) {
          if (p.severity === 'critical' || p.severity === 'important') {
            criticalProblems.push({
              question_id: q.id,
              question_text: q.question,
              url: u.url,
              ...p,
            });
          }
        }
      }
    }

    if (criticalProblems.length === 0) {
      runs.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        skip: true,
        skip_reason: 'no critical/important problems',
      });
      continue;
    }

    const portalInfo = portalIssueIndex[`${issue.community}#${issue.geo_issue_number}`] || {};
    runs.push({
      community: issue.community,
      geo_issue_number: issue.geo_issue_number,
      geo_issue_url: issue.geo_issue_url,
      geo_issue_title: issue.geo_issue_title,
      portal_owner: community.portal_owner,
      portal_repo: community.portal_repo,
      portal_base_branch: community.portal_default_branch,
      branch_name: `geo/fix-${issue.community.toLowerCase()}-${issue.geo_issue_number}`,
      portal_issue_url: portalInfo.portal_issue_url || null,
      portal_issue_number: portalInfo.portal_issue_number || null,
      problems: criticalProblems,
      issue_payload: issue,
    });
  }

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ runs }, null, 2));
  console.error(`✅ planned ${runs.length} fix run(s)`);
}

main();
