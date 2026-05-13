# GEO优化开发工作流

## 一、工作流概述

基于「可检索性 → 可信度 → 易读性」三维度，建立「问题发现 → 分析验证 → 修复 → 效果验证 → 再优化」的闭环。

核心流程

```
问题发现（geo-workflow）
    ↓
问题分析（本地诊断 + 归因）
    ↓
开发阶段（配置 SEO 元素）
    ↓
本地验证（开发服务器）
    ↓
线上验证（生产环境）
    ↓
GEO 效果追踪（geo-workflow）
    ↓
问题修复 → 再验证
```

---

## 二、工作流执行示例

### 示例 1：新页面开发完整流程

```
1. 开发新页面
    ↓
2. 配置 SEO 元素（脚本+skills结合）
   - Schema 配置（来源：页面内容）
   - TDK 配置（来源：页面内容）
   - 验证 llms.txt 自动包含（来源：页面内容）
   - ...
    ↓
3. 本地验证
   - 启动 pnpm dev
   - 本地验证（Sitemap 遍历）
   - 修复 Critical 问题
    ↓
4. 提交 PR → L1 验证（CI）
    ↓
5. 合并入主分支 → 部署
    ↓
6. 线上验证
   - 线上验证（Sitemap 遍历）
   - 确认配置已部署
    ↓
7. GEO 效果追踪（7-14 天后）
   - geo-workflow 评估 AI 引用率
   - 引用率 OK → 结束
   - 引用率低 → 返回修复
```

### 示例 2：已有页面 GEO 问题修复流程

```
1. geo-workflow 发现问题
   - 月度评估发现 P0/P1 问题
   - Issue #123: "首页未被 AI 引用"
    ↓
2. 问题分析（使用分析脚本）
   - 可检索性分析 → 可检索性分析
   - 可信度分析 → 可信度分析
   - 易读性分析 → 易读性分析
   - 归因：Schema 缺失 + TDK Description 过短
    ↓
3. 问题修复
   - Schema 配置（添加 Organization + FAQPage）
   - TDK 配置（优化 Description）
    ↓
4. 本地验证
   - 本地验证
   - Schema、TDK 问题已修复
    ↓
5. 提交 PR → CI 验证
    ↓
6. 合并 → 等待 7-14 天
    ↓
7. GEO 效果追踪
   - geo-workflow 周度回归
   - AI 引用率从 0% → 65%
   - Issue 标记 verified-improved → 关闭
```

---

## 三、GEO 优化维度

| 维度         | 目标          | 开发类改进                             | 内容类改进                        |
| ------------ | ------------- | -------------------------------------- | --------------------------------- |
| **可检索性** | AI 爬虫能发现 | 静态化、Schema、TDK、Sitemap、llms.txt | 补充重点页面                      |
| **可信度**   | AI 放心引用   | 过时页面标记                           | 结论前置、FAQ、数据表格、内链密度 |
| **易读性**   | AI 易理解     | 语义化标签                             | 数据表格、锚点链接                |

---

## 四、开发阶段

### 4.1 静态化页面

**验证方式**：

- 检查构建产物 `dist/` 是否为纯静态 HTML
- 通过双模抓取(HTTP vs Browser)对比内容差异(实现见 `scripts/checks/static-render.js`)

---

### 4.2 增加 Schema（JSON-LD）


**来源约束**：Schema 内容必须来源于页面本身（标题、描述、FAQ、发布日期等）

**Schema 类型（按页面类型）**：

| 页面类型  | Schema 类型                   | 必需字段                                      |
| --------- | ----------------------------- | --------------------------------------------- |
| 首页      | Organization + FAQPage        | name、url、logo、faq                          |
| 博客/新闻 | Article                       | headline、author、datePublished、dateModified |
| SIG 详情  | Organization + CollectionPage | name、description、member                     |
| 下载页    | SoftwareApplication           | name、version、downloadUrl                    |
| 迁移专区  | HowTo + FAQPage               | step、faq                                     |
| 用户案例  | CaseStudy                     | name、client、result                          |
| Q&A 页面  | FAQPage                       | question、answer                              |

