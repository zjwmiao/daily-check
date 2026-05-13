#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.ATOMGIT_API_BASE || 'https://api.atomgit.com';
const API_PREFIX = '/api/v5';

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', ...opts }).trim();
}

async function api(method, path, body) {
  const token = process.env.ATOMGIT_TOKEN;
  if (!token) throw new Error('ATOMGIT_TOKEN not set');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'geo-develop-workflow',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const owner = process.env.INPUT_OWNER;
  const repo = process.env.INPUT_REPO;
  const branch = process.env.INPUT_BRANCH;
  const base = process.env.INPUT_BASE || 'master';
  const title = process.env.INPUT_TITLE;
  const body = process.env.INPUT_BODY || '';
  const workDir = process.env.INPUT_WORK_DIR || process.cwd();
  const commitMsg = process.env.INPUT_COMMIT_MESSAGE || title;
  const gitUserName = process.env.INPUT_GIT_USER_NAME || 'geo-develop-bot';
  const gitUserEmail = process.env.INPUT_GIT_USER_EMAIL || 'geo-develop-bot@noreply.local';

  if (!owner || !repo || !branch || !title) {
    throw new Error('owner/repo/branch/title required');
  }

  process.chdir(workDir);

  const status = sh('git status --porcelain');
  if (!status) {
    console.log('⚠️ no changes; skip PR');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=false\n`);
    }
    return;
  }

  sh(`git config user.name "${gitUserName}"`);
  sh(`git config user.email "${gitUserEmail}"`);
  try {
    sh(`git checkout -b ${branch}`);
  } catch {
    sh(`git checkout ${branch}`);
  }
  sh('git add -A');
  sh(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

  const remoteUrl = `https://oauth2:${process.env.ATOMGIT_TOKEN}@atomgit.com/${owner}/${repo}.git`;
  sh(`git remote set-url origin ${remoteUrl}`).catch?.(() => {});
  try {
    sh(`git remote set-url origin ${remoteUrl}`);
  } catch {
    sh(`git remote add origin ${remoteUrl}`);
  }
  sh(`git push -f origin ${branch}`);

  const existing = await api('GET', `${API_PREFIX}/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`);
  let pr;
  if (Array.isArray(existing) && existing.length > 0) {
    pr = existing[0];
    console.log(`ℹ️ PR exists: ${pr.html_url || pr.url}`);
  } else {
    pr = await api('POST', `${API_PREFIX}/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      head: branch,
      base,
    });
    console.log(`✅ PR created: ${pr.html_url || pr.url}`);
  }

  const prUrl = pr.html_url || pr.url || `https://atomgit.com/${owner}/${repo}/pulls/${pr.number}`;
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `pr_url=${prUrl}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `pr_number=${pr.number}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=true\n`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
