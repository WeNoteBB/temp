# 会话归档

换机器继续干活用的。快照，不是实时文件 —— 归档时会话还在进行，之后新聊的内容不在里面。

| 文件 | 大小 | 是什么 |
|---|---|---|
| `2026-10-15-pet-reading.jsonl.gz` | 9.5MB | Claude Code 原始转写（含全部工具调用）。用于 `claude --resume` |
| `2026-10-15-pet-reading.md` | 163KB | 同一场对话的纯文字版，去掉了工具输出。**只是想回顾决策的话看这个** |
| `2026-10-16-pet-reading.jsonl.gz` | 13.8MB | OpenCode 原始转写（含工具调用与推理）。第 1 行是会话元数据，之后每行一条消息 |
| `2026-10-16-pet-reading.md` | 133KB | 同一场对话的纯文字版（用户消息 + 助手正文 + 工具名单 + 自动压缩摘要） |
| `2026-10-16-进度快照.md` | 4KB | **恢复上下文从这份看起**：当前进度、关键文件、待办、常用命令（手写的压缩版） |

> ⚠ 这些 gz 快照进 git 后是永久的（十几 MB 一份），**别频繁归档**，做完一大段再压一次。

## 在新机器上恢复（Claude Code 旧档）

```sh
git clone <仓库> && cd pet-reading
./docs/transcripts/restore.sh .        # 参数是「你打算在哪个目录里干活」
claude --resume                        # 列表里挑 2026-10-15 那条
```

`restore.sh` 干的事就是按新路径算一遍会话目录名，把转写解压放进去。

**为什么要算路径**：Claude Code 按工作目录分文件夹存会话，规则是绝对路径里的每个 `/` 换成 `-`：

```
/Users/ei/Desktop/temp/book1   →  ~/.claude/projects/-Users-ei-Desktop-temp-book1/
/srv/pet-reading               →  ~/.claude/projects/-srv-pet-reading/
```

路径变了 slug 就变，所以不能直接拷。

**不 restore 也能干活。** `CLAUDE.md` 和 `README.md` 里已经写清了架构、约定和当前状态，
新开一个会话照样能接手 —— restore 只是让你能翻回原文。

## 导出 OpenCode 会话（2026-10-16 起的新场次）

OpenCode 的会话不在 JSONL 文件里，全部记录在
`%USERPROFILE%\.local\share\opencode\opencode.db`（SQLite）。想再导出一份快照：

```sh
node docs/transcripts/export-opencode.cjs "C:/Users/89300/Desktop/pet/book1"
#   第二个参数可指定输出目录（默认脚本所在目录）
```

脚本用 Node 22.5+ 自带的 `node:sqlite` 只读打开数据库，取「该目录下最近一场会话」，
产出 `<日期>-pet-reading.jsonl.gz`（原始，含推理/工具）+ `<日期>-pet-reading.md`（纯文字）。

**日常继续干活不用这份文件**：opencode.db 里场次本来就在，`opencode` 打开后直接在
会话列表里点那条继续。这两份导出是兜底与回顾用（换机器、清缓存、想全文搜索时）。

## 重新导出（Claude Code 旧档）

会话转写在 `~/.claude/projects/<路径 slug>/<会话 id>.jsonl`，按修改时间挑最新的那个：

```sh
ls -lt ~/.claude/projects/*/ | head
gzip -9 -c <那个.jsonl> > docs/transcripts/$(date +%F)-pet-reading.jsonl.gz
```
