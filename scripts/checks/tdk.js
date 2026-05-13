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
  const keywords = getMeta(doc, 'keywords');

  const problems = [];

  if (!title) {
    problems.push({ category: 'tdk.title', severity: 'critical', description: 'Title 缺失' });
  } else if (title.length < TITLE_MIN) {
    problems.push({
      category: 'tdk.title',
      severity: 'critical',
      description: `Title 过短(${title.length} 字符)`,
      expected: `${TITLE_MIN}-${TITLE_MAX}`,
      actual: `${title.length}`,
    });
  } else if (title.length > TITLE_MAX) {
    problems.push({
      category: 'tdk.title',
      severity: 'important',
      description: `Title 过长(${title.length} 字符)`,
      expected: `≤${TITLE_MAX}`,
      actual: `${title.length}`,
    });
  }

  if (!description) {
    problems.push({ category: 'tdk.description', severity: 'critical', description: 'Description 缺失' });
  } else if (description.length < DESC_MIN) {
    problems.push({
      category: 'tdk.description',
      severity: 'critical',
      description: `Description 过短(${description.length} 字符)`,
      expected: `${DESC_MIN}-${DESC_MAX}`,
      actual: `${description.length}`,
    });
  } else if (description.length > DESC_MAX) {
    problems.push({
      category: 'tdk.description',
      severity: 'important',
      description: `Description 过长(${description.length} 字符,会被搜索引擎截断)`,
      expected: `≤${DESC_MAX}`,
      actual: `${description.length}`,
    });
  }

  if (title && description && title === description) {
    problems.push({
      category: 'tdk.description',
      severity: 'important',
      description: 'Description 与 Title 完全相同',
    });
  }

  if (!keywords) {
    problems.push({
      category: 'tdk.keywords',
      severity: 'minor',
      description: 'Keywords 缺失',
    });
  }

  return {
    dimension: 'tdk',
    title,
    description,
    keywords,
    title_length: title?.length || 0,
    description_length: description?.length || 0,
    problems,
    pass: problems.filter((p) => p.severity === 'critical').length === 0,
  };
}
