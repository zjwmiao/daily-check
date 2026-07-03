import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils.js';

const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'link-anchor');

function parseLinkAnchorResult(content) {
  const match = content.match(/```json\s*\n<!-- LINK_ANCHOR_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

export async function checkLinkAnchor(project, workDir, { skip }) {
  if (skip.includes('link-anchor-check')) return { findings: [], skipped: true };
  if (!project.enable_link_anchor_check) return { findings: [], skipped: true };

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const inputFile = path.join(CACHE_DIR, `input-${project.name}-${Date.now()}.txt`);
  const outputFile = path.join(CACHE_DIR, `output-${project.name}-${Date.now()}.md`);

  const prompt = `使用 codegraph 分析项目中是否存在应该使用 HTML <a href> 但却使用 JavaScript 跳转的场景。

## 工作目录

${workDir}

## 分析范围

检查以下跳转方式：

1. **onClick + router.push/navigate**
   - Vue Router: \`router.push('/path')\`
   - Nuxt: \`navigateTo('/path')\`
   - React Router: \`navigate('/path')\`

2. **window 操作**
   - \`window.location.href = '/path'\`
   - \`window.open('/path')\`

3. **自定义点击事件**
   - 任何点击事件处理函数中执行跳转逻辑

## 跳过场景（不报告）

以下场景不需要报告：

- **需要 JS 处理的跳转**：
  - 跳转前需要 \`confirm\` 确认
  - 需要携带 state 数据（如 \`router.push({ path: '/detail', query: { id } })\`）
  - 需要特殊逻辑处理（如登录状态检查、权限验证）

- **非导航元素**：
  - 按钮类元素（如提交表单、删除操作、下载触发）
  - 表单提交按钮
  - 触发 modal/dropdown 的按钮

- **已有正确实现**：
  - 已经使用 \`<a href>\` 且无问题的导航链接

## 功能模块分类

**重要**：对每个发现的问题，必须根据组件在网站中所处的功能区域判断其所属的**功能模块**，填写到 \`module\` 字段。

判断依据（综合以下信息）：
- 组件文件路径（如 \`Header.vue\`、\`Footer.vue\`、\`Sidebar.vue\`）
- 组件名 / 组件用途
- 组件被使用的位置和上下文

常见功能模块参考（不限于以下，可根据实际情况判断）：

| module 值 | 说明 |
|-----------|------|
| 导航栏 | 顶部导航、主导航菜单 |
| 页脚 | 底部链接、版权区域 |
| 侧边栏 | 侧边导航、文章目录 |
| 面包屑 | 面包屑导航 |
| 卡片列表 | 文章卡片、产品卡片、列表项 |
| 轮播图 | 轮播、滑块 |
| 标签页 | Tab 切换 |
| 搜索 | 搜索框、搜索结果 |
| 按钮组 | 操作按钮、CTA |
| 其他 | 不属于以上分类的组件 |

\`module\` 字段填写功能模块的**中文名称**。无法明确归类时填写 \`其他\`。

## 输出要求

分析完成后，将结果写入文件：${outputFile}

文件末尾必须包含以下 JSON block：

\`\`\`json
<!-- LINK_ANCHOR_RESULT -->
[
  {
    "file": "src/components/Header.vue",
    "line": 45,
    "code": "onClick={() => router.push('/about')}",
    "description": "导航链接使用 JS 跳转，应改为 <a href='/about'>",
    "severity": "high",
    "module": "导航栏"
  }
]
\`\`\`

如果无问题，输出空数组：

\`\`\`json
<!-- LINK_ANCHOR_RESULT -->
[]
\`\`\`

**字段说明**：
- \`file\`: 相对于项目根目录的文件路径
- \`line\`: 代码所在行号
- \`code\`: 问题代码片段（精简版）
- \`description\`: 问题描述和修复建议
- \`severity\`: \`high\`（导航链接）、\`medium\`（次要链接）、\`low\`（边缘场景）
- \`module\`: 功能模块分类（中文名称，如 \`导航栏\`、\`页脚\`、\`侧边栏\`）
`;

  fs.writeFileSync(inputFile, prompt, 'utf-8');

  const opencodeArgs = [
    'run',
    '-',
    '--thinking',
    '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
    '--dangerously-skip-permissions'
  ];

  log(`${project.name} link-anchor 分析开始`);
  log(`     bin: opencode, args: ${JSON.stringify(opencodeArgs)}`);

  const bashCmd = `opencode ${opencodeArgs.map(a => (/[\s'"]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a)).join(' ')} < "${inputFile}"`;

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', bashCmd], {
      stdio: ['ignore', 'inherit', 'ignore'],
      cwd: workDir,
      detached: true,
    });

    proc.on('close', code => {
      if (code !== 0) {
        log(`link-anchor agent 失败: exit code ${code}`);
        resolve({ findings: [] });
        return;
      }

      if (!fs.existsSync(outputFile)) {
        log(`link-anchor 输出文件不存在`);
        resolve({ findings: [] });
        return;
      }

      const content = fs.readFileSync(outputFile, 'utf-8');
      const issues = parseLinkAnchorResult(content);

      const findings = issues.map(issue => ({
        url: issue.file,
        check: 'link-anchor-check',
        message: `${issue.description} (${issue.file}:${issue.line})`,
        severity: issue.severity,
        module: issue.module || '其他'
      }));

      log(`link-anchor 分析完成: ${findings.length} 个问题`);
      resolve({ findings });
    });

    proc.on('error', err => {
      log(`link-anchor agent 错误: ${err.message}`);
      resolve({ findings: [] });
    });
  });
}