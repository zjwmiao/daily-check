# VitePress Page Identification

## Page Files

`.md` files in locale directories:
- `app/zh/**/*.md`, `app/en/**/*.md`
- Or root-level `**/*.md` (single-language)

## Page → Component Mapping

### Layout in frontmatter
```yaml
layout: TheHome
```

### Direct import
```vue
<script setup>
import TheHome from "~@/views/home/TheHome.vue"
</script>
<TheHome />
```

### Dynamic routes
Files with brackets like `[param].md` match multiple URLs.

## Dependency Analysis (Priority: codegraph)

**Primary method**: Use codegraph for accurate dependency tracing.

| Task | Codegraph Command |
|------|-------------------|
| Find component callers | `codegraph callers <ComponentName>` |
| Explore component + related files | `codegraph explore "<ComponentName>"` |
| Read file + dependents | `codegraph node <file>` |

**Fallback**: Use grep when codegraph unavailable or for quick searches.

```bash
grep -r "import.*ComponentName" app/**/*.md
grep -r "<ComponentName" app/**/*.md
grep -r "layout:\s*ComponentName" app/**/*.md
```

## Content-Only Pages (Skip in Output)

`**/blog/**` — blog post changes don't affect other pages, only note count.