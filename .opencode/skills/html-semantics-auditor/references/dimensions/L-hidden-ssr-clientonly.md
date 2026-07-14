# L — 隐藏与 SSR/ClientOnly

隐藏方式影响屏阅可见性；客户端渲染组件的内容运行时才生成。

## 检查项

### L1. 三种隐藏的语义差异
| 方式 | 视觉 | 屏阅 | 占位 | 用途 |
|------|------|------|------|------|
| `display: none` | 不可见 | 不可见 | 不占位 | 真正隐藏 |
| `visibility: hidden` | 不可见 | 不可见 | 占位 | 临时隐藏 |
| `aria-hidden="true"` | 可见 | 不可见 | 占位 | 装饰元素对屏阅隐藏 |

- ⚠️ 用 `display:none` 隐藏"对屏阅很重要但视觉不显示"的内容（应用 `.sr-only`，见 K3）

### L2. `<ClientOnly>` / 客户端渲染内容
- 源码中 `<ClientOnly>`/`<client-only>` 等组件内容在源码层可见（会被扫到），但仅客户端渲染
- ✅ 应提供 `#fallback` 插槽或降级占位
- ℹ️ 审计时知悉该部分运行时才渲染；若需审真实 DOM 用 `webapp-testing` skill

### L3. `aria-hidden` 不应用于可聚焦元素
- ❌ `<button aria-hidden="true">`（屏阅隐藏但键盘仍能聚焦，焦点丢失）
- ✅ 装饰元素 `aria-hidden="true"`，可聚焦元素用 `tabindex="-1"` 配合隐藏

## LLM 核对项
- `aria-hidden="true"` 是否挂在 a/button/input/iframe/video 等可聚焦元素上（会误隐藏键盘焦点）
- 是否用 `display:none` 隐藏"屏阅重要但视觉不显"的内容（应 `.sr-only`）
- 三种隐藏（`display:none`/`visibility:hidden`/`aria-hidden`）是否误用

## 正反例
```html
<!-- ❌ aria-hidden 挂在可聚焦元素 -->
<button aria-hidden="true">×</button>

<!-- ✅ -->
<span aria-hidden="true">×</span>   <!-- 装饰，不可聚焦 -->
```
