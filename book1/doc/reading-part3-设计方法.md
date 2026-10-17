# PET Reading Part 3 · 题型与设计方法（设计方法字典）

> 本文档整理自「Training Test 1 · Reading Part 3」（`t1-p3-great-ocean-road`，书 P17–P20）的完整实现。
> 用途：**下次给 AI 出「设计方法提示词」时，直接引用本文的方法代号（G–L；Part 5 又加了 M–O，
> 见文末同名小节）**（A–F 已在 `reading-part1-设计方法.md` 定义，两个文档的代号连起来是一整套）。
> 例：「按 t1-p3 的设计做 t2-p3：① G、② H、③ I、④ J、⑤ K、⑥ 略、真题 L」。

参考实现（唯一权威样板）：
`C:\Users\89300\Desktop\pet\pet-reading\articles\t1-p3-great-ocean-road.json`
线上页：`http://8.138.161.122/t1-p3-great-ocean-road.html`

---

## 一、页面总则（Part 3 新增件，全部只在数据里标，不必改引擎）

Part 3 的页面是**「书本还原 + 正文即试卷」**。Part 1 的那套（内联作答、每题解析、
错题登记、状态同源）全部保留，另外为「把书排出来」新增了这些**段落级装饰**，
都写在 `passage.blocks[i]` 上（引擎与 verify 都已支持）：

| 数据标记 | 渲染成什么 | 书上的对应物 |
|---|---|---|
| `"head": {"l": "…", "r": "…"}` | 扉页式大标题：`l` 黑底白字 + `r` 下划线 | 「Training Test 1 ▍Reading Part 3」那两半 |
| `"badge": "答案见 P184"` | 题头右侧灰底小徽章 | 书上的「答案见 P184」灰胶囊 |
| `"tip": "在阅读问题之前…"` | 黑圆标 Tip + 灰底中文提示，**浮在段落右上** | 书上的 Tip 框；段落里文字自动绕排 |
| `"img": {src, alt, side, w}` | 页内插图（assets/img 下的原书扫描裁图），默认浮右、`side:"left"` 浮左 | P18 登山者插图（浮右）、P19 大洋路照片（浮左） |
| `"frame": true` | 整段加边框盒 | P18 第 ④ 题文本+插图的那个方框、① 的动词框 |
| `"shade": true` | 整段灰底 | 第 ⑤ 题的灰底 MCQ 盒 |
| `"center": true` | 整段居中 | 大标题「Our Great Ocean Road adventure」 |
| `"optsGrid": true`（题号仍用 `n`） | 选项排成 2×2 盒子（博客卡片），每盒点=作答、角上「析/🔊」 | 第 15 题的 A–D 博客框 |
| `sentence.ul: "suggested to go"` | 句内把这段原文画红下划线（只加包裹不动字） | 第 ② 题标出的错误片段 |
| `"r": "p"`（新角色） | 普通正文段（长文散文用；保留隔句淡黄底） | 真题文章那 6 段 |

**排版基线（不要动）**：①–⑤ 的训练题与真题的全部作答仍在正文里；
h/i 段落仍是「整段一个译」；每道题都有「解析」；短文碎片仍「一行一个解析」（`plain`）。

---

## 二、方法代号 G–L（每种题型 → 一种做法）

### 方法 G · 动词框 + 每题全表横排 —— 训练 ①（8 空 × 8 动词）

**教材形态**：一个灰底方框里 8 个动词（apologise…warn），下面 8 个带点线空格的句子；
要求「用这些动词的正确形式补全」。

**做成什么样**：

```
┌────────────────────────────────────────────┐
│ apologise  blame  explain  invite  offer   │   ← o 角色 + frame（方框）
│ promise  recommend  warn                   │
└────────────────────────────────────────────┘
1  The water was very deep, so Jessica ………… him not to jump into it.
   [A apologise] [B blame] … [H warn] [解析]     ← 每句下面全表 8 个胶囊，点=作答
```
答对绿色、答错红色；「解析」给完整解析（正确答案 + 正确的**形式** + 干扰项逐个说明）。

**数据写法**：
```jsonc
{ "r": "o", "frame": true }                       // 动词框（o 自动 plain）
{ "r": "q", "pick": [101] }                        // 每句一块，pick 只放自己那题
// question.opts = { "A": "apologise", … "H": "warn" }，答案取字母；
// 正确答案的「形式」（warned/explained…）写在 why / ana 里
```

### 方法 H · 改错句（红下划线 + 解析给订正）—— 训练 ②

