# Daily File Check 检查项详解

本文档详列 `geo-daily-check` workflow 中每个检查项的具体检查内容与通过标准。

检查项以可插拔方式注册，在 `scripts/geo-daily-check/check-single.js` 的 `runProject()` 中按顺序调用，可通过项目配置 `skip_check` 剔除单项。所有维度的简短描述见 `scripts/geo-daily-check/utils.js` 的 `DIMENSION_DESCRIPTIONS`。

通用约定：
- `project.home` 为站点首页地址（取第一个或本身）
- `project.ignore_routes` 为正则数组，命中的 pathname 在所有检查中被跳过
- `project.seo_config_dir.tdk` / `project.seo_config_dir.schema` 为 TDK / JSON-LD 配置文件存放目录
- 配置文件路径规则：`{workDir}/{seo_config_dir}/{pathnameKey}/index.json`，其中 `pathnameKey` 由 `pathnameToKey(pathname)` 得出（去掉首尾 `/`、去掉 `(\/index)?\.html` 后缀，根路径为 `index`）

---

## 1. robots-txt — robots.txt 检查

**源文件**: `scripts/geo-daily-check/checks/robots.js` (`checkRobotsTxt`)

**检查内容**:
1. 抓取 `{home}/robots.txt`
2. 解析 robots.txt，检测是否存在对 `User-agent: *` 全站封禁的分组（`Disallow: /` 且无 `Allow: /`）
3. 检测 robots.txt 是否声明了 `Sitemap:` 指令（正则 `^\s*sitemap:\s*\S+`，忽略大小写）

**通过标准**:
- robots.txt 可正常抓取（无网络错误）
- **未**对 `User-agent: *` 设置 `Disallow: /`（或同时有 `Allow: /` 解除）
- 至少包含一行 `Sitemap:` 指令

**未通过时的 findings**:
- `robots.txt 对 User-agent:* 全站 Disallow: /，禁止爬虫访问`
- `robots.txt 未声明 Sitemap 地址`
- `robots.txt 无法访问: {err.message}`

**附加产出**: 返回 `robotsContent`，供后续 sitemap-access 解析 Sitemap 地址使用。

---

## 2. sitemap-access — sitemap 可访问性检查

**源文件**: `scripts/geo-daily-check/checks/sitemap.js` (`checkSitemapAccessible`)

**检查内容**:
1. 从上一步 robots.txt 内容解析所有 `Sitemap:` URL；若无，回退到 `{home}/sitemap.xml`
2. 对每个 sitemap index URL 发起 GET 请求

**通过标准**:
- 每个 sitemap URL 均返回非空内容

**未通过时的 findings**:
- `sitemap 返回空内容`
- `sitemap 无法访问: {err.message}`

**附加产出**: 返回 `sitemapIndexUrls`，供后续 sitemap-tdk/schema/priority 与 coverage 使用。

---

## 3. sitemap-tdk — sitemap 条目 TDK 配置检查

**源文件**: `scripts/geo-daily-check/checks/sitemap.js` (`checkSitemapConfig` 的 tdk 分支)

**检查内容**:
1. 通过 `getSitemapUrls()`（`scripts/checks/sitemap-inclusion.js`）递归抓取 sitemap index → 所有 `<url>` 条目，解析 `loc` / `lastmod` / `changefreq` / `priority`
2. 对每个条目（命中 `ignore_routes` 的跳过），将其 pathname 经 `pathnameToKey()` 转为 key
3. 检查文件是否存在：`{workDir}/{seo_config_dir.tdk}/{key}/index.json`

**通过标准**:
- 项目已配置 `seo_config_dir.tdk`，且每个 sitemap 条目都存在对应的 TDK 配置文件

**未通过时的 findings**:
- `sitemap条目缺少TDK配置文件`（附带条目 URL）

---

## 4. sitemap-schema — sitemap 条目 Schema 配置检查

**源文件**: `scripts/geo-daily-check/checks/sitemap.js` (`checkSitemapConfig` 的 schema 分支)

**检查内容**:
- 同 sitemap-tdk，但检查 `{workDir}/{seo_config_dir.schema}/{key}/index.json` 是否存在

**通过标准**:
- 项目已配置 `seo_config_dir.schema`，且每个 sitemap 条目都存在对应的 JSON-LD Schema 配置文件

**未通过时的 findings**:
- `sitemap条目缺少Schema配置文件`

---

## 5. sitemap-priority — sitemap priority 属性检查

**源文件**: `scripts/geo-daily-check/checks/sitemap.js` (`checkSitemapConfig` 的 priority 分支)

**检查内容**:
1. 从全部 sitemap 条目中**随机抽样 10 个**（`pickRandom`）
2. 检查每个抽样条目是否定义了 `priority` 属性（解析自 `<priority>` 标签，`parseFloat` 成数字）

**通过标准**:
- 抽样的 10 个条目均含有有效的 `priority` 数值（非 undefined/null）

**未通过时的 findings**:
- `sitemap 条目缺少 priority 属性`（仅针对被抽样的条目）

> 注：本项为抽样检查，非全量。

---

## 6. url-access — URL 可访问性检查

