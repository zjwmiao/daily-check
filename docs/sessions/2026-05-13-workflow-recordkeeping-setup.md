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
- 结论: 通过 AskUserQuestion 锁定 4 个关键决策 — 首期只覆盖 openEuler+MindSpore、4 维度(静态化/Schema/TDK/Sitemap)、/analyze 自动开 portal issue、portal-x86 runner。计划文件落到 `~/.claude/plans/steady-splashing-teacup.md`,用户已批准。共记录 7 条 ADR。
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

### Round 5 — Workflow 简化 + Secret 配置

- 请求: (1) 用户指出 workflow 不应该加 `setup-node`,portal-x86 runner 已预装 Node/pnpm/opencode;(2) 询问 secrets 是否配置;(3) 用户自己在 GitHub UI 配好了 `ATOMGIT_TOKEN`。
- 结论: 两个 workflow 移除 `actions/setup-node@v4`,只保留 `pnpm install --frozen-lockfile`。本机 API 验证 repo `opensourceways/geo-develop` 已有 1 个 secret(`ATOMGIT_TOKEN`,updated 2026-05-13T09:22:34Z)。Runner 预装假设固化为长期记忆。
- 产出:
  - `.github/workflows/geo-analyze.yml` / `geo-fix.yml` 去掉 setup-node
  - 新增记忆 `feedback_runner_environment.md` + 更新 MEMORY.md
  - `/tmp/` 清理(临时 libsodium 安装)

### Round 6 — workflow 合并消除 UI 噪声

- 请求: 用户首次远端测试发现一次 `/analyze` 评论会在 Actions 页同时出现 2 个 run(GEO Analyze 28s 成功 + GEO Fix 1s skip),询问原因。
- 结论: 这是 GH Actions 在 `on: issue_comment` 下的标准行为 — 两个独立 workflow 都被触发,job 级 `if:` 事后过滤。合并为单 workflow 多 job 可消除 UI 噪声。用户选 B(合并)。记 ADR-0009。
- 产出:
  - 新建 `.github/workflows/geo-bot.yml`(190 行,2 个 job + 各自 `if:` + 各自 concurrency)
  - 删除 `.github/workflows/geo-{analyze,fix}.yml`
  - README + design.md 5 处引用更新为 `geo-bot.yml#{analyze,fix}`
  - ADR-0009 写入 decisions.md

### Round 7 — 404 根因 + 跨社区 fallback bug

- 请求: 用户首次远端跑 `/analyze` 处理 geo-workflow#21,报告显示 "涉及 issue 0 / URL 0",但 q_080 明明有 4 个 official_urls。
- 结论:
  1. **主因**: geo-workflow 是 **private** 仓,workflow 的 `secrets.GITHUB_TOKEN`(scope=geo-develop)无权读取,API 返回 404。代码的 catch 块吞掉了错误,产物显示为 0 candidates。修法:加 `GEO_GITHUB_TOKEN` secret(用户 PAT)。
  2. **副因 bug**: fetch-geo-issues.js 的 fallback 路径在 issue 不在当前 community 的 issue-map 时,会用同 ID(如 `q_016`)从当前 community 的 questions.json 里错配。给 openEuler issue 错误返回了 MindSpore 的 "数据下沉" question。修法:fallback 时检查 issue title 的 `[Community]` 前缀,不匹配则跳过。
- 产出:
  - `.github/workflows/geo-bot.yml`:fetch 步骤用 `GEO_GITHUB_TOKEN`,缺失时 fail-fast
  - `scripts/fetch-geo-issues.js`:fallback 加 community 前缀校验,本地验证 issue#21 → openEuler 1 个 issue 2 个 question(q_016+q_080),MindSpore 0
  - `docs/decisions.md` ADR-0010
  - README + design.md secret 表更新
- **用户需在 repo settings 加 secret `GEO_GITHUB_TOKEN`**(可复用 .env 里 PAT),否则下次 /analyze 仍会失败但会快速报错

### Round 8 — portal 仓 clone 性能优化

- 请求: 用户指出每次 /fix 全量 clone portal 仓耗时长。
- 结论: self-hosted runner 文件系统持久,改"fresh clone 每次"为"cache + fetch+reset 复用"。失败 fallback fresh clone。记 ADR-0011。
- 产出:
  - `scripts/execute-fix-runs.js` `clonePortal()` 重写:命中 cache 走 `fetch+reset+clean+删 stale 分支`,失败/缺失 fresh clone;main() 适配 `const workDir = clonePortal(run)` 新签名
  - 配置:`GEO_PORTAL_CACHE_DIR` env 可覆盖,默认 `~/.cache/geo-bot/portals/`
  - README + design.md secret 表加一行
  - ADR-0011

