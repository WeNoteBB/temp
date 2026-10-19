# Reading Part 4 设计方法（挖空选句 / Gapped text）

> Part 4 的教材形态：一篇长文挖掉 5 句（16–20），从 8 句 A–H 里选（3 句用不上）。
> 训练页的三道练习：① 同义词配对（两栏 12 对）② 连接词二选一 ③ 连句成段（1–3 配 A–D，多一句）。

---

## 一、方法代号（W–Z）

### 方法 W · 同义词配对（两栏清单 + 成排作答）—— 训练 ①

**教材形态**：A 栏 12 个短语、B 栏 12 个意思，一一配对（本次教材恰好 12 对 1:1）。

**做成什么样**：
```
┌─ A ─────────────────────────────────────┐
│ 1 a lack of  2 get better  3 get in touch … │   ← o 段 + frame（编号 1–12 留在文字里）
└──────────────────────────────────────────┘
┌─ B ─────────────────────────────────────┐
│ a almost never  b by yourself …  l until now │  ← o 段 + frame（小写字母自动提取成徽章）
└──────────────────────────────────────────┘
A [a almost never][b by yourself]…[l until now] [解析]   ← 12 排，行号 1–12
B …
```

**数据写法**：
```jsonc
{ "r": "o", "frame": true }                    // A 栏：句子写 "1 a lack of"（数字留在文字里）
{ "r": "o", "frame": true }                    // B 栏：句子写 "a almost never"（小写字母自动提徽章）
{ "r": "q", "pick": [101, …112] }              // 空段 12 排；tag "①-1"…"①-12" → 行号 1–12
// question.opts = { a: "almost never", …, l: "until now" }（12 枚胶囊）
```

⚠ **引擎口径**：选项清单行的字母提取是 `^([A-Ha-l])` —— 大写只到 H（大写 I 会和代词 I 冲突），
小写放宽到 l（语料里没有以小写 i/j/k/l 开头的句子）。

### 方法 X · 二选一（连接词）—— 训练 ②

**教材形态**：6 个句子，每句行内一对斜杠选项（Another/Other、Although/In spite of…）。

**做成什么样**：句子原样（保留 "Another/Other"），下面两枚胶囊（A/B），解析讲逻辑关系。

**数据写法**：
```jsonc
{ "r": "q", "n": "1", "pick": [113] }          // opts = { A: "Another", B: "Other" }
```
⚠ opts 要**成对**写全（answer === "A" ? {A:key,B:wrong} : {A:wrong,B:key}），别只放答案词。

### 方法 Y · 连句成段（1–3 配 A–D）—— 训练 ③

**教材形态**：三句话各接一个 A–D 的句子组成段落，有一句用不上；找同义词/连接词/指代词。

**做成什么样**：三句各一块（q），每块一排 4 枚**整句胶囊**；用不上的那句（B）的解析说明「为什么没着落」。

**数据写法**：
```jsonc
{ "r": "q", "n": "1", "pick": [119] }          // opts = { A: "As soon as he heard that…", B: "That was why…", C: "However…", D: "So…" }
```
配图（教材线描插图）挂第一句：`"img": { "side": "left", "w": 240 }`。

### 方法 Z · 挖空选句（真题 16–20：cloze 填字母 + 共享选项池）

**教材形态**：文章挖 5 句（空位是印着号码的小框），8 句 A–H 供选，三句用不上。

**做成什么样**：
```
The story of the carrot and the ring        ← h 段 center + img 浮左 + 中文 Tip
Mary had worn her engagement ring…          ← p 段
She was working in her garden… [ 16 ]       ← 空位 = {16} 输入框（填字母）
When she discovered it was missing…         [16 解析]   ← 段尾自动
…
A She was digging up vegetables…            ← o 段选项池（徽章 A–H）
B That gave her a very good idea…
```

**数据写法**：
```jsonc
{ "r": "p" }                                   // 文章段落（角色 p）
// 句子：句尾写 "…pulling out a plant. {16}"（{n} 渲染成输入框）
// 题：没有 opts（= 开放填空），gap: "16"，answer: "C"（判分忽略大小写）
{ "r": "o" }                                   // 选项池：8 句 "A She was…"（徽章自动）
```
⚠ **开放填空的块不要写 pick**（引擎自动排「N 解析」）；选项池要放在文章之后（和教材翻页一致）。

---

## 二、批注（笔记）整理

- **词组/单词类** → `ana.note`（本句词组）：engagement ring / century / pull out / search for / give up /
  apart from / replace / jeweller / in fact / be similar / original ring / eventually / daughter-in-law /
  a bit / belong to / return to / remove / fit / dig up / come off / manage to…
- **整页手写语法讲解**（本次夹在 P63/P64 之间）→ 顶层 `summary` 的纯文字行（带 at/ref）：
  another/other 的区别、although/in spite of 的区别。
- `summaryTip`：两把钥匙（同义词 + 连接词）+ 指代词顺读。

---

## 三、图片

- 教材线描插图 2 张（雾中男孩、双手戒指），4 倍渲染裁图存 `assets/img/t2-p4-*.png`（裁切框见 sources）。
- 文章标题图挂 `{ "r": "h", "center": true, "img": … }`；练习配图挂对应题块。

---

## 四、内容约定（做新一篇 Part 4 时）

1. **答案先官方核对**（Teacher's Notes & Keys）；docx 常漏词（本次漏了 4 个短语）——**以扫描页为准**。
2. 训练题号：① 101 起（本次 101–112）→ ② → ③；真题 16–20。
3. 词表覆盖率 100%；跨篇冲突统一到全部篇。
4. 选句题解析要写「同义词 / 连接词 / 指代词」三查。
5. ⚠ 句型 chip 的成分标签必须能被 PAT_SYN 键匹配（主谓宾→主语/谓语/宾语；主系表→主语/系动词/表语；
   主谓→主语/谓语）——「主句」「分句 1」这类写法会让 chip 变静态。

---

## 五、实现清单（t2-p4，2026-10-19）

| 项 | 值 |
|---|---|
| 文件 | `articles/t2-p4-carrot-and-ring.json` |
| 规模 | 34 段 · 74 句 · 746 词 · 26 题（训练 101–121 共 21 题 + 真题 16–20）· 本篇词条 226 + 共享词库 364 |
| 方法分布 | ① W（两栏 12 对 + 12 排作答）<br>② X（6 题各 2 枚胶囊）<br>③ Y（3 题各 4 枚整句胶囊 + 线描图）<br>真题 Z（5 个 cloze 输入框 + A–H 选项池） |
| 笔记 | `ana.note` 记进 30+ 句；summary 2 条手写语法讲解（another/other、although/in spite of）+ summaryTip |
| 图片 | `assets/img/t2-p4-fog.png` + `t2-p4-hands-ring.png` |
| 测试 | verify 0 警告（31 个跨篇冲突一次统一到全部 10 篇）；smoke 2337 全绿；test-store 144；server 130 |

## 六、t1-p4 补漏（2026-10-19）

t1-p4（digging-into-the-past）是最早期做的：**训练页（书 P21）当时没做、答案未与官方核对**。
本次已核对书后 P185 官方答案，并补上训练页（同 W/X/Y 方法），实现清单见文末附表。
