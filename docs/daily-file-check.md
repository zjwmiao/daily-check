# Daily File Check Workflow Design 文档

## 概述

Daily File Check 是一个**配置驱动**的定时巡检流程，用于检查前端 portal 项目页面的 SEO/GEO 配置完整性。已实现 TDK（title/description/keywords）、JSON-LD Schema、robots.txt 合理性、sitemap 收录覆盖四类检查，并以可插拔方式注册便于扩展。

所有待检项目（仓库地址、构建命令、产物目录、SEO 配置目录等）集中维护在仓库根的 [`daily-check-config.yaml`](../daily-check-config.yaml)，脚本逐项目运行并把缺失项汇总成 issue 提到对应仓库。

> gitcode.com 与 atomgit.com 是同一平台的两个域名，API（`api.atomgit.com`）与鉴权（`ATOMGIT_TOKEN`）通用。

## 流程图

```mermaid
flowchart TB
    subgraph external["外部"]
        REPOS["portal 仓库<br/>(gitcode / atomgit)"]
    end

    subgraph workflow["daily-file-check.yml"]
        direction TB

        TRIGGER["定时触发 (每日 02:00 UTC) /<br/>手动触发 (workflow_dispatch)"]

        subgraph load["1. 配置加载"]
            L1["读取 daily-check-config.yaml"]
            L2["按 --project 过滤<br/>(可选, 默认全部)"]
            L1 --> L2
        end

        subgraph perproj["2. runProject (逐项目)"]
            direction TB
            R1["按 skip_check 计算 activeChecks"]
            R2["needsBuild? → clone/pull<br/>+ buildPortal(build_script/build_dir)"]
            R3["enumeratePages: 扫描产物 HTML"]
            R4["依次跑 CHECKS:<br/>tdk / schema / robots / sitemap"]
            R5["汇总 findings → createOrUpdateIssue"]
            R1 --> R2 --> R3 --> R4 --> R5
        end

        SUM["3. 总汇总<br/>(成功/失败/各维度问题数)"]

        TRIGGER --> load --> perproj --> SUM
    end

    REPOS -- "git clone / pull" --> R2
    R5 -- "createIssue / updateIssue" --> REPOS

    classDef ext fill:#fef3c7,stroke:#92400e
    classDef wf fill:#dbeafe,stroke:#1e40af
    classDef sub fill:#f3f4f6,stroke:#6b7280
    class REPOS ext
    class TRIGGER,SUM wf
    class load,perproj sub
```

## 配置文件 daily-check-config.yaml

每个项目一个条目，字段如下：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 项目名，`--project` 按此精确匹配 |
| `owner` / `repo` | ✅ | 仓库 owner/repo，用于缓存目录与提 issue |
| `repo_url` | 构建类检查必填 | clone 地址；私有仓库会注入 `ATOMGIT_TOKEN` |
| `branch` | 可选 | 目标分支（当前用 `git pull --rebase` 跟随默认分支） |
| `framework` | 可选 | 框架标识（VitePress / Nuxt，仅作记录） |
| `build_script` | 构建类检查必填 | 构建用的 npm script（如 `build:geo` / `generate:geo`） |
| `build_dir` | 构建类检查必填 | 构建产物目录（相对仓库根，如 `app/.vitepress/dist`） |
| `seo_config_dir.tdk` | tdk 检查必填 | TDK 配置根目录（如 `.geo/tdks`） |
| `seo_config_dir.schema` | schema 检查必填 | JSON-LD 配置根目录（如 `.geo/jsonld`） |
| `skip_check` | 可选 | 跳过的检查项数组，如 `[tdk, schema]` |
| `home` | 可选 | 线上站点 URL 数组，供 robots/sitemap 检查使用 |

示例：

```yaml
projects:
  - name: openEuler
    owner: openeuler
    repo: openEuler-portal
    repo_url: https://gitcode.com/openeuler/openEuler-portal.git
    branch: master
    framework: VitePress
    build_dir: app/.vitepress/dist
    build_script: build:geo
    seo_config_dir:
      tdk: .geo/tdks
      schema: .geo/jsonld
    home:
      - https://www.openeuler.org/
```

