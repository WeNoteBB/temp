# PET 精读 · 多文章版

一套**引擎与内容分离**的精读页面。引擎只写一次、全站共用，每篇新文章只产出一个 JSON。

和旧做法的区别：旧版每篇是一个自带全部 HTML/CSS/JS 的独立文件，改一次样式要重刷 200 篇；
现在改 `engine/style.css` 重跑一次构建，全站生效。

```
一次访问的下载量（gzip 后，实测；数字随版本浮动，比例不变）
  首篇：引擎（app.js 21.6 + style.css 11.0 + store.js 5.0 左右）+ 内容 24.6KB ≈ 60KB 上下
  之后每篇：只下内容 24.6KB（引擎已在浏览器缓存里，且带 ?v= 永久缓存）
  固定页面：首页 / 错题页 / 词书页 各自 1–3KB，外加共用的 store.js（已缓存）
```

---

## 目录结构

```
pet-reading/
├── engine/                     ← 引擎：所有页面共用，改一次全站生效
│   ├── app.js                      文章页交互逻辑（唯读内容，不写死任何一篇的数据）
│   ├── store.js                    唯一数据层：登录态 / 收藏 / 错题 / 学到哪儿 / 主题
│   ├── home.js                     首页：用户圆圈 + 登录/注册弹框 + 入口磁贴
│   ├── mlist.js                    错题记录页（mistakes.html 的脚本）
│   ├── words.js                    我的词书页（words.html 的脚本）
│   ├── syn.js                      同义替换页（synonyms.html 的脚本：列表/搜索/遮住自测/连线题）
│   ├── col.js                      固定搭配页（collocations.html 的脚本：10 个一组 · 短语卡 + 同组填空练习）
│   ├── phrase.js                   词组库（phrases.html 的脚本：分组视图 + 精读模式 —— 单卡/小黑板/历史/☆）
│   ├── xbw.js                      词组库·小霸王模式（自动播放 → 连线 → 选择题 → 自动批改）
│   ├── srs.js                      词组库·复习（间隔重复：到期列表 / 做题 / 报服务端）
│   ├── style.css                   样式（亮暗两套配色都在这，走语义令牌）
│   └── template.html               文章页骨架，带 <!--占位符-->（左边目录列也在这）
├── articles/                   ← 内容：一篇一个 JSON，日常只动这里
│   ├── t1-p1-messages-and-notices.json     Part 1 式：训练①②③④⑤ + 真题（39 段 83 句 29 题，带段落角色）
│   ├── t1-p3-great-ocean-road.json         Part 3 式：训练①–⑥ + 真题（58 段 88 句 1027 词 26 题；扉页标题/图片/下划线/2×2 选项盒）
│   ├── t1-p4-digging-into-the-past.json    Part 4 式：长文 + A–H 共享选项池
│   ├── t1-p5-ice-sculptures.json           Part 5 式：训练①②③ + 真题（30 段 38 句 406 词 15 题；真表格/Remember 框/边框盒/真题挖空）
│   └── t1-p6-museum-email.json             Part 6 式：训练①②③④ + 真题（34 段 46 句 448 词 19 题；开放填空输入框/笔记批注可收藏/「总结」页手写分组）
├── assets/                     ← 内容资产（原书扫描裁出的插图）；构建时原样拷进 dist/assets/
│   └── img/
│       ├── t1-p3-ocean-road.jpg            书 P19 大洋路照片
│       ├── t1-p3-hikers.png                书 P18 登山者插图
│       └── t1-p5-ice-sculpture.jpg         书 P25 鱼形冰雕照片
├── data/
│   ├── manifest.json               站点标题 + 书本分组 + 文章顺序（唯一真相源）
│   ├── glossary.core.json          跨篇共享词库，由 tools/promote.mjs 生成
│   ├── synonyms.json               「PET 阅读同义替换 300 组」（内部资料，来源见 sources/synonyms-source.txt）
│   ├── collocations.json           （已并入 phrases.json，2026-10-18 晚）
│   ├── phrases.json                「PET 词组库」真源：254 组固定搭配 + 答案分析（10 个一组；来源见 sources/collocations-source.txt）
│   └── phrases.dict.json           词组库随身小词典的补充词（每批上线时补该批例句里的生词）
├── sources/                    ← 素材原文（new.mjs 的输入，建议一起提交）
├── tools/
│   ├── new.mjs                     素材 → 文章骨架
│   ├── verify.mjs                  内容自检 + 引擎自检（纯静态，不用浏览器）
│   ├── smoke.mjs                   构建产物端到端测试（jsdom）
│   ├── test-store.mjs              store.js 单测（含存储不可用的降级）
│   ├── promote.mjs                 重复词条上浮到共享词库
│   ├── import-phrases.mjs          data/phrases.json → pet_phrase 镜像（幂等，带字段体检）
│   └── migrate-legacy.mjs          旧单文件 HTML → articles/*.json（一次性，已完成使命）
├── server/                     ← 收藏后端（Node + express + mysql2，完整文档在 server/README.md）
│   ├── server.mjs                  HTTP 入口（/api/login、/api/favs…）
│   ├── db.mjs                      全部 SQL 都在这一个文件
│   ├── test.mjs                    后端单测（假 db，不需要数据库）
│   └── selftest.mjs                真库自检（部署机上跑）
├── build.mjs                   ← 批量构建 → dist/
└── dist/                       ← 部署这个目录（.gitignore 里）
```

`engine/` 下的 `*.js` / `*.css` 是**扫描**进来的（不是写死的名单）：
往里丢一个新文件，它自动进 `dist/engine/`、自动带 `?v=` 版本号，不用回来改 `build.mjs`。
模板里用 `<!--V:文件名-->` 引用版本号，`build.mjs` 会换成该文件的 8 位内容哈希。
```

---

## 日常：加一篇新文章

```bash
# 1. 素材丢进 sources/
#    纯文本即可，空位写成 {16} (16) __16__ [16] 都认
#    行首可写 title: / label: / # 原文 / # 选项

# 2. 生成骨架
node tools/new.mjs sources/test1-part3.txt --slug t1-p3-my-topic
#    → 写出 articles/t1-p3-my-topic.json
#    → 屏幕上打印：切句草稿 + 还缺哪些词条

# 3. 手工补内容（这一步是真正的工作量）
#    - 核对切句草稿，切错的直接在 JSON 里改
#    - 补 glossary：pos / ipa / cn，必要时加 note
#    - 补每句的 tr（翻译）和 ana（句子分析）
#    - 补 phrases / optionsAna / questions

# 4. 自检，补到 0 错误
node tools/verify.mjs t1-p3-my-topic

# 5. 登记进 manifest.json 的 books[].articles

