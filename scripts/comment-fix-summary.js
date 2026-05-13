#!/usr/bin/env node

import fs from 'fs';
import axios from 'axios';

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

async function commentOnGithub(repo, issueNumber, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  await axios.post(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
    { body },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'geo-develop-workflow',
      },
      timeout: 30000,
    }
  );
}

function buildTriggerComment(results) {
  const lines = [
    `## 🛠 修复结果`,
    '',
    `| Community | geo issue | 状态 | PR |`,
    `| --- | --- | --- | --- |`,
  ];
  for (const r of results) {
    const pr = r.pr_url ? `[${r.pr_number}](${r.pr_url})` : '-';
    lines.push(`| ${r.community} | #${r.geo_issue_number} | \`${r.status}\`${r.error ? ` (${r.error.slice(0, 80)})` : ''} | ${pr} |`);
  }
  lines.push('');
  lines.push('详细 agent 输出见 `geo-runs/{issue}/fix-results.json`');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.results || !args['trigger-repo'] || !args['trigger-issue']) {
    console.error('Usage: --results=fix-results.json --trigger-repo=owner/repo --trigger-issue=N');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(args.results, 'utf-8'));
  const results = data.results || [];

  await commentOnGithub(args['trigger-repo'], args['trigger-issue'], buildTriggerComment(results));

  for (const r of results) {
    if (!r.pr_url) continue;
    if (!r.geo_issue_url) continue;
    const m = r.geo_issue_url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    if (!m) continue;
    const repo = m[1];
    const num = m[2];
    try {
      await commentOnGithub(
        repo,
        num,
        `🛠 portal 仓 PR 已创建,关联本 issue:\n\n${r.pr_url}\n\n(由 geo-develop 自动化生成,触发 issue: https://github.com/${args['trigger-repo']}/issues/${args['trigger-issue']})`
      );
    } catch (err) {
      console.error(`⚠ comment to ${repo}#${num} failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
