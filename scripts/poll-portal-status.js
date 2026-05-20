#!/usr/bin/env node
// Piece 2 + 3: 扫本仓 open [GEO优化] issue,查它评论里的 portal PR 状态:
//   - PR open  → skip
//   - PR closed without merge → 评论提醒
//   - PR merged 且距 merge >= 30min → 重验该 issue 的 URLs;通过则关闭 issue + 评论(本仓)+回评 geo-workflow

import fs from 'fs';
import axios from 'axios';
import {
  getPullRequest,
  listPullRequests,
  closePullRequest,
  addIssueComment,
} from './lib/atomgit-api.js';
import { COMMUNITY_MAP, SUPPORTED_COMMUNITIES } from './lib/community-map.js';
import { analyzeUrl } from './analyze-discoverability.js';
import { PAYLOAD_MARKER } from './generate-report.js';

const REVALIDATE_MARKER = 'geo-revalidated v1';
const PR_NOTE_MARKER = 'geo-pr-status v1';
const MIN_WAIT_AFTER_MERGE_MS = 30 * 60 * 1000;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

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
      await new Promise((r) => setTimeout(r, delay));
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

function extractPayloadFromComments(comments) {
  // 倒序找最新 marker 评论
  for (const c of [...comments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
    if (!c.body || !c.body.includes(PAYLOAD_MARKER)) continue;
    const m = c.body.match(/```json\s*([\s\S]*?)```/);
    if (!m) continue;
    try {
      return JSON.parse(m[1]);
    } catch {}
  }
  return null;
}

function extractPortalPrUrls(comments) {
  const found = new Map();
  for (const c of comments) {
    // atomgit/gitcode 两个域名 + UI 路径有 /pull/N、/pulls/N、/merge_requests/N 三种别名,都视为同一 PR
    const matches = (c.body || '').matchAll(/https:\/\/(?:atomgit|gitcode)\.com\/([^/\s)]+)\/([^/\s)]+)\/(?:pulls?|merge_requests)\/(\d+)/g);
    for (const m of matches) {
      const key = `${m[1]}/${m[2]}#${m[3]}`;
      if (!found.has(key)) found.set(key, { owner: m[1], repo: m[2], number: Number(m[3]), url: m[0] });
    }
  }
  return [...found.values()];
}

function extractGeoWorkflowIssue(issueBody) {
  const m = (issueBody || '').match(/github\.com\/([^/\s)]+\/[^/\s)]+)\/issues\/(\d+)/);
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}

async function revalidate(payload) {
  log(`  🔁 重验 payload(${payload.issues.length} issue, 共 ${countUrls(payload)} URL)`);
  const stillFailing = [];
  for (const issue of payload.issues || []) {
    for (const q of issue.questions || []) {
      for (const u of q.official_urls || []) {
        try {
          const fresh = await analyzeUrl(u.url, { skipBrowser: true, communityHint: issue.community });
          if (!fresh.ok) {
            stillFailing.push({ url: u.url, why: `fetch failed: ${fresh.error}` });
            continue;
          }
          // preflight 失败的 URL 现在算 "url 已失效",不阻断关闭;但单独记录
          if (fresh.preflight_failed) {
            stillFailing.push({
              url: u.url,
              preflight_failed: true,
              why: `preflight: ${fresh.preflight_reason} — ${fresh.preflight_detail || ''}`,
            });
            continue;
          }
          // analyzer 出的 problems 没有 severity 分级,有就算还没修完
          if ((fresh.problems || []).length > 0) {
            stillFailing.push({ url: u.url, remaining: fresh.problems });
          }
        } catch (err) {
          stillFailing.push({ url: u.url, why: `revalidate exception: ${err.message}` });
        }
      }
    }
  }
  // preflight 失败不应阻断闭环 — URL 已失效是上游数据状况,本仓修不了
  const blockingFailures = stillFailing.filter((f) => !f.preflight_failed);
  return { allCleared: blockingFailures.length === 0, stillFailing };
}

function countUrls(payload) {
  let n = 0;
  for (const i of payload.issues || []) for (const q of i.questions || []) n += (q.official_urls || []).length;
  return n;
}

