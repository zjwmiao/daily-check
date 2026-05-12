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
   - generate-schema.js（来源：页面内容）
   - optimize-tdk.js（来源：页面内容）
   - 验证 llms.txt 自动包含（来源：页面内容）
   - ...
    ↓
3. 本地验证
   - 启动 pnpm dev
   - validate-local.js（Sitemap 遍历）
   - 修复 Critical 问题
    ↓
4. 提交 PR → L1 验证（CI）
    ↓
5. 合并入主分支 → 部署
    ↓
6. 线上验证
   - validate-production.js（Sitemap 遍历）
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
   - analyze-discoverable.js → 可检索性分析
   - analyze-trustworthy.js → 可信度分析
   - analyze-readable.js → 易读性分析
   - 归因：Schema 缺失 + TDK Description 过短
    ↓
3. 问题修复
   - generate-schema.js（添加 Organization + FAQPage）
   - optimize-tdk.js（优化 Description）
    ↓
4. 本地验证
   - validate-local.js
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
- 使用 crawl.js 抓取，检查是否无需 JS 渲染

---

### 4.2 增加 Schema（JSON-LD）

**对应脚本**：`generate-schema.js`

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

**对应脚本**：`optimize-tdk.js`

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

**对应脚本**：`generate-sitemap.js`

**验证项**：

- 所有页面路径已包含
- lastmod 时间戳正确
- priority 合理分配（首页 1.0，重要页面 0.8，其他 0.5）

---

### 4.5 完善 robots.txt

**对应脚本**：`generate-robots.js`

**标准**：

- Allow 所有重要页面
- Disallow 无意义页面（如后台、临时页面）
- 指明 Sitemap 位置

---

### 4.6 完善 llms.txt 和 llms-full.txt

**对应脚本**：`generate-llms-txt.js`

**来源约束**：内容必须来源于页面本身

- llms.txt：页面路径 + 标题 + 简要描述
- llms-full.txt：页面正文内容（自动提取）

**验证项**：

- 重要页面全部覆盖
- 内容结构清晰（标题、摘要、正文分段）
- 更新频率与页面更新同步

---

### 4.7 语义化页面标签

**对应脚本**：无（开发时手动保证）

**标准**：

- H1 有且仅 1 个（页面主标题）
- H2-H6 层次清晰，无跳跃
- 使用 `<article>`、`<section>`、`<nav>` 等语义化标签
- 图片必须有 alt（描述性文本，包含关键词）

---

### 4.8 过时页面标记

**对应脚本**：`mark-obsolete.js`

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

**分析流程**：

```bash
# 1. 抓取问题页面
node geo-skills/scripts/crawl.js <URL> --mode=http --out=<issue-id> --format=html

# 2. 三维度分析
node geo-skills/scripts/analyze-discoverable.js <issue-id>.html --output=<issue-id>-discoverable.json
node geo-skills/scripts/analyze-trustworthy.js <issue-id>.html --output=<issue-id>-trustworthy.json
node geo-skills/scripts/analyze-readable.js <issue-id>.html --output=<issue-id>-readable.json

# 3. 综合归因
node geo-skills/scripts/synthesize-analysis.js \
  --discoverable=<issue-id>-discoverable.json \
  --trustworthy=<issue-id>-trustworthy.json \
  --readable=<issue-id>-readable.json \
  --output=<issue-id>-analysis.md
```

---

### 5.3 可检索性分析（analyze-discoverable.js）

**分析脚本**：`analyze-discoverable.js`

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
      "suggestion": "使用 generate-schema.js 生成"
    },
    {
      "category": "tdk",
      "severity": "critical",
      "description": "Description 长度不足",
      "expected": "120-160 字符",
      "actual": "85 字符",
      "suggestion": "使用 optimize-tdk.js 重新生成"
    }
  ],
  "score": 45
}
```

---

### 5.4 可信度分析（analyze-trustworthy.js）

**分析脚本**：`analyze-trustworthy.js`

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

### 5.5 易读性分析（analyze-readable.js）

**分析脚本**：`analyze-readable.js`

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

### 5.6 综合归因（synthesize-analysis.js）

**分析脚本**：`synthesize-analysis.js`

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
→ 修复：generate-schema.js

❌ [Critical] Description 过短
→ 85 字符（标准 120-160）
→ 修复：optimize-tdk.js

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

1. generate-schema.js → 添加 Organization + FAQPage
2. optimize-tdk.js → 优化 Description
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

**验证流程**：

```bash
# 1. 启动开发服务器
pnpm dev

# 2. 根据 Sitemap 遍历验证
node geo-skills/scripts/validate-local.js \
  --sitemap=dist/sitemap.xml \
  --dev-server=http://localhost:5173 \
  --mode=browser \
  --output=geo-audit/local/
