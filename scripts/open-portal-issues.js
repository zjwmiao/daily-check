#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getCommunity } from './lib/community-map.js';
import { createIssue, updateIssue, findIssueByTitlePrefix } from './lib/atomgit-api.js';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

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

const SEV = { critical: '🔴', important: '🟡', minor: '⚪' };

function buildBody(issue, triggerRepo, triggerIssue, runDir) {
  const lines = [
    `## 来源`,
    '',
    `- geo-workflow 原始 issue: ${issue.geo_issue_url}`,
    `- geo-develop 触发 issue: https://github.com/${triggerRepo}/issues/${triggerIssue}`,
    `- 严重度: **${issue.severity}** · 状态: ${issue.status || '-'}`,
    `- 分析制品: \`${runDir}/\` (analysis.json + report.md)`,
    '',
    `## 涉及问题与 URL`,
    '',
  ];

  for (const q of issue.questions) {
    lines.push(`### ${q.id} — ${q.question}`);
    lines.push('');
    for (const u of q.urls) {
      if (!u.ok) {
        lines.push(`- ❌ ${u.url} — ${u.error}`);
        continue;
      }
      const summary = `🔴 ${u.summary.critical} / 🟡 ${u.summary.important} / ⚪ ${u.summary.minor}`;
      lines.push(`- ${u.pass ? '✅' : '❌'} ${u.url}  _(${summary})_`);
      for (const p of u.problems) {
        if (p.severity === 'critical' || p.severity === 'important') {
          lines.push(`  - ${SEV[p.severity]} **${p.dimension}**: ${p.description}`);
        }
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> 该 Issue 由 geo-develop 自动化分析生成,后续修复 PR 将关联到本 Issue。');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args['trigger-repo'] || !args['trigger-issue']) {
    console.error('Usage: --input=analysis.json --trigger-repo=owner/repo --trigger-issue=N --run-dir=... --output=...');
    process.exit(1);
  }
  const dryRun = !!args['dry-run'] || !process.env.ATOMGIT_TOKEN;

  const analysis = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const triggerRepo = args['trigger-repo'];
  const triggerIssue = args['trigger-issue'];
  const runDir = args['run-dir'] || '(unknown)';

  const records = [];
  for (const issue of analysis.issues) {
    const community = getCommunity(issue.community);
    if (!community) {
      console.error(`⚠ skip unsupported community: ${issue.community}`);
      continue;
    }
    // 题头前缀唯一标识(community + 原 issue 号),用于去重
    const titlePrefix = `[GEO] ${issue.community} #${issue.geo_issue_number}:`;
    const title = `${titlePrefix} ${issue.geo_issue_title}`;
    const body = buildBody(issue, triggerRepo, triggerIssue, runDir);

    if (dryRun) {
      log(`[dry-run] would create/update on ${community.portal_owner}/${community.portal_repo}: ${title}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        portal_owner: community.portal_owner,
        portal_repo: community.portal_repo,
        dry_run: true,
        title,
      });
      continue;
    }

    try {
      log(`🔍 find existing issue by prefix: "${titlePrefix}" on ${community.portal_owner}/${community.portal_repo}`);
      const existing = await findIssueByTitlePrefix({
        owner: community.portal_owner,
        repo: community.portal_repo,
        prefix: titlePrefix,
      });

      let result, action;
      if (existing) {
        log(`♻️  found existing #${existing.number}, updating body`);
        result = await updateIssue({
          owner: community.portal_owner,
          repo: community.portal_repo,
          issue_number: existing.number,
          title,
          body,
        });
        action = 'updated';
        if (!result) result = existing;
      } else {
        log(`✨ no existing issue, creating new`);
        result = await createIssue({
          owner: community.portal_owner,
          repo: community.portal_repo,
          title,
          body,
          labels: ['geo-improvement'],
        });
        action = 'created';
      }
      const url =
        result.html_url ||
        result.url ||
        `https://atomgit.com/${community.portal_owner}/${community.portal_repo}/issues/${result.number}`;
      log(`✅ portal issue ${action}: ${url}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        portal_owner: community.portal_owner,
        portal_repo: community.portal_repo,
        portal_issue_url: url,
        portal_issue_number: result.number,
        action,
      });
    } catch (err) {
      log(`❌ ${issue.community} #${issue.geo_issue_number}: ${err.message}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        error: err.message,
      });
    }
  }

  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify({ run_at: new Date().toISOString(), records }, null, 2));
    console.error(`✅ Saved portal-issues record: ${args.output}`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
