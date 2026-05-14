#!/usr/bin/env node
// 复刻 execute-fix-runs.js 里 prompt 的拼装,产出真实样本到 scripts/debug/sample-fix-prompt.txt
// 用法: node scripts/debug/gen-sample-fix-prompt.js [--context=<path>]
//   --context 可选;不传则用内置的 openEuler#21 sitemap 示例

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const agentFile = path.join(ROOT, '.github/agents/geo-fix-prompt.md');

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

// 默认上下文:openEuler#21 vulnerability-reporting sitemap 问题
// 与 execute-fix-runs.js 的 buildSlimContext() 结构保持一致
const workDir = '/home/geo-develop/.cache/geo-bot/portals/openeuler-openEuler-portal';
const defaultContext = {
  portal: { owner: 'openeuler', repo: 'openEuler-portal', work_dir: workDir, base_branch: 'master' },
  fixes: [
    {
      url: 'https://www.openeuler.org/zh/security/vulnerability-reporting/',
      issues: [
        {
          severity: 'critical',
          dimension: 'sitemap_inclusion',
          description: 'URL 未被 sitemap 收录',
          suggestion: '将该 URL 加入 sitemap.xml,priority 默认 0.5,lastmod 今天',
        },
      ],
    },
    {
      url: 'https://www.openeuler.org/en/security/vulnerability-reporting/',
      issues: [{ severity: 'critical', dimension: 'sitemap_inclusion', description: 'URL 未被 sitemap 收录' }],
    },
    {
      url: 'https://www.openeuler.openatom.cn/zh/security/vulnerability-reporting/',
      issues: [{ severity: 'critical', dimension: 'sitemap_inclusion', description: 'URL 未被 sitemap 收录' }],
    },
  ],
  output_file: `${workDir}/output.md`,
};

const context = args.context ? JSON.parse(fs.readFileSync(args.context, 'utf-8')) : defaultContext;
const ctxWorkDir = context.portal.work_dir;
const outputFile = `${ctxWorkDir}/output.md`;
const prompt =
  `${fs.readFileSync(agentFile, 'utf-8')}\n\n## 上下文\n\n${JSON.stringify(context, null, 2)}\n\n` +
  `请在 ${ctxWorkDir} 内执行修复,并将处理清单写入 ${outputFile}。`;

const out = args.output || path.join(__dirname, 'sample-fix-prompt.txt');
fs.writeFileSync(out, prompt);
console.error(`✅ 样本写入 ${out}(${prompt.length} 字符)`);
console.error(`\n复现命令(SSH 到 portal-x86 runner 或本地):`);
console.error(`  cd ${workDir} && cat ${out} | opencode run - --model alibaba-cn/glm-5 --agent build --dangerously-skip-permissions`);
