# 决策日志 (ADR)

> 记录关键技术/产品决策。每条独立编号,不可删除,只能用新条目"取代"旧条目。新决策**追加到文件末尾**,保持编号升序。

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

<!-- 新决策追加到文件末尾,保持升序 -->

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

## ADR-0009: 合并 geo-{analyze,fix}.yml 为单文件 geo-bot.yml 多 job

- 日期: 2026-05-13
- 状态: 已采纳(取代 ADR-0001 中"两个 workflow 文件"的隐含约定)
- 上下文: 两个独立 workflow 都订阅 `issue_comment.created`,每条评论都会触发两个 workflow run,job 级 `if:` 把不匹配的那个 skip 掉。Actions 页面每次评论出现 2 个 run(1 个实际跑、1 个 1s 内 skip),UI 噪声大。
- 选项:
  - A. 维持两个独立 workflow 文件
  - B. 合并为单个 `geo-bot.yml`,内含 `analyze` + `fix` 两个 job,各自 `if:`
  - C. 拆出 dispatcher workflow 用 `workflow_call`
- 决定: B
- 理由: 每条评论只产生 1 个 workflow run;两 job 共用 `on:` / `permissions:`;`concurrency` 仍可在 job 级独立配置,行为与原版一致;C 引入额外复杂度无收益。
- 后果:
  - `.github/workflows/geo-{analyze,fix}.yml` 删除
  - 新增 `.github/workflows/geo-bot.yml`(~190 行)
  - README + design.md 引用更新为 `geo-bot.yml#analyze` / `#fix`
  - 历史 Actions run 名称会变(`GEO Analyze` / `GEO Fix` → `GEO Bot`)

## ADR-0010: geo-workflow 是 private 仓,需独立 PAT secret

- 日期: 2026-05-13
- 状态: 已采纳(修正 ADR-0002)
- 上下文: 首次远端 /analyze 跑出 0 candidates。日志显示对 `api.github.com/repos/opensourceways/geo-workflow/contents/...` 返回 **404**。本地用 .env 里的 PAT 同样请求返回 200。差异来自 token:workflow 用的 `secrets.GITHUB_TOKEN` 是 ephemeral install token,scope 严格限定在当前 repo(geo-develop),对其他 repo(geo-workflow)无权;而 geo-workflow 是 **private**(visibility=private),匿名也访问不了。
- 选项:
  - A. 把 geo-workflow 改为 public — 涉及组织策略,不一定可行
  - B. 在 geo-develop 加 secret `GEO_GITHUB_TOKEN`(PAT,有 geo-workflow read 权限),fetch-geo-issues 步骤用它
  - C. 用 GitHub App 安装到双 repo(更长期但更复杂)
- 决定: B
- 理由: 最小改动,只需用户在 secret 里加一项;PAT 可定期轮换;不依赖组织策略。
- 后果:
  - workflow "Fetch geo-workflow candidates" 步骤 env 改为 `GEO_GITHUB_TOKEN`,缺则报错退出
  - README + design.md 更新 secret 表(标注必填)
  - 用户需在 repo secrets 加 `GEO_GITHUB_TOKEN`(可直接复用 .env 里的 GITHUB_TOKEN PAT)

## ADR-0011: portal 仓持久化缓存,不每次 fresh clone

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: `/fix` 每次都对 portal 仓(openEuler-portal / mindspore-portal)做 `git clone --depth=1`,虽然浅克隆已最小化,但首次抓取仍要建立连接 + 下载 tarball + 写盘,在大仓上耗时显著。self-hosted runner 文件系统持久,clone 副本可以复用。
- 选项:
  - A. 每次 fresh clone(现状)
  - B. 持久缓存 + `fetch+reset+clean` 复用
  - C. bare 仓 + git worktree per fix run
- 决定: B
- 理由: 最直观,改动局限在 `clonePortal` 一个函数;`fetch --depth=1 origin <base>` + `reset --hard` 几秒内完成;失败自动 fallback 到 fresh clone。C 性能更优但要管理 bare repo + worktree lifecycle,引入额外失败面。
- 后果:
  - 缓存位置默认 `~/.cache/geo-bot/portals/{owner}-{repo}/`,可通过 `GEO_PORTAL_CACHE_DIR` 覆盖
  - 每次 fix 复用 cache 时:`remote set-url`(刷新 token)→ `fetch --depth=1 origin <base>` → `checkout -B <base> origin/<base>` → `reset --hard` → `clean -fdx` → 删除非 base 分支
  - 任一步失败 → 删 cache → fresh clone(自愈)
  - 同 portal 并发 fix 会冲突 — 当前用 issue 级 concurrency,未来若多 issue 并发同 portal 需收窄 concurrency group

## ADR-0012: /fix 信号源切换为 issue 评论内嵌 payload,不依赖文件系统

- 日期: 2026-05-13
- 状态: 已采纳(修正 ADR-0007 — 制品入仓仍做但仅为审计,不再是 /fix 输入)
- 上下文: 之前 `/fix` 通过 `ls geo-runs/{issue}/*/analysis.json | sort -r | head -1` 找最新分析。实际跑出来发现:用户对 main 分支做过 force push,中间 commit 的 `geo-runs/.../analysis.json` 被回滚,/fix checkout 后只看到老的空 analysis,planner 产出 0 个 run,execute 直接 `0 run(s) executed`。文件系统状态不可靠。
- 选项:
  - A. 加强 push 流程的可靠性(锁、原子提交)— 仍然脆弱
  - B. 把 fix 输入信号搬到 issue 评论(GitHub 持久化、force push 影响不到)
  - C. 改用 artifact / 外部 storage
