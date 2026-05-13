#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'node:child_process';
import { createPullRequest, updatePullRequest, listPullRequests } from './lib/atomgit-api.js';

// 用 env 控制 git 作者/提交者身份,不污染 repo 级 git config
process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'geo-develop-bot';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 'geo-develop-bot@noreply.local';
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL;

const T0 = Date.now();
function log(msg) {
  const t = ((Date.now() - T0) / 1000).toFixed(1);
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts} +${t}s] ${msg}`);
}

function planRunsFromPayload(payload) {
  const runs = [];
  for (const issue of payload.issues || []) {
    const flatProblems = [];
    for (const q of issue.questions || []) {
      for (const u of q.official_urls || []) {
        for (const p of u.problems || []) {
          flatProblems.push({
            question_id: q.id,
            question_text: q.question,
            url: u.url,
            ...p,
          });
        }
      }
    }
    if (flatProblems.length === 0) {
      runs.push({ ...issue, skip: true, skip_reason: 'no critical/important problems' });
      continue;
    }
    runs.push({
      community: issue.community,
      geo_issue_number: issue.geo_issue_number,
      geo_issue_url: issue.geo_issue_url,
      geo_issue_title: issue.geo_issue_title,
      portal_owner: issue.portal.owner,
      portal_repo: issue.portal.repo,
      portal_base_branch: issue.portal.default_branch || 'master',
      branch_name: `geo/fix-${issue.community.toLowerCase()}-${issue.geo_issue_number}`,
      problems: flatProblems,
      issue_payload: issue,
    });
  }
  return runs;
}

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

function portalCacheDir(run) {
  const base =
    process.env.GEO_PORTAL_CACHE_DIR ||
    path.join(process.env.HOME || '/tmp', '.cache/geo-bot/portals');
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
    log('     - git remote set-url origin');
    const okRemote = tryRun(`git remote set-url origin ${url}`, { cwd: workDir });
    log(`     - git fetch --depth=1 origin ${base}`);
    const okFetch = okRemote && tryRun(`git fetch --depth=1 origin ${base}`, { cwd: workDir });
    log(`     - git checkout -B ${base} origin/${base}`);
    const okCheckout = okFetch && tryRun(`git checkout -B ${base} origin/${base}`, { cwd: workDir });
    log(`     - git reset --hard origin/${base}`);
    const okReset = okCheckout && tryRun(`git reset --hard origin/${base}`, { cwd: workDir });
    log('     - git clean -fdx');
    const okClean = okReset && tryRun(`git clean -fdx`, { cwd: workDir });
    if (okClean) {
      const leftovers = sh(`git for-each-ref --format=%(refname:short) refs/heads/`, { cwd: workDir })
        .split('\n')
        .map((s) => s.trim())
        .filter((b) => b && b !== base);
      for (const b of leftovers) tryRun(`git branch -D ${b}`, { cwd: workDir });
      log(`  ✅ cache reused (cleaned ${leftovers.length} stale branch)`);
    } else {
      log('  ⚠️  cache corrupt, will re-clone');
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(path.join(workDir, '.git'))) {
    log(`  📥 fresh clone: --depth=1 --branch=${base} (这一步可能耗时长,大仓需几分钟)`);
    const t0 = Date.now();
    sh(`git clone --depth=1 --branch=${base} ${url} ${workDir}`);
    log(`  ✅ cloned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return workDir;
}