**教材形态**：8 个句子，每句里有一段被下划线标出（含语法错误）；要求改错、不换动词。
有些句子官方就给了两种改法。

**做成什么样**：
```
1  My friend suggested to go to the park to play football.
              ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ← 红色下划线（ul 数据）
   点「析」→ 小黑板：句子里这句错在哪 + 官方订正（suggested going / suggested (that) we (should) go）
```
**数据写法**：
```jsonc
{ "s": "1 My friend suggested to go to the park to play football.", "ul": "suggested to go", … }
// ul 必须逐字出现在该句里（verify 强制）；渲染时只加 <u> 包裹，不改文字
```
**注意**：这类句子没有作答横排（答案是开放式的，官方也有多解）——**官方订正必须写进 ana.tip/gram**。

### 方法 I · 意图清单成排作答 —— 训练 ③（8 句 × 8 意图）

**教材形态**：问第 2 题的 8 句「说话人的意图是什么」，只给了一个示例答案。

**做成什么样**：
```
a to give an explanation   b to encourage others to do something   …  ← o 角色清单（字母徽章）
1  [a …] [b …] [c …] [d …] [e …] [f …] [g …] [h …] [解析]   ← 8 排答案（行号 1–8）
2  [ … ]
…
```
**数据写法**：
```jsonc
{ "r": "o" }                                     // 意图清单 a–h
{ "r": "q", "pick": [109,110,111,112,113,114,115,116] }  // 一块里 8 排
"opts": { "a": "to give an explanation", … }      // 键小写（和清单行首字母一致）
```
⚠ 选项**顺序要打散**（别和第 1–8 句一一对应），否则学生按顺序蒙都对。

### 方法 J · 大题带插图 —— 训练 ④（框内长段 + 插图 + 4 小题 a/b/c）

**教材形态**：一个方框，左边一段 4 句的长文本、右边一张插图；下面 4 个三选一小问。

**做成什么样**：
```
┌──────────────────────────────────────────────┐
│ The four of us came down the mountain …   [插图] │ ← q + frame + img（浮右）
└──────────────────────────────────────────────┘
1  What kind of text is it from?     [a an advertisement] [b a travel guide] [c a story] [解析]
```
**数据写法**：
```jsonc
{ "r": "q", "frame": true, "img": { "src": "assets/img/….png", "alt": "…", "w": 320 } }
{ "r": "q", "pick": [117] }   // 每题一块（题干文字里带题号，无 pbadge）
```

### 方法 K · 灰底 MCQ 盒 + 小问 —— 训练 ⑤

**教材形态**：三个「拆题」小问（1 用了什么转述动词 / 2 去哪找答案 / 3 哪个最好），
下面一个灰底盒装题干 + A–D 选项。

**做成什么样**：
```
1  What reporting verb does it use?          ← i 角色（整段一个「译」，解析里给答案）
2  Where should you look …?
3  Which is the best answer, A, B, C or D?
┌────────────────────────────────────────────┐
│ When the snow began to fall, the speaker regretted │ ← q + shade + optsInline（题号 121）
│ [A leaving her mobile phone …] [析][🔊]      │
│ [B going climbing without telling anyone else.] …  │
└────────────────────────────────────────────┘
```
**数据写法**：
```jsonc
{ "r": "i" }                                   // 每个小问
{ "r": "q", "n": "121", "shade": true, "optsInline": true }
// 选项 A–D 的句子分析写 q.optsAna（optsInline/optsGrid 的题 verify 强制要）
```

### 方法 L · 真题（长文 + 整行选项；博客卡片排 2×2）—— 第 11–15 题

**教材形态**：一篇配照片的 6 段长文；5 道四选一。第 15 题的四个选项是四张博客卡片
（书上排成 2×2）。

**做成什么样**：
```
（文章，照片浮左、文字绕排）
11 Donna's Dad decided not to drive the Great Ocean Road himself because
   [A he realised he wouldn't enjoy the views as much.] [析][🔊]   ← 整行选项（A–D）
   …
15 What might Donna write in her blog during the trip?
   ┌───────────────┐ ┌───────────────┐
   │ A  博文（居中） │ │ B             │            ← optsGrid：2×2 盒子
   │      [析][🔊] │ │               │
   └───────────────┘ └───────────────┘
   ┌───────────────┐ ┌───────────────┐
   │ C             │ │ D             │
   └───────────────┘ └───────────────┘
```
**数据写法**：
```jsonc
{ "r": "q", "n": "11", "optsInline": true }    // 11–14 整行选项
{ "r": "q", "n": "15", "optsGrid": true }      // 15 用 2×2 盒子
// 每题 4 个 optsAna（parts/gram/tr），「析」按钮的数据源
```
**约定**：点选项里的**单词**=查词（不触发作答）；点行内其它区域=作答；「看本题解析」=完整解析。

