# Progress

## GEO

<table>
  <thead>
    <tr>
      <th rowspan="2">分类</th>
      <th rowspan="2">社区/项目</th>
      <th rowspan="2">批次</th>
      <th colspan="6">可检索</th>
      <th rowspan="2">备注</th>
      <th>可信度</th>
      <th>易读性</th>
    </tr>
    <tr>
      <th>静态化页面</th>
      <th>完善 Robots.txt</th>
      <th>完善 Sitemap</th>
      <th>完善 TDK</th>
      <th>增加 Schema</th>
      <th>增加 llms.txt / llm-full.txt</th>
      <th>过时页面、停维文档做标记</th>
      <th>语义化页面标签</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="7">网站自建开源社区</td>
      <td>openEuler</td>
      <td>A</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>openEuler 文档站点</td>
      <td>A</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅<br/>title取自文稿本身，description、keywords暂不做配置</td><td>⏩<br/>文档站目前不加schema</td><td>✅</td>
      <td>sitemap通过 <a href=https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps?hl=zh-cn>sitemapindex</a> 的方式做合并、llms.txt/llms-full.txt直接合并文本</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>MindSpore</td>
      <td>A</td>
      <td>✅</td><td>✅</td><td>❌（文档sitemap未合并）</td><td>✅</td><td>✅</td><td>llms.txt: ✅，llms-full.txt: ❌缺失</td>
      <td>1. 文档站点 sitemap、llms.txt 的多版本合并策略需要再审视,并需要考虑过大的问题</td>
      <td></td>
      <td></td>
    </tr>
    <tr>
      <td>openGauss（待上线）</td>
      <td>B</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>llms.txt: ✅，llms-full.txt: ✅</td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>openGauss-docs（待上线）</td>
      <td>B</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅<br/>title取自文稿本身，description、keywords暂不做配置</td><td>✅</td><td>llms.txt: ✅，llms-full.txt: ✅</td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>openUBMC（待上线）</td>
      <td>B</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>llms.txt: ✅，llms-full.txt: ✅</td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>openUBMC-docs（待上线）</td>
      <td>B</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅<br/>title取自文稿本身，description、keywords暂不做配置</td><td>✅</td><td>llms.txt: ✅，llms-full.txt: ✅</td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>openFuyao</td>
      <td>B</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td rowspan="4">网站非自建开源社区</td>
      <td>CANN</td>
      <td>A</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>Mind 系列</td>
      <td>B</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>Boostkit</td>
      <td>B</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>HPCKit</td>
      <td>直接到位</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td rowspan="2">标准社区</td>
      <td>灵衢</td>
      <td>A</td>
      <td>❌</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td>
      <td></td><td></td><td></td>
    </tr>
    <tr>
      <td>HiFloat</td>
      <td>直接到位</td>
      <td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td><td>❌（待上线）</td>
      <td></td><td></td><td></td>
    </tr>
  </tbody>
</table>

**处理策略**

1. 文档暂不生成Descrption、Keywords、Schema；
2. 文案类如TDK、Schema初稿由AI生成，Skill限制说明来源只能是页面内容，然后开发review+运营review；
3. 确定性的逻辑需封装为[脚本](https://github.com/opensourceways/OpenDesignPlus/tree/dev/packages/plugins/src)

**检查标准**

1. robots.txt：可访问、未全站禁止爬虫访问、声明 Sitemap 地址
2. sitemap：可访问（从robots.txt取sitemap地址），随机抽取50个页面检查页面可访问
3. TDK/Schema：遍历sitemap条目，确保页面都有统一配置TDK/Schema（各社区项目跳过检查的路径匹配，在 `projects-config.yaml` 中配置）
4. llms.txt/llms-full.txt：都可以访问
5. SSR：body内容丰富、无Vue/Nuxt/React SPA空挂载点（从sitemap中抽10个页面检查）
