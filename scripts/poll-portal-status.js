#!/usr/bin/env node

import axios from 'axios';
import {
  getPullRequest,
  listPullRequests,
  closePullRequest,
  addIssueComment,
} from './lib/atomgit-api.js';
import { COMMUNITY_MAP, SUPPORTED_COMMUNITIES } from './lib/community-map.js';
import { analyzeUrl } from './analyze-discoverability.js';
import { GEO_PROCESSED_MARKER, GEO_REVALIDATE_MARKER, GEO_PR_STATUS_MARKER } from './lib/geo-markers.js';
import { parseArgs, log } from './lib/utils.js';

const MIN_WAIT_AFTER_MERGE_MS = 30 * 60 * 1000;

async function retry(fn, { label, max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (!(!status || status >= 500 || status === 429) || i === max - 1) throw err;
      const delay = baseDelayMs * Math.pow(2, i);
      log(`⚠ ${label} 重试 ${i + 1}/${max} (${status || 'net'}): ${err.message.slice(0, 100)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function gh(token) {
  return axios.create({
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'geo-develop-workflow',
    },
    timeout: 30000,
  });
}

async function ghPaged(client, url, params = {}) {
  const out = [];
  let page = 1;
  while (true) {
    const res = await retry(() => client.get(url, { params: { ...params, per_page: 100, page } }), { label: `${url} p${page}` });
    out.push(...res.data);
    if (res.data.length < 100) break;
    page++;
  }
  return out;
}

function extractPortalPrUrls(comments) {
  const found = new Map();
  for (const c of comments) {
    const matches = (c.body || '').matchAll(/https:\/\/(?:atomgit|gitcode)\.com\/([^/\s)]+)\/([^/\s)]+)\/(?:pulls?|merge_requests)\/(\d+)/g);
    for (const m of matches) {
      const key = `${m[1]}/${m[2]}#${m[3]}`;
      if (!found.has(key)) found.set(key, { owner: m[1], repo: m[2], number: Number(m[3]), url: m[0] });
    }
  }
  return [...found.values()];
}

function extractUrlsFromBody(body) {
  const urls = [];
  const matches = (body || '').matchAll(/https:\/\/(www\.openeuler\.org|www\.openeuler\.openatom\.cn|openeuler\.org|openeuler\.openatom\.cn)[^\s)]+/g);
  for (const m of matches) {
    if (!urls.includes(m[0])) urls.push(m[0]);
  }
  return urls;
}

async function revalidate(urls, community) {
  log(`  🔁 重验 ${urls.length} URLs`);
  const stillFailing = [];
  for (const url of urls) {
    try {
      const fresh = await analyzeUrl(url, { skipBrowser: true, communityHint: community });
      if (!fresh.ok) {
        stillFailing.push({ url, why: `fetch failed: ${fresh.error}` });
        continue;
      }
      if (fresh.preflight_failed) {
        stillFailing.push({ url, preflight_failed: true, why: `preflight: ${fresh.preflight_reason}` });
        continue;
      }
      if ((fresh.problems || []).length > 0) {
        stillFailing.push({ url, remaining: fresh.problems });
      }
    } catch (err) {
      stillFailing.push({ url, why: `revalidate exception: ${err.message}` });
    }
  }
  const blockingFailures = stillFailing.filter(f => !f.preflight_failed);
  return { allCleared: blockingFailures.length === 0, stillFailing };
}

