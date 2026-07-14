# A — 文档结构与语言

文档级骨架与语言属性。影响 SEO、屏阅器导航、国际化。

## 检查项

### A1. `<html lang>` 存在且正确
- ✅ `<html lang="zh-CN">` 或 `<html lang="en">`
- ❌ 无 `lang` 属性
- ❌ `lang` 值与页面实际语言不符（中文页标 `lang="en"`）

### A2. `<head>` 含 charset 与 viewport
- ✅ `<meta charset="utf-8">`（或 `<meta http-equiv="Content-Type">`）
- ✅ `<meta name="viewport" content="width=device-width, initial-scale=1">`
- ❌ 缺 viewport → 移动端缩放异常

### A3. 每页有且仅有一个 `<main>` 地标
- ✅ `<main>` 包裹主内容，每页一个
- ❌ 多个 `<main>` 或无 `<main>`
- ℹ️ 可用 `<main id="main">` 配 skip-nav

### A4. 存在 skip-to-content 链接
- ✅ 首个可聚焦元素是 `<a href="#main" class="skip-link">跳到主内容</a>`
- ❌ 无 skip-nav（屏阅用户每页都要跳过 header）
- ℹ️ 可视觉隐藏，聚焦时显现

### A5. `<title>` 非空、跨页唯一
- ✅ 每页 `<title>` 描述性、非空
- ❌ 空 `<title>` 或全站相同 `<title>`

### A6. 双语页面 hreflang
- ✅ 中文页含 `<link rel="alternate" hreflang="en" href=".../en/...">`，反之亦然
- ✅ 含 `hreflang="x-default"`
- ⚠️ 双语站点缺 hreflang 互指

### A7. 外文片段 `<span lang>`
- ✅ `<p>欢迎使用 <span lang="en">dashboard</span> 面板</p>`
- ⚠️ 整段外文未标注 `lang`（屏阅会按主语言读）

## LLM 核对项
- 跨页/入口文件核查 `<html lang>`、`<head>` 的 charset/viewport、`<main>`、`<title>`、hreflang、skip-nav 链接
- `<html lang>` 在每页顶部，Read 文件头即可判
- 外文片段是否用 `<span lang>` 标注
