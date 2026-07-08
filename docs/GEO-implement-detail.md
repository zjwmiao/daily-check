# GEO 技术优化维度

本文档描述生成式引擎优化（Generative Engine Optimization, GEO）在技术层面的几个核心优化维度。GEO 面向 ChatGPT、Perplexity、Gemini、Claude 等生成式引擎，目标是让站点内容被这些引擎**正确理解、稳定收录、并被高概率引用**。

与侧重排名的传统 SEO 不同，GEO 更关注：内容是否可被无头抓取器读取、是否结构化、语义是否自洽、能否主动为 LLM 提供可消费的文本。下表为本文覆盖的六个维度，括号内为本仓库 `geo-daily-check` workflow 中对应的检查项 key。

| 维度 | 检查项 | 核心目标 |
|---|---|---|
| 静态化页面 | `ssr-rendering` | 首屏 HTML 含足够可索引文本 |
| TDK | `sitemap-tdk` / `tdk-schema-semantic` | 每页标题/描述/关键词完整且与内容一致 |
| Schema | `sitemap-schema` / `tdk-schema-semantic` | 结构化数据类型合适、与页面内容一致 |
| sitemap | `sitemap-access` / `sitemap-priority` / `sitemap-coverage` | 全部应收录页面可被发现 |
| robots.txt | `robots-txt` | 不误封 AI 爬虫，声明 sitemap |
| llms.txt | `llms-txt` | 主动为 LLM 提供可消费的站点内容 |

---

## 1. 静态化页面

### 含义

- **SSR（Server-Side Rendering）**：每次请求由服务端输出完整 HTML。
- **SSG（Static Site Generation）**：构建期生成完整 HTML，部署即静态文件。
- **CSR（Client-Side Rendering）**：服务端只返回空挂载点（如 `<div id="app"></div>`），由浏览器执行 JS 后填充内容。

GEO 场景下，多数 AI 抓取器**不执行 JavaScript**，CSR 页面被抓取时只剩空壳，正文内容完全不可见。SSR/SSG 保证首屏 HTML 即含完整可索引文本，是 GEO 的硬性前提。

### 最佳实践标准

- **优先 SSR/SSG**：文档站、portal 站点应使用 SSG（VitePress、Nuxt content、Docusaurus、Next.js SSG 等），保证部署产物为含正文的 HTML。
- **无空挂载点**：HTML 中不应出现 `<div id="app"></div>`（Vue SPA）、`<div id="root"></div>`（React SPA）、`<div id="__nuxt"></div>`（Nuxt CSR）等空壳特征（命中即判 CSR）。
- **框架特征通过**：
  - VitePress：HTML 含 `class="VPContent"` 与 `vpi` 类，或 `VPContent` 后跟 `vp-doc`。
  - Nuxt：含 `window.__NUXT__` 或 `data-n-head` 数据注入，或 `#__nuxt` 容器内去标签后文本 > 100 字符。
- **链接可爬**：导航应使用 `<a href>` 而非 JS 跳转（`onClick` + `router.push` / `window.location.href`），否则爬虫无法沿链接发现页面。

### 检查标准

- **采样**：从 sitemap 中随机抽取最多 10 个 URL（过滤 
- **VitePress**: 命中 `class="VPContent"` 且 `class="vpi...` → SSR；或 `VPContent` 后跟 `vp-doc` → SSR
- **Nuxt**: 命中 `window.__NUXT__` 或 `data-n-head` → SSR；或 `#__nuxt` 内去标签后文本 > 100 字符 → SSR
- **通用回退**:
  - 提取 `<body>` 内容，去掉 `<script>`/`<style>`/标签后纯文本 **>= 500 字符** → SSR
  - 命中 CSR 特征（`<div id="app">` 空、`<div id="root">` 空、`<div id="__nuxt">` 空）→ 非 SSR
  - 无 body 标签或纯文本 < 500 字符 → 非 SSR

---

## 2. robots.txt

### 含义

`robots.txt` 位于站点根目录，声明各爬虫的访问规则（`Allow` / `Disallow`）以及 sitemap 地址。它是控制 AI 爬虫能否抓取站点的第一道闸门。

GEO 场景下的关键风险：很多站点为防爬会对 `User-agent: *` 设置 `Disallow: /`，这会同时封禁 AI 抓取器，导致站点内容完全无法进入生成式引擎的语料库。

### 最佳实践标准

