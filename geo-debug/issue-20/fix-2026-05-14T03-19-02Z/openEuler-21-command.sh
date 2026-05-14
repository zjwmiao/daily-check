#!/usr/bin/env bash
# 本次 agent 执行的真实命令(可在 runner 或本地 SSH 后直接跑)
# 前置:已 clone 对应 portal 仓 + opencode 已 config
set -eu

# 复现 cwd(以下二选一,看你环境)
# a) runner: cd ~/.cache/geo-bot/portals/openeuler-openEuler-portal
# b) 本地: git clone --depth=1 --branch=master \
#       https://oauth2:$ATOMGIT_TOKEN@atomgit.com/openeuler/openEuler-portal.git /tmp/openEuler-portal
#    cd /tmp/openEuler-portal

cat openEuler-21-prompt.txt | opencode run - --model alibaba-cn/glm-5 --agent build --dangerously-skip-permissions