# 6. 全流程
npm run check
```

`new.mjs` 的切句只是草稿。**缩写、引号里的句号它一定会切错一些**，切错了后面全歪，务必人工过一眼。

### 改已有的一篇

```bash
node tools/verify.mjs <slug>     # 改完先自检
node build.mjs --only <slug>     # 只重建这一篇（增量构建本来也只重跑变了的）
```

---

## 文章 JSON 的字段

| 字段 | 说明 |
|---|---|
| `slug` | 文件名同名，小写字母/数字/连字符 |
| `book` / `label` | 所属书、出处标注（如 `Exam Practice Test 1 · Reading Part 4`） |
| `title` | 文章标题。**顶层字段**，不要塞进 `passage` |
| `note` | 备注。目前引擎不显示，留档用 |
| `passage.words` / `.sentences` | 声明值，`verify` 会拿实际数跟它比 |
| `passage.paragraphs` | `段落[] → 句[]`，每句 `{ s, hard, tr, ana }` |
| `passage.blocks` | 可选：段落角色数组（与段落等长）：`r` = `h`标题/`i`提示斜体/`o`选项强调色/`q`题目文本块/`p`普通正文段；`n` = 题号徽章（如 `"1"`）。Reading Part 1 的排版体系，普通散文文章（t1-p4）不写这个字段 |
| `blocks[].plain` | 可选 `true`：这块不逐词查词（点整行看讲解）；角色 `o` 自动生效。Part 1 的短文本/选项清单用 |
| `blocks[].pick` | 可选：题号数组，渲染成「我的答案」横排（点选即作答、单选变底色）；多题时自动带行号（取 `tag` 尾号） |
| `blocks[].optsInline` | 可选 `true`：把这题（题号取 `n`）的选项整行列进正文（点行作答；行内「析/🔊」；选项句子分析取 `q.optsAna`） |
| `blocks[].optsGrid` | 可选 `true`：把这题（题号取 `n`）的选项排成 2×2 盒子（Part 3 第 15 题的博客卡片）；同样要 `q.optsAna` |
| `blocks[].head` | 可选 `{l,r}`：扉页式大标题（l 黑底白字 + r 下划线）；该段首句文本必须逐字等于 `l + " · " + r` |
| `blocks[].table` | 可选 `{ head:[…] }`：真表格（Part 5 第①题）；表格行取该段落的句子（行文本照常可点词），第二列渲染这一行的作答胶囊，行与 `blocks.pick` 一一对应；表格行不挂页边按钮 |
| `blocks[].rmb` | 可选字符串：Remember 灰底小框（黑标签 + 灰底中文说明；Part 5 用）。该段自动加 `.rmbwrap`（flow-root），浮框不会挤到后面段落 |
| 句子的 `ana.note` | 可选数组：书上手写批注里的**词组/句型**（Part 6 起）。每条 `"键"` 或 `{k, cn?, t?}`；键必须在词表里（点开有词条）。**直接并进小黑板的「本句词组」区**（词组/句型 + 中文意思，与标黄词组按词条去重）；点开看词条并进历史。⚠ 批注里**不是词组**的（拓展、讲解这类）别塞这里，走顶层 `summary` 的纯文字行 |
| 顶层 `summaryTip` | 可选：总结页开头的一句话（介绍「这一页考什么、怎么看」） |
| 顶层 `summary` | 可选：总结页里的手写分组卡（把笔记按考点整理）。`{ title?, groups:[{ t, items:[…] }] }`；每条 `{ k, cn?, t?, at?, ref? }` —— 有 `k` 是词表键（点开有词条、可收藏），**没 `k` 就得有 `cn`（纯文字行，放拓展/讲解这类非词组批注）**；`at` 是「在哪儿考」小标签（如 `27` / `②-3`），`ref` 是「段-句」引用（点徽章跳回原文那一句）。`k` 的规则同 `ana.note`，verify 逐条卡 |
| `question.gap` | 可选：开放填空在书上印的编号（如 `"1"` / `"27"`）。输入框和「N 解析」按钮显示它；不写就显示题号 |
| 开放填空（无 `opts` 的题） | Part 6 式：句子里的 `{n}` 渲染成**输入框**（判分忽略大小写/首尾空格；答错变红、自动展开解析、记错题） |
| 顶层 `summaryTip` | 可选：总结页开头的一句话（Part 6 起）。**「总结」页**是顶栏第三个 tab：把全篇 `ana.note` 笔记自动整理成清单（去重、按 句型 / 词组 / 单词 分组），每条可点开词条、可 ☆ 收藏；**文章没有笔记时这个 tab 不出现** |
| `blocks[].badge` / `.tip` | 可选：题头灰底小徽章（如「答案见 P184」）/ Tip 中文提示框（黑圆标 + 灰底，浮在段落右上） |
| `blocks[].img` | 可选 `{src, alt, side?, w?}`：页内插图（`assets/` 下的原书扫描裁图），默认浮右、`side:"left"` 浮左、文字自动绕排 |
| `blocks[].frame` / `.shade` / `.center` | 可选 `true`：整段边框盒 / 整段灰底盒 / 整段居中（Part 3 的书本还原件） |
| 句子的 `ul: "…"` | 可选的句内下划线片段（改错题用）：必须是该句原文逐字子串；渲染只加 `<u>` 包裹、不改文字 |
| 句子的 `pickQ` + 文本里的 `«…»` | 句内二选一的渲染标记：`«备选词»` 渲染成按钮，挂在 `pickQ` 题上；`«»` 不算文字（对账/朗读自动剥掉） |
| 顶层 `inlineQuiz` | 可选 `true`：答题全在正文页（隐藏「题目分析」tab）；t1-p1 / t1-p3 用 |
| `ana` | `{ pat, frame, parts, clauses, gram, tip, phrases }` |
| `phrases` | 词组数组，**原文里必须字面出现**（正文或选项里都行） |
| `glossary` | 词条表：`词 → { pos, ipa, cn, note }` |
| `options` | Part 4 式：`A`–`H` 八个共享选项；**Part 1 式留空 `{}`** |
| `optionsAna` | 每个选项一份 `ana`（无 `phrases`）；Part 1 式留空 |
| `questions` | 5 题：`{ n, prompt, answer, why, clues, others, tip, ana }`；**Part 1 式每题加 `opts:{A,B,C}`**（`answer` 取其中的字母，正文没有空位；训练题 n 从 101 起、用 `tag` 显示「①-1」这种编号，真题仍是 1–5） |
| `questions[].optsAna` | 可选：每题选项的句子分析 `{ 字母: { parts, gram, tr } }`；**写了 `optsInline` 的题必须有**（verify 强制），「析」按钮的数据源 |
| `phrases` / `glossary` | Part 1 式的词组、词形覆盖同样算上 `opts` 里的词 |

空位在正文里写成 `{16}`，引擎渲染成绿色小圆标。
Part 5 式（真题在正文里挖空、选项横排）空位照样是绿色小圆标；
**Part 6 式（开放填空，题没有 `opts`）空位渲染成输入框**，学生自己写一个词（`question.gap` 决定显示书上的编号）。
verify 会在两种写法之间对账：正文里的每个 `{n}` 必须有题；开放填空的题必须有 `{n}` 空位。

### 「总结」页（Part 6 起）

正文页顶栏的第三个页签（`tabSum` / `#sumList`），把**书上笔记**整理成一页复习卡：