- **可访问**：`{home}/robots.txt` 返回 200 与非空内容。
- **禁止全站封禁**：不得对 `User-agent: *` 设置 `Disallow: /`（除非同时有 `Allow: /` 解除）。本项目 `blocksAllCrawlers` 检测此类全站封禁。
- **声明 Sitemap**：至少包含一行 `Sitemap: <url>` 指令，供爬虫发现 sitemap。
- **语法正确**：`User-agent` / `Allow` / `Disallow` / `Sitemap` 字段大小写不敏感但需分行书写。

### 检查标准

- robots.txt 可正常抓取（无网络错误）
- **未**对 `User-agent: *` 设置 `Disallow: /`（或同时有 `Allow: /` 解除）
- 至少包含一行 `Sitemap:` 指令

---

## 3. Sitemap

### 含义

`sitemap.xml` 列出站点所有应被收录的 URL 及其元信息（`lastmod` / `changefreq` / `priority`），供爬虫发现与收录。大站点通常用 `sitemap index` 引用多个分片 sitemap。

GEO 场景下，sitemap 是 AI 抓取器发现页面的主要入口——多数生成式引擎不会无限深度爬取，未列入 sitemap 的页面被引用的概率显著降低。

### 最佳实践标准

- **在 robots.txt 中声明 `Sitemap:` 指令**
- **可访问**：每个 sitemap URL 返回非空合法 XML。
- **支持 sitemap index**：大站点用 index 引用分片，分片单文件建议不超过 50,000 URL / 50MB。
- **条目字段完整**：每个 `<url>` 应包含 `<loc>`、`<lastmod>`、`<changefreq>`、`<priority>`。本项目对 `priority` 抽样 10 条校验存在性。
- **`priority` 取值 0.0–1.0**：表达相对优先级，重要页面设高值，辅助页面设低值。
- **仅收录规范 URL**：收录的 URL 应返回 200、无重定向、规范化（无 trailing slash 歧义、无重复参数）。

### 检查标准

- 从 robots.txt 内容解析所有 `Sitemap:` URL，对每个 sitemap URL 发起 GET 请求，通过标准是每个sitemap URL均可正常访问且内容非空
- 对 Sitemap 中列出的每个 **页面URL** 发起 HEAD 请求，HTTP 状态码为 **200**
- 检查每个 Sitemap 条目是否定义了 `lastmod`、`changefreq`、`priority` 属性，以及属性值的是否准确

---

## 4. TDK（Title / Description / Keywords）

### 含义

TDK 指页面 `<head>` 中的三个 meta 元素：

- `<title>`：页面标题，浏览器标签与搜索结果标题的主要来源。
- `<meta name="description">`：页面摘要描述，搜索结果与生成式引擎引用时的候选摘要文本。
- `<meta name="keywords">`：关键词声明。

在 GEO 场景下，生成式引擎抓取页面后常将 `title` + `description` 作为摘要/引用的语义锚点。若 TDK 缺失、空泛、或与正文不一致，引擎要么无法引用、要么生成偏离页面本意的摘要。

### 最佳实践标准

- **每页独立 TDK**：每个可索引 URL 拥有唯一 title 与 description，避免全站共用模板。
- **title**：含核心关键词与品牌后缀，建议 30–60 个中文字符（或 50–60 英文字符），避免关键词堆砌。
- **description**：准确概括页面内容，建议 **100–200 字符**（本项目语义检查的判定阈值），自然包含目标关键词。
- **keywords**：传统搜索引擎已基本忽略，但对部分 AI 抓取器仍可提供语义线索；可保留少量精准词，禁止堆砌无关词。
- **语义一致性**：TDK 内容需与页面自身内容相关。

### 检查标准

- **配置覆盖**： 遍历sitemap所有页面url，检查是否在 `.geo/tdks/` 中有对应的归档文件
- **语义检查**： 分析最近的git commits影响了哪些页面，让 LLM 读取每个 HTML，提取 `<title>`、`<meta name="description">`、`<meta name="keywords">`，分析：
   1. TDK 内容是否与页面实际内容一致
   2. 是否包含不存在于页面中的信息（如其他社区名称、无关关键词）
   3. `description` 长度是否合理（建议 100–200 字符）

> title可以分段显示，例如 `openEuler | 开源社区 | openEuler社区官网` ，体现页面标题、页面所属模块以及品牌关键词，可提高可读性、保证品牌曝光
> 
> 主要关键词放在前面：例如文章标题或核心主题。
> 
> 品牌或网站名放在后面：通过管道符分隔，保证品牌曝光。
> 
> 避免过度堆砌：不要在标题里重复过多关键词，保持简洁。