---

### 4.3 完善 TDK


**来源约束**：TDK 内容必须来源于页面本身

- Title：来源于页面 H1 或 frontmatter.title
- Description：来源于页面首段摘要
- Keywords：来源于页面核心关键词提取

**标准**：

- Title：30-60 字符，关键词在前半部分
- Description：120-160 字符，包含关键信息和行动引导
- Keywords：3-5 个核心关键词

---

### 4.4 完善 Sitemap


**验证项**：

- 所有页面路径已包含
- lastmod 时间戳正确
- priority 合理分配（首页 1.0，重要页面 0.8，其他 0.5）

---

### 4.5 完善 robots.txt


**标准**：

- Allow 所有重要页面
- Disallow 无意义页面（如后台、临时页面）
- 指明 Sitemap 位置

---

### 4.6 完善 llms.txt 和 llms-full.txt


**来源约束**：内容必须来源于页面本身

- llms.txt：页面路径 + 标题 + 简要描述
- llms-full.txt：页面正文内容（自动提取）

**验证项**：

- 重要页面全部覆盖
- 内容结构清晰（标题、摘要、正文分段）
- 更新频率与页面更新同步

---

### 4.7 语义化页面标签


**标准**：

- H1 有且仅 1 个（页面主标题）
- H2-H6 层次清晰，无跳跃
- 使用 `<article>`、`<section>`、`<nav>` 等语义化标签
- 图片必须有 alt（描述性文本，包含关键词）

---

### 4.8 过时页面标记


**标准**：

- 在页面 frontmatter 标记 `archived: true`
- 添加警告提示：「本文档已过时，请查看最新版本」
- 在 sitemap 降低 priority 或排除

---

## 五、问题发现与分析阶段

### 5.1 问题发现（geo-workflow）

**触发时机**：geo-workflow 月度/周度评估

**输入**：

- `geo-workflow/assessments/openEuler/questions.json` — 问题集
- `geo-workflow/assessments/openEuler/{date}/scoring-results.json` — 评分结果

**输出**：

- GitCode Issue（带 label：`geo:p0/p1/p2`）
- Issue 内容：问题描述、AI 平台回答、引用率、严重级别

**问题类型**：

- P0：官方有内容但 AI 未引用（引用率 <75%）
- P1：官方无对应内容（需新增页面）

---

### 5.2 问题分析（三维度诊断）

**触发时机**：收到 geo-workflow 的 Issue

**实现**：本期落地的是"可检索性"分支(4 维度,见第十节)。完整三维度作为长期目标保留。流程入口:

- `scripts/fetch-geo-issues.js` — 取候选
- `scripts/run-analysis.js` — 批量跑 4 维度
- `scripts/generate-report.js` — 出报告

下面 5.3-5.6 保留原始三维度的判定标准与输出结构,作为后续可信度/易读性分支落地时的设计参考。

---

### 5.3 可检索性分析


**分析项**：

| 检查项     | 分析内容                            | 问题判定标准                |
| ---------- | ----------------------------------- | --------------------------- |
| 静态化     | HTML 是否可无 JS 渲染               | 需 JS 才能显示内容 → 问题   |
| Schema     | JSON-LD 是否存在、类型是否匹配      | 无 Schema 或类型错误 → 问题 |
| TDK        | Title/Description/Keywords 是否完整 | 缺失或长度超标 → 问题       |
| Sitemap    | 页面是否在 sitemap.xml              | 未包含 → 问题               |
| robots.txt | 页面是否被 Allow                    | Disallow → 问题             |
| llms.txt   | 页面是否在 llms.txt                 | 未包含 → 问题               |

**输出格式**：

```json
{
  "dimension": "discoverable",
  "issue_id": "123",
  "page_url": "https://www.openeuler.org/zh/",
  "problems": [
    {
      "category": "schema",
      "severity": "critical",
      "description": "无 Organization Schema",
      "expected": "Organization + FAQPage",
      "actual": "无 JSON-LD",
      "suggestion": "使用 Schema 配置 生成"
    },
    {
      "category": "tdk",
      "severity": "critical",
      "description": "Description 长度不足",
      "expected": "120-160 字符",
      "actual": "85 字符",
      "suggestion": "使用 TDK 配置 重新生成"
    }
  ],
  "score": 45
}
```

