# F — 表格语义

数据表格用语义标签，屏阅器能播报行列关系；禁用表格做布局。

## 检查项

### F1. 表格有标题
- ✅ `<caption>季度销售数据</caption>` 或 `aria-label`
- ⚠️ 既无 caption 又无 aria-label，屏阅无法获知表意

### F2. `<th>` 带 `scope`
- ✅ `<th scope="col">月份</th>` / `<th scope="row">1月</th>`
- ❌ `<th>` 无 scope（屏阅不确定是行/列头）

### F3. 用 `<thead>/<tbody>/<tfoot>` 分组
- ✅ 表头在 thead，数据在 tbody
- ⚠️ 直接 `<tr>` 在 `<table>` 下，无分组

### F4. 不用表格做布局
- ❌ `<table>` 用于两栏布局（应用 flex/grid）
- 检测：表格仅 1 行多列、cell 含整页内容、`role="presentation"` 的 table

### F5. 合并单元格用 `scope` 标注
- ✅ `colspan/rowspan` 配 `scope="colgroup|rowgroup"`
- ⚠️ 仅用 colspan 无 scope

## LLM 核对项
- `<th>` 是否缺 `scope`
- 表格是否有 `<caption>` 或 `aria-label`
- 是否用表格做布局（table layout）

## 正反例
```html
<!-- ✅ -->
<table>
  <caption>季度销售</caption>
  <thead><tr><th scope="col">月份</th><th scope="col">销售额</th></tr></thead>
  <tbody><tr><th scope="row">1月</th><td>100万</td></tr></tbody>
</table>

<!-- ❌ th 无 scope，无 caption -->
<table>
  <tr><th>月份</th><th>销售额</th></tr>
  <tr><td>1月</td><td>100万</td></tr>
</table>
```
