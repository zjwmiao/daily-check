#!/usr/bin/env node
// 把 geo-workflow 仓的新 P0 issue 同步成本仓的 [GEO优化]#N issue
// — 只同步 official_urls 非空(本仓 4 维度能跑)的 issue
// — 全空(P1 内容空白类)→ 在上游 issue 评论一次"暂不接管"(带 skipped marker,幂等)
// — createIssue 用 GEO_GITHUB_TOKEN(PAT),让 issues.opened cascade 能触发 analyze workflow
// — 已有 tracker 用 BODY_MARKER 检测旧格式自动 PATCH

import axios from 'axios';
import { issueHasOfficialUrls } from './lib/geo-workflow-data.js';

// tracker body 格式版本 marker — bump 这个版本号时,旧 tracker 会被 patch
export const BODY_MARKER = '<!-- geo-sync-body v2 -->';

// 上游 issue 上的"已通知本仓暂不接管"标记,幂等用 — 同一 upstream issue 只评论一次
const UPSTREAM_SKIPPED_MARKER = '<!-- geo-sync-skipped v1 -->';

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
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || i === max - 1) throw err;
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

export function buildTitle(src) {
  return `[GEO优化]#${src.number}: ${src.title}`;
}

export function buildBody(src) {
  const labelList = (src.labels || []).map((l) => `\`${l.name}\``).join(' ') || '_(无)_';
  return [
    `> 🔗 **关联 geo-workflow 原始评估 issue**:[#${src.number}](${src.html_url})`,
    `> ${src.html_url}`,
    '',
    `## 原始信息`,
    `- severity 标签: ${labelList}`,
    `- 创建时间: ${src.created_at}`,
    '',
    `## 下一步`,
    `- 自动:本 issue 创建时会自动触发一次 \`/analyze\`(由 \`issues.opened\` event 拉起)`,
    `- 手工:评论 \`/analyze\` 重跑分析;\`/fix\` 触发自动修复`,
    `- 修复 PR merge 后,定时 poll(geo-poll workflow)会自动重验 + 关闭本 issue`,
    '',
    `<sub>该 issue 由 geo-poll 自动同步(ADR-0017)</sub>`,
    '',
    BODY_MARKER,
  ].join('\n');
}

function buildSkippedComment(check) {
  return [
    `> ℹ️ 本 issue 在 geo-develop-workflow **暂不接管**`,
    `>`,
    `> **原因**:${check.reason}`,
    `>`,
    `> geo-develop-workflow 跑的 4 维度分析(静态化 / Schema / TDK / Sitemap)都需要 \`official_urls\` 才有发力点;`,
    `> P1 "内容空白" 类问题(没有任何 official_urls 可指)不在我们处理范围内。`,
    `>`,
    `> 若后续补上了 \`official_urls\`,下次 sync(每 4h cron)会自动接管。`,
    '',
    UPSTREAM_SKIPPED_MARKER,
  ].join('\n');
}

async function hasSkippedCommentUpstream(client, srcRepo, issueNumber) {
  // 翻所有 comment 找 marker — 通常 1 页够用,但保险翻到底
  let page = 1;
  while (true) {
    const res = await retry(
      () =>
        client.get(`https://api.github.com/repos/${srcRepo}/issues/${issueNumber}/comments`, {
          params: { per_page: 100, page },
        }),
      { label: `list ${srcRepo}#${issueNumber} comments p${page}` }
    );
    for (const c of res.data || []) {
      if ((c.body || '').includes(UPSTREAM_SKIPPED_MARKER)) return true;
    }
    if (!res.data || res.data.length < 100) return false;
    page++;
  }
}

