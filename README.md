# GEO Workflows

GEO（Generative Engine Optimization）/ SEO 自动化 workflow 集合，运行于 GitHub Actions（runner: `portal-x86`），扫描 AtomGit portal 仓库标题以 `[GEO]` 开头的 issue 并做可发现性检查 / 分析。

## 概述

本仓库提供两个独立的自动化 workflow：

| Workflow | 用途 | 触发 |
|---|---|---|
| **GEO Issue Analyze** | 扫描 `[GEO]` issue，程序化检查 + LLM 语义分析，评论或创建分析 issue | 每日 03:00 UTC / 手动 |
| **Daily File Check** | 逐项目 clone→构建→可插拔检查项（TDK / Schema / robots / sitemap / SSR / ...），按维度提 issue | 每日 02:00 UTC / 手动 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 设置环境变量
export ATOMGIT_TOKEN=xxx

# GEO Issue Analyze：扫描 + 分析某项目的 [GEO] issues
node scripts/geo-issue-analyze/scan-issues.js --project=openEuler
node scripts/geo-issue-analyze/process-single.js --dryRun --input=issue.json

# Daily File Check：仅检查不提 issue
node scripts/geo-daily-check/check-single.js --dryRun
node scripts/geo-daily-check/check-single.js --project=openEuler --dryRun
```

> Windows 本地完整 checkout 大型 portal 仓库可能因 260 字符路径限制失败，属系统限制；Linux runner 不受影响。

## 仓库结构

```text
scripts/
  lib/                         公共库
    atomgit-api.js             AtomGit REST 客户端 (retry + issue/PR API)
    html-fetch.js              HTTP 抓取 / parseHtml / fetchBrowser
    utils.js                   公共工具 (parseArgs / log / readInput)

  checks/
    sitemap-inclusion.js       sitemap 收录检查 (getSitemapUrls)，两 workflow 共享

  geo-issue-analyze/           GEO Issue Analyze workflow
    scan-issues.js             扫描各项目的 [GEO] issues
    process-single.js          程序化检查 + opencode 分析 + 结果处理
    url-checks.js              URL 程序化检查 (sitemap / llms 覆盖)

  geo-daily-check/             Daily File Check workflow
    check-single.js            入口 (配置驱动逐项目)
    utils.js                   共享工具
    history-export.js          检查历史导出 (daily-check-history.xlsx)
    checks/*.js                各可插拔检查项模块

.github/
  workflows/
    geo-issue-analyze.yml      分析 workflow
    daily-file-check.yml       巡检 workflow

.opencode/
  skills/
    render-change-analyzer/    tdk-schema-semantic 检查项用
    link-anchor-analyzer/      link-anchor 检查项用

docs/
  geo-issue-analyze.md         GEO Issue Analyze 设计文档
  daily-file-check.md          Daily File Check 设计文档

projects-config.yaml           待分析项目列表 (Issue Analyze)
  projects-config.yaml          待检项目配置 (与 geo-issue-analyze 共享)
```

## 配置 (repo secrets / variables)

| 名称 | 类型 | 用途 |
|---|---|---|
| `ATOMGIT_TOKEN` | repo secret | AtomGit API 认证（提 issue / 评论 / 克隆私有仓库） |
| `AI_MODEL` | repo variable | opencode 模型 id，默认 `alibaba-cn/glm-5` |

## 详细文档

- [docs/geo-issue-analyze.md](docs/geo-issue-analyze.md) — GEO Issue Analyze 流程、脚本接口、配置字段
- [docs/daily-file-check.md](docs/daily-file-check.md) — Daily File Check 流程、检查项、issue 上报规则
- [AGENTS.md](AGENTS.md) — agent 导航用的仓库总览

## 包管理器

本仓库使用 **pnpm**。安装依赖：`pnpm install`；添加依赖：`pnpm add <package-name>`。
