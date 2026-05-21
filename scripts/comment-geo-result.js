#!/usr/bin/env node

import { addIssueComment } from './lib/atomgit-api.js';
import { GEO_PROCESSED_MARKER, GEO_SKIP_NO_URLS, GEO_SKIP_NO_PROBLEMS } from './lib/geo-markers.js';
import { parseArgs, log, readInput } from './lib/utils.js';

function buildComment(result) {
  const lines = [];
  const issueNum = result.issue_number || result.issue?.number;
  const issueUrl = result.issue_url || result.issue?.url;

  if (result.skip) {
    lines.push('## ⏭ GEO 处理跳过');
    lines.push('');
    lines.push(`**原因**: ${result.skip_reason}`);
    lines.push('');
    if (issueUrl) {
      lines.push(`> 关联issue: [#${issueNum}](${issueUrl})`);
    }
    lines.push('');
    lines.push('本次不做修复处理。如需重新处理，请更新issue内容后删除本评论。');
    lines.push('');
    const marker = result.skip_reason?.includes('无官网URLs') ? GEO_SKIP_NO_URLS : GEO_SKIP_NO_PROBLEMS;
    lines.push(marker);
    return lines.join('\n');
  }

  if (result.status === 'error') {
    lines.push('## ❌ GEO 自动修复失败');
    lines.push('');
    lines.push(`**错误**: ${result.error || '未知错误'}`);
    lines.push('');
    if (issueUrl) {
      lines.push(`> 关联issue: [#${issueNum}](${issueUrl})`);
    }
    lines.push('');
    lines.push('请检查错误日志或手动修复。');
    lines.push('');
    lines.push(GEO_PROCESSED_MARKER);
    return lines.join('\n');
  }

  if (result.status === 'no_changes') {
    lines.push('## ⏭ GEO 自动修复完成');
    lines.push('');
    lines.push('**状态**: 无需修改 (agent分析后未发现需要修复的问题)');
    lines.push('');
    if (issueUrl) {
      lines.push(`> 关联issue: [#${issueNum}](${issueUrl})`);
    }
    if (result.urls && result.urls.length > 0) {
      lines.push('');
      lines.push('| URL | 状态 |');
      lines.push('| --- | --- |');
      for (const u of result.urls) {
        lines.push(`| [${shortUrl(u.url)}](${u.url}) | ✅ 已检查 |`);
      }
    }
    if (result.verify) {
      lines.push('');
      lines.push(`**Verify**: ${renderVerifySummary(result.verify)}`);
    }
    lines.push('');
    lines.push(GEO_PROCESSED_MARKER);
    return lines.join('\n');
  }

  lines.push('## 🤖 GEO 自动修复结果');
  lines.push('');

  const statusEmoji = result.status === 'pr_created' ? '✅' : '❓';
  const statusText = result.status === 'pr_created' ? 'PR已创建' : result.status;
  lines.push(`| 项 | 值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 状态 | ${statusEmoji} ${statusText} |`);
  if (result.pr_number) {
    const prLink = result.pr_url || `https://atomgit.com/${result.portal?.owner}/${result.portal?.repo}/pulls/${result.pr_number}`;
    lines.push(`| PR | [#${result.pr_number}](${prLink}) |`);
  }
  if (result.branch) {
    lines.push(`| 分支 | \`${result.branch}\` |`);
  }
  lines.push('');

  if (issueUrl) {
    lines.push(`> 关联issue: [#${issueNum}](${issueUrl})`);
    lines.push('');
  }

  if (result.verify) {
    lines.push('### Verify 结果');
    lines.push('');
    lines.push(renderVerifySummary(result.verify));
    if (result.verify.checks && result.verify.checks.length > 0) {
      lines.push('');
      lines.push('| URL | 状态 | Before | After |');
      lines.push('| --- | --- | --- | --- |');
      for (const c of result.verify.checks) {
        const icon = { fixed: '✅', still_failing: '❌', deferred: '⏭', unverifiable: '❓' }[c.status] || '·';
        lines.push(`| [${shortUrl(c.url)}](${c.url}) | ${icon} ${c.status} | ${cell(c.before || '-')} | ${cell(c.after || '-')} |`);
      }
    }
    lines.push('');
  }

  if (result.critic) {
    lines.push('### Critic 审查');
    lines.push('');
    const verdictEmoji = { pass: '🟢', warn: '🟡', block: '🔴' }[result.critic.verdict] || '❓';
    lines.push(`**判定**: ${verdictEmoji} ${result.critic.verdict || 'unknown'}`);
    if (result.critic.reason) {
      lines.push(`**原因**: ${result.critic.reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('修复完成后，PR合并将自动触发重验并关闭本issue。');
  lines.push('');
  lines.push(GEO_PROCESSED_MARKER);

  return lines.join('\n');
}

function shortUrl(u, max = 50) {
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

function renderVerifySummary(verify) {
  if (!verify?.summary) return '(无verify结果)';
  const s = verify.summary;
  const parts = [];
  if (s.fixed > 0) parts.push(`✅ 已修复 ${s.fixed}`);
  if (s.still_failing > 0) parts.push(`❌ 未修复 ${s.still_failing}`);
  if (s.deferred > 0) parts.push(`⏭ 跳过 ${s.deferred}`);
  if (s.unverifiable > 0) parts.push(`❓ 无法验证 ${s.unverifiable}`);
  return parts.length > 0 ? parts.join(' / ') : '(无校验项)';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  let result;
  try {
    result = await readInput(args);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const owner = args.owner || result.portal?.owner;
  const repo = args.repo || result.portal?.repo;
  const issueNumber = result.issue_number || result.issue?.number;

  if (!owner || !repo || !issueNumber) {
    console.error('❌ 缺少必要参数: --owner, --repo 或 issue_number');
    process.exit(1);
  }

  if (!process.env.ATOMGIT_TOKEN) {
    console.error('❌ ATOMGIT_TOKEN 未设置');
    process.exit(1);
  }

  log(`▶ 评论结果到 ${owner}/${repo} #${issueNumber}`);
  log(`  状态: ${result.status || result.skip ? 'skip' : 'unknown'}`);

  const body = buildComment(result);
  log(`  评论长度: ${body.length} 字符`);

  try {
    const comment = await addIssueComment({ owner, repo, issue_number: issueNumber, body });
    const commentUrl = comment.html_url || comment.url || `https://atomgit.com/${owner}/${repo}/issues/${issueNumber}`;
    log(`✅ 评论已添加: ${commentUrl}`);
    
    const output = {
      run_at: new Date().toISOString(),
      issue_number: issueNumber,
      comment_url: commentUrl,
      comment_id: comment.id,
      status: 'commented',
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error(`❌ 评论失败: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});