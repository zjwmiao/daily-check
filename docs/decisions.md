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
