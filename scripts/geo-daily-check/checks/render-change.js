import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils.js';

const CACHE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), '.cache', 'geo-bot', 'render-change');

function parseRenderChangeResult(content) {
  const match = content.match(/```json\s*\n<!-- RENDER_CHANGE_RESULT -->\s*\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

export async function checkRenderChange(project, workDir, { skip }) {
  if (skip.includes('render-change')) return { findings: [], skipped: true, affectedPages: [] };
  
  if (!project.enable_render_change_analysis) return { findings: [], skipped: true, affectedPages: [] };

  const commitsCount = project.render_change_commits_count || 5;
  
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  
  const inputFile = path.join(CACHE_DIR, `input-${project.name}-${Date.now()}.txt`);
  const outputFile = path.join(CACHE_DIR, `output-${project.name}-${Date.now()}.md`);

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

  log(`${project.name} render-change 分析: ${commitsCount} commits`);

  return new Promise((resolve) => {
    const proc = spawn('opencode', [
      'run', inputFile,
      '--model', process.env.AI_MODEL || 'alibaba-cn/glm-5',
      '--dangerously-skip-permissions'
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: workDir,
      env: { ...process.env }
    });

    proc.on('close', code => {
      if (code !== 0) {
        log(`render-change agent 失败: exit code ${code}`);
        resolve({ findings: [], affectedPages: [] });
      } else {
        if (fs.existsSync(outputFile)) {
          const content = fs.readFileSync(outputFile, 'utf-8');
          const affectedPages = parseRenderChangeResult(content);
          log(`render-change 分析完成: ${affectedPages.length} 个受影响页面`);
          resolve({ findings: [], affectedPages });
        } else {
          log(`render-change 输出文件不存在`);
          resolve({ findings: [], affectedPages: [] });
        }
      }
    });
    
    proc.on('error', err => {
      log(`render-change agent 错误: ${err.message}`);
      resolve({ findings: [], affectedPages: [] });
    });
  });
}