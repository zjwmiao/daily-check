# 可落地措施

## 标题层级

- 每个页面应包含标题元素，只能有一个 `<h1>` ，且标题按层级顺序放置/嵌套，禁止跳过层级
- 标题需包含可见文本

**检查：** 构建产物？（用脚本）

来源：[MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements)，[Headings should have visible text content](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Text_labels_and_names#headings_should_have_visible_text_content)

## 链接

- `<a>` 元素且带 `href` 属性
- `href`属性指向实际网址，而非 `<a href="javascript:goTo('products')">`
- `<a>` 需包含内容文字
- 外链添加 `rel="noopener noreferrer"`

**检查：** 元素/组件绑定了点击事件用于跳转且无副作用（用AI查vue文件？）

来源：[Google 的 SEO 链接最佳实践](https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=zh-cn)

## 页面结构

页面整体结构由这些元素组成: `<header>`, `<main>`, `<article>/<section>`, `<footer>`

**检查：** 构建产物？（用脚本）

```html
<body>
  <header>
    <nav>
  </header>

  <main>
    <aside>
    <article>
    <section>
  </main>

  <footer>
    <nav>
  </footer>
</body>
```

来源：

https://github.com/bartwaardenburg/isagentready-skills/blob/HEAD/content-semantics/references/semantic-html-guide.md

https://html.spec.whatwg.org/multipage/sections.html

## `<img>` alt 属性

- 所有图片用 `alt` 添加解释文本
- 装饰性图片添加 `alt=""`，或用 CSS background images 替代
- 如果图片后跟着解释图片内容的文本，只需要加 `alt=""`，避免冗余

**检查：** 构建产物？（用脚本）

来源：[providing_text_alternatives_for_non-text_content](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable#guideline_1.1_%E2%80%94_providing_text_alternatives_for_non-text_content)

# 整改方式 / 与daily check串起来

目前daily check只有链接检查，缺失其他维度，需要**修改daily check workflow，添加以上维度的检查项**。

daily check新增定时任务（HTML语义化），每周执行，查出问题后以issue形式提出问题清单、整改建议，由人 / portal-workflow整改

标准/规范以检查项形式实现在daily check里，分4项，整改效果参考下一次（下周）的daily check结果

# 排期

| 优化项  | 时间 |
| --- | --- |
| 链接 | 2026/8/29? 2026/9/5 |
| `<img>` alt | 2026/9/5 |
| 标题层级 | 2026/9/12 |
| 页面结构 | 2026/9/20 |
