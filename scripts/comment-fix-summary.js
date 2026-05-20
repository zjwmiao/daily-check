#!/usr/bin/env node

/*
 * === /fix 输出模板(钉死)===
 *
 * 评论结构(POST 到 [GEO优化]#N issue):
 *
 *   ## 🛠 修复结果
 *
 *   | Community | geo issue | 状态 | Verify | PR |
 *   | --- | --- | --- | --- | --- |
 *   | openEuler | [#18](https://github.com/opensourceways/geo-workflow/issues/18) | `pr_created` / `verify_failed` / `critic_blocked` / `skipped` / `error` | ✅ 已修复 N 项(改完后构建通过 Ms · LLM 二审 🟢 通过) | [#3085](...) (created/updated) |
 *
 *   Verify 文案字段:
 *   - 计数:`✅ 已修复 N 项` / `❌ 仍未修复 N 项` / `⏭ 暂未校验 N 项` / `❓ 无法定位 N 项`
 *   - build 状态(verify 数据源):`改完后构建通过 Ms` / `改前基线构建失败(装依赖阶段)` / `构建跳过`
 *   - critic verdict(LLM 二审):`LLM 二审 🟢 通过` / `🟡 有可疑点(不阻断):<一句话原因>` / `🔴 阻断:<原因>`
 *
 *   注意:
 *   - geo issue / PR 列**必须用完整 markdown 链接**,否则 GitHub 把裸 `#N` 解析到本仓的 issue/PR
 *   - Verify 是结果,Build 是 verify 的数据源(给 schema/static-render 提供 dist 产物),**不单独成列**;同样 critic 也 inline 不单独列
 *   - critic 三档(pass/warn/block)跟 ADR-0024 取消的 problem severity 是不同概念 — critic 是 LLM 主观判定需要灰度,problem 是确定性规则判定不需要灰度
 *   - critic block 时,状态走 `status` 列 `critic_blocked`;warn 仍 push 不阻断
 *
 *   (可选)build 失败(任一阶段) → <details>(默认折叠)贴 stderr 尾段 2000 字符
 *
 *   (可选)critic verdict=block → <details open> 贴 critic body
 *
 *   每个有 agent_output 的 run:
 *   <details open>
 *   <summary>📝 {community} #{N} — opencode 修改清单 ({status})</summary>
 *
 *   {agent's output.md 内容,markdown 渲染,不 fenced}
 *
 *   agent_output 内部结构(由 .github/agents/geo-fix-prompt.md 强约束):
 *     # GEO Fix Agent - {owner}/{repo} 修复清单
 *     ## 修复概要 — 一段话
 *     ## ✅ 成功修复 — 每个 URL 一个 ### N. {url} ({dim}) 项,带 维度/修复文件/修复内容 三联块
 *     ## ⏭ 跳过处理 — 同样结构,加 跳过原因
 *     ## ❌ 失败处理 — 同样结构,加 失败原因
 *     ## 修复策略说明 — 配置方式 / 注入机制 / 数据来源 / 避免改动
 *     ## 文件修改清单 — 每个文件一条
 *     ## 验证建议 — 浏览器访问哪些 URL 看什么
 *
 *   </details>
 *
 *   <sub>详细日志见 [GitHub Actions run]({url}),原始制品在 workflow artifact(90 天保留)</sub>
 *
 * 同时另发评论到关联的 geo-workflow 原 issue:
 *   "🛠 portal 仓 PR 已创建,关联本 issue:\n\n{pr_url}\n\n(由 geo-develop 自动化生成...)"
 */

import fs from 'fs';
import axios from 'axios';

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    }
  }
  return out;
}

async function commentOnGithub(repo, issueNumber, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  await axios.post(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
    { body },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'geo-develop-workflow',
      },
      timeout: 30000,
    }
  );
}

// build 状态 inline 到 Verify 列 — schema/static-render 维度依赖 build 产物作数据源
function renderBuildInline(r) {
  const phaseMap = { install: '装依赖阶段', build: '构建阶段', 'detect-output': '探测产物阶段' };
  if (r.baseline_build && !r.baseline_build.ok && !r.baseline_build.skipped) {
    return `改前基线构建失败(${phaseMap[r.baseline_build.phase] || r.baseline_build.phase || '未知阶段'})`;
  }
  const b = r.build;
  if (!b) return null;
  if (b.ok) return `改完后构建通过 ${(b.duration_ms / 1000).toFixed(0)}s`;
  if (b.skipped) return '构建跳过';
  return `改完后构建失败(${phaseMap[b.phase] || b.phase || '未知阶段'})`;
}

function renderCriticInline(r) {
  if (!r.critic?.verdict) return null;
  const map = {
    pass: 'LLM 二审 🟢 通过',
    warn: 'LLM 二审 🟡 有可疑点(不阻断)',
    block: 'LLM 二审 🔴 阻断',
  };
  const head = map[r.critic.verdict] || `LLM 二审 ❓ ${r.critic.verdict}`;
  if (r.critic.verdict !== 'pass' && r.critic.reason) {
    return `${head}:${r.critic.reason.slice(0, 60)}${r.critic.reason.length > 60 ? '…' : ''}`;
  }
  return head;
}

