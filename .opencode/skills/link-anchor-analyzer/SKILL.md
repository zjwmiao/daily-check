---
name: link-anchor-analyzer
description: Analyze project for JavaScript-based navigation that should use HTML anchor tags instead. Use codegraph to find onClick+router.push, window.location.href, and other JS navigation patterns that hurt SEO/GEO crawlability.
---

# Link Anchor Analyzer

Detect navigation links implemented via JavaScript instead of HTML `<a href>`.

## Problem

JavaScript-based navigation hurts SEO/GEO:
- Crawlers can't discover links without executing JS
- AI systems (GEO) can't follow JS navigation
- Accessibility issues (no native link behavior)

## Patterns to Detect

### High Priority (Navigation Links)

| Pattern | Fix |
|---------|-----|
| `onClick={() => router.push('/path')}` | `<a href="/path">` |
| `onClick={() => navigateTo('/path')}` | `<a href="/path">` |
| `window.location.href = '/path'` | `<a href="/path">` |
| `@click="router.push('/path')"` | `<a href="/path">` |

### Medium Priority

- Links in cards/teasers
- "Read more" buttons
- Breadcrumb items

## Skip Rules

Do NOT report:

- **Legitimate JS navigation**:
  - Needs `confirm()` before redirect
  - Carries state/query params (`router.push({ path: '/detail', query: { id } })`)
  - Auth-gated navigation
  - Logout/login flows with special logic

- **Non-navigation elements**:
  - Form submit buttons
  - Modal triggers
  - Dropdown toggles
  - Delete/action buttons (not navigation)

## Output Format

The agent MUST output a JSON array at the end of the response:

```json
<!-- LINK_ANCHOR_RESULT -->
[
  {
    "file": "src/components/Header.vue",
    "line": 45,
    "code": "onClick={() => router.push('/about')}",
    "description": "导航链接使用 JS 跳转，应改为 <a href='/about'>",
    "severity": "high"
  }
]
```

**Fields**:
- `file`: Relative path from project root
- `line`: Line number in source file
- `code`: Snippet of problematic code (simplified)
- `description`: Problem description + fix suggestion
- `severity`: `high` (main navigation), `medium` (secondary links), `low` (edge cases)

If no issues, output empty array:

```json
<!-- LINK_ANCHOR_RESULT -->
[]
```