- **自动清单**（引擎自动生成，任何有笔记的文章都会有）：把全部 `ana.note` 去重，
  按词条 `pos` 分成 句型 / 词组 / 单词 三组；每行可点开词条、右侧 ☆ 收藏；
  没有笔记的文章**不出这个页签**。
- **手写分组卡**（写了顶层 `summary` 才渲染，排在自动清单上面）：
  按考点/题型把笔记再整理一遍（如「真题 27–32 · 每个空一个搭配」「训练③ · 六个连接词」），
  每行多了「在哪儿考」徽章（`at`，如 `27` / `②-3`）—— 点它切回原文页、高亮那一句并打开讲解；
  自动清单会跳过手写分组里已经出现过的词条（含词典原形，如 statues → statue）。
- **批注里不是词组的**（拓展、讲解、语法小结这类）：也放分组卡里，用**纯文字行** ——
  只写 `cn`（不带 `k`），可带 `at` / `ref` 指回原句。`ana.note` 只收词组/句型。
- 页首介绍句子取 `summaryTip`（没有就用默认文案）。行内 ☆ 直接收藏，状态和「历史」浮层里的
  星标同一条链路（收藏汇进「我的词书」）。
- 小黑板里**不再有单独的「笔记（书上批注）」区**：笔记直接并进那句的「本句词组」，
  带中文意思、和标黄词组按词条去重；收藏走总结页或点开后的历史行。

### 「同义替换」页（synonyms.html · 内部资料）

首页入口「PET 同义替换」（在阅读理解后面）。内容 = `data/synonyms.json`（300 组
「原文 ⇄ 同义替换」，来源是第三方内部资料，见 `sources/synonyms-source.txt`）。

- **列表**：每 10 组一段；每行左边原文、右边同义替换，都带中文；**英文单词可以点**
  （小卡片：读音 / 回源组号 / ☆ 收藏这个单词进「我的词书」——收藏键是单词小写原样，
  释义借用所在组的翻译，卡片里有说明）；搜索框中文、英文都能搜；
  「遮住同义替换」进入自测模式，点「点一下对答案」逐行翻开。
- **连线题**：按书上分组一组一组练（第 1 组 = 1–10，第 2 组 = 11–20……共 30 组；
  左边是书上的顺序、右边打乱）。先点左边再点右边；配对成功变绿并显示中文，配错红一下、记一次；
  连完一组出成绩条，「← 上一组 / 下一组 →」切换（进新组分数自动清零，重新练）。
- 门禁和文章页同一道（`PETStore.guard()`）；页面顶部有「内部资料 · 请勿外传」+ 版权来源说明。
- ⚠ **内部资料**：数据是第三方（@Daniel老师KP成长营，版权登记，翻版必究）——
  只放在登录门禁后面自用，不在任何公开渠道宣传/索引；**GitHub 仓库必须保持私有**，
  否则这份数据等于公开（仓库改私有之前不要 push）。

### 「固定搭配」页（collocations.html · 内部资料）

首页入口「PET 词组库」（在同义替换后面）。内容 = `data/phrases.json`
（`items[]`，来源是第三方内部资料，见 `sources/collocations-source.txt`）。

- **一组一屏**：页首那条横排组号（`第 1 组`…）切组，一屏 = 短语卡 + 同组练习，**10 个一组**
  （和书上一样，两组之间互不串题）。
- **短语卡**：`n` 编号 + `ph` 短语（`alt` 是书上的等价说法，如 `= groups of`，排在小字里）
  + `cn` 中文 + `use` 用法 + `ex` 原文例句（例句里短语标黄，卡片上两个 🔊：读短语 / 读例句）
  + `exCn` 翻译。
- **练习**（对应同一组的 10 条）：**短语库点选填入** —— 点句子里的空、再点短语库里的短语
  （直接点短语也能填到第一个空）；对绿错红、配错记一次；「对答案」全填上、「重做本组」清零。
  每题给的是 `cn` + `use` 两条线索（和书上练习一样的提示），答案不在题面里出现。
- **挖空规则**（数据侧 `blank`）：`blank` 必须是 `ex` 的子串（verify 管不着这份数据，
  smoke 里断言了）。短语在句子里有变形时（`advise sb. to do sth` → `advises me to`），
  挖的是句中的那一段，填对后旁边补一个「＝ 短语」小注。
- 门禁、版权说明与同义替换页同一套；⚠ 同样**只在私有仓库里放**。
- ⚠ 目前只上线了**第 1 组（1–10）**；`data/phrases.json` 往后按 10 个一组续写即可，
  页面、组号条、练习都会自动跟着长（smoke 里那段「下一组」断言会自己开始生效）。

### 「词组库」页（phrases.html · 内部资料）

首页入口「PET 词组库」（🧩）。内容 = `data/phrases.json`（真源，10 个一组）+ `data/phrases.dict.json`
（随身小词典，分批补）；设计与三张表见 `docs/词组库-设计方案.md`。

- **分组视图**：一组一张卡（几条 / 收藏几条 / 错题几道），点进**精读模式**或**小霸王模式**；
  底部链到「速查表」= 老的 `collocations.html`（清单 + 填空练习）。
- **精读模式**（`engine/phrase.js`）：一次一张卡 —— 词组 / 中文 / 用法 / 例句（**词组标黄可点、
  单词可点**）/ 翻译 / 🔊×2 / ☆；右侧**小黑板**出词组条（释义/用法/例句/解析/☆）或单词条
  （读音 + 释义 + **相关词组**）；右侧**历史浮层**记点过的一切（按组隔离 `pet:hist:v1:phrases-N`）；
  `←/→` 翻卡；窄屏小黑板是底部抽屉（和文章页同一套骨架）。
- **小霸王模式**（`engine/xbw.js`）：① 自动播放（默认**静音**、可跳过、可调速，TTS 读词组 + 例句）
  → ② 连线（10 词组 ↔ 10 中文，对绿错红计错次）→ ③ 选择题（题干 = 原句挖空 + 中文/用法线索，
  **本组 10 个词组当选项，点一个立刻判分并自动进下一题**）→ ④ 批改总结（得分 + 错题清单 + 重做/回看/下一组）。
  答错的题**自动进词组错题本**（`pet_phrase_mistake`），错题页「去订正」跳回 `phrases.html?g=1&mode=xbw&q=3`。
- **跟读（本地朗读）**：`engine/phrase.js` 的 `window.PET_READ` —— 逐卡念「词组（英音）→ 中文意思（女声）
  → 例句（英音）→ 例句翻译（女声）」，全 0.75 倍速（点「语速」在 0.6/0.75/1 之间循环，记在 `pet:ph:rate`）。
  **小霸王第一关**自动一张接一张（念完停 1 秒翻卡，可暂停 / 重听本卡 / 点小圆点跳卡）；
  **精读模式全手动**（卡片工具栏「▶ 播放跟读」，翻卡就停）。卡片里的 🔊 已去掉，只留单词条的读音。
  顶栏 **「🎙 音色」**：列出这台设备的英文/中文音色、可试听可挑（存 `pet:ph:voice`，空 = 自动）；
  挑法 = 学生挑的 > 好音质（`!localService` 或名字含 natural/online）> 女声 > 任意。
  设备没英音 / 没中文音时，第一关底部会提示一句（并给出各平台的安装办法）。
  iPhone/iPad 首次被浏览器拦下时，按钮会变成「▶ 点一下开始跟读」（点一下就能念）。
