# GEO Workflows

本仓库托管三个独立的 SEO/GEO 自动化 workflow，均运行于 GitHub Actions（runner: `portal-x86`），扫描 AtomGit portal 仓库标题以 `[GEO]` 开头的 issue：

| Workflow | 用途 | 入口脚本 | 详细文档 |
|---|---|---|---|
| GEO Issue Analyze | 程序化检查 + LLM 语义分析 `[GEO]` issue，评论或创建分析 issue | `scripts/geo-issue-analyze/scan-issues.js` | [docs/geo-issue-analyze.md](docs/geo-issue-analyze.md) |
| Daily File Check | 逐项目 clone→构建→可插拔检查项，按维度提 issue | `scripts/geo-daily-check/check-single.js` | [docs/daily-file-check.md](docs/daily-file-check.md) |
| HTML Semantic Check | 逐项目 clone→构建→收集 HTML→12 维度语义化检查→提 issue | `scripts/html-semantic-check/check-single.js` | — |

三个 workflow 共享 `scripts/lib/` 公共库与 `projects-config.yaml` 配置。

## GEO Issue Analyze Workflow

- **触发**: schedule `0 3 * * *`（每日 03:00 UTC）或 workflow_dispatch（参数 `project` / `dry_run`）
- **配置**: 项目列表在 [`projects-config.yaml`](projects-config.yaml)
- **Workflow**: `.github/workflows/geo-issue-analyze.yml`

**流程**: `scan-issues.js` → 逐 issue `process-single.js`

1. **Phase 1 程序化检查**（`url-checks.js`）：提取 issue 内 URL → 按 URL 域名匹配 `projects-config.yaml` 项目 → 检查 sitemap / llms-full.txt 覆盖 → 判断 `ignore_routes`
2. **Phase 2 LLM 语义分析**（`runOpencodeAnalyze`）：`buildLLMPrompt` 生成提示词写入文件 → 执行 `opencode run <file> --model <AI_MODEL> --dangerously-skip-permissions` → 抓取页面 HTML → 分析 TDK/Schema 语义
3. **结果路由**（按 `has_problems`）：
   - `false` → 评论到原 issue（不涉及 GEO 基础配置问题）
   - `true` → 在目标仓库创建 `[GEO-ISSUE-ANALYZE]` issue 并评论溯源链接

- **去重标记**（issue 评论 HTML 注释）：`<!-- geo-analyze-skip -->` / `<!-- geo-analyze-result -->` / `<!-- geo-analyze-ignored -->`
- **Dry Run**: `--dryRun` 只分析、不调 AtomGit API，结果存 `dryrun-results/`

### 关键文件

| 文件 | 用途 |
|---|---|
| `scripts/geo-issue-analyze/scan-issues.js` | 扫描各项目 `[GEO]` issues，跳过已标记 |
| `scripts/geo-issue-analyze/process-single.js` | 两阶段分析 + 结果路由 |
| `scripts/geo-issue-analyze/url-checks.js` | URL 程序化检查（sitemap / llms 覆盖） |
| `projects-config.yaml` | 待分析项目列表 |

## Daily File Check Workflow

- **触发**: schedule `0 2 * * *`（每日 02:00 UTC）或 workflow_dispatch（参数 `project` / `dry_run`）
- **配置**: 项目列表在 [`projects-config.yaml`](projects-config.yaml)（与 geo-issue-analyze 共享）
- **Workflow**: `.github/workflows/daily-file-check.yml`

**流程**: `check-single.js` 逐项目 → clone/pull → codegraph init（若需）→ checkLinkAnchor（构建前）→ spawnBuild（非阻塞）→ 并行线上检查 → 等待构建 → 构建产物检查 → 汇总 findings → 按维度/模块提 issue

**检查项**（在 `runProject()` 中按顺序调用，`skip_check` 可剔除）：
`robots-txt` / `sitemap-access` / `sitemap-tdk` / `sitemap-schema` / `sitemap-priority` / `url-access` / `llms-txt` / `ssr-rendering` / `sitemap-coverage` / `tdk-schema-semantic`（需 `enable_tdk_schema_semantic`）/ `link-anchor-check`（需 `enable_link_anchor_check`）

- `tdk-schema-semantic`：有新提交时调 `opencode` + `render-change-analyzer` skill 分析受影响页面，再对构建产物 HTML 做语义一致性检查
- `link-anchor-check`：构建前用 codegraph 分析源码，检测 JS 跳转而非 `<a href>` 的导航；按 agent 判断的功能模块分组提 issue

**Issue 上报**：

- 标题 `[GEO Daily Check] {owner}/{repo}: [{label}] {N}项检查未通过`
- 普通维度按 `check` 分组；`link-anchor-check` 再按功能模块细分，每模块一个 issue
- 按 `[GEO Daily Check]` 前缀去重（createOrUpdate），无问题的维度/模块自动关闭旧 issue
- 无 finding / 未设 `ATOMGIT_TOKEN` / `--dryRun` 时不提 issue