---

### 5.4 可信度分析


**分析项**：

| 检查项   | 分析内容                               | 问题判定标准              |
| -------- | -------------------------------------- | ------------------------- |
| 过时标记 | 是否标记过时页面                       | 过时但未标记 → 问题       |
| 结论前置 | 首段是否有定义句（150字内含数字+来源） | 无定义句 → 问题           |
| FAQ      | 是否有 FAQ 区块（5-8 个问题）          | 无 FAQ 或问题 <5 → 问题   |
| 数据表格 | 关键数据是否用表格呈现                 | 数据用段落而非表格 → 问题 |
| 内链密度 | 相关页面链接数量                       | 内链 <5 → 问题            |
| 数据出处 | 统计数字是否注明来源                   | 数字无来源 → 问题         |

**输出格式**：

```json
{
  "dimension": "trustworthy",
  "issue_id": "123",
  "page_url": "https://www.openeuler.org/zh/",
  "problems": [
    {
      "category": "faq",
      "severity": "critical",
      "description": "无 FAQ 区块",
      "expected": "5-8 个 FAQ",
      "actual": "0 个",
      "suggestion": "补充 FAQ，覆盖用户常见问题"
    },
    {
      "category": "definition",
      "severity": "important",
      "description": "首段缺少定义句",
      "expected": "150字内含具体数字+来源",
      "actual": "无定义句",
      "suggestion": "添加定义句：'openEuler 是...，截至2026年已有XXX家企业采用'"
    },
    {
      "category": "internal-links",
      "severity": "important",
      "description": "内链密度不足",
      "expected": "≥5 个相关页面链接",
      "actual": "2 个",
      "suggestion": "增加迁移指南、下载页面、SIG 页面等内链"
    }
  ],
  "score": 55
}
```

---

### 5.5 易读性分析


**分析项**：

| 检查项     | 分析内容                     | 问题判定标准                |
| ---------- | ---------------------------- | --------------------------- |
| H1 结构    | H1 数量是否唯一              | ≠1 → 问题                   |
| 标题层次   | H1-H6 是否有跳跃             | H1→H3 → 问题                |
| 图片 alt   | 图片是否有 alt               | 无 alt 或覆盖率 <95% → 问题 |
| 语义化标签 | 是否使用 article/section/nav | 全用 div → 问题             |
| 锚点链接   | 重要章节是否有锚点           | 无锚点 → 问题               |

**输出格式**：

```json
{
  "dimension": "readable",
  "issue_id": "123",
  "page_url": "https://www.openeuler.org/zh/",
  "problems": [
    {
      "category": "semantics",
      "severity": "critical",
      "description": "H1 数量错误",
      "expected": "1 个",
      "actual": "3 个",
      "suggestion": "检查标题结构，确保唯一 H1"
    },
    {
      "category": "alt",
      "severity": "important",
      "description": "图片 alt 覆盖率不足",
      "expected": "≥95%",
      "actual": "80%",
      "suggestion": "补充缺失的 alt 文本"
    }
  ],
  "score": 70
}
```

---

### 5.6 综合归因


**功能**：

- 合并三维度分析结果
- 生成综合归因报告
- 确定修复路径（工程类 vs 内容类）
- 打 Issue label

**输出格式**：

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEO 问题归因分析报告 — Issue #123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

页面: https://www.openeuler.org/zh/
问题: AI 未引用首页内容
引用率: 0%（P0）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
可检索性分析（得分: 45）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ [Critical] Schema 缺失
→ 无 Organization + FAQPage JSON-LD
→ 修复：Schema 配置

❌ [Critical] Description 过短
→ 85 字符（标准 120-160）
→ 修复：TDK 配置

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
可信度分析（得分: 55）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ [Critical] FAQ 缺失
→ 无 FAQ 区块
→ 修复：补充 FAQ 内容（需协作）