- **🔁 复习（间隔重复）**（`engine/srs.js` + `pet_phrase_review` 表）：首页显示「今天有 N 条到期」
  和「X/254 条进过复习」；做题 = 4 个选项（**从整座库里挑，优先同组**）+ 中文/用法线索 + 挖空句，
  选一个立刻判分并报服务端（对升级 / 错回 1 级，间隔 1/2/4/7/15/30 天）；答错的同样进错题本。
  「带我练 10 条没练过的」把新条目领进复习计划。
- **收藏**：☆ 走 `store.addFav`（`type:"p"`，key = 词组原文）→ 本地立即生效 + 补写队列 →
  `/api/favs/add {kind:"phrase"}`；「我的词书」里词组独立成段（释义/用法/例句连翻译/回词组库）。
- **数据侧四张表**（`server/migrate.mjs`）：`pet_phrase`（内容镜像，由 `tools/import-phrases.mjs`
  从 JSON 幂等导入）/ `user_phrase`（用户词组，带 词组/中文/例句/例句翻译 快照）/
  `pet_phrase_mistake`（user_id + 原题 + 选择项 + 正确项 + 错次）/ `pet_phrase_review`
  （复习计划：等级 1-6 + 到期日）。阅读的老表老接口不动。
- ⚠ **254 条已全部上线（26 组）**：`data/phrases.json` 是真源，`data/phrases.dict.json` 是随身小词典
  （564 条，例句里出现的词都收录了；the/and/is 这类功能词故意不收，点它们显示「词义待补」）。
  改内容后跑 `tools/import-phrases.mjs --dry` 体检，再 `--write` 导进 `pet_phrase` 镜像表。

---

## 三道防线

| 命令 | 查什么 | 速度 |
|---|---|---|
| `npm run verify` | ①内容：词数/句数对账、每句每选项都有 `ana`、词组字面存在且有词条、100% 词形覆盖、空位与题号对得上、答案唯一、干扰项齐全、**同一词在不同篇里释义不打架**。②引擎：分词正则三处逐字一致、断点两处一致、模板占位符齐全、`:root` 外无彩色字面量、暗色令牌齐全、hover 藏起来的控件都在常显名单里、`<!--V:x-->` 引用的文件都存在 | 秒级 |
| `npm run build` | 合并共享词库、算引擎哈希、生成全部固定页面、**清理孤儿 HTML**（manifest 里删掉的篇目，dist 里的产物连 `.gz` 一起删）、预压缩 | 秒级 |
| `npm run smoke` | 真在 jsdom 里跑一遍引擎：**2726 条断言**（每篇 + 首页 + 错题页 + 词书页 + 同义替换页 + 固定搭配页 + 词组库页），两种题型（Part 4 共享选项池 / Part 1 每题自带选项）都跑；Part 1 的正文内联作答（答案横排/句内二选一/整行选项/解析按钮/隐藏 tab/标题整段「译」）全链路断言；Part 3 的扉页标题/插图/徽章/Tip/下划线/选项盒；Part 5 的真表格/Remember 框/边框盒/真题空位与 6 排胶囊；Part 6 的开放填空输入框（判分/落盘/同步）、笔记并进「本句词组」（带中文、无单独区块）与**「总结」页**（手写分组/跳原文/☆ → ★、收藏表 +1）；**同义替换页**（300 行/30 段、点词小卡片、收藏回写、搜索、遮住自测、连线题按分组出题与配对对错）；**固定搭配页**（10 张短语卡、短语标黄、组号条、短语库乱序、填错记次、填对回填、对答案/重做、门禁）；含逐字比对防丢字、点词/点句/点词组/点空格的交互、历史记录、目录列开合、**做题与错题登记、学到哪儿、收藏、词书点开详情、首页按钮、题号徽章、门禁、主题切换、存储不可用时放行** | 数十秒 |
| `node tools/test-store.mjs` | `store.js` 单测 **144 条**：注册/登录（含假后端的密码校验分支）、**14 天过期**、手机号校验、收藏去重、**补写队列（离线排队 / 联网推送 / 400 条目丢弃）**、**拉取合并（跨设备星标、本机已删的不复活）**、**错题登记与列表**、**学到哪儿（按手机号分账）**、主题读写、`safeNext` 拒外站、**假一个会抛异常的 localStorage 断言 `available` 返回 false 而不是抛出去** | 毫秒 |
| `cd server && npm test` | 后端单测 **130 条**：sha256 已知向量、scrypt 散列/校验、昵称/密码/手机号/slug 校验、全部路由的成功与 400 分支、**db 抛异常 → 500 且不透传内部细节**。`selftest.mjs` 打真库，在部署机上跑 | 毫秒 |

`npm run check` = 四个连跑（verify → build → smoke → test-store），提交前跑这个。

> `verify` 的第二类是**引擎不变量**：它不做排版验证（那要浏览器），
> 但会把「改一处忘另一处」这种事故变成构建期错误 ——
> 比如模板里漏替换的占位符、断点值两边不一致、新按钮忘了进触摸常显名单。
> 这些都是踩过的坑，见文末「硬规矩」。

`verify` 退出码非 0 表示有错误，可以直接挂进提交钩子。

### 「干扰项必须出现过」这条不变量

引擎在「答题解析」里靠各题 `others` 汇总「某个选项为什么哪个空都不填」。
所以**每个干扰项必须至少出现在某一题的 `others` 里**，否则学生点开它看到的是空面板。
`verify` 会拦住这种情况。

（提示词文档 §3.6 的文字说 `others` 要列「其余 7 个选项」，但同节的示例和 §8 的基准表都是 3 个。
这里按**功能**判：不数个数，只要求每个干扰项都出现过。）

---

## 词库全书化

200 篇会大量撞词。撞的词不必每篇重写：

```bash
node tools/promote.mjs              # 预览，不动文件
node tools/promote.mjs --min 3      # 出现 ≥3 篇才提升（默认 2）
node tools/promote.mjs --write      # 真的写
```

它把出现在 ≥N 篇、且**各篇释义完全一致**的词条挪进 `data/glossary.core.json`，并从各篇删掉。
构建时自动合并：`共享词库 ← 本篇词库`（本篇优先，可覆盖）。

释义打架的词条**留在原处并报出来**，退出码 1 —— 共用一条错的释义比各写各的更危险，必须人工统一。

---

## 登录、门禁与收藏

### 页面一览

