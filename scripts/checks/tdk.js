import { parseHtml } from '../lib/html-fetch.js';

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

function getMeta(doc, name) {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || null;
}

export function checkTdk(html) {
  const doc = parseHtml(html);
  const title = doc.title?.trim() || null;
  const description = getMeta(doc, 'description');
  // keywords meta 现代搜索引擎与 AI 引擎都不再加权,改不改对结果没影响 — 不再检查

  const problems = [];

  if (!title) {
    problems.push({ category: 'tdk.title', description: 'Title 缺失' });
  } else if (title.length < TITLE_MIN) {
    problems.push({
      category: 'tdk.title',
      description: `Title 过短(${title.length} 字符)`,
      expected: `${TITLE_MIN}-${TITLE_MAX}`,
      actual: `${title.length}`,
    });
  } else if (title.length > TITLE_MAX) {
    problems.push({
      category: 'tdk.title',
      description: `Title 过长(${title.length} 字符)`,
      expected: `≤${TITLE_MAX}`,
      actual: `${title.length}`,
    });
  }

  if (!description) {
    problems.push({ category: 'tdk.description', description: 'Description 缺失' });
  } else if (description.length < DESC_MIN) {
    problems.push({
      category: 'tdk.description',
      description: `Description 过短(${description.length} 字符)`,
      expected: `${DESC_MIN}-${DESC_MAX}`,
      actual: `${description.length}`,
    });
  } else if (description.length > DESC_MAX) {
    problems.push({
      category: 'tdk.description',
      description: `Description 过长(${description.length} 字符,会被搜索引擎截断)`,
      expected: `≤${DESC_MAX}`,
      actual: `${description.length}`,
    });
  }

  if (title && description && title === description) {
    problems.push({
      category: 'tdk.description',
      description: 'Description 与 Title 完全相同',
    });
  }

  if (title || description) {
    const titleSnip = (title || '').slice(0, 40);
    const descSnip = (description || '').slice(0, 40);
    problems.push({
      category: 'tdk.review_quality',
      description: `TDK 已存在(title="${titleSnip}" ${title?.length || 0}字符 / description="${descSnip}" ${description?.length || 0}字符)。请审视: 1) 是否反映页面真实主题(对照 H1 与首段); 2) 是否同质化(description 是否只是 title 的变体); 3) keywords 若有是否真实关键词而非堆砌。若已合理,归 ⏭ 并说明原因。`,
    });
  }

  return {
    dimension: 'tdk',
    title,
    description,
    title_length: title?.length || 0,
    description_length: description?.length || 0,
    problems,
    pass: problems.every((p) => p.category === 'tdk.review_quality'),
  };
}