function renderVerifyCell(r) {
  if (!r.verify?.summary) return '-';
  const s = r.verify.summary;
  const segs = [];
  if (s.fixed > 0) segs.push(`✅ 已修复 ${s.fixed} 项`);
  if (s.still_failing > 0) segs.push(`❌ 仍未修复 ${s.still_failing} 项`);
  if (s.deferred > 0) segs.push(`⏭ 暂未校验 ${s.deferred} 项`);
  if (s.unverifiable > 0) segs.push(`❓ 无法定位 ${s.unverifiable} 项`);
  const main = segs.length > 0
    ? segs.join(' / ')
    : (s.total === 0 ? '(无可校验项)' : `总计 ${s.total} 项`);

  const notes = [];
  const buildNote = renderBuildInline(r);
  if (buildNote) notes.push(buildNote);
  const criticNote = renderCriticInline(r);
  if (criticNote) notes.push(criticNote);
  return notes.length > 0 ? `${main}(${notes.join(' · ')})` : main;
}

function buildTriggerComment(results, runUrl) {
  const lines = [
    `## 🛠 修复结果`,
    '',
    `| Community | geo issue | 状态 | Verify | PR |`,
    `| --- | --- | --- | --- | --- |`,
  ];
  for (const r of results) {
    const pr = r.pr_url ? `[#${r.pr_number}](${r.pr_url})` : '-';
    const action = r.pr_action ? ` (${r.pr_action})` : '';
    // geo issue 列要带完整链接,否则 GitHub 把裸 `#N` 解析成本仓的 issue/PR #N(误指)
    const geoIssue = r.geo_issue_url
      ? `[#${r.geo_issue_number}](${r.geo_issue_url})`
      : `#${r.geo_issue_number}`;
    const verify = renderVerifyCell(r);
    lines.push(
      `| ${r.community} | ${geoIssue} | \`${r.status}\`${r.error ? ` (${r.error.slice(0, 80)})` : ''} | ${verify} | ${pr}${action} |`
    );
  }
  lines.push('');

  // build 现在是 best-effort,失败只 warn 不阻 push。如果任一阶段 build 挂了,把 stderr 贴出来给 reviewer 自行权衡
  for (const r of results) {
    const blFail = r.baseline_build && !r.baseline_build.ok && !r.baseline_build.skipped && r.baseline_build.error;
    const buildFail = r.build && !r.build.ok && !r.build.skipped && r.build.error;
    if (!blFail && !buildFail) continue;
    const which = blFail && buildFail ? 'baseline + post-agent' : blFail ? 'baseline' : 'post-agent';
    const errSource = buildFail ? r.build.error : r.baseline_build.error;
    lines.push('');
    lines.push(`<details>`);
    lines.push(`<summary>⚠ ${r.community} #${r.geo_issue_number} — ${which} build 失败(非阻断,reviewer 自行判)</summary>`);
    lines.push('');
    lines.push('```');
    lines.push(errSource.slice(-2000));
    lines.push('```');
    lines.push('');
    lines.push('</details>');
  }

  // verify_failed / critic_blocked 的 run 把 critic body 也贴出来,便于人 review
  for (const r of results) {
    if (r.status !== 'critic_blocked') continue;
    if (!r.critic_body) continue;
    lines.push('');
    lines.push(`<details open>`);
    lines.push(`<summary>⛔ ${r.community} #${r.geo_issue_number} — critic 判 block,PR 未推</summary>`);
    lines.push('');
    lines.push(r.critic_body.slice(0, 3500));
    lines.push('');
    lines.push('</details>');
  }

  // 每个成功的 run 把 agent 修改清单(opencode 写的 output.md)默认展开 + 渲染成 markdown
  // — 不用 ```text``` 包裹,让 ✅/⏭/❌ 列表直接展示,不显示原生符号
  for (const r of results) {
    if (!r.agent_output) continue;
    const trimmed = r.agent_output.trim();
    if (!trimmed) continue;
    lines.push('');
    lines.push(`<details open>`);
    lines.push(
      `<summary>📝 ${r.community} #${r.geo_issue_number} — opencode 修改清单 (${r.pr_action || r.status})</summary>`
    );
    lines.push('');
    // 留出注释 + summary 框的空间,GH 评论限 65k;不再 fenced
    lines.push(trimmed.slice(0, 3500));
    lines.push('');
    lines.push('</details>');
  }

  if (runUrl) {
    lines.push('');
    lines.push(`<sub>详细日志见 [GitHub Actions run](${runUrl}),原始制品在 workflow artifact(90 天保留)</sub>`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.results || !args['trigger-repo'] || !args['trigger-issue']) {
    console.error('Usage: --results=fix-results.json --trigger-repo=owner/repo --trigger-issue=N');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(args.results, 'utf-8'));
  const results = data.results || [];
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  await commentOnGithub(args['trigger-repo'], args['trigger-issue'], buildTriggerComment(results, runUrl));

  for (const r of results) {
    if (!r.pr_url) continue;
    if (!r.geo_issue_url) continue;
    const m = r.geo_issue_url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    if (!m) continue;
    const repo = m[1];
    const num = m[2];
    try {
      await commentOnGithub(
        repo,
        num,
        `🛠 portal 仓 PR 已创建,关联本 issue:\n\n${r.pr_url}\n\n(由 geo-develop 自动化生成,触发 issue: https://github.com/${args['trigger-repo']}/issues/${args['trigger-issue']})`
      );
    } catch (err) {
      console.error(`⚠ comment to ${repo}#${num} failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