---

## 5. Schema（结构化数据）

### 含义

JSON-LD（JSON for Linked Data）以 `<script type="application/ld+json">` 形式嵌入页面，按 schema.org 词汇描述页面实体类型与属性。例如一个文档页可声明为 `Article`，FAQ 页声明为 `FAQPage`。

生成式引擎利用结构化数据理解“这个页面是什么实体、包含哪些关系”，相比从自由文本推断，结构化数据更稳定、引用概率更高。它也是知识图谱构建（sameAs、about 等）的重要信号。

### 最佳实践标准

- **页面嵌入**，通过 `<script type="application/ld+json">` 嵌入。
- **选择合适的 `@type`**：文档/文章用 `Article` / `TechArticle`；FAQ 用 `FAQPage`；教程用 `HowTo`；产品用 `Product`；面包屑用 `BreadcrumbList`；站点级用 `WebSite` + `Organization`。类型不匹配会被引擎忽略甚至误判。
- **数据与页面内容一致**：JSON-LD 中声明的字段（如 `headline`、`author`、`datePublished`）必须与页面可见内容吻合，不得凭空生成。
- **校验通过**：语法与字段遵守schema.org规范。
- **语义质量**：`@type` 选取合适、字段无张冠李戴。

### 检查标准

- **配置覆盖** 遍历sitemap所有页面url，检查是否在 `.geo/jsonld/` 中有对应的归档文件
- **语义检查** 分析最近的git commits影响了哪些页面，让 LLM 读取每个 HTML，提取 `<script type="application/ld+json">`，分析：
   1. Schema 内容是否与页面实际内容一致
   2. 是否包含不存在于页面中的信息（如其他社区名称、无关关键词）
   4. JSON-LD schema 类型是否合适

---

## 6. llms.txt 与 llms-full.txt

### 含义

