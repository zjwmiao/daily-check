import { createInterface } from "readline";
import { Readable } from "stream";

export const HTML_IGNORE = [
  /(200|404|error)\.html$/,
  /baidu_verify/,
  /\b(blog|blogs|news|showcase|showcases)\b/,
];

export const DIMENSION_DESCRIPTIONS = {};


export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

export function shouldIgnore(pathname, ignorePatterns) {
  if (!ignorePatterns?.length) return false;
  for (const pattern of ignorePatterns) {
    if (pattern instanceof RegExp) {
      if (pattern.test(pathname)) {
        return true;
      }
    } else if (typeof pattern === 'string') {
      try { if (new RegExp(pattern).test(pathname)) return true; } catch {}
    }
  }
  return false;
}

export function pathnameToKey(pathname) {
  let s = pathname.replace(/^\//, '').replace(/\/$/, '').replace(/(\/index)?\.html$/i, '');
  return s || 'index';
}

export function normalizePathname(p) {
  let s = p;
  try {
    s = decodeURIComponent(p);
  } catch {}
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

export function appendInfoToStream(appendText) {
  return (readStream) => Readable.from(
    (async function* () {
      const rl = createInterface({
        input: readStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        yield `${appendText} ${line}`;
      }
    })()
  );
}
