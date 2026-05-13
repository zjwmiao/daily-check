#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'node:child_process';
import { createPullRequest, listPullRequests, addIssueComment } from './lib/atomgit-api.js';

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

function clonePortal(run, workDir) {
  const token = process.env.ATOMGIT_TOKEN;
  if (!token) throw new Error('ATOMGIT_TOKEN missing');
  const url = `https://oauth2:${token}@atomgit.com/${run.portal_owner}/${run.portal_repo}.git`;
  fs.rmSync(workDir, { recursive: true, force: true });
  sh(`git clone --depth=1 --branch=${run.portal_base_branch} ${url} ${workDir}`);
  sh(`git config user.name "geo-develop-bot"`, { cwd: workDir });
  sh(`git config user.email "geo-develop-bot@noreply.local"`, { cwd: workDir });
}

function runOpencode(run, workDir, agentFile, contextFile, outputFile) {
  const opencode = process.env.OPENCODE_BIN || 'opencode';
  const model = process.env.AI_MODEL || 'alibaba-cn/glm-5';
  const agent = process.env.AI_AGENT || 'build';
  const extra = process.env.AI_EXTRA_ARGS || '';

  const prompt = `${fs.readFileSync(agentFile, 'utf-8')}\n\n## 上下文\n\n${fs.readFileSync(contextFile, 'utf-8')}\n\n请在 ${workDir} 内执行修复,并将处理清单写入 ${outputFile}。`;

  const res = spawnSync(opencode, ['run', '-', '--model', model, '--agent', agent, ...(extra ? extra.split(' ') : [])], {
    input: prompt,
    encoding: 'utf-8',
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: workDir,
  });
  return res.status === 0;
}

async function pushAndPr(run, workDir) {
  const status = sh('git status --porcelain', { cwd: workDir }).trim();
  if (!status) return { has_changes: false };

  sh('git add -A', { cwd: workDir });
  const msg = `feat(geo): fix discoverability for #${run.geo_issue_number} (${run.community})`;
  sh(`git commit -m "${msg}"`, { cwd: workDir });
  sh(`git push -f origin HEAD:${run.branch_name}`, { cwd: workDir });

  const head = `${run.portal_owner}:${run.branch_name}`;
  let pr;
  try {
    const existing = await listPullRequests({
      owner: run.portal_owner,
      repo: run.portal_repo,
      head,
      state: 'open',
    });
    if (Array.isArray(existing) && existing.length > 0) {
      pr = existing[0];
    }
  } catch {
    // ignore
  }

  if (!pr) {
    const triggerRepo = process.env.TRIGGER_REPO;
    const triggerIssue = process.env.TRIGGER_ISSUE;
    const body = [
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

    pr = await createPullRequest({
      owner: run.portal_owner,
      repo: run.portal_repo,
      title: `[GEO] fix #${run.geo_issue_number}: ${run.geo_issue_title}`,
      body,
      head: run.branch_name,
      base: run.portal_base_branch,
    });
  }

  const prUrl = pr.html_url || pr.url || `https://atomgit.com/${run.portal_owner}/${run.portal_repo}/pulls/${pr.number}`;
  return { has_changes: true, pr_url: prUrl, pr_number: pr.number };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan || !args.output) {
    console.error('Usage: --plan=fix-plan.json --output=fix-results.json');
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(args.plan, 'utf-8'));
  const agentFile = process.env.AGENT_FILE;
  if (!agentFile || !fs.existsSync(agentFile)) {
    throw new Error(`AGENT_FILE not found: ${agentFile}`);
  }

  const results = [];
  for (const run of plan.runs) {
    if (run.skip) {
      results.push({ ...run, status: 'skipped' });
      continue;
    }

    const workDir = `/tmp/geo-fix/${run.community.toLowerCase()}-${run.geo_issue_number}`;
    const result = { community: run.community, geo_issue_number: run.geo_issue_number };

    try {
      clonePortal(run, workDir);

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

      const outputMd = path.join(workDir, 'output.md');
      const ok = runOpencode(run, workDir, agentFile, contextFile, outputMd);
      result.agent_ok = ok;
      if (fs.existsSync(outputMd)) {
        result.agent_output = fs.readFileSync(outputMd, 'utf-8').slice(0, 4000);
      }

      const prRes = await pushAndPr(run, workDir);
      Object.assign(result, prRes);

      if (run.portal_issue_url && prRes.pr_url) {
        try {
          await addIssueComment({
            owner: run.portal_owner,
            repo: run.portal_repo,
            issue_number: run.portal_issue_number,
            body: `🛠 已提交修复 PR: ${prRes.pr_url}`,
          });
        } catch (err) {
          result.portal_comment_error = err.message;
        }
      }

      result.status = prRes.has_changes ? 'pr_created' : 'no_changes';
    } catch (err) {
      result.status = 'error';
      result.error = err.message;
    }

    results.push(result);
  }

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify({ run_at: new Date().toISOString(), results }, null, 2));
  console.error(`✅ ${results.length} run(s) executed → ${args.output}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