- 决定: B
- 理由: issue 评论是 GitHub 第一公民,只要 issue 不删评论就在;评论与 /analyze 触发是 1:1 关系,语义自然;不需引入额外 storage。C 受 90 天保留期限制。
- 后果:
  - `generate-report.js` 在 `report.md` 末尾内嵌 `geo-analysis-payload v1` 精简 JSON(裹在 `<details>` 折叠块,只含 /fix 需要的字段:per-issue/question/url/problems,体积小)
  - 新增 `scripts/fetch-fix-payload.js`:扫 issue 评论,从最新带 marker 的评论里抓 JSON 块
  - 删除 `scripts/plan-fix-runs.js`:planning 逻辑内联到 `execute-fix-runs.js`(`planRunsFromPayload`)
  - `execute-fix-runs.js` 参数从 `--plan` 改为 `--payload`
  - `geo-bot.yml` fix job 把"Locate latest analysis" + "Plan fix runs" 两步合并为 "Fetch fix payload from issue comments"
  - geo-runs/ 入仓继续保留(ADR-0007 不变,但只作审计副本)

## ADR-0013: AtomGit/GitCode API 路径 `/api/v5/` 前缀 + Issue 接口 owner-scoped

- 日期: 2026-05-13
- 状态: 已采纳(细化 ADR-0006 的 atomgit 调用约定)
- 上下文: 首次远端 /analyze 在 "Open portal issues" 步骤报 `createIssue failed: 404 "<html>...openresty"`(nginx 404 兜底页)。本地用 `Bearer <token>` curl 实测确认:
  - 所有 atomgit/gitcode API endpoint 必须带 `/api/v5/` 前缀(我之前的 `https://api.atomgit.com/repos/...` 直接 404)
  - **Issue 接口是 owner-scoped**:`POST /api/v5/repos/{owner}/issues`(不是 GitHub 风格 `/repos/{owner}/{repo}/issues`),`repo` 字段放 body 里
  - PR / comments / refs 接口跟 GitHub 风格一致(repo 在路径)
  - Auth header 必须 `Bearer`(不接受 GitHub 风格的 `token <pat>`)
  - 响应里 `number` 字段是字符串而非数字
- 选项:
  - A. 在仍出错时手工降级到 web 界面
  - B. 修代码 + 落 ADR 锁定 API 约定
- 决定: B
- 理由: 这是正确性问题,不是性能/UX。
- 后果:
  - `scripts/lib/atomgit-api.js`:加 `API_PREFIX = '/api/v5'` 常量,createIssue 改 owner-scoped 路径 + body 加 `repo`,labels 改逗号字符串
  - `.github/actions/atomgit-create-issue/index.js` 同上
  - `.github/actions/atomgit-create-pr/index.js`:所有路径加 `${API_PREFIX}`
  - 探针 issue `openeuler/openEuler-portal#109` 已创建用于验证,需手工关闭

## ADR-0014: 5 项可靠性优化(retry/失败可见/官网过滤/去重/git env)

- 日期: 2026-05-13
- 状态: 已采纳
- 上下文: 用户读完流程后指出 5 个问题:(1) 缺重试 + 进度可见;(2) 拉不到数据时不报错只返 0 个结果;(3) 把 forum/discuss 站点也当官网分析;(4) 重复触发会重复建 issue/PR;(5) 在 portal 仓 `git config user.name` 是冗余。
- 选项:
  - A. 逐项分散修(本 ADR 做的)
  - B. 等出现真实失败再补
- 决定: A(预防性,远端 runner 调试代价高)
- 理由: 这 5 条都是首次跑通后必然遇到的脆弱点,集中一次处理而不是 5 次 debug 来回。
- 后果(每项对应改动):
  1. **Retry + 可见进度**:`scripts/lib/atomgit-api.js` 全部 endpoint 包 `retry()`(网络 / 5xx / 429,指数退避 3 次);`fetch-geo-issues.js` / `fetch-fix-payload.js` 同款 retry;每次重试打印 `⚠ 重试(N/M, status, ...)`
  2. **失败显式**:`fetch-geo-issues.js` 任一 community 报错 / target issue 找不到 → 直接 throw,workflow step fail;`geo-bot.yml` 两 job 末加 `if: failure()` 步骤回评 ``❌ /analyze 失败,详见 {run url}`` 到触发 issue
  3. **只看官网域**:`community-map.js` `site_hosts` 改严格相等(不含子域通配);新增 `isOfficialHost()`;`run-analysis.js` 非官网 URL 标 `scope_skipped`,不进 problems 也不进 fix-payload;report 渲染 `⏭ 跳过(非官网域)`
  4. **去重**:atomgit-api 新增 `findIssueByTitlePrefix` + `updateIssue` + `updatePullRequest`;`open-portal-issues.js` 先按 `[GEO] {community} #{N}:` 前缀查,有则 PATCH 更新,无则 POST 创建;`execute-fix-runs.js` `pushAndPr` 已存在 PR 走 update 路径
  5. **干掉 `git config`**:`execute-fix-runs.js` 入口设 `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL` env;`.github/workflows/geo-bot.yml` commit 步骤改 step 级 env;`.github/actions/atomgit-create-pr/index.js` 同改;不再触碰 repo 级 git config
- 验证: curl 实测 atomgit 全部 endpoint(create/list/update issue、list/create/update PR、add comment、get ref),发现 PATCH issue 字段是 `body`(GitHub 风格)而非 `description`,即时修正 lib 代码。
- 后续坑(Round 12 修):
  - `git for-each-ref --format=%(refname:short)`:sh 把 `(` 当 subshell → 必须加单引号 `'%(refname:short)'`。
  - **labels 字段是雷区**:atomgit/apig 网关对 createIssue 带 `labels` 字段的请求返回 `400 "CH.00000403 apig token has not permission to request url"`(误报为 token 权限问题,实测**只要不传 labels 就 200**)。`open-portal-issues.js` 已删 `labels: ['geo-improvement']`。
  - `open-portal-issues.js` 之前所有 portal 都失败时仍 exit 0(workflow 步骤显示成功,`if: failure()` 不触发,错误评论吞掉)→ 已改为有错且 0 成功时 throw。
