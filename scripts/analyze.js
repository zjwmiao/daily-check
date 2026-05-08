#!/usr/bin/env node

/**
 * analyze.js — 页面 SEO/GEO 元素分析工具
 *
 * 读取 crawled/ 目录下的 HTML 文件，输出结构化的 SEO 诊断信息：
 *   - Title / Meta Description / Keywords
 *   - Canonical / Hreflang / Robots
 *   - Open Graph / Twitter Card 标签
 *   - JSON-LD 结构化数据
 *   - H1 / H2 标题层次
 *   - 图片 alt 属性覆盖率
 *   - 内部链接 / 外部链接数量
 *
 * 用法：
 *   node scripts/analyze.js <html文件路径>
 *   node scripts/analyze.js crawled/openeuler-zh.html
 *
 * 示例（先用 crawl.js 抓取，再用本脚本分析）：
 *   node scripts/crawl.js https://www.openeuler.org/zh/ --out=openeuler-zh --format=html
 *   node scripts/analyze.js crawled/openeuler-zh.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
用法：node scripts/analyze.js <html文件路径>

示例：
  node scripts/analyze.js crawled/openeuler-zh.html
  node scripts/analyze.js crawled/openeuler-en.html
`);
  process.exit(0);
}

const htmlPath = path.resolve(args[0]);

if (!fs.existsSync(htmlPath)) {
  console.error(`❌ 文件不存在：${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf-8');

// ─── 提取函数 ────────────────────────────────────────────────────────────────

function extractOne(pattern) {
  const m = html.match(pattern);
  return m ? m[1]?.trim() : null;
}

function extractAll(pattern) {
  return html.match(pattern) || [];
}

// ─── 分析 ────────────────────────────────────────────────────────────────────

// 基础 meta
const title       = extractOne(/<title>([\s\S]*?)<\/title>/i);
const description = extractOne(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
                 || extractOne(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
const keywords    = extractOne(/name=["']keywords["'][^>]*content=["']([^"']+)["']/i)
                 || extractOne(/content=["']([^"']+)["'][^>]*name=["']keywords["']/i);
const generator   = extractOne(/name=["']generator["'][^>]*content=["']([^"']+)["']/i)
                 || extractOne(/content=["']([^"']+)["'][^>]*name=["']generator["']/i);
const robots      = extractOne(/name=["']robots["'][^>]*content=["']([^"']+)["']/i)
                 || extractOne(/content=["']([^"']+)["'][^>]*name=["']robots["']/i);

// 技术标签
const canonical  = extractOne(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
                || extractOne(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
const hreflangTags = extractAll(/<link[^>]+hreflang[^>]*>/gi);

// Open Graph
const ogTitle       = extractOne(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
                   || extractOne(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
const ogDescription = extractOne(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
                   || extractOne(/content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
const ogImage       = extractOne(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                   || extractOne(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
const ogType        = extractOne(/property=["']og:type["'][^>]*content=["']([^"']+)["']/i)
                   || extractOne(/content=["']([^"']+)["'][^>]*property=["']og:type["']/i);

// Twitter Cards
const twitterCard  = extractOne(/name=["']twitter:card["'][^>]*content=["']([^"']+)["']/i)
                  || extractOne(/content=["']([^"']+)["'][^>]*name=["']twitter:card["']/i);
const twitterTitle = extractOne(/name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)
                  || extractOne(/content=["']([^"']+)["'][^>]*name=["']twitter:title["']/i);

// JSON-LD
const jsonLdBlocks = extractAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

// 标题层次
const h1Tags = extractAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)
  .map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
const h2Tags = extractAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)
  .map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
const h3Tags = extractAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)
  .map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

// 图片 alt 分析（仅匹配不含 > 的 img 标签，避免 data URI 中的 > 干扰）
const allImgs    = extractAll(/<img[^>]*?(?:\/?>|>)/gi)
  .filter(tag => /^<img\s/i.test(tag));  // 只保留真实 <img 开头的标签
const hasGoodAlt = allImgs.filter(img => /alt=["'][^"']+["']/.test(img));
const missingAlt = allImgs.filter(img => !/alt=/.test(img));
const emptyAlt   = allImgs.filter(img => /alt=["']['"]/.test(img));

// 链接分析
const allLinks = extractAll(/href=["']([^"']+)["']/gi)
  .map(h => h.replace(/href=["']/i, '').replace(/["']$/, ''));

const internalLinks = allLinks.filter(url =>
  url.startsWith('/') || /openeuler\.(org|openatom\.cn)/.test(url)
);
const externalLinks = allLinks.filter(url =>
  url.startsWith('http') && !/openeuler\.(org|openatom\.cn)/.test(url)
);

// ─── 输出 ─────────────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

function status(val, { warn } = {}) {
  if (!val) return FAIL;
  if (warn && warn(val)) return WARN;
  return PASS;
}

console.log('\n══════════════════════════════════════════════════════');
console.log(`  SEO 元素分析报告`);
console.log(`  文件：${htmlPath}`);
console.log('══════════════════════════════════════════════════════\n');

// 基础 meta
console.log('── 基础 Meta ──────────────────────────────────────────');
console.log(`Title       ${status(title, { warn: v => v.length > 60 })}  ${title || '（缺失）'}`);
if (title) console.log(`            长度：${title.length} 字符${title.length > 60 ? '（建议 ≤ 60）' : ''}`);
console.log('');
console.log(`Description ${status(description, { warn: v => v.length > 160 || v.length < 50 })}  ${description ? description.slice(0, 100) + (description.length > 100 ? '…' : '') : '（缺失）'}`);
if (description) console.log(`            长度：${description.length} 字符${description.length > 160 ? '（过长，建议 ≤ 160）' : description.length < 50 ? '（过短，建议 ≥ 50）' : ''}`);
console.log('');
console.log(`Keywords    ${status(keywords)}  ${keywords || '（缺失）'}`);
console.log(`Robots      ${status(robots, { warn: v => v.includes('noindex') })}  ${robots || '（未设置，默认可索引）'}`);
console.log(`Generator   ${generator || '（未设置）'}`);

// 技术标签
console.log('\n── 技术标签 ───────────────────────────────────────────');
console.log(`Canonical   ${status(canonical)}  ${canonical || '（缺失）'}`);
if (hreflangTags.length > 0) {
  console.log(`Hreflang    ${PASS}  共 ${hreflangTags.length} 个`);
  hreflangTags.forEach(tag => {
    const lang = tag.match(/hreflang=["']([^"']+)["']/i)?.[1];
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    console.log(`            ${lang} → ${href}`);
  });
} else {
  console.log(`Hreflang    ${FAIL}  （缺失）`);
}

// Open Graph
console.log('\n── Open Graph ─────────────────────────────────────────');
console.log(`og:title       ${status(ogTitle)}  ${ogTitle || '（缺失）'}`);
console.log(`og:description ${status(ogDescription)}  ${ogDescription ? ogDescription.slice(0, 80) + (ogDescription.length > 80 ? '…' : '') : '（缺失）'}`);
console.log(`og:image       ${status(ogImage)}  ${ogImage || '（缺失）'}`);
console.log(`og:type        ${status(ogType)}  ${ogType || '（缺失）'}`);

// Twitter Cards
console.log('\n── Twitter / X Cards ──────────────────────────────────');
console.log(`twitter:card   ${status(twitterCard)}  ${twitterCard || '（缺失）'}`);
console.log(`twitter:title  ${status(twitterTitle)}  ${twitterTitle || '（缺失）'}`);

// JSON-LD
console.log('\n── JSON-LD 结构化数据 ─────────────────────────────────');
if (jsonLdBlocks.length > 0) {
  console.log(`${PASS}  发现 ${jsonLdBlocks.length} 个 JSON-LD 块`);
  jsonLdBlocks.forEach((block, i) => {
    const content = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    try {
      const parsed = JSON.parse(content);
      console.log(`  [${i + 1}] @type: ${parsed['@type'] || '未知'}`);
    } catch {
      console.log(`  [${i + 1}] （JSON 解析失败）`);
    }
  });
} else {
  console.log(`${FAIL}  无 JSON-LD（缺失 Organization / SoftwareApplication / FAQPage 等）`);
}

// 标题层次
console.log('\n── 标题层次（Heading Hierarchy）─────────────────────');
console.log(`H1 (${h1Tags.length}个)  ${h1Tags.length === 0 ? FAIL : h1Tags.length > 1 ? WARN : PASS}`);
if (h1Tags.length > 0) h1Tags.forEach(h => console.log(`  · ${h}`));
else console.log('  （H1 缺失 — 已确认非渲染问题）');

console.log(`H2 (${h2Tags.length}个)  ${h2Tags.length > 0 ? PASS : WARN}`);
h2Tags.slice(0, 8).forEach(h => console.log(`  · ${h}`));
if (h2Tags.length > 8) console.log(`  … 还有 ${h2Tags.length - 8} 个`);

console.log(`H3 (${h3Tags.length}个)  ${h3Tags.length > 0 ? PASS : '─ '}`);
h3Tags.slice(0, 5).forEach(h => console.log(`  · ${h}`));
if (h3Tags.length > 5) console.log(`  … 还有 ${h3Tags.length - 5} 个`);

// 图片 alt
console.log('\n── 图片 Alt 属性覆盖率 ────────────────────────────────');
const altCoverage = allImgs.length > 0
  ? Math.round(hasGoodAlt.length / allImgs.length * 100)
  : 100;
const altStatus = altCoverage >= 90 ? PASS : altCoverage >= 60 ? WARN : FAIL;
console.log(`${altStatus}  覆盖率 ${altCoverage}%（总计 ${allImgs.length} 张，有效 alt：${hasGoodAlt.length} 张，无 alt：${missingAlt.length} 张，空 alt：${emptyAlt.length} 张）`);
if (missingAlt.length > 0) {
  console.log('  缺失 alt 示例：');
  missingAlt.slice(0, 3).forEach(img => {
    const src = img.match(/src=["']([^"']{0,60})/i)?.[1];
    console.log(`    ${src || img.slice(0, 60)}`);
  });
}

// 链接
console.log('\n── 链接分析 ───────────────────────────────────────────');
console.log(`${PASS}  内部链接：${internalLinks.length} 个`);
console.log(`─   外部链接：${externalLinks.length} 个`);
if (externalLinks.length > 0) {
  console.log('  外部链接示例：');
  externalLinks.slice(0, 5).forEach(url => console.log(`    ${url}`));
}

// 总结
console.log('\n══════════════════════════════════════════════════════');
console.log('  快速诊断摘要');
console.log('══════════════════════════════════════════════════════');

const issues = [];
if (!title)       issues.push('CRITICAL: Title 缺失');
if (!description) issues.push('CRITICAL: Meta Description 缺失');
if (h1Tags.length === 0) issues.push('CRITICAL: H1 缺失');
if (!canonical)   issues.push('CRITICAL: Canonical 缺失');
if (hreflangTags.length === 0) issues.push('CRITICAL: Hreflang 缺失');
if (!ogTitle)     issues.push('CRITICAL: OG Tags 缺失');
if (jsonLdBlocks.length === 0) issues.push('CRITICAL: JSON-LD 缺失');
if (altCoverage < 60) issues.push(`CRITICAL: 图片 alt 覆盖率仅 ${altCoverage}%（${allImgs.length} 张中仅 ${hasGoodAlt.length} 张有效）`);
if (!twitterCard) issues.push('IMPORTANT: Twitter Card 缺失');
if (description && description.length > 160) issues.push('IMPORTANT: Description 过长');
if (h1Tags.length > 1) issues.push('IMPORTANT: H1 超过 1 个');

if (issues.length === 0) {
  console.log('✅  未发现明显问题');
} else {
  issues.forEach(issue => console.log(`  ${issue.startsWith('CRITICAL') ? '🔴' : '🟡'} ${issue}`));
}

console.log('\n  提示：将 HTML 提供给 Claude 并运行 /audit-page 可获取完整评分和优化建议\n');
