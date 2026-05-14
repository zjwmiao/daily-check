# Debug 工具

## 文件

| 文件 | 用途 |
| --- | --- |
| `runner-probe.sh` | SSH 到 runner 后跑,验证 opencode + glm-5 + portal cache 真实速度(含心跳输出) |
| `gen-sample-fix-prompt.js` | 复刻 `execute-fix-runs.js` 里 prompt 的拼装逻辑,产出真实样本 |
| `sample-fix-prompt.txt` | 上面脚本生成的样本(默认基于 openEuler#21),用于本地复现 opencode 行为 |

## 复现 opencode 一次 /fix 的步骤

```bash
# 1. 确保本地有 opencode + glm-5 config
opencode --version

# 2. clone openEuler-portal(或用已有 cache)
git clone --depth=1 https://oauth2:$ATOMGIT_TOKEN@atomgit.com/openeuler/openEuler-portal.git /tmp/portal
cd /tmp/portal

# 3. 直接用仓库里的样本 prompt 喂给 opencode
cat <repo>/scripts/debug/sample-fix-prompt.txt | opencode run - \
  --model alibaba-cn/glm-5 \
  --agent build \
  --dangerously-skip-permissions
```

预期:agent 会 Glob/Grep/Read 找到 sitemap 配置,Edit 文件加 priority 配置,最后 Write `output.md`(本地实测 ~5min)。

## 重新生成样本(换不同 issue)

```bash
# 用默认上下文(openEuler#21 sitemap 问题)
node scripts/debug/gen-sample-fix-prompt.js

# 或传一个真实的 fix-context.json
node scripts/debug/gen-sample-fix-prompt.js --context=/path/to/fix-context.json
```