## 核心脚本说明

### scripts/geo-daily-check/ 目录结构

```
scripts/geo-daily-check/
  check-single.js         # 入口脚本，配置驱动逐项目运行
  utils.js                # 共享工具函数（log/shouldIgnore/pathnameToKey等）
  checks/
    robots.js             # robots.txt 检查
    sitemap.js            # sitemap 可访问性 + TDK/Schema 配置检查
    url-access.js         # URL 可访问性抽样检查
    llms-txt.js           # llms.txt 检查
    coverage.js           # 构建产物 sitemap 覆盖检查
    ssr.js                # SSR 渲染检查
```

### scripts/geo-daily-check/check-single.js

唯一入口脚本，配置驱动逐项目运行。

**命令行参数**:

| 参数 | 说明 | 默认 |
|------|------|------|
| `--config=<path>` | 配置文件路径 | 仓库根 `daily-check-config.yaml` |
| `--project=<name>` | 只跑指定 `name` 的项目 | 全部项目 |
| `--dryRun` | 仅检查、打印汇总，不提 issue | false |

**关键函数**:

| 函数 | 用途 |
|------|------|
| `loadConfig(path)` | 解析 YAML，返回 `projects` 数组 |
| `injectToken(repoUrl, token)` | 把 token 注入 https 仓库地址（公开仓库免 token） |
| `prepareProjectDir(owner, repo, repoUrl)` | clone 或 `git pull --rebase`，返回 `{ dir, skipBuild }` |
| `runProject(project, { dryRun })` | 单项目主流程：构建 → 跑检查 → 提 issue |
| `createOrUpdateIssue(project, findings)` | 按 `[GEO配置缺失]` 前缀查找并创建/更新 issue |

检查函数从 `checks/` 子目录导入，每个检查项为独立模块。

### scripts/geo-daily-check/utils.js

共享工具函数模块，导出：

| 导出 | 用途 |
|------|------|
| `HTML_IGNORE` | 扫描构建产物时忽略的文件 pattern 数组 |
| `CHECK_DIMENSIONS` | 检查维度注册表 |
| `log(msg)` | 带时间戳的日志输出 |
| `shouldIgnore(pathname, patterns)` | 判断 pathname 是否应忽略 |
| `pathnameToKey(pathname)` | pathname → 配置定位 key |
| `normalizePathname(p)` | 归一化 pathname（解码、去尾斜杠、去.html） |
| `matchGlob(pattern, pathname)` | glob 模式匹配 |
| `pickRandom(arr, n)` | 随机抽取 n 个元素 |
| `iterateFiles(root, pattern, ignore)` | 遍历文件 Generator

### scripts/lib/portal-build.js

`buildPortal(workDir, opts)` 负责安装依赖并构建。本流程新增两个可选覆盖项：

- `opts.buildScript` —— 传入则直接用（来自 `build_script`），否则按候选列表自动探测
- `opts.outputDirRel` —— 传入则直接用并校验存在（来自 `build_dir`），否则按 mtime 在候选目录里挑最新

未传时保持原自动探测行为，向后兼容其它调用方。

## 可插拔检查项

检查项集中注册在 `CHECKS`，每项形如 `{ needsBuild, dimension, run }`：

```js
const CHECKS = {
  tdk:     { needsBuild: true,  dimension: 'tdk',     run: checkTDK },
  schema:  { needsBuild: true,  dimension: 'schema',  run: checkSchema },
  robots:  { needsBuild: false, dimension: 'robots',  run: checkRobots },
  sitemap: { needsBuild: true,  dimension: 'sitemap', run: checkSitemap },
};
```

- `run(ctx)` 返回 `{ findings: [{ url, message }], skipped?, todo? }`
- `ctx = { project, workDir, buildDir, pages, log }`
- `needsBuild` 决定该项目是否需要 clone + 构建；不依赖产物的项目（如纯 robots）不会克隆
- `skip_check` 里列出的 key 会从 `activeChecks` 中剔除