⚠️ [Important] 内链不足
→ 2 个（标准 ≥5）
→ 修复：增加相关页面链接

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
易读性分析（得分: 70）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ [Critical] H1 数量错误
→ 3 个（标准 1 个）
→ 修复：调整标题结构

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
修复路径
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

工程类修复（可自闭环）：

1. Schema 配置 → 添加 Organization + FAQPage
2. TDK 配置 → 优化 Description
3. 调整 H1 标题结构

内容类修复（需协作）：

1. 补充 FAQ 区块（5-8 个问题）
2. 增加内链（迁移指南、下载页、SIG 页）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 六、验证阶段

### 6.1 本地验证（开发服务器）

**触发时机**：开发完成后，提交 PR 前

**验证方式**：根据 Sitemap 遍历所有页面

**验证项**(本期已落地的 4 维度对应 `scripts/checks/`,其余 4 维度为未来路线):

| 开发项     | 验证内容                                | 当前实现                                 |
| ---------- | --------------------------------------- | ---------------------------------------- |
| 静态化     | 检查 HTML 是否可无 JS 渲染              | ✅ `scripts/checks/static-render.js`     |
| Schema     | JSON-LD 有效性、类型匹配                | ✅ `scripts/checks/schema.js`            |
| TDK        | Title/Description/Keywords 长度、关键词 | ✅ `scripts/checks/tdk.js`               |
| Sitemap    | URL 覆盖、lastmod、priority             | ✅ `scripts/checks/sitemap-inclusion.js` |
| robots.txt | 格式正确、Allow/Disallow 合理           | ⏳ 暂不实现(ADR-0003)                    |
| llms.txt   | 页面覆盖、内容来源正确                  | ⏳ 暂不实现(ADR-0003)                    |
| 语义化     | H1 数量、层次、alt 覆盖率               | ⏳ 未来路线                              |
| 过时标记   | 标记页面是否正确提示                    | ⏳ 未来路线                              |

**验证结果**：

- 按页面生成报告：`geo-audit/local/{page_path}-validation.md`
- 按严重级别分类：Critical（必须修复）、Important（建议）、Minor（可选）
- 修复清单：优先级排序

---

### 6.2 线上验证（生产环境）

**触发时机**：PR 合并后，部署完成

**验证方式**：根据 Sitemap 遍历所有页面（HTTP 模式）

**验证流程**：复用 6.1 同一套 `scripts/checks/*`,但抓取改用线上 URL(`fetchHttp`)。

**额外验证项（线上特有）**：

- HTTP 状态码（200）
- robots.txt 未阻止
- Sitemap.xml 包含
- llms.txt 包含
- 页面加载速度（可选）

**对比验证**：

- 对比本地验证 vs 线上验证
- 确认开发配置已正确部署

---

### 6.3 验证报告格式

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GEO 验证报告 — {page_path}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

验证时间: {timestamp}
验证模式: local / production

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
可检索性验证
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 静态化: HTML 可无 JS 渲染
✅ Schema: FAQPage JSON-LD 有效
❌ TDK: Description 长度 180 字符（超出标准）
✅ Sitemap: 已包含，priority 0.8
✅ robots.txt: Allow
✅ llms.txt: 已包含

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
易读性验证
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ H1: 1 个
❌ 图片 alt: 覆盖率 85%（标准 ≥95%）
⚠️  H2 层次: 有一处跳跃（H1 → H3）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
修复清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [Critical] Description 镀度超出标准
   → 操作：修改 tdks/zh.ts，缩短至 120-160 字符
   → 来源：重新从页面首段提取摘要

2. [Critical] 图片 alt 覆盖率不足
   → 操作：检查 Markdown 图片标签，补充 alt

3. [Important] H2 层次跳跃
   → 操作：调整标题结构，确保 H1→H2→H3