**源文件**: `scripts/geo-daily-check/checks/url-access.js` (`checkUrlAccessibility`)

**检查内容**:
1. 取上一步全部 sitemap URL，过滤掉 `ignore_routes` 命中的
2. 对每个 URL 发起 HEAD 请求，**并发 10**（`CONCURRENCY_LIMIT`）

**通过标准**:
- HTTP 状态码为 **200**

**未通过时的 findings**:
- `发生重定向({status}): {url} -> {location}`（3xx）
- `HTTP状态码非200: {status}`（其他非 200）
- `URL无法访问: {err.message}`（网络/超时错误）

> 注：发生 3xx 重定向即视为未通过。

---

## 7. llms-txt — llms.txt 检查

**源文件**: `scripts/geo-daily-check/checks/llms-txt.js` (`checkLlmsTxt`)

**检查内容**:
1. 抓取 `{home}/llms.txt` 和 `{home}/llms-full.txt` 两个文件（超时 15s）

**通过标准**:
- 两个文件均可访问，且 `trim()` 后内容非空

**未通过时的 findings**:
- `{f} 文件为空或无内容`
- `{f} 无法访问: {err.message}`

---

## 8. sitemap-coverage — 构建产物 sitemap 覆盖检查

**源文件**: `scripts/geo-daily-check/checks/coverage.js` (`checkBuildSitemapCoverage`)

**前置条件**: 项目配置了 `accessible_routes` 且 `sitemapUrls` 非空，否则跳过。

**检查内容**:
1. 递归遍历 `buildDir` 下所有 `.html` 文件，排除 `HTML_IGNORE` 命中的路径：
   - `(200|404|error)\.html$`
   - `baidu_verify`
   - `blog|blogs|news|showcase|showcases` 目录
2. 将每个 HTML 文件映射为 URL pathname（去 `/index.html`、`/.html` 后缀，根为 `/`）
3. 过滤掉 `ignore_routes` 命中的页面
4. 仅对匹配 `accessible_routes`（glob 规则，`**`/`*`/`?` 通配）的页面，检查其 pathname 是否出现在 sitemap 条目集合中

**通过标准**:
- 每个构建产物页面（匹配 `accessible_routes` 且未被忽略）都被 sitemap 收录

**未通过时的 findings**:
- `构建页面未被sitemap收录`（附带页面 URL）

> 注：仅检查 `accessible_routes` 声明应收录的页面，未声明的页面不报。

---

## 9. ssr-rendering — SSR 渲染检查

**源文件**: `scripts/geo-daily-check/checks/ssr.js` (`checkSsrRendering` + `detectSsr`)

**检查内容**:
1. 采样：`home` + 从 sitemap 中随机抽取最多 10 个 URL（过滤 `ignore_routes`）
2. 抓取每个 URL 的 HTML，调用 `detectSsr(html, framework)` 判断是否服务端渲染

**detectSsr 判定逻辑**（按 framework 分支）:
- **VitePress**: 命中 `class="VPContent"` 且 `class="vpi...` → SSR；或 `VPContent` 后跟 `vp-doc` → SSR
- **Nuxt**: 命中 `window.__NUXT__` 或 `data-n-head` → SSR；或 `#__nuxt` 内去标签后文本 > 100 字符 → SSR
- **通用回退**:
  - 提取 `<body>` 内容，去掉 `<script>`/`<style>`/标签后纯文本 **>= 500 字符** → SSR
  - 命中 CSR 特征（`<div id="app">` 空、`<div id="root">` 空、`<div id="__nuxt">` 空）→ 非 SSR
  - 无 body 标签或纯文本 < 500 字符 → 非 SSR

**通过标准**:
- 被采样页面均判定为 SSR（服务端渲染，含足够可索引文本）

**未通过时的 findings**:
- `result.reason`（如 `body 内容不足 (X 字符)`、`检测到 CSR 特征: Vue SPA 空挂载点`、`无 body 标签`）
- `检测失败: {err.message}`

> 注：本项为抽样检查，每项目最多 11 个 URL（home + 10）。

---

## 10. tdk-schema-semantic — TDK/Schema 语义检查

**源文件**: `scripts/geo-daily-check/checks/tdk-schema-semantic.js` (`checkTdkSchemaSemantic`)

**前置条件**: 项目配置 `enable_tdk_schema_semantic: true` **且** 本次有新提交（`hasNewCommits`），否则跳过。

**检查流程**（两阶段 LLM 分析，均通过 `opencode run` + `--model` + `--dangerously-skip-permissions`）:

**阶段 1 — render-change 分析** (`runRenderChangeAnalysis`):
- 使用 `render-change-analyzer` skill 分析最近 `semantic_analysis_commits_count`（默认 5）个 commits 影响了哪些页面
- 输出 JSON 数组（pathname 列表），带 `<!-- RENDER_CHANGE_RESULT -->` 标记

