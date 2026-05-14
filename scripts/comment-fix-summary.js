#!/usr/bin/env node

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

function buildTriggerComment(results, runUrl) {
  const lines = [
    `## 🛠 修复结果`,
    '',
    `| Community | geo issue | 状态 | Build | Verify | Critic | PR |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const r of results) {
    const pr = r.pr_url ? `[${r.pr_number}](${r.pr_url})` : '-';
    const action = r.pr_action ? ` (${r.pr_action})` : '';
    // baseline_failed 时整个 run 还没进 build 步,baseline_build 才是失败现场
    const buildInfo = r.baseline_build && !r.baseline_build.ok && !r.baseline_build.skipped
      ? r.baseline_build
      : r.build;
    const build = !buildInfo
      ? '-'
      : buildInfo.ok
        ? `✅ ${(buildInfo.duration_ms / 1000).toFixed(0)}s`
        : buildInfo.skipped
          ? `⏭ ${buildInfo.reason || 'skipped'}`
          : `❌ ${buildInfo.phase || 'failed'}`;
    const verify = r.verify?.summary
      ? `✅${r.verify.summary.fixed}/❌${r.verify.summary.still_failing}/⏭${r.verify.summary.deferred}`
      : '-';
    const critic = r.critic?.verdict
      ? { pass: '🟢 pass', warn: '🟡 warn', block: '🔴 block' }[r.critic.verdict] || r.critic.verdict
      : '-';
    lines.push(
      `| ${r.community} | #${r.geo_issue_number} | \`${r.status}\`${r.error ? ` (${r.error.slice(0, 80)})` : ''} | ${build} | ${verify} | ${critic} | ${pr}${action} |`
    );
  }
  lines.push('');

  // baseline_failed / build_failed 把 error tail 贴出来给 reviewer 排查
  for (const r of results) {
    let label, errSource;
    if (r.status === 'baseline_failed' && r.baseline_build?.error) {
      label = `⚠ ${r.community} #${r.geo_issue_number} — portal baseline build 失败(phase=${r.baseline_build.phase}),agent 还没下手就坏了。这是 portal 仓 baseline 问题,跟 agent 无关,需人工排查 portal 仓 deps / runner 工具链`;
      errSource = r.baseline_build.error;
    } else if (r.status === 'build_failed' && r.build?.error) {
      label = `❌ ${r.community} #${r.geo_issue_number} — post-agent build 失败(phase=${r.build.phase}),baseline 此前已通过 → agent 改动破坏了 build,PR 未推`;
      errSource = r.build.error;
    } else {
      continue;
    }
    lines.push('');
    lines.push(`<details open>`);
    lines.push(`<summary>${label}</summary>`);
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
