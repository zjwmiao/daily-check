#!/usr/bin/env node

import fs from 'fs';
import { COMMUNITY_MAP, isOfficialHost } from './lib/community-map.js';
import { fetchQuestionsJson } from './lib/geo-workflow-data.js';
import { GEO_SKIP_NO_URLS } from './lib/geo-markers.js';
import { parseArgs, log, readInput } from './lib/utils.js';

function filterOfficialUrls(urls, community) {
  const cfg = COMMUNITY_MAP[community];
  if (!cfg) return [];
  return urls.filter(u => {
    try {
      const host = new URL(u).hostname;
      return cfg.site_hosts.includes(host);
    } catch { return false; }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  let input;
  try {
    input = await readInput(args);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const issues = input.issues || [input];
  const firstIssue = issues[0];
  if (!firstIssue) {
    console.error('❌ 输入中无issue信息');
    process.exit(1);
  }

  const community = input.community || args.community;
  if (!community) {
    console.error('❌ 未指定community(通过stdin或--community)');
    process.exit(1);
  }

  const cfg = COMMUNITY_MAP[community];
  if (!cfg) {
    console.error(`❌ 不支持的community: ${community}`);
    process.exit(1);
  }

  log(`▶ 构建修复任务: community=${community}, issue #${firstIssue.number}`);
  log(`  问题ID: ${firstIssue.problem_ids.join(', ')}`);

  let questions;
  try {
    questions = await fetchQuestionsJson(community);
    log(`  获取到 ${questions.length} 个问题定义`);
  } catch (err) {
    console.error(`❌ 获取questions.json失败: ${err.message}`);
    process.exit(1);
  }

  const questionById = new Map(questions.map(q => [q.id, q]));
  const matchedQuestions = firstIssue.problem_ids
    .map(id => questionById.get(id))
    .filter(q => q);

  log(`  匹配到 ${matchedQuestions.length} 个问题定义`);
  if (matchedQuestions.length === 0) {
    log(`  ⏭ 无匹配的问题,跳过`);
    const skipResult = {
      run_at: new Date().toISOString(),
      portal: { owner: cfg.portal_owner, repo: cfg.portal_repo, base_branch: cfg.portal_default_branch },
      community,
      issue: firstIssue,
      skip: true,
      skip_reason: '无匹配的问题定义(问题ID不在questions.json中)',
      urls: [],
      problems: [],
    };
    console.log(JSON.stringify(skipResult, null, 2));
    return;
  }

  const allUrls = [];
  const urlDetails = [];
  const skippedQuestions = [];

  for (const q of matchedQuestions) {
    const urls = q.official_urls || [];
    const officialUrls = urls.filter(u => {
      try {
        const host = new URL(u).hostname;
        return cfg.site_hosts.includes(host);
      } catch { return false; }
    });

    if (officialUrls.length === 0) {
      skippedQuestions.push(q.id);
      log(`  Q ${q.id}: 无官网URL(所有URL都不属于${community}官网域),跳过此问题`);
      continue;
    }

    log(`  Q ${q.id}: ${urls.length} URLs → ${officialUrls.length} 官网URLs`);
    for (const u of officialUrls) {
      allUrls.push(u);
      urlDetails.push({
        url: u,
        question_id: q.id,
        question_text: q.question,
      });
    }
  }

  if (allUrls.length === 0) {
    log(`  ⏭ 无官网URLs(所有匹配问题都不涉及${community}官网),跳过`);
    const skipResult = {
      run_at: new Date().toISOString(),
      portal: { owner: cfg.portal_owner, repo: cfg.portal_repo, base_branch: cfg.portal_default_branch },
      community,
      issue: firstIssue,
      skip: true,
      skip_reason: '未涉及官网页面',
      skipped_questions: skippedQuestions,
      urls: [],
      problems: [],
    };
    console.log(JSON.stringify(skipResult, null, 2));
    return;
  }

  log(`  ✅ ${allUrls.length} 个待修复URL`);

  const problems = [];
  for (const detail of urlDetails) {
    problems.push({
      url: detail.url,
      dimension: 'all',
      description: `需要检查并修复SEO/GEO可发现性问题`,
      question_id: detail.question_id,
    });
  }

  const result = {
    run_at: new Date().toISOString(),
    portal: {
      owner: cfg.portal_owner,
      repo: cfg.portal_repo,
      base_branch: cfg.portal_default_branch,
    },
    community,
    issue: {
      number: firstIssue.number,
      url: firstIssue.url,
      title: firstIssue.title,
    },
    urls: urlDetails,
    problems,
    summary: {
      url_count: allUrls.length,
      question_count: matchedQuestions.length,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  log(`\n🏁 完成: ${allUrls.length} URLs待修复`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});