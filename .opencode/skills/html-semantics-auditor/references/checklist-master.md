# 12 维度速查表

LLM 逐项核对的浓缩清单。每项标 [维度代码]，详细判据见 `dimensions/<code>.md`。

## A — 文档结构与语言
- [A1] `<html lang>` 存在且正确（zh-CN / en / en-US）
- [A2] `<head>` 含 `<meta charset>` 与 `<meta name=viewport>`
- [A3] 每页有且仅有一个 `<main>` 地标
- [A4] 存在 skip-to-content 链接（跳转 `#main`）
- [A5] `<title>` 非空、跨页唯一
- [A6] 双语页面有 `<link rel=alternate hreflang>` 互相指向
- [A7] 外语片段用 `<span lang="en">` 标注

## B — 标题层级
- [B1] 每页有且仅有一个 `<h1>`
- [B2] 标题层级不跳级（h1→h2 合法，h1→h3 禁）
- [B3] 不为样式用标题（如用 h3 只为加大字号）
- [B4] 标题文本非空、跨级不重复
- [B5] 标题不嵌套在非内容容器中作布局

## C — 语义化区块
- [C1] 导航用 `<nav>`，非 `<div class="nav">`
- [C2] 页眉/页脚用 `<header>/<footer>`，非 div
- [C3] 侧边栏/相关内容用 `<aside>`
- [C4] 独立内容块用 `<article>`
- [C5] 相关内容分组用 `<section>` + 标题
- [C6] 带说明的图片/图表用 `<figure>+<figcaption>`
- [C7] 联系信息用 `<address>`
- [C8] 时间用 `<time datetime>`

## D — 文本级语义
- [D1] 强调用 `<em>/<strong>`，非 `<i>/<b>`（除非纯样式无语义）
- [D2] 缩写用 `<abbr title>`
- [D3] 引用：行内 `<q>`，块级 `<blockquote cite>`
- [D4] 作品标题用 `<cite>`
- [D5] 代码用 `<code>`，预格式化 `<pre>`
- [D6] 高亮 `<mark>`，删除/插入 `<del>/<ins>`
- [D7] 上下标 `<sup>/<sub>`

## E — 列表语义
- [E1] 无序 `<ul>`、有序 `<ol>`，不用 `<div>` 加 bullet
- [E2] 术语-描述列表用 `<dl>/<dt>/<dd>`
- [E3] 列表嵌套结构正确
- [E4] 不用 `<br>` 模拟列表项换行

## F — 表格语义
- [F1] 表格有 `<caption>` 或 `aria-label`
- [F2] `<th>` 带 `scope="col|row"`
- [F3] 用 `<thead>/<tbody>/<tfoot>` 分组
- [F4] 不用表格做布局（table layout）
- [F5] 合并单元格用 `scope` 标注

## G — 图片与多媒体
- [G1] `<img>` 必有 `alt`（内容图非空，装饰图 `alt=""`）
- [G2] 不用图片做文字（img of text）
- [G3] 复杂图加文字描述（相邻段落或 `longdesc`）
- [G4] `<video>/<audio>` 提供字幕 `<track>`
- [G5] `<iframe>` 有 `title`
- [G6] 图标按钮有 `aria-label` 或 `alt`

## H — 链接可访问性
- [H1] `<a>` 有可访问名（文本/aria-label/aria-labelledby），禁空链接
- [H2] 避免"点击这里/了解更多/here"等无上下文链接文本
- [H3] 外部链接 `target="_blank"` 配 `rel="noopener noreferrer"`
- [H4] 链接到非 HTML 资源（PDF/下载）加视觉提示
- [H5] 禁 `href="javascript:void(0)"`，用 `<button>` 替代

## I — 表单语义
- [I1] `<input>` 关联 `<label>`（for/id 或包裹）
- [I2] 必填字段 `required` 或 `aria-required="true"`
- [I3] `<button>` 显式 `type`（避免默认 submit 误触）
- [I4] 分组用 `<fieldset>/<legend>`
- [I5] 错误提示 `aria-describedby` + `role="alert"`
- [I6] 占位符不替代 label

## J — 按钮与交互
- [J1] 动作用 `<button>`，导航用 `<a>`，禁 `<div onclick>`
- [J2] `<button>` 有可访问名
- [J3] 禁 `tabindex>0`（避免乱序聚焦）
- [J4] 自定义交互组件补 ARIA role + keydown 处理
- [J5] 不冗余 ARIA（如 `<button role="button">`）

## K — ARIA 与无障碍
- [K1] 原生优先——能用原生语义就别加 ARIA
- [K2] `aria-hidden="true"` 用于装饰元素对屏阅隐藏
- [K3] 视觉隐藏文本用 `.sr-only` 类，不用 `display:none`（屏阅不可见）
- [K4] 动态内容用 `aria-live` 通告
- [K5] 信息不单靠颜色传递（另查对比度）
- [K6] 焦点可见——不全局 `outline:none`

## L — 隐藏与 SSR/ClientOnly
- [L1] `display:none` 屏阅不可见；`visibility:hidden` 仍占位不可见；`aria-hidden` 语义隐藏
- [L2] `<ClientOnly>`/`<client-only>` 内容仅客户端渲染，应有 fallback 降级占位
- [L3] `aria-hidden` 不应用于可聚焦元素（会误隐藏键盘焦点）