- 二次补丁(Round 13)— 把"strict 失败"贯彻到全部脚本:
  - `run-analysis.js`:任一 URL 抓取/分析失败(非 scope_skipped)→ throw
  - `execute-fix-runs.js`:任一 run status=error → throw
  - `open-portal-issues.js`:从"全失败才 throw"收紧为"有任一错就 throw"
  - workflow `Commit portal-issues record` / `Commit fix artifacts`:去掉 `git push ... \|\| true`,push 失败必须可见

## ADR-0015: geo-runs 不再入仓,完全靠 issue 评论追踪决策

- 日期: 2026-05-13
- 状态: 已采纳(取代 ADR-0007 的"入仓做审计"约定;与 ADR-0012 形成完整闭环)
- 上下文: 用户提出两点简化:(a) /fix 应该能复用最近一次 /analyze 的评论 payload,不必每次重 /analyze(实际 `fetch-fix-payload.js` 已经这么做了,只是没写明);(b) 不要把每次 geo-runs 都 commit 入仓,issue 评论里能看到完整轨迹就够。
- 选项:
  - A. 维持 ADR-0007 入仓 + ADR-0012 评论双轨
  - B. 撤掉入仓,只靠评论 + GitHub Actions artifact(90d)
- 决定: B
- 理由: 评论是 GitHub 第一公民,搜索/筛选/全文检索都现成;入仓加重 main 分支变更历史(force push 还会丢),没多收益;artifact 短期保留够调试。
- 后果:
  - 删 workflow 3 个 Commit 步骤(analyze artifacts / portal-issues record / fix artifacts)
  - `.gitignore` 加 `geo-runs/`,`git rm -r --cached geo-runs/` 清掉历史快照(本地文件保留,但下次 push 会从 main 移除)
  - /analyze comment 仍内嵌 `geo-analysis-payload v1`(ADR-0012),作 /fix 唯一信号源
  - **comment-fix-summary 增强**:把每个 run 的 opencode 修改清单(`output.md` 抓取的前 3500 字符)用 `<details>` 折叠块嵌入评论,作为决策轨迹
  - 新增 /fix `Upload fix artifact` step(已加),90d 内可下载 fix-payload/results/context 等
  - README + design.md 10.3-10.4 重写
- 进一步简化(Round 17):中间文件连 artifact 也不再上传,统统丢 `${RUNNER_TEMP}/`,workflow 结束自动清理。所有"决策 + 修改点"在 issue 评论里:
  - /analyze:report 评论(含 embed payload)+ portal issue + portal-issues 暴露在评论文本里
  - /fix:fix summary 评论(含 PR 链接 + opencode `output.md` 折叠块)
  - 失败时:`if: failure()` 步骤回评 + GH Actions run url
  - 调试只需看 issue + run log,不需要下载 artifact 解压看 JSON

## ADR-0016: opencode 必须带 `--dangerously-skip-permissions`,否则 CI hang

- 日期: 2026-05-14
- 状态: 已采纳(取代 ADR-0011 的"timeout 兜底就够"假设)
- 上下文: GEO Bot run #16 在 opencode 输出 "Let me first explore..." 后 hang 17 小时。对比参考仓 `openEuler-portal-mirror/.github/workflows/self-edit-workflow.yml`,关键差异是它有 `AI_EXTRA_ARGS: --dangerously-skip-permissions`(workflow 顶层 env,L18)。opencode 的 `build` agent 在做读写/exec 时会触发权限交互确认,CI 环境无 TTY → opencode 永久等待用户输入 → workflow 标 in_progress 但实际死锁。我之前的 `OPENCODE_TIMEOUT_MS` + 进程组 SIGKILL 是兜底手段,治标不治本。
- 选项:
  - A. 维持仅靠 timeout 兜底(每次 hang 都被强杀,但 LLM token 已浪费几分钟)
  - B. 让 opencode 跳过权限交互(`--dangerously-skip-permissions` 一次性放行)
  - C. 给 opencode 注入一个 fake TTY 让它自答 yes(复杂、易出错)
- 决定: B
- 理由: 参考仓已经验证 B 在同套 opencode/glm5 环境下能跑通。LLM 在 CI 里本来就该是"全自动",权限交互是开发态特性,生产场景跳过合理。
- 后果:
  - `.github/workflows/geo-bot.yml` 顶层 `env:` 加 `AI_EXTRA_ARGS: ${{ vars.AI_EXTRA_ARGS || '--dangerously-skip-permissions' }}`(同参考仓约定);同时加 `AI_MODEL` + `AI_AGENT` 默认,从 vars 可覆盖
  - `scripts/execute-fix-runs.js` 默认值从 `''` 改为 `--dangerously-skip-permissions`(双重兜底,避免 workflow 配漏时仍然 hang)
  - workflow `analyze` job 加 `timeout-minutes: 15`,`fix` job 加 `timeout-minutes: 30`,GH 层硬墙

## ADR-0017: 闭环 — geo-poll 定时 sync + 重验 + 自动关 issue

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: 之前流程是"用户开 [GEO优化] issue → /analyze → /fix → portal PR"半自动,链路终点是 PR 等人 merge,没有"线上验证 + 闭环关 issue"的反向通路。geo-workflow 新出 P0 issue 也需要人手工搬到本仓。
- 选项:
  - A. 维持半自动,人 review 中间所有节点
  - B. 加 cron 闭环:sync 新 issue + 查 PR 状态 + 重验 + 关 issue
  - C. 用 webhook 实时驱动(更快但需公网 endpoint / repository_dispatch 配置)
