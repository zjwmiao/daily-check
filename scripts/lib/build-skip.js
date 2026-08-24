/*
 * 构建跳过判断 (共享模块)
 *
 * 通过比较构建产物目录的 mtime 与 git 最新提交时间，
 * 判断是否需要重新构建：
 *   1. 构建目录不存在 → 需要
 *   2. 最新 commit 时间 > 构建产物 mtime → 需要
 *   其余 → 跳过
 */

import fs from 'fs';
import { execSync } from 'child_process';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

function getLatestCommitTime(workDir) {
  try {
    return execSync('git log -1 --format=%cI', {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export function needBuild(workDir, buildDir) {
  if (!buildDir || !fs.existsSync(buildDir)) {
    log(`⏭️  构建目录不存在，需要构建`);
    return true;
  }

  const commitTimeStr = getLatestCommitTime(workDir);
  if (!commitTimeStr) {
    log(`⏭️  无法获取 git commit 时间，需要构建`);
    return true;
  }

  const commitTime = new Date(commitTimeStr).getTime();
  const dirMtime = fs.statSync(buildDir).mtimeMs;

  if (commitTime > dirMtime) {
    log(`⏭️  最新 commit (${commitTimeStr}) 在构建产物 mtime 之后，需要构建`);
    return true;
  }

  log(`✅ 代码未变化 (最新 commit ${commitTimeStr})，跳过构建`);
  return false;
}
