# E — 列表语义

用语义列表标签取代 div + bullet，屏阅器能播报"列表，3 项"。

## 检查项

### E1. 无序/有序列表用 `<ul>/<ol>`
- ✅ `<ul><li>苹果</li><li>香蕉</li></ul>`
- ❌ `<div class="list"><div class="item">• 苹果</div>...</div>`
- ❌ `<p>• 苹果<br>• 香蕉</p>`

### E2. 术语-描述列表用 `<dl>/<dt>/<dd>`
- ✅ `<dl><dt>RAM</dt><dd>随机存取存储器</dd>...</dl>`
- ❌ 用 `<ul>` + 加粗术语 + 描述

### E3. 列表嵌套结构正确
- ✅ `<ul>` 内嵌 `<li>`，`<li>` 内可再嵌 `<ul>`
- ❌ `<ul>` 直接嵌 `<ul>`（应嵌在 `<li>` 内）

### E4. 不用 `<br>` 模拟列表项
- ❌ `<p>项一<br>项二<br>项三</p>`
- ✅ 用 `<ul>/<ol>`

## LLM 核对项
- "div class=list/item" + bullet 模式是否应改 `<ul>/<ol>`
- 连续 `<br>` 模拟列表项是否应改列表标签
- 术语-描述是否用 `<dl>/<dt>/<dd>`

## 正反例
```html
<!-- ❌ -->
<div class="features">
  <div class="feat">• 高性能</div>
  <div class="feat">• 安全</div>
</div>

<!-- ✅ -->
<ul class="features">
  <li>高性能</li>
  <li>安全</li>
</ul>
```
