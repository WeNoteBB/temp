# PET 精读 · 工程约定

给接手这个仓库的 Claude 看的。用户是中文使用者，**回复和注释一律用中文**。

**先读 `README.md`** —— 那里是完整文档（字段表、部署配置、硬规矩、人工检查清单）。
本文件只讲「接手时最容易踩错的地方」。

## 这是什么

**引擎与内容分离**的静态精读站。引擎全站共用，每篇文章只产出一个 JSON。
目前 2 篇（Part 4 长文匹配 + Part 1 五段短文本三选一），目标是 200+ 篇。部署在 2 核 2G 的 nginx 上，纯静态，无 Node 进程。

## 命令

```bash
npm run check              # verify → build → smoke → test-store，提交前必跑
node build.mjs --only <slug>   # 只重建一篇
node tools/verify.mjs <slug>   # 单篇内容自检
node tools/new.mjs sources/x.txt --slug t1-p3-xxx   # 新文章骨架
node tools/promote.mjs --write # 重复词条上浮到共享词库
cd server && npm test      # 后端单测（假 db，不需要数据库；首次先 npm install）
cd server && npm run migrate   # 建表/加列（幂等，需要 .env 里的数据库口令）
```

改任何东西之后 `npm run check` 必须全绿。当前基线：**verify ✓ / smoke 286 / test-store 144**，
后端 `npm test` **94**。

## 架构要点

- `engine/*.js|css` 是**扫描**进构建的，不是写死名单。丢个新文件进去会自动带上 `?v=` 版本号
  （`home.js` / `mlist.js` / `words.js` 就是这么加进去的）。
- 模板里用 `<!--V:文件名-->` 引用版本号，`<!--THEME_HEAD-->` 注入防闪烁脚本。
- **`build.mjs` 的 `PAGES` 注册表**管 `dist/` 顶层所有固定页面。加新页面往这里加一条，
  别往孤儿清理循环里堆 `if (f === "xxx.html")` 特例。
- **`engine/store.js` 是唯一的数据层**（登录态 / 收藏 / 错题 / 学到哪儿 / 主题），全部 `async`。
  注册/登录打后端校验（密码 scrypt），登录态保持 **14 天**（`LOGIN_DAYS`，过期即未登录）；
  收藏本地立即生效 + `pet:fav:q:v1` 补写队列 + 联网拉取合并；
  接口默认同源 `/api`，没有 fetch / 没登录时静默降级为纯本地。
- **没有独立登录页**：首页左上角圆圈点开弹框（`engine/home.js`）。
  未登录访问受保护页 → `guard()` 跳 `index.html?login=1&next=…`。
- **`server/`**：注册/登录/收藏/错题的落库服务（express + mysql2），SQL 全在 `db.mjs`，
  表结构变更走 `migrate.mjs`（幂等；`deploy-api.sh` 发版时自动跑）。
  用户等级 1–18 的颜色在 `pet_user_level` 表（同源拷贝在 `lib.mjs` 的 `LEVEL_COLORS`）。
- `guard()` 是门禁本体，**存储不可用时必须放行**，否则 `file://` 和隐私模式会变成无限跳转死循环。

## 改代码前必读：README 的「硬规矩」

那 8 条全是踩过的坑，每条都对应一个构建期检查。最容易犯的三个：

1. **分词正则三处必须逐字一致** —— `engine/app.js`、`tools/verify.mjs`、`tools/new.mjs`。
2. **`String.replace` 的替换值传函数，且必须全局替换**。`.replace("<!--X-->", v)` 只替第一处，
   第二处会静默消失（构建、校验、冒烟全绿，只是内容没了）。
3. **颜色一律走语义令牌**，暗色只覆写 `:root[data-theme="dark"]` 里的令牌。
   在 `:root` 之外写 `#fff` 的地方，暗色主题下就是一块白斑。

## jsdom 测不到的东西（改样式后必须人工过一遍）

`tools/smoke.mjs` 用 jsdom，它有两条硬限制：**没有 `matchMedia`**，
且 **`getComputedStyle` 完全忽略 `@media` 规则**。

所以下面这些只能人眼看，README 末尾有完整清单：

- 底部抽屉（`<1100px` 时小黑板变成从底部升起的抽屉）的升起/收起动画
- 目录列窄屏浮层（`<1100px` 从左侧滑出）
- 亮暗两套配色的实际观感
- 触摸设备上靠常显的按钮（`.hfav` / `.hdel`；`@media(hover:none)` + `html.touch` 两道保险）
- 页边按钮在所有宽度（含手机 375）都显示且精确对齐（量法见 README，
  **别拿 `.sent` 的右边缘去减**，它是 `display:inline`，段末短句量出来是假间隙）