- 决定: B,cron 每 4 小时(调试期暂改 weekly)
- 理由: 起步阶段 cron 够用、零外部依赖,符合 self-hosted runner 现状;响应延迟 ≤ 4h 对 GEO 这种"等部署+索引"周期来说不敏感。C 后期上量再考虑。
- 后果:
  - 新增 `.github/workflows/geo-poll.yml`(cron `17 */4 * * *`,调试期暂改 `17 5 * * 1`)
  - 新增 `scripts/sync-geo-issues.js`:按 title `[GEO优化]#N` 去重,从 geo-workflow 同步新 P0 → 本仓(**不**自动 /analyze,人 review 后手动评论)
  - 新增 `scripts/poll-portal-status.js`:扫本仓 open 的 [GEO优化] issue,抓评论里的 portal PR URL,查 atomgit `getPullRequest`;PR closed-not-merged 仅评论提醒;PR all-merged 且过 30min 冷却 → 重验该 issue 在 payload 评论里的所有 URL → 全清零则 close 本仓 issue + 评论本仓 + 回评 geo-workflow 原 issue;仍有问题则只评论不关
  - `scripts/lib/atomgit-api.js` 加 `getPullRequest`
  - 评论里加幂等 marker:`<!-- geo-revalidated v1 ... decision=pass/keep -->` + `<!-- geo-pr-status v1 ... -->`,防止 cron 重复刷评论
  - geo-workflow 那边的 issue **不自动关**(权责分离 — 评估侧维护人决定)

## ADR-0018: workflow 改名 `geo-develop-workflow` + portal PR URL fallback 用 `/merge_requests/N`

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: 之前 workflow 文件叫 `geo-bot.yml`,与仓名 `geo-develop-workflow` 不一致,看 Actions 页眼区分困难。另外 portal 仓 PR 的 UI URL 实测有 4 个等价别名都返回 200:`atomgit.com/.../merge_requests/N`(API `html_url` 返回的规范形式)、`/pull/N`、`/pulls/N`、`gitcode.com/.../pull/N`。fallback URL 写哪个都不会 404,但选 API `html_url` 返回的规范形式最不易翻车。
- 选项:
  - A. 不改名,文件名与仓名分离
  - B. 改名 `geo-bot.yml` → `geo-develop-workflow.yml`,同步刷 README/concurrency group
- 决定: B + fallback URL 用 `atomgit.com/.../merge_requests/N`(与 API `html_url` 一致)
- 理由: 仓-workflow 同名认知一致;fallback 跟 API 返回值对齐,日后 atomgit 哪天关掉别名也不会断。
- 后果:
  - `git mv .github/workflows/geo-bot.yml → geo-develop-workflow.yml`;workflow `name:` + concurrency group 同步改
  - fallback URL 改 `merge_requests/N`:`execute-fix-runs.js`、`.github/actions/atomgit-create-pr/index.js`
  - `poll-portal-status.js` PR URL 正则放宽:同时匹配 `/pull/N`、`/pulls/N`、`/merge_requests/N`,也接受 atomgit/gitcode 双域名,保历史评论不丢
  - clone URL / API base 保持 `atomgit.com` / `api.atomgit.com`,不动;API path 仍是复数 `/pulls/N`
  - 历史 decisions.md / sessions 提到 `geo-bot.yml` 的不回填,保历史准

## ADR-0019: 上游数据空(找不到关联问题 / 无 official_urls)走"跳过"而非"失败"

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: `/analyze` 触发后,如果 geo-workflow 那边的 issue 状况是:① 指定 `#N` 不存在或非 P0;② 关联的 `question_ids` 都没有 `official_urls`;③ 全是 forum/discuss 这种非官网域被过滤 — 之前 `fetch-geo-issues.js` 会 throw,workflow 走 `if:failure` 回评"❌ /analyze 失败"。但这并不是本仓的代码 / 流水线坏了,而是上游 geo-workflow 评估侧的数据状况。把这种状况当失败回评会:① 噪音多,误导维护人去看 workflow 日志找 bug;② 阻塞 issue 关闭流程(geo-poll 看到 open issue 一直在等)。
- 选项:
  - A. 维持现状,任何空结果都 throw
  - B. 区分"工具故障"(网络 / 权限 / 解析炸了 → 仍 throw)与"上游数据空"(0 候选 → 写 `note` 字段、空 candidates,正常出报告)
  - C. 完全不报告,跳过即静默
- 决定: B
- 理由: 失败要可执行(actionable);上游数据空对本仓维护人来说是只读信息,但需要在 trigger issue 上留痕(否则 /fix 不知道为啥跳),所以不能静默。
- 后果:
  - `fetch-geo-issues.js`:`target !== 'all' && allIssues.length === 0` 不再 throw;改为在 candidates.json 顶层加 `note` 字段并 log 一条 `ℹ` 行
  - `run-analysis.js`:把 candidates 的 `note` 字段透传成 analysis.json 的 `upstream_note`
  - `generate-report.js`:`analysis.issues.length === 0` 时渲染"⏭ 跳过(无可分析输入)"段,展示 `upstream_note`,明确"不是分析失败,无需 /fix"
  - `open-portal-issues.js`:空 issues 时直接 return,写 `skipped: true` 制品,不进 portal API
  - 网络 / 权限 / JSON 解析炸的硬错仍 throw → workflow 失败 + ❌ 回评 — 这块行为不变

## ADR-0020: AtomGit PR 去重 — `head` 只传裸 branch + 兜底捕获"already exists !N"恢复

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: `/fix` 跑出来 `createPullRequest` 在已有同源分支 open PR 的情况下应当走 update,但实测一直在 create,然后 atomgit 400 报错 `error_code: 409` + `Another open merge request already exists for this source branch: !3085`。原因有两层:① `listPullRequests` 之前按 GitHub 习惯传 `head=owner:branch`(`openeuler:geo/fix-openeuler-21`),实测 atomgit 不认这种格式,返回 0,代码以为不存在;② 即使 lookup 漏掉(竞态 / 缓存 / 分页),也应当能从 createPullRequest 的错误里恢复。
- 选项:
  - A. 维持现状,人手清理悬挂分支
  - B. 修 lookup:传裸 branch 名;额外做客户端按 `head.ref` 全量过滤兜底
  - C. B 之外再加错误捕获:`createPullRequest` 遇到 "already exists !NNNN" 解析编号 → 自动 fallback 到 update
