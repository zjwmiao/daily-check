#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { SUPPORTED_COMMUNITIES } from './lib/community-map.js';

const GEO_REPO = process.env.GEO_WORKFLOW_REPO || 'opensourceways/geo-workflow';
const GH_API = 'https://api.github.com';

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

function gh() {
  const token = process.env.GITHUB_TOKEN;
  return axios.create({
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'geo-develop-workflow',
    },
    timeout: 30000,
  });
}

async function fetchJsonFile(community, filename) {
  const res = await gh().get(`${GH_API}/repos/${GEO_REPO}/contents/assessments/${community}/${filename}`);
  const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

async function fetchQuestionsJson(community) {
  const data = await fetchJsonFile(community, 'questions.json');
  return data.questions || data;
}

async function fetchIssueMap(community) {
  const data = await fetchJsonFile(community, 'issue-map.json');
  return data.issues || data;
}

async function fetchIssue(issueNumber) {
  const res = await gh().get(`${GH_API}/repos/${GEO_REPO}/issues/${issueNumber}`);
  return res.data;
}

function extractQuestionIdsFromBody(body) {
  if (!body) return [];
  const ids = new Set();
  for (const m of body.matchAll(/`(q_\d+)`/g)) ids.add(m[1]);
  for (const m of body.matchAll(/- `?(q_\d+)`?/g)) ids.add(m[1]);
  return [...ids];
}

async function buildIssueForCommunity(community, targetIssueNumber) {
  const [questions, issueMap] = await Promise.all([
    fetchQuestionsJson(community),
    fetchIssueMap(community),
  ]);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const candidates = [];
  for (const [, mapEntry] of Object.entries(issueMap)) {
    if (mapEntry.severity !== 'P0') continue;
    if (targetIssueNumber && targetIssueNumber !== 'all' && String(mapEntry.issue_number) !== String(targetIssueNumber)) {
      continue;
    }
    const qs = (mapEntry.question_ids || [])
      .map((id) => questionById.get(id))
      .filter((q) => q && Array.isArray(q.official_urls) && q.official_urls.length > 0)
      .map((q) => ({
        id: q.id,
        question: q.question,
        official_urls: q.official_urls,
        notes: q.notes || '',
      }));
    if (qs.length === 0) continue;

    candidates.push({
      community,
      geo_issue_number: mapEntry.issue_number,
      geo_issue_url: mapEntry.issue_url,
      geo_issue_title: mapEntry.title_summary,
      severity: mapEntry.severity,
      status: mapEntry.status,
      citation_rate: mapEntry.citation_rate,
      questions: qs,
    });
  }

  if (targetIssueNumber && targetIssueNumber !== 'all' && candidates.length === 0) {
    try {
      const issue = await fetchIssue(targetIssueNumber);
      const qids = extractQuestionIdsFromBody(issue.body);
      const qs = qids
        .map((id) => questionById.get(id))
        .filter((q) => q && Array.isArray(q.official_urls) && q.official_urls.length > 0)
        .map((q) => ({
          id: q.id,
          question: q.question,
          official_urls: q.official_urls,
          notes: q.notes || '',
        }));
      if (qs.length > 0) {
        candidates.push({
          community,
          geo_issue_number: issue.number,
          geo_issue_url: issue.html_url,
          geo_issue_title: issue.title,
          severity: 'P0',
          status: 'fallback-extracted',
          questions: qs,
        });
      }
    } catch {
      // ignore: issue may belong to another community
    }
  }

  return candidates;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const communities = args.communities
    ? args.communities.split(',').map((s) => s.trim()).filter(Boolean)
    : SUPPORTED_COMMUNITIES;
  const issue = args.issue || 'all';

  const allIssues = [];
  for (const community of communities) {
    if (!SUPPORTED_COMMUNITIES.includes(community)) {
      console.error(`⚠ skip unsupported community: ${community}`);
      continue;
    }
    try {
      const found = await buildIssueForCommunity(community, issue);
      allIssues.push(...found);
    } catch (err) {
      console.error(`❌ ${community}: ${err.message}`);
    }
  }

  const result = {
    run_at: new Date().toISOString(),
    target: issue,
    communities,
    issue_count: allIssues.length,
    issues: allIssues,
  };

  const json = JSON.stringify(result, null, 2);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, json);
    console.error(`✅ Saved ${allIssues.length} issue(s): ${args.output}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