// 从本仓所有 open [GEO优化] tracker issue 提取它们关联的 geo-workflow# set
// 用来判定 portal 仓 `geo/fix-{community}-{N}` open PR 是不是失效(stale)
function extractActiveGeoNums(trackerIssues) {
  const set = new Set();
  for (const issue of trackerIssues) {
    // tracker title 形如 `[GEO优化]#42` 或 `[GEO优化]#42: ...`,N 是 geo-workflow 编号
    const m = (issue.title || '').match(/\[GEO优化\]#?(\d+)/);
    if (m) set.add(Number(m[1]));
  }
  return set;
}

// 扫 portal 仓里所有 head=geo/fix-{community}-N 的 open PR;
// 如果 N 不在 active set(失效),close 它 + 评论说明
async function cleanupStalePrs(activeGeoNums) {
  const closedList = [];
  for (const community of SUPPORTED_COMMUNITIES) {
    const cfg = COMMUNITY_MAP[community];
    if (!cfg) continue;

    let openPrs;
    try {
      // listPullRequests 不传 head 就 list 所有 open
      openPrs = await listPullRequests({
        owner: cfg.portal_owner,
        repo: cfg.portal_repo,
        state: 'open',
      });
    } catch (err) {
      log(`  ⚠ list open PRs in ${cfg.portal_owner}/${cfg.portal_repo}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(openPrs)) continue;

    const branchRe = new RegExp(`^geo/fix-${community.toLowerCase()}-(\\d+)$`);
    for (const pr of openPrs) {
      const ref = pr.head?.ref || '';
      const m = ref.match(branchRe);
      if (!m) continue; // 不是我们建的 geo/fix-* 分支,跳
      const geoN = Number(m[1]);
      if (activeGeoNums.has(geoN)) continue; // 仍在 active tracker → 不动

      log(`  🧹 stale PR ${cfg.portal_owner}/${cfg.portal_repo}#${pr.number} (branch=${ref}, geo-workflow#${geoN} 已不在本仓 active tracker) → close`);
      try {
        // 先评论解释(关后 atomgit 仍可加评论,但放前面更稳)
        await addIssueComment({
          owner: cfg.portal_owner,
          repo: cfg.portal_repo,
          issue_number: pr.number,
          body: [
            `🧹 本 PR 由 \`geo-develop-workflow\` 自动关闭(housekeeping)`,
            ``,
            `**原因**: 对应的 geo-workflow #${geoN} 已不在 \`geo-develop-workflow\` 仓的 active tracker(可能 tracker issue 已关、或上游评估 target 已变更),本 PR 已无对应跟踪 issue。`,
            ``,
            `**重启方式**: 如仍需修复,在 \`geo-develop-workflow\` 仓新开 \`[GEO优化]#${geoN}\` issue 或评论 \`/analyze\`,我们会重新生成 fix payload。`,
            ``,
            `<!-- geo-stale-closed v1 geo-workflow=${geoN} at=${new Date().toISOString()} -->`,
          ].join('\n'),
        });
        await closePullRequest({
          owner: cfg.portal_owner,
          repo: cfg.portal_repo,
          number: pr.number,
        });
        log(`    ✅ closed`);
        closedList.push({
          community,
          portal: `${cfg.portal_owner}/${cfg.portal_repo}`,
          pr_number: pr.number,
          branch: ref,
          geo_workflow_number: geoN,
        });
      } catch (err) {
        log(`    ❌ close ${cfg.portal_owner}/${cfg.portal_repo}#${pr.number} failed: ${err.message}`);
      }
    }
  }
  return closedList;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args['target-repo'];
  if (!repo) {
    console.error('Usage: --target-repo=owner/repo');
    process.exit(1);
  }
  const tgtToken = process.env.GITHUB_TOKEN;
  const geoToken = process.env.GEO_GITHUB_TOKEN || tgtToken; // 回评 geo-workflow private repo
  if (!tgtToken) throw new Error('GITHUB_TOKEN not set');

  log(`▶ scan open [GEO优化] issues in ${repo} ...`);
  const allIssues = await ghPaged(gh(tgtToken), `https://api.github.com/repos/${repo}/issues`, { state: 'open' });
  const trackerIssues = allIssues.filter((i) => !i.pull_request && /^\[GEO优化\]/.test(i.title));
  log(`  found ${trackerIssues.length} open tracker issues`);

  const errors = [];
  let closed = 0, noticed = 0;
  for (const issue of trackerIssues) {
    log(`\n— issue #${issue.number}: ${issue.title}`);

    const comments = await ghPaged(gh(tgtToken), `https://api.github.com/repos/${repo}/issues/${issue.number}/comments`);

    // 已经验证关过 → 不会出现在 open 列表里;但保险:有 REVALIDATE_MARKER decision=pass 的评论 → skip
    const alreadyPassed = comments.some((c) => /geo-revalidated.*decision=pass/.test(c.body || ''));
    if (alreadyPassed) {
      log('  ⏭ 已有 pass 标记,跳过');
      continue;
    }

    const prs = extractPortalPrUrls(comments);
    if (prs.length === 0) {
      log('  ⏭ 无 portal PR 痕迹,等用户先 /analyze + /fix');
      continue;
    }

    // 查每个 PR 当前状态
    const prStatus = [];
    for (const p of prs) {
      try {
        const pr = await getPullRequest({ owner: p.owner, repo: p.repo, number: p.number });
        // atomgit 字段:state(open/closed/merged)/merged/merged_at
        const merged = pr.merged === true || pr.merged === 'true' || !!pr.merged_at || pr.state === 'merged';
        const mergedAtMs = pr.merged_at ? new Date(pr.merged_at).getTime() : null;
        const closedNotMerged = !merged && (pr.state === 'closed');
        prStatus.push({ ...p, pr, merged, mergedAtMs, closedNotMerged });
        log(`  PR ${p.owner}/${p.repo}#${p.number}: state=${pr.state} merged=${merged}`);
      } catch (err) {
        log(`  ⚠ getPullRequest ${p.owner}/${p.repo}#${p.number} 失败: ${err.message}`);
      }
    }

    if (prStatus.length === 0) continue;

    // 异常:有 PR closed-not-merged → 提醒,跳过本 issue
    const closedNotMerged = prStatus.filter((p) => p.closedNotMerged);
    if (closedNotMerged.length > 0) {
      const noted = comments.some((c) => (c.body || '').includes(PR_NOTE_MARKER + ' closed-not-merged'));
      if (!noted) {
        const body =
          `⚠ 检测到 ${closedNotMerged.length} 个 portal PR 被关闭但未 merge:\n\n` +
          closedNotMerged.map((p) => `- ${p.url}`).join('\n') +
          `\n\n<!-- ${PR_NOTE_MARKER} closed-not-merged -->`;
        await retry(
          () => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }),
          { label: 'comment closed-not-merged' }
        );
        noticed++;
        log('  📣 通知:有 PR 未 merge 即关闭');
      }
      continue;
    }

    // 全部 PR 都 merged 才进入重验路径
    const allMerged = prStatus.every((p) => p.merged);
    if (!allMerged) {
      log('  ⏭ 仍有 PR 未 merge,等下次 tick');
      continue;
    }

    const newestMerge = Math.max(...prStatus.map((p) => p.mergedAtMs || 0));
    const waitMs = MIN_WAIT_AFTER_MERGE_MS - (Date.now() - newestMerge);
    if (waitMs > 0) {
      log(`  ⏱ 最新 merge 仅 ${Math.round((Date.now() - newestMerge) / 60000)}min 前,等 ${Math.round(waitMs / 60000)}min 后再验`);
      continue;
    }

    // 找最新 fix-payload(/analyze 评论)
    const payload = extractPayloadFromComments(comments);
    if (!payload) {
      log('  ⚠ 找不到 fix-payload,无法重验');
      const noted = comments.some((c) => (c.body || '').includes(PR_NOTE_MARKER + ' no-payload'));
      if (!noted) {
        await retry(
          () =>
            gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, {
              body: `⚠ PR 已全部 merge,但 issue 内找不到 \`${PAYLOAD_MARKER}\` 评论,无法自动重验。请重新 \`/analyze\` 或手工 close。\n\n<!-- ${PR_NOTE_MARKER} no-payload -->`,
            }),
          { label: 'comment no-payload' }
        );
      }
      continue;
    }

    log('  ✅ 所有 PR 均 merged + 已过 30min 冷却,开始重验');
    let result;
    try {
      result = await revalidate(payload);
    } catch (err) {
      errors.push({ issue: issue.number, error: `revalidate failed: ${err.message}` });
      log(`  ❌ 重验异常: ${err.message}`);
      continue;
    }

    if (result.allCleared) {
      // 关闭 issue + 评论
      log(`  🎉 重验通过,关闭 issue`);
      const body =
        `✅ **已验证关闭** — 所有 PR 均已 merge,4 维度重验通过(0 problems)。\n\n` +
        `<!-- ${REVALIDATE_MARKER} pr-count=${prStatus.length} decision=pass at=${new Date().toISOString()} -->`;
      await retry(
        () => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }),
        { label: 'comment pass' }
      );
      await retry(
        () =>
          gh(tgtToken).patch(`https://api.github.com/repos/${repo}/issues/${issue.number}`, { state: 'closed' }),
        { label: 'close issue' }
      );
      closed++;

      // 回评 geo-workflow 原 issue(如果能从 issue body 解析到)
      const origin = extractGeoWorkflowIssue(issue.body);
      if (origin) {
        try {
          await retry(
            () =>
              gh(geoToken).post(`https://api.github.com/repos/${origin.repo}/issues/${origin.number}/comments`, {
                body: `🛠 geo-develop-workflow 已自动闭环修复并通过线上验证。详见 ${issue.html_url}`,
              }),
            { label: 'cross-comment geo-workflow' }
          );
          log(`  📣 已回评 ${origin.repo}#${origin.number}`);
        } catch (err) {
          log(`  ⚠ 回评 ${origin.repo}#${origin.number} 失败: ${err.message}`);
        }
      }
    } else {
      const stillN = result.stillFailing.length;
      log(`  ⚠ 重验仍有 ${stillN} 个 URL 不通过`);
      const detail = result.stillFailing
        .slice(0, 10)
        .map((s) => {
          if (s.remaining) {
            return `- ${s.url}\n  - ${s.remaining.map((p) => `[${p.dimension || p.category}] ${p.description}`).join('\n  - ')}`;
          }
          return `- ${s.url}\n  - ${s.why}`;
        })
        .join('\n');
      const body =
        `⚠ **PR 已 merge,但线上重验仍有 ${stillN} 个 URL 不通过**\n\n${detail}\n\n` +
        `${stillN > 10 ? `(还有 ${stillN - 10} 条未列)\n\n` : ''}` +
        `不会自动关闭。可选:\n- 评论 \`/fix\` 再跑一次;\n- 或手工排查后 close。\n\n` +
        `<!-- ${REVALIDATE_MARKER} pr-count=${prStatus.length} decision=keep at=${new Date().toISOString()} -->`;
      await retry(
        () => gh(tgtToken).post(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, { body }),
        { label: 'comment keep' }
      );
      noticed++;
    }
  }

  log(`\n🏁 poll done: closed=${closed}, commented=${noticed}, errors=${errors.length}`);

  // Housekeeping: portal 仓里跑过 /fix 但已没对应 active tracker 的失效 PR,自动关
  // 比如 tracker 的 title 改了 geo-workflow# / tracker 被关了 / 上游评估 target 改了
  log(`\n▶ stale PR cleanup ...`);
  // 用更宽的 active 集合:open + 最近关闭的(避免刚关的 tracker 来不及反应就被误判失效)
  // 简单起见:只用 open tracker,如有刚关的 case 后面再扩
  const activeGeoNums = extractActiveGeoNums(trackerIssues);
  log(`  active geo-workflow numbers from open trackers: ${[...activeGeoNums].sort((a, b) => a - b).join(', ') || '(无)'}`);
  let staleClosed = [];
  try {
    staleClosed = await cleanupStalePrs(activeGeoNums);
  } catch (err) {
    log(`  ❌ cleanup stale PRs failed: ${err.message}`);
  }
  log(`  closed ${staleClosed.length} stale PR(s)`);

  if (errors.length > 0) {
    throw new Error(`poll-portal-status 有 ${errors.length} 个 issue 处理失败`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