| 检查项 | 状态 | 逻辑 |
|--------|------|------|
| `checkRobotsTxt` | ✅ 已实现 | 检查 robots.txt 存在性、合法性（未全站封禁）、是否声明 Sitemap |
| `checkSitemapAccessible` | ✅ 已实现 | 从 robots.txt 提取 sitemap 地址，检查可访问性和有效内容 |
| `checkSitemapConfig` | ✅ 已实现 | 遍历 sitemap 条目，检查 TDK/Schema 配置文件是否存在 |
| `checkUrlAccessibility` | ✅ 已实现 | 从 sitemap 抽样检查 URL 可访问性 |
| `checkLlmsTxt` | ✅ 已实现 | 检查 llms.txt/llms-full.txt 是否存在且非空 |
| `checkBuildSitemapCoverage` | ✅ 已实现 | 检查构建产物页面是否被 sitemap 收录 |
| `checkSsrRendering` | ✅ 已实现 | 检测首页 + sitemap 抽样 URL 是否为 SSR/SSG 渲染，识别 CSR 空壳页面 |

**checkRobotsTxt 细节**：

1. 拉 `{home}/robots.txt`，拉取失败 → 记一条 finding
2. `blocksAllCrawlers` —— 按分组解析，若作用于 `User-agent: *` 的组出现 `Disallow: /` 且无 `Allow: /` 放开 → 判为全站封禁，记一条 finding
3. 无 `Sitemap:` 声明 → 记一条 finding
4. 返回 `robotsContent` 供后续检查使用

**checkSitemapAccessible 细节**：

1. 从 `robotsContent` 提取 `Sitemap:` 地址；无声明则回退 `{home}/sitemap.xml`
2. 对每个 sitemap URL 调用 `getSitemapUrls` 验证可访问性
3. 单个 sitemap 无法访问 → 记一条 finding
4. 所有 sitemap 都无法访问 → 记一条总问题 finding
5. 返回成功的 sitemap 条目 URL 供后续检查使用

**checkSitemapConfig 细节**：

1. 遍历 sitemap 条目 URL，归一化 pathname 得到 `key`
2. 检查 `{seo_config_dir.tdk}/{key}/index.json` 是否存在 → 不存在记一条 `sitemap-tdk` finding
3. 检查 `{seo_config_dir.schema}/{key}/index.json` 是否存在 → 不存在记一条 `sitemap-schema` finding

**checkSsrRendering 细节**（`needsBuild: false`，仅需线上站点）：

1. 检测范围：首页 + 从 sitemap 随机抽取 10 个 URL
2. 框架特定检测（根据 `project.framework`）：
   - **VitePress**：检查 `class="VPContent"` 和 `class="vpi"` 等特征标记
   - **Nuxt**：检查 `window.__NUXT__` / `data-n-head` 数据注入，或 `#__nuxt` 容器内容丰富度
3. 通用内容丰富度检测：
   - 提取 `<body>` 内容，移除 `<script>` / `<style>` 标签后统计纯文本长度
   - 纯文本 ≥ 500 字符 → 判定为 SSR/SSG（或纯静态）
4. CSR 特征检测：
   - `<div id="app"></div>`（Vue SPA 空挂载点）
   - `<div id="root"></div>`（React SPA 空挂载点）
   - `<div id="__nuxt"></div>`（Nuxt CSR 模式）
5. 判定为 CSR → 记一条 finding，建议改用 SSR/SSG 提升搜索引擎可发现性

> 新增检查项：实现 `checkXxx(ctx)` 函数并在 `CHECKS` 注册即可；若依赖线上站点设 `needsBuild: false`，若依赖构建产物设 `needsBuild: true`。

## Issue 上报

复用 [`scripts/lib/atomgit-api.js`](../scripts/lib/atomgit-api.js)。所有 findings 汇总成一个 issue：

- **标题**: `[GEO配置缺失] {owner}/{repo}: {N} 项检查未通过`
- **去重**: 按 `[GEO配置缺失]` 前缀查找已有 issue，存在则 `updateIssue` 否则 `createIssue`
- **正文**: 按维度列表