[llms.txt](https://llmstxt.org/) 是一个为 LLM 主动提供站点内容的提议标准，部署在站点根目录：

- **`/llms.txt`**：简要目录/导航文件，markdown 格式，提供站点概览与重要链接列表，类似给 LLM 的“站点地图”。
- **`/llms-full.txt`**：全量内容拼接文件，把站点的核心文档内容合并为单一可消费的纯文本/markdown，供 LLM 一次性读取。

GEO 场景下，这两个文件让站点**主动**为生成式引擎提供结构化、已清洗、可消费的文本，而非被动等待爬虫解析 HTML。被收录进 `llms-full.txt` 的页面，被 AI 引擎引用的概率显著提升。

### 最佳实践标准

- **两个文件均存在且非空**：`/llms.txt` 与 `/llms-full.txt` 均可访问，`trim()` 后内容非空（本项目 `llms-txt` 检查的判定标准）。
- **markdown 格式**：使用纯文本/markdown，避免 HTML 嵌套，便于 LLM 直接消费。
- **`llms.txt` 结构清晰**：含项目/站点名称、概述、按主题分组的链接列表（指向 `llms-full.txt` 或具体页面）。
- **`llms-full.txt` 覆盖核心内容**：包含站点主要文档/页面的正文内容拼接，保持与站点实际内容同步更新。
- **路径可发现**：放在站点根目录，文件名严格为 `llms.txt` / `llms-full.txt`（小写）。
- **内容一致**：`llms-full.txt` 中的内容应与线上页面正文一致，避免“AI 看到的版本”与“用户看到的版本”分叉。

## 检查标准

- 抓取 `{home}/llms.txt` 和 `{home}/llms-full.txt` 两个文件（超时 15s）
- 两个文件均可访问，且 `trim()` 后内容非空

---

## 维度间的依赖关系

这六个维度并非独立，存在明显的链式依赖：

```
robots.txt（声明 Sitemap + 不封禁 AI 爬虫）
   ↓
sitemap（被发现 + 可访问 + 条目完整 + 覆盖全量页面）
   ↓
SSR/SSG（被抓取的 HTML 含可索引正文）
   ↓
TDK + JSON-LD（正文之上叠加语义锚点与结构化实体）
   ↓
llms.txt / llms-full.txt（主动提供清洗后的可消费文本）
```

- 若 **robots.txt** 封禁 AI 爬虫，后续五个维度全部失效。
- 若 **sitemap** 不收录某页面，该页面的 TDK/JSON-LD/SSR 检查都不会触达它。
- 若页面是 **CSR**，即使 TDK/JSON-LD 写得再好，正文对 LLM 不可见。
- **TDK/JSON-LD** 是“被动”的语义层，**llms.txt** 是“主动”的内容层，两者互补。

本仓库 `geo-daily-check` workflow 按此依赖顺序执行检查，详见 [docs/daily-check-items.md](daily-check-items.md)。

# 各社区落地措施

## TDK/JSON-LD

- 官网站各页面的TDK以json格式归档于项目根目录的 `.geo/tdks/` 和 `.geo/jsonld` 下，文件路径与现网页面url的路径相对应，在构建时利用框架功能自动为每个页面填充
- 文档站点的TDK目前不做特殊处理，沿用自身就有的title、description，文档数量庞大，暂未为每个页面设置JSON-LD

## Sitemap

- **Vitepress项目**：由框架自带生成sitemap功能构建时自动生成
- **Nuxt项目**：由脚本在构建时遍历所有页面生成
- 自动设置每个页面的lastmod（最后更新时间）、changefreq（更新频率）
- 用正则表达式匹配不同的页面url来为不同模块页面设置不同的priority值
- **文档站点**：各版本文档sitemap位于版本所属的路径下，在入口url的根路径下用 `<sitemapindex>` 统一引用
- **MindSpore**：官网的sitemap地址为 `https://www.mindspore.cn/sitemap.xml`，文档站的sitemap在 `https://www.mindspore.cn/sitemap-docs-index.xml` 统一引用所有文档全量页面

## llms.txt/llms-full.txt

- 由脚本在构建时自动生成

# 下一步措施

**HTML结构语义化优化**

在已实现 SSG/SSR 保证首屏 HTML 含正文的前提下，进一步让 HTML 结构对生成式引擎“可读、可分块、可引用”。以下为可落地的优化项：

- **语义化标签替代 div 堆砌**：用 `<header>` / `<nav>` / `<main>` / `<article>` / `<section>` / `<aside>` / `<footer>` / `<figure>` / `<figcaption>` 划分页面区块，使 LLM 能按语义块切分内容，而非依赖 class 名猜测区块含义。
- **标题层级规范**：每页一个 `<h1>`（与页面主题一致），`<h2>`–`<h6>` 不跳级、不滥用作样式。标题层级是 LLM 提取内容大纲的主要依据。
- **图片 `alt` 属性**：所有 `<img>` 提供描述性 `alt`；装饰性图片用 `alt=""`。图表/示意图的 alt 应概括图意，便于无视觉能力的引擎理解图示内容。
- **链接锚文本可读**：锚文本需描述目标内容（如“openEuler 24.03 LTS 安装指南”），避免“点击这里”“了解更多”等无语义文本，便于引擎判断链接价值与主题。
- **列表语义化**：枚举内容用 `<ul>` / `<ol>`，术语-定义用 `<dl>` / `<dt>` / `<dd>`，而非用 div + 符号模拟，保证列表项可被结构化提取。
- **面包屑导航结构化**：用 `<nav aria-label="面包屑">` 包裹，并配合 `BreadcrumbList` JSON-LD，帮助引擎定位页面在站点层级中的位置。
- **引用与来源标注**：引文用 `<blockquote cite="URL">` / `<q>`，来源用 `<cite>`，便于生成式引擎追溯与归属引用源，提升被引用可信度。
- **时间语义化**：发布/更新时间用 `<time datetime="ISO8601">`，让引擎稳定解析绝对时间，而非从自由文本推断。
- **代码块规范**：`<pre><code class="language-xxx">` 标注语言，便于引擎区分代码与正文、按语言提取示例。
- **语言标注**：`<html lang="zh-CN">` 根级语言声明，跨语言片段用 `lang` 属性局部标注，帮助多语言内容正确分词与归属。
- **内容分区锚点**：长文档为各 `<section>` 配 `id` 与 `aria-labelledby` 指向其标题，支持引擎生成可定位的章节引用链接。
- **避免语义错位**：交互元素用对应标签（`<button>` / `<a>`），不用 `<div onclick>` 模拟；表单用 `<label for>` 关联控件，防止语义信号丢失。
- **隐藏内容处理**：仅对辅助技术需隐藏的内容用 `aria-hidden="true"`，避免对正文内容误隐藏导致引擎漏读。

**过时文档标记**

对停止维护版本的文档页面，加上 `canonical` 标签，指向最新版本的文档页面
