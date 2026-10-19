# PET Reading Part 2 · 题型与设计方法（设计方法字典）

> 本文档整理自「Training Test 1 · Reading Part 2」（`t1-p2-art-courses`，书 P14–P16）的完整实现
> （2026-10-18）。方法代号 **R–U** 接在 Part 1 的 A–F、Part 3 的 G–L、Part 5 的 M–O、
> Part 6 的 P–Q 之后（那几个见同目录 `reading-part1/3 设计方法.md`）。
> Part 2 的题型 = **人物—文本匹配**：左边若干人物的需求，右边若干文本，逐一配对。
> 例：「按 t1-p2 的设计做 t2-p2：① R、② S、③ T、真题 U」。

参考实现（唯一权威样板）：
`C:\Users\89300\Desktop\pet\pet-reading\articles\t1-p2-art-courses.json`
线上页：`http://8.138.161.122/t1-p2-art-courses.html`

---

## 一、方法代号 R–U

### 方法 R · 双清单配对 —— 训练 ①（人物 ↔ 公寓）

**教材形态**：左右两个灰底信息框 —— 左「Information about people looking for apartments」（6 条需求）、
右「Information about apartments」（6 条卖点）；要求把两栏一一配对。书上**没有编号和字母**。

**做成什么样**：

```
Information about apartments                        ← i 段（小标题）
┌────────────────────────────────────────────┐
│ (a) extremely low prices   (b) has its own gym … │  ← o 段 + frame：选项库（字母徽章是补的）
└────────────────────────────────────────────┘
Information about people looking for apartments     ← i 段（小标题）
(1) always uses public transport                     ← q 段 + 编号徽章
    [a extremely low prices] [b has its own gym] [c …] [d …] [e …] [f …] [解析]   ← 横排作答
```

**数据写法**：

```jsonc
{ "r": "o", "frame": true }        // 右栏：选项库；行首写 "a "…"f "（字母徽章自动）
{ "r": "q", "n": "1", "pick": [101] }   // 左栏每条一个 q 段：编号徽章 + 一行横排
// question.opts = { "a": "extremely low prices", … }（小写键和库里的字母一致）
```

**约定**：书上没有编号/字母的清单 —— **为可作答补编号（1–6）和字母（a–f）**，
回车版式照书（两栏标题都保留成 i 段）。配对结果按官方答案（P183）逐条核对。

### 方法 S · 划线找关键词 —— 训练 ②（及 ④ 的迁移）

**教材形态**：「Underline the words and phrases that tell you exactly what she wants.」——
学生在一段描述里划出「需求信号」。官方答案给了应该划哪几段（P183）。

**做成什么样**：把**官方答案的下划线原样标出来**（红色下划线，`ul`），点句子看讲解：

```
Hannah wants to go to a really lively place where everything stays open late.
                     ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾   ← ul
```

**数据写法**：

```jsonc
{ "s": "Hannah wants to go to a really lively place …", "ul": "really lively place where everything stays open late", … }
// 每句只能一段连续 span（引擎按子串定位）；划的必须逐字是原文
```

- ④「在选对的文本里划出对应表达」= 同一手法**第二次使用**：答案（C 文）的三句各划一段
  （luxury hotel… / Museum of Modern Art… / by night…），和 ② 的两条需求**隔文呼应**，
  学生一对照就看懂「配对配的是哪两块」。
- ⚠ ul 片段**尽量避开多词词组**地方才好对账；万一重叠也没关系（渲染会正确包住词组），
  但「ul 逐字一致」的断言要先做空白归一（词组内部空格在 HTML 里是「字面空格 + 空格 w 壳」俩字符）。

### 方法 T · 三选一配对 —— 训练 ③（三个假期 → Hannah）

**教材形态**：三段节假日描述 A/B/C 并排；「哪个最适合 Hannah」一个问句。

**做成什么样**：三段文本照书排（各给字母徽章），末尾一条横排作答：

```
(A) Study tours      ← q 段 + n:"A"
(B) Sunshine destinations
(C) City breaks
[A Study tours] [B Sunshine destinations] [C City breaks] [解析]   ← 单独一段 pick:[107]
```

**数据写法**：

