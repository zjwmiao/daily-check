# J — 按钮与交互元素

动作用 button，导航用 a，禁用 div 模拟交互元素。

## 检查项

### J1. 动作用 `<button>`，导航用 `<a>`
- ✅ `<button onclick="submit()">提交</button>`（动作）
- ✅ `<a href="/about">关于</a>`（导航）
- ❌ `<div onclick="submit()">提交</div>`（不可键盘聚焦、无语义）
- ❌ `<span onclick="...">`

### J2. `<button>` 有可访问名
- ✅ 按钮文本或 `aria-label`
- ❌ 空按钮 / 仅图标的 button 无 aria-label

### J3. 禁 `tabindex>0`
- ✅ 自定义元素用 `tabindex="0"`（加入 tab 序）
- ❌ `tabindex="3"`（>0 会强行改变自然 tab 顺序，破坏键盘导航）

### J4. 自定义交互组件补 ARIA role + keydown
- ✅ `<div role="button" tabindex="0" onclick="..." onkeydown="...">` （自定义按钮要处理回车/空格）
- ⚠️ 自定义组件无 role（屏阅不知是按钮）

### J5. 不冗余 ARIA
- ❌ `<button role="button">`（原生 button 已隐含 role=button）
- ❌ `<a role="link">`、`<nav role="navigation">`

## LLM 核对项
- `<div onclick>/<span onclick>` 是否应改 `<button>`
- `<button>` 是否缺可访问名
- `tabindex>0` 是否破坏键盘聚焦顺序
- `<button role="button">` 等冗余 ARIA

## 正反例
```html
<!-- ❌ -->
<div onclick="submit()">提交</div>
<span onclick="close()">×</span>
<button role="button">保存</button>
<a tabindex="5" href="/x">...</a>

<!-- ✅ -->
<button type="button" onclick="submit()">提交</button>
<button type="button" aria-label="关闭" onclick="close()">×</button>
<a href="/x">...</a>
```
