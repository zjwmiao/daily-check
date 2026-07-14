# D — 文本级语义

行内文字的语义标签，区别"外观"与"含义"。

## 检查项

### D1. 强调用 `<em>/<strong>` 而非 `<i>/<b>`
- ✅ `<em>`（强调，语句重音）、`<strong>`（重要性）
- ⚠️ `<i>` 仅用于斜体无语义场景（图标字体、术语变体）；`<b>` 仅用于无强调语义的粗体（如关键词提取）
- 默认：见到 `<i>/<b>` 提示考虑 `em/strong`

### D2. 缩写用 `<abbr title>`
- ✅ `<abbr title="World Wide Web">WWW</abbr>`
- ❌ `<abbr>` 无 `title`

### D3. 引用
- ✅ 行内引用 `<q>`，块级引用 `<blockquote cite="https://...">`
- ⚠️ `<blockquote>` 缺 `cite`

### D4. 作品标题用 `<cite>`
- ✅ `<cite>《openEuler 安装指南》</cite>`
- ⚠️ 用 `<i>` 表书名（应用 `<cite>`）

### D5. 代码
- ✅ 行内 `<code>`，多行 `<pre><code>`
- ✅ 变量 `<var>`，键盘 `<kbd>`，输出 `<samp>`

### D6. 标记/删除/插入
- ✅ 高亮 `<mark>`，删除 `<del>`，插入 `<ins>`
- ⚠️ 用 `<span style="background:yellow">` 替代 `<mark>`

### D7. 上下标
- ✅ `<sup>`/`<sub>`（如 x²、H₂O）
- ⚠️ 用 `<span class="sup">` 替代

## LLM 核对项
- `<i>/<b>` 是否应改 `<em>/<strong>`
- `<abbr>` 是否缺 title
- `<blockquote>` 是否缺 cite
- 行内/块级引用是否用 `<q>/<blockquote>`，作品标题是否用 `<cite>`，代码是否用 `<code>/<pre>`

## 正反例
```html
<!-- ❌ -->
<i>重要</i> 内容，<u>下划线</u> 表示强调

<!-- ✅ -->
<strong>重要</strong> 内容，<em>强调</em> 表示重音
```
