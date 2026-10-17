#!/bin/bash
# ============================================================
# PET 精读 · 收藏后端 —— 服务器初始化
# （在服务器上以 root 跑；重复跑不会坏）
#
# 设计原则：**不动系统里已有的 Node**。
# 不少服务器上系统 node 是旧的（甚至 v12），还可能有别的服务在用；
# 所以 Node 22 旁装到 /opt/node-v22，只有 pet-api 用它。
# 兼容 Ubuntu（sites-available/default）和单文件 nginx.conf 两种布局。
#
# 做四件事：
#   1. 旁装 Node 22（nodejs.org / npmmirror 二选一）
#   2. 建 /opt/pet-api + 服务用户 petapi + systemd 单元 pet-api
#   3. nginx 加 /api/ 反代
#   4. 生成 .env 占位文件（DB_PASS 要 ssh 上去手工填）
# ============================================================
set -euo pipefail

APP_DIR=/opt/pet-api
NODE_DIR=/opt/node-v22
NODE_VER=v22.11.0
NODE_BIN=$NODE_DIR/bin/node
NPM_BIN=$NODE_DIR/bin/npm

log()  { printf '\033[32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 跑：sudo bash api-server-setup.sh"


# ---------- 1. Node 22（旁装，不碰系统 node） ----------
if [ -x "$NODE_BIN" ] && [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ] 2>/dev/null; then
  log "已装旁路 Node：$("$NODE_BIN" -v)（$NODE_DIR）✓"
else
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) die "不认识的 CPU 架构：$ARCH" ;;
  esac
  TAR="node-$NODE_VER-linux-$ARCH.tar.xz"
  log "下载 Node $NODE_VER（$ARCH）…"
  if ! curl -fsSL --max-time 300 "https://nodejs.org/dist/$NODE_VER/$TAR" -o "/tmp/$TAR"; then
    log "nodejs.org 不顺畅，换 npmmirror …"
    curl -fsSL --max-time 300 "https://npmmirror.com/mirrors/node/$NODE_VER/$TAR" -o "/tmp/$TAR" \
      || die "两个源都下不动 $TAR。可手工下载解包到 $NODE_DIR 再重跑本脚本。"
  fi
  rm -rf "$NODE_DIR.tmp" "$NODE_DIR"
  mkdir -p "$NODE_DIR.tmp"
  tar -xJf "/tmp/$TAR" -C "$NODE_DIR.tmp" --strip-components=1
  mv "$NODE_DIR.tmp" "$NODE_DIR"
  rm -f "/tmp/$TAR"
  [ -x "$NODE_BIN" ] || die "Node 解包失败"
  log "Node 旁装完成：$("$NODE_BIN" -v) → $NODE_DIR（系统 node 原样不动）"
fi


# ---------- 2. 目录 + 用户 + systemd ----------
install -d -m 755 "$APP_DIR"
id -u petapi >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin petapi
log "应用目录：$APP_DIR（服务以 petapi 身份运行）"

cat > /etc/systemd/system/pet-api.service <<UNIT
[Unit]
Description=PET reading favorites API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_BIN $APP_DIR/server.mjs
Restart=always
RestartSec=3
User=petapi
Group=petapi
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable pet-api >/dev/null 2>&1 || true
log "systemd 单元已写入：/etc/systemd/system/pet-api.service"


# ---------- 3. .env 占位 ----------
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
# PET 精读后端 · 环境变量（不进 git，权限 600）
# ⚠ MySQL 不在这台机器上时把 DB_HOST 改成它的地址；改完 systemctl restart pet-api
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=zhang
DB_PASS=在这里填密码
DB_NAME=bud
PORT=3001
HOST=127.0.0.1
PET_LEVEL=PET
SOURCE_TYPE=2
ENV
  chmod 600 "$APP_DIR/.env"
  warn "已生成 $APP_DIR/.env —— 记得填 DB_PASS： vi $APP_DIR/.env && systemctl restart pet-api"
else
  log ".env 已存在，保持不动"
fi


# ---------- 4. nginx /api/ 反代 ----------
if nginx -T 2>/dev/null | grep -q 'location /api/'; then
  log "nginx 已有 /api/ 反代，跳过"
else
  DEFAULT_SITE=/etc/nginx/sites-available/default
  if [ -f "$DEFAULT_SITE" ] && [ "$(grep -cE '^[[:space:]]*server_name[[:space:]]' "$DEFAULT_SITE" || true)" -eq 1 ]; then
    # Ubuntu 风格：往 default 站点（唯一的 server 块）里插 /api/ 反代
    [ -f "$DEFAULT_SITE.pet-backup" ] || cp "$DEFAULT_SITE" "$DEFAULT_SITE.pet-backup"
    sed -i '/^[[:space:]]*server_name[[:space:]]/a\
\
\t# PET 精读收藏接口 → 本机 pet-api（systemd 服务）\
\tlocation /api/ {\
\t\tproxy_pass http://127.0.0.1:3001;\
\t\tproxy_set_header Host $host;\
\t\tproxy_set_header X-Real-IP $remote_addr;\
\t}' "$DEFAULT_SITE"
    log "已给 $DEFAULT_SITE 插入 /api/ 反代（备份：$DEFAULT_SITE.pet-backup）"
  else
    warn "nginx 布局不认识（不是 Ubuntu default 单一 server 块）。请手工把这段加进站点配置："
    cat <<'TIP'

        location /api/ {
            proxy_pass http://127.0.0.1:3001;
            proxy_set_header Host $host;
        }

TIP
  fi
fi

nginx -t
systemctl reload nginx
log "nginx 已重载"


# ---------- 5. 拉起服务 + 自检 ----------
if [ -f "$APP_DIR/server.mjs" ]; then
  systemctl restart pet-api
  sleep 1
  if systemctl is-active --quiet pet-api; then
    log "pet-api 已在跑 ✓"
  else
    warn "pet-api 没起来，看日志： journalctl -u pet-api -n 30 --no-pager"
  fi
  echo "  本机看接口： curl -s http://127.0.0.1/api/health"
else
  log "代码还没上传（$APP_DIR/server.mjs 不存在）—— 跑 deploy-api.sh 上传后会自动起服务"
fi

echo
cat <<'NEXT'
============================================================
 服务器侧配好了。接下来：

  1. 填数据库密码（只需一次）：
       vi /opt/pet-api/.env          # 把 DB_PASS 改成真密码
       systemctl restart pet-api

  2. 回到自己的电脑，上传后端代码：
       bash deploy-api.sh <这台机器的公网IP>

  3. （可选）在服务器上跑真库自检（系统 node 是旧的，要用旁装的）：
       cd /opt/pet-api && /opt/node-v22/bin/node --env-file=.env selftest.mjs
============================================================
NEXT
