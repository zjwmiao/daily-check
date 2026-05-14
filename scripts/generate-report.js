#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getCommunity } from './lib/community-map.js';

export const PAYLOAD_MARKER = 'geo-analysis-payload v1';

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

function renderProblems(problems) {
  if (!problems || problems.length === 0) return '_(无)_';
  return problems
    .map((p) => `- **[${p.dimension || p.category}]** ${p.description}${p.suggestion ? ` — 建议: ${p.suggestion}` : ''}`)
    .join('\n');
}

function renderUrl(urlAnalysis) {
  if (!urlAnalysis.ok) {
    return `**${urlAnalysis.url}**\n\n❌ ${urlAnalysis.error || '抓取失败'}`;
  }
  if (urlAnalysis.scope_skipped) {
    return `**${urlAnalysis.url}**  ⏭ 跳过(非官网域,${urlAnalysis.scope_skipped_reason})`;
  }
  if (urlAnalysis.preflight_failed) {
    return `**${urlAnalysis.url}**  ⚠ preflight 未通过(${urlAnalysis.preflight_reason}: ${urlAnalysis.preflight_detail || '-'}),不进 fix payload,需上游校正`;
  }
  const c = urlAnalysis.checks;
  const total = urlAnalysis.summary?.total ?? (urlAnalysis.problems?.length || 0);
  return [
    `**${urlAnalysis.url}**  ${urlAnalysis.pass ? '✅ PASS' : `❌ ${total} problem(s)`}`,
    '',
    `| 维度 | 结果 |`,
    `| --- | --- |`,
    `| 静态化 | ${c.static_render.pass ? '✅' : '❌'} ${c.static_render.mode === 'dual' ? `content_ratio=${c.static_render.content_ratio}` : c.static_render.mode} |`,
    `| Schema | ${c.schema.pass ? `✅ ${c.schema.types.join(', ') || '有效'}` : `❌ 块数=${c.schema.block_count}`} |`,
    `| TDK | ${c.tdk.pass ? `✅ title=${c.tdk.title_length}/desc=${c.tdk.description_length}` : `❌ title=${c.tdk.title_length}/desc=${c.tdk.description_length}`} |`,
    `| Sitemap | ${c.sitemap_inclusion.pass ? `✅ 已收录(共 ${c.sitemap_inclusion.sitemap_total_urls})` : '❌ 未收录'} |`,
    '',
    renderProblems(urlAnalysis.problems),
  ].join('\n');
}