| 页面 | 由谁生成 | 加载什么 |
|---|---|---|
| `dist/<slug>.html` | `engine/template.html` + 该篇 JSON | `style.css` + `store.js` + `app.js` |
| `dist/index.html` | `build.mjs` 里的 `renderIndex()`（手写模板，没有 `PET_CONTENT`） | `style.css` + `store.js` + `home.js` |
| `dist/mistakes.html` | `build.mjs` 里的 `renderMistakes()`（共用 `renderListPage()` 骨架） | `style.css` + `store.js` + `mlist.js` |
| `dist/words.html` | `build.mjs` 里的 `renderWords()`（同上） | `style.css` + `store.js` + `words.js` |
| `dist/synonyms.html` | `build.mjs` 里的 `renderSynonyms()`（内联 `data/synonyms.json`） | `style.css` + `store.js` + `syn.js` |
| `dist/collocations.html` | `build.mjs` 里的 `renderCollocations()`（内联 `data/phrases.json`） | `style.css` + `store.js` + `col.js` |
| `dist/phrases.html` | `build.mjs` 里的 `renderPhrases()`（内联 `data/phrases.json` + 随身小词典） | `style.css` + `store.js` + `phrase.js` + `xbw.js` |

**没有单独的登录/注册页** —— 首页左上角那个圆圈（`avatar`）点开是弹框，逻辑全在 `engine/home.js`。
固定页面**不加载 `app.js`**：`app.js` 开头无条件读 `window.PET_CONTENT`，那些页没有内容数据，一加载就崩。
加新固定页面时，往 `build.mjs` 的 `PAGES` 注册表里加一条就行，孤儿清理会自动豁免它 ——
别再往清理循环里堆 `if (f === "xxx.html") return;` 那种特例。

### 登录 / 注册（2026-10 改版）

- 首页**公开**：没登录显示「请先登录哦」+ 入口淡化锁住（点了弹登录框）；
  登录后加载个性化首页，「PET 阅读理解」跳到上次学到的那篇。
- 注册要**手机号 + 昵称 + 密码**；密码在服务端按 scrypt 散列入库（`user.pass_hash`），
  登录时校验。老的软登录用户（库里没密码）走「注册」会补设昵称和密码。
- **登录状态保持 14 天**（`store.js` 的 `LOGIN_DAYS`，过期当作未登录并顺手清掉）。
  前端缓存 `{phone, nickname, level, color, ts}`；等级色（1 蓝 → 18 金）来自
  数据库 `pet_user_level` 表，首页圆圈按它上色。
- ⚠ 除注册/登录要密码外，其余接口仍按手机号认人（**软认证**）——
  这是学生工具的刻意取舍，不是忘了做 token。懂技术的能绕过，别拿它当安全边界。

### 门禁是**软**门禁，这点必须先说清

未登录访问文章页 / 错题页 / 词书页 → 回首页并自动弹登录框（`index.html?login=1&next=…`）→ 登完回原页。
但这是**纯客户端**的：懂技术的人改一下 localStorage 就绕过去了（密码只保护「登录这动作」本身）。

> 它现在的作用是**让学生走一遍注册流程、把手机号留下来**，不是防住谁。

### ⚠ 门禁带来的三个后果

1. **搜索引擎收录不到。** 内容不再公开可索引。
2. **微信/QQ 里转发链接，对方打不开正文**，会落到首页登录框。
   以后要做传播，得改成「试读 N 篇」。
3. **`file://` 双击打开半残。** 本地打开跳首页（能看），但 `file://` 下 localStorage 不可靠，
   登录永远存不住，学习记录也不会留下。因此门禁做成了**存储不可用时放行**
   （`store.available() === false` → 直接放行），
   否则「存不住 → 跳回来 → 又跳过去」会变成无限跳转。
   **这条防御不能删**，删了本地和隐私模式就成死循环了（`smoke` 里有断言拦它）。

### `store.js`：唯一的数据层

**所有登录态 / 收藏 / 错题 / 阅读进度 / 主题的读写都走 `engine/store.js`，从第一天起就是 `async`。**
收藏接后端时也只改了这个文件（`fetch` + 补写队列 + 拉取合并），页面代码基本没动 ——
这就是「把异步性前置」的回报。接口地址默认同源 `/api`，本地联调起
`server/`（它顺带伺服 dist/）即可，也支持 `window.PET_API_BASE` 指到别处。

```js
window.PETStore = {
  available,   // () → boolean          存储能不能用（隐私模式 / file:// 会是 false）
  guard,       // async () → Promise    门禁：未登录就回首页弹登录框；存储不可用时**放行**
  getUser,     // async () → { phone, nickname, level, color, ts } | null（过期即 null）
  login,       // async (phone, password) → { ok, user, persisted } | { ok:false, err }
  register,    // async (phone, nickname, password) → { ok, user, completed } | { ok:false, err }
  refreshProfile, // async () → user     拉最新昵称/等级/颜色写回缓存；离线返回缓存、不登出
  logout,      // async ()
  maskPhone,   // (phone) → "138****8000"
  safeNext,    // (raw) → string        只放行站内相对路径，防开放重定向
  mountWho,    // (el) → Promise        顶栏昵称（或脱敏手机号）+ 等级色点 + 退出
  mountTheme,  // (el) → void           固定页面的三态主题按钮（文章页有自己的那份）
  addFav,      // async (item) → { ok, added }   本地立即生效 + 进补写队列，网络的事后台慢慢来
  isFav,       // async (id) → boolean
  listFav,     // async () → [item]     联网时拉服务器收藏合并进本地
  syncFavs,    // async () → void       把补写队列推一遍（平时自动触发；测试/调试用）
  favId,       // (item) → string
  addMistake,  // async ({slug,q,chosen,correct}) → { ok }   错题登记（直连后端，失败静默）
  listMistakes,// async () → [item]     错题列表（每次现拉）
  getLastRead, // async () → { slug, ref, ts } | null    学到哪儿了（本机先记着）
  setLastRead, // async (slug, ref)      ref 传空 = 保留同一篇上次的位置
  getTheme, setTheme, nextTheme, paintTheme
};
```

`guard()` 是门禁本体，**文章页和两个列表页调的是同一个它**，不是两处长得像的实现。
`mountWho()` 同理 —— 「登录的人带到每个页面」是一个实现被多处调用。

`store.js` **不依赖 `PET_CONTENT`**（`verify` 有一条断言拦着），所以首页和列表页也能安全加载它。

### 收藏

文章页里没有独立的收藏面板 —— **每个词/句进入历史浮层后，那一行右侧有个 ☆**，点一下收藏、再点取消；
收藏汇到**「我的词书」页**（`words.html`，首页磁贴进）。

- 收藏的 key 用 `lookup()` 解析后的**词典原形**，不是用户点到的那串字母。
  点 `centuries` 收藏的是 `century`，否则同一个词的不同形式会各存一条。
- 单词/词组是**全局按词**的（同一个词在任何一篇里都是同一条）；
  句子的身份是**句子文本**（服务端按 `sha256(句子)` 去重，`s:句子文本` 就是它的 id）——
  换设备、刷新后同一句还能对上。
