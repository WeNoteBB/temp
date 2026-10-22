#!/bin/bash
# ============================================================
# PET 精读 · 收藏后端 —— 从本机发布到服务器
#
# 用法（在 pet-reading/ 目录下）：
#     bash deploy-api.sh --setup <公网IP>   第一次：先把服务器配好
#                                           （旁装 Node 22、systemd、nginx /api/ 反代）
#     bash deploy-api.sh <公网IP>           以后每次：上传 server/ 并重启
#
# 前端静态站还是走 deploy.sh，两者互不干扰。
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

APP_DIR=/opt/pet-api
NODE_DIR=/opt/node-v22

log()  { printf '\033[32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

SETUP=0
if [ "${1:-}" = "--setup" ]; then SETUP=1; shift; fi

IP="${1:-}"
[ -n "$IP" ] || die "用法: bash deploy-api.sh [--setup] <公网IP>"
command -v ssh >/dev/null || die "找不到 ssh —— 请在 git-bash 里跑，不要在 cmd/PowerShell 里跑"
[ -d server ] || die "当前目录没有 server/ —— 请在 pet-reading/ 目录下跑"

# ---------- SSH 连通性 ----------
log "连接 root@$IP …"
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$IP" true 2>/dev/null; then
  warn "免密登录没配好。下面这步只需要做一次（做完就不用再输密码）："
  cat <<'SSHKEY'

    ssh-keygen -t ed25519 -C "pet-deploy"      # 已有 key 就直接回车跳过
    cat ~/.ssh/id_ed25519.pub | ssh root@IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

SSHKEY
  echo "  现在继续 —— 接下来会提示你输服务器密码。"
  ssh -o ConnectTimeout=8 "root@$IP" true || die "连不上 $IP，检查 IP、安全组的 22 端口、以及能不能 ping 通"
fi
SSH="ssh root@$IP"

# ---------- 第一次：配服务器 ----------
if [ "$SETUP" -eq 1 ]; then
  log "上传服务器初始化脚本 …"
  scp -q "deploy/api-server-setup.sh" "root@$IP:/tmp/pet-api-setup.sh"
  # Windows 检出可能带 CRLF，去掉再跑
  $SSH "sed -i 's/\r$//' /tmp/pet-api-setup.sh && bash /tmp/pet-api-setup.sh" \
    || die "服务器初始化失败，看上面的报错"
fi

# ---------- 上传 server/ ----------
log "上传 server/ → $IP:$APP_DIR …"
# node_modules 不上传（服务器上 npm install 装）；.env 是服务器上的，不动
tar czf - --exclude=node_modules --exclude=.env server \
  | $SSH "mkdir -p $APP_DIR && tar xzf - -C $APP_DIR --strip-components=1" \
  || die "上传失败"

# ---------- 装依赖（--omit=dev：只装 express/mysql2） ----------
# 用旁装的 Node 22（不碰系统 node）。PATH 前置很关键：
# npm 脚本的 shebang 是 /usr/bin/env node，不这么做会跑到系统旧 node 上。
log "服务器上装依赖（npm install --omit=dev）…"
$SSH "test -x $NODE_DIR/bin/node || { echo '找不到 $NODE_DIR/bin/node —— 先跑一次 --setup'; exit 1; }; export PATH=$NODE_DIR/bin:\$PATH; cd $APP_DIR && npm install --omit=dev --no-audit --no-fund" >/dev/null \
  || die "npm install 失败 —— 到服务器上看： cd $APP_DIR && $NODE_DIR/bin/npm install --omit=dev"

# ---------- 数据库迁移（幂等：等级色表 / user 加列 / 错题表 / 词组库 / 通用视频课） ----------
# 失败不拦发布：服务本身能起，但注册/登录/错题会 500 —— 所以这里把话喊响。
log "数据库迁移（migrate.mjs，幂等）…"
if $SSH "test -f $APP_DIR/.env"; then
  $SSH "export PATH=$NODE_DIR/bin:\$PATH; cd $APP_DIR && node --env-file=.env migrate.mjs" \
    || warn "迁移没跑成功（多半是 .env 的 DB_PASS 还没填）。填好后手动补跑： ssh root@$IP 'cd $APP_DIR && /opt/node-v22/bin/node --env-file=.env migrate.mjs'"
else
  warn "$APP_DIR/.env 不存在 —— 先跑一次 --setup、把 DB_PASS 填上，再重新发版；本次跳过迁移"
fi

# ---------- 重启 + 健康检查 ----------
log "重启 pet-api …"
$SSH "systemctl restart pet-api && sleep 1 && systemctl is-active pet-api" \
  || die "pet-api 起不来： ssh root@$IP 'journalctl -u pet-api -n 50 --no-pager'"

echo
log "健康检查 http://$IP/api/health"
H=$(curl -s --max-time 8 "http://$IP/api/health" || true)
echo "  → ${H:-（没响应）}"

case "$H" in
  *'"ok":true'*)
    log "发布完成 —— 后端通了。前端的 /api 请求会自动打到它。"
    ;;
  *)
    warn "接口没通。按顺序查："
    echo "  1) 服务在不在：  ssh root@$IP 'systemctl status pet-api --no-pager'"
    echo "  2) 数据库密码填了没： ssh root@$IP 'vi /opt/pet-api/.env'（填完 systemctl restart pet-api）"
    echo "  3) MySQL 能不能连： ssh root@$IP 'cd /opt/pet-api && /opt/node-v22/bin/node --env-file=.env selftest.mjs'"
    ;;
esac

cat <<'NOTE'

 提示：收藏是「本地即时 + 补写队列」，学生断网也能点星，联网后自动补写；
       想看真库里的数据： mysql -uzhang -p bud -e "select * from user_word limit 5"
NOTE
