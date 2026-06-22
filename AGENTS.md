# GEO Auto Fix Workflow

本仓库提供 `geo-auto-fix` 自动化 workflow，用于扫描 AtomGit portal 仓库的 `[GEO]` issue 并自动执行 SEO/GEO 可发现性修复。

## Workflow 触发

- **定时**: 每4小时自动运行
- **手动**: GitHub Actions workflow_dispatch，指定 `owner/repo/community` 参数

## 核心流程

```
scan-geo-issues.js → build-fix-tasks.js → execute-fix-runs.js → comment-geo-result.js
```

管道式处理：扫描issue → 获取questions.json → opencode修复 → 评论结果

## GEO Issue Analyze Workflow

另有一个定时分析流程 `geo-issue-analyze.yml`，扫描各项目的 `[GEO]` issues 并分析：

- **触发**: 每天凌晨 3:00，或手动触发
- **流程**: `scan-issues.js → process-single.js (opencode + issue-analyze skill)`
- **结果处理**:
  - `has_problems: false` → 评论到原 issue
  - `has_problems: true` → 创建 `[GEO-ANALYZE]` issue
- **Dry Run**: `dry_run: true` 时只分析不提 issue，结果保存到文件

## 详细文档

完整流程说明、脚本接口、配置参数见: [docs/design.md](docs/design.md)

## Daily File Check Workflow

另有一个**配置驱动**的定时巡检流程 `daily-file-check`，检查前端 portal 项目页面的 SEO/GEO 配置完整性（TDK、JSON-LD Schema，预留 robots/sitemap）。

- 待检项目集中维护在 [daily-check-config.yaml](daily-check-config.yaml)
- 入口脚本 `scripts/geo-daily-check/check-single.js`，逐项目 clone → 构建 → 跑可插拔检查项 → 提 issue
- 完整设计、配置字段、检查项扩展方式见: [docs/daily-file-check.md](docs/daily-file-check.md)

## 关键文件

| 文件 | 用途 |
|------|------|
| `.github/workflows/geo-auto-fix.yml` | 修复 workflow |
| `.github/workflows/geo-issue-analyze.yml` | 分析 workflow |
| `scripts/scan-geo-issues.js` | 扫描[GEO] issues (修复) |
| `scripts/geo-issue-analyze/scan-issues.js` | 扫描所有项目 issues (分析) |
| `scripts/geo-issue-analyze/process-single.js` | AI分析处理 |
| `.opencode/skills/issue-analyze/SKILL.md` | issue分析skill |
| `scripts/lib/atomgit-api.js` | AtomGit API封装 |
| `scripts/lib/utils.js` | 公共工具(parseArgs/log/readInput) |

## Issue 格式要求

标题以 `[GEO]` 开头，body 包含 `## 涉及问题` 表格:

```markdown
## 涉及问题
| 问题ID | 问题 | 引用率 | 已引用平台 |
| q_074 | ... | 15% | ChatGPT |
```

## 运行示例

```bash
# 本地调试扫描 (修复流程)
node scripts/scan-geo-issues.js --owner=openeuler --repo=openEuler-portal

# 管道式处理单个issue (修复流程)
cat issue.json | node scripts/build-fix-tasks.js | node scripts/execute-fix-runs.js

# 本地调试分析流程
node scripts/geo-issue-analyze/scan-issues.js --project=openEuler

# Dry run 分析 (只分析不提issue)
node scripts/geo-issue-analyze/process-single.js --dryRun --input=issue.json
```

## 包管理器

本仓库使用 **pnpm** 作为包管理器。安装依赖：

```bash
pnpm install
```

添加新依赖：

```bash
pnpm add <package-name>
```