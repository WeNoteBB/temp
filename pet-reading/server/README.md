# PET 精读 · 后端（server/）

页面是纯静态的（nginx 直接伺服 `dist/`），这个 Node 服务干四件事：
**注册/登录（密码校验）、把学生点的单词/句子收藏落进 MySQL（bud 库）、
记阅读理解错题（pet_mistake）、给首页供用户资料（昵称/等级/等级色）**。
前端唯一的对接点是 `engine/store.js`（本地即时 + 补写队列），见仓库根 README。

## 接口一览

| 方法 · 路径 | 请求 | 说明 |
|---|---|---|
| `POST /api/register` | `{phone, nickname, password}` | 手机号没进过库 → 建号（等级 1）；进过库但没设过密码（老的软登录用户）→ 补昵称密码；已设过密码 → 400。返回 `{ok, user:{phone,nickname,level,color}, completed}` |
| `POST /api/login` | `{phone, password}` | 校验密码（scrypt）。返回 `{ok, user:{…}}`；没注册/没设密码/密码不对 → 400 带中文原因 |
| `GET /api/me?phone=` | — | `{ok, user:{…}}` 或 `{ok, user:null}`（查无此人不是错） |
| `GET /api/favs?phone=` | — | 该用户全部收藏（客户端拿去点亮星星 / 跨设备恢复） |
| `POST /api/favs/add` | `{phone, kind:"word", word, meaning, phonetic, pos, example, exampleTranslation, exampleAnalysis, phrase, sourceTitle}` | `pet_word` 没有就插（字段带全）；例句同时进 `pet_sentence`、`sentence_hash` 关联；再写 `user_word`（用户+level+单词 唯一） |
| `POST /api/favs/add` | `{phone, kind:"sentence", sentence, translation, analysis, sourceTitle}` | `hash = sha256(trim(句子))`；`pet_sentence` 没有就插；再写 `user_sentence` |
| `POST /api/favs/remove` | `{phone, kind, word 或 sentence}` | 只删 `user_word` / `user_sentence` 关联行，公共词句库不动 |
| `POST /api/mistakes` | `{phone, slug, q, chosen, correct}` | 错题登记：用户+篇+题号唯一，重复错只计数 +1（chosen 换成最新） |
| `GET /api/mistakes?phone=` | — | `{ok, items:[{slug,q,chosen,correct,count,ts}]}` |
| `GET /api/health` | — | `{ok, db:"up"}`；部署脚本拿它做健康检查 |

失败一律 `{ok:false, err:"…"}` + 4xx/5xx，成功 `{ok:true, …}`。

## 数据库（migrate.mjs 负责，幂等）

```bash
node --env-file=.env migrate.mjs          # 真执行
node --env-file=.env migrate.mjs --dry    # 只看会做什么
```

- `pet_user_level`（建表 + 写值）：18 行等级颜色，1 蓝 `#3171d8` → 18 金 `#d8ae31`
  （色相 217°→45° 线性走，中途经过青/绿/黄绿）。**同源拷贝在 `lib.mjs` 的
  `LEVEL_COLORS`**，表里查不到时兜底；migrate 就是从这个数组写库的，两处永远一致。
- `user` 加三列：`nickname VARCHAR(32)`、`pass_hash VARCHAR(128)`（格式 `scrypt$盐$散列`）、
  `user_level TINYINT DEFAULT 1`。已有列自动跳过 —— MySQL 没有 ADD COLUMN IF NOT EXISTS，
  脚本靠 information_schema 判断。
- `pet_mistake` 建表：`user_id + slug + q_n` 唯一键，`wrong_count` 计数。

## 约定（改代码前先读）

- **密码用 node 自带 scrypt 加盐散列**（`lib.mjs` 的 `hashPassword / verifyPassword`），
  不引第三方依赖。⚠ 除注册/登录外，其余接口仍按手机号认人（软认证）——
  学生工具的刻意取舍，不是忘了做 token；别在改别的功能时「顺手」发明半套认证。
- `level` 写 `PET`（`user_word`/`user_sentence` 的 level 字段），环境变量 `PET_LEVEL` 可覆盖；
  `source_type` 默认 `2`（user_word 注释：1=课程 2=文章 3=视频），`SOURCE_TYPE` 可覆盖。
  注意这跟 `user.user_level`（1–18 等级，管圆圈颜色）是两码事。
- 句子哈希**只在服务端算**：页面跑在 `http://`（非安全上下文），浏览器没有
  `crypto.subtle`。客户端传原文，服务端 trim 后 `sha256`，小写十六进制 64 位。
- 收藏单词存**词典原形**（`centuries` → `century`，前端 `resolveFavKey` 负责），
  服务端只管拿发来的词查/插。
