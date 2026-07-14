# I — 表单语义

表单控件必须有可访问的 label，错误提示要可被屏阅感知。

## 检查项

### I1. `<input>` 关联 `<label>`
- ✅ `<label for="name">姓名</label><input id="name">` 或 `<label>姓名 <input></label>`
- ❌ `<input>` 无 label，仅有 placeholder（屏阅无法获知字段名）
- ❌ label 与 input 无 for/id 关联

### I2. 必填字段标注
- ✅ `required` 或 `aria-required="true"`
- ⚠️ 仅视觉用 `*` 标红，屏阅无感知

### I3. `<button>` 显式 `type`
- ✅ `<button type="button">取消</button>` / `<button type="submit">提交</button>`
- ❌ 无 type（默认 submit，可能误触发表单）

### I4. 分组用 `<fieldset>/<legend>`
- ✅ `<fieldset><legend>联系信息</legend>...</fieldset>`
- ⚠️ 相关输入未分组，屏阅无法播报组名

### I5. 错误提示可被屏阅感知
- ✅ `aria-describedby="error-msg"` + `<div id="error-msg" role="alert">` 
- ❌ 错误信息仅视觉显示（红色文本），屏阅不知有错

### I6. 占位符不替代 label
- ❌ `<input placeholder="请输入姓名">` 无 label（placeholder 是提示不是名称，提交后清空）
- ✅ label + placeholder 共存

## LLM 核对项
- `<button>` 是否缺 type（默认 submit 可能误触）
- `<input>` 是否关联 `<label>`（for/id 或包裹）
- 必填字段是否标注 `required/aria-required`
- 分组是否用 `<fieldset>/<legend>`，错误提示是否 `aria-describedby + role="alert"`
- placeholder 是否替代了 label

## 正反例
```html
<!-- ❌ -->
<input placeholder="姓名">  <!-- 无 label -->
<button>取消</button>         <!-- 无 type，默认 submit -->
<span class="error" style="color:red">必填</span>  <!-- 屏阅不可知 -->

<!-- ✅ -->
<label for="name">姓名</label>
<input id="name" required aria-describedby="name-err">
<button type="button">取消</button>
<div id="name-err" role="alert">姓名为必填</div>
```