async function cleanupStalePrs(activeIssueNumbers) {
  const closedList = [];
  for (const community of SUPPORTED_COMMUNITIES) {
    const cfg = COMMUNITY_MAP[community];
    if (!cfg) continue;

    let openPrs;
    try {
      openPrs = await listPullRequests({ owner: cfg.portal_owner, repo: cfg.portal_repo, state: 'open' });
    } catch (err) {
      log(`  ⚠ list PRs in ${cfg.portal_owner}/${cfg.portal_repo}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(openPrs)) continue;

    const branchRe = new RegExp(`^geo/fix-${community.toLowerCase()}-\\d+$`);
    for (const pr of openPrs) {
      const ref = pr.head?.ref || '';
      const m = ref.match(branchRe);
      if (!m) continue;

      const issueNumMatch = ref.match(/-(\d+)$/);
      if (!issueNumMatch) continue;
      const issueNum = Number(issueNumMatch[1]);

      if (activeIssueNumbers.has(issueNum)) continue;

      log(`  🧹 stale PR ${cfg.portal_owner}/${cfg.portal_repo}#${pr.number} (branch=${ref}) → close`);
      try {
        await addIssueComment({
          owner: cfg.portal_owner,
          repo: cfg.portal_repo,
          issue_number: pr.number,
          body: [
            `🧹 本 PR 由 geo-develop-workflow 自动关闭`,
            ``,
            `**原因**: 对应的 [GEO] issue #${issueNum} 已不在 active 列表`,
            ``,
            `<!-- geo-stale-closed v1 issue=${issueNum} at=${new Date().toISOString()} -->`,
          ].join('\n'),
        });
        await closePullRequest({ owner: cfg.portal_owner, repo: cfg.portal_repo, number: pr.number });
        log(`    ✅ closed`);
        closedList.push({ community, portal: `${cfg.portal_owner}/${cfg.portal_repo}`, pr_number: pr.number, branch: ref, issue_number: issueNum });
      } catch (err) {
        log(`    ❌ close failed: ${err.message}`);
      }
    }
  }
  return closedList;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args['target-repo'];
  if (!repo) {
    console.error('Usage: --target-repo=owner/repo (本仓,用于存储tracker)');
    process.exit(1);
  }
  const tgtToken = process.env.GITHUB_TOKEN;
  if (!tgtToken) throw new Error('GITHUB_TOKEN not set');

  log(`▶ 扫描本仓 ${repo} 的 [GEO] tracker issues ...`);
  const allIssues = await ghPaged(gh(tgtToken), `https://api.github.com/repos/${repo}/issues`, { state: 'open' });
  const trackerIssues = allIssues.filter(i => !i.pull_request && /^\[GEO\]/.test(i.title));
  log(`  找到 ${trackerIssues.length} 个 open [GEO] tracker`);

  const errors = [];
  let closed = 0, noticed = 0;

  for (const issue of trackerIssues) {
    log(`\n— issue #${issue.number}: ${issue.title}`);

    const comments = await ghPaged(gh(tgtToken), `https://api.github.com/repos/${repo}/issues/${issue.number}/comments`);

    const alreadyPassed = comments.some(c => /geo-revalidated.*decision=pass/.test(c.body || ''));
    if (alreadyPassed) {
      log('  ⏭ 已有 pass 标记,跳过');
      continue;
    }

    const hasProcessed = comments.some(c => (c.body || '').includes(GEO_PROCESSED_MARKER));
    if (!hasProcessed) {
      log('  ⏭ 无处理标记,等待修复执行');
      continue;
    }

    const prs = extractPortalPrUrls(comments);
    if (prs.length === 0) {
      log('  ⏭ 无 portal PR 痕迹,等待修复');
      continue;
    }

    const prStatus = [];
    for (const p of prs) {
      try {
        const pr = await getPullRequest({ owner: p.owner, repo: p.repo, number: p.number });
        const merged = pr.merged === true || pr.merged === 'true' || !!pr.merged_at || pr.state === 'merged';
        const mergedAtMs = pr.merged_at ? new Date(pr.merged_at).getTime() : null;
        const closedNotMerged = !merged && pr.state === 'closed';
        prStatus.push({ ...p, pr, merged, mergedAtMs, closedNotMerged });
        log(`  PR ${p.owner}/${p.repo}#${p.number}: state=${pr.state} merged=${merged}`);
      } catch (err) {
        log(`  ⚠ getPullRequest ${p.owner}/${p.repo}#${p.number} 失败: ${err.message}`);
      }
    }

    if (prStatus.length === 0) continue;

    const closedNotMerged = prStatus.filter(p => p.closedNotMerged);
    if (closedNotMerged.length > 0) {
      const noted = comments.some(c => (c.body || '').includes(GEO_PR_STATUS_MARKER + ' closed-not-merged'));
      if (!noted) {
        const body = `⚠ 检测到 ${closedNotMerged.length} 个 portal PR 被关闭但未 merge:\n\n${closedNotMerged.map(p => `- ${p.url}`).join('\n')}\n\n<!-- ${GEO_PR_STATUS_MARKER} closed-not-merged -->`;
        await retry(() => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }), { label: 'comment closed-not-merged' });
        noticed++;
        log('  📣 通知:有 PR 未 merge 即关闭');
      }
      continue;
    }

    const allMerged = prStatus.every(p => p.merged);
    if (!allMerged) {
      log('  ⏭ 仍有 PR 未 merge');
      continue;
    }

    const newestMerge = Math.max(...prStatus.map(p => p.mergedAtMs || 0));
    const waitMs = MIN_WAIT_AFTER_MERGE_MS - (Date.now() - newestMerge);
    if (waitMs > 0) {
      log(`  ⏱ 最新 merge 仅 ${Math.round((Date.now() - newestMerge) / 60000)}min 前,等 ${Math.round(waitMs / 60000)}min`);
      continue;
    }

    const urls = extractUrlsFromBody(issue.body);
    const communityMatch = issue.title.match(/^\[GEO\]\s*(\w+)/);
    const community = communityMatch ? communityMatch[1] : 'openEuler';

    log(`  ✅ 所有 PR merged,开始重验 ${urls.length} URLs (community=${community})`);
    let result;
    try {
      result = await revalidate(urls, community);
    } catch (err) {
      errors.push({ issue: issue.number, error: `revalidate failed: ${err.message}` });
      log(`  ❌ 重验异常: ${err.message}`);
      continue;
    }

    if (result.allCleared) {
      log(`  🎉 重验通过,关闭 issue`);
      const body = `✅ **已验证关闭** — 所有 PR merge,重验通过。\n\n<!-- ${GEO_REVALIDATE_MARKER} decision=pass at=${new Date().toISOString()} -->`;
      await retry(() => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }), { label: 'comment pass' });
      await retry(() => gh(tgtToken).patch(`https://api.github.com/repos/${repo}/issues/${issue.number}`, { state: 'closed' }), { label: 'close issue' });
      closed++;
    } else {
      const stillN = result.stillFailing.length;
      log(`  ⚠ 重验仍有 ${stillN} 个 URL 不通过`);
      const detail = result.stillFailing.slice(0, 10).map(s => {
        if (s.remaining) return `- ${s.url}\n  - ${s.remaining.map(p => `[${p.dimension}] ${p.description}`).join('\n  - ')}`;
        return `- ${s.url}\n  - ${s.why}`;
      }).join('\n');
      const body = `⚠ **PR merge,但重验仍有 ${stillN} 个 URL 不通过**\n\n${detail}\n\n<!-- ${GEO_REVALIDATE_MARKER} decision=keep at=${new Date().toISOString()} -->`;
      await retry(() => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }), { label: 'comment keep' });
      noticed++;
    }
  }

  log(`\n▶ stale PR cleanup ...`);
  const activeIssueNumbers = new Set(trackerIssues.map(i => {
    const m = i.title.match(/\[GEO\].*#(\d+)/);
    return m ? Number(m[1]) : null;
  }).filter(n => n));

  let staleClosed = [];
  try {
    staleClosed = await cleanupStalePrs(activeIssueNumbers);
  } catch (err) {
    log(`  ❌ cleanup failed: ${err.message}`);
  }
  log(`  closed ${staleClosed.length} stale PR(s)`);

  log(`\n🏁 poll done: closed=${closed}, commented=${noticed}, errors=${errors.length}`);

  if (errors.length > 0) {
    throw new Error(`poll-portal-status 有 ${errors.length} 个失败`);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});