- 条目形状：单词 `{ type:"w", key:"century", cn:"世纪", pos, ipa, ex, exTr, ph, title }`；
  句子 `{ type:"s", key:"<完整句子>", cn:"<翻译>", ana, title, ref, slug }`。
  `id = type + ":" + key`。
- **本地即时 + 后台补写**：点星先写本地 `pet:fav:v1`（不等网络），同时往补写队列
  `pet:fav:q:v1` 记一条；联网后自动推给 server/ 的后端，落进
  `pet_word/pet_sentence` + `user_word/user_sentence`（详见「收藏后端」一节）。
- `listFav()` 联网时会拉服务器收藏合并进本地 —— 跨设备恢复星标就靠它。
- **词书排序**：单词按**词表 `pet_word.created_at`**（收录时间，最新在前），句子按收藏时间（最新在前）。
- **词书页点一条展开详情**：单词给 音标 / 词性 / 释义 / 例句（连翻译）/ 搭配 + 🔊；
  句子给 原文 / 翻译 / 句子分析 + 🔊。数据由 `/api/favs` 带全
  （`db.mjs` 的 `listFavs` 会连 `pet_sentence` 取例句翻译）；
  老词缺的字段跑 `server/backfill.mjs` 补（见 server/README.md）。

### 存储键

| 键 | 内容 | 范围 |
|---|---|---|
| `pet:user:v1` | `{ phone, nickname, level, color, ts }` —— 保持 14 天，过期即未登录 | 跨篇共享 |
| `pet:fav:v1` | 收藏条目数组（界面真相；`sy:1` = 已入库） | 跨篇共享 |
| `pet:fav:q:v1` | 待补写队列（断网时攒下的增删，联网后自动推送） | 跨篇共享 |
| `pet:lastread:v1` | `{ [手机号]: { slug, ref, ts } }` —— 学到哪篇哪句（将来换 Redis） | 跨篇共享 |
| `pet:theme:v1` | `"auto"` / `"light"` / `"dark"` | 跨篇共享 |
| `pet:ui:v2` | `{ ana, vocab }` —— 注意 `ana` 存的是**用户偏好**（`userAna`），不是当前显隐 | 跨篇共享 |
| `pet:zoom:v1` | 字号倍数（1–5，步长 0.5）—— **所有页面共用**：文章页 `app.js` 与固定页面 `store.js 的 mountZoom()` | 跨篇共享 |
| `pet:ph:rate` | 词组库跟读语速（0.6 / 0.75 / 1） | 跨篇共享（只词组库用） |
| `pet:ph:voice` | 跟读音色 `{ en, zh }`（空 = 自动挑） | 跨篇共享（只词组库用） |
| `pet:hist:v1:<slug>` | 该篇的点词/点句历史 | 按篇隔离 |
| `pet:ans:v1:<slug>` | 该篇做过的答案 `{ 题号: 选项字母 }`（错题登记后刷新还看得见） | 按篇隔离 |

跨篇的键一律不带 slug。所有读写都包了 try/catch —— 隐私模式下 localStorage 会直接抛异常。
「学到哪儿」以后换 Redis 时只改 `store.js` 的 `getLastRead / setLastRead` 两个函数内部，调用方不动。

**`userAna` 与 `cols.ana` 是两回事**，别合并：`cols.ana` 是「这一刻显不显示」，
`userAna` 是「用户在宽屏上的偏好」。窄屏进来时抽屉必须收起（`cols.ana = false`），
但那只是屏幕窄逼出来的处境，不该写进偏好里。只有宽屏上点顶栏开关才更新 `userAna`。

---

## 收藏后端（server/）

页面仍是纯静态的；注册/登录/收藏/错题的持久化交给一个很小的 Node 服务（express + mysql2），
部署在同一台 ECS 上，nginx 把 `/api/` 反代到 `127.0.0.1:3001`。
完整文档在 `server/README.md`，这里只记要点：

- **迁移（migrate.mjs）**：建 `pet_user_level`（18 行等级颜色，1 蓝 → 18 金）、
  给 `user` 加 `nickname / pass_hash / user_level` 三列、建 `pet_mistake` 错题表。
  幂等，可反复跑；`deploy-api.sh` 发版时会自动跑一遍（失败只告警不拦发布）。
- **注册/登录**：`POST /api/register`（手机号+昵称+密码，密码 scrypt 散列入库）、
  `POST /api/login`（校验密码）、`GET /api/me`（拉昵称/等级/颜色）。
  老的软登录用户（库里没密码）走「注册」会补设昵称密码。
- **落库逻辑**：收藏时 `pet_word/pet_sentence` 没有就补一条（句子按
  `sha256(trim(句子))` 去重），再写 `user_word/user_sentence` 关联行；
  取消收藏只删关联行，公共词句库不动。收藏接口仍按手机号认人（软认证）。
- **错题**：`POST /api/mistakes` 登记（用户+篇+题号唯一，重复错计数 +1）、
  `GET /api/mistakes` 列出；错题页（`mistakes.html`）每次打开现拉。
- **字段带全**：收藏单词时把内容里现有的一切都带上 —— 音标、词性、**点它时所在
  的例句原句**（连同翻译和分析）、含这个词的搭配；例句同时进 `pet_sentence`，
  `sentence_hash` 直接可关联。`mnemonic` 内容里没有，留空等补全流程。
- **旧数据补全**：`cd server && node --env-file=.env backfill.mjs`（预览）/
  `--write`（真写）—— 拿内容库把 `pet_word` 缺着的音标/词性/例句/搭配补齐，
  只填空字段、幂等，详见 `server/README.md`。
- **level 写 `PET`**（`user_word/user_sentence` 的 level 字段），
  `source_type=2`（文章）。两者都可用环境变量覆盖，见 `server/.env.example`。
- **哈希在服务端算**：页面跑在 `http://` 下没有 `crypto.subtle`，客户端算不了
  SHA-256 —— 客户端传原文，这是刻意的。
- **离线兜底**：没有网络（或后端挂了）收藏照常能点，条目躺在
  `pet:fav:q:v1` 队列里，下次联网自动补写。被后端 400 拒绝的条目会被丢弃
  （否则会堵住整个队列），控制台里有记录。
  （错题登记不做离线队列：报不上先算了，别打断做题。）
- **部署**：`bash deploy-api.sh --setup <IP>`（首次：**旁装 Node 22 到 `/opt/node-v22`**
  —— 不碰系统 node；systemd 单元 `pet-api`；nginx `/api/` 反代）→ 填一次
  `/opt/pet-api/.env` 的 DB_PASS → `bash deploy-api.sh <IP>`（每次发版，顺带跑迁移）。
  细节见 `server/README.md`。
- **验证**：`cd server && npm test`（单测）→ 服务器上
  `/opt/node-v22/bin/node --env-file=.env selftest.mjs`（真库全链路）→
  `curl http://<IP>/api/health`。