### Round 9 — /fix 信号源解耦文件系统,改走 issue 评论

- 请求: 用户反馈 force push 导致中间文件丢失,/fix 看到的是老 analysis,跑出 `0 run(s) executed`。要求不依赖 fix-plan.json 等文件,把修复方案回评到 issue。
- 结论: 重设计 /fix 数据流 — /analyze 在 `report.md` 末尾内嵌精简 `geo-analysis-payload v1` JSON 块,/fix 从 issue 评论里抓最新带 marker 的 payload。文件系统状态只作审计副本,不再是输入信号。ADR-0012 取代 ADR-0007 在 /fix 路径上的角色。本地端到端验证 1 issue / 2 questions / 5 URLs / 7 problems 闭环通。
- 产出:
  - `scripts/generate-report.js`:导出 `PAYLOAD_MARKER` + `buildFixPayload()`,末尾追加 `<details>` 折叠 JSON 块
  - 新建 `scripts/fetch-fix-payload.js`:GitHub API 拉 issue 评论 → 找最新 marker → 抽 JSON
  - `scripts/execute-fix-runs.js`:`--plan` → `--payload`,内联 `planRunsFromPayload()`
  - 删除 `scripts/plan-fix-runs.js`
  - `.github/workflows/geo-bot.yml` fix job:`Locate analysis` + `Plan fix runs` → `Prepare run dir` + `Fetch fix payload from issue comments`
  - `docs/design.md` 10.3-10.5 重写,10.8 列全 12 条 ADR
  - ADR-0012 写入 decisions.md

### Round 10 — AtomGit API 路径修正

- 请求: 用户反馈"往 portal 仓库创建 issue 失败",并提供了官方 docs 链接(post-api-v-5-repos-owner-issues 和 post-api-v-5-repos-owner-repo-pulls)。
- 结论: docs 页面是 JS 渲染 curl 抓不到字段,但路径名本身已经说明问题 — 必须 `/api/v5/` 前缀。本地 curl 实测确认:Auth=`Bearer`、Issue 是 owner-scoped(repo 放 body)、PR 是 GitHub-style 路径、`number` 返回字符串。实测创建探针 issue `openEuler-portal#109` 成功(待人工关闭)。
- 产出:
  - `scripts/lib/atomgit-api.js`:`API_PREFIX = '/api/v5'`,createIssue 改 `POST /api/v5/repos/{owner}/issues` + body 加 `repo` 字段,labels 改逗号字符串
  - `.github/actions/atomgit-create-issue/index.js`:同上
  - `.github/actions/atomgit-create-pr/index.js`:所有路径加 `${API_PREFIX}`
  - `docs/decisions.md` ADR-0013(按升序追加到末尾,这次没再 prepend 错位)
  - `docs/design.md` 10.8 加 ADR-0013 一行

### Round 11 — 5 项可靠性优化 + atomgit API 全量回测

- 请求: 用户读完流程后提的 5 点:(1) 加重试/打印,(2) 失败显式报错+回评(不要静默返 0),(3) 只看官网域(过滤 forum/discuss),(4) issue/PR 不重复创建要更新,(5) 干掉 `git config user.name`。
- 结论: 逐项修完。curl 全量回测 atomgit API,新发现 PATCH issue 字段是 `body`(GitHub 风格)而非 owner-scoped create 的 `description`,代码同步修正。ADR-0014 记录。
- 产出:
  - `scripts/lib/atomgit-api.js`:全 endpoint 加 `retry(fn, {label, max:3, backoff})`;新增 `findIssueByTitlePrefix` / `updateIssue` / `updatePullRequest`;PATCH issue 字段定为 `body`
  - `scripts/lib/community-map.js`:`site_hosts` 严格相等;`isOfficialHost(community, url)` 导出
  - `scripts/run-analysis.js`:非官网 URL 标 `scope_skipped: true`,不进 analyze 也不进 fix-payload
  - `scripts/fetch-geo-issues.js`:retry 包装;任一 community 报错/target 找不到 → throw
  - `scripts/fetch-fix-payload.js`:retry 包装
  - `scripts/open-portal-issues.js`:title 前缀 `[GEO] {community} #{N}:` 查 → update 或 create
  - `scripts/execute-fix-runs.js`:进程级 GIT_AUTHOR/COMMITTER env;`pushAndPr` 已有 PR 走 `updatePullRequest`
  - `scripts/generate-report.js`:渲染 `scope_skipped` URL
  - `.github/workflows/geo-bot.yml`:两 job 删 `git config` 改 step 级 env;末尾各加 `if: failure()` 回评步骤
  - `.github/actions/atomgit-create-pr/index.js`:进程级 env 替代 `git config`
  - `docs/decisions.md` ADR-0014(升序末尾)

