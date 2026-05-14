#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getCommunity } from './lib/community-map.js';
import { createIssue, updateIssue, findIssueByTitlePrefix } from './lib/atomgit-api.js';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

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

const SEV = { critical: '🔴', important: '🟡', minor: '⚪' };

// 把长 URL 截短给表格,避免 atomgit UI 撑爆
function shortUrl(u, max = 64) {
  if (!u || u.length <= max) return u;
  try {
    const x = new URL(u);
    return x.hostname + x.pathname.slice(0, max - x.hostname.length - 1) + '…';
  } catch {
    return u.slice(0, max - 1) + '…';
  }
}

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// 收集本 issue 所有 critical/important 问题(对外仓的开发者只看真正要改的)
function collectProblems(issue) {
  const rows = [];
  for (const q of issue.questions || []) {
    for (const u of q.urls || []) {
      if (!u.ok || u.scope_skipped) continue;
      for (const p of u.problems || []) {
        if (p.severity !== 'critical' && p.severity !== 'important') continue;
        rows.push({
          severity: p.severity,
          dimension: p.dimension || p.category || '-',
          url: u.url,
          description: p.description,
          suggestion: p.suggestion,
        });
      }
    }
  }
  return rows;
}

function buildBody(issue) {
  const problems = collectProblems(issue);
  const relations = [
    `[geo-workflow #${issue.geo_issue_number}](${issue.geo_issue_url})`,
    `severity \`${issue.severity || '-'}\``,
  ].join(' · ');

  const lines = [`**来源**: ${relations}`, ''];

  if (problems.length === 0) {
    lines.push('_本 issue 当前没有 critical / important 级别的可发现性问题_');
  } else {
    lines.push(`| Severity | Dimension | URL | Description |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const p of problems) {
      const sev = `${SEV[p.severity] || '·'} ${p.severity}`;
      const urlMd = `[${shortUrl(p.url)}](${p.url})`;
      lines.push(`| ${cell(sev)} | ${cell(p.dimension)} | ${urlMd} | ${cell(p.description)} |`);
    }
  }

  lines.push('');
  lines.push(
    `<sub>由 geo-develop 自动化分析生成 · 修复 PR 合并后将自动关闭本 issue。改动应限于 \`schema\` / \`tdk\` / \`sitemap\` / \`prerender\` 配置文件。</sub>`
  );
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args['trigger-repo'] || !args['trigger-issue']) {
    console.error('Usage: --input=analysis.json --trigger-repo=owner/repo --trigger-issue=N --run-dir=... --output=...');
    process.exit(1);
  }
  const dryRun = !!args['dry-run'] || !process.env.ATOMGIT_TOKEN;

  const analysis = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const triggerRepo = args['trigger-repo'];
  const triggerIssue = args['trigger-issue'];
  const runDir = args['run-dir'] || '(unknown)';

  if (!analysis.issues || analysis.issues.length === 0) {
    log(`ℹ 0 issue 可建 portal issue${analysis.upstream_note ? ` — ${analysis.upstream_note}` : ''}(上游数据状况,跳过)`);
    if (args.output) {
      fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
      fs.writeFileSync(args.output, JSON.stringify({ run_at: new Date().toISOString(), records: [], skipped: true }, null, 2));
    }
    return;
  }

  const records = [];
  for (const issue of analysis.issues) {
    const community = getCommunity(issue.community);
    if (!community) {
      console.error(`⚠ skip unsupported community: ${issue.community}`);
      continue;
    }
    // 没有 critical/important 问题 → 不在 portal 仓刷外部可见的 issue(避免噪音)
    if (collectProblems(issue).length === 0) {
      log(`⏭ skip portal issue (no critical/important): ${issue.community} #${issue.geo_issue_number}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        portal_owner: community.portal_owner,
        portal_repo: community.portal_repo,
        skipped: true,
        skip_reason: 'no critical/important problems',
      });
      continue;
    }
    // 题头前缀唯一标识(community + 原 issue 号),用于去重
    const titlePrefix = `[GEO] ${issue.community} #${issue.geo_issue_number}:`;
    const title = `${titlePrefix} ${issue.geo_issue_title}`;
    const body = buildBody(issue);

    if (dryRun) {
      log(`[dry-run] would create/update on ${community.portal_owner}/${community.portal_repo}: ${title}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        portal_owner: community.portal_owner,
        portal_repo: community.portal_repo,
        dry_run: true,
        title,
      });
      continue;
    }

    try {
      log(`🔍 find existing issue by prefix: "${titlePrefix}" on ${community.portal_owner}/${community.portal_repo}`);
      const existing = await findIssueByTitlePrefix({
        owner: community.portal_owner,
        repo: community.portal_repo,
        prefix: titlePrefix,
      });

      let result, action;
      if (existing) {
        log(`♻️  found existing #${existing.number}, updating body`);
        result = await updateIssue({
          owner: community.portal_owner,
          repo: community.portal_repo,
          issue_number: existing.number,
          title,
          body,
        });
        action = 'updated';
        if (!result) result = existing;
      } else {
        log(`✨ no existing issue, creating new`);
        // 注意:不传 labels — atomgit/apig 对 labels 字段有奇怪的权限拦截(实测 200→400,误报为 token 无权限)
        result = await createIssue({
          owner: community.portal_owner,
          repo: community.portal_repo,
          title,
          body,
        });
        action = 'created';
      }
      const url =
        result.html_url ||
        result.url ||
        `https://atomgit.com/${community.portal_owner}/${community.portal_repo}/issues/${result.number}`;
      log(`✅ portal issue ${action}: ${url}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        portal_owner: community.portal_owner,
        portal_repo: community.portal_repo,
        portal_issue_url: url,
        portal_issue_number: result.number,
        action,
      });
    } catch (err) {
      log(`❌ ${issue.community} #${issue.geo_issue_number}: ${err.message}`);
      records.push({
        community: issue.community,
        geo_issue_number: issue.geo_issue_number,
        error: err.message,
      });
    }
  }

  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify({ run_at: new Date().toISOString(), records }, null, 2));
    log(`📝 saved portal-issues record: ${args.output}`);
  }

  // strict: 任一 portal issue 处理失败 → throw,让 workflow step 失败、if:failure 回评
  const errored = records.filter((r) => r.error);
  if (errored.length > 0) {
    throw new Error(
      `open-portal-issues 有 ${errored.length}/${records.length} 失败:\n${errored
        .map((r) => `  - ${r.community}#${r.geo_issue_number}: ${r.error}`)
        .join('\n')}`
    );
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