**阶段 2 — 语义质量分析** (`buildSemanticCheckPrompt`):
- 将阶段 1 的 pathname 映射到 `buildDir` 下对应 `index.html` 文件
- 让 LLM 读取每个 HTML，提取 `<title>`、`<meta name="description">`、`<meta name="keywords">`、`<script type="application/ld+json">`
- 分析：
  1. TDK/Schema 内容是否与页面实际内容一致
  2. 是否包含不存在于页面中的信息（如其他社区名称、无关关键词）
  3. `description` 长度是否合理（建议 100–200 字符）
  4. JSON-LD schema 类型是否合适
- 输出 `{ has_problems, problems[] }`，带 `<!-- ANALYZE_RESULT -->` 标记

**通过标准**:
- LLM 报告 `has_problems: false`（TDK 与 Schema 语义与页面实际内容一致）

**未通过时的 findings**:
- 每个 problem 转为一条 finding，`message` 为 LLM 给出的 `description`（dimension 限 `tdk-quality` 或 `schema-quality`）

> 注：若阶段 1 返回空（无受影响页面）或找不到对应 HTML 产物，直接返回无问题。

---

## 11. link-anchor-check — 链接锚文本检查

**源文件**: `scripts/geo-daily-check/checks/link-anchor.js` (`checkLinkAnchor`)

**前置条件**: 项目配置 `enable_link_anchor_check: true`，且非 docs 类项目。构建前执行（需先 `codegraph init/sync`）。

**检查内容**:
- 通过 `opencode run` + codegraph 分析源码中**应使用 `<a href>` 却用 JS 跳转**的场景：
  1. `onClick` + `router.push` / `navigateTo` / `navigate`
  2. `window.location.href = ...` / `window.open(...)`
  3. 自定义点击事件中执行跳转

**跳过场景**（不报告）:
- 需 `confirm` 确认的跳转
- 需携带 state 数据的跳转（如 `router.push({ path, query })`）
- 需特殊逻辑（登录状态检查、权限验证）
- 非导航元素（表单提交、删除、下载、modal/dropdown 触发按钮）
- 已正确使用 `<a href>` 的链接

**功能模块分类**: 每个 finding 根据组件文件路径/用途判定 `module`（中文名）：导航栏 / 页脚 / 侧边栏 / 面包屑 / 卡片列表 / 轮播图 / 标签页 / 搜索 / 按钮组 / 其他。

**通过标准**:
- LLM 报告空数组（不存在应改为 `<a href>` 的 JS 跳转）

**未通过时的 findings**:
- `message` = `{description} ({file}:{line})`，附带 `severity`（high/medium/low）和 `module`

**Issue 上报特殊处理**: link-anchor-check 维度按 `module` 再细分，每个功能模块单独提一个 issue（其他维度按 check 字段分组）。

---

## 检查项执行顺序与依赖

`runProject()` 中的调用顺序（见 `check-single.js`）：

```
[codegraph init/sync] (若启用 tdk-schema-semantic 或 link-anchor-check，非 docs)
  ↓
[link-anchor-check] (构建前，需 codegraph)
  ↓
[spawnBuild] (非阻塞，非 docs)
  ↓ (并行) 线上检查：
  robots-txt → sitemap-access → sitemap-tdk/schema/priority → url-access → llms-txt → ssr-rendering
  ↓
[等待构建完成]
  ↓
[sitemap-coverage] (需 accessible_routes + sitemap)
  ↓
[tdk-schema-semantic] (需 hasNewCommits + enable_tdk_schema_semantic)
  ↓
汇总 findings → 按维度/模块分组提 issue
```

依赖关系：
- `sitemap-access` 依赖 `robots-txt` 的 `robotsContent`
- `sitemap-tdk/schema/priority` 依赖 `sitemap-access` 的 `sitemapIndexUrls`，并产出 `sitemapUrls` 供后续多项使用
- `url-access` / `ssr-rendering` 依赖 `sitemapUrls`
- `sitemap-coverage` 依赖 `sitemapUrls` + 构建产物 `buildDir`
- `tdk-schema-semantic` 依赖构建产物 + 代码变更

## 配置开关汇总

| 检查项 | 触发条件 | 可 skip |
|---|---|---|
| robots-txt | 默认开启 | `skip_check: ['robots-txt']` |
| sitemap-access | 默认开启 | `skip_check: ['sitemap-access']` |
| sitemap-tdk | 需 `seo_config_dir.tdk` | `skip_check: ['sitemap-tdk']` |
| sitemap-schema | 需 `seo_config_dir.schema` | `skip_check: ['sitemap-schema']` |
| sitemap-priority | 默认开启 | `skip_check: ['sitemap-priority']` |
| url-access | 需 sitemap 非空 | `skip_check: ['url-access']` |
| llms-txt | 默认开启 | `skip_check: ['llms-txt']` |
| sitemap-coverage | 需 `accessible_routes` + sitemap 非空 | `skip_check: ['sitemap-coverage']` |
| ssr-rendering | 默认开启 | `skip_check: ['ssr-rendering']` |
| tdk-schema-semantic | 需 `enable_tdk_schema_semantic: true` 且有新提交 | `skip_check: ['tdk-schema-semantic']` |
| link-anchor-check | 需 `enable_link_anchor_check: true`，非 docs | `skip_check: ['link-anchor-check']` |