function runOpencode(run, workDir, agentFile, contextFile, outputFile) {
  const opencode = process.env.OPENCODE_BIN || 'opencode';
  const model = process.env.AI_MODEL || 'alibaba-cn/glm-5';
  const agent = process.env.AI_AGENT || 'build';
  const extra = process.env.AI_EXTRA_ARGS || '';
  const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS || 20 * 60 * 1000); // 默认 20min

  const prompt = `${fs.readFileSync(agentFile, 'utf-8')}\n\n## 上下文\n\n${fs.readFileSync(contextFile, 'utf-8')}\n\n请在 ${workDir} 内执行修复,并将处理清单写入 ${outputFile}。`;

  log(`  🤖 starting opencode (model=${model}, agent=${agent}, timeout=${timeoutMs / 1000}s)`);
  log(`     prompt size: ${prompt.length} chars`);
  const t0 = Date.now();
  const res = spawnSync(
    opencode,
    ['run', '-', '--model', model, '--agent', agent, ...(extra ? extra.split(' ') : [])],
    {
      input: prompt,
      encoding: 'utf-8',
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: workDir,
      timeout: timeoutMs,
    }
  );
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.error && res.error.code === 'ETIMEDOUT') {
    log(`  ❌ opencode TIMEOUT after ${dur}s (limit: ${timeoutMs / 1000}s)`);
    return false;
  }
  if (res.error) {
    log(`  ❌ opencode spawn error: ${res.error.message}`);
    return false;
  }
  log(`  ✅ opencode exit=${res.status} in ${dur}s`);
  return res.status === 0;
}

