# 工作流记录机制搭建 — 2026-05-13

## 目标

为"工作流设计 + 脚本完善"任务建立可持续的记录机制,覆盖关键决策与每轮对话。

## 轮次

### Round 1 — 初始提问

- 请求: 用户希望在工作流设计与脚本完善过程中,记录每一步关键决策,并尽可能记录每轮对话。
- 结论: 采用三层结构 — ADR(决策日志) + 会话摘要(每轮 3 行) + Claude 记忆系统(跨会话偏好)。粒度选定:仅关键决策 + 每轮摘要。工作流类型:非 SEO 通用工作流(待用户补充具体内容)。
- 产出:
  - 新建 `docs/decisions.md`(ADR 模板)
  - 新建 `docs/sessions/README.md`(会话日志规范)
  - 新建本文件作为当前会话日志
  - 写入记忆 `feedback_recordkeeping.md`(让后续会话自动遵循该习惯)

### Round 2 — 工作流定义 + 计划批准

- 请求: 用户给出 GEO 自动化工作流完整需求 — 基于 GitHub Action,以 `[GEO优化]` issue + `/analyze` `/fix` 评论触发,覆盖"分析 → portal issue → 修复 → PR"全链路,关联仓库 geo-workflow(GitHub)、openEuler-portal/mindspore-portal(AtomGit)。
- 结论: 通过 AskUserQuestion 锁定 4 个关键决策 — 首期只覆盖 openEuler+MindSpore、4 维度(静态化/Schema/TDK/Sitemap)、/analyze 自动开 portal issue、self-hosted runner。计划文件落到 `~/.claude/plans/steady-splashing-teacup.md`,用户已批准。共记录 7 条 ADR。
- 产出:
  - 探索完成:`scripts/`(crawl/analyze/validate-tdk/sitemap/robots)、`.github/actions/{create-pr,run-agent}`、`docs/design.md`、`.env`(双 token)、geo-workflow 数据结构(issue-map.json + questions.json)
  - `docs/decisions.md` 追加 ADR-0001 ~ ADR-0007
  - TodoWrite 列出 12 个实施任务(对应计划阶段 1~5)

### Round 3 — 全量实施

- 请求: 用户同意按计划执行,本轮一次性把 Phase 1~5 全部落地。
- 结论: 端到端管线本地跑通 — fetch geo-workflow#40 → 3 个 question 的 URL 分析 → 报告 markdown(7 critical / 0 important / 3 minor),工程类问题均能被检出。GitHub Actions 与 fix 链路代码已就绪,但 AtomGit API base 端点 + opencode runner 行为需在首次远端运行时验证。
- 产出:
  - lib: `html-fetch.js` / `atomgit-api.js` / `community-map.js`
  - checks: `static-render.js` / `schema.js` / `tdk.js` / `sitemap-inclusion.js`
  - orchestrators: `analyze-discoverability.js` / `run-analysis.js` / `generate-report.js` / `fetch-geo-issues.js` / `open-portal-issues.js` / `plan-fix-runs.js` / `execute-fix-runs.js` / `comment-fix-summary.js`
  - actions: `.github/actions/atomgit-create-{issue,pr}/` (index.js + action.yml)
  - workflows: `.github/workflows/geo-{analyze,fix}.yml`
  - agent: `.github/agents/geo-fix-prompt.md` (严格白名单)
  - `docs/design.md` 第十节重写

### Round 4 — 清理冗余资产

- 请求: 用户希望删除项目中多余的脚本、skills、三方件、过期文档。
- 结论: 通过 AskUserQuestion 锁定 4 簇清理范围(均选"全删/重写") — 旧脚本 6 个、三方 SEO skills 22 个 + commands + 镜像 + lock、README 重写、design.md 前 9 节去 dead 引用保留原则。记录为 ADR-0008。
- 产出:
  - 删除:`scripts/{analyze,crawl,utils,validate-{robots,sitemap,tdk}}.js`、`.claude/skills/`、`.claude/commands/`、`.agents/`、`skills-lock.json`
  - `package.json` npm scripts 重写为 4 个对应新管线
  - `README.md` 重写为新工作流入门(24KB → 4KB)
  - `docs/design.md` 通过 sed 批量替换 + 5 处 Edit 清理,所有 dead script 引用消失;新增第 9 节指针;第 4/5/6 节保留原则的同时标注当前实现状态
  - `docs/decisions.md` 追加 ADR-0008(理由 + 影响)

## 未完成 / 待办

- [ ] 在远端 self-hosted runner 上端到端跑一遍 /analyze 验证(确认 AtomGit API base 路径 + secret 命名)
- [ ] 在测试 issue 上跑 /fix 验证 opencode prompt 真实表现
- [ ] (后续 ADR)归档策略 — geo-runs/ 长期累积后的清理
