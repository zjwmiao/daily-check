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

## 详细文档

完整流程说明、脚本接口、配置参数见: [docs/GEO-AUTO-FIX-WORKFLOW.md](docs/GEO-AUTO-FIX-WORKFLOW.md)

## 关键文件

| 文件 | 用途 |
|------|------|
| `.github/workflows/geo-auto-fix.yml` | 主workflow |
| `scripts/scan-geo-issues.js` | 扫描[GEO] issues |
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
# 本地调试扫描
node scripts/scan-geo-issues.js --owner=openeuler --repo=openEuler-portal

# 管道式处理单个issue
cat issue.json | node scripts/build-fix-tasks.js | node scripts/execute-fix-runs.js
```