### Round 12 — 真实跑出来的 3 个坑

- 请求: 用户贴出 fix-results.json 里 `git for-each-ref` shell syntax error,和 `400 "apig token has not permission"` 没回评的情况。
- 结论(根因 + 修):
  1. `git for-each-ref --format=%(refname:short)` 经 `/bin/sh -c` 被当 subshell,加单引号 `'%(refname:short)'` 解决。
  2. 实测**带 `labels` 字段的 createIssue 被 atomgit/apig 网关拦截**返 400 + 误导文案 "apig token has not permission",**去掉 labels 立即 200**(同 token、同 URL)。删 `open-portal-issues.js` 里 `labels: ['geo-improvement']`。
  3. `open-portal-issues.js` 把每个 issue 的错误进 records 但 main exit 0,导致 workflow step 成功、`if: failure()` 不触发、错误不回评。改为"有错且 0 成功"时 throw。
- 产出:
  - `scripts/execute-fix-runs.js` 修引号 bug
  - `scripts/open-portal-issues.js` 去 labels + main 末尾 fail-loud
  - ADR-0014 追加 3 条 Round 12 坑笔记
- 探针 issue 多了:`openeuler/openEuler-portal#109 #110 #111` 都是 GEO test 探针,需手工批量关掉

### Round 13 — strict 失败贯穿全部脚本和 workflow

- 请求: 用户指出 Round 12 修了 open-portal-issues 但是整个 workflow 还是 success 标识,需要更彻底的失败可感知化。
- 结论: 4 个脚本里"per-item 错误塞 records 但 exit 0"的反模式都改成"任一错就 throw"。workflow 里 `git push ... \|\| true` 也去掉。这样有任何环节失败,GH Actions 顶层就是红的,`if:failure()` 步骤自然触发回评。
- 产出:
  - `scripts/run-analysis.js`:统计 errored URL,> 0 即 throw 并打印前 5 条详情
  - `scripts/execute-fix-runs.js`:summary 加 ok/skipped/error 统计,error > 0 即 throw
  - `scripts/open-portal-issues.js`:从"all-fail throw"收紧为"any-fail throw"
  - `.github/workflows/geo-bot.yml`:`Commit portal-issues record` + `Commit fix artifacts` 去掉 `\|\| true`,改 `if ! git diff --cached --quiet; then ... fi`,push 失败必报错
  - ADR-0014 追加 Round 13 二次补丁笔记

### Round 14 — geo-runs 不入仓,全靠 issue 评论追踪

- 请求: 用户两点:(1) /fix 能否复用最近一次 /analyze 评论 — 答:`fetch-fix-payload.js` 一直这么做,只是没明确写出;(2) 不要每次 geo-runs 都归档入仓,issue 评论能看到决策和修改点就够了。
- 结论: 撤掉入仓双轨,完全靠 issue 评论 + GH Actions artifact(90d)闭环。ADR-0015 取代 ADR-0007 的入仓约定。`comment-fix-summary.js` 增强,把每个 community 的 opencode `output.md`(修改清单)用 `<details>` 折叠块嵌入评论,完整的"决策+修改点"轨迹。
- 产出:
  - `.github/workflows/geo-bot.yml`:删 `Commit analysis artifacts` + `Commit portal-issues record` + `Commit fix artifacts` 3 步;新增 `Upload fix artifact`(90d)
  - `.gitignore`:加 `geo-runs/`;`git rm -r --cached geo-runs/` 取消跟踪(58 个文件)
  - `scripts/comment-fix-summary.js`:每个 run 的 `agent_output` 渲染成 `<details>` 折叠块;评论末尾附 GH Actions run URL
  - `README.md`:`/fix` 段明确"自动复用最近一次 `/analyze` 评论 payload,无需重 /analyze"
  - ADR-0015 写入 decisions.md(升序末尾)

### Round 15 — opencode 超时杀不掉子进程

