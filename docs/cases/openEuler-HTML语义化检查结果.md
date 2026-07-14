# HTML 语义化审计报告 — openEuler Portal

> 由 `html-semantics-auditor` skill 生成 · 审计日期 2026-07-14

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML 语义化审计报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
扫描范围: app/.vitepress/src-new/** 下 190 个 .vue 文件
          + 布局外壳 app/.vitepress/src/App.vue + theme/index.ts + config.ts
          + 抽查 OpenDesign 组件源 (OLink/OButton)

汇总: ❌ Error: 6 类 | ⚠️ Warn: 10 类 | ℹ️ Info: 7 项
```

## 关键结论

1. **图片无 `alt` 是最普遍的问题**（约 50 处 / 30 个文件），首页、各 minisite、页脚、登录头像均存在。
2. **大量用 `<div>/<span>/<p> + @click` 承担按钮/导航动作**（约 25 处），应改为 `<button>` 或 `<a>`。
3. **全代码库 0 处 `aria-label`** —— 图标型交互控件（菜单、主题切换、关闭、搜索）普遍没有可访问名。
4. **首页缺失 `<h1>`** —— `HomeBanner` 用 `<div class="banner-title">` 代替标题；非 BannerLevel2/3 的页面普遍无 h1。
5. **`OLink`/`OButton` 不会自动注入 `rel="noopener noreferrer"`**（已核对组件源码），约 56 处 `target="_blank"` 未显式带 `rel`，其中跨域外链存在 reverse-tabnabbing 安全风险。
6. **无 skip-to-content 跳转链接**；页脚用 `<div>` 而非 `<footer>` 地标。

---

## ❌ Error（严重）

| 维度 | 文件位置:行号 | 修改建议 |
| --- | --- | --- |
| G1 图片 alt | AppFooter.vue:158 (filingData.icon) | 必须加 `alt`（如 alt="公安备案图标"）；装饰图用 `alt=""` |
| G1 图片 alt | AppTour.vue:200 | 加 `alt=""`（装饰）或语义描述 |
| G1 图片 alt | BannerLevel2.vue:49,72 / BannerLevel3.vue:41 / MarkdownBanner.vue:39 | 背景装饰图统一 `alt=""` |
| G1 图片 alt | HomeBanner.vue:110 (banner-attach) | 加 `alt=""` 或描述 |
| G1 图片 alt | HomePlayCommunity.vue:83,87,95,146,180,181 | 全部补 `alt`，logo 类用语义描述 |
| G1 图片 alt | HomeDisplayZone.vue:25 / HomeCalendar.vue:650,662,668 / HomeIntro.vue:91,111 | 补 `alt` |
| G1 图片 alt | TheContactUs.vue:197,211,222,246,247 | 封面/二维码/图标均补 `alt`（二维码用 `alt="…公众号二维码"`） |
| G1 图片 alt | HeaderLogin.vue:66,75 (用户头像) | `:alt="guardAuthClient.username"` 或 `alt="用户头像"` |
| G1 图片 alt | HeaderNav.vue:203 (shortcut.PICTURE) | 补语义 `alt` |
| G1 图片 alt | MirrorList.vue:267,296 (sponsorLogo) | `alt="赞助商 logo"` |
| G1 图片 alt | SigAbout.vue:122 / SigMeeting.vue:530,620 / SigRepo 等 | 补 `alt` |
| G1 图片 alt | Minisite*.vue (Agenda:27,Card:29,Guide:31,33,Introduce:24,Live:86,Review:23) / SummitBanner:38,39 / GuestCentent:72 / IBVersion:51 / SummitPartner:26 | 每个 minisite 标题图补 `alt`（主题图） |
| G1 图片 alt | TheHonor.vue:151 / TheBrand.vue:102 / TheSigRoleDescription.vue:173,228,232 | 补 `alt`；line232 是 `visibility:hidden` 占位图，用 `alt=""` |
| G1 图片 alt | UserGroupIntro.vue:28 / UserGroupGuide.vue:44,49 / DetailMember.vue:128 / DetailGuide.vue:39,49 / EventOverview.vue:315,316,373,374 / NestOSFeatureDetail 等 | 补 `alt` |
| G1 图片 alt | SearchSoftwareCard.vue:108 / TheSigMeeting.vue:170 | 补 `alt` |
| J1 div@click | AppHeader.vue:157 (`<div class="icon" @click="menuPanel">`) 菜单开关 | 改 `<button class="icon" @click="menuPanel" aria-label="菜单">` |
| J1 div@click | HeaderTheme.vue:80 (`<div @click="changeTheme">`) 主题切换 | 改 `<button aria-label="切换主题">` |
| J1 div@click | HeaderLogin.vue:106 (`<div @click="login">`) 登录 | 改 `<button>` 或 `<a>` |
| J1 div@click | NavLink.vue:64 (`<div @click="linkClick">`) 导航项 | 若为导航用 `<a :href>`，否则 `<button>` |
| J1 div@click | HeaderNavMoblie.vue:96 (`<span @click="handleNavClick">`) | 改 `<button>` |
| J1 div@click | CookieReset.vue:15 (`<span @click="onClick">`) | 改 `<button>` |
| J1 div@click | FloatingButton.vue:439,603 / FloatingButtonEn.vue:381,531 | 改 `<button>` |
| J1 div@click | FilterableTableHeader.vue:337,338 / FilterableMb.vue:248,336,337 (reset/confirm/filter) | 改 `<OButton>` 或 `<button>` |
| J1 div@click | MarkdownImage.vue:46,60 (容器/关闭按钮) | 改 `<button>`，关闭按钮加 `aria-label="关闭"` |
| J1 div@click | TheBlog.vue:294,322,350 / TheNews.vue:283,311,339 (筛选面板项) | 改 `<button>` 或 `<a>` |
| J1 div@click | TheHonor.vue:173,258 (`<div @click="personalDetail">`) | 若跳详情用 `<a>`，否则 `<button>` |
| J1 div@click | SearchBanner.vue:288 / SearchResult.vue:379,414 / SearchHistoryMo.vue:331 / SigList.vue:651,890 / intelligenceIntro.vue:307,308 | 改 `<button>`（SigList:890 跳详情改 `<a>`） |
| J2/G6 控件无可访问名 | 全 src-new 无 `aria-label`（0 匹配） | 所有图标按钮（菜单/主题/关闭/搜索/放大等）补 `aria-label`；纯装饰 `<OIcon>` 补 `aria-hidden="true"` |
| B1 缺 h1 | TheHome.vue + HomeBanner.vue:118,121 (`<div class="banner-title">` 代替标题) | 首页主标题改 `<h1>`；建议 HomeBanner 标题用 `<h1>`，各楼层用 `<h2>` |
| B1 缺 h1 | 搜索页 (TheSearch/SearchResult)、sig-detail 等非 Banner 页 | 补页面级 `<h1>`（BannerLevel2/3 已含 h1，未用 banner 的页面需自行补） |
| H3 外链无 rel | AppFooter.vue:67 (`<a href="https://openatom.cn" target="_blank">`) | 加 `rel="noopener noreferrer"` |
| H3 外链无 rel | AppFooter.vue:155 (备案链接)、104 (友情链接) | 加 `rel="noopener noreferrer"` |
| H3 外链无 rel | HomeBanner.vue:130 (`<OButton target="_blank">` 外链) | OButton 不自动注入 rel，需显式 `rel="noopener noreferrer"` |
| H3 外链无 rel | TheMailingList.vue:103,106,109,116,118,119 (mailweb.openeuler.org) | 所有跨域外链补 `rel="noopener noreferrer"` |
| H3 外链无 rel | TheOnlineMeeting.vue:57 / TheYuanRong.vue:79 / EventDetail.vue:119,130 / EventOverview.vue:120,157,168,239,277,340 / HomeShowCase:222 / HomeSwiper:43 / HomeTrend:122,162 / TheShowCase:216,307 / FloatingButton:528,571,671 / SigList 多处 / TheSigDetail:291,326,349 等 | 所有 `target="_blank"` 跨域链接补 `rel="noopener noreferrer"`（内部同源链接也建议补 noopener） |

> 说明：经核对 `node_modules/@opensig/opendesign/es/link/OLink.vue.mjs` 与 `button/OButton.vue.mjs`，二者仅转发 `href/target`，**不自动注入 `rel`**，故所有省略 `rel` 的 `target="_blank"` 均为真实缺陷。

---

## ⚠️ Warn（警告）

| 维度 | 文件位置:行号 | 修改建议 |
| --- | --- | --- |
| A4 无 skip-nav | app/.vitepress/src/App.vue (布局外壳) | 在 `<AppHeader/>` 后首个元素加 `<a class="skip-link" href="#main">跳到主内容</a>`，main 加 `id="main" tabindex="-1"` |
| A1 lang 值 | config.ts:205,217 (`lang:'zh'`/`'en'`) | 建议用 `zh-CN`/`en`（功能可用，规范建议） |
| C2 footer 非地标 | AppFooter.vue:63 (`<div id="tour_footer" class="footer">`) | 改 `<footer>` 地标；quick-nav(80)/friendship-link(94) 改 `<nav aria-label="…">` |
| C2 nav 结构 | AppFooter.vue:85 `<ul class="navs">` 父级是 `<div class="category">` 而非 `<nav>` | 将每组链接用 `<nav>` 包裹并配标题 |
| C5 section | HomeDisplayZone/HomeIntro/HomePlayCommunity 等楼层用 `<div>` | 内容区块用 `<section>` + `<h2>` 标题 |
| B2 标题跳级 | TalentDemand.vue:20(h2)→25(h4)→27(h5) 跳过 h3 | 补 h3 层级或降级 h4→h3、h5→h4 |
| B2 标题跳级 | HomeDisplayZone.vue:32 (`<h4>`) 无 h2/h3 祖先 | 改 `<h2>` 或补上层标题 |
| B2 标题跳级 | SearchResult.vue:381,415 (`<h3>`) 未见父级 `<h2>` | 补 `<h2>` 搜索结果标题 |
| B2 对话框标题 | FloatingButton.vue:436 / FloatingButtonEn.vue:378 (`<h4>`) | 对话框首个标题建议 `<h2>` |
| I1 文件 input 无 label | HeaderSearch.vue:416 / SearchBanner.vue:318 / SearchHistoryMo.vue:324 (`<input type="file">`) | 加 `aria-label="上传图片"` 或关联 `<label>` |
| I6 placeholder 当 label | TheBlog/TheNews/EventLatest/TheShowCase/CVE/Compatibility/FloatingButton/HeaderSearch 等共 49 处仅 placeholder | 搜索/筛选项应配可见 `<label>` 或 `aria-label`，不可仅靠 placeholder |
| I2 无 required | 全库 0 处 `required`/`aria-required` | 表单必填项（如有）需标记 `required` |
| H4 mailto + target | AppFooter.vue:117 / TheBrand.vue:68 / TheMailingList.vue mailto 带 `target="_blank"` | mailto 无需新窗口，移除 `target="_blank"` |
| K6 移除焦点轮廓 | FloatingButton.vue:976,1295 / FloatingButtonEn.vue:896,1199 (`outline: none`) | 改用 `:focus-visible` 自定义轮廓，勿全局移除 |
| L2 ClientOnly 无降级 | AppHeader.vue:181 (包裹导航) / TheHome.vue:131 / MarkdownImage.vue:57 / NestOS/TheNestOS.vue:54 / SearchBanner:325 / 多 minisite 等共 ~20 处 | 为关键交互/内容提供 `#fallback` 占位，避免 SSR/禁用 JS 时空白 |

---

## ℹ️ Info（建议 / 通过项）

| 维度 | 说明 |
| --- | --- |
| K2/L3 装饰未隐 | 全 src-new 仅 1 处 `aria-hidden`（OSelect.vue:51 且为 CSS 选择器串）。装饰图标/图片建议统一加 `aria-hidden="true"`，避免屏阅读出噪声；切勿对可聚焦元素加 `aria-hidden`。 |
| F 表格语义 | src-new 无原生 `<table>`（统一用 `OTable`/`OFigure` 表格）。建议核查 OTable 是否提供 `<caption>`/`aria-label` 与 `th[scope]`，由组件层保证。 |
| D 文本级语义 ✅ | 未发现 `<i>`/`<b>` 滥用，图标统一走 `OIcon`/`OFigure`。 |
| E 列表语义 ✅ | 26 处 `<ul>/<ol>` 用法规范（AppFooter、HeaderNav、SummitIntroduce、SigMeetingOrgZh 的 `<ol>` 等）。建议术语-描述对用 `<dl>`。 |
| J3 tabindex ✅ | 全库 0 处 `tabindex`，无正向 tabindex 乱序聚焦。 |
| H5 空链 ✅ | 0 处 `href="javascript:void(0)"` / `href="#"`。 |
| K1 冗余 ARIA ✅ | 0 处 `role=`，无 `<button role="button">` 类冗余。 |

---

## 12 维度总览

| 维度 | 状态 | 主要问题 |
| --- | --- | --- |
| A 文档结构与语言 | ⚠️ | lang 已配置（zh/en）；无 skip-nav；无 `<main id>` 锚点 |
| B 标题层级 | ❌ | 首页缺 h1（div 代替）；多处跳级 |
| C 语义化区块 | ⚠️ | footer 用 div；导航/区块缺 nav/section；header 使用正确 |
| D 文本级语义 | ✅ | 无 i/b 滥用 |
| E 列表语义 | ✅ | ul/ol 规范 |
| F 表格语义 | ℹ️ | 无原生 table，依赖 OTable 组件语义 |
| G 图片与多媒体 | ❌ | ~50 处 img 缺 alt |
| H 链接可访问性 | ❌ | ~56 处 target=_blank 缺 rel（跨域有安全风险） |
| I 表单语义 | ⚠️ | 文件 input 无 label；placeholder 充当 label；无 required |
| J 按钮与交互 | ❌ | ~25 处 div/span/p @click；图标控件无可访问名 |
| K ARIA 与无障碍 | ⚠️ | 0 处 aria-label；outline:none 移除焦点 |
| L 隐藏/SSR | ⚠️ | ~20 处 ClientOnly 无 fallback |

---

## 修复优先级建议

1. **P0 安全/可访问性硬伤**：补 `rel="noopener noreferrer"`（跨域外链）；图标按钮补 `aria-label`；`<div @click>` 改 `<button>`。
2. **P1 内容可访问性**：批量补 `<img alt>`（装饰 `alt=""`，内容图语义描述）；首页补 `<h1>`。
3. **P2 结构语义**：AppFooter 改 `<footer>` + `<nav>`；补 skip-nav；列表/section 化。
4. **P3 规范打磨**：lang 用 `zh-CN`；focus-visible 替代 `outline:none`；ClientOnly 补 fallback。

---

*本报告基于静态模板审计，未运行屏阅实测。建议结合 axe/照读屏工具对 dist 产物做最终验证。*
