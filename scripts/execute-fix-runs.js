#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'node:child_process';
import {
  createPullRequest,
  updatePullRequest,
  listPullRequests,
  getPullRequest,
  PullRequestAlreadyExistsError,
} from './lib/atomgit-api.js';
import { verifyFixesInWorkDir } from './checks/post-fix-verify.js';
import { buildPortal } from './lib/portal-build.js';
import { parseArgs, readInput } from './lib/utils.js';

process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'w-robot';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || '827900127@qq.com';
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL;

const T0 = Date.now();
function log(msg) {
  const t = ((Date.now() - T0) / 1000).toFixed(1);
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts} +${t}s] ${msg}`);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', ...opts });
}

function tryRun(cmd, opts) {
  try {
    sh(cmd, opts);
    return true;
  } catch (err) {
    log(`    ⚠ git failed: ${cmd} — ${err.message.split('\n')[0]}`);
    return false;
  }
}

function parsePayload(input) {
  if (input.skip) {
    return { skip: true, skip_reason: input.skip_reason, ...input };
  }
  
  if (!input.urls || input.urls.length === 0) {
    return { skip: true, skip_reason: '无待修复URLs', ...input };
  }

  const issues = input.issues || [];
  const firstIssue = issues[0] || input.issue;
  
  if (!firstIssue && !input.portal) {
    throw new Error('payload格式错误: 缺少issue或portal信息');
  }

  const portal = input.portal || {};
  const community = input.community || 'unknown';
  const issueNum = firstIssue?.number || input.issue_number || 0;

  const problems = (input.problems || []).map(p => ({
    dimension: p.dimension || 'all',
    description: p.description || '',
    url: p.url,
    suggestion: p.suggestion,
  }));

  return {
    skip: false,
    community,
    portal_owner: portal.owner,
    portal_repo: portal.repo,
    portal_base_branch: portal.base_branch || 'master',
    geo_issue_number: issueNum,
    geo_issue_url: firstIssue?.url || input.issue_url,
    geo_issue_title: firstIssue?.title || input.issue_title || `[GEO] #${issueNum}`,
    branch_name: `geo/fix-${community.toLowerCase()}-${issueNum}`,
    urls: input.urls,
    problems,
    portal,
  };
}

function portalCacheDir(run) {
  const base = process.env.GEO_PORTAL_CACHE_DIR || path.join(process.env.HOME || '/tmp', '.cache/geo-bot/portals');
  return path.join(base, `${run.portal_owner}-${run.portal_repo}`);
}

