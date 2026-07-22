import fs from 'fs';
import { join } from 'path';

export const HTML_IGNORE = [
  /(200|404|error)\.html$/,
  /baidu_verify/,
  /\b(blog|blogs|news|showcase|showcases)\b/,
];

export const CHECK_DIMENSIONS = ['robots-txt', 'sitemap-access', 'sitemap-tdk', 'sitemap-schema', 'sitemap-priority', 'url-access', 'llms-txt', 'sitemap-coverage', 'ssr-rendering', 'tdk-schema-semantic', 'link-anchor-check'];

export const DIMENSION_DESCRIPTIONS = {
  'robots-txt': 'robots.txt 不存在、全站封禁爬虫或未声明 Sitemap',
  'sitemap-access': 'sitemap 无法访问或无有效内容',
  'sitemap-tdk': '页面TDK为空或与同语言首页一致，未配置页面专属TDK',
  'sitemap-schema': '页面HTML缺少JSON-LD结构化数据script',
  'sitemap-priority': 'sitemap条目缺少priority属性',
  'url-access': 'URL无法访问',
  'llms-txt': 'llms.txt/llms-full.txt缺失或为空',
  'sitemap-coverage': '构建页面未被sitemap收录',
  'ssr-rendering': '页面疑似客户端渲染(CSR)，不利于SEO/GEO',
  'tdk-schema-semantic': 'TDK/Schema 语义不一致，内容与页面实际内容不符',
  'link-anchor-check': '导航链接使用 JS 跳转而非 <a href>，影响 SEO/GEO 可发现性',
};

export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

export function shouldIgnore(pathname, ignorePatterns) {
  if (!ignorePatterns?.length) return false;
  for (const pattern of ignorePatterns) {
    if (pattern instanceof RegExp) {
      if (pattern.test(pathname)) {
        return true
      }
    } else if (typeof pattern === 'string') {
      try { if (new RegExp(pattern).test(pathname)) return true; } catch {}
    }
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
          continue outer;
        }
      }
      if (file.isDirectory()) {
        yield* itr(filePath);
      }
    }
  }

  yield* itr(rootPath);
}