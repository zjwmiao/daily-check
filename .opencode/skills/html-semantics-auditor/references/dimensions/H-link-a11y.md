# H — 链接可访问性

链接必须有可访问名，且文本应有上下文意义。

## 检查项

### H1. `<a>` 有可访问名
- ✅ 有链接文本，或 `aria-label`/`aria-labelledby`
- ❌ 空链接 `<a href="..."></a>`（屏阅读出 URL 无意义）
- ❌ 仅含 `<img>` 但 img 无 alt

### H2. 避免无上下文链接文本
- ❌ "点击这里"、"了解更多"、"查看更多"、"here"、"click here"、"read more"
- ✅ "下载 openEuler 24.03"、"阅读安装指南"
- 检测：链接文本脱离上下文无法判断目标

### H3. 外部链接 `target="_blank"` 配 `rel="noopener noreferrer"`
- ✅ `<a href="https://example.com" target="_blank" rel="noopener noreferrer">`
- ❌ `target="_blank"` 无 rel（安全漏洞 + 性能问题）

### H4. 非页面资源链接加视觉提示
- ✅ PDF/下载链接加图标或文字标注
- ⚠️ 纯文件链接无标识，用户不知会下载

### H5. 禁 `href="javascript:void(0)"`
- ❌ `<a href="javascript:void(0)" onclick="...">`（应改用 `<button>`，链接是导航而非动作）

## LLM 核对项
- `href="javascript:..."` 应改用 `<button>`
- 空链接（无可访问名）
- 通用链接文本（点击这里/了解更多/here/...）
- `target="_blank"` 是否配 `rel="noopener noreferrer"`（已带的无需改，仅查缺 rel 的）

## 正反例
```html
<!-- ❌ -->
<a href="javascript:void(0)" onclick="doX()">点我</a>
<a href="report.pdf" target="_blank">报告</a>  <!-- 缺 rel -->
<a href="/about"></a>                           <!-- 空链接 -->

<!-- ✅ -->
<button onclick="doX()">执行</button>
<a href="report.pdf" target="_blank" rel="noopener noreferrer">下载报告 (PDF)</a>
<a href="/about">关于 openEuler</a>
```
