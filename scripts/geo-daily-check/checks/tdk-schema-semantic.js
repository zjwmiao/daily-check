import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils.js';

const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'semantic-check');

function parseRenderChangeResult(content) {
  const match = content.match(/```json\s*\n<!-- RENDER_CHANGE_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

function parseSemanticResult(content) {
  const match = content.match(/```json\s*\n<!-- ANALYZE_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    const result = JSON.parse(match[1]);
    if (result.has_problems && result.problems) {
      return result.problems.map(p => ({
        url: p.url,
        check: 'tdk-schema-semantic',
        message: p.description
      }));
    }
    return [];
  } catch {
    return [];
  }
}

async function runRenderChangeAnalysis(workDir, project) {
  const commitsCount = project.semantic_analysis_commits_count || 5;
  const inputFile = path.join(CACHE_DIR, `render-input-${project.name}-${Date.now()}.txt`);
  const outputFile = path.join(CACHE_DIR, `render-output-${project.name}-${Date.now()}.md`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const prompt = `使用 render-change-analyzer skill 分析哪些页面的内容渲染被最近的git commits所影响

## 输出要求

分析完成后，将结果写入文件：${outputFile}

文件末尾必须包含以下 JSON block：

\`\`\`json
<!-- RENDER_CHANGE_RESULT -->
["/about", "/docs/intro", "/"]
\`\`\`

- 数组元素为页面 pathname（不含 .html 扩展名）
- 根页面使用 "/" 或空字符串
- 如果无受影响页面，输出空数组 []

如果存在被排除的文件（blog 内容页、全局组件），请在 JSON block 前简要说明。
`;

  fs.writeFileSync(inputFile, prompt, 'utf-8');

  const opencodeArgs = [
    'run',
    '-',
    '--thinking',
    '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
    '--dangerously-skip-permissions'
  ];

  log(`${project.name} render-change 分析: ${commitsCount} commits`);
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
        log(`render-change agent 失败: exit code ${code}`);
        resolve([]);
      } else {
        if (fs.existsSync(outputFile)) {
          const content = fs.readFileSync(outputFile, 'utf-8');
          const affectedPages = parseRenderChangeResult(content);
          resolve(affectedPages);
        } else {
          log(`render-change 输出文件不存在`);
          resolve([]);
        }
      }
    });

    proc.on('error', err => {
      log(`render-change agent 错误: ${err.message}`);
      resolve([]);
    });
  });
}

function buildSemanticCheckPrompt(htmlFiles, buildDir, project, outputFile) {
  const fileList = htmlFiles.map(f => {
    const relPath = f.slice(buildDir.length).replace(/\\/g, '/');
    const pathname = '/' + relPath.replace(/(\/index)?\.html$/i, '').replace(/^\//, '');
    return `- pathname: ${pathname}\n  file: ${f}`;
  }).join('\n');

  return `请分析以下 HTML 文件的 TDK 和 JSON-LD Schema 语义质量。

## 待分析文件

${fileList}

## 分析要求

1. **读取文件**：读取每个 HTML 文件内容
2. **提取信息**：
   - 从 HTML 提取 <title>、<meta name="description">、<meta name="keywords">
   - 提取 <script type="application/ld+json"> 中的 JSON-LD 内容
3. **语义分析**：
   - TDK/Schema 内容是否与页面实际内容一致
   - 是否包含不存在于页面中的信息（如其他社区名称、无关关键词）
   - description 长度是否合理（建议 100-200 字符）
   - JSON-LD schema 类型是否合适

## 输出格式

分析完成后，请将结果写入文件：${outputFile}

文件末尾必须包含以下结构化 JSON block：

\`\`\`json
<!-- ANALYZE_RESULT -->
{
  "has_problems": true,
  "problems": [
    {
      "url": "/about",
      "dimension": "tdk-quality",
      "description": "description 包含无关的 openEuler 关键词"
    }
  ]
}
\`\`\`

**如果无问题**，输出：

\`\`\`json
<!-- ANALYZE_RESULT -->
{
  "has_problems": false,
  "problems": [],
  "message": "TDK 和 Schema 语义检查通过"
}
\`\`\`

**注意事项**：
- \`<!-- ANALYZE_RESULT -->\` 标记必须放在 \`\`\`json 代码块内第一行
- \`dimension\` 只能是 \`tdk-quality\` 或 \`schema-quality\`
- \`url\` 字段使用 pathname 格式（如 /about、/docs/intro）
- description 字段要具体说明问题，便于后续修复
`;
}

export async function checkTdkSchemaSemantic(project, workDir, buildDir, { skip }) {
  if (skip.includes('tdk-schema-semantic')) return { findings: [], skipped: true };
  if (!project.enable_tdk_schema_semantic) return { findings: [], skipped: true };

  // 1. 执行 render-change 分析
  log(`${project.name} TDK/Schema 语义检查: 开始 render-change 分析`);
  const affectedPages = await runRenderChangeAnalysis(workDir, project);

  if (!affectedPages.length) {
    log(`render-change 分析完成: 无受影响页面`);
    return { findings: [] };
  }

  log(`render-change 分析完成: ${affectedPages.length} 个受影响页面`);

  // 2. 将 pathname 转换为 HTML 文件路径
  const htmlFiles = affectedPages.map(page => {
    const pathname = page.replace(/^\//, '').replace(/\/$/, '');
    if (pathname === '' || pathname === '/') {
      return path.join(buildDir, 'index.html');
    }
    return path.join(buildDir, pathname, 'index.html');
  }).filter(f => fs.existsSync(f));

  if (!htmlFiles.length) {
    log(`未找到受影响页面的构建产物 HTML`);
    return { findings: [], skipped: true };
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const inputFile = path.join(CACHE_DIR, `semantic-input-${project.name}-${Date.now()}.txt`);
  const outputFile = path.join(CACHE_DIR, `semantic-output-${project.name}-${Date.now()}.md`);

  const prompt = buildSemanticCheckPrompt(htmlFiles, buildDir, project, outputFile);

  fs.writeFileSync(inputFile, prompt, 'utf-8');

  const opencodeArgs = [
    'run',
    '-',
    '--thinking',
    '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
    '--dangerously-skip-permissions'
  ];

  // 3. 执行语义检查
  log(`${project.name} TDK/Schema 语义检查: ${htmlFiles.length} 个 HTML 文件`);
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
        log(`semantic-check agent 失败: exit code ${code}`);
        resolve({ findings: [] });
      } else {
        if (fs.existsSync(outputFile)) {
          const content = fs.readFileSync(outputFile, 'utf-8');
          const findings = parseSemanticResult(content);
          log(`TDK/Schema 语义检查完成: ${findings.length} 个问题`);
          resolve({ findings });
        } else {
          log(`semantic-check 输出文件不存在`);
          resolve({ findings: [] });
        }
      }
    });

    proc.on('error', err => {
      log(`semantic-check agent 错误: ${err.message}`);
      resolve({ findings: [] });
    });
  });
}