function clonePortal(run) {
  const token = process.env.ATOMGIT_TOKEN;
  if (!token) throw new Error('ATOMGIT_TOKEN missing');
  const url = `https://oauth2:${token}@atomgit.com/${run.portal_owner}/${run.portal_repo}.git`;
  const workDir = portalCacheDir(run);
  const base = run.portal_base_branch;

  log(`  📁 portal cache dir: ${workDir}`);
  fs.mkdirSync(path.dirname(workDir), { recursive: true });

  const hasCache = fs.existsSync(path.join(workDir, '.git'));
  if (hasCache) {
    log('  ♻️  cache exists, refreshing...');
    tryRun(`git remote set-url origin ${url}`, { cwd: workDir });
    tryRun(`git fetch --depth=1 origin ${base}`, { cwd: workDir });
    tryRun(`git checkout -B ${base} origin/${base}`, { cwd: workDir });
    tryRun(`git reset --hard origin/${base}`, { cwd: workDir });
    tryRun(`git clean -fdx`, { cwd: workDir });
    try {
      const leftovers = sh(`git for-each-ref --format='%(refname:short)' refs/heads/`, { cwd: workDir })
        .split('\n').map(s => s.trim()).filter(b => b && b !== base);
      for (const b of leftovers) tryRun(`git branch -D ${b}`, { cwd: workDir });
    } catch {}
  }

  if (!fs.existsSync(path.join(workDir, '.git'))) {
    log(`  📥 fresh clone: --depth=1 --branch=${base}`);
    const t0 = Date.now();
    sh(`git clone --depth=1 --branch=${base} ${url} ${workDir}`);
    log(`  ✅ cloned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return workDir;
}

function runOpencode(run, workDir, agentFile, contextFile, outputFile, options = {}) {
  const opencode = process.env.OPENCODE_BIN || 'opencode';
  const model = process.env.AI_MODEL || 'alibaba-cn/glm-5';
  const agent = process.env.AI_AGENT || 'build';
  const extra = process.env.AI_EXTRA_ARGS || '--dangerously-skip-permissions';
  const timeoutMs = options.timeoutMs ?? Number(process.env.OPENCODE_TIMEOUT_MS || 25 * 60 * 1000);
  const label = options.label || 'fix';
  const taskLine = options.taskLine || `请在 ${workDir} 内执行修复,并将处理清单写入 ${outputFile}。`;

  const prompt = `${fs.readFileSync(agentFile, 'utf-8')}\n\n## 上下文\n\n${fs.readFileSync(contextFile, 'utf-8')}\n\n${taskLine}`;

  const ctxDir = path.dirname(contextFile);
  const promptFile = path.join(ctxDir, `opencode-prompt-${label}-${run.community}-${run.geo_issue_number}.txt`);
  fs.writeFileSync(promptFile, prompt);

  const opencodeArgs = ['run', '-', '--model', model, '--agent', agent, ...(extra ? extra.split(' ').filter(Boolean) : [])];
  const argsShell = opencodeArgs.map(a => (/[\s'"]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ');

  log(`  🤖 starting opencode [${label}] (timeout=${timeoutMs / 1000}s)`);
  log(`     bin: ${opencode}, args: ${JSON.stringify(opencodeArgs)}`);

  const bashCmd = `${opencode} ${argsShell} < "${promptFile}" 2>/dev/null`;
  const stdoutDest = options.captureStdoutTo || outputFile;

  const t0 = Date.now();
  return new Promise(resolve => {
    let timedOut = false;
    const child = spawn('bash', ['-c', bashCmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: workDir,
      detached: true,
    });

    const outStream = stdoutDest ? fs.createWriteStream(stdoutDest) : null;
    outStream?.on('error', err => log(`  ⚠ write ${stdoutDest} failed: ${err.message}`));

    child.stdout.pipe(process.stderr, { end: false });
    if (outStream) {
      child.stdout.pipe(outStream, { end: false });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      log(`  ⏱ opencode 超时 ${timeoutMs / 1000}s, SIGKILL`);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    }, timeoutMs);

    child.on('close', () => outStream?.end());

    child.on('error', err => {
      clearTimeout(timer);
      log(`  ❌ opencode spawn error: ${err.message}`);
      outStream?.end();
      resolve({ ok: false, error: err.message });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      if (timedOut) {
        log(`  ❌ TIMEOUT after ${dur}s`);
        resolve({ ok: false, error: 'timeout' });
      } else if (signal) {
        log(`  ❌ killed by signal=${signal} after ${dur}s`);
        resolve({ ok: false, error: `signal: ${signal}` });
      } else {
        log(`  ✅ opencode exit=${code} in ${dur}s`);
        resolve({ ok: code === 0, promptFile });
      }
    });
  });
}

function buildSlimContext(run, workDir, outputFile) {
  const byUrl = new Map();
  for (const u of run.urls || []) {
    const url = u.url;
    if (!byUrl.has(url)) byUrl.set(url, { url, issues: [] });
    byUrl.get(url).issues.push({
      question_id: u.question_id,
      question_text: u.question_text,
    });
  }
  for (const p of run.problems || []) {
    if (byUrl.has(p.url)) {
      byUrl.get(p.url).issues.push({
        dimension: p.dimension,
        description: p.description,
      });
    }
  }
  return {
    portal: { owner: run.portal_owner, repo: run.portal_repo, work_dir: workDir, base_branch: run.portal_base_branch },
    fixes: [...byUrl.values()],
    output_file: outputFile,
  };
}

async function runCritic(run, workDir, ctxDir, agentOutput, verify) {
  const criticPrompt = process.env.CRITIC_AGENT_FILE;
  if (!criticPrompt || !fs.existsSync(criticPrompt)) {
    log(`  ⚠ critic prompt 未配置,跳过`);
    return null;
  }

  let diff = '';
  try { diff = sh('git diff --no-color HEAD', { cwd: workDir }); } catch {}
  if (diff.length > 20000) diff = diff.slice(0, 20000) + `\n\n... (截断)`;

  const contextPayload = {
    portal: { owner: run.portal_owner, repo: run.portal_repo, base_branch: run.portal_base_branch },
    urls: run.urls,
    problems: run.problems,
    agent_output: agentOutput || '(empty)',
    verify_summary: verify?.summary || null,
    verify_checks: verify?.checks || [],
    git_diff: diff,
  };
  const criticContextFile = path.join(ctxDir, `critic-context-${run.community}-${run.geo_issue_number}.json`);
  fs.writeFileSync(criticContextFile, JSON.stringify(contextPayload, null, 2));

  const criticOut = path.join(ctxDir, `critic-output-${run.community}-${run.geo_issue_number}.md`);
  const oc = await runOpencode(run, workDir, criticPrompt, criticContextFile, criticOut, {
    label: 'critic',
    timeoutMs: 5 * 60 * 1000,
    captureStdoutTo: criticOut,
    taskLine: '你是 critic,只审不改。不要执行任何 git 操作、不要修改任何文件,审查结论(Markdown)直接 print 到 stdout。',
  });

  if (!oc.ok) {
    log(`  ⚠ critic opencode 失败`);
    return { ok: false, verdict: 'unknown' };
  }

  let body = '';
  if (fs.existsSync(criticOut)) body = fs.readFileSync(criticOut, 'utf-8').slice(0, 4000);
  const verdictMatch = body.match(/Critic 结论\s*[:：]\s*(pass|warn|block)/i);
  const verdict = (verdictMatch && verdictMatch[1].toLowerCase()) || 'unknown';

  let reason = null;
  if (verdictMatch) {
    const tail = body.slice(body.indexOf(verdictMatch[0]) + verdictMatch[0].length);
    for (const line of tail.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) break;
      reason = t.replace(/^[(（]/, '').replace(/[)）]$/, '').trim();
      break;
    }
  }
  log(`  🧐 critic verdict=${verdict}${reason ? ` — ${reason.slice(0, 80)}` : ''}`);
  return { ok: true, body, verdict, reason };
}

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

function buildPrBody(run, verify, critic, buildInfo) {
  const relations = [run.geo_issue_url ? `[issue #${run.geo_issue_number}](${run.geo_issue_url})` : null].filter(Boolean);

  const verifyBadge = verify?.summary ? [
    verify.summary.fixed > 0 ? `✅ 已修复 ${verify.summary.fixed}` : null,
    verify.summary.still_failing > 0 ? `❌ 未修复 ${verify.summary.still_failing}` : null,
    verify.summary.deferred > 0 ? `⏭ 跳过 ${verify.summary.deferred}` : null,
  ].filter(Boolean).join(' / ') : null;

  const lines = [
    `**关联**: ${relations.join(' · ') || '(无)'}`,
    verifyBadge ? `\n**Verify**: ${verifyBadge}\n` : '',
    `| URL | 问题 |`,
    `| --- | --- |`,
    ...run.urls.map(u => `| [${shortUrl(u.url)}](${u.url}) | ${u.question_id || '-'} |`),
  ];

  if (verify?.checks?.length > 0) {
    lines.push('', '**Verify详情**', '', '| URL | 状态 | Before | After |', '| --- | --- | --- | --- |');
    for (const c of verify.checks) {
      const icon = { fixed: '✅', still_failing: '❌', deferred: '⏭', unverifiable: '❓' }[c.status] || '·';
      lines.push(`| [${shortUrl(c.url)}](${c.url}) | ${icon} ${c.status} | ${cell(c.before || '-')} | ${cell(c.after || '-')} |`);
    }
  }

  if (critic?.body) {
    const verdictBadge = { pass: '🟢', warn: '🟡', block: '🔴' }[critic.verdict] || '❓';
    lines.push('', '<details open>', `<summary>📋 Critic: ${verdictBadge} ${critic.verdict}</summary>`, '', critic.body.slice(0, 3000), '', '</details>');
  }

  lines.push('', '<sub>由 geo-develop 自动化生成</sub>');
  return lines.join('\n');
}

async function pushAndPr(run, workDir, verify, critic, buildInfo) {
  for (const f of fs.readdirSync(workDir)) {
    if (/^output(-.*)?\.md$/i.test(f)) {
      try { fs.unlinkSync(path.join(workDir, f)); } catch {}
    }
  }

  const status = sh('git status --porcelain', { cwd: workDir }).trim();
  if (!status) {
    log('  ⏭ no changes from agent, skipping push');
    return { has_changes: false };
  }
  log(`  📝 agent made ${status.split('\n').length} file change(s)`);

  log('  📦 git add + commit + push');
  sh('git add -A \':!pnpm-workspace.yaml\'', { cwd: workDir });
  const msg = `feat(geo): fix discoverability for issue #${run.geo_issue_number} (${run.community})`;
  sh(`git commit -m "${msg}"`, { cwd: workDir });
  sh(`git push -f origin HEAD:${run.branch_name}`, { cwd: workDir });
  log(`  ✅ pushed to ${run.branch_name}`);

  const prTitle = `[GEO] fix #${run.geo_issue_number}: ${run.geo_issue_title}`;
  const prBody = buildPrBody(run, verify, critic, buildInfo);

  const existing = await listPullRequests({
    owner: run.portal_owner,
    repo: run.portal_repo,
    head: run.branch_name,
    state: 'open',
  });

  let pr, action;
  if (Array.isArray(existing) && existing.length > 0) {
    log(`  ♻️ PR existed (#${existing[0].number}), updating`);
    pr = await updatePullRequest({
      owner: run.portal_owner,
      repo: run.portal_repo,
      number: existing[0].number,
      title: prTitle,
      body: prBody,
    }) || existing[0];
    action = 'updated';
  } else {
    log('  ✨ creating new PR');
    try {
      pr = await createPullRequest({
        owner: run.portal_owner,
        repo: run.portal_repo,
        title: prTitle,
        body: prBody,
        head: run.branch_name,
        base: run.portal_base_branch,
      });
      action = 'created';
    } catch (err) {
      if (err instanceof PullRequestAlreadyExistsError) {
        log(`  ♻️ atomgit 报已有 PR #${err.existingNumber}`);
        pr = await updatePullRequest({
          owner: run.portal_owner,
          repo: run.portal_repo,
          number: err.existingNumber,
          title: prTitle,
          body: prBody,
        }) || { number: err.existingNumber };
        action = 'updated';
      } else {
        throw err;
      }
    }
  }

  const prUrl = pr.html_url || pr.url || `https://atomgit.com/${run.portal_owner}/${run.portal_repo}/pulls/${pr.number}`;
  log(`  ✅ PR ${action}: ${prUrl}`);

  return { has_changes: true, pr_url: prUrl, pr_number: pr.number, pr_action: action };
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

  const run = parsePayload(input);

  if (run.skip) {
    log(`⏭ 跳过: ${run.skip_reason}`);
    const result = {
      run_at: new Date().toISOString(),
      issue_number: run.geo_issue_number || input.issue?.number,
      issue_url: run.geo_issue_url || input.issue?.url,
      community: run.community,
      portal: run.portal,
      skip: true,
      skip_reason: run.skip_reason,
      urls: run.urls || [],
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  log(`▶ 执行修复: ${run.community} issue #${run.geo_issue_number}`);
  log(`  ${run.urls.length} URLs, branch=${run.branch_name}`);

  const agentFile = process.env.AGENT_FILE;
  if (!agentFile || !fs.existsSync(agentFile)) {
    throw new Error(`AGENT_FILE not found: ${agentFile}`);
  }

  const result = {
    run_at: new Date().toISOString(),
    issue_number: run.geo_issue_number,
    issue_url: run.geo_issue_url,
    community: run.community,
    portal: { owner: run.portal_owner, repo: run.portal_repo },
    urls: run.urls,
  };

  try {
    log('  [1/7] clonePortal');
    const workDir = clonePortal(run);

    log('  [2/7] baseline build');
    let buildOutputDir = null;
    let baselineSkipped = false;
    const baseline = await buildPortal(workDir);
    result.baseline_build = { ok: baseline.ok, skipped: baseline.skipped, phase: baseline.phase, duration_ms: baseline.duration_ms };
    if (baseline.ok) {
      log(`  ✅ baseline build ok`);
      buildOutputDir = baseline.output_dir;
    } else if (baseline.skipped) {
      log(`  ⏭ baseline build 跳过: ${baseline.reason}`);
      baselineSkipped = true;
    } else {
      log(`  ⚠ baseline build 失败,继续执行`);
      baselineSkipped = true;
    }

    const ctxDir = args.output ? path.dirname(path.resolve(args.output)) : process.env.RUN_DIR || '/tmp';
    const contextFile = path.join(ctxDir, `fix-context-${run.community}-${run.geo_issue_number}.json`);
    const outputMd = path.join(ctxDir, `output-${run.community}-${run.geo_issue_number}.md`);
    fs.writeFileSync(contextFile, JSON.stringify(buildSlimContext(run, workDir, outputMd), null, 2));

    log('  [3/7] runOpencode');
    const ocRes = await runOpencode(run, workDir, agentFile, contextFile);
    result.agent_ok = ocRes.ok;
    let agentOutput = '';
    if (fs.existsSync(outputMd)) {
      agentOutput = fs.readFileSync(outputMd, 'utf-8').slice(0, 4000);
    }
    if (!ocRes.ok) {
      result.status = 'agent_failed';
      result.error = ocRes.error || 'opencode failed';
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    log('  [4/7] post-agent build');
    if (baselineSkipped) {
      result.build = { skipped: true, reason: 'baseline-skipped' };
    } else {
      const build = await buildPortal(workDir);
      result.build = { ok: build.ok, skipped: build.skipped, phase: build.phase, duration_ms: build.duration_ms };
      if (build.ok) {
        buildOutputDir = build.output_dir;
        log(`  ✅ post-agent build ok`);
      } else {
        log(`  ⚠ post-agent build 失败`);
      }
    }

    log('  [5/7] verify');
    const verify = verifyFixesInWorkDir({
      workDir,
      agentOutput: agentOutput || '',
      problems: run.problems,
      community: run.community,
      outputDir: buildOutputDir,
    });
    result.verify = verify;
    log(`  📊 verify: fixed=${verify.summary.fixed} still_failing=${verify.summary.still_failing}`);

    if (verify.blocking) {
      result.status = 'verify_failed';
      result.error = 'pre-push verify 零进展';
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    log('  [6/7] critic');
    const critic = process.env.CRITIC_DISABLE === '1' ? null : await runCritic(run, workDir, ctxDir, agentOutput || '', verify);
    if (critic) result.critic = { verdict: critic.verdict, reason: critic.reason };

    if (critic && critic.verdict !== 'pass' && critic.verdict !== 'warn') {
      result.status = 'critic_blocked';
      result.error = `critic 判 ${critic.verdict}`;
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    log('  [7/7] pushAndPr');
    const prRes = await pushAndPr(run, workDir, verify, critic, { baseline: result.baseline_build, postAgent: result.build });
    Object.assign(result, prRes);
    result.status = prRes.has_changes ? 'pr_created' : 'no_changes';
    log(`  ✅ done: ${result.status}`);
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
    log(`  ❌ failed: ${err.message}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});