- `pet_word` / `pet_sentence` 把内容里现有的字段一次带全：音标/词性/例句/搭配、
  `hash`/`sentence`/`translation`/`analysis`；单词的例句会同时写进 `pet_sentence`
  （同一套 sha256 去重），`sentence_hash` 从第一天就能关联。`mnemonic` 内容里
  没有；`status`、`source`、`retry_count` 等留库里默认值，等补全流程。
  重复收藏不覆盖已有行（先到先得）。
- SQL 全部集中在 `db.mjs` —— 表结构调整只动这一个文件（建表/加列走 `migrate.mjs`）。

## 本地跑起来

```bash
cd server
cp .env.example .env          # 填 DB_PASS
npm install
npm run migrate               # 建等级色表 / 给 user 加列 / 建错题表（幂等）
npm run start:env             # = node --env-file=.env server.mjs
```

`dist/` 存在时它顺手把静态站点也伺服出来（<http://127.0.0.1:3001/>），
本地联调不需要另开静态服务器，也没有跨域问题。

真库自检（建用户 → 收藏 → 列表 → 取消，整套真 SQL 走一遍）：

```bash
npm run selftest                                # 用 .env，默认测试号 13800000000
node --env-file=.env selftest.mjs 13800000001   # 想换号直接跟参数
```

⚠ **Access denied 大多是授权问题**：MySQL 里 `zhang` 这个账号可能只允许
特定来源 IP 连。本机连不上不用慌（前端会静默降级为纯本地收藏），
部署后到服务器上再跑 selftest 验证。

## 部署到 ECS

```bash
# 第一次（旁装 Node 22、systemd 服务、nginx 的 /api/ 反代、生成 .env 占位）：
bash deploy-api.sh --setup <公网IP>
# 填一次数据库密码（不会进 git）：
ssh root@<公网IP> 'vi /opt/pet-api/.env && systemctl restart pet-api'
# 之后每次发版：
bash deploy-api.sh <公网IP>
```

细节都在 `deploy-api.sh` / `deploy/api-server-setup.sh` 里：服务装在 `/opt/pet-api`，
systemd 单元名 `pet-api`，只监听 `127.0.0.1:3001`，由 nginx 把 `/api/` 反代过去。

> **Node 是"旁装"的**：脚本把 Node 22 解到 `/opt/node-v22`，**不动系统 node**——
> 有些服务器上系统 node 是 v12、还有别的服务在用，升级它风险太大。
> 所以服务器上手工跑命令要用全路径，如 `/opt/node-v22/bin/node --env-file=.env selftest.mjs`。
> nginx 反代兼容两种布局：Ubuntu 的 `sites-available/default`（先备份成 `.pet-backup`）
> 和老式的单文件 `nginx.conf`。

**实测部署参考**（2026-10-15）：Ubuntu 22.04 + nginx 1.18 + 本机 MySQL；
Node 旁装 `/opt/node-v22`；`sites-available/default` 插了 `/api/` 反代；
systemd 服务 `pet-api` 开机自启。公网端到端 + 服务器 selftest 全部通过。
（静态站 `dist/` 尚未部署到这台机器。）

## 补全词表（backfill）

老数据、或别的客户端写进来的词，字段可能缺着。这个工具拿引擎的内容库
（`../articles/*.json`）把 `pet_word` 里能补的补全：

- 音标 ← 词条 `ipa`、词性 ← `pos`、释义（仅当为空）
- 例句 ← 该词出现的第一句原句（连同翻译/分析写进 `pet_sentence`，
  `sentence_hash` 一起补上 —— 和收藏时同一套规则）
- 搭配 ← 含这个词的词组；顺带补 `user_word` 里空着的 `source_type`/`source_title`

```bash
node --env-file=.env backfill.mjs            # 预览：会补什么，不动库
node --env-file=.env backfill.mjs --write    # 真写
```

**只填空字段，绝不动已有内容**（和收藏接口「先到先得」同一原则）；
反复跑不会坏，补过的词下次就没有可补的了。词形解析（`centuries → century`）
是照抄 `engine/app.js` 的 lookup 回退规则，两边不会漂移。

## 测试

```bash
npm test     # 单测 94 条：纯函数（含 scrypt 散列/校验）+ 假 db 的路由测试（不需要数据库）
```

发布前后建议四连：服务器上 `node --env-file=.env migrate.mjs`（幂等，可先 `--dry` 看一遍）
→ `npm test` → 真库 `selftest` → `curl http://<IP>/api/health`。
（`deploy-api.sh` 发版时已自动跑一遍 migrate，失败只告警不拦发布 —— 看到告警记得手动补跑。）
