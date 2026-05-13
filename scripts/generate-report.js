#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

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

const SEV_ICON = { critical: '🔴', important: '🟡', minor: '⚪' };

function renderProblems(problems) {
  if (!problems || problems.length === 0) return '_(无)_';
  return problems
    .map((p) => `- ${SEV_ICON[p.severity] || '·'} **[${p.severity}/${p.dimension || p.category}]** ${p.description}${p.suggestion ? ` — 建议: ${p.suggestion}` : ''}`)
    .join('\n');
}

function renderUrl(urlAnalysis) {
  if (!urlAnalysis.ok) {
    return `**${urlAnalysis.url}**\n\n❌ ${urlAnalysis.error || '抓取失败'}`;
  }
  const c = urlAnalysis.checks;
  const score = `🔴 ${urlAnalysis.summary.critical} / 🟡 ${urlAnalysis.summary.important} / ⚪ ${urlAnalysis.summary.minor}`;
  return [
    `**${urlAnalysis.url}**  ${urlAnalysis.pass ? '✅ PASS' : '❌ FAIL'}  (${score})`,
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

function aggregate(analysis) {
  let total = 0;
  let crit = 0;
  let imp = 0;
  let passUrls = 0;
  let totalUrls = 0;
  for (const issue of analysis.issues) {
    for (const q of issue.questions) {
      for (const u of q.urls) {
        totalUrls++;
        if (!u.ok) continue;
        if (u.pass) passUrls++;
        total += u.summary.total;
        crit += u.summary.critical;
        imp += u.summary.important;
      }
    }
  }
  return { total, crit, imp, passUrls, totalUrls };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/generate-report.js --input=analysis.json [--output=report.md] [--trigger-issue=N]');
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const agg = aggregate(analysis);

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
    `| 分析 URL 数 | ${agg.totalUrls} (PASS: ${agg.passUrls}) |`,
    `| 🔴 Critical | ${agg.crit} |`,
    `| 🟡 Important | ${agg.imp} |`,
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
    lines.push('_未发现符合条件的 P0 issue(possibly: official_urls 全部为空,或 target 不匹配)_');
  }

  lines.push(`> 评论 \`/fix\` 触发自动修复(将在对应 portal 仓提 PR)`);

  const out = lines.filter((l) => l !== undefined).join('\n');
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, out);
    console.error(`✅ Report saved: ${args.output}`);
  } else {
    console.log(out);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
