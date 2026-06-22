import XLSX from 'xlsx';
import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const HISTORY_FILE = 'daily-check-history.xlsx';
const MAX_SHEET_NAME_LEN = 31;

const DIMENSIONS = [
  'robots-txt',
  'sitemap-access',
  'sitemap-tdk',
  'sitemap-schema',
  'sitemap-priority',
  'url-access',
  'llms-txt',
  'sitemap-coverage',
  'ssr-rendering',
  'tdk-schema-semantic',
];

function sanitizeSheetName(name) {
  let s = name.replace(/[\\\/\?\*\[\]]/g, '_');
  if (s.length > MAX_SHEET_NAME_LEN) s = s.slice(0, MAX_SHEET_NAME_LEN);
  return s;
}

function createSheetWithHeader(wb, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet([['检查时间', '状态', '问题总数', '错误信息', 'Issue链接', ...DIMENSIONS]]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

export function exportToExcel(summaries) {
  const filePath = path.join(REPO_ROOT, HISTORY_FILE);
  const wb = fs.existsSync(filePath) ? XLSX.readFile(filePath) : XLSX.utils.book_new();

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  for (const s of summaries) {
    const sheetName = sanitizeSheetName(s.name);
    if (!wb.Sheets[sheetName]) createSheetWithHeader(wb, sheetName);

    const ws = wb.Sheets[sheetName];
    const status = s.skipped ? '跳过' : s.ok ? '成功' : '失败';
    const byDim = s.byDim || {};
    const dimCounts = DIMENSIONS.map((d) => byDim[d] || 0);
    const issueUrl = s.issueUrl || '';
    const row = [now, status, s.findings || 0, s.error || '', issueUrl, ...dimCounts];

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const nextRow = range.e.r + 1;
    XLSX.utils.sheet_add_aoa(ws, [row], { origin: `A${nextRow}` });
  }

  XLSX.writeFile(wb, filePath);
  return filePath;
}

export function pushHistoryFile() {
  try {
    execSync('git config user.email "geo-bot@atomgit.com"', { cwd: REPO_ROOT, stdio: 'pipe' });
    execSync('git config user.name "geo-bot"', { cwd: REPO_ROOT, stdio: 'pipe' });

    const filePath = path.join(REPO_ROOT, HISTORY_FILE);
    execSync(`git add "${HISTORY_FILE}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const status = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf-8' });
    if (!status.includes(HISTORY_FILE)) return false;

    const date = new Date().toISOString().slice(0, 10);
    execSync(`git commit -m "docs: 更新 daily check 历史 ${date}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    execSync('git push', { cwd: REPO_ROOT, stdio: 'pipe' });

    return true;
  } catch (err) {
    console.error(`推送历史文件失败: ${err.message}`);
    return false;
  }
}