```jsonc
{ "r": "q", "n": "A" }, { "r": "q", "n": "B" }, { "r": "q", "n": "C" },
{ "r": "q", "pick": [107] }        // 空段：只渲染一行作答（题号徽章由 pick 自带行号/胶囊给）
// question.opts = { A: "Study tours", B: "Sunshine destinations", C: "City breaks" }
```

**解析的写法**：why 里把「Hannah 的四条需求 ↔ C 文的四条表达」逐条对齐（官方思路），
这就是 ④ 的答案内容 —— 不用另设 ④ 的作答。

### 方法 U · 人物照片 + 八文本匹配 —— 真题 6–10

**教材形态**：五个人（各带照片、一两句需求）匹配八段课程文本 A–H。

**做成什么样**：

```
(6) [照片] Rafa wants to produce artwork …              ← q 段 + n:"6" + img（浮左）
    [A Get Artistic] [B Art Attack!] [C …] … [H The Studio] [解析]   ← 八个字母胶囊
   …
Art Courses            ← h 段居中
(A) Get Artistic       ← q 段 + n:"A"（徽章就是课程字母）
    Teachers here always have ideas …
```

**数据写法**：

```jsonc
{ "r": "q", "n": "6", "pick": [6], "img": { "src": "assets/img/t1-p2-rafa.jpg", "side": "left", "w": 200 } }
{ "r": "h", "center": true }            // 「Art Courses」标题
{ "r": "q", "n": "A" }                  // 八段课程文本（徽章 = 字母）
// question.opts = { A: "Get Artistic", … H: "The Studio" }；人物照裁自原书扫描（见 sources）
```

**解析的写法**：干扰项要**逐个解释**（7 个全写）——重点照顾「半个对」的选项
（如 Simona 题里 E 也有网站交流、Karl 题里 G 也有 one-to-one，但都缺另一条需求）。

---

## 二、Part 2 的批注（笔记）整理

书 P14–P16 的带笔记版是**满页手写批注**（几乎每个词组都写了中文），整理规则沿用全站约定：

- **词组/单词类**（词表里能建条目的）→ 句子上的 `ana.note`（直接并进小黑板「本句词组」，带中文；
  点开词条、进历史）。P2 共 115 条笔记载体 = 37 个自动清单词条（句型 1 + 词组 36）+ 2 条
  纯文字讲解 + 其余为同键重复（不同句子上）。
- **非词组类**（语法小结、概念解释）→ 顶层 `summary` 的**纯文字行**：
  - 「Which 引导非限制性定语从句」（Q6 句 2，`at:"6"`、`ref:"29-1"`）；
  - 「digital design 数字设计：指使用计算机软件和工具进行图形设计…」（H 句，`at:"H"`、`ref:"42-1"`）。
- `summaryTip`：做题心法一句话（「先圈需求，再找换了一种说法」）。

**要求行上的批注也有归宿（引擎新增）**：h/i 整段（`blk:` 引用）的面板除「翻译 + 解析」外，
现在也渲染**「本句词组」**（段内句子上的 `ana.note` 去重合并）——如导语里的
「a variety of 各种各样的」点开要求行就能看到、能进历史。渲染与句子面板同款
（`.nkey` + `.ncn`，`data-noteref="blk:段号"`）。

---

## 三、图片（Part 2 全员人像）

- 人物照片**六张**（Hannah + 真题五人），从 `_15-17.pdf` **4 倍渲染图按像素裁出**（灰度 JPEG q88），
  存 `assets/img/t1-p2-*.jpg`；裁切框与素材记录在 `sources/t1-p2-art-courses.txt`。
- 课程页（P16）无插图。
- 渲染参数与命名沿用 Part 3/5 的约定（`assets/img/<slug>-<描述>.jpg`）。

---

## 四、内容约定（做新一篇 Part 2 时）

1. **答案先官方核对**（Teacher's Notes & Keys，本题在 P183）——训练①②③ 和真题 6–10 都核对。
2. **图书页顺序 = 段序**：训练页（P14）在前、真题（P15–P16）在后。
3. **人像必裁原图**，不找相似图。
4. 词表覆盖率 100%（原文 + 全部选项词）；**跨篇冲突要统一**（本项目 43 个词一次统一到全部 6 篇）。
5. 训练题号 101–107（① 101–106、③ 107；②④ 不设题），真题 6–10。

## 五、本次实现的规模（t1-p2，2026-10-18）