---

## 三、数据字段速查（只列 Part 3 新增/强调的）

| 位置 | 字段 | 作用 |
|---|---|---|
| `passage.blocks[i]` | `head:{l,r}` | 扉页式大标题；首句文本必须逐字等于 `l + " · " + r`（verify 强制） |
| 同上 | `badge` / `tip` / `img{src,alt,side,w}` | 答案徽章 / Tip 框 / 浮动图（src 必须真在 assets/ 下） |
| 同上 | `frame` / `shade` / `center` / `optsGrid` | 边框盒 / 灰底盒 / 居中 / 2×2 选项盒 |
| 同上 | `r:"p"` | 普通正文段（长文散文；和没有 blocks 的文章一样保留隔句淡黄底） |
| `sentence` | `ul: "…"` | 句内红下划线（改错题）；必须是该句原文的子串 |
| `question` | 照旧 `n/opts/answer/why/clues/others/tip/ana`；optsInline/optsGrid 的题必须每题都有 `optsAna` | |

**图片资产**：`assets/**` 会被 `build.mjs` 原样拷进 `dist/assets/**`（逐字节对比，没变不重写）；
HTML 里用相对路径引用（`assets/img/xxx.jpg`）。原书图片的裁剪坐标记在 `sources/t1-p3-*.txt`。

---

## 四、内容约定（每次做 Part 3 都必须遵守）

1. **答案先官方核对**：书后 Teacher's Notes & Keys（本题在 P184）逐题核对后才写入数据。
2. **图书页顺序 = 段落顺序**：训练页在前、真题页在后，一块一段，不重排。
3. **图片从原书扫描裁**：不找相似图、不重绘 —— 用 PDF 里那张整页高清位图裁出原图。
4. **改错句官方多解照写**：如 suggested going / suggested (that) we (should) go 两个都给。
5. **词表覆盖率 100%**：原文 + 全部选项（含①的 8 个动词、③的意图清单）每个词形都有词条。
6. **训练题编号从 101 起**（tag ①-1 / ③-5 / ④-2 / ⑤-3），真题保持 11–15。

---

## 五、本次实现的规模（t1-p3，2026-10-17）

| 项 | 值 |
|---|---|
| 文件 | `articles/t1-p3-great-ocean-road.json` |
| 规模 | 58 段 · 88 句 · 1027 词 · 26 题（训练 101–121 共 21 题 + 真题 11–15） |
| 图片 | `assets/img/t1-p3-ocean-road.jpg`（大洋路照片）· `assets/img/t1-p3-hikers.png`（登山者插图） |
| 方法分布 | ① G（动词框 + 8 句 × 8 选项）<br>② H（8 句红下划线 + 解析给订正）<br>③ I（意图清单 a–h + 8 排作答）<br>④ J（边框盒 + 插图 + 4 题）<br>⑤ K（灰底 MCQ 盒 + 3 小问）<br>⑥ 口语活动（静态提示）<br>真题 L（4 题整行选项 + 15 题 2×2 盒子） |
| 解析 | 27 个「解析」按钮（①×8 + ③×8 + ④×4 + ⑤×1 + 真题×6） |
| 测试 | verify 全绿；smoke 含 20+ 条 Part 3 专属断言（图片/徽章/Tip/下划线/选项盒/扉页标题） |

---

# PET Reading Part 5 · 题型与设计方法（方法代号 M–O）

> 整理自「Training Test 1 · Reading Part 5」（`t1-p5-ice-sculptures`，书 P24–P25）的完整实现
> （2026-10-17）。Part 5 的页面 = 书 P24 训练页 + P25 真题页，一块一段、照书顺序排。
> 参考实现：`pet-reading/articles/t1-p5-ice-sculptures.json`；素材记录：`sources/t1-p5-ice-sculptures.txt`。

## 方法 M · 介词表（真表格 + 逐行作答）—— 训练 ①

**教材形态**：一个两列表格（Adjectives | Preposition），三行形容词各配一个空（1/2/3），
要求用 of / about / with 填空。

**做成什么样**：

