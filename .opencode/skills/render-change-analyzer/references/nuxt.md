# Nuxt Page Identification

## Page Files

`.vue` files in:
- `pages/**/*.vue`
- `app/pages/**/*.vue` (Nuxt 3)

## File → URL Mapping

| File | URL |
|------|-----|
| `pages/index.vue` | `/` |
| `pages/about.vue` | `/about` |
| `pages/[param].vue` | `/<param>` |

## Component Dependencies

Pages may:
- Import components: `import X from '~/components/X.vue'`
- Use auto-imports (Nuxt 3): `<X />` without import
- Use layouts: `definePageMeta({ layout: 'custom' })`

## Dependency Analysis (Priority: codegraph)

**Primary method**: Use codegraph for accurate dependency tracing.

| Task | Codegraph Command |
|------|-------------------|
| Find component callers | `codegraph callers <ComponentName>` |
| Explore component + related files | `codegraph explore "<ComponentName>"` |
| Read file + dependents | `codegraph node <file>` |

**Fallback**: Use grep when codegraph unavailable or for quick searches.

```bash
grep -r "import.*ComponentName" pages/**/*.vue
grep -r "<ComponentName" pages/**/*.vue
grep -r "layout:\s*'layoutName'" pages/**/*.vue
```

## Content-Only Pages (Skip in Output)

`**/blog/**` — blog post changes don't affect other pages, only note count.