```markdown
**项目**: openeuler/openEuler-portal

检测到以下页面/检查项存在问题:

| Dimension | 页面路径 | 问题描述 |
| --- | --- | --- |
| tdk | /about | 缺少 TDK (title, description, keywords) 配置 |
| schema | / | 缺少 JSON-LD 结构化数据配置 |
```

无 finding 或未设 `ATOMGIT_TOKEN`（或 `--dryRun`）时不提 issue。

## Workflow 配置

### .github/workflows/daily-file-check.yml

**触发方式**:
- 定时: 每日 02:00 UTC (`'0 2 * * *'`)
- 手动: workflow_dispatch

**参数**:
| 参数 | 说明 | 默认 |
|------|------|------|
| `project` | 只检查指定项目（配置里的 `name`，留空全部） | 空 |
| `dry_run` | 仅检查不提 issue | false |

**环境变量**:
- `ATOMGIT_TOKEN`: 提 issue 认证；克隆私有仓库时注入 `repo_url`

**运行命令**（runner: `portal-x86`）:
```bash
node scripts/geo-daily-check/check-single.js [--dryRun] [--project=<name>]
```

## 缓存与构建

- 仓库缓存目录: `{os.tmpdir()}/.cache/geo-bot/projects/{owner}-{repo}`
- 已存在且是 git 仓库 → `git pull --rebase`；`Already up to date.` 且产物目录已存在 → 跳过构建复用产物
- 更新失败或目录损坏 → 删除重新 `git clone --depth=100`

## 错误处理

- 单个项目失败（克隆/构建/检查异常）不阻断其它项目，记入汇总
- 单个检查项异常被 try/catch 包住，不影响其它检查项
- 末尾打印总汇总（项目数 / 成功 / 失败 / 各维度问题数）；有失败项目时进程 `exit 1`

## 本地调试

```bash
# 全部项目, 仅检查不提 issue
node scripts/geo-daily-check/check-single.js --dryRun

# 只跑单个项目
node scripts/geo-daily-check/check-single.js --project=openEuler --dryRun

# 用自定义配置
node scripts/geo-daily-check/check-single.js --config=/path/to/cfg.yaml --dryRun
```

> Windows 本地完整 checkout openEuler-portal 可能因 260 字符路径限制失败，属系统限制；Linux runner 不受影响。

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.5.0 | 2026-06-15 | 模块拆分：检查函数移至 `checks/` 子目录（robots/sitemap/url-access/llms-txt/coverage/ssr），共享工具函数移至 `utils.js`，入口脚本精简为 ~350 行 |
| 2.4.0 | 2026-06-15 | 重构检查流程：拆分 robots.txt 检查（checkRobotsTxt）和 sitemap 可访问性检查（checkSitemapAccessible）为独立维度；sitemap 无法访问时上报问题；调整检查顺序为先 robots.txt → sitemap → TDK/Schema |
| 2.3.0 | 2026-06-15 | 实现 checkSsrRendering：检测首页 + sitemap 抽样页面是否为 SSR/SSG 渲染，识别 CSR 空壳页面并上报 |
| 2.2.0 | 2026-06-02 | 实现 checkRobots：校验 robots.txt 可访问、未全站封禁 `*`、声明 Sitemap 且 sitemap 可访问 |
| 2.1.0 | 2026-06-02 | 实现 checkSitemap：robots.txt 发现 sitemap → 展开 index → 按 pathname 比对产物页面收录覆盖；复用并导出 checks/sitemap-inclusion.js 的 getSitemapUrls |
| 2.0.0 | 2026-06-02 | 重构为配置驱动多项目（daily-check-config.yaml）+ 可插拔检查项（checkTDK/checkSchema + robots/sitemap 占位）；修复 TDK/Schema 标志位写反 bug；portal-build 支持显式 build_script/build_dir；删除 check-batch.js，workflow 改单次运行 |
| 1.0.0 | 2026-05 | 原版本：单 `--repo` 参数、硬编码候选目录猜测、check-batch.js 批量编排 |
