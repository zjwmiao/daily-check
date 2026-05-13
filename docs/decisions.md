# 决策日志 (ADR)

> 记录关键技术/产品决策。每条独立编号,不可删除,只能用新条目"取代"旧条目。

## 模板

```text
## ADR-NNNN: <标题>
- 日期: YYYY-MM-DD
- 状态: 提议 / 已采纳 / 已取代 (取代者: ADR-XXXX)
- 上下文: 为什么要做这个决定?面临什么问题?
- 选项:
  - A. ...
  - B. ...
  - C. ...
- 决定: 选 X
- 理由: 为什么是 X 而不是其他?
- 后果: 带来的好处 / 接受的代价 / 后续要做的事
```

---

<!-- 新决策追加到下方 -->

## ADR-0001: geo-develop 作为协调仓,以 issue 评论作触发器

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: GEO 优化工作流横跨多个仓库(geo-workflow 评估侧、portal 实现侧)。需要一个中枢承载触发、分析产物、对外评论,且要在不污染 geo-workflow 评估职责的前提下闭环。
- 选项:
  - A. 在 geo-workflow 原仓加 workflow,直接 self-loop
  - B. 在 geo-develop 协调,以 `[GEO优化]` issue + `/analyze` `/fix` 评论触发
  - C. 单独建第三方 webhook 服务
- 决定: B
- 理由: geo-workflow 是评估产出方,不宜耦合执行侧逻辑;C 维护成本高;B 用现有 GitHub 能力即可,且 issue 评论同时充当审计轨迹。
- 后果:
  - geo-develop 的 issue 区将成为 GEO 工单池
  - 工作流要解析 issue title(`[GEO优化]` 或 `[GEO优化]#N`)
  - 跨仓库通信全靠 token(GITHUB_TOKEN + ATOMGIT_TOKEN)

## ADR-0002: 数据接入走 GitHub REST API + Raw 文件,不 clone geo-workflow

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 分析阶段需要拉 geo-workflow 的 issue 数据 + `assessments/{community}/questions.json`。
- 选项:
  - A. `git clone` 整个 geo-workflow 仓
  - B. 用 REST API + raw.githubusercontent.com 按需拉
- 决定: B
- 理由: 单次 /analyze 只读不超过 50 个文件(issue + 2 个 community 的 questions.json + issue-map.json),clone 开销和缓存策略都不划算;API 更轻量、可缓存。
- 后果: 必须显式处理 rate limit(暂时无忧,token 5000/h);question.json 文件大时分页处理。

## ADR-0003: 分析维度仅做 4 项,放弃 robots.txt 和 llms.txt

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: design.md 列了 6 个开发维度(静态化/Schema/TDK/Sitemap/robots/llms),用户明确本期只关注前 4 个。
- 选项:
  - A. 全 6 维度
  - B. 仅 4 维度(静态化/Schema/TDK/Sitemap)
- 决定: B
- 理由: robots.txt 全站级问题,不应按 URL 分析;llms.txt 检查逻辑复杂(需结构对齐)且当前价值低,先确保核心 4 项稳定。
- 后果: 后期增维只需添 `checks/*.js` 模块 + 在 orchestrator 注册,影响面可控。

## ADR-0004: /analyze 自动在 portal 仓开 issue

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 分析报告需要在 portal 侧有归口承载,便于后续 PR 关联。
- 选项:
  - A. 仅在 geo-develop 评论报告
  - B. /analyze 自动在 portal 开 issue,附报告链接
  - C. /fix 时再开 portal issue
- 决定: B
- 理由: 用户原文"如果是官网的问题就提一个issue到对应官网仓库,并输出对应的分析报告";B 让 portal 仓维护者可单独追踪问题,即使 /fix 失败也有 issue 在。
- 后果: 需要 atomgit-create-issue action;portal 仓 issue 列表会增多,需考虑 label 区分(`geo-improvement`)。

## ADR-0005: /fix 用 opencode + glm5,不引入 Claude API

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 自动修复阶段需要 LLM 完成 Schema/TDK/Sitemap 等配置文件的精确改动。
- 选项:
  - A. 复用现有 opencode + glm5(runner 已配)
  - B. 接 Claude API
- 决定: A
- 理由: runner 已就位,中文场景 glm5 适配良好,成本可控;现有 `run-agent` action 直接复用。
- 后果: 修复质量取决于 prompt 与 agent 配置;后续若 glm5 不够,可换 model id。

## ADR-0006: 新写 atomgit-create-pr,不扩展现有 create-pr

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 现有 `.github/actions/create-pr` 用 `gh` CLI,只对 GitHub 有效。Portal 仓在 atomgit(GitCode)上。
- 选项:
  - A. 扩展 create-pr 支持双平台
  - B. 新写 atomgit-create-pr,并行存在
- 决定: B
- 理由: 双平台 if/else 会污染既有路径,提高回归风险;新 action 单一职责,可独立演进。
- 后果: 维护两套 action,但 API 调用层只是 curl 包装,代码量小。

## ADR-0008: 删除旧脚本与三方 SEO skills

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 仓库历史上引入了 `aaron-he-zhu/seo-geo-claude-skills` 的 22 个 skills(`.claude/skills/` + `.agents/skills/` 镜像 + `.claude/commands/`)以及 6 个独立 CLI 脚本(`analyze.js` / `crawl.js` / `utils.js` / `validate-{robots,sitemap,tdk}.js`)。新工作流落地后均已被 `scripts/lib/` + `scripts/checks/` + workflow 替代,长期保留增加心智负担且 README 已引用不存在的功能。
- 选项:
  - A. 全部保留作"工具箱"备用
  - B. 仅删旧脚本,保留 skills 给 Claude Code 兜底用
  - C. 全删(脚本 + skills + lock + commands + 镜像)
- 决定: C
- 理由: 新工作流自包含,审计与维护更直接;skills 可随时通过 marketplace 重装,不必锁在仓库内;`.agents/skills` 与 `.claude/skills` 内容一致,纯冗余。
- 后果:
  - `package.json` 同步去掉 `"crawl"` npm script
  - README 与 design.md 中所有指向已删脚本的引用必须更新
  - 后续如需个别 skill,改在用户级 `~/.claude/skills/` 安装,不再入仓

## ADR-0007: 分析制品存 geo-runs/{issue}/,推回本仓

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: /fix 需要读取 /analyze 的产物;若仅靠 GitHub artifact,90 天过期且 job 间传递繁琐。
- 选项:
  - A. 仅 GitHub artifact
  - B. 提交 `geo-runs/{issue}/` 到 geo-develop 仓 main 分支
  - C. 用专门的 storage(S3/COS)
- 决定: B
- 理由: 全链路可审计;/fix 可直接 checkout 读取;artifact 仍并行上传作短期保险。
- 后果:
  - geo-develop 仓会持续累积 geo-runs/ 目录,需要定期归档(后续 ADR)
  - 工作流需要 push 权限(默认 GITHUB_TOKEN 已有)