- 首页圆圈的上色 / 弹框、做题那排 A–H 钮的实际手感

一个带登录态的量法：起 `python3 -m http.server 8899` 在 `dist/`，
浏览器里 `localStorage.setItem("pet:user:v1", JSON.stringify({phone:"13800138000",nickname:"测试",level:3,color:"#31d8ce",ts:Date.now()}))`
（**ts 要用当下的**，写死旧时间戳会撞上 14 天过期）。

## 当前状态（2026-10-16）

2026-10-15 的五条（三端适配 / 暗色 / 门禁 / 收藏按钮 / 收藏落库）之后，
2026-10-16 又完成一轮改版（用户提的 6 条）：

1. **注册/登录弹框**（首页左上角圆圈；手机号+昵称+密码，scrypt 入库；
   等级 1–18 颜色存 `pet_user_level` 表，1 蓝 → 18 金）
2. **登录保持 14 天** + 个性化首页（未登录显示「请先登录哦」）
3. **个性化首页**：六个圆角方形入口（我的词书 / PET 阅读理解 / 口语 / 听力 / 写作 / 错题记录）
   + 「今天的作业」一段（横线划开；口语/听力/写作/作业是占位，点了提示开发中）
4. **阅读理解左边目录列**：`☰ 目录` 开合，默认收起；首页入口和目录都接
   「上次学到哪篇」，进去还高亮上次那一句（**先存本机，Redis 待做**）
5. **错题本**：题目分析页每题一排 A–H「我的答案」，选错当场判错并登记
   `pet_mistake`；`mistakes.html` 列出、可「去订正」深链回那道题
6. **页边按钮（析/🔊）全宽度显示 —— 修了三轮后的最终设计**：不再按宽度隐藏，
   手机 / iPad / 电脑都有（藏过 1100 → 767 → 743 三版，每次都被学生反馈「按钮没了」）；
   抽屉保留（点句子出讲解），是另一条路不是替代品。
   历史行 ☆/✕ 加了 `html.touch` 常显（妙控键盘场景 hover 媒体查询失灵的保险）

**2026-10-16 晚（承接上面的改版）：**

7. **词书点击详情**：`words.html` 每条点开看音标/词性/例句(连翻译)/搭配 + 🔊；
   句子是原文/翻译/分析（`pet_sentence.analysis`）。数据由 `/api/favs` 带全
   （`db.mjs` 的 `listFavs` 连 `pet_sentence` 取例句翻译）——同一份数据也用于跨设备恢复。
8. **真库已迁移 + 后端已重新部署**：`pet_user_level` / `user.pass_hash` / `user.user_level` /
   `pet_mistake` 都建好（`migrate.mjs` 跑过），selftest 全绿。
9. smoke 286 → **436**（两篇：Part 4 长文 + Part 1「训练 + 真题」全量断言）。
10. **Reading Part 1 支持 + 完整版「Training Test 1 · Reading Part 1」**：
    引擎新增「每题自带选项」的题型（数据用 `q.opts`，引擎判断在 `poolOn/qLetters/qAnswerText`；
    verify / smoke 都按题型分支）；题卡编号支持 `q.tag`（训练题显示 ①-1 这种，真题仍是 1–5）。
    文章 t1-p1-messages-and-notices = 书 P10-13 全量：训练①②③④⑤（含五段图文文本、
    短信/便签/邮件体、语法框）+ 真题 5 题，共 39 段 83 句 599 词 29 题；标题/目录两行
    （`title`=Training Test 1，`label`=Reading Part 1）。训练题 n 从 101 起（tag 显示 ①-1）。
    段落排版体系：`passage.blocks` 给每段标角色（h=标题加粗 / i=提示说明斜体浅色 /
    o=选项清单强调色 / q=题目文本块 + 题号徽章），角色段落里关掉「隔句淡黄底」；
    题卡的选项整行列出（带字母圆标，点整行作答，错红对绿）；顶栏加了「← 首页」。
    省略句（招牌 / 留言抬头 / 署名这类片段）进 `MAIN_PAT` 白名单；这类 chip 渲染成
    static（不可点定位）是设计，smoke 的检查里留了豁免名单。
    ⚠ 已知小瑕疵：错题记录页对训练题会显示「第 101 题」（后端只有数字 q，没存 tag）。

