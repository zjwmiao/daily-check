---
name: issue-analyze
description: 分析AI发现性、SEO/GEO相关问题的issue，输出具体问题
compatibility: opencode
---

分析用户给定的一个 AtomGit issue 内容，针对其中涉及的 URL 进行 GEO 配置检查。分析流程分为两个阶段：**程序化检查** 和 **LLM 语义分析**。

## 分析流程

### Phase 1: 程序化检查（自动执行）

此阶段由脚本自动执行，无需 LLM 参与。检查项：

1. **sitemap 覆盖检查**：
   - 从 robots.txt 提取 sitemap 地址
   - 递归解析 sitemap index
   - 检查目标 URL 是否被 sitemap 收录

2. **llms.txt 覆盖检查**：
   - 检查 `/llms.txt` 和 `/llms-full.txt` 是否存在
   - 检查目标 URL 是否在这两个文件中被列出

3. **TDK/Schema 存在性检查**（仅非 docs 项目）：
   - 根据 URL pathname 定位配置文件路径
   - 检查 `.geo/tdks/{pathname}/index.json` 是否存在
   - 检查 `.geo/jsonld/{pathname}/index.json` 是否存在

### Phase 2: LLM 语义分析（仅对非 docs 项目 + 已有配置）

只有满足以下条件才执行此阶段：
- 项目类型为 `portal`（非 docs）
- URL 存在 TDK 或 Schema 配置文件

**语义分析要求**：

1. **内容一致性检查**：
   - 确保 TDK 和 JSON-LD 信息完全由页面内容得来
   - 不要出现任何不存在于页面内容中的信息
   - 例如 project 名为 openGauss，TDK/JSON-LD 中不要出现 openEuler 等其他社区名称（除非页面内容中有提及）

2. **内容质量检查**：
   - description 是否过长/过短（建议 100-200 字符）
   - keywords 是否覆盖页面核心内容
   - JSON-LD schema 类型是否合适（Article/WebPage/Product 等）

### docs 与非 docs 项目差异

根据 `projects-config.yaml` 中的 `project_type` 字段判断：

| 项目类型 | 检查范围 |
|---------|---------|
| `docs` | 只执行 Phase 1（sitemap + llms.txt） |
| `portal` | Phase 1 + Phase 2（存在配置时做语义分析） |

## URL 匹配与项目识别

1. 从 issue 内容中提取所有 URL
2. 根据 URL 域名匹配 `projects-config.yaml` 中的 `home` 字段
3. 未匹配到的 URL 记录为警告，跳过检查

## 输出格式要求

### 无问题时的输出

```json
<!-- ANALYZE_RESULT -->
{
  "has_problems": false,
  "source_issue_id": 123,
  "source_issue_url": "https://atomgit.com/owner/repo/issues/123",
  "analyzed_urls": ["https://www.openeuler.org/zh/..."],
  "warnings": [
    { "url": "https://unknown-domain.com/...", "message": "URL 域名未匹配到已知项目" }
  ],
  "message": "所有 GEO 配置检查通过"
}
```

### 有问题时的输出

```json
<!-- ANALYZE_RESULT -->
{
  "has_problems": true,
  "source_issue_id": 123,
  "source_issue_url": "https://atomgit.com/owner/repo/issues/123",
  "target_owner": "openeuler",
  "target_repo": "openEuler-portal",
  "analyzed_urls": ["https://www.openeuler.org/zh/security/"],
  "problems": [
    {
      "url": "https://www.openeuler.org/zh/security/",
      "dimension": "sitemap",
      "description": "sitemap.xml 中未收录该页面",
      "source": "program"
    },
    {
      "url": "https://www.openeuler.org/zh/download/",
      "dimension": "llms.txt",
      "description": "/llms.txt 和 /llms-full.txt 中均未列出该页面",
      "source": "program"
    },
    {
      "url": "https://www.openeuler.org/zh/about/",
      "dimension": "tdk-quality",
      "description": "description 包含无关的 openEuler 社区名称，页面内容未提及",
      "source": "llm"
    }
  ]
}
```

## 问题维度说明

| dimension | 来源 | 说明 |
|-----------|------|------|
| `sitemap` | program | URL 未被 sitemap 收录 |
| `llms.txt` | program | URL 未在 llms.txt 中列出 |
| `tdk` | program | 缺少 TDK 配置文件 |
| `schema` | program | 缺少 JSON-LD Schema 配置文件 |
| `tdk-quality` | llm | TDK 内容与页面不匹配或质量问题 |
| `schema-quality` | llm | Schema 内容与页面不匹配或类型不合适 |

## 输出文件路径

分析结果写入：`/tmp/.cache/geo-bot/issue-analyze/exist-issues/{owner}-{repo}-{issueID}-result.md`

**注意事项**：
- JSON block 格式必须严格遵循示例：`<!-- ANALYZE_RESULT -->` 标记放在 ```json 代码块内第一行
- `target_owner` 和 `target_repo` 是根据 URL 域名匹配 project 后得出的目标仓库
- 如果 URL 涉及的域名不属于任何已配置的 project，则 `target_owner` 和 `target_repo` 应设为 null
- 获取网站 sitemap 时，优先从 `robots.txt` 的 Sitemap 字段获取地址