function renderIssue(issue) {
  const lines = [
    `## 🎯 ${issue.community} • geo-workflow #${issue.geo_issue_number}`,
    '',
    `> [${issue.geo_issue_title}](${issue.geo_issue_url}) · severity: **${issue.severity}** · status: ${issue.status || '-'}`,
    '',
  ];
  for (const q of issue.questions) {
    lines.push(`### Q ${q.id}: ${q.question}`);
    lines.push('');
    for (const u of q.urls) {
      lines.push(renderUrl(u));
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function buildFixPayload(analysis, triggerIssue, portalIssuesIndex = new Map()) {
  const issues = [];
  for (const issue of analysis.issues) {
    const community = getCommunity(issue.community);
    if (!community) continue;
    const questions = [];
    for (const q of issue.questions) {
      const urls = [];
      for (const u of q.urls) {
        if (!u.ok) continue;
        // P1: preflight 失败的 URL 不进 fix payload — 上游数据问题(URL 失效/重定向),agent 修不了
        if (u.preflight_failed) continue;
        // 不再按 severity 过滤 — analyzer 报的都是确定性问题,都需要改
        const problems = (u.problems || []).map((p) => ({
          dimension: p.dimension || p.category,
          category: p.category,
          description: p.description,
          suggestion: p.suggestion,
          expected: p.expected,
          actual: p.actual,
        }));
        if (problems.length === 0) continue;
        urls.push({ url: u.url, final_url: u.final_url, problems });
      }
      if (urls.length === 0) continue;
      questions.push({ id: q.id, question: q.question, official_urls: urls });
    }
    if (questions.length === 0) continue;
    // 取出本 issue 对应的 portal issue(open-portal-issues 已建好/复用 ),没有就 null
    const portalKey = `${issue.community}#${issue.geo_issue_number}`;
    const portalRec = portalIssuesIndex.get(portalKey) || null;
    issues.push({
      community: issue.community,
      geo_issue_number: issue.geo_issue_number,
      geo_issue_url: issue.geo_issue_url,
      geo_issue_title: issue.geo_issue_title,
      severity: issue.severity,
      portal: { owner: community.portal_owner, repo: community.portal_repo, default_branch: community.portal_default_branch },
      portal_issue_url: portalRec?.portal_issue_url || null,
      portal_issue_number: portalRec?.portal_issue_number || null,
      questions,
    });
  }
  return {
    version: 1,
    run_at: analysis.run_at,
    trigger_issue: triggerIssue || null,
    issues,
  };
}

function renderPayloadBlock(payload) {
  const json = JSON.stringify(payload, null, 2);
  return [
    '',
    `<details>`,
    `<summary>📦 ${PAYLOAD_MARKER}(供 /fix 自动消费,请勿编辑)</summary>`,
    '',
    '```json',
    json,
    '```',
    '',
    '</details>',
    '',
    `<!-- ${PAYLOAD_MARKER} -->`,
  ].join('\n');
}

function aggregate(analysis) {
  let total = 0;
  let preflightFailed = 0;
  let passUrls = 0;
  let totalUrls = 0;
  for (const issue of analysis.issues) {
    for (const q of issue.questions) {
      for (const u of q.urls) {
        totalUrls++;
        if (!u.ok) continue;
        if (u.preflight_failed) preflightFailed++;
        if (u.pass) passUrls++;
        total += u.summary?.total || (u.problems?.length || 0);
      }
    }
  }
  return { total, preflightFailed, passUrls, totalUrls };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/generate-report.js --input=analysis.json [--output=report.md] [--trigger-issue=N]');
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const agg = aggregate(analysis);

  // 可选:portal-issues.json(本轮 /analyze 同步建好的 portal issue 记录),没传就空表
  const portalIssuesIndex = new Map();
  if (args['portal-issues'] && fs.existsSync(args['portal-issues'])) {
    try {
      const pi = JSON.parse(fs.readFileSync(args['portal-issues'], 'utf-8'));
      for (const r of pi.records || []) {
        if (r.portal_issue_url) {
          portalIssuesIndex.set(`${r.community}#${r.geo_issue_number}`, r);
        }
      }
    } catch (err) {
      console.error(`⚠ 解析 portal-issues.json 失败,忽略:${err.message}`);
    }
  }

  const lines = [
    `# GEO 可发现性分析报告`,
    '',
    `_生成时间: ${analysis.run_at}_`,
    args['trigger-issue'] ? `_触发 Issue: #${args['trigger-issue']}_` : '',
    '',
    `## 📊 总览`,
    '',
    `| 项 | 值 |`,
    `| --- | --- |`,
    `| 涉及 geo-workflow issue | ${analysis.issues.length} 个 |`,
    `| 分析 URL 数 | ${agg.totalUrls} (PASS: ${agg.passUrls}, preflight 失败: ${agg.preflightFailed}) |`,
    `| 问题总数 | ${agg.total} |`,
    '',
    `---`,
    '',
  ];

  for (const issue of analysis.issues) {
    lines.push(renderIssue(issue));
    lines.push('---');
    lines.push('');
  }

  if (analysis.issues.length === 0) {
    lines.push(`## ⏭ 跳过(无可分析输入)`);
    lines.push('');
    if (analysis.upstream_note) {
      lines.push(`> ${analysis.upstream_note}`);
    } else {
      lines.push('_未发现符合条件的 P0 issue(可能:official_urls 全部为空,或 target 不匹配)_');
    }
    lines.push('');
    lines.push('**结论**: 这是上游 geo-workflow 数据状况,不是本工作流的分析失败;无需 `/fix`。');
    lines.push('');
  } else {
    lines.push(`> 评论 \`/fix\` 触发自动修复(将在对应 portal 仓提 PR)`);
  }

  const payload = buildFixPayload(analysis, args['trigger-issue'], portalIssuesIndex);
  lines.push(renderPayloadBlock(payload));

  const out = lines.filter((l) => l !== undefined).join('\n');
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, out);
    console.error(`✅ Report saved: ${args.output}`);
  } else {
    console.log(out);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
