# 会话归档

换机器继续干活用的。存的是 Claude Code 的原始会话转写。

| 文件 | 大小 | 是什么 |
|---|---|---|
| `2026-10-15-pet-reading.jsonl.gz` | 9.5MB | 原始转写（含全部工具调用）。用于 `claude --resume` |
| `2026-10-15-pet-reading.md` | 163KB | 同一场对话的纯文字版，去掉了工具输出。**只是想回顾决策的话看这个** |

> ⚠ **这是快照，不是实时文件。** 归档时会话还在进行，之后新聊的内容不在里面。
> 想更新就重跑一遍导出（见文末）。另外 9.5MB 在 git 里是永久的 ——
> 每归档一次就再压一份进历史，别频繁做。

## 在新机器上恢复

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

## 重新导出

会话转写在 `~/.claude/projects/<路径 slug>/<会话 id>.jsonl`，按修改时间挑最新的那个：

```sh
ls -lt ~/.claude/projects/*/ | head
gzip -9 -c <那个.jsonl> > docs/transcripts/$(date +%F)-pet-reading.jsonl.gz
```
