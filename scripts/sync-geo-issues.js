#!/usr/bin/env node
// 把 geo-workflow 仓的新 P0 issue 同步成本仓的 [GEO优化]#N issue(只创建,不自动 /analyze)
// 也会用 BODY_MARKER 检测旧格式 tracker issue 并把 body PATCH 到当前格式(只刷自动生成段,不动手工评论)

import axios from 'axios';

// body 末尾埋个隐藏 marker(HTML 注释,显示时不可见),用来识别 body 格式版本
// — bump 版本号时,旧 marker 的 issue 会被识别为"需要刷"
const BODY_MARKER = '<!-- geo-sync-body v2 -->';

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

function buildBody(src) {
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
    `- 评论 \`/analyze\` 触发 4 维度分析`,
    `- /analyze 后评论 \`/fix\` 触发自动修复`,
    `- 修复 PR merge 后,定时 poll(geo-poll workflow)会自动重验 + 关闭本 issue`,
    '',
    `<sub>该 issue 由 geo-poll 自动同步(ADR-0017)</sub>`,
    '',
    BODY_MARKER,
  ].join('\n');
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
  if (!srcToken) throw new Error('GEO_GITHUB_TOKEN not set(读 geo-workflow private 需要)');
  if (!tgtToken) throw new Error('GITHUB_TOKEN not set(写本仓 issue 需要)');

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
  const errors = [];
  for (const src of srcOpen) {
    const desiredBody = buildBody(src);
    const tgt = existingByNum.get(src.number);

    if (!tgt) {
      // 没追踪过 → 创建
      const title = `[GEO优化]#${src.number}: ${src.title}`;
      try {
        const res = await retry(
          () =>
            gh(tgtToken).post(`https://api.github.com/repos/${tgtRepo}/issues`, {
              title,
              body: desiredBody,
            }),
          { label: `create [GEO优化]#${src.number}` }
        );
        log(`✅ created #${res.data.number} for geo-workflow#${src.number}: ${src.title.slice(0, 50)}...`);
        created.push({ src_number: src.number, tgt_number: res.data.number, tgt_url: res.data.html_url });
      } catch (err) {
        log(`❌ create for geo-workflow#${src.number}: ${err.message}`);
        errors.push({ src_number: src.number, error: err.message });
      }
      continue;
    }

    // 已追踪 → 看 body 是不是新格式(认 BODY_MARKER);老格式才 PATCH,避免反复刷
    const tgtBody = tgt.body || '';
    if (tgtBody.includes(BODY_MARKER)) {
      // body 已经是当前格式,跳过
      continue;
    }
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
  }

  log(
    `🏁 sync done: created=${created.length}, patched=${patched.length}, errors=${errors.length}, already-current=${
      srcOpen.length - created.length - patched.length - errors.length
    }`
  );

  if (errors.length > 0) {
    throw new Error(`sync-geo-issues 有 ${errors.length} 个失败:\n${errors.map((e) => `  - #${e.src_number}: ${e.error}`).join('\n')}`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
