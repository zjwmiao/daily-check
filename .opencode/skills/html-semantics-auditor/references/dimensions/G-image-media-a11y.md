# G — 图片与多媒体可访问性

图片必须有文本替代，多媒体需字幕，否则视障用户无法感知。

## 检查项

### G1. `<img>` 必有 `alt`
- ✅ 内容图：`<img src="chart.png" alt="2024 年度活跃度趋势图">`（非空 alt）
- ✅ 装饰图：`<img src="divider.png" alt="">`（空 alt 显式声明"装饰，忽略我"）
- ❌ 无 `alt` 属性（屏阅会读出文件名 src）
- ⚠️ alt 为空需确认是否真为装饰图

### G2. 不用图片做文字
- ❌ `<img src="button.png" alt="下载">`（应为 `<button>下载</button>`）
- 检测：alt 含短动词，疑似图片按钮

### G3. 复杂图加文字描述
- ✅ 复杂图表旁配段落描述，或 `aria-describedby`
- ⚠️ 仅靠简短 alt 不足以描述复杂图

### G4. `<video>/<audio>` 提供字幕
- ✅ `<video><track kind="captions" src="caption.vtt" ...></video>`
- ❌ 视频无 track 字幕（听障无法获知对话）

### G5. `<iframe>` 有 `title`
- ✅ `<iframe title="YouTube 视频：openEuler 介绍" src="...">`
- ❌ 无 title（屏阅只读到"框架"）

### G6. 图标按钮有可访问名
- ✅ `<button aria-label="搜索"><svg>...</svg></button>`
- ❌ 图标按钮无可访问名（屏阅读"按钮"无内容）

## LLM 核对项
- `<img>` 是否无 alt 或 alt 为空（空 alt 需确认是否装饰图）
- `<iframe>` 是否缺 title
- `<video>/<audio>` 是否缺字幕 `<track>`
- 图标按钮是否有可访问名（aria-label）

## 正反例
```html
<!-- ❌ -->
<img src="chart.png">
<iframe src="https://youtube.com/..."></iframe>
<button><svg>...</svg></button>

<!-- ✅ -->
<img src="chart.png" alt="2024 年度活跃度趋势图">
<iframe title="openEuler 介绍视频" src="https://youtube.com/...">
<button aria-label="搜索"><svg>...</svg></button>
```