- **历史记录**: 每次运行（非 dryRun）导出 `daily-check-history.xlsx`（按项目分 sheet）并推送
- **Dry Run**: `--dryRun` 仅检查不提 issue

### 关键文件

| 文件 | 用途 |
|---|---|
| `scripts/geo-daily-check/check-single.js` | 入口（配置驱动逐项目） |
| `scripts/geo-daily-check/utils.js` | 共享工具（log / shouldIgnore / pathnameToKey / ...） |
| `scripts/geo-daily-check/history-export.js` | 历史记录导出 |
| `scripts/geo-daily-check/checks/*.js` | 各检查项模块 |
| `projects-config.yaml` | 待检项目配置（与 geo-issue-analyze 共享） |

## HTML Semantic Check Workflow

- **触发**: schedule `0 4 * * 0`（每周日 04:00 UTC）或 workflow_dispatch（参数 `project` / `dry_run`）
- **配置**: 项目列表在 [`projects-config.yaml`](projects-config.yaml)（与其他两个 workflow 共享）
- **Workflow**: `.github/workflows/html-semantic-check.yml`

**流程**: `check-single.js` 逐项目 → clone/pull → 构建 → 收集构建产物 HTML 文件 → 通过 registry 自动发现并运行 `checks/` 下所有检查项 → 汇总 findings → 提 issue

**检查项**：在 `checks/` 目录下自动发现，`skip_check` 可剔除。当前检查项待补充。

**可插拔设计**: `registry.js` 自动扫描 `checks/` 目录下所有 `.js` 文件，每个文件导出 `meta`（id/dimension/name/description）+ `check`（async 函数）即可自动接入，无需修改其他文件。

**Issue 上报**：

- 标题 `[GEO html Semantic] {owner}/{repo}: {N}项HTML语义问题`
- 按 `[GEO html Semantic]` 前缀去重（createOrUpdate），无问题自动关闭旧 issue
- 无 finding / 未设 `ATOMGIT_TOKEN` / `--dryRun` 时不提 issue
- docs 类型项目自动跳过

- **Dry Run**: `--dryRun` 仅检查不提 issue

### 关键文件

| 文件 | 用途 |
|---|---|
| `scripts/html-semantic-check/check-single.js` | 入口（配置驱动逐项目） |
| `scripts/html-semantic-check/registry.js` | 可插拔检查项注册器（自动发现 checks/ 目录） |
| `scripts/html-semantic-check/utils.js` | 共享工具（log / DIMENSION_DESCRIPTIONS / iterateFiles / ...） |
| `scripts/html-semantic-check/checks/*.js` | 各检查项模块（待补充） |
| `projects-config.yaml` | 待检项目配置（共享） |

## 共享库

### scripts/lib/

| 文件 | 用途 |
|---|---|
| `atomgit-api.js` | AtomGit REST 客户端（自动重试 + issue / PR API） |
| `html-fetch.js` | HTTP 抓取 / `parseHtml` / `fetchBrowser` |
| `utils.js` | 公共工具（`parseArgs` / `log` / `readInput`） |

### scripts/checks/

| 文件 | 用途 |
|---|---|
| `sitemap-inclusion.js` | sitemap 收录检查（`getSitemapUrls`），被两个 workflow 共享 |

### .opencode/skills/

| Skill | 用于 |
|---|---|
| `render-change-analyzer` | daily-file-check 的 `tdk-schema-semantic` 检查项 |
| `link-anchor-analyzer` | daily-file-check 的 `link-anchor` 检查项 |

## 本地运行

```bash
pnpm install
export ATOMGIT_TOKEN=xxx

# GEO Issue Analyze
node scripts/geo-issue-analyze/scan-issues.js --project=openEuler
node scripts/geo-issue-analyze/process-single.js --dryRun --input=issue.json

# Daily File Check
node scripts/geo-daily-check/check-single.js --dryRun
node scripts/geo-daily-check/check-single.js --project=openEuler --dryRun

# HTML Semantic Check
node scripts/html-semantic-check/check-single.js --dryRun
node scripts/html-semantic-check/check-single.js --project=openEuler --dryRun
```

> Windows 本地完整 checkout 大型 portal 仓库可能因 260 字符路径限制失败，属系统限制；Linux runner 不受影响。

## 配置 (repo secrets / variables)

| 名称 | 类型 | 用途 |
|---|---|---|
| `ATOMGIT_TOKEN` | repo secret | AtomGit API 认证（提 issue / 评论 / 克隆私有仓库） |
| `AI_MODEL` | repo variable | opencode 模型 id，默认 `alibaba-cn/glm-5` |

## 包管理器

本仓库使用 **pnpm**。安装依赖：`pnpm install`；添加依赖：`pnpm add <package-name>`。
