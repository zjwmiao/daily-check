---
name: html-semantics-auditor
description: 审计 HTML 结构语义化：标签语义、标题层级、图片 alt、链接/表单/列表/表格语义、ARIA 无障碍、按钮 vs 链接。按 12 维度输出问题报告。触发词：审计 HTML 语义化 / audit semantic html / 语义化审查 / 标题层级 / 图片 alt 缺失 / a11y 检查 / semantic html review / accessibility audit。
license: Apache-2.0
allowed-tools: Glob, Grep, Read, Write, Task
metadata:
  author: openEuler-portal
  version: "4.1.0"
  tags:
    - html
    - semantics
    - accessibility
    - a11y
    - audit
  triggers:
    - "审计 HTML 语义化"
    - "audit semantic html"
    - "语义化审查"
    - "标题层级"
    - "图片 alt 缺失"
    - "a11y 检查"
    - "semantic html review"
    - "accessibility audit"
---

# HTML Semantics Auditor

按 12 个维度审计 HTML 结构语义化，输出问题报告。

## Workflow

1. **发现文件**：`**/*.{vue,md,html,jsx,tsx}`，跳过 `node_modules`/`dist`/`.nuxt`/`.output`/`public` 等构建/依赖目录
2. **逐文件核对**：Read 文件，对其中的 HTML 结构（`.vue` 的 `<template>`、`.md` 的标题/图片/链接、`.html`/JSX 的标签）按 12 维度核对
3. **按维度输出报告**：每维度列 `file:line` + 描述 + 建议，附 ❌ Error / ⚠️ Warn / ℹ️ Info 分级

各维度判据见 [references/dimensions/](./references/dimensions/)（含 pass/fail 判据 + 正反例 + LLM 核对项），速查见 [references/checklist-master.md](./references/checklist-master.md)。

## 12 维度总览

| 维度 | 文件 | 关键检查点 |
|------|------|-----------|
| A 文档结构与语言 | [A](./references/dimensions/A-document-structure.md) | `<html lang>`；charset/viewport；单 `<main>`；skip-nav；`<title>`；hreflang；外文 `<span lang>` |
| B 标题层级 | [B](./references/dimensions/B-heading-hierarchy.md) | 每页仅一个 `<h1>`；不跳级；不为样式用标题；标题非空 |
| C 语义化区块 | [C](./references/dimensions/C-landmark-sectioning.md) | `<nav>/<header>/<footer>/<aside>/<article>/<section>/<figure>+<figcaption>/<address>/<time>` 取代 `<div class="nav">` |
| D 文本级语义 | [D](./references/dimensions/D-text-level-semantics.md) | `em/strong` 替 `i/b`；`<abbr title>`；`<q>/<blockquote cite>`；`<cite>`；`<code>/<pre>`；`<mark>/<del>/<ins>` |
| E 列表语义 | [E](./references/dimensions/E-list-semantics.md) | `ul/ol/dl` 替 div+bullet；`dl/dt/dd`；嵌套正确；不用 `<br>` 模拟列表 |
| F 表格语义 | [F](./references/dimensions/F-table-semantics.md) | `<caption>`/aria-label；`<th scope>`；`thead/tbody/tfoot`；禁表格做布局 |
| G 图片与多媒体 | [G](./references/dimensions/G-image-media-a11y.md) | `<img>` 必 `alt`；不用图做文字；`<video>/<audio>` 字幕 track；`<iframe title>`；图标按钮 aria-label |
| H 链接可访问性 | [H](./references/dimensions/H-link-a11y.md) | 有可访问名；禁"点击这里"；外链 `target=_blank` 配 `rel`；禁 `href=javascript:` |
| I 表单语义 | [I](./references/dimensions/I-form-semantics.md) | input 关联 label；必填 `required`；button 显式 `type`；`fieldset/legend`；错误 `aria-describedby+role=alert` |
| J 按钮与交互 | [J](./references/dimensions/J-button-vs-link.md) | 动作用 button、导航用 a，禁 `<div onclick>`/`<div @click>`；禁 `tabindex>0`；禁冗余 ARIA |
| K ARIA 与无障碍 | [K](./references/dimensions/K-aria-a11y.md) | 原生优先再上 ARIA；`aria-hidden` 隐藏装饰；视觉隐藏用 `.sr-only`；动态内容 `aria-live`；不全局 `outline:none` |
| L 隐藏与 SSR/ClientOnly | [L](./references/dimensions/L-hidden-ssr-clientonly.md) | `display:none`/`visibility:hidden`/`aria-hidden` 差异；`<ClientOnly>` 降级；`aria-hidden` 不挂可聚焦元素 |

## 输出格式

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTML 语义化审计报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
扫描: N 文件

汇总: ❌ Error: N  |  ⚠️ Warn: N  |  ℹ️ Info: N

### ❌ Error（严重）

| 维度 | 文件位置:行号 | 修改建议 |
| --- | --- | --- |
| ... | ... | ... |

### ⚠️ Warn（警告）

| 维度 | 文件位置:行号 | 修改建议 |
| --- | --- | --- |
| ... | ... | ... |

### ℹ️ Info（建议）

| 维度 | 文件位置:行号 | 修改建议 |
| --- | --- | --- |
| ... | ... | ... |
```

## Reference Materials

- [12 维度速查表](./references/checklist-master.md)
- [各维度详解](./references/dimensions/) — A 至 L 每维度一文件

## Related Skills

- `meta-tags-optimizer` — TDK 优化（本 skill 不评 TDK）
- `schema-markup-generator` — JSON-LD 生成（本 skill 只查既有结构）
- `vue-best-practices` — Vue 类型/模板最佳实践，与本 skill（语义层面）互补
