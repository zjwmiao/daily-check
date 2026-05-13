#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { PAYLOAD_MARKER } from './generate-report.js';

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

function gh() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  return axios.create({
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'geo-develop-workflow',
    },
    timeout: 30000,
  });
}

async function retry(fn, { label, max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || i === max - 1) throw err;
      const delay = baseDelayMs * Math.pow(2, i);
      log(`⚠ ${label} 重试(${i + 1}/${max}, ${status || 'network'}): ${err.message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function fetchAllComments(repo, issue) {
  const out = [];
  let page = 1;
  while (true) {
    const res = await retry(
      () => gh().get(`https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`),
      { label: `comments page ${page}` }
    );
    out.push(...res.data);
    if (res.data.length < 100) break;
    page++;
  }
  return out;
}

function extractPayload(body) {
  if (!body || !body.includes(PAYLOAD_MARKER)) return null;
  const m = body.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  const issue = args.issue;
  if (!repo || !issue) {
    console.error('Usage: --repo=owner/repo --issue=N [--output=path]');
    process.exit(1);
  }

  log(`▶️  fetching comments from ${repo}#${issue}`);
  const t0 = Date.now();
  const comments = await fetchAllComments(repo, issue);
  log(`📥 ${comments.length} comment(s) fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let payload = null;
  let sourceCommentId = null;
  let sourceCreatedAt = null;
  for (const c of comments) {
    const p = extractPayload(c.body);
    if (p) {
      payload = p;
      sourceCommentId = c.id;
      sourceCreatedAt = c.created_at;
      break;
    }
  }

  if (!payload) {
    log(`❌ no comment with marker "${PAYLOAD_MARKER}" found — 请先 /analyze 生成 payload 评论`);
    process.exit(2);
  }

  const issuesCount = (payload.issues || []).length;
  const urlsCount = (payload.issues || []).reduce(
    (s, i) => s + (i.questions || []).reduce((q, x) => q + (x.official_urls || []).length, 0),
    0
  );
  log(`✅ payload from comment ${sourceCommentId} (${sourceCreatedAt}): ${issuesCount} issue(s), ${urlsCount} URL(s)`);

  const json = JSON.stringify(payload, null, 2);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, json);
    log(`📝 saved to ${args.output} (${json.length} bytes)`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