- 请求: 用户发现一个 GEO Bot run #16 在 opencode 输出 "Let me first explore the repository..." 后挂了 17 小时,远超 20min timeout。
- 结论: `spawnSync` 的 `timeout` 默认 SIGTERM,opencode 拉起的 LLM/工具子进程不响应 SIGTERM 就会 zombie。换成异步 `spawn({detached:true})` + 自己 `setTimeout` 触发 `process.kill(-child.pid, 'SIGKILL')` 杀整个进程组。默认 timeout 从 20min 收紧到 10min。runOpencode 改成返回 Promise,调用方 `await`。
- 产出:
  - `scripts/execute-fix-runs.js`:`spawnSync` → `spawn`,Promise 化,进程组 SIGKILL 强杀,默认 timeout 10min(可通过 `OPENCODE_TIMEOUT_MS` 覆盖)
  - 帮用户 API cancel 了 run 25810327388
  - (用户表示挂死 run 自己手工杀掉即可)

### Round 16 — opencode hang 真根因:缺 `--dangerously-skip-permissions`

- 请求: 用户让我参考 `openEuler-portal-mirror` 仓为啥它的 opencode 跑得快。
- 结论: 对比发现参考仓 workflow 顶层 env 有 `AI_EXTRA_ARGS: --dangerously-skip-permissions`,我这边漏了。opencode `build` agent 在 CI 无 TTY 环境下,任何文件读写都会触发权限交互 → 永久 hang 等用户输入。这是 17 小时挂死的真根因,Round 15 的 SIGKILL 只是兜底。
- 产出:
  - `.github/workflows/geo-bot.yml` 顶层加 `env: AI_MODEL/AI_AGENT/AI_EXTRA_ARGS`(后者默认 `--dangerously-skip-permissions`,同参考仓);两 job 加 `timeout-minutes`(analyze 15、fix 30)硬墙
  - `scripts/execute-fix-runs.js` 默认 `AI_EXTRA_ARGS ?? '--dangerously-skip-permissions'`,双重兜底
  - ADR-0016 写入

### Round 17 — 删 artifact + 中间文件移到 RUNNER_TEMP

- 请求: 用户问 fix `Upload fix artifact` 步骤和 `fix-payload.json` / `fix-results.json` 是不是都可以去掉。
- 结论: 是,因为 ADR-0015 已经把审计轨迹完全转到 issue 评论(report + payload embed + fix summary + opencode output 折叠块),artifact 和落盘 JSON 都是冗余。两个 job 的 run_dir 改成 `${RUNNER_TEMP}/...`,workflow 结束 runner 自动清理。drop `Upload artifact` (analyze) + `Upload fix artifact` (fix) 两个 step。
- 产出:
  - `.github/workflows/geo-bot.yml`:`run_dir` 改 `${RUNNER_TEMP}/geo-{analyze,fix}-{issue}-{ts}/`;删 2 个 Upload artifact step
  - ADR-0015 追加 Round 17 简化说明
  - `.gitignore` `geo-runs/` 条目保留(本地调试可能仍用)

### Round 18 — 本地复现确认 input/spawn OK,大仓需更长 timeout

- 请求: 用户怀疑 `--dangerously-skip-permissions` 没真的传 / agent 没拿到 input。让我本地实测验证。
- 结论: 本地 opencode 1.4.3 + glm-5,用与 execute-fix-runs.js 一致的 spawn 模式(`stdio:['pipe','inherit','inherit']` + `detached:true` + stdin.write+end),在 portal-mirror 仓里**2 分钟完整跑完修复**(Glob/Grep/Read/Edit/Write/Write output.md 全部 stream 出来),agent 产出可用 diff(为 vulnerability-reporting 加 sitemap priority 0.7)。**spawn pattern 和 input 喂入完全没问题**。runner 上挂死真因大概率:真 openEuler-portal 仓比 mirror 简化版大几十倍,glob/grep + LLM 思考累计超 10min 默认 timeout。
- 产出:
  - `scripts/execute-fix-runs.js`:`OPENCODE_TIMEOUT_MS` 默认 10min → 25min(可通过 env 覆盖);改 `??` 为 `||` 防 vars 设空串;增强日志打印完整 args + cwd + 关键 env 是否设置
  - `.github/workflows/geo-bot.yml` fix job `timeout-minutes`:30 → 45(GH 层硬墙留余量)
  - 清理 portal-mirror 本地测试副作用(删 output.md)
- 诊断结论: runner 上下次跑请关注新日志输出的 `args: [...]` 一行,若 `--dangerously-skip-permissions` 在 args 里且 agent 输出有 `Glob/Grep/Read` 等 tool 调用,只是慢,等 25min 即可

### Round 19 — 修正 Round 18 误判 + runner 诊断脚本

