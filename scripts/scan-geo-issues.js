#!/usr/bin/env node

import { listPullRequests, listIssues, listIssueComments, listPullRequestComments, getPullRequest, getPullRequestComment } from './lib/atomgit-api.js';
import { COMMUNITY_MAP, inferCommunityFromRepoName } from './lib/community-map.js';
import { GEO_PROCESSED_MARKER, GEO_SKIP_NO_PROBLEMS, GEO_SKIP_NO_URLS } from './lib/geo-markers.js';
import { parseArgs, log } from './lib/utils.js';

function parseProblemIdsFromBody(body) {
  if (!body) return [];
  const match = body.match(/## 涉及问题\s*\n\|.+\|\s*\n\|.+\|\s*\n((?:\|.+\|\s*\n?)+)/);
  if (!match) {
    log('  ⚠ 未找到"## 涉及问题"表格');
    return [];
  }
  const rows = match[1].trim().split('\n').filter(r => r.includes('|'));
  const ids = rows.map(r => {
    const cells = r.split('|').map(c => c.trim()).filter(c => c);
    return cells[0];
  }).filter(id => id && id.startsWith('q_'));
  log(`  解析到 ${ids.length} 个问题ID: ${ids.join(', ')}`);
  return ids;
}

function inferCommunity(owner, repo, explicitCommunity) {
  if (explicitCommunity) {
    const cfg = COMMUNITY_MAP[explicitCommunity];
    if (cfg) return explicitCommunity;
    log(`⚠ 显式指定的 community="${explicitCommunity}" 不在支持列表,尝试自动推断`);
  }
  const inferred = inferCommunityFromRepoName(owner, repo);
  if (inferred) return inferred;
  throw new Error(`无法推断 community: owner=${owner}, repo=${repo}`);
}

async function hasProcessedMarker(owner, repo, issueNumber) {
  try {
    const comments = await listIssueComments({ owner, repo, issue_number: issueNumber });
    for (const c of comments) {
      const body = c.body || '';
      if (body.includes('GEO 自动修复失败')) return false;
      if (body.includes(GEO_PROCESSED_MARKER)) return true;
      if (body.includes(GEO_SKIP_NO_PROBLEMS)) return true;
      if (body.includes(GEO_SKIP_NO_URLS)) return true;
    }
  } catch (err) {
    log(`  ⚠ 获取issue评论失败: ${err.message}`);
  }
  return false;
}

async function checkPrRetestRequest(owner, repo, community, issueNumber) {
  const branchName = `geo/fix-${community.toLowerCase()}-${issueNumber}`;
  try {
    const prs = await listPullRequests({ owner, repo, head: branchName, state: 'open' });
    if (!prs || prs.length === 0) {
      return { hasPr: false };
    }

    const pr = prs[0];
    const prDetail = await getPullRequest({ owner, repo, number: pr.number });
    const prUpdatedAt = new Date(prDetail.updated_at).getTime();

    const comments = await listPullRequestComments({ owner, repo, pull_number: pr.number });
    const retestComments = comments.filter(c => (c.body || '').includes('/retest-geo'));

    if (retestComments.length === 0) {
      return { hasPr: true, needsRetest: false, prNumber: pr.number, prUrl: pr.html_url };
    }

    const sorted = retestComments
      .map(c => ({ id: c.id, created_at: c.created_at }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const lastComment = sorted[sorted.length - 1];

    const commentDetail = await getPullRequestComment({ owner, repo, comment_id: lastComment.id });
    const commentCreatedAt = new Date(commentDetail.created_at).getTime();

    if (prUpdatedAt > commentCreatedAt) {
      return {
        hasPr: true,
        needsRetest: false,
        skipBecausePrUpdated: true,
        prNumber: pr.number,
        prUrl: pr.html_url,
        reason: 'PR已在/retest-geo评论后更新',
      };
    } else {
      return {
        hasPr: true,
        needsRetest: true,
        prNumber: pr.number,
        prUrl: pr.html_url,
      };
    }
  } catch (err) {
    log(`  ⚠ 检查PR评论失败: ${err.message}`);
    return { hasPr: false };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  let owner, repo;
  if (args['repo-url']) {
    const parts = args['repo-url'].split('/');
    owner = parts[0];
    repo = parts[1];
  } else if (args.owner && args.repo) {
    owner = args.owner;
    repo = args.repo;
  } else {
    console.error('Usage: --owner=xxx --repo=xxx 或 --repo-url=owner/repo');
    console.error('可选: --community=xxx (覆盖自动推断)');
    process.exit(1);
  }

  if (!process.env.ATOMGIT_TOKEN) {
    console.error('❌ ATOMGIT_TOKEN 未设置');
    process.exit(1);
  }

  const community = inferCommunity(owner, repo, args.community);
  log(`▶ 扫描 AtomGit ${owner}/${repo} [GEO] issues (community=${community})`);

  const issues = await listIssues({ owner, repo, state: 'open' });
  const geoIssues = issues.filter(i => i.title && i.title.startsWith('[GEO]'));
  log(`  找到 ${geoIssues.length} 个 [GEO] issue`);

  const toProcess = [];
  const skipped = [];

  for (const issue of geoIssues) {
    const num = issue.number;
    log(`\n— issue #${num}: ${issue.title}`);

    const problemIds = parseProblemIdsFromBody(issue.body);
    if (problemIds.length === 0) {
      log(`  ⏭ 跳过: 未解析到问题ID`);
      skipped.push({ number: num, reason: '未解析到问题ID(表格格式错误或无问题)' });
      continue;
    }

    const hasMarker = await hasProcessedMarker(owner, repo, num);
    if (hasMarker) {
      log(`  ⏭ 跳过: 已有处理标记`);
      skipped.push({ number: num, reason: '已有处理标记' });
      continue;
    }

    const prCheck = await checkPrRetestRequest(owner, repo, community, num);
    if (prCheck.hasPr && !prCheck.needsRetest) {
      if (prCheck.skipBecausePrUpdated) {
        log(`  ⏭ 跳过: PR #${prCheck.prNumber} 已在/retest-geo评论后更新`);
      } else {
        log(`  ⏭ 跳过: 已有open PR #${prCheck.prNumber} (无/retest-geo请求)`);
      }
      skipped.push({
        number: num,
        reason: prCheck.reason || `已有open PR #${prCheck.prNumber}`,
        pr_url: prCheck.prUrl,
      });
      continue;
    }
    if (prCheck.hasPr && prCheck.needsRetest) {
      log(`  ♻️ PR #${prCheck.prNumber} 有/retest-geo请求且PR未更新,需要重新处理`);
    }

    toProcess.push({
      number: num,
      title: issue.title,
      url: issue.html_url || issue.url || `https://atomgit.com/${owner}/${repo}/issues/${num}`,
      body: issue.body,
      problem_ids: problemIds,
    });
    log(`  ✅ 待处理`);
  }

  const result = {
    run_at: new Date().toISOString(),
    portal: { owner, repo },
    community,
    issues: toProcess,
    skipped,
    summary: {
      total: geoIssues.length,
      to_process: toProcess.length,
      skipped: skipped.length,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  log(`\n🏁 完成: 待处理=${toProcess.length}, 跳过=${skipped.length}`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});