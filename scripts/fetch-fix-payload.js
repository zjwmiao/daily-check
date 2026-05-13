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

async function fetchAllComments(repo, issue) {
  const out = [];
  let page = 1;
  while (true) {
    const res = await gh().get(
      `https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  const issue = args.issue;
  if (!repo || !issue) {
    console.error('Usage: --repo=owner/repo --issue=N [--output=path]');
    process.exit(1);
  }

  const comments = await fetchAllComments(repo, issue);
  comments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let payload = null;
  let sourceCommentId = null;
  for (const c of comments) {
    const p = extractPayload(c.body);
    if (p) {
      payload = p;
      sourceCommentId = c.id;
      break;
    }
  }

  if (!payload) {
    console.error(`❌ no comment with marker "${PAYLOAD_MARKER}" found on ${repo}#${issue}`);
    process.exit(2);
  }

  const json = JSON.stringify(payload, null, 2);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, json);
    console.error(`✅ payload from comment ${sourceCommentId} (${payload.issues.length} issue(s)) → ${args.output}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