| 项 | 值 |
|---|---|
| 文件 | `articles/t1-p2-art-courses.json` |
| 规模 | 43 段 · 88 句 · 972 词 · 12 题（训练 101–107 共 7 题 + 真题 6–10）· 本篇词条 371 + 共享词库 367 |
| 方法分布 | ① R（双清单配对）<br>② S（划线 ×2 句）<br>③ T（三选一）<br>④ S 的迁移（C 文三句划线）<br>真题 U（5 照片 + 8 字母胶囊 + 课程 A–H） |
| 笔记 | `ana.note` 记进 30+ 句（115 条笔记载体）；summary 2 条纯文字讲解 + summaryTip |
| 图片 | `assets/img/t1-p2-hannah.jpg` + 五张人像（rafa/simona/andrei/nicola/karl） |
| 测试 | verify 0 警告；smoke **1446** 全绿；test-store 144；server 109 |

---

## 六、Test 2 的变体（t2-p2-film-studios，2026-10-19）

Test 2 的 Part 2 是「人物 ↔ 电影制片厂」主题，训练页换了 4 种新壳，真题沿用方法 U。

### 各题的做法对照

| 题 | 教材形态 | 做法 |
|---|---|---|
| ① | 词框（7 词）+ 一段话 7 个空 | R 的变体：词框 = o + `frame`（键 A–G）；整段 = 一块 q 段，7 个空写省略号 `……………`，块上 `pick:[101…107]` → 段尾 7 排（行号取 tag 尾 1–7） |
| ② | 四个用途组 + 7 个词分组 | 一题一行：`a like? b prefer? c dislike? d don't think is important?` 做 o 段（行首字母自动提徽章），`pick:[108…113]` → 6 排，**行标取 tag 尾 = 词本身**（`②-rather` → 显示「rather」）；官方只列 6 个词，prefer 不设题 |
| ③ | 划关键词（答案下划线） | S 法：一句一划（`ul` 单段/sentence），官方划线 4 处 → 句子拆成 4 句（every day / doesn't mind / fancies / prefers），不设题 |
| ④ | 三家场馆选一 + 人物照片 | T 法：A/B/C 各一块 + Ethan 照片（`img` 浮左）+ C 块上 `pick:[114]` |
| 真题 6–10 | 五人（带照片）配 A–H 八厂 | U 法原样：`n:"6"…"10"` + `img` 浮左 + 8 字母胶囊；P58 八段文本 `n:"A"…"H"` |

### 踩过的坑（引擎口径）

- **成分片段必须字面**：①②的正文用 `……………`（省略号），parts 里的 `<code>` 片段若写 `____`
  就对不上，句型 chip 点了标不红（冒烟「点句型标红」当场抓过）。**片段一律从正文原样复制**。
- **开放填空（P6 式）的块不要写 `pick`**（引擎会自动排「N 解析」）；这里是词选/配对题，
  `pick` 照写（两者不冲突）。
- `img.side` 只支持 `left`（写 `right` verify 直接报错）。
- 8 选项的真题：`others` 要写满 7 条（每个错选项一条）——官方只点名 3–4 个干扰项，
  其余自己补理由。

### 笔记（批注）

书 P56–58（扫描 73–75）批注约 40 条，全是词组/单词类 → `ana.note`：
would rather / can't stand doing / be keen on / be fond of / fancy doing / mind doing（①词框上）；
charge / gym / squash courts / be reserved / facilities（④）；look around / own speed / actual sets /
costumes / worn / souvenir（真题人物）；allow / be ready to / direct sb to / sight / in advance /
turn into / make-up / filming techniques / as though / plenty of / long queues / on sale / selection /
realistic / historical sites / surrounding area / staff member / huge / original / a collection of（八厂文本）。

### 实现清单（t2-p2，2026-10-19）

| 项 | 值 |
|---|---|
| 文件 | `articles/t2-p2-film-studios.json` |
| 规模 | 36 段 · 81 句 · 993 词 · 19 题（训练 101–114 共 14 题 + 真题 6–10）· 本篇词条 340 + 共享词库 367 |
| 图片 | 6 张人像（Ethan + Tom/Ingrid/Roberto/Simone/Ben），`assets/img/t2-p2-*.png`（裁切框见 sources） |
| 测试 | verify 0 警告（86 个跨篇冲突一次统一到全部 8 篇）；smoke 1899 全绿；test-store 144；server 130 |