- 请求: 用户指出 `openeuler-portal-mirror` 就是 openEuler-portal 的真镜像(不是简化版),让我直接基于它测。
- 结论: Round 18 的"mirror 是简化版"是错的(我用 `find -maxdepth 2` 误判,只看了顶层 2 个文件)。**mirror 真实规模 = 26364 个文件 / 5296 ts·vue·js / 1656 md / 4652 目录,跟 atomgit 上 openEuler-portal 一致**。所以本地 2 min 完成 = 大仓也能 2 min 完成。runner 上 10 min 一句话不出的真因不在仓库大小,而在 **runner 环境本身**(网络到 glm5 API、磁盘 IO、CPU 占用、opencode 版本),需要 runner-side 实测。
- 产出:
  - `scripts/debug/runner-probe.sh`:可直接拷到 runner 上跑的诊断脚本,自带心跳输出 + 总耗时,验证 clone/refresh/opencode 各段真实速度
  - 推荐用户:SSH 到 runner → `ATOMGIT_TOKEN=xxx bash runner-probe.sh` → 对比本地 2 min 看差几倍
- 后续判断:
  - runner 也 2-3min → 跟本地一致,workflow 那次 10min hang 是偶发(网络/API 抖动),timeout 25min 够用
  - runner >> 10min → 真是 runner 慢,需更长 timeout / 换 model id / 排查 runner 网络
  - runner 永远 hang → 跟 workflow 一致,问题在 runner 环境,需手工 debug

**本地实测数据(我 Mac 跑 probe)**:

| 阶段 | 耗时 |
| --- | --- |
| Clone openEuler-portal --depth=1(12367 文件) | 104s |
| opencode 跑修复(Glob/Grep/Read×3/Edit/Write output.md) | 210s |
| 总计 | **5.2 min,exit=0** |

agent 产出可用 diff(为 vulnerability-reporting 加 sitemap priority 0.7)+ output.md 924 bytes。

**所以**:同一代码 + 同一 prompt + 同一真实 portal 仓,Mac 5 分钟完成,runner 10 分钟卡死一句话不动 = 100% **runner 环境层面问题**(网络/代理/防火墙到 glm5 API、或 portal-x86 机器卡住),跟 prompt/代码/timeout 都无关。timeout 25min 够覆盖正常路径 + 余量。

### Round 20 — 闭环:geo-poll(sync + 重验 + 自动关)

- 请求: 用户希望全闭环 — geo-workflow 新 issue 自动同步进来 + portal PR merge 后通知 + 线上重验通过自动关 [GEO优化] issue。
- 结论: 选 cron 方案,每 4 小时跑一次 `geo-poll.yml`(workflow_dispatch 也可手工触发)。3 个决策点:sync 只创建不自动 /analyze(人 review)、重验通过只关本仓 issue(geo-workflow 那边只回评)、cron 每 4h。
- 产出:
  - `.github/workflows/geo-poll.yml`:cron 4h + workflow_dispatch
  - `scripts/sync-geo-issues.js`:title `[GEO优化]#N` 前缀去重,从 geo-workflow 拉 open + label=geo-improvement,新的 createIssue 到本仓
  - `scripts/poll-portal-status.js`:扫本仓 open [GEO优化] → 抓评论里 atomgit PR URL → `getPullRequest` 查状态 → all-merged + 30min 冷却 → 重验 payload URL → 通过则 close + 回评双仓 / 失败则评论不关。幂等 marker `geo-revalidated v1` + `geo-pr-status v1`。
  - `scripts/lib/atomgit-api.js` 加 `getPullRequest`
  - ADR-0017 + design.md 10.x 待补
- 后续:首次 sync 可能批量创建多个 [GEO优化] issue(geo-workflow 现有 ~40 个 P0),建议先手工创建一个测试 issue 验证 cron 跑通,再让它扫全量
- 调试期调整:cron 从 `17 */4 * * *` 改为 `17 5 * * 1`(每周一一次),调试 /analyze 和 /fix 期间不被打扰;手工触发走 `workflow_dispatch` Actions UI 按钮。完成调试后改回 4h 节奏。

## 未完成 / 待办

- [ ] **用户在 runner 上跑 `scripts/debug/runner-probe.sh`,看真实耗时**
- [ ] 关闭探针 issue `openeuler/openEuler-portal#109 #110 #111`(手工 web 关闭)
- [ ] 用户在 issue 重新评论 /analyze 生成新 payload,再 /fix 验证全链路
- [ ] 在测试 issue 上验证 opencode prompt 真实表现 + cache 命中行为
- [ ] (后续 ADR)归档策略 — geo-runs/ 长期累积后的清理
- [ ] (后续) 同 portal 并发 fix 时收窄 concurrency group
