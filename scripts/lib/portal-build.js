// Portal build runner — 在 workDir(portal 仓 clone)里跑一次构建,产出 dist
// 用途:让 post-fix-verify 能在"修完之后构建出来的 HTML"上验 schema / static-render / TDK,
// 而不是只看源码或等线上 geo-poll 重验。
//
// 检测策略:
//   - package manager:看 lockfile(pnpm-lock.yaml > yarn.lock > package-lock.json),默认 npm
//   - build script:package.json scripts.build > scripts['docs:build'] > scripts.generate > scripts['build:prod']
//   - output dir:构建后扫一组候选目录,挑最后修改时间最新的
//
// 失败模式:
//   - 无 package.json / 无 build script → { ok:false, skipped:true } (无法兜底,降级回 deferred)
//   - install 失败 / build 失败 / 超时 → { ok:false, error:... }(强信号,通常说明 agent 改坏了 build)
//   - 找不到 output 目录 → { ok:false, error:'output dir not found' }

import fs from 'fs';
import path from 'path';
import { execSync } from 'node:child_process';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] portal-build ${msg}`);
}

function detectPm(workDir) {
  if (fs.existsSync(path.join(workDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(workDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(workDir, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(workDir, 'package.json'))) return 'npm';
  return null;
}

const BUILD_SCRIPT_CANDIDATES = ['build', 'docs:build', 'generate', 'build:prod'];
const OUTPUT_DIR_CANDIDATES = [
  'dist',
  '.vitepress/dist',
  'docs/.vitepress/dist',
  '.output/public',
  '.nuxt/dist',
  '.next/out',
  'out',
  'build',
  'public',
];

function detectBuildScript(pkg) {
  if (!pkg.scripts) return null;
  for (const name of BUILD_SCRIPT_CANDIDATES) {
    if (pkg.scripts[name]) return name;
  }
  return null;
}

// 选出 build 产物目录 — 在候选里找存在 + 在 build 之后被修改过的
function detectOutputDir(workDir, beforeBuildMs) {
  let best = null;
  let bestMtime = 0;
  for (const cand of OUTPUT_DIR_CANDIDATES) {
    const p = path.join(workDir, cand);
    if (!fs.existsSync(p)) continue;
    try {
      const st = fs.statSync(p);
      if (!st.isDirectory()) continue;
      const mtime = st.mtimeMs;
      // 必须是 build 之后修改的(允许 ±5s 时钟偏移)
      if (mtime < beforeBuildMs - 5000) continue;
      if (mtime > bestMtime) {
        bestMtime = mtime;
        best = cand;
      }
    } catch {
      /* ignore */
    }
  }
  return best;
}

function sh(cmd, cwd, timeoutMs) {
  return execSync(cmd, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 100 * 1024 * 1024,
  });
}

export async function buildPortal(
  workDir,
  { installTimeoutMs = 5 * 60 * 1000, buildTimeoutMs = 10 * 60 * 1000 } = {}
) {
  const pkgPath = path.join(workDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, skipped: true, reason: 'no package.json — not a node project' };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const pm = detectPm(workDir);
  if (!pm) return { ok: false, skipped: true, reason: 'no package manager detected' };
  const buildScript = detectBuildScript(pkg);
  if (!buildScript) {
    return { ok: false, skipped: true, reason: 'no build script in package.json' };
  }

  log(`pm=${pm} build=${buildScript}`);

  // install — node_modules 已有就跳(workDir 是 portal 持久 cache,大多数情况下 deps 已就位)
  const nm = path.join(workDir, 'node_modules');
  if (!fs.existsSync(nm)) {
    log(`📦 ${pm} install (--frozen-lockfile / --immutable / ci)`);
    const t0 = Date.now();
    try {
      const cmd =
        pm === 'pnpm' ? 'pnpm install --frozen-lockfile'
        : pm === 'yarn' ? 'yarn install --immutable'
        : 'npm ci';
      sh(cmd, workDir, installTimeoutMs);
      log(`✅ deps installed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      const tail = (err.stderr?.toString() || err.message || '').slice(-1000);
      return {
        ok: false,
        phase: 'install',
        error: `${pm} install failed: ${tail}`,
        duration_ms: Date.now() - t0,
      };
    }
  } else {
    log(`♻️  node_modules 已存在,跳过 install`);
  }

  // build
  const beforeBuild = Date.now();
  log(`🏗  ${pm} run ${buildScript}(timeout ${buildTimeoutMs / 1000}s)`);
  try {
    sh(`${pm} run ${buildScript}`, workDir, buildTimeoutMs);
  } catch (err) {
    const tail = (err.stderr?.toString() || err.message || '').slice(-2000);
    return {
      ok: false,
      phase: 'build',
      error: `${pm} run ${buildScript} failed: ${tail}`,
      duration_ms: Date.now() - beforeBuild,
    };
  }
  const buildDuration = Date.now() - beforeBuild;

  const outputDir = detectOutputDir(workDir, beforeBuild);
  if (!outputDir) {
    return {
      ok: false,
      phase: 'detect-output',
      error: `build 成功但未在候选目录(${OUTPUT_DIR_CANDIDATES.join(', ')})找到产物`,
      duration_ms: buildDuration,
    };
  }

  log(`✅ build done in ${(buildDuration / 1000).toFixed(1)}s → ${outputDir}/`);
  return {
    ok: true,
    output_dir: path.join(workDir, outputDir),
    output_dir_rel: outputDir,
    build_script: buildScript,
    pm,
    duration_ms: buildDuration,
  };
}
