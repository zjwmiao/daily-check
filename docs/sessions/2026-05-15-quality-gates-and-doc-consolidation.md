# 质量护栏 + 体验改善 + 文档整合 — 2026-05-15

## 目标

接续 2026-05-14 工作流上线后第一批实战反馈,重点解决:① /fix 出 PR 但 atomgit 报"已有 MR",② PR / portal issue 显示粗糙、对外可见物泄露内部路径,③ /analyze 判定缺质量护栏,④ /fix 缺质量护栏,⑤ 文档分散漂移。

## 轮次

### Round 1 — AtomGit PR 去重失败

- 请求: /fix createPullRequest 400 报 "Another open merge request already exists: !3085",但 listPullRequests 漏检,期望已有 PR 走 update 不要重建。
- 结论: 实测 atomgit `head` 过滤只认裸 branch 名,不认 GitHub 的 `owner:branch` → listPullRequests 永远返回空。修两道:① head 自动剥 `owner:` 前缀 + 客户端按 `head.ref` 兜底过滤;② createPullRequest 4xx 解析 `already exists !N` 抛 `PullRequestAlreadyExistsError(nonRetryable=true)`,上层 fallback 走 update + `getPullRequest` 补 html_url。
- 产出: `scripts/lib/atomgit-api.js` 新错误类 + retry nonRetryable;`scripts/execute-fix-runs.js` `updateExisting()` 兜底;**ADR-0020**。

### Round 2 — 评论 / PR 卫生 5 项

- 请求: ① openEuler 双域名 sitemap 比对失败 ② runner 临时路径漏进 issue ③ 修改清单要手动展开 + 显原生 md ④ output.md 被 commit 进 PR ⑤ 更新后 PR 链接 undefined。
- 结论: 一次性修齐 — community-map 加 `canonicalizeUrlHost` host 归一;workflow ack 去 `${run_dir}` 字段;`<details>` → `<details open>` + 删 ```text``` 围栏让 md 渲染;output_file 改落 ctxDir + 入口防御扫;updateExisting 强制 pr.number 补,fallback 路径 `getPullRequest` 拿 html_url。
- 产出: `lib/community-map.js`、`checks/sitemap-inclusion.js`、`analyze-discoverability.js`、`geo-develop-workflow.yml`、`comment-fix-summary.js`、`execute-fix-runs.js`;**ADR-0021**。

### Round 3 — 对外可见物正文重排 + 关联 portal issue

- 请求: PR 没引用 portal issue(merge 后不自动关);PR / issue 版式粗暴 + 把没问题的 URL 也列出来 + 外露 trigger issue。
- 结论: 调整工作流顺序让 `open-portal-issues` 先于 `generate-report`,portal_issue_url 内嵌到 payload;PR / issue body 重排成"小字关联行 + 单张问题表 + `<sub>` 脚注";过滤 scope_skipped + 无问题 URL;PR body 加 `Closes #N` 自动关。
- 产出: `geo-develop-workflow.yml` step 重排、`generate-report.js`/`execute-fix-runs.js`/`open-portal-issues.js` 渲染重写;**ADR-0022**。

### Round 4 — 质量保证讨论:Q1 分析正确性 + Q2 改动测试

- 请求: 从软工角度看,/analyze 怎么保证准确、/fix 怎么验证改动没改坏?
- 结论: 列了 4 类护栏方案(F+G 自检+Before/After、E 单元测试、A+B review gate、C critic),AskUserQuestion 用户选 **F+G + C**。/fix 加 pre-push 静态自检(sitemap + tdk 就地、schema/static-render deferred)+ critic 反向审查(第二次 opencode skeptic 角色)+ PR body Before/After 表。
- 产出: 新 `scripts/checks/post-fix-verify.js`、`.github/agents/geo-critic-prompt.md`;`execute-fix-runs.js` 加 `[4/6]` verify + `[5/6]` critic 两步,verify_failed / critic_blocked 阻断 push;trigger comment 加 Verify/Critic 列;**ADR-0023**。

### Round 5 — /analyze 护栏 + 取消 severity 分级