async function pushAndPr(run, workDir) {
  log('  🔍 checking git status...');
  const status = sh('git status --porcelain', { cwd: workDir }).trim();
  if (!status) {
    log('  ⏭ no changes from agent, skipping push');
    return { has_changes: false };
  }
  log(`  📝 agent made ${status.split('\n').length} file change(s)`);

  log('  📦 git add + commit + push');
  sh('git add -A', { cwd: workDir });
  const msg = `feat(geo): fix discoverability for #${run.geo_issue_number} (${run.community})`;
  sh(`git commit -m "${msg}"`, { cwd: workDir });
  const t0 = Date.now();
  sh(`git push -f origin HEAD:${run.branch_name}`, { cwd: workDir });
  log(`  ✅ pushed to ${run.branch_name} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  log('  🔍 list existing PRs');
  const head = `${run.portal_owner}:${run.branch_name}`;
  const triggerRepo = process.env.TRIGGER_REPO;
  const triggerIssue = process.env.TRIGGER_ISSUE;
  const prTitle = `[GEO] fix #${run.geo_issue_number}: ${run.geo_issue_title}`;
  const prBody = [
    `## 自动化 GEO 修复`,
    ``,
    `- 关联 geo-workflow issue: ${run.geo_issue_url}`,
    `- 触发 issue: https://github.com/${triggerRepo}/issues/${triggerIssue}`,
    run.portal_issue_url ? `- portal issue: ${run.portal_issue_url}` : '',
    ``,
    `### 问题清单(critical + important)`,
    ``,
    ...run.problems.map((p) => `- [${p.severity}] ${p.dimension || p.category} @ ${p.url}: ${p.description}`),
  ]
    .filter((l) => l !== '')
    .join('\n');

  let pr;
  let action;
  const existing = await listPullRequests({
    owner: run.portal_owner,
    repo: run.portal_repo,
    head,
    state: 'open',
  });
  if (Array.isArray(existing) && existing.length > 0) {
    pr = existing[0];
    log(`  ♻️  PR existed (#${pr.number}), updating title/body`);
    try {
      const updated = await updatePullRequest({
        owner: run.portal_owner,
        repo: run.portal_repo,
        number: pr.number,
        title: prTitle,
        body: prBody,
      });
      if (updated) pr = updated;
      action = 'updated';
    } catch (err) {
      log(`  ⚠ updatePullRequest failed, reusing existing: ${err.message}`);
      action = 'reused';
    }
  } else {
    log('  ✨ creating new PR');
    pr = await createPullRequest({
      owner: run.portal_owner,
      repo: run.portal_repo,
      title: prTitle,
      body: prBody,
      head: run.branch_name,
      base: run.portal_base_branch,
    });
    action = 'created';
  }
  const prUrl =
    pr.html_url || pr.url || `https://atomgit.com/${run.portal_owner}/${run.portal_repo}/pulls/${pr.number}`;
  log(`  ✅ PR ${action}: ${prUrl}`);
  return { has_changes: true, pr_url: prUrl, pr_number: pr.number, pr_action: action };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.payload || !args.output) {
    console.error('Usage: --payload=fix-payload.json --output=fix-results.json');
    process.exit(1);
  }
  log(`▶️  start: payload=${args.payload}`);

  const payload = JSON.parse(fs.readFileSync(args.payload, 'utf-8'));
  log(`📄 payload loaded: version=${payload.version}, issues=${(payload.issues || []).length}`);

  const agentFile = process.env.AGENT_FILE;
  if (!agentFile || !fs.existsSync(agentFile)) {
    throw new Error(`AGENT_FILE not found: ${agentFile}`);
  }
  log(`📜 agent prompt: ${agentFile}`);

  const runs = planRunsFromPayload(payload);
  const skipped = runs.filter((r) => r.skip).length;
  const active = runs.length - skipped;
  log(`📋 planned ${runs.length} run(s): ${active} active, ${skipped} skipped`);

  const results = [];
  let idx = 0;
  for (const run of runs) {
    idx++;
    if (run.skip) {
      log(`⏭  [${idx}/${runs.length}] ${run.community} #${run.geo_issue_number} — ${run.skip_reason}`);
      results.push({
        community: run.community,
        geo_issue_number: run.geo_issue_number,
        status: 'skipped',
        skip_reason: run.skip_reason,
      });
      continue;
    }

    log(`▶️  [${idx}/${runs.length}] ${run.community} #${run.geo_issue_number} — ${run.problems.length} problem(s), branch=${run.branch_name}`);
    const result = { community: run.community, geo_issue_number: run.geo_issue_number };
    const tRun = Date.now();

    try {
      log('  [1/4] clonePortal');
      const workDir = clonePortal(run);

      log('  [2/4] write context file');
      const ctxDir = path.dirname(path.resolve(args.output));
      const contextFile = path.join(ctxDir, `fix-context-${run.community}-${run.geo_issue_number}.json`);
      fs.writeFileSync(
        contextFile,
        JSON.stringify(
          {
            portal: { owner: run.portal_owner, repo: run.portal_repo, work_dir: workDir },
            geo_issue_url: run.geo_issue_url,
            trigger_issue_url: `https://github.com/${process.env.TRIGGER_REPO}/issues/${process.env.TRIGGER_ISSUE}`,
            run_dir: ctxDir,
            problems: run.problems,
            analysis: run.issue_payload,
          },
          null,
          2
        )
      );

      log('  [3/4] runOpencode');
      const outputMd = path.join(workDir, 'output.md');
      const ok = runOpencode(run, workDir, agentFile, contextFile, outputMd);
      result.agent_ok = ok;
      if (fs.existsSync(outputMd)) {
        result.agent_output = fs.readFileSync(outputMd, 'utf-8').slice(0, 4000);
      }

      log('  [4/4] pushAndPr');
      const prRes = await pushAndPr(run, workDir);
      Object.assign(result, prRes);

      result.status = prRes.has_changes ? 'pr_created' : 'no_changes';
      log(`  ✅ done in ${((Date.now() - tRun) / 1000).toFixed(1)}s — ${result.status}${prRes.pr_url ? ' ' + prRes.pr_url : ''}`);
    } catch (err) {
      result.status = 'error';
      result.error = err.message;
      log(`  ❌ failed in ${((Date.now() - tRun) / 1000).toFixed(1)}s: ${err.message}`);
    }

    results.push(result);
  }

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ run_at: new Date().toISOString(), results }, null, 2));
  log(`🏁 all done: ${results.length} run(s), total ${((Date.now() - T0) / 1000).toFixed(1)}s → ${args.output}`);
}

main().catch((err) => {
  log(`❌ fatal: ${err.message}`);
  process.exit(1);
});
