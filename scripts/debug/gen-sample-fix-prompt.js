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
const defaultContext = {
  portal: {
    owner: 'openeuler',
    repo: 'openEuler-portal',
    work_dir: '/home/geo-develop/.cache/geo-bot/portals/openeuler-openEuler-portal',
  },
  geo_issue_url: 'https://github.com/opensourceways/geo-workflow/issues/21',
  trigger_issue_url: 'https://github.com/opensourceways/geo-develop-workflow/issues/20',
  run_dir: '/runner-temp/geo-fix-20-XXXXXXXX',
  problems: [
    {
      question_id: 'q_080',
      url: 'https://www.openeuler.org/zh/security/vulnerability-reporting/',
      severity: 'critical',
      dimension: 'sitemap_inclusion',
      category: 'sitemap.not_included',
      description: 'URL 未被 sitemap 收录',
      suggestion: '将该 URL 加入 sitemap.xml,并填写合理 priority/lastmod',
    },
    {
      question_id: 'q_080',
      url: 'https://www.openeuler.org/en/security/vulnerability-reporting/',
      severity: 'critical',
      dimension: 'sitemap_inclusion',
      description: 'URL 未被 sitemap 收录',
      suggestion: '同上',
    },
    {
      question_id: 'q_080',
      url: 'https://www.openeuler.openatom.cn/zh/security/vulnerability-reporting/',
      severity: 'critical',
      dimension: 'sitemap_inclusion',
      description: 'URL 未被 sitemap 收录',
      suggestion: '同上',
    },
  ],
  analysis: {
    community: 'openEuler',
    geo_issue_number: 21,
    geo_issue_title: '安全漏洞修复与 CVE 报告流程页面未被 AI 平台引用',
    severity: 'P0',
    portal: { owner: 'openeuler', repo: 'openEuler-portal', default_branch: 'master' },
    questions: [
      {
        id: 'q_080',
        question: '如何向 openEuler 安全委员会(security@openeuler.org)报告 CVE 安全漏洞?漏洞披露流程是什么?',
        official_urls: [
          {
            url: 'https://www.openeuler.org/zh/security/vulnerability-reporting/',
            problems: [{ severity: 'critical', dimension: 'sitemap_inclusion', description: 'URL 未被 sitemap 收录' }],
          },
        ],
      },
    ],
  },
};

const context = args.context ? JSON.parse(fs.readFileSync(args.context, 'utf-8')) : defaultContext;
const workDir = context.portal.work_dir;
const outputFile = `${workDir}/output.md`;
const prompt =
  `${fs.readFileSync(agentFile, 'utf-8')}\n\n## 上下文\n\n${JSON.stringify(context, null, 2)}\n\n` +
  `请在 ${workDir} 内执行修复,并将处理清单写入 ${outputFile}。`;

const out = args.output || path.join(__dirname, 'sample-fix-prompt.txt');
fs.writeFileSync(out, prompt);
console.error(`✅ 样本写入 ${out}(${prompt.length} 字符)`);
console.error(`\n复现命令(SSH 到 portal-x86 runner 或本地):`);
console.error(`  cd ${workDir} && cat ${out} | opencode run - --model alibaba-cn/glm-5 --agent build --dangerously-skip-permissions`);
