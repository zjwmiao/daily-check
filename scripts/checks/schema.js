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
        description: `JSON-LD 第 ${i + 1} 块解析失败: ${err.message}`,
      });
      blocks.push({ index: i, types: [], valid: false, error: err.message });
    }
  }

  if (blocks.length === 0) {
    problems.push({
      category: 'schema.missing',
      description: '无 JSON-LD 结构化数据',
      suggestion: '按页面类型添加 Schema.org JSON-LD (Organization / Article / FAQPage 等)',
    });
  } else {
    const allTypes = blocks.flatMap((b) => b.types).filter(Boolean);
    problems.push({
      category: 'schema.review_quality',
      description: `页面已存在 ${blocks.length} 块 JSON-LD (@type: ${allTypes.join(', ') || '未声明'})。请审视: 1) @type 是否与页面性质匹配(Article/FAQPage/Organization/Product/CollectionPage 等); 2) 必填字段是否齐全(headline/name, description, url, mainEntity 等); 3) 字段值是否取自现网真页; 4) 是否缺漏可补充的 @type 块 — 例如页面有问答结构应补 FAQPage、有操作步骤应补 HowTo、有面包屑导航应补 BreadcrumbList、产品/服务页应补 Product 或 Service 等;按页面真实内容补,无对应内容不补。若现有 schema 已合理,归 ⏭ 并说明原因。`,
      suggestion: '从现网 HTML 抽取必要字段补全/重写 JSON-LD,或确认现状已合理后跳过',
    });
  }

  return {
    dimension: 'schema',
    block_count: blocks.length,
    valid_count: blocks.filter((b) => b.valid).length,
    types: blocks.flatMap((b) => b.types),
    blocks,
    problems,
    pass: problems.every((p) => p.category === 'schema.review_quality'),
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