```

---

## 七、问题修复阶段

### 7.1 问题来源

**来源 1**：验证阶段发现的问题（本地/线上）
**来源 2**：geo-workflow 发现的问题（AI 未引用）

### 7.2 问题分类（按 analytics.md）

| 问题类型         | 修复方式  | 涉及文件                                |
| ---------------- | --------- | --------------------------------------- |
| **可检索性问题** | 工程修复  | Schema、TDK、Sitemap、llms.txt 配置文件 |
| **可信度问题**   | 内容修复  | 页面 Markdown、FAQ、数据表格            |
| **易读性问题**   | 工程+内容 | 标题结构、图片 alt、语义化标签          |

### 7.3 修复流程

**工程类问题**：

```
问题定位 → 使用对应脚本修复 → 本地验证 → 提交 PR
```

**内容类问题**：

```
问题定位 → 创建内容ISSUE→ SIG 协作 → 内容审核 → PR 合入
```

---

## 八、GEO 效果追踪阶段

### 8.1 触发时机

PR 合并后 7-14 天（等待 AI 索引更新）

### 8.2 验证方式

通过 geo-workflow 评估 AI 引用率

### 8.3 流程

```
geo-workflow 添加问题 → 填写 official_urls → 采样评分
    ↓
引用率 OK → 结束
    ↓
引用率低 → 分析原因 → 返回修复阶段
```

### 8.4 引用率低的原因

| 原因        | 归因维度 | 修复方向                 |
| ----------- | -------- | ------------------------ |
| Schema 缺失 | 可检索性 | 添加 Schema              |
| TDK 不优    | 可检索性 | 优化 TDK（关键词、描述） |
| 内容单薄    | 可信度   | 补充内容、FAQ、数据表格  |
| 无内链      | 可信度   | 增加相关页面链接         |
| 标签混乱    | 易读性   | 语义化改造               |

---

## 九、工具脚本清单

实际落地的脚本与产物清单见 [第十节 10.5 - 10.7](#105-关键脚本scripts)。

---

## 十、自动化(geo-develop 协调仓 + portal CI)

### 10.1 总体拓扑

```text
geo-workflow (GitHub) ──评估── 产出 P0/P1 issue + question.json
       │
       ▼
geo-develop (GitHub) ── 用户开 [GEO优化] issue
       │
       │ /analyze 评论 ──▶ geo-bot.yml#analyze job
       │                   ├─ fetch-geo-issues.js (取 P0 候选)
       │                   ├─ run-analysis.js     (4 维度分析)
       │                   ├─ generate-report.js  (报告评论)
       │                   └─ open-portal-issues.js (atomgit 开 issue)
       │
       │ /fix 评论 ─────▶ geo-bot.yml#fix job
       │                   ├─ plan-fix-runs.js     (按 community 拆分)
       │                   ├─ execute-fix-runs.js  (clone+opencode+PR)
       │                   └─ comment-fix-summary.js (回评)
       │
       ▼
openEuler-portal / mindspore-portal (AtomGit) ── 收 issue + PR
```

### 10.2 触发与解析约定

| 输入                          | 行为                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| Issue title `[GEO优化]`       | 遍历 geo-workflow 所有 P0 issue(openEuler/MindSpore 范围内)         |
| Issue title `[GEO优化]#42`    | 仅分析 geo-workflow 的 issue #42                                    |
| Issue comment `/analyze`      | 触发 `.github/workflows/geo-bot.yml` 的 `analyze` job                |
| Issue comment `/fix`          | 触发 `.github/workflows/geo-bot.yml` 的 `fix` job(前提:已有 analyze 制品) |

### 10.3 分析阶段(/analyze)产物

```text
geo-runs/{issue_number}/{YYYYMMDDTHHmmssZ}/
  ├─ candidates.json     ← fetch-geo-issues.js 输出
  ├─ analysis.json       ← run-analysis.js 输出 (4 维度结果)
  ├─ report.md           ← generate-report.js 输出 (评论正文 + 内嵌 fix-payload)
  └─ portal-issues.json  ← open-portal-issues.js 输出 (atomgit issue 记录)
```

`report.md` 末尾内嵌折叠的 `geo-analysis-payload v1` JSON 块,作为 /fix 的**真正信号源**(产物落盘只为审计,不作为 /fix 输入,见 ADR-0012)。产物 commit 到 geo-develop main 分支(ADR-0007),同时上传为 GitHub artifact(90d 保留)。

### 10.4 修复阶段(/fix)产物