- **状态（2026-10-16）**：后端 + 静态站都已部署验收 —— 静态站在 `/var/www/html`
  （nginx 默认站根，和 `/api/` 同一个 vhost；`deploy.sh` 已改成发这里，HTML 配了 no-cache）；
  公网 `/api/health` 可达，端到端含中文往返，真浏览器多宽度验收全过。
  **2026-10-16 改版**（注册/登录/等级色/错题/学到哪儿）的迁移要先在服务器上跑
  `node --env-file=.env migrate.mjs`（或直接走 `deploy-api.sh`，它会顺带跑），
  前端要重新 `node build.mjs` 后发布 `dist/`。

---

## 主题与三端适配

### 主题

三态循环：跟随系统 → 亮 → 暗（文章页顶栏、首页/错题页/词书页各有一个按钮，
`store.js` 的 `mountTheme()` 一份实现）。

- **配色一律走语义令牌**，暗色只覆写 `:root[data-theme="dark"]` 里的令牌值，**绝不逐条覆写组件**。
  否则以后每加一个组件都要记得配两遍。`verify` 有一条断言禁止 `:root` 之外出现彩色字面量。
- **防闪烁**：主题属性只能由 JS 写，而外链 CSS 会阻塞渲染，JS 跑完前会闪一帧亮色。
  所以 `<head>` 里、样式表**之前**有一段极小内联脚本先读 `pet:theme:v1` 并写 `data-theme`。
  这段脚本所有页面共用一份定义（`build.mjs` 的 `THEME_HEAD`，经 `<!--THEME_HEAD-->` 注入）——
  各写一遍的话，改个键名就得改三处，漏掉的那页会闪。
- `auto` 在启动时就被解析成具体值写死，CSS 里不再维护一套 `@media (prefers-color-scheme)`。

### 断点（两个档位，各自与 `app.js` 对账）

| 断点 | 区间 | 管什么 |
|---|---|---|
| **1100** | `≥1100px` 两列（正文 + 小黑板）/ `<1100px` 单列 + 小黑板变**底部抽屉**、目录列变左侧浮层 | 布局（`app.js isNarrow()`） |

> 1100 的来历：1180 正好卡在 iPad Air 横屏上，而 **iPad Pro 11" 横屏是 1194px** —— 改到 1100 后两种横屏 iPad 都是两列。
> **页边「析 / 🔊」按钮 2026-10-16 起所有宽度都显示**，不再按宽度隐藏：
> 之前手机/平板上会藏掉，指望学生点句子开抽屉 —— 但学生反复反馈「按钮丢了」，
> 他们要的就是每句都有按钮；抽屉保留（点句子照样出讲解），是另一条路，不是替代品。
> 断点数字写死在 `verify.mjs` 的 `BPS` 名单里：`style.css` 和 `app.js` 任何一边对不上都算构建错误。

抽屉**复用同一份 `#colAna` DOM**，只用 CSS 换表现（`transform:translateY(100%)` 收起），
不新增面板。用 `transform` 而不是 `display:none`，否则滑动动画会没有。
`.cols` 上的显隐逻辑（`applyCols()` 切 class）完全不动。
目录列（`#tocCol`）同一套路：宽屏真占一列（`.cols.toc-open`），窄屏 `position:fixed` 从左边滑出。

**跨越断点时要重算列状态**（`app.js` 里监听 `matchMedia` 的 change）：
竖屏进来抽屉是收起的，横过来到 ≥1100 就成了第二列，不恢复的话小黑板是空的、页面上也没提示，
学生会以为讲解丢了。规则是**宽屏一律以 `userAna` 为准，窄屏一律收起**，
两边都是按规则算出来的，绝不把「屏幕窄」这个处境写进偏好里。
（页边按钮现在全宽度都摆，resize 时自会重新量位置。）

**触摸设备**：两道保险。①`@media(hover:none)` 把靠 `:hover` 显形的控件（`.hfav` / `.hdel`）改成常显；
② `store.js` 按 `navigator.maxTouchPoints` 给 `<html>` 挂 `.touch`，CSS 里同样常显 ——
**iPad 接了妙控键盘/触控板时 hover 媒体查询可能判不出来**，光靠①会「丢按钮」（学生报过）。
`verify` 会检查每个藏起来的 hover 控件都进了①的常显名单，加了新按钮别忘了。

### 人工浏览器清单（jsdom 测不到的，改样式后必须过一遍）

jsdom 有两条硬限制：**没有 `matchMedia`**，且 **`getComputedStyle` 完全忽略 `@media` 规则**。
再加上**没有 `speechSynthesis`**（跟读一类的朗读逻辑在 jsdom 里不出声、也不会自动往下走，
真机验证用 CDP 注入假语音，见 CLAUDE.md 第 37 条）。所以下面这些机器验证不了，只能人眼看：

1. **五个宽度 × 亮/暗两主题**逐档看：375 / 744 / 820 / 1194 / 1440。
   暗色要覆盖正文、词组黄底、句子交替底色、三态高亮、题目区、选项对错、小黑板各区块、
   历史浮层、首页磁贴、登录弹框、错题/词书页。
2. **手机上点句子 → 抽屉升起、讲解可见、🔊 可用**；抽屉收起时应该在视口下方（不能压住正文）。
3. **页边按钮在所有宽度（含手机 375）都显示**且精确对齐。
   量法：所有 `.sbtns` 的左边缘应当**只有一个值**；与句子首行的垂直偏移应在几个像素内。
   ⚠ 别拿 `.sent` 的右边缘去减 —— `.sent` 是 `display:inline`，
   一行的并集盒子在段末短句处会缩进去，量出来是个假的大间隙。
4. 未登录打开文章 → 回首页并弹登录框 → 登录 → 回到原页 → 顶栏显示昵称 + 等级色点。
5. 点词进历史 → 行内 ☆ **在 iPad 上**可见可点（带键鼠壳也要可见）→ 收藏成功、★ 点亮；
   刷新页面星标还在（本地表）；后端活着时换一台设备登录同手机号也能恢复
   （服务器拉取合并）。断网时先点几颗星，恢复网络后过一会儿看数据库
   `user_word / user_sentence` 里有没有补上。
6. **隐私模式打开，确认门禁放行而不是无限跳转。**
7. iPad 上**旋转屏幕**：竖→横，小黑板应当按偏好恢复；横→竖，抽屉应当收起；
   竖屏下页边「析/🔊」应当还在。
8. 首页：注册一个新号 → 圆圈按等级上色、磁贴解锁；退出 → 回到「请先登录哦」；
   点「PET 阅读理解」→ 进上次学到的那篇的那一行（高亮）。
9. 文章页做题：选错一题 → 行变红 + 解析自动展开 → 「错题记录」里能看到 → 「去订正」跳回那道题。
10. 同义替换页：列表两栏在手机 375 上不挤爆；点单词弹小卡片、☆ 收藏后「我的词书」里能看到；
    「遮住同义替换」逐行翻开；连线题连对变绿（带中文）、连错红一下、换一组重新洗牌；暗色下都正常。