async function listAllIssues(client, repo, params) {
  const out = [];
  let page = 1;
  while (true) {
    const res = await retry(
      () => client.get(`https://api.github.com/repos/${repo}/issues`, { params: { ...params, per_page: 100, page } }),
      { label: `list ${repo} issues p${page}` }
    );
    out.push(...res.data.filter((i) => !i.pull_request)); // 排除 PR
    if (res.data.length < 100) break;
    page++;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const srcRepo = args['source-repo'];
  const tgtRepo = args['target-repo'];
  if (!srcRepo || !tgtRepo) {
    console.error('Usage: --source-repo=owner/repo --target-repo=owner/repo');
    process.exit(1);
  }
  const srcToken = process.env.GEO_GITHUB_TOKEN;
  const tgtToken = process.env.GITHUB_TOKEN;
  if (!srcToken) throw new Error('GEO_GITHUB_TOKEN not set(读 geo-workflow private + 写跟踪 issue 都用它)');
  if (!tgtToken) throw new Error('GITHUB_TOKEN not set(本仓 PATCH 已存在 tracker body 仍用 GITHUB_TOKEN)');

  log(`▶ scanning ${srcRepo} (label=geo-improvement, state=open) ...`);
  const srcOpen = await listAllIssues(gh(srcToken), srcRepo, {
    state: 'open',
    labels: 'geo-improvement',
  });
  log(`  found ${srcOpen.length} open P0 issues in ${srcRepo}`);

  // 取本仓所有 [GEO优化] 系列 issue(含已关闭),按 #N 索引
  log(`▶ scanning ${tgtRepo} for existing [GEO优化]#N issues ...`);
  const tgtAll = await listAllIssues(gh(tgtToken), tgtRepo, { state: 'all' });
  const existingByNum = new Map(); // src_number -> tgt issue
  for (const i of tgtAll) {
    const m = (i.title || '').match(/\[GEO优化\]#?(\d+)/);
    if (m) existingByNum.set(Number(m[1]), i);
  }
  log(`  found ${existingByNum.size} existing [GEO优化] tracker issues`);

  const created = [];
  const patched = [];
  const skipped = []; // 上游 issue 无可用 official_urls,本仓不接管
  const errors = [];

  for (const src of srcOpen) {
    const desiredBody = buildBody(src);
    const tgt = existingByNum.get(src.number);

    // 分支 A:已有 tracker → 看是否要 patch body(BODY_MARKER 不在就刷)
    if (tgt) {
      const tgtBody = tgt.body || '';
      if (tgtBody.includes(BODY_MARKER)) continue; // 已经是当前格式,跳过
      try {
        await retry(
          () =>
            gh(tgtToken).patch(`https://api.github.com/repos/${tgtRepo}/issues/${tgt.number}`, {
              body: desiredBody,
            }),
          { label: `patch [GEO优化]#${src.number} (#${tgt.number})` }
        );
        log(`🔄 patched body of #${tgt.number} for geo-workflow#${src.number}(从老格式刷成 v2)`);
        patched.push({ src_number: src.number, tgt_number: tgt.number, tgt_url: tgt.html_url });
      } catch (err) {
        log(`⚠ patch body of #${tgt.number} failed: ${err.message}`);
        errors.push({ src_number: src.number, error: `patch: ${err.message}` });
      }
      continue;
    }

    // 分支 B:没追踪过 — 先看上游有没有 official_urls,有才同步,没有就在上游评论"暂不接管"
    let check;
    try {
      check = await issueHasOfficialUrls(src);
    } catch (err) {
      log(`❌ check official_urls for ${srcRepo}#${src.number} failed: ${err.message}`);
      errors.push({ src_number: src.number, error: `check: ${err.message}` });
      continue;
    }

    if (check.hasUrls === false) {
      // 上游 issue 没法在本仓处理 → 在上游评论一次说明(幂等)
      try {
        const already = await hasSkippedCommentUpstream(gh(srcToken), srcRepo, src.number);
        if (already) {
          log(`⏭ ${srcRepo}#${src.number} 已有 skipped marker,不重复评论`);
        } else {
          await retry(
            () =>
              gh(srcToken).post(
                `https://api.github.com/repos/${srcRepo}/issues/${src.number}/comments`,
                { body: buildSkippedComment(check) }
              ),
            { label: `comment skipped to ${srcRepo}#${src.number}` }
          );
          log(`📨 commented skipped on ${srcRepo}#${src.number}(${check.reason})`);
        }
        skipped.push({ src_number: src.number, reason: check.reason });
      } catch (err) {
        log(`⚠ comment skipped to ${srcRepo}#${src.number} failed: ${err.message}`);
        errors.push({ src_number: src.number, error: `comment skipped: ${err.message}` });
      }
      continue;
    }

    if (check.hasUrls === null) {
      // 抓 questions/issue-map 失败 — 谨慎,不创建 tracker 也不评论上游,等下轮 cron 重试
      log(`⚠ ${srcRepo}#${src.number} 无法判定 official_urls 状况(${check.reason}),本轮跳过`);
      skipped.push({ src_number: src.number, reason: `判定失败: ${check.reason}` });
      continue;
    }

    // 有 official_urls → 创建 tracker
    // 关键:用 GEO_GITHUB_TOKEN(PAT)而非 GITHUB_TOKEN —
    // 这样 issues.opened event 才会 cascade 触发 analyze workflow(GITHUB_TOKEN 触发的 event 不级联)
    const title = buildTitle(src);
    try {
      const res = await retry(
        () =>
          gh(srcToken).post(`https://api.github.com/repos/${tgtRepo}/issues`, {
            title,
            body: desiredBody,
          }),
        { label: `create [GEO优化]#${src.number}` }
      );
      log(`✅ created #${res.data.number} for geo-workflow#${src.number}: ${src.title.slice(0, 50)}...`);
      log(`   (用 PAT 创建,issues.opened cascade 将自动触发 /analyze)`);
      created.push({
        src_number: src.number,
        tgt_number: res.data.number,
        tgt_url: res.data.html_url,
        valid_question_count: check.valid_question_count,
      });
    } catch (err) {
      log(`❌ create for geo-workflow#${src.number}: ${err.message}`);
      errors.push({ src_number: src.number, error: `create: ${err.message}` });
    }
  }

  log(
    `🏁 sync done: created=${created.length}, patched=${patched.length}, ` +
      `skipped(no official_urls)=${skipped.length}, errors=${errors.length}, ` +
      `unchanged=${srcOpen.length - created.length - patched.length - skipped.length - errors.length}`
  );

  if (errors.length > 0) {
    throw new Error(`sync-geo-issues 有 ${errors.length} 个失败:\n${errors.map((e) => `  - #${e.src_number}: ${e.error}`).join('\n')}`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