```

**验证脚本（对应开发项）**：

| 开发项     | 验证脚本                | 验证内容                                |
| ---------- | ----------------------- | --------------------------------------- |
| 静态化     | `validate-static.js`    | 检查 HTML 是否可无 JS 渲染              |
| Schema     | `validate-schema.js`    | JSON-LD 有效性、类型匹配                |
| TDK        | `validate-tdk.js`       | Title/Description/Keywords 长度、关键词 |
| Sitemap    | `validate-sitemap.js`   | URL 覆盖、lastmod、priority             |
| robots.txt | `validate-robots.js`    | 格式正确、Allow/Disallow 合理           |
| llms.txt   | `validate-llms-txt.js`  | 页面覆盖、内容来源正确                  |
| 语义化     | `validate-semantics.js` | H1 数量、层次、alt 覆盖率               |
| 过时标记   | `validate-archived.js`  | 标记页面是否正确提示                    |

**验证结果**：

- 按页面生成报告：`geo-audit/local/{page_path}-validation.md`
- 按严重级别分类：Critical（必须修复）、Important（建议）、Minor（可选）
- 修复清单：优先级排序

---

### 6.2 线上验证（生产环境）

**触发时机**：PR 合并后，部署完成

**验证方式**：根据 Sitemap 遍历所有页面（HTTP 模式）

**验证流程**：

```bash
# 根据 Sitemap 遍历验证
node geo-skills/scripts/validate-production.js \
  --sitemap=https://www.openeuler.org/sitemap.xml \
  --mode=http \
  --output=geo-audit/deployed/
```

**验证脚本（同本地）**：

- 静态化、Schema、TDK、Sitemap、robots.txt、llms.txt、语义化、过时标记

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

### 开发类脚本

| 脚本                   | 功能            | 输入     | 输出                     |
| ---------------------- | --------------- | -------- | ------------------------ |
| `generate-schema.js`   | 生成 JSON-LD    | 页面内容 | jsonld/\*.ts             |
| `optimize-tdk.js`      | 优化 TDK        | 页面内容 | tdks/\*.ts               |
| `generate-robots.js`   | 生成 robots.txt | 配置规则 | robots.txt               |
| `generate-llms-txt.js` | 生成 llms.txt   | 页面内容 | llms.txt / llms-full.txt |
| `mark-obsolete.js`     | 标记过时页面    | 页面列表 | frontmatter 更新         |

### 分析类脚本

| 脚本                      | 功能          | 输入        | 输出              |
| ------------------------- | ------------- | ----------- | ----------------- |
| `crawl.js`                | 抓取页面 HTML | URL         | crawled/\*.html   |
| `analyze-discoverable.js` | 可检索性分析  | HTML        | discoverable.json |
| `analyze-trustworthy.js`  | 可信度分析    | HTML        | trustworthy.json  |
| `analyze-readable.js`     | 易读性分析    | HTML        | readable.json     |
| `synthesize-analysis.js`  | 综合归因分析  | 三维度 JSON | analysis.md       |

### 验证类脚本

| 脚本                     | 功能            | 输入                 | 输出               |
| ------------------------ | --------------- | -------------------- | ------------------ |
| `validate-local.js`      | 本地全量验证    | Sitemap + dev server | validation reports |
| `validate-production.js` | 线上全量验证    | Sitemap (URL)        | validation reports |
| `validate-static.js`     | 验证静态化      | HTML 文件            | report             |
| `validate-schema.js`     | 验证 Schema     | HTML + jsonld/\*.ts  | report             |
| `validate-tdk.js`        | 验证 TDK        | HTML + tdks/\*.ts    | report             |
| `validate-sitemap.js`    | 验证 Sitemap    | sitemap.xml          | report             |
| `validate-robots.js`     | 验证 robots.txt | robots.txt           | report             |
| `validate-llms-txt.js`   | 验证 llms.txt   | llms.txt + pages     | report             |
| `validate-semantics.js`  | 验证语义化      | HTML                 | report             |
| `validate-archived.js`   | 验证过时标记    | HTML                 | report             |

---

## 十、自动化（待对接Gitcode）

### CI 集成（本地验证自动化）

**文件**：`openEuler-portal/.gitcode/workflows/geo-validation.yml`

```yaml
on: [pull_request]
jobs:
  local-validation:
    steps:
      - pnpm dev &（启动开发服务器）
      - node geo-skills/scripts/validate-local.js
      - 生成验证报告
      - Critical 问题 → fail PR
```

### CI 集成（线上验证自动化）

**文件**：`openEuler-portal/.gitcode/workflows/production-validation.yml`

```yaml
on:
  push:
    branches: [main]
jobs:
  production-validation:
    steps:
      - 等待部署完成
      - node geo-skills/scripts/validate-production.js
      - 生成验证报告
      - 保存到 geo-audit/deployed/
```

---
