# K — ARIA 与无障碍

第一性原则：**能用原生语义就别加 ARIA**。ARIA 是补丁，不是首选。

## 检查项

### K1. 原生优先
- ✅ 用 `<button>`（已隐含 role=button），而非 `<div role="button">`
- ✅ 用 `<nav>`（已隐含 role=navigation），而非 `<div role="navigation">`
- ⚠️ 给原生元素加它已有的 role 即冗余（见 J5）

### K2. `aria-hidden="true"` 用于装饰元素
- ✅ 装饰性图标/分隔符 `aria-hidden="true"`
- ⚠️ 但不能用于可聚焦元素（见 L3）

### K3. 视觉隐藏文本用 `.sr-only` 类，不用 `display:none`
- ✅ `.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }`
- ❌ `display:none` 屏阅不可见（用于真正隐藏）；`visibility:hidden` 屏阅也不可见
- ℹ️ `.sr-only`（或 `.visually-hidden`）是屏阅可见、视觉隐藏的标准做法

### K4. 动态内容用 `aria-live`
- ✅ `<div aria-live="polite">` 通告异步更新（搜索结果、计数）
- ✅ `aria-live="assertive"` 用于紧急（如错误）
- ⚠️ 动态插入内容无 aria-live，屏阅不知有更新

### K5. 信息不单靠颜色传递
- ⚠️ 错误仅用红色，成功仅用绿色（色盲用户无法区分）
- ✅ 颜色 + 图标/文字（如"✓ 成功"、"⚠ 错误"）

### K6. 焦点可见
- ✅ 保持默认 outline，或自定义 `:focus-visible` 样式
- ❌ 全局 `outline: none` 无替代（键盘用户看不到焦点）

## LLM 核对项
- `outline:none` 是否无替代（焦点不可见）
- 原生元素是否加了它已有的 role（冗余 ARIA，如 `<button role="button">`）
- 视觉隐藏是否误用 `display:none`（应 `.sr-only`）
- 装饰元素是否 `aria-hidden`，动态内容是否 `aria-live`

## 正反例
```html
<!-- ❌ -->
<button role="button">保存</button>          <!-- 冗余 ARIA -->
<div role="navigation">...</div>             <!-- 应用 <nav> -->
<span style="display:none">辅助文本</span>    <!-- 屏阅不可见 -->
*:focus { outline: none }                     <!-- 无替代 -->

<!-- ✅ -->
<button>保存</button>
<nav>...</nav>
<span class="sr-only">辅助文本</span>
*:focus-visible { outline: 2px solid var(--o-color-primary); }
```