- 决定: B + C
- 理由: B 解 90% 场景的查重失效;C 保险:即使 atomgit 哪天 API 行为又变,只要错误信息里带 PR 号就能恢复,不需要人手介入。
- 后果:
  - `scripts/lib/atomgit-api.js` `listPullRequests`:`head` 参数若含 `:`(GitHub `owner:branch` 格式)自动剥 owner;再做一次客户端 `pr.head.ref === branch` 过滤,服务端漏过滤也兜得住
  - `scripts/lib/atomgit-api.js` 导出新错误类型 `PullRequestAlreadyExistsError(existingNumber, raw)`,带 `nonRetryable = true` 防止 retry() 重试
  - retry() 检查 `err.nonRetryable`,业务错(冲突 / 4xx 已知)直接抛、不重试
  - `createPullRequest` 4xx 响应里 regex 抽 `already exists[^!]*!(\d+)` 抛新错;其他 4xx 维持原 `rejectOn4xx`
  - `scripts/execute-fix-runs.js` `pushAndPr`:
    - `listPullRequests` 传 `head: run.branch_name`(不再 `owner:branch`)
    - 抽出 `updateExisting(number)` 内部函数;create 抛 `PullRequestAlreadyExistsError` 时直接走 update
  - smoke-test:`head=geo/fix-openeuler-21` 命中 #3085;主动 createPR 同源分支被捕获为 `PullRequestAlreadyExistsError(existingNumber=3085, nonRetryable=true)` — 都跑通

## ADR-0021: 评论与 PR 卫生 5 项(host 归一 / 路径不外泄 / 清单默认展开 / output 不入 PR / PR URL 不为 undefined)

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: /fix 走一轮后,issue 评论里的几个细节体验差:① openEuler 双域名 `openeuler.org` 与 `openeuler.openatom.cn` 是同代码 + 不同构建环境变量,sitemap 只产一份,导致 `openatom.cn` 的 URL 在 sitemap 比对时永远未收录,误报 critical;② workflow ack 评论里贴了 runner 临时路径 `/home/.../_temp/geo-fix-...`,既无意义又像调试残留;③ "opencode 修改清单"用 `<details>` 折叠 + ```text``` 包裹,用户得手动展开还看到原生 md 符号;④ agent 把 output.md 写到 portal 仓 work_dir,被 `git add -A` 提进 PR;⑤ updateExisting 走 PATCH 时 atomgit 偶尔返回空 body 或字段不全,导致评论表格里 PR 链接显示 undefined。
- 选项:
  - A. 维持现状,人工挑刺
  - B. 一次性把这 5 点都修了
- 决定: B
- 后果:
  - `scripts/lib/community-map.js`:导出 `canonicalizeUrlHost(community, url)` — 把 site_hosts 里的等价 host 全部映射到 `site_hosts[0]`(openEuler 的 canonical = `www.openeuler.org`)
  - `scripts/checks/sitemap-inclusion.js`:`normalize()` 接受 community 参数,先归一 host 再比 path;`checkSitemapInclusion(url, sitemapUrl, community)` 透传 community
  - `scripts/analyze-discoverability.js`:把 communityName 透传给 sitemap check
  - `.github/workflows/geo-develop-workflow.yml`:`analyze` / `fix` 两个 Ack on issue 步骤的评论里去掉 `${run_dir}` / payload 路径
  - `scripts/comment-fix-summary.js`:`<details>` → `<details open>`(默认展开);删 ```text``` 围栏,agent 输出按 markdown 渲染
  - `scripts/execute-fix-runs.js`:`output.md` 落 ctxDir(runner 临时区)而不是 workDir;`buildSlimContext(run, workDir, outputFile)` 新参数;`pushAndPr` 入口加防御扫一次 workDir 根的 `output*.md` 删掉(agent 没遵守 output_file 也不入 PR)
  - `scripts/execute-fix-runs.js` `updateExisting`:即使 PATCH 返回空 body,也用 `{ ...(updated || {}), number: updated?.number || number }` 保证 `pr.number` 非空,fallback URL `merge_requests/${pr.number}` 不会 undefined
  - `scripts/execute-fix-runs.js` fallback 路径(`PullRequestAlreadyExistsError`):多调一次 `getPullRequest` 补 `html_url`,评论表格里直接是规范链接
  - smoke-test:`https://www.openeuler.openatom.cn/zh/security/vulnerability-reporting` + `openeuler.org/sitemap.xml` → included=true,problems=0(之前 critical/未收录)

## ADR-0022: 对外可见物(portal PR / portal issue)正文重排 + 关联 portal issue + 隐藏内部协调

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: portal 仓的 PR 描述、portal 仓上的关联 issue 都是对外可见的工件,直接面对 portal 维护人 / 用户。之前两个问题:① PR 没引用 portal issue(maintainer 不知道这个 PR 修的是哪个跟踪 issue,merge 后也不会自动关 issue);② PR + issue 的版式都偏粗暴 — 多级 `## / ###` 大标题 + `[critical]` 平文标签 + 列表里塞所有 URL(包括没问题的 ✅);③ 把"geo-develop trigger #N"、`runDir` 这些内部协调字段也露给外部,既无意义又像泄露调试信息。
- 选项:
  - A. 维持现状
  - B. PR / issue body 都重排:小字关联行 + 单张问题表 + `<sub>` 脚注;过滤掉无问题的 URL 和 scope-skipped 行;PR 加 `Closes #N` 让 atomgit 合并自动关 portal issue;移除 trigger / runDir 字段。
