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
import { readFileSync, writeFileSync } from 'node:fs';

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

const BUILD_SCRIPT_CANDIDATES = ['build:geo', 'build', 'docs:build', 'generate:geo', 'generate', 'build:prod'];
const OUTPUT_DIR_CANDIDATES = [
  'dist',
  'app/.vitepress/dist',
  '.vitepress/dist',
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
    env: {
      ...process.env,
      // 关 husky prepare/postinstall hook — 我们只跑 build,用不到 git hooks
      // 在 self-hosted runner 里 husky install 经常因 .husky/_/ 权限或 git config 不到位挂掉
      HUSKY: '0',
      CI: '1',
      // pnpm v10+ 默认对未授权的 postinstall hook(esbuild / @parcel/watcher 等 native deps)
      // 抛 ERR_PNPM_IGNORED_BUILDS 让 install exit 非零。我们 portal 仓做 build 需要这些 binary,
      // 但又不能去改 portal 仓的 package.json 加 onlyBuiltDependencies。
      // 这个 env 让 pnpm 降级为 warning(deps 实际照常装好),build 阶段再看是不是真缺 binary。
      npm_config_fail_on_ignored_builds: 'false',
    },
  });
}

// pnpm v10+ 的 ERR_PNPM_IGNORED_BUILDS — 不是真错(deps 已装好),只是 postinstall hook 被跳。
// 用来在 install 抛错时判定要不要软放过
function isPnpmIgnoredBuildsOnly(output) {
  if (!output) return false;
  if (!/ERR_PNPM_IGNORED_BUILDS/.test(output)) return false;
  // 进一步排除真的失败 — install 真挂时通常带 ELIFECYCLE / ERR_PNPM_FETCH / 404 等
  const realFailures = /(ELIFECYCLE|ERR_PNPM_FETCH|ENOENT|EACCES|ECONN|404 Not Found)/;
  return !realFailures.test(output);
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

  const nm = path.join(workDir, 'node_modules');
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
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const merged = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n').trim() || err.message;

    if (isPnpmIgnoredBuildsOnly(merged) && fs.existsSync(nm) && fs.readdirSync(nm).length > 0) {
      log(`⚠ install 抛 ERR_PNPM_IGNORED_BUILDS 但 node_modules 已建立,视作软警告,继续 build`);
      const ignored = merged.match(/Ignored build scripts:\s*([^\n]+)/)?.[1] || '?';
      log(`  跳过的 postinstall:${ignored.slice(0, 200)}`);

      if (pm === 'pnpm') {
        log(`  🔧 执行 pnpm approve-builds --all 以批准被跳过的构建脚本`);
        try {
          sh('pnpm approve-builds --all', workDir, 30000);
          log(`  ✅ approve-builds 完成`);
        } catch (approveErr) {
          log(`  ⚠ approve-builds 执行失败(非阻断): ${approveErr.message?.split('\n')[0]}`);
        }
      }

      log(`  ✅ deps installed (with warnings) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
      return {
        ok: false,
        phase: 'install',
        error: `${pm} install failed (exit=${err.status ?? '?'}):\n${merged.slice(-2000)}`,
        duration_ms: Date.now() - t0,
      };
    }
  }

  // build
  const beforeBuild = Date.now();
  log(`🏗  ${pm} run ${buildScript}(timeout ${buildTimeoutMs / 1000}s)`);
  try {
    sh(`${pm} run ${buildScript}`, workDir, buildTimeoutMs);
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const merged = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n').trim() || err.message;
    return {
      ok: false,
      phase: 'build',
      error: `${pm} run ${buildScript} failed (exit=${err.status ?? '?'}):\n${merged.slice(-3000)}`,
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
