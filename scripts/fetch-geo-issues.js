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

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
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

async function retry(fn, { label, max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || i === max - 1) {
        log(`❌ ${label} 终止(尝试 ${i + 1}/${max}, status=${status || 'network'}): ${err.message}`);
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, i);
      log(`⚠ ${label} 重试(${i + 1}/${max} 失败 ${status || 'network'}, ${delay}ms 后再试): ${err.message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function fetchJsonFile(community, filename) {
  return retry(
    async () => {
      const res = await gh().get(`${GH_API}/repos/${GEO_REPO}/contents/assessments/${community}/${filename}`);
      const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
      return JSON.parse(content);
    },
    { label: `fetch ${community}/${filename}` }
  );
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
  return retry(
    async () => {
      const res = await gh().get(`${GH_API}/repos/${GEO_REPO}/issues/${issueNumber}`);
      return res.data;
    },
    { label: `fetch issue #${issueNumber}` }
  );
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
      // issue-map.json 偶尔缺 issue_url 字段 → 用 GEO_REPO + 编号兜底构造,避免下游渲染成死链
      geo_issue_url: mapEntry.issue_url || `https://github.com/${GEO_REPO}/issues/${mapEntry.issue_number}`,
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
      const titleCommunityMatch = issue.title.match(/^\[([^\]]+)\]/);
      if (titleCommunityMatch && titleCommunityMatch[1] !== community) {
        return candidates;
      }
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
  const errors = [];
  for (const community of communities) {
    if (!SUPPORTED_COMMUNITIES.includes(community)) {
      log(`⚠ skip unsupported community: ${community}`);
      continue;
    }
    try {
      log(`▶ scanning ${community}...`);
      const found = await buildIssueForCommunity(community, issue);
      log(`  found ${found.length} P0 issue(s) in ${community}`);
      allIssues.push(...found);
    } catch (err) {
      errors.push({ community, error: err.message });
      log(`❌ ${community} 拉取失败: ${err.message}`);
    }
  }

  // 失败的硬条件:任一 community 报错(网络/权限/解析问题)→ 整个步骤失败,让 workflow 走 if:failure 分支
  if (errors.length > 0) {
    throw new Error(
      `fetch-geo-issues 失败: ${errors.length}/${communities.length} community 报错 — ${errors
        .map((e) => `${e.community}: ${e.error}`)
        .join('; ')}`
    );
  }

  // target 指定但 0 候选 → 上游数据问题(issue 不存在 / 非 P0 / 关联 question 全无 official_urls)
  // 不当成 workflow 错误,写一个 note 进 candidates.json,让下游 generate-report 在 trigger issue 上正常回评说明
  let note = null;
  if (issue !== 'all' && allIssues.length === 0) {
    note = `geo-workflow issue #${issue} 未在 community(${communities.join(
      ', '
    )})的 issue-map / 关联问题中找到可分析的 official_urls — 属上游数据状况,不算分析失败(可能:issue 非 P0,或关联 question 都无 official_urls)`;
    log(`ℹ ${note}`);
  }

  const result = {
    run_at: new Date().toISOString(),
    target: issue,
    communities,
    issue_count: allIssues.length,
    issues: allIssues,
    ...(note ? { note } : {}),
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