- 决定: B
- 理由: portal 维护人只关心"为什么这个 PR 存在、要 review 啥",geo-develop 的协调 issue 对他们是噪音。
- 后果:
  - 工作流顺序调整:`open-portal-issues` 改为先于 `generate-report` 跑,把 portal-issues.json 喂给 `generate-report` 的新参数 `--portal-issues`,让 payload 内嵌 `portal_issue_url` / `portal_issue_number`
  - `scripts/generate-report.js` `buildFixPayload(analysis, triggerIssue, portalIssuesIndex)` — 按 `community#geo_issue_number` 查表注入 portal 字段;main 接受 `--portal-issues=...`
  - `scripts/execute-fix-runs.js` `planRunsFromPayload`:把 issue.portal_issue_url / portal_issue_number 透传到 run;新 `buildPrBody(run)` 输出小字关联行 + 问题表 + `<sub>` 脚注;末尾追加 `Closes #N`
  - `scripts/open-portal-issues.js` `buildBody(issue)`:不再接 `triggerRepo/triggerIssue/runDir`;只取 critical/important 行,scope-skipped + minor 全部过滤;match PR 风格(关联行 + 表 + 脚注);本 issue 无 critical/important 直接跳过,不在 portal 建空 issue
  - PR / issue 不再外露 geo-develop trigger / runDir / `[GEO]` 内部状态字段
  - smoke-test:`portal_issue_url=https://atomgit.com/openeuler/openEuler-portal/issues/2842` 已能流到 payload JSON;PR body 渲染样例:`**关联**: [geo-workflow #21] · [portal issue #2842]\n\n<table>\n\n<sub>...</sub>\n\nCloses #2842`

## ADR-0023: /fix 质量护栏 — pre-push 自检 + critic 反向审查

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: /fix 走 opencode + glm-5,prompt 是软约束 — agent 可能错改、漏改、过度修改、偏离白名单。当前唯一兜底是 geo-poll 重验 + 人 review portal PR。两者都有问题:① geo-poll 反馈周/月级,等不起;② review portal PR 没有"对照"可看,reviewer 没法快速判 PR 是不是真把问题修了。需要在 push 之前 + 在 PR body 上给两层质量护栏。
- 选项:
  - A. 维持现状(只靠 prompt + geo-poll 闭环)
  - B. 加 pre-push 静态自检(可静态校验的维度立刻判 fixed/still_failing,blocking 不让 push)
  - C. 加 critic agent(第二次 opencode,只读审查 diff + analysis,产出 pass/warn/block 判定)
  - D. 上人工 review 闸门(`/confirm` `/apply`)
- 决定: B + C(D 暂不上,如果误报 / 改错频发再考虑)
- 理由: B 给"确凿的可验证"维度立即兜底(sitemap inclusion / tdk 长度),C 给"启发式 / LLM 偏差"维度增加一道"第三方眼睛";D 会显著降低自动化体感,留作后手。
- 后果:
  - 新增 `scripts/checks/post-fix-verify.js`:
    - `parseAgentOutput(md)`:从 agent 自报清单(`✅ <url> <dim> — 改 <file>`)抽出 (url, dim, file, icon)
    - 在 workDir 全树搜 `sitemap*.xml` 拉所有 `<loc>`,host 归一(走 `canonicalizeUrlHost`)再比对 target
    - `tdk.{title,description,keywords}` 维度:打开 agent 自报的文件,读 frontmatter / `<meta>`,套阈值
    - `schema` / `static_render`:标 `deferred`(需 build),由 geo-poll 重验闭环兜底
    - 任一 status=still_failing → `blocking=true`
  - `scripts/execute-fix-runs.js` 主循环:在 `runOpencode` 后、`pushAndPr` 前调用 verifier;`verify.blocking=true` 直接 `status=verify_failed`,不 push,本 run 算失败
  - 新增 `.github/agents/geo-critic-prompt.md`:critic 角色 prompt,只读审查,产出 `Critic 结论: pass/warn/block`
  - `runOpencode` 抽出 `options.{label,taskLine,timeoutMs}` 复用给 critic(critic 5min 超时)
  - 新 `runCritic`:把 analysis + agent_output + verify + `git diff HEAD`(20k 截断)写成 JSON 上下文,跑第二次 opencode;critic block → 阻断 push,critic 输出贴到 trigger issue + PR body
  - PR body 加 **Pre-push 自检 (Before → After)** 表 + **Critic (反向审查)** 块
  - trigger issue 修复结果表加 `Verify` 列(fixed/still_failing/deferred 计数) + `Critic` 列(verdict badge)
  - workflow `Execute fix runs` step 新增 env `CRITIC_AGENT_FILE` 指向 critic prompt;`CRITIC_DISABLE=1` 可本地调试关 critic
  - smoke-test:fixture workDir 跑过 5 个用例(fixed×2、still_failing×2、deferred×1),summary 计数 + blocking 判定都对
  - 后续观察:critic 在 glm-5 上的 verdict 一致性如果不稳,再加 `--temperature 0` / 换模型

## ADR-0024: /analyze 质量护栏 — URL preflight + 取消 severity 分级

- 日期: 2026-05-14
- 状态: 已采纳
- 上下文: ADR-0023 解决了 /fix 侧的质量(改完是不是真改对了),但 /analyze 侧"判定是不是真有问题"还没护栏。两个具体问题:① official_urls 可能误填、页面下线、改路由 → URL 返回 404 / 重定向到根 / 空响应,但 analyzer 直接跑 4 维度判出一堆假问题;② 4 维度的 problem 之前按 critical/important/minor 三档分,但阈值都是经验拍的(title 10-60 / desc 50-160 / content_ratio < 0.5 等),分级标准没有 ground truth,等同于"既然要 fix,所有 analyzer 报的问题都要改"。三档分级:① 制造决策错觉(说服 reviewer "只看 critical"),② 让 buildFixPayload / planRunsFromPayload / portal-issue 几个地方都要带过滤逻辑,代码噪音多,③ 个别 minor 检查(tdk.keywords 缺失)其实根本不影响 AI 引用,但还在产噪音。
- 选项:
  - A. 维持现状(URL 误填靠人审,severity 分级照旧)
  - B. URL preflight + 取消 severity:URL 异常进 url_unreachable 分支不跑 4 维度;每个 analyzer-detected problem 都视为"要改",废除 critical/important/minor 字段
- 决定: B
- 理由:
  - preflight 是确定性逻辑、上游数据问题专责通道,避免 analyzer 跑出假数据污染下游
  - severity 分级在我们这种"全是确定性规则"的检查体系里是伪复杂度 — 改的标准就一个:analyzer 标了 problem 就改。删除分级让代码更干净、PR / issue 显示更简单
  - tdk.keywords 检查直接删:keywords meta 现代搜索/AI 引擎都不加权,改不改无影响
