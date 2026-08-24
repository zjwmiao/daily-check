import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { log } from './utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKS_DIR = path.join(__dirname, 'checks');

/**
 * 自动发现并加载 checks/ 目录下所有检查模块。
 *
 * 每个检查模块需导出:
 *   - meta: { id, dimension, name, description }
 *       id          检查项唯一标识 (用于 skip_check / finding.check)
 *       dimension   维度字母 (A-L)
 *       name        维度中文名
 *       description 简短描述
 *   - check: async (context) => { findings: [...] }
 *       context = { project, workDir, buildDir, htmlPages, skip }
 *       finding = { url, check, message, severity?, file?, line? }
 *
 * 新增检查项:在 checks/ 目录下新建 .js 文件并导出 meta + check 即可自动接入，
 * 无需修改本文件或 check-single.js。
 *
 * @returns {Promise<Array<{meta, run}>>}
 */
export async function loadChecks() {
  if (!fs.existsSync(CHECKS_DIR)) {
    log(`⚠️ 检查目录不存在: ${CHECKS_DIR}`);
    return [];
  }

  const files = fs
    .readdirSync(CHECKS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const checks = [];
  for (const file of files) {
    const filePath = path.join(CHECKS_DIR, file);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      if (!mod.meta || typeof mod.check !== 'function') {
        log(`⚠️ 跳过 ${file}: 缺少 meta 或 check 导出`);
        continue;
      }
      checks.push({ meta: mod.meta, run: mod.check });
      log(`  📦 已加载检查项: ${mod.meta.id} (${mod.meta.dimension}: ${mod.meta.name})`);
    } catch (err) {
      log(`❌ 加载 ${file} 失败: ${err.message}`);
    }
  }

  return checks;
}

/**
 * 运行所有已注册的检查项（跳过 skip 列表中的项）。
 *
 * @param {Array} checks        loadChecks() 返回的检查项列表
 * @param {object} context      检查上下文 { project, workDir, buildDir, htmlPages }
 * @param {Array<string>} skip  要跳过的检查项 id 列表
 * @returns {Promise<{findings: Array}>}
 */
export async function runAllChecks(checks, context, { skip = [] } = {}) {
  if (skip.includes('all')) {
    log('⏭️ skip_check 包含 all，跳过所有 HTML 语义检查');
    return { findings: [] };
  }

  const allFindings = [];
  for (const { meta, run } of checks) {
    if (skip.includes(meta.id)) {
      log(`⏭️ 跳过检查项: ${meta.id}`);
      continue;
    }

    log(`\n--- 检查项: ${meta.dimension} ${meta.name} (${meta.id}) ---`);
    try {
      const result = await run(context);
      const findings = result?.findings || [];
      allFindings.push(...findings);
      log(`  ${meta.id}: 发现 ${findings.length} 个问题`);
    } catch (err) {
      log(`❌ 检查项 ${meta.id} 异常: ${err.message}`);
    }
  }

  return { findings: allFindings };
}
