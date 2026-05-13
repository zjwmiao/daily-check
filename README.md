# geo-develop

GEO 优化开发工作流的**协调仓**。把"评估侧产生的 P0 问题 → 4 维度自动分析 → 在官网仓库提 issue/PR"全链路落到 GitHub Actions,以 issue 评论作触发器。

## 它做什么

`geo-workflow` 通过 AI 平台引用率评估持续产出 P0 类 issue(官网有内容但 AI 不引用)。本仓接管这些 issue,自动:

1. 拉取 geo-workflow 的 P0 issue + 对应 `questions.json` 的 `official_urls`
2. 对每个 URL 跑 **可发现性 4 维度** 分析:静态化 / Schema / TDK / Sitemap 包含性
3. 在协调 issue 评论 Markdown 报告
4. 在对应 portal 仓(openEuler-portal / mindspore-portal,AtomGit)开 issue
5. 收到 `/fix` 评论后,clone portal 仓,调用 opencode+glm5 修复,提 PR,把链接回评到所有相关 issue

## 用法

### 触发分析

在本仓开一个 issue:

- 标题 `[GEO优化]` — 分析 geo-workflow 内所有 P0 issue(覆盖范围 = openEuler + MindSpore)
- 标题 `[GEO优化]#42` — 仅分析 geo-workflow issue #42

然后在 issue 下评论:

```text
/analyze
```

工作流会跑 `geo-bot.yml` 里的 `analyze` job,产物落到 `geo-runs/{issue}/{timestamp}/`,并在 issue 下评论报告。

### 触发修复

在同一 issue 下评论:

```text
/fix
```

工作流会跑 `geo-bot.yml` 里的 `fix` job,**自动复用同一 issue 下最近一次 `/analyze` 评论里嵌入的 payload**(无需重新 `/analyze`),对每个涉及的 community 提一个 PR 到对应 portal 仓。修复决策(opencode 修改清单)+ PR 链接会以评论形式回到本 issue,作为审计轨迹。

## 本地调试

```bash
pnpm install
export GITHUB_TOKEN=$(grep '^GITHUB_TOKEN' .env | sed 's/.*=[[:space:]]*//')

# 1) 拉候选
pnpm run fetch-issues -- --issue=40 --communities=MindSpore --output=/tmp/c.json

# 2) 跑分析(--skip-browser 跳过 playwright)
pnpm run run-analysis -- --input=/tmp/c.json --output=/tmp/a.json --skip-browser

# 3) 生成报告
pnpm run report -- --input=/tmp/a.json --output=/tmp/report.md
```

或对单个 URL 直跑:

```bash
pnpm run analyze -- https://www.openeuler.org/zh/ --skip-browser
```

## 仓库结构

```text
scripts/
  lib/                    共用工具(html-fetch / atomgit-api / community-map)
  checks/                 单维度判定(static-render / schema / tdk / sitemap-inclusion)
  analyze-discoverability.js   单 URL 4 维度 orchestrator
  fetch-geo-issues.js          拉 geo-workflow 候选
  run-analysis.js              批量分析
  generate-report.js           生成评论 Markdown
  open-portal-issues.js        atomgit 开 issue
  plan-fix-runs.js             /fix 任务拆分
  execute-fix-runs.js          clone + opencode + PR
  comment-fix-summary.js       回评

.github/
  workflows/geo-bot.yml                 单 workflow,analyze + fix 两个 job(if 区分)
  actions/atomgit-create-{issue,pr}/    AtomGit API composite action
  actions/run-agent/                    opencode+glm5 调用器(沿用)
  agents/geo-fix-prompt.md              修复 prompt(白名单约束)

docs/
  design.md                            完整架构(看第十节)
  decisions.md                         ADR(8 条)
  sessions/                            按日期的会话日志
  progress.md / analytics.md           原则与覆盖范围
```

## 配置

| 名称                     | 用途                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `GITHUB_TOKEN`           | GitHub Actions 内置,只对 geo-develop 自身有读写权                 |
| `GEO_GITHUB_TOKEN`| repo secret,**必填**。PAT,需有 geo-workflow(private)读权限    |
| `ATOMGIT_TOKEN`          | repo secret,**必填**。用于 atomgit 创建 issue/PR/push             |
| `ATOMGIT_API_BASE`       | 可选,默认 `https://api.atomgit.com`                              |
| `AI_MODEL`               | 可选,opencode 模型 id,默认 `alibaba-cn/glm-5`                    |
| `GEO_SKIP_BROWSER`       | 可选 repo variable,设 `true` 跳过 playwright 抓取                |
| `GEO_PORTAL_CACHE_DIR`   | 可选 env,portal 仓持久缓存根目录,默认 `~/.cache/geo-bot/portals`  |

## 设计参考

- 架构与产物:[docs/design.md 第十节](docs/design.md)
- 决策记录:[docs/decisions.md](docs/decisions.md)(ADR-0001 ~ ADR-0008)
- 实施日志:[docs/sessions/](docs/sessions/)

## 范围与限制

- 首期只覆盖 **openEuler + MindSpore**;新增社区需在 `scripts/lib/community-map.js` 补条目
- 只分析 4 个开发维度(robots.txt / llms.txt 暂不做,见 ADR-0003)
- 只处理 P0 类 issue(有 `official_urls`),P1 内容空白类跳过
- 运行在 portal-x86 runner(opencode + glm5 已就位)
