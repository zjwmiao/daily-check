---
name: issue-analyze
description: 分析AI发现性、SEO/GEO相关问题的issue，输出具体问题
compatibility: opencode
---

分析用户给定的一个AtomGit issue内容、owner、 repo、 issueID,issue一般会提及网页内容的AI发现性、SEO/GEO相关问题

1. 从issue内容中提取出涉及到的网页地址
2. 根据网页域名判断该网页属于哪个project(project相关信息、涉及到的网站域名等在`projects-config.yaml`文件中有配置)
3. 根据匹配到的project类型判断
    - 如果project是非docs类型,则结合issue内容以及网页具体内容做分析,主要的分析项是:1. TDK/JSON-LD, **确保TDK和JSON-LD信息完全由页面内容得来,不要出现任何不存在于页面内容中的信息**;例如project名为openGauss,TDK和JSON-LD中不要出现openEuler等其他社区名称, **除非在页面内容中有提及**。 2. sitemap,查找域名下是否存在sitemap文件以及sitemap中是否包含该页面地址; 3. 查找域名下是否存在 `/llms.txt` 和 `/llms-full.txt` ,以及这两个文件中是否有把该页面列出(查找文件中是否存在页面地址)。注意**只基于以上提到的三个维度去分析**不要有涉及到页面具体内容,项目业务代码,DOM结构相关的修改
    - 如果project是docs类型,则只查找sitemap、`/llms.txt` 和 `/llms-full.txt`是否存在以及这三个文件中是否覆盖该页面
4. 将TDK/JSON-LD/sitemap/llmstxt这几个维度中查出来的问题整理输出到 `/tmp/.cache/geo-bot/issue-analyze/exist-issues/{owner}-{repo}-{issueID}.md` 文件中
5. 在分析结果文件末尾,必须输出以下格式的 JSON block,供后续自动化流程解析:
**输出格式要求**
如果所有维度都没有问题,输出:
```json
<!-- ANALYZE_RESULT -->
{
  "has_problems": false,
  "source_issue_id": 123,
  "source_issue_url": "https://atomgit.com/owner/repo/issues/123",
  "analyzed_urls": ["https://www.openeuler.org/zh/..."],
  "message": "不涉及GEO基础配置问题,TDK配置正确,sitemap已收录,llms.txt已覆盖..."
}
```
如果发现有需要整改的问题,输出:
```json
<!-- ANALYZE_RESULT -->
{
  "has_problems": true,
  "source_issue_id": 123,
  "source_issue_url": "https://atomgit.com/owner/repo/issues/123",
  "target_owner": "openeuler",
  "target_repo": "openEuler-portal",
  "problems": [
    {
      "url": "https://www.openeuler.org/zh/security/",
      "dimension": "tdk",
      "description": "description 过短 (< 100字符),建议补充页面首段内容作为description"
    },
    {
      "url": "https://www.openeuler.org/zh/download/",
      "dimension": "schema",
      "description": "缺少 JSON-LD schema,该页面应添加Article或WebPage类型的schema"
    },
    {
      "url": "https://www.openeuler.org/zh/docs/",
      "dimension": "sitemap",
      "description": "sitemap.xml 中未收录该页面地址"
    },
    {
      "url": "https://www.openeuler.org/zh/community/",
      "dimension": "llms.txt",
      "description": "/llms.txt 和 /llms-full.txt 中均未列出该页面"
    }
  ]
}
```

**注意事项**
- JSON block 格式必须严格遵循示例：`<!-- ANALYZE_RESULT -->` 标记放在 ```json 代码块内第一行（紧跟 ```json 之后）
- 脚本会查找此标记来定位 JSON 内容，标记位置错误会导致解析失败
- `target_owner` 和 `target_repo` 是根据 URL 域名匹配 project 后得出的目标仓库,后续自动化流程会在此仓库创建 issue
- 如果 URL 涉及的域名不属于任何已配置的 project,则 `target_owner` 和 `target_repo` 应设为 null
- `dimension` 只能是 `tdk`, `schema`, `sitemap`, `llms.txt` 之一
- 获取网站sitemap的时候,可以先访问网站的`robots.txt`中的Sitemap字段,此sitemap可能是sitemap索引文件,根据索引文件内的sitemap条目递归的访问具体的sitemap内容
- 如果是docs类型的页面,不同文档版本的sitemap地址不同,例如 `https://docs.openeuler.org/zh/docs/24.03_LTS_SP2/.../` 的sitemap地址为 `https://docs.openeuler.org/docs/24.03_LTS_SP2/sitemap.xml`, **优先以`robots.txt`中的sitemap地址以及sitemap索引中列出的地址为准**
- 输出文件路径: `/tmp/.cache/geo-bot/issue-analyze/exist-issues/{owner}-{repo}-{issueID}.md`