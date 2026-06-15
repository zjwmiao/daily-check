import fs from 'fs';
import { join } from 'path';

export const HTML_IGNORE = [
  /(200|404|error)\.html$/,
  /baidu_verify/,
  /\b(blog|blogs|news|showcase|showcases)\b/,
];

export const CHECK_DIMENSIONS = ['robots-txt', 'sitemap-access', 'sitemap-tdk', 'sitemap-schema', 'url-access', 'llms-txt', 'sitemap-coverage', 'ssr-rendering'];

export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

export function shouldIgnore(pathname, ignorePatterns) {
  if (!ignorePatterns?.length) return false;
  for (const pattern of ignorePatterns) {
    try { if (new RegExp(pattern).test(pathname)) return true; } catch {}
  }
  return false;
}

export function pickRandom(arr, n) {
  if (arr.length <= n) return arr.slice();
  const shuffled = arr.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export function pathnameToKey(pathname) {
  let s = pathname.replace(/^\//, '').replace(/\/$/, '').replace(/(\/index)?\.html$/i, '');
  return s || 'index';
}

export function normalizePathname(p) {
  let s = p;
  try {
    s = decodeURIComponent(p);
  } catch {
    // 保留原值
  }
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  s = s.replace(/\.html$/i, '');
  return s === '' ? '/' : s;
}

export function matchGlob(pattern, pathname) {
  const re = pattern
    .replace(/\*\*/g, '(.*)')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`).test(pathname);
}

export function* iterateFiles(rootPath, pattern, ignore) {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return;
  }
  if (!pattern) {
    return;
  }

  const ignores = Array.isArray(ignore) ? ignore : (ignore ? [ignore] : []);
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  function* itr(p) {
    outer: for (const file of fs.readdirSync(p, { withFileTypes: true })) {
      const filePath = join(p, file.name);
      for (const ig of ignores) {
        if (ig.test(filePath)) {
          continue outer;
        }
      }
      for (const pat of patterns) {
        if (pat.test(filePath)) {
          yield filePath;
        }
      }
      if (file.isDirectory()) {
        yield* itr(filePath);
      }
    }
  }

  yield* itr(rootPath);
}