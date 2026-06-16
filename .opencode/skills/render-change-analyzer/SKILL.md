---
name: render-change-analyzer
description: Analyze git commits in workDir and output a JSON array of affected page paths. Call when user provides a workDir and asks to analyze rendering impact of recent commits. Output MUST be a JSON array of page pathnames wrapped in ```json block with <!-- RENDER_CHANGE_RESULT --> marker.
---

# Render Change Analyzer

Analyze git commits → identify changed files → trace dependencies → list affected pages.

## Workflow

1. **Get commit history**: `git log --oneline -N` (default N=5)
2. **List changed files**: `git diff --name-only HEAD~N..HEAD`
3. **Filter out irrelevant files** (see Skip Rules)
4. **Analyze dependencies** using codegraph (priority) or grep (fallback)
5. **Output**: categorized list of affected pages

## Skip Rules

### Always Exclude from Analysis

| Pattern | Reason |
|---------|--------|
| `.geo/**` | SEO/meta config |
| `*.config.ts`, `*.config.js` | Framework config |
| `**/@types/**`, `*.d.ts` | Type definitions |
| `tests/**`, `*.test.*`, `*.spec.*` | Test files |
| `.husky/**`, `.github/**` | CI/config |

Framework-specific config:
- VitePress: `app/.vitepress/config.ts`, `vite.config.ts`
- Nuxt: `nuxt.config.ts`, `nuxt.config.js`

### Content-Only Pages (Skip in Output)

Blog content changes are self-contained:

| Pattern | Reason |
|---------|--------|
| `**/blog/**/*.md`, `**/blog/**/*.vue` | Blog posts (content-only) |

If blog files changed, note "N blog pages edited (content-only, excluded)" without enumerating each.

### Global Layout Components (Skip in Output)

Changes to components shared across all pages (not page-specific content):

| Component Type | Example Patterns |
|----------------|------------------|
| Header/Navigation | `Header*.vue`, `Nav*.vue`, `AppHeader.vue` |
| Footer | `Footer*.vue`, `AppFooter.vue` |
| Floating elements | `Floating*.vue`, `BackTop*.vue`, `Cookie*.vue` |
| Sidebar | `Sidebar*.vue`, `SideNav*.vue` |
| Global modals | `Dialog*.vue` (global), `Modal*.vue` (global) |

**Why skip**: These components appear on every page uniformly. Changes don't affect specific page content—only global chrome. Note count in output but don't enumerate affected pages.

**Exception**: If a header/footer change breaks specific page layouts (e.g., new fixed header overlaps page hero), include those pages.

## Framework Detection

Check project root:
- `app/.vitepress/config.ts` → VitePress
- `nuxt.config.ts` or `pages/` → Nuxt

## Page Identification

See [VitePress patterns](references/vitepress.md) and [Nuxt patterns](references/nuxt.md).

## Output Format (Required)

The agent MUST output a JSON array at the end of the response:

\`\`\`json
<!-- RENDER_CHANGE_RESULT -->
["/about", "/docs/intro", "/zh/blog/"]
\`\`\`

- Array elements are page pathnames (without `.html` extension)
- Root page uses `/` or empty string
- If no pages affected, output empty array `[]`

### Excluded Items (Optional)

Before the JSON block, briefly note excluded items:

\`\`\`
Excluded: 5 blog pages (content-only), Header.vue/Footer.vue (global components)
\`\`\`