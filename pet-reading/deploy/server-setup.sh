#!/bin/bash
# ============================================================
# PET 精读 —— 阿里云 ECS 服务器初始化
# 只在第一次部署时跑一次，重复跑不会坏。
#
# 用法（在服务器上，root 身份）：
#     bash server-setup.sh
#
# 做四件事：装 nginx → 关掉自带默认站点 → 写本站配置 → 放行防火墙
# ============================================================
set -euo pipefail

WEBROOT=/var/www/pet-reading
DIST=$WEBROOT/dist
CONF=/etc/nginx/nginx.conf

log() { printf '\033[32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 跑：sudo bash server-setup.sh"


# ---------- 1. 装 nginx ----------
if command -v nginx >/dev/null 2>&1; then
  log "nginx 已装：$(nginx -v 2>&1)"
else
  log "安装 nginx …"
  dnf install -y nginx
fi
systemctl enable --now nginx


# ---------- 2. 检查 gzip_static 模块 ----------
# 构建时已经预压缩成 .gz，nginx 直接发可以省掉现场压缩的 CPU。
# 没有这个模块就退回现场压缩，功能不受影响。
if nginx -V 2>&1 | tr ' ' '\n' | grep -q -- '--with-http_gzip_static_module'; then
  GZIP_STATIC="gzip_static on;"
  log "gzip_static 模块在 ✓（走预压缩，省 CPU）"
else
  GZIP_STATIC=""
  warn "没有 gzip_static 模块 —— 退回现场压缩。功能正常，只是每次请求多花一点 CPU。"
fi


# ---------- 3. 建目录 ----------
mkdir -p "$DIST" /etc/nginx/conf.d
log "内容目录：$DIST"


# ---------- 4. 关掉自带默认站点 ----------
# 自带站点 listen 80 default_server，不处理的话你看到的永远是 nginx 欢迎页。
# 这里把整个 nginx.conf 换成一份干净的 —— 但只在确认它是原装默认的时候才动手。
if [ ! -f "$CONF.save" ]; then
  cp "$CONF" "$CONF.save"
  log "已备份原配置 → $CONF.save"
fi

active=$(grep -cE '^[[:space:]]*server[[:space:]]*\{' "$CONF" || true)

if [ "$active" -eq 0 ] || { [ "$active" -eq 1 ] && grep -q '/usr/share/nginx/html' "$CONF"; }; then

  cat > "$CONF" <<NGINXCONF
worker_processes auto;
events { worker_connections 1024; }

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;

    access_log /var/log/nginx/access.log;
    error_log  /var/log/nginx/error.log;

    gzip on;
    $GZIP_STATIC
    gzip_types text/css application/javascript text/html application/json;
    gzip_min_length 1024;
    gzip_vary on;

    include /etc/nginx/conf.d/*.conf;

    server {
        listen 80;
        server_name _;
        root $DIST;
        index index.html;

        # 引擎文件带 ?v=内容哈希，内容变了路径才变 → 可以永久缓存
        location ~* /engine/ {
            add_header Cache-Control "public, max-age=31536000, immutable";
        }

        # 文章 HTML 随时可能改 → 短缓存
        location ~* \.html\$ {
            add_header Cache-Control "public, max-age=300";
        }
    }
}
NGINXCONF
  log "已写入新的 nginx.conf"

else
  die "nginx.conf 里有 $active 个 server 块，看起来不是原装的。
   为防止弄坏你别的站点，脚本停在这里 —— 请你手工把 listen 80 让给 $DIST。
   原文件已备份在 $CONF.save"
fi


# ---------- 5. 语法检查 + 重载 ----------
nginx -t
systemctl reload nginx
log "nginx 已重载"


# ---------- 6. 放行防火墙 ----------
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null
  firewall-cmd --reload >/dev/null
  log "firewalld 已放行 80"
else
  log "firewalld 没在跑，跳过"
fi

if getenforce 2>/dev/null | grep -q Enforcing; then
  restorecon -Rv "$WEBROOT" >/dev/null 2>&1 || true
  log "SELinux 在 Enforcing，已重打安全标签"
fi


# ---------- 7. 自检 ----------
echo
if curl -sf -o /dev/null http://localhost/; then
  log "本地 curl 通了 ✓"
else
  warn "本地 curl 目前拿不到内容 —— 这正常，dist/ 还没传上来。传完再验。"
fi

cat <<'NEXT'

============================================================
 服务器侧配好了。接下来回到你自己的电脑：

   cd pet-reading
   bash deploy.sh <这台机器的公网IP>

 ⚠ 别忘了最后一步（脚本改不了它）：
    阿里云控制台 → 实例 → 安全组 → 配置规则 → 入方向
    手动添加：协议 TCP · 端口 80/80 · 授权对象 0.0.0.0/0

    安全组默认只开 22，不放行 80 的话上面配得再对也访问不到。
============================================================
NEXT