---

## 部署

前端：发布 `dist/` 整个目录即可，全是静态文件（`bash deploy.sh <IP>`）。
后端：`bash deploy-api.sh [--setup] <IP>` —— 服务装在 `/opt/pet-api`，
systemd 单元 `pet-api`，只监听 `127.0.0.1:3001`，由 nginx 的 `/api/` 反代进去。
两者互不干扰：前端挂了不影响已读页面，后端挂了收藏自动降级为本地队列。

```nginx
server {
    root /var/www/pet-reading/dist;

    gzip on;
    gzip_static on;              # 构建时预压缩，省 CPU
    gzip_types text/css application/javascript text/html application/json;

    # 带 ?v= 的引擎文件：内容变了哈希才变，可以永久缓存
    location ~* /engine/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    # 文章 HTML：内容可能随时改，短缓存 + 协商
    location ~* \.html$ {
        add_header Cache-Control "public, max-age=300";
    }
}
```

缓存策略靠 `build.mjs` 自动维护：引擎文件路径不变，但 HTML 里的引用带 `?v=<8位哈希>`，
内容一改哈希就变，用户浏览器自动失效，不会出现「样式改了学生看到的还是旧的」。

2 核 2G、1 万用户：瓶颈只在带宽，不在 CPU。静态文件 + `gzip_static` + 上面的缓存头足够；
真扛不住时在最前面挂一层 CDN 就行，不用改任何代码。

**分发方式**：`dist/` 里的 HTML 用的是相对路径、普通 `<script>`（不是 ES module），
所以整目录拷走放到任何静态服务器上都能跑。

⚠ **双击本地打开（file://）是半残状态** —— 加了登录门禁之后，
本地打开跳首页，`file://` 下 localStorage 不可靠：**文章能读**（门禁放行），但登录保不住、
收藏和历史也留不下。要正经用，得走 `http://`（哪怕是本机起个小服务）。

---

## 硬规矩（都是踩过的坑，别改）

1. **分词正则三处必须逐字一致** —— `engine/app.js`、`tools/verify.mjs`、`tools/new.mjs`：
   ```
   /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g
   ```
   只认字母序列，连字符和撇号算词内（`no-one`、`wasn't` 都是一个 token）。
   任何一处改了，另外两处必须同步，否则词数对不上。

2. **`String.replace` 的替换值一律传函数，而且必须全局替换。**
   标题、选项、释义里一旦出现 `$&`、`` $` ``、`$'`、`$1`，传字符串就会被当成反向引用，静默写坏内容。
   同时 `.replace("<!--SITE-->", v)` **只替第一处** —— 站点名在模板里出现两次（`<title>` 和 `<h1>`），
   第二处会以注释的形态静默消失：页面照常渲染，构建、校验、冒烟全绿，只是标题没了。
   正确写法：`html.replace(new RegExp("<!--" + name + "-->", "g"), () => value)`（`build.mjs` 的 `subst()`）。
   `build.mjs` 会在替换后扫一遍残留的 `<!--大写名-->` 并报错，兜住这种情况。

3. **`passage.title` 不要用**，标题是顶层 `C.title`。
   写错不会报错，只会在页面上顶一个大字 `undefined`。`smoke` 里有断言拦它。

4. **页边按钮（每句的「析/🔊」）在所有宽度都显示，别再按宽度藏。**
   2026-10 前后藏过三版（1100 → 767 → 743），每次都换来「手机/iPad 上按钮丢了」的反馈 ——
   藏掉之后学生并不会自觉去点句子开抽屉，只会觉得坏了。抽屉保留（点句子照样出讲解），
   但它是「另一条路」，不是替代品。
   剩下的宽度断点（1100，抽屉/两列）在 CSS 与 `app.js isNarrow()` 之间**必须一致**，
   `verify` 会拿两边对账。

5. **`:root` 之外不许写彩色字面量。** 颜色一律走语义令牌，暗色只覆写令牌。
   直接写 `#fff` 的地方，暗色主题下就是一块白斑。`verify` 有断言拦着（中性灰会被放行）。

6. **从行中间起头的句子，它的页边按钮会低一行 —— 这是故意的，不是坏了。**
   同一行上放不下两组按钮，`layoutGutter` 会把后一组下推一个按钮高（`prevBottom + 2`）。
   实测 22 句里有 2 句这样，偏移 21–24px，其余 20 句都在 0.7px 内。
   jsdom 不做排版，测不到这个（`smoke` 只用假 rect 验算让位逻辑），改布局后要人眼过一遍。

7. **`template.html` 必须算进 `ENGINE_SIG`。**
   增量构建靠「内容哈希 + 引擎签名」判断跳过，而模板不是 `*.js`/`*.css`、不在扫描名单里。
   漏掉它的后果很隐蔽：改了模板（加按钮、改结构）之后构建会说「跳过 N 篇」，
   已经生成的文章**全停在旧结构上**，而构建、校验、冒烟三条全是绿的。

8. **词组内部的空格也是 `.w`**（靠它撑出连续黄底，全篇 49 个）。
   引擎里靠 `String(w.dataset.w).trim() !== ""` 把它放行给词组分支，
   否则会往历史里写一条 `data-w=" "` 的空白垃圾行。
9. **收藏句子的身份 = 句子文本**（不是 `slug + ref`）。服务端按
   `sha256(trim(句子))` 去重，本地 id 是 `s:<文本>` —— 两端必须用同一条
   「trim」规则，否则同一句话在手机和电脑上会各收一条。
   哈希只在服务端算：页面在 `http://` 下没有 `crypto.subtle`。
10. **数据库口令、生产地址不许出现在 `engine/` 下的任何文件里** —— 那是要发布的
    静态文件，等于公开。接口地址走同源 `/api`，口令只活在 `server/.env`（不进 git）。
    `verify` 有断言拦（`wysnaa` / `8.138.161.122` 之类）。
11. **`pet:user:v1` 有 14 天寿命。** `getUser()` 读的时候顺手判过期（过期清掉、返回 null）。
    任何绕过 `getUser()` 直接读 `pet:user:v1` 的新代码，都要自己记得这条 —— 
    测试里种一个 `ts: 1` 的假用户会被当场判过期（`smoke` 的 `FAKE_USER` 用 `Date.now()`）。
12. **密码只在「注册/登录」这一处校验**（服务端 scrypt）。其它接口仍按手机号认人 ——
    这是刻意的软认证（见「登录 / 注册」一节），加真 token 是另一个工程，
    别在改别的功能时「顺手」发明半套认证。

---

## 换书 / 加书

`data/manifest.json` 里加一个 `books[]` 条目即可（文章页左边的目录列、首页的
「PET 阅读理解」入口都自动跟着走）：

```json
{ "id": "pet-25", "title": "PET 官方模考题 25", "articles": ["t2-p2-xxx"] }
```

`new.mjs` 生成骨架时会把 `book` 写成 `books[0].title` —— 不是第一本的话，生成后手工改一下那个字段。
