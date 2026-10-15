#!/bin/sh
# 把归档的会话转写装回 Claude Code 的会话目录，让 `claude --resume` 能列出它。
#
#   ./restore.sh /path/to/pet-reading      # 指定你打算在哪个目录里干活
#   ./restore.sh                           # 不指定则用当前目录
#
# 为什么要指定目录：Claude Code 按「工作目录」分文件夹存会话，
# 规则是绝对路径里的每个 "/" 换成 "-"（/Users/ei/x → -Users-ei-x）。
# 换台机器路径就变了，slug 跟着变，所以要按新路径算一遍再放。
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
WORKDIR=$(cd "${1:-.}" && pwd)
SLUG=$(printf '%s' "$WORKDIR" | tr '/' '-')
DEST="$HOME/.claude/projects/$SLUG"

ARCHIVE=$(ls "$DIR"/*.jsonl.gz 2>/dev/null | head -1)
if [ -z "$ARCHIVE" ]; then
  echo "✗ 这里没有 *.jsonl.gz" >&2
  exit 1
fi

mkdir -p "$DEST"
gunzip -c "$ARCHIVE" > "$DEST/$(basename "$ARCHIVE" .gz)"

echo "✓ 已装回：$DEST/$(basename "$ARCHIVE" .gz)"
echo
echo "接着这样恢复上下文："
echo "  cd $WORKDIR"
echo "  claude --resume          # 在列表里挑『2026-10-15 PET 精读：三端适配…』那条"
