#!/usr/bin/env bash
# 在 runner 上本地跑这个脚本,验证 opencode + glm-5 + portal cache 的真实速度
# 使用:
#   1. SSH 到 runner (geo-develop / portal-x86)
#   2. cd 到任意目录
#   3. ATOMGIT_TOKEN=<your_token> bash <(curl -sL <raw url of this file>)
#   或者把这个脚本拷过去直接跑:bash runner-probe.sh

set -e

REPORT() { echo "[$(date -u +%H:%M:%S)] $*"; }

PORTAL_DIR="${PORTAL_DIR:-$HOME/.cache/geo-bot/portals/openeuler-openEuler-portal}"
TOKEN="${ATOMGIT_TOKEN:?ATOMGIT_TOKEN 未设}"
REMOTE="https://oauth2:${TOKEN}@atomgit.com/openeuler/openEuler-portal.git"

REPORT "🔧 opencode 版本: $(opencode --version 2>/dev/null || echo 'missing')"
REPORT "🔧 node 版本: $(node --version)"

# 1) clone / refresh portal
if [ ! -d "$PORTAL_DIR/.git" ]; then
  REPORT "📥 portal cache 不存在,首次 clone(--depth=1) ..."
  T0=$(date +%s)
  git clone --depth=1 --branch=master "$REMOTE" "$PORTAL_DIR"
  REPORT "✅ clone 完成,耗时 $(( $(date +%s) - T0 ))s"
else
  REPORT "♻️  portal cache 已存在,fetch + reset"
  T0=$(date +%s)
  ( cd "$PORTAL_DIR" \
    && git remote set-url origin "$REMOTE" \
    && git fetch --depth=1 origin master \
    && git reset --hard origin/master \
    && git clean -fdx )
  REPORT "✅ refresh 完成,耗时 $(( $(date +%s) - T0 ))s"
fi

REPORT "📊 portal 文件数: $(find $PORTAL_DIR -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l) (ts/vue/js: $(find $PORTAL_DIR -type f \( -name '*.ts' -o -name '*.vue' -o -name '*.js' \) -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l))"

# 2) 写一个最小化测试 prompt:让 agent 改 sitemap 配置(跟真实 fix 任务一致)
WORK=/tmp/runner-probe-$$
mkdir -p $WORK
cat > $WORK/prompt.txt <<'EOF'
你是一个保守的代码修改 agent。任务:为 vulnerability-reporting 页面在 sitemap 配置里加 priority 0.7。

## 上下文

{
  "portal": {"owner":"openeuler","repo":"openEuler-portal","work_dir":"PLACEHOLDER_WORK_DIR"},
  "problems":[
    {"severity":"critical","dimension":"sitemap_inclusion","description":"URL 未被 sitemap 收录","url":"https://www.openeuler.org/zh/security/vulnerability-reporting/","suggestion":"将该 URL 加入 sitemap 配置,priority 0.7"}
  ]
}

请在 PLACEHOLDER_WORK_DIR 内执行修复,并将处理清单写入 PLACEHOLDER_WORK_DIR/output.md。
EOF
sed -i.bak "s|PLACEHOLDER_WORK_DIR|$PORTAL_DIR|g" $WORK/prompt.txt && rm $WORK/prompt.txt.bak

REPORT "🚀 启动 opencode (model=alibaba-cn/glm-5, agent=build, --dangerously-skip-permissions)"
REPORT "    prompt size: $(wc -c < $WORK/prompt.txt) chars"

T0=$(date +%s)
( cd "$PORTAL_DIR" && cat $WORK/prompt.txt | opencode run - \
    --model alibaba-cn/glm-5 \
    --agent build \
    --dangerously-skip-permissions ) &
OC_PID=$!

# 每 30s 打一行心跳
while kill -0 $OC_PID 2>/dev/null; do
  sleep 30
  REPORT "[heartbeat +$(( $(date +%s) - T0 ))s] opencode 还在跑..."
done

wait $OC_PID
EXIT=$?
DUR=$(( $(date +%s) - T0 ))
REPORT "=== opencode 退出 code=$EXIT 总耗时 ${DUR}s ==="
[ -f "$PORTAL_DIR/output.md" ] && REPORT "📝 output.md: $(wc -c < $PORTAL_DIR/output.md) bytes" || REPORT "⚠ output.md 未产生"
rm -rf $WORK
