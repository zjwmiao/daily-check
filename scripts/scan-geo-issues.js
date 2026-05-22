#!/usr/bin/env node

import { listPullRequests, listIssues, listIssueComments, listPullRequestComments, getPullRequest } from './lib/atomgit-api.js';
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

async function checkIssueSkipStatus(owner, repo, community, issueNumber) {
  try {
    const comments = await listIssueComments({ owner, repo, issue_number: issueNumber });
    
    let markerType = null;
    for (const c of comments) {
      const body = c.body || '';
      if (body.includes('GEO 自动修复失败')) {
        return { shouldSkip: false, reason: '上次处理失败', needReprocess: true };
      }
      if (body.includes(GEO_SKIP_NO_PROBLEMS)) {
        markerType = 'skip_no_problems';
        break;
      }
      if (body.includes(GEO_SKIP_NO_URLS)) {
        markerType = 'skip_no_urls';
        break;
      }
      if (body.includes(GEO_PROCESSED_MARKER)) {
        markerType = 'processed';
        break;
      }
    }
    
    if (markerType === 'skip_no_problems' || markerType === 'skip_no_urls') {
      return { 
        shouldSkip: true, 
        reason: markerType === 'skip_no_problems' ? '无匹配问题(已跳过)' : '未涉及官网页面(已跳过)' 
      };
    }
    
    const branchName = `geo/fix-${community.toLowerCase()}-${issueNumber}`;
    const prs = await listPullRequests({ owner, repo, head: branchName, state: 'open' });
    
    if (!prs || prs.length === 0) {
      if (markerType === 'processed') {
        return { shouldSkip: false, reason: '有处理标记但无PR', needReprocess: true };
      }
      return { shouldSkip: false };
    }
    
    const pr = prs[0];
    const prComments = await listPullRequestComments({ owner, repo, pull_number: pr.number });
    const hasRetestRequest = prComments.some(c => (c.body || '').includes('/retest-geo'));
    
    if (!hasRetestRequest) {
      return {
        shouldSkip: true,
        reason: markerType ? '有处理标记且PR无/retest-geo请求' : '已有PR无/retest-geo请求',
        prNumber: pr.number,
        prUrl: pr.html_url,
      };
    }
    
    const prDetail = await getPullRequest({ owner, repo, number: pr.number });
    const prUpdatedAt = new Date(prDetail.updated_at).getTime();
    
    const retestComments = prComments
      .filter(c => (c.body || '').includes('/retest-geo'))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const lastRetest = retestComments[retestComments.length - 1];
    const commentCreatedAt = new Date(lastRetest.created_at).getTime();
    
    if (prUpdatedAt > commentCreatedAt) {
      return {
        shouldSkip: true,
        reason: 'PR已在/retest-geo评论后更新',
        prNumber: pr.number,
        prUrl: pr.html_url,
      };
    }
    
    return {
      shouldSkip: false,
      reason: 'PR有/retest-geo且未更新',
      needReprocess: true,
      prNumber: pr.number,
      prUrl: pr.html_url,
    };
  } catch (err) {
    log(`  ⚠ 检查issue状态失败: ${err.message}`);
    return { shouldSkip: false };
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

    const status = await checkIssueSkipStatus(owner, repo, community, num);
    if (status.shouldSkip) {
      log(`  ⏭ 跳过: ${status.reason}`);
      skipped.push({ number: num, reason: status.reason, pr_url: status.prUrl });
      continue;
    }
    
    if (status.needReprocess) {
      if (status.prNumber) {
        log(`  ♻️ PR #${status.prNumber} ${status.reason},需要重新处理`);
      } else {
        log(`  ♻️ ${status.reason},需要重新处理`);
      }
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