- 后果:
  - `scripts/analyze-discoverability.js`:加 `preflightUrl(url, httpResult)`,检查 status===200、body≥200 字符、final path 不是从非根跳到根。preflight 失败 → 返回 `{ ok: true, preflight_failed: true, preflight_reason, preflight_detail, problems: [{ category: 'preflight.xxx', dimension: 'preflight', ... }] }`,**不跑 4 维度**
  - `scripts/checks/{tdk,schema,static-render,sitemap-inclusion}.js`:每个 problem 都去掉 `severity` 字段;`pass = problems.length === 0`(static-render 也统一,过去 skipBrowser 模式按 critical 算)
  - `scripts/checks/tdk.js`:删除 keywords 检查(连同 `keywords` 字段返回)
  - `scripts/run-analysis.js` + `analyze-discoverability.js`:`summary` 只剩 `{ total }`,不再有 critical/important/minor 计数
  - `scripts/generate-report.js`:`SEV_ICON` 删除;`buildFixPayload` 不再按 severity 过滤,只过滤 `preflight_failed`;问题清单表去掉 Severity 列
  - `scripts/execute-fix-runs.js`:`buildSlimContext` 不再透 severity 字段给 agent;`planRunsFromPayload` 的 skip_reason 改 'no problems to fix';PR body 表去掉 Severity 列
  - `scripts/open-portal-issues.js`:`collectProblems` 收所有 analyzer problem(只剔 scope_skipped + preflight_failed);portal issue body 表去掉 Severity 列
  - `scripts/poll-portal-status.js` `revalidate`:重验后 problems 数 > 0 就算 still_failing,不再按 severity 过滤;preflight_failed 的 URL 单独记录但**不阻断闭环**(URL 已失效是上游问题)
  - `.github/agents/geo-fix-prompt.md`:input JSON 描述里删 `"severity"` 字段
  - smoke-test:正常 URL → 2 problems, problems 全无 severity ✓;404 → fetchHttp 已经先 throw 走 ok:false 分支(preflight 不会被触发,顺其自然);preflight_failed 的 URL 不进 payload ✓
  - 后续观察:线上跑一段时间统计 preflight_failed 比例;如果高,说明 geo-workflow 那边 official_urls 维护不及时,可以反向反馈给评估侧

## ADR-0025: /fix 加 portal build 步骤 — schema / static-render 不再 "deferred 等线上"

- 日期: 2026-05-15
- 状态: 已采纳
- 上下文: ADR-0023 给 /fix 加了 pre-push 自检,但 schema / static-render 这两个维度被标 `deferred`,延后到 geo-poll 重验闭环兜底。geo-poll 是 cron(目前 weekly,生产 4h),延迟以小时/天计;而且需要 portal 那边先 merge + 部署 才能看到。"不能只依赖线上"是对的 — workDir 里就有完整源码,本来就可以本地 build 出产物 HTML,直接验 JSON-LD 是否真嵌入了、静态 HTML 是否真有内容。如果 build 都跑不起来,那基本说明 agent 改坏了,这本身就是必须 block push 的强信号。
- 选项:
  - A. 维持 ADR-0023(schema/static-render 走 deferred)
  - B. /fix 加 build 步骤:agent 改完 → workDir 里 `pnpm install` + `pnpm run build` → 拿到 dist → 在 dist 里 resolve URL→HTML → 跑 checkSchema / checkTdk 以及静态化校验。build 失败 = agent 改坏了 = 直接 `status=build_failed` 不 push
  - C. 在 portal 仓 CI 做(workflow_run trigger)— 但需要 portal 维护方配合,我们不能控制
- 决定: B(C 是 portal 侧的事,不在本仓范围)
- 理由:
  - build 是 portal 仓的"自有事实" — 跑通了就跑通了,验证比线上闭环可靠且快(2–10 min vs 4h–几天)
  - build 失败这个信号在 ADR-0023 没被捕获 — agent 改个 schema 文件改错 JSON 也能"通过"自检,而 build 一跑就 100% 暴露
  - 退路充足:`GEO_BUILD_DISABLE=1` 关闭、仓没 build 脚本时 skipped=true 优雅降级回 deferred
- 后果:
  - 新增 `scripts/lib/portal-build.js`:
    - 检测 pm:`pnpm-lock.yaml` > `yarn.lock` > `package-lock.json` > 默认 `npm`
    - 检测 build script:`build` > `docs:build` > `generate` > `build:prod`
    - install 跳过(workDir 是 portal 持久 cache 默认 deps 已就位,首次跑才走 `--frozen-lockfile`)
    - 默认 `installTimeoutMs=5min`、`buildTimeoutMs=10min`
    - 探测 output dir:扫一组候选(`dist`、`.vitepress/dist`、`docs/.vitepress/dist`、`.output/public`、`out`、`build`、`public` 等),挑 build 之后 mtime 新的
  - `scripts/checks/post-fix-verify.js`:`verifyFixesInWorkDir({...outputDir})` 多 `outputDir` 入参
    - 新增 `resolveBuiltHtml(url, outputDir)`:URL pathname → 候选文件路径(`<path>/index.html`、`<path>.html`、裸 path),三种 SSG 输出布局都覆盖
    - 新增 `verifyFromBuiltHtml({url, dimension, outputDir, beforeProblem})`:对 schema / static-render / tdk 三种维度跑真验
      - schema:复用 `checkSchema()` 解 JSON-LD
      - tdk:复用 `checkTdk()` 解 `<title>` + `<meta description>`(比 frontmatter 更接近真相)
      - static_render:看 build HTML 有没有 h1 + body 长度 ≥500
    - 主流程:`outputDir` 存在 → 维度走 `verifyFromBuiltHtml`,不存在 → 仍走 deferred 兜底
  - `scripts/execute-fix-runs.js`:
    - 新增 `[4/7] portal build` 步,放在 agent 之后、verify 之前;`buildOutputDir` 传给 verifier
    - build 失败 → `status=build_failed`,**不 push**(强信号:agent 改坏了)
    - `GEO_BUILD_DISABLE=1` 退路
  - `scripts/comment-fix-summary.js`:trigger issue 修复结果表加 `Build` 列(`✅ Ns` / `⏭ skipped:reason` / `❌ phase`);`build_failed` 单独 `<details open>` 贴 build error 尾巴 2000 字符,给 reviewer 排查
  - smoke-test:fixture dist 4 用例(schema fixed、tdk fixed、static_render still_failing、schema URL 没出产物 still_failing),全对;无 outputDir 时优雅降级 deferred
  - /fix 整体时长预计 +2–10min;portal 仓持久 cache 中 deps 不需要每次重装,首次 fresh clone 后 install 5min 是一次性的
  - 暂不做:portal 仓 CI hook(C 选项);build 缓存优化(增量 build)