```text
geo-runs/{issue_number}/fix-{YYYYMMDDTHHmmssZ}/
  ├─ fix-payload.json    ← fetch-fix-payload.js 从 issue 评论抽取的 payload
  ├─ fix-context-*.json  ← 给 opencode agent 的上下文(per community)
  └─ fix-results.json    ← execute-fix-runs.js 输出 (PR url + agent 输出)
```

### 10.5 关键脚本(scripts/)

| 脚本                            | 角色                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `fetch-geo-issues.js`           | 从 geo-workflow 拉取 P0 issue + question.json         |
| `analyze-discoverability.js`    | 单 URL → 4 维度 JSON(CLI + 库函数 analyzeUrl)        |
| `run-analysis.js`               | 批量 URL 分析,聚合到 analysis.json                    |
| `generate-report.js`            | analysis.json → Markdown 评论(末尾内嵌 fix-payload)  |
| `open-portal-issues.js`         | 调用 atomgit API,逐 community 在 portal 仓开 issue    |
| `fetch-fix-payload.js`          | 扫 issue 评论,提取最新带 marker 的 fix-payload JSON   |
| `execute-fix-runs.js`           | 读 payload → 内联 plan → clone portal → opencode → PR  |
| `comment-fix-summary.js`        | 回评到触发 issue + geo-workflow 原 issue              |
| `checks/{static-render,schema,tdk,sitemap-inclusion}.js` | 单维度判定逻辑                       |
| `lib/{html-fetch,atomgit-api,community-map}.js`          | 共用工具                              |

### 10.6 GitHub 资产

| 路径                                                | 角色                                       |
| --------------------------------------------------- | ------------------------------------------ |
| `.github/workflows/geo-bot.yml`                    | 单 workflow,`analyze` + `fix` 两个 job(各自 `if:` 过滤评论命令) |
| `.github/actions/atomgit-create-issue/`            | composite action,封装 AtomGit Issue API    |
| `.github/actions/atomgit-create-pr/`               | composite action,封装 push + PR           |
| `.github/actions/run-agent/`(沿用)                | opencode + glm5 调用器                     |
| `.github/agents/geo-fix-prompt.md`                 | opencode 的修复 prompt(严格白名单约束)   |

### 10.7 Secrets / Env

| 名称              | 用途                                                |
| ----------------- | --------------------------------------------------- |
| `GITHUB_TOKEN`            | 内置,只对当前 geo-develop 仓有效(评论、push)            |
| `GEO_GITHUB_TOKEN` | **必填**:PAT,读取 private 仓 geo-workflow 的 issue/contents |
| `ATOMGIT_TOKEN`           | **必填**:自定义 secret,用于 AtomGit issue / PR / push       |
| `ATOMGIT_API_BASE`        | 可选,默认 `https://api.atomgit.com`                          |
| `AI_MODEL`                | 可选,默认 `alibaba-cn/glm-5`                                 |
| `GEO_SKIP_BROWSER`        | 可选 repo variable,设 `true` 跳过 Browser 抓取               |
| `GEO_PORTAL_CACHE_DIR`    | 可选,portal 仓缓存根目录,默认 `~/.cache/geo-bot/portals`     |

### 10.8 决策记录

详见 `docs/decisions.md`。重要权衡:

- 协调仓为 geo-develop(ADR-0001)
- 数据走 GitHub Contents API,不 clone(ADR-0002)
- 仅 4 维度,放弃 robots.txt/llms.txt(ADR-0003)
- /analyze 自动开 portal issue(ADR-0004)
- /fix 用 opencode+glm5(ADR-0005)
- atomgit-create-pr 独立 action(ADR-0006)
- 制品入仓便于审计(ADR-0007)
- 删除旧脚本与三方 skills(ADR-0008)
- 合并为单 workflow 多 job(ADR-0009)
- geo-workflow 是 private 仓,需 `GEO_GITHUB_TOKEN`(ADR-0010)
- portal 仓持久缓存(ADR-0011)
- /fix 信号源:issue 评论内嵌 payload,不依赖文件系统(ADR-0012)

---
