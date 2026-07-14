# C — 语义化区块（Landmark & Sectioning）

用 HTML5 地标元素取代 `<div class="...">`，让屏阅器与搜索引擎理解页面分区。

## 检查项

### C1. 导航用 `<nav>`
- ✅ `<nav>` 包裹主导航/面包屑/分页
- ❌ `<div class="nav">` / `<div class="menu">` / `<div class="breadcrumb">`

### C2. 页眉/页脚用 `<header>/<footer>`
- ✅ `<header>` 包裹站点顶栏，`<footer>` 包裹底栏
- ❌ `<div class="header">` / `<div class="footer">`

### C3. 侧边栏用 `<aside>`
- ✅ `<aside>` 包裹侧边栏、相关文章
- ❌ `<div class="sidebar">`

### C4. 独立内容块用 `<article>`
- ✅ 博客文章、卡片、评论、新闻条目用 `<article>`
- ⚠️ 纯布局块用 `<article>` 是误用（应用 `<section>` 或 `<div>`）

### C5. 相关内容分组用 `<section>` + 标题
- ✅ `<section><h2>...</h2>...</section>`
- ⚠️ `<section>` 无标题则语义弱（不如 `<div>`）

### C6. 带说明的图片/图表用 `<figure>+<figcaption>`
- ✅ `<figure><img src="chart.png" alt="..."><figcaption>图1：季度增长</figcaption></figure>`
- ❌ `<div class="figure">` + `<p class="caption">`

### C7. 联系信息用 `<address>`
- ✅ `<address>contact@openeuler.org</address>`
- ⚠️ `<address>` 内不应放非联系信息

### C8. 时间用 `<time datetime>`
- ✅ `<time datetime="2025-01-14">2025年1月14日</time>`

## LLM 核对项
- `<div class="nav|header|footer|sidebar|menu|breadcrumb">` 等是否应换语义标签
- 是否漏用 `<nav>/<main>/<aside>/<article>/<section>/<figure>+<figcaption>/<address>/<time>`

## 正反例
```html
<!-- ❌ -->
<div class="nav"><a href="/">首页</a> ...</div>
<div class="header"><img src="logo.png"></div>
<div class="sidebar">...</div>

<!-- ✅ -->
<nav><a href="/">首页</a> ...</nav>
<header><img src="logo.png" alt="openEuler"></header>
<aside>...</aside>
```
