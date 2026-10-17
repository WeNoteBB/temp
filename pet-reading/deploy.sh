#!/bin/bash
# ============================================================
# PET 精读 —— 从本机发布到阿里云 ECS
#
# 用法（在 pet-reading/ 目录下）：
#     bash deploy.sh --setup <公网IP>     第一次：先把服务器配好
#     bash deploy.sh <公网IP>             以后每次：构建 + 上传
#     SKIP_CHECK=1 bash deploy.sh <IP>    赶时间跳过 npm run check（不推荐）
#
# 产物是纯静态的，服务器上不跑 Node —— 这里构建好，整个 dist/ 传上去。
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

REMOTE_DIR=/var/www/html
# ↑ 线上就是这个目录（nginx 默认站点的根，/api/ 反代也在这个 vhost 里）。
#   2026-10-16 之前写的 /var/www/pet-reading 从未成为真实部署路径，别再改回去。

log()  { printf '\033[32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

SETUP=0
if [ "${1:-}" = "--setup" ]; then SETUP=1; shift; fi

IP="${1:-}"
[ -n "$IP" ] || die "用法: bash deploy.sh [--setup] <ECS公网IP>"
command -v ssh >/dev/null || die "找不到 ssh —— 请在 git-bash 里跑，不要在 cmd/PowerShell 里跑"

# ---------- SSH 连通性 + 免密检查 ----------
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

# ---------- 第一次：配服务器 ----------
if [ "$SETUP" -eq 1 ]; then
  log "上传服务器初始化脚本 …"
  scp -q "deploy/server-setup.sh" "root@$IP:/tmp/pet-server-setup.sh"
  # Windows 检出可能带 CRLF，去掉再跑，否则 Linux 上 bash 会报 "pipefail\r: invalid option"
  ssh "root@$IP" "sed -i 's/\r$//' /tmp/pet-server-setup.sh && bash /tmp/pet-server-setup.sh" \
    || die "服务器初始化失败，看上面的报错"
fi

# ---------- 构建 ----------
if [ "${SKIP_CHECK:-0}" = "1" ]; then
  warn "跳过 npm run check，只跑 build"
  node build.mjs
else
  log "跑完整自检 + 构建（verify → build → smoke → test-store）…"
  npm run check
fi

[ -d dist ] || die "dist/ 不存在，构建没成功"
[ -f dist/index.html ] || die "dist/index.html 不存在，构建产物不完整"

# ---------- 上传 ----------
# 远程目录里除了站点文件，还可能有 20261016/ 这类历史备份目录 ——
# 只清站点自己的东西（engine/ + *.html + *.gz + 构建缓存），不动其它内容。
# 先清再解包：manifest 里删掉的文章在服务器上也会消失，和 build.mjs 的孤儿清理一致。
log "上传 dist/ → $IP:$REMOTE_DIR …"
tar czf - --exclude=.build-cache.json -C dist . \
  | ssh "root@$IP" "cd $REMOTE_DIR && rm -rf engine .build-cache.json *.html *.gz && tar xzf -" \
  || die "上传失败"

# ---------- 验证 ----------
log "验证 …"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://$IP/" || true)
cc=$(curl -sI "http://$IP/" 2>/dev/null | tr -d '\r' | grep -i '^cache-control' || true)
gz=$(curl -sI -H 'Accept-Encoding: gzip' "http://$IP/index.html" 2>/dev/null | tr -d '\r' | grep -i '^content-encoding' || true)

echo "  http://$IP/            → ${code:-无响应}"
echo "  HTML 缓存头             → ${cc:-（没拿到，建议给 .html 配 no-cache）}"
echo "  gzip 生效               → ${gz:-（没有，检查 gzip_static）}"

echo
case "$code" in
  200|302|301) log "发布完成： http://$IP/" ;;
  000|"")      warn "浏览器打不开。八成是阿里云安全组没放行 80 —— 控制台 → 安全组 → 入方向 → TCP 80" ;;
  *)           warn "返回 $code，去服务器上看 nginx 错误日志： tail -30 /var/log/nginx/error.log" ;;
esac

cat <<'NOTE'

 提示：引擎文件带 ?v= 内容哈希，内容变了学生浏览器自动换新；
       HTML 在 nginx 里配了 no-cache（每次协商），改版不用让学生手动清缓存；
       收藏/登录等接口走同机 /api/ 反代，发版用 deploy-api.sh。
NOTE