- 请求: ADR-0023 解决了 /fix,但 /analyze 的判定还可能假阳性 / 维度选错。另外 critical/important/minor 三档分级标准从哪来,要不要砍。
- 结论: AskUserQuestion 用户选 **P1(URL preflight)**;另答应"既然全是确定性规则,severity 分级就是伪复杂度",一并砍掉 — 所有 problems 平等,凡 analyzer 标的都要改。tdk.keywords missing 直接删检查(AI 引擎不加权)。
- 产出: `analyze-discoverability.js` 加 `preflightUrl()`(404/empty/redirected-to-root 三种 case);全 4 个 check 模块去 `severity`;`buildFixPayload`/`planRunsFromPayload`/`poll-portal-status` 删按 severity 过滤;PR/issue 表去 Severity 列;**ADR-0024**。

### Round 6 — /fix 加 portal build 真验

- 请求: schema/static-render 不能只靠 geo-poll 线上重验(延迟 4h+),workDir 里就有源码,本来就能 build 出 dist 再验。
- 结论: 加 `[4/7] portal build` 步骤,自动检测 pm(pnpm/yarn/npm)+ build script(`build`/`docs:build`/`generate`),build 失败直接 `status=build_failed` 不 push(强信号:agent 改坏了)。post-fix-verify 接 outputDir 后对 dist HTML 跑真 `checkSchema` / `checkTdk` / 静态化判定。退路 `GEO_BUILD_DISABLE=1`。
- 产出: 新 `scripts/lib/portal-build.js`;`post-fix-verify.js` 加 `verifyFromBuiltHtml` + `resolveBuiltHtml`;`execute-fix-runs.js` 流水线变 7 步;trigger comment 加 Build 列 + build_failed 详情 `<details>`;**ADR-0025**。

### Round 7 — Critic prompt 强化 + portal issue 链接显眼

- 请求: ① critic 实战发现"已经配备 schema"的判断,看着是只读了 git diff 没看 build 产物;② 本仓 tracker issue 里 geo-workflow 链接太隐蔽。
- 结论: ① critic prompt 重写,把 `verify_checks` 上升为 "ground truth" 红线,要求每条结论引用 `verify_checks[N].status/after` 或 `git diff <file:line>` 具体证据;② `sync-geo-issues.js` body 重排成 blockquote + bare URL 双形式,加 `<!-- geo-sync-body v2 -->` BODY_MARKER 让旧格式 tracker issue 自动 PATCH 刷;`fetch-geo-issues.js` URL fallback 防 `mapEntry.issue_url` 缺字段死链。
- 产出: `.github/agents/geo-critic-prompt.md` 重写;`sync-geo-issues.js` + `fetch-geo-issues.js`;**ADR 未追加**(运行期细节,不上升到决策)。

### Round 8 — 文档整合 + ADR 解耦

- 请求: 刷新 design.md;后续讨论 → 直接整合算了,只保留 README;后续再讨论 → README 不要涉及 ADR 编号,担心 ADR 更新要同步刷;问要不要复活 design.md。
- 结论: 选 **删 design.md + 保留 README + README 不引用任何 ADR**。design.md 1-9 节(手工修法、robots/llms 介绍)在自动化上线后已失效,真实逻辑在代码 + ADR;再多一层中间文档只是新漂移源。README 只描述当前状态,decisions.md 解释为什么 — 两份文档完全解耦,任意一份变更不强制刷另一份。
- 产出: README.md 重写为 ~260 行单一权威文档(含 TOC + mermaid + 7 步流水线表 + portal body 规范 + 13 项 env);`git rm docs/design.md`;ADR 引用全清(7 处 inline + 18 项末尾清单);**不追加 ADR**(文档整合是体例选择,不上升决策)。

## Commits

本轮产物分 5 个 commit 落地:`f2752c0` fix-逻辑 → `86a74e8` 外部展示 → `9be5c77` 测试对抗+取消分级 → `306d363` build 校验 → `c68f1a1` README。剩 README 二次清理(去 ADR 引用)+ 本会话日志待 commit。

## 未完成 / 待办

- [ ] 等下次 /fix 实战观察:critic prompt 强化后是否引用 `verify_checks` 证据;portal build 在 openEuler-portal 这种大仓的耗时
- [ ] ADR-0023 提到的 P3(/analyze critic)/ P4(analyzer regression 套件)/ A+B(人工 review 闸门)仍待评估
- [ ] BODY_MARKER 旧格式 patch 逻辑下次 `geo-poll` cron 跑过后,看老 tracker issue 是否真被刷成 v2