**2026-10-16 深夜（Reading Part 1 · 正文内联作答改版）：**

11. **答题交互全部搬进正文页**（`inlineQuiz: true` 的文章，如 t1-p1）：
    「题目分析」tab 自动隐藏，所有练习在原文里就地完成。新增四件套（都在 `passage.blocks` 上标注）：
    - `blocks[].pick: [题号…]` → 这段下面渲染「我的答案」横排（`.pickrow`，字母胶囊点选、
      单选变底色、错红对绿、行尾「解析」按钮 = `data-qexp2`）；② 的五行答案区自动带 1–5 行号。
    - `sent.pickQ` + 句内 `«选项»` 标记 → 备选词渲染成虚线按钮（`.pickword`），点即作答（③ 式二选一）。
    - `blocks[].optsInline: true`（题号取 `blocks[].n`）→ 把这题选项整行列进正文（`.optline`，
      点整行作答；行内「析/🔊」；每个选项的句子分析存 `q.optsAna[字母]`，ref 是 `qo:题号:字母`）。
    - `blocks[].plain: true`（角色 o 自动）→ 该块不逐词查词、词组不响应点击（「一行一个解析」），
      样式不变；词数对账仍按 `.w`（smoke 里减掉 «» 标记里的词）。
    细节：答题小按钮（非单词）在正文作答；卡片与正文同一份 `state.ans`，颜色同步；
    答错自动展开小黑板题目解析；考试题选项「点词 = 查词、点行 = 作答」与卡片同一套规则。
    数据：① 清单加 A–E 字母、② 选项键改小写 a–e、③ 四句加 «»、④/⑤ 每题 pick、
    真题五段 optsInline + 每题 optsAna（15 条）。字数 599 → 604（① 的 5 个字母），
    smoke 436 → **456**，verify 契约扩展（pick/plain/optsInline/pickQ/«»/optsAna）。
    设计方法整理成文档：`book1/doc/reading-part1-设计方法.md`（各类题型 → 方法代号 A–F）。

**部署实况**（8.138.161.122，Ubuntu 22.04 + nginx 1.18，MySQL 在本机）：
Node 22 旁装 `/opt/node-v22`（系统 node v12 没动），systemd 单元 `pet-api`
只监听 127.0.0.1:3001，`sites-available/default` 里插了 `/api/` 反代
（原文件备份 `.pet-backup`）。已验收：公网 HTTP 全流程（含中文往返）、
服务器上真库 selftest、其余四表计数清零。

**静态站就发在 `/var/www/html`**（nginx 默认站根，和 `/api/` 同一个 vhost；
`deploy.sh` 的 REMOTE_DIR 2026-10-16 已改成这里，别改回 /var/www/pet-reading）。
HTML 配了 `Cache-Control: no-cache`（改版不用让学生手动清缓存）。
Edge 按 375/744/768/820/1194/1440 逐宽度验收：每句「析/🔊」都在、无横向溢出。

`npm run check` 全绿（verify / smoke 456 / test-store 144），后端单测 94。

**未做 / 待办：**

- **Redis 的「学到哪一篇哪个位置」**（用户明确说放最后单独讨论）——
  现在存本机 `pet:lastread:v1`、按手机号分账；换 Redis 只改 `store.js` 里
  `getLastRead / setLastRead` 两个函数的内部，调用方（app.js / home.js）不动。
- ~~**2026-10-16 改版还没上服务器**~~ → **10-16 晚已完成**：真库跑过 `migrate.mjs`
  （pet_user_level / pass_hash / user_level / pet_mistake 都建好），后端 + 静态站
  都已用 `deploy-api.sh` / `deploy.sh` 发布到线上。
- ~~**静态站 `dist/` 还没部署到服务器**~~ → **已发布**：站点在 `/var/www/html`
  （80 端口正式地址就是 `http://8.138.161.122/`），`deploy.sh` 已改成发这里。
- **整个 `pet-reading/` 还没提交过 git**（仓库根是上层目录，`main` 上的提交都是旧的 `book1`）。
- 旧版句子收藏（localStorage 里只有 `ref/slug`、没有句子文本的残留）不会被自动补写，
  首次成功合并后会自然消失；学生端从上线当天起不受影响。
- 门禁是**软门禁**（纯客户端，懂技术的人能绕过）。它现在的目的是收集手机号，不是防人。
