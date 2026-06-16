import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils.js';

const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'semantic-check');

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

export async function checkTdkSchemaSemantic(project, buildDir, affectedPages, { skip }) {
  if (skip.includes('tdk-schema-semantic')) return { findings: [], skipped: true };
  
  if (!affectedPages?.length) return { findings: [], skipped: true };

  log(`${project.name} TDK/Schema 语义检查: ${affectedPages.length} 个受影响页面`);

  // 将 pathname 转换为 HTML 文件路径
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
  
  const inputFile = path.join(CACHE_DIR, `input-${project.name}-${Date.now()}.txt`);
  const outputFile = path.join(CACHE_DIR, `output-${project.name}-${Date.now()}.md`);
  
  const prompt = buildSemanticCheckPrompt(htmlFiles, buildDir, project, outputFile);
  
  fs.writeFileSync(inputFile, prompt, 'utf-8');

  return new Promise((resolve) => {
    const proc = spawn('opencode', [
      'run', inputFile,
      '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
      '--dangerously-skip-permissions'
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: buildDir,
      env: { ...process.env }
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