```
┌────────────────────────────────┬──────────────┐
│ Adjectives                     │ Preposition  │   ← 真表格，表头来自数据
├────────────────────────────────┼──────────────┤
│ nervous, sad, worried, …       │ 1 [a of][b about][c with][解析] │
│ frightened, fond, proud, …     │ 2 [a of][b about][c with][解析] │
└────────────────────────────────┴──────────────┘
```
行里的形容词照常可以点词查词；点胶囊即作答（对绿错红）。

**数据写法**：
```jsonc
// 这一段一块：段落里的每一句 = 表格的一行；pick 与行一一对应（verify 强制行数=题号数）
{ "r": "q", "pick": [101, 102, 103], "table": { "head": ["Adjectives", "Preposition"] } }
// question.opts = { "a": "of", "b": "about", "c": "with" }（小写键，跟书上一致）
// 表格行不挂页边按钮（构建器自动跳过）；表格块用 <div> 渲染（<p> 里放 <table> 会被拆开）
```

## 方法 N · 真题挖空 + 整排胶囊 —— 第 21–26 题

**教材形态**：一篇短文，六处挖空（21–26），文章下方六排四选一（A–D）。

**做成什么样**：
```
… And it's very 21 to find wonderful sculptures in them. …     ← 正文里的绿色数字小圆标
（文章用 frame 边框盒；照片浮右跨段绕排）
21  [A usual] [B general] [C common] [D familiar] [解析]          ← 六排，每排一条
22  [A develops] [B rises] [C grows] [D builds] [解析]
…
```
点空位=看这道题的解析；点胶囊=作答；「解析」=完整解析（含逐个干扰项）。

**数据写法**：
```jsonc
// 正文段落里写 {21}…{26}；空位必须恰好等于真题题号（n<100），训练题一律写省略号 …………
{ "r": "p", "frame": true, "img": {…} }, { "r": "p", "frame": true }, { "r": "p", "frame": true },
{ "r": "q", "pick": [21, 22, 23, 24, 25, 26] }   // 空段：渲染成六排作答（行号自动取题号）
// 连续 frame 会被 CSS 合成一个外框（.para.framed + .para.framed）
```

## 方法 O · Remember 框（黑标签 + 灰底中文）—— 训练 ③ 旁边的语法提示

**教材形态**：页脚右侧一个「Remember」黑标签 + 灰底中文说明。

**数据写法**：
```jsonc
{ "r": "i", "rmb": "一个动词短语可包括两个或更多部分…（如：get on with someone 意为…）" }
// 空段即可；该段自动加 .rmbwrap（flow-root），浮框不会挤压后面「真题抬头」等段落
// ⚠ 别在一个段落上挂两个并排的 tip：浮框会互相让位，两个中文提示合成一个 tip 字符串即可
```

## 其它沿用说明（Part 5）

- **② 改错句**：照 Part 3 的 **H**（`ul` 红下划线 + 官方订正写进 `ana.tip/gram`），
  不设题；划线取「动词 + 介词」整段（如 `interested on`、`grew in`），因为错的往往是搭配、不是单个词。
- **③ 选词填空**：照 Part 1 的「我的答案」横排（`blocks.pick` + `q.opts` 小写 a–d），
  空格在句子里写省略号 `…………`；每小题一块，胶囊在题干正下方。
- **编号**：训练题从 101 起（① 101–103、③ 104–109；② 不设题），真题 21–26。
- **架构提示**：`inlineQuiz: true`（题目分析 tab 收起）；真题空位沿用 `.blank`，点它 → 小黑板出解析。
- 数据契约、词表 100%、三道防线、视觉验收等与 Part 3 完全相同（见 `reading-part3-提示词.md`）。

## 本次实现的规模（t1-p5，2026-10-17）

| 项 | 值 |
|---|---|
| 文件 | `articles/t1-p5-ice-sculptures.json` |
| 规模 | 30 段 · 38 句 · 406 词 · 15 题（训练 101–109 共 9 题 + 真题 21–26）· 词条 108 条 + 共享词库 287 条 |
| 图片 | `assets/img/t1-p5-ice-sculpture.jpg`（书 P25 鱼形冰雕照片；裁自扫描 x3255,y1768 1270×1988） |
| 方法分布 | ① M（真表格 ×3 行）<br>② H（6 句红下划线 + 解析给订正）<br>③ 横排胶囊 ×6（104–109）<br>Remember O<br>真题 N（{21}–{26} 挖空 + 6 排胶囊） |
| 测试 | verify 全绿；smoke 858（Part 5 新增 190+ 条：表格/Remember/边框盒/空位/六排胶囊） |
