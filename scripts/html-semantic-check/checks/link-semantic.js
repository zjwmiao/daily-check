import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { log } from '../utils.js';
import { appendInfoToStream, CACHE_DIR } from '../../lib/utils.js';

export const meta = {
  id: 'html-semantic',
  dimension: '',
  name: 'a标签问题',
  description: '通过 OpenCode CLI 对构建产物进行 HTML a标签语义分析',
};

function buildPrompt(context) {
  const { project, buildDir, htmlPages } = context;

  // TODO: 填充检查提示词
  //
  // 可用上下文:
  //   project    项目配置 (name / owner / repo / accessible_routes / ...)
  //   buildDir   构建产物根目录
  //   htmlPages  [{ url, filePath }, ...]  构建产物 HTML 页面列表

  return `分析项目中是否存在应该使用 HTML \`<a href>\` 但却使用 JavaScript 跳转的场景，并修复。覆盖 VitePress 与 Nuxt 3 两种构建框架，共用 \`@opensig/opendesign\` 组件库。

## 一、分析范围

扫描 \`@click\` handler、\`window\` 跳转、框架导航 API，匹配下表模式：

| 类别 | VitePress | Nuxt 3 | 通用 |
|------|-----------|--------|------|
| 框架导航 API | \`useRouter().go/push\` | \`navigateTo()\` / \`useRouter().push\` | — |
| window 跳转 | — | — | \`window.location.href = url\`、\`window.open(url)\`（含 \`'_blank'\` 与 \`'_self'\`） |
| 点击触发 | \`<el @click="fn">\` 或 \`<Component @click="fn">\`，fn 体内含上述跳转 | 同左 | 同左 |

> 注意：\`window.open(url, '_self')\` 也是导航（常见于搜索提交），不要漏。

## 二、判定标准

一个跳转**应改**，当且仅当**同时**满足：

1. **无副作用**：handler 体内不含 \`await\` / API 调用 / \`confirm\` / \`try-catch\` / 登录态检查 / 权限校验等；跳转是其唯一效果。
2. **URL 可静态拼接**：跳转目标 URL 能在模板里用 \`v-for\` item / 静态数据 / 路由变量拼出（如 \`/{lang}/{item.path}\` 、 \`/{lang}/download/?version={row.name}\` ）。

> **容易误判**：带 query 参数时。只要参数来自 \`v-for\` item 或静态数据（非运行时 state、非用户输入），就能改。只有参数来自运行时 state / 用户输入时才保留。

## 三、非问题（保留不改）

- 跳转前有副作用（见二.1）：如"标记已读再跳"、"登录后跳"、"confirm 后跳"。
- 表单提交成功后 \`setTimeout\` 内重定向。
- 搜索提交（query 来自用户输入）。
- URL 依赖运行时动态数据。
- tab / radio / select 的 \`@change\` 驱动页面切换：单列"需 UI 重构"桶，不在本 skill 自动改范围。
- 仅**读取** \`window.location.href\`（非赋值）。
- 已使用 \`<a href>\` / \`<OLink href>\` / \`<OCard href>\` / \`<OButton href>\` 且无问题。

> \`<OLink href>\` / \`<OCard href>\` / \`<OButton href>\` 为 \`@opensig/opendesign\` 组件，会被渲染为 \`<a href>\`

## 四、输出结构

排查完成后，输出一个 markdown 报告到本地文件，**三桶分类**：

1. **需要修复**：文件、原跳转方式
2. **合理保留**：文件、行、保留原因（副作用 / 表单提交 / 动态参数来源 / tab 驱动 等）
3. **待评估**：需组件增强或 UI 重构的场景（如某组件缺 href 能力、tab 切换需重构），注明建议方向`;
}

export async function check(context) {
  const { workDir, project } = context;

  const prompt = buildPrompt(context);
  if (!prompt.trim()) {
    log('  html-link-semantic: 提示词为空，跳过');
    return { findings: [] };
  }

  const assetsDir = path.join(CACHE_DIR, 'html-semantic');

  fs.mkdirSync(assetsDir, { recursive: true });

  const promptFile = path.join(assetsDir, `prompt-html-link-${project.name}-${Date.now()}.txt`);
  const agentOutput = path.join(assetsDir, `output-html-link-${project.name}-${Date.now()}.md`);

  fs.writeFileSync(promptFile, prompt, 'utf-8');

  const model = process.env.AI_MODEL || 'alibaba-cn/glm-5';

  log(`  启动 opencode (model: ${model}) ...`);

  await new Promise((resolve) => {
    const proc = spawn(
      'opencode',
      ['run', promptFile, '--model', model, '--dangerously-skip-permissions'],
      { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';

    appendInfoToStream(`[html-link-check-agent]`)(proc.stdout).pipe(process.stdout);
    proc.stderr.on('data', (data) => {
      stderr += data;
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        log(`  ⚠️ opencode 退出码 ${code}`);
        if (stderr) log(`  stderr: ${stderr.slice(0, 500)}`);
      }
      resolve();
    });

    proc.on('error', (err) => {
      log(`  ❌ opencode 启动失败: ${err.message}`);
      resolve();
    });
  });

  const output = fs.readFileSync(agentOutput, 'utf-8');

  try {
    fs.unlinkSync(promptFile);
    fs.unlinkSync(agentOutput);
  } catch {}

  if (!output.trim()) {
    return { findings: [] };
  }

  return {
    findings: [
      {
        url: '/',
        check: meta.id,
        message: output.trim(),
        raw: true,
      },
    ],
  };
}
