import { parseHtml } from '../lib/html-fetch.js';

export function checkSchema(html) {
  const doc = parseHtml(html);
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const blocks = [];
  const problems = [];

  for (const [i, script] of scripts.entries()) {
    const raw = script.textContent?.trim() || '';
    try {
      const json = JSON.parse(raw);
      const types = collectTypes(json);
      blocks.push({ index: i, types, valid: true });
    } catch (err) {
      problems.push({
        category: 'schema.parse',
        severity: 'critical',
        description: `JSON-LD 第 ${i + 1} 块解析失败: ${err.message}`,
      });
      blocks.push({ index: i, types: [], valid: false, error: err.message });
    }
  }

  if (blocks.length === 0) {
    problems.push({
      category: 'schema.missing',
      severity: 'critical',
      description: '无 JSON-LD 结构化数据',
      suggestion: '按页面类型添加 Schema.org JSON-LD (Organization / Article / FAQPage 等)',
    });
  }

  return {
    dimension: 'schema',
    block_count: blocks.length,
    valid_count: blocks.filter((b) => b.valid).length,
    types: blocks.flatMap((b) => b.types),
    blocks,
    problems,
    pass: problems.length === 0,
  };
}

function collectTypes(json) {
  if (Array.isArray(json)) return json.flatMap(collectTypes);
  if (json && typeof json === 'object') {
    const t = json['@type'];
    const here = t ? (Array.isArray(t) ? t : [t]) : [];
    const graph = json['@graph'];
    if (Array.isArray(graph)) return [...here, ...graph.flatMap(collectTypes)];
    return here;
  }
  return [];
}
