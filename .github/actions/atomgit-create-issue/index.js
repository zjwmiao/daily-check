#!/usr/bin/env node

const BASE = process.env.ATOMGIT_API_BASE || 'https://api.atomgit.com';

async function main() {
  const owner = process.env.INPUT_OWNER;
  const repo = process.env.INPUT_REPO;
  const title = process.env.INPUT_TITLE;
  const body = process.env.INPUT_BODY || '';
  const labels = (process.env.INPUT_LABELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const token = process.env.ATOMGIT_TOKEN;

  if (!owner || !repo || !title) {
    throw new Error('owner/repo/title are required');
  }
  if (!token) {
    throw new Error('ATOMGIT_TOKEN not set');
  }

  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'geo-develop-workflow',
    },
    body: JSON.stringify({ title, body, labels }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  const issueUrl = data.html_url || data.url || `${BASE}/repos/${owner}/${repo}/issues/${data.number}`;
  const issueNumber = data.number;

  const fs = await import('node:fs');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `issue_url=${issueUrl}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `issue_number=${issueNumber}\n`);
  }
  console.log(`✅ Created issue: ${issueUrl}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