## ADR-0026: baseline build 前置 + agent prompt 内嵌 build 自检;workflow 失败状态聚合

- 日期: 2026-05-15
- 状态: 已采纳
- 上下文: ADR-0025 加 portal build 之后,首次线上跑(`runs/25872209757`)在 `phase=install` 挂了:`pnpm install` 跑到 husky 的 `prepare` lifecycle 时炸了,stderr 被吞,workflow log 只剩"$ husky install"一行。三个问题暴露:① `execute-fix-runs.js` 末尾的失败聚合只看 `status==='error'`,`build_failed / verify_failed / critic_blocked` 三种 terminal 失败都没让 workflow 挂,整个 job 显示 success;② phase=install 失败 baseline 锅 / agent 锅一刀切归 agent;③ portal-build 错误捕获只看 stderr,pnpm 的 lifecycle script 输出常在 stdout。
- 选项:
  - A. 维持现状(失败一次就放弃,人工 review)
  - B. **baseline build 前置** — agent 跑之前先 build 一次,失败甩锅 portal 维护;成功的话顺便把 deps + dist 都准备好
  - C. **agent prompt 内嵌 build 自检** — prompt 里加"改完先 pnpm install 再 pnpm run build,失败就回滚到 build 通过为止"
  - D. 第二轮 opencode 自救 — 第一轮 agent 跑完 build 挂了,起第二轮 opencode 把 stderr 喂回去再试
- 决定: B + C(D 暂不上)
- 理由:
  - **B 的价值在归因**:phase=install 失败用 baseline 就能定性 — agent 还没下手,baseline 都构不动 → portal 仓 / runner 环境问题。多 1 次 build 换"清晰甩锅"很值
  - **B 的次要价值在准备**:baseline 通过后 deps 装好 + 一份 dist 也在 workDir,agent 自检 build 就不用从零装依赖
  - **C 让 agent 在自己 session 里闭环**:agent 是 opencode + glm-5,有 grep / tool use / 多步思考能力,改完自己 build 看 stderr 是最自然的迭代方式 — prompt 里要求"先 install 再 build,失败就回滚到 build 通过";自检不通过就写 ❌(下游硬验证会兜底,虚标 ✅ 会被抓出)
  - **不上 D**:opencode 第二轮 session 失去第一轮的上下文,要重新 grep + 思考一遍;agent prompt 直接告知"自检通过才标 ✅"已经覆盖大部分场景。如果观察一段时间发现 build 一次过率 <50%,再考虑加 D
- 后果:
  - `scripts/lib/portal-build.js`:
    - install / build 都加 `env: { HUSKY: '0', CI: '1' }`(husky 官方关 prepare 钩子的开关 — 本次 install 失败根因)
    - 错误捕获改成 stdout + stderr 双通道,`merged.slice(-2000/-3000)` 入 `build.error`
  - `scripts/execute-fix-runs.js`:流水线扩到 **8 步**
    - `[1/8] clonePortal`
    - `[2/8] portal baseline build`(新):跑通才进 agent;phase=install/build/detect-output 任一失败 → `status=baseline_failed`(明确归因:portal baseline 问题)
    - `[3/8] write context`
    - `[4/8] runOpencode`(agent prompt 强制要求自己跑 install + build 自检)
    - `[5/8] portal build (post-agent)`(原 `[4/7]`):baseline 此前已通过 → 本次挂只能是 agent 改坏了,`status=build_failed`
    - `[6/8] verify` / `[7/8] critic` / `[8/8] pushAndPr`(序号 +1)
    - 末尾失败聚合 `FAILED_STATES = {error, baseline_failed, build_failed, verify_failed, critic_blocked}`,任一项 → throw,workflow step 失败
    - baseline_failed / build_failed 时把 `error` 尾段 30 行打到 workflow log,免得每次都翻 trigger issue 评论
    - 抽工具函数 `logBuildErrorTail(label, build)` 复用
  - `.github/agents/geo-fix-prompt.md`:工作步骤加第 4 条"改完必须自检 build" — 先 `pnpm install` 再 `pnpm run build`,报错就看 stderr 修;跑不通的改动**优先回滚**并标 ❌;安全约束加一条"不要为了让 build 通过去乱动白名单外的文件"
  - `scripts/comment-fix-summary.js`:Build 列优先看 baseline_build(失败时);baseline_failed / build_failed 都用 `<details open>` 贴 stderr,baseline_failed 文案明确"portal 仓 baseline 问题,跟 agent 无关"
  - README pipeline 描述拉成 8 步;env 表 `GEO_BUILD_DISABLE` 现在同时关 baseline + post-agent build
  - 时长预算:baseline build 比 post-agent build 慢(要装 deps,首次 5-10min;后续 cache 命中 <1min);post-agent build 因为 deps 已装通常 30s-2min。/fix 整体 +5-15min(首次)/ +2-5min(cache 命中)
  - 后续观察:统计 baseline_failed 比例 → 高的话该催 portal 维护;统计 build_failed 比例 → 高且 stderr 看是语法错的话考虑加 D(self-heal)
