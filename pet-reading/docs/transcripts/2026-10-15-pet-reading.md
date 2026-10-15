## 用户

好的，前面我提了很多需求，假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右

---

## Claude

我先看看现在的项目结构和生成模式，再给你判断。

---

## 用户

[Request interrupted by user]

---

## 用户

<pasted_content id="527c">
# PET Reading Part 4 精读页 · 生成提示词

把这份文档整段发给 AI，再附上你的题目素材（原文 + 选项 A–H + 答案），即可产出与本项目**完全一致**的单文件 HTML 自学页。

---

## 一、任务

为一份 **剑桥 PET（B1 Preliminary）Reading Part 4「五选句填空」** 素材，生成一个**零依赖、双击即开的单文件 HTML 精读自学页**。

素材包含：

- 一篇挖了 5 个空的英文短文（空位编号如 16–20）
- 8 个备选句 A–H（其中 5 句是答案，3 句是干扰项）
- 答案（**若未提供，必须自行推断并在页面上标注「答案为依据上下文推断，请核对书后答案」**）

你要产出的是**一个可复用工程**，不是一次性页面：内容与代码分离，换一套题目只改数据文件。

---

## 二、交付物与工程结构

```
<工作目录>/
  src/
    template.html      HTML 骨架（占位符 /*__CSS__*/ /*__CONTENT__*/ /*__APP__*/）
    style.css          全部样式
    content.js         全部内容数据（只有这个文件随题目变化）
    app.js             全部逻辑
  build.mjs            把上面四个文件合成一个 HTML
  tools/
    verify.cjs         内容自检（纯数据，无需浏览器）
    smoke.cjs          jsdom 端到端冒烟测试
  <题目名>.html         构建产物 ← 用户唯一需要的文件
```

`build.mjs` 要点：

```js
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const root = path.dirname(fileURLToPath(import.meta.url));
const src = p => fs.readFileSync(path.join(root, "src", p), "utf8");
const guard = s => s.replace(/<\/script>/gi, "<\\/script>");   // 必须，否则内容里的 </script> 会截断
const html = src("template.html")
  .replace("/*__CSS__*/",     () => src("style.css"))
  .replace("/*__CONTENT__*/", () => guard(src("content.js")))
  .replace("/*__APP__*/",     () => guard(src("app.js")));
fs.writeFileSync(path.join(root, "<题目名>.html"), html, "utf8");
```

**用 `.replace(..., () => ...)` 传函数，不要传字符串**——`$&`、`$1` 这类替换模式会被当成反向引用，内容里出现就出错。

技术红线：

- **产出必须是单个自包含 HTML**，CSS/JS/数据全内联，`file://` 双击可开
- **不能用 ES module**（`type="module"`）——`file://` 下会被 CORS 拦死，必须用普通 `<script>`
- **零外部依赖**：不引 CDN、不引字体、不引图标库
- 所有文字用中文，专有名词/术语保留英文

---

## 三、内容数据格式（`content.js`）

整体结构：

```js
window.PET_CONTENT = {
  meta:        { label, note },
  passage:     { title, words, sentences, paragraphs: [[...], ...] },
  phrases:     [ "dig up", "as soon as", ... ],
  glossary:    { "word": { pos, ipa, cn, note }, ... },
  options:     { A: "…", B: "…", ... H: "…" },
  optionsAna:  { A: { pat, frame, parts, clauses, gram, tip, tr }, ... },
  questions:   [ { n, prompt, answer, why, clues, others, tip, ana }, ... ]
};
```

### 3.1 `passage.paragraphs`

二维数组：外层段落、内层句子。**空位写成 `{16}` 内联标记**，位置就在原句里：

```js
paragraphs: [
  [
    { s: "Last year, Kate Marshall was given a very exciting opportunity – to help her father, who's a history lecturer, at a historical site!",
      hard: true,
      tr: "去年，凯特·马歇尔得到了一个非常令人兴奋的机会——去一个历史遗址帮她父亲……",
      ana: { /* 见 3.4 */ } },
    { s: "He was leading a team to dig up and explore the area.", tr: "…", ana: {…} }
  ],
  [
    { s: "{16}So the first job was to remove it all and prepare the land for digging.", tr: "…", ana: {…} }
  ]
]
```

- **每句都必须有 `ana`**，不许漏（页面上每句都能点开讲解）
- `hard: true` 只标长难句（本页不再单独上底色，仅用于 meta 行统计）
- 标点用原文的排版形式：撇号用 `’`（U+2019），破折号用 `–`
- 句子要**逐字照抄**，不要在句内插换行

### 3.2 `phrases` 词组表

字符串数组，**必须是小写、空格分隔、且在原文或选项里真实存在**：

```js
phrases: ["dig up", "as soon as", "instead of", "made sense", "in fact", "a bit", ...]
```

要求：

- **最长优先、互不重叠**匹配
- 只有相邻词之间**全是空白**才算一个词组（中间夹标点就不算）
- 每组必须**同时**在 `glossary` 里有对应词条，否则点开是空的
- 连字符词（`no-one`、`everyday`）在分词时是**一个 token**，所以词组里也要这么写
- 缩写（`wasn't quite`）同理——写 `not quite` 永远匹配不上

### 3.3 `glossary` 词条表

**key 必须小写**。字段：

| 字段 | 说明 |
|---|---|
| `pos` | 词性，如 `n.` `adj.` `v.` `phr.` `缩写` `modal`。可写复合：`adj./adv.` |
| `ipa` | **英式 RP 音标**，带斜杠，如 `/ˈlektʃərə/` |
| `cn` | 中文释义。可含 HTML（`<b>` `<code>`），颜色/加粗用得上 |
| `note` | 可选，用法讲解。可含 HTML |

```js
"lecturer": { pos: "n.", ipa: "/ˈlektʃərə/", cn: "讲师（大学教师）", note: "词根 lecture（讲课）。" },
"instead of": { pos: "phr.", ipa: "/ɪnˈsted əv/", cn: "而不是，代替",
                note: "<b>后面必须跟名词或动名词 doing</b>，不能跟动词原形。" }
```

**覆盖率要求**：原文 + 选项里的**每一个词形都要有词条**，一个不许漏。基础词（`a/the/of/was/had/would/...`）也要给，否则点了显示"未收录"。

覆盖率必须由 `verify.cjs` 强制校验（见第六节）。**注意：校验必须同时扫原文和选项**——早期版本只扫原文，漏了选项里 26 个词，页面上一堆"未收录"。

查词回退顺序：原形 → 小写 → 去 `'s` → `-ies→y` → `-es/-s` → `-ing/-ed`（含双写辅音还原）→ `-er/-est`。不规则形式（`found` `kept` `given` `dug`）直接建条目。

### 3.4 `ana` 句子分析

七个字段，**缺一不可**：

```js
ana: {
  pat: ["主谓宾", "被动语态", "非限制性定语从句"],   // 句型，pat[0] 是主句型
  frame: "主干：<b>Kate Marshall was given an opportunity</b>（凯特获得了一个机会）",
  parts: [
    ["主语", "Kate Marshall"],
    ["谓语", "<code>was given</code> —— 一般过去时的被动语态"],
    ["宾语", "a very exciting opportunity"]
  ],
  clauses: ["非限制性定语从句 who's...", "不定式作同位语"],
  gram: ["被动语态", "非限制性定语从句"],
  tip: "被动语态直译是「被给予」，中文习惯说成<b>「得到了」</b>。",
  phrases: ["dig up"]
}
```

- **`pat[0]` 必须取自封闭五项集**：`主谓宾 / 主系表 / 主谓双宾 / 主谓 / 倒装引语`。`pat[1..]` 自由，写从句类型、语态、特殊结构
- **`parts` 里第三项（片段）尽量用 `<code>` 包住**——「点句型→标红」靠它定位
- `parts` 每一项是 `[成分名, 内容]`。成分名要短（`主语` `谓语` `非限制性定语从句`），页面上一行不换行
- 没有 `<code>` 的成分，页面会退回取内容开头的英文片段（遇到中文/全角括号就停）
- **`<code>` 里不要写原文中没有的东西**。想表示省略常写 `(that)` `(and)`，页面有兜底会去掉括号再找一次，但**能不加就不加**

### 3.5 `options` 与 `optionsAna`

`options` 是 8 个字母到句子的映射。`optionsAna` 是**同样 8 个字母**各自的句子分析，字段与 `ana` 完全一致（`pat` / `frame` / `parts` / `clauses` / `gram` / `tip` / `tr`）。

选项也要按句子分析对待——它同样是英语句子，同样可点词、词组标黄、点开讲解。

### 3.6 `questions` 题目

```js
{
  n: 16,
  prompt: "第 16 空（段首）—— 前一段结尾是「现场和凯特预想的不太一样」",
  answer: "D",
  why: "上一段刚说「现场跟凯特想的不一样」，D 句 <b>In fact, the whole area was actually still covered in grass</b> 正好解释……",
  clues: ["In fact 表解释说明", "the whole area ↔ the site", "it all 的指代"],
  others: [
    ["E", "<b>It was a bit sad to see it disappear.</b> —— it 没有指代对象，逻辑顺序也反了。"],
    ["F", "……"],
    ["H", "……"]
  ],
  tip: "五选句填空的第一步永远是<b>看代词</b>。",
  ana: { parts: [...], gram: [...], tr: "答案句翻译" }
}
```

- `answer` 必须是 `options` 里真实存在的字母
- **5 个答案互不重复**，干扰项正好 3 个
- `others` 列出**其余 7 个选项各自为什么不行**，每条以字母开头
- `prompt` 描述空位位置和上下文线索（页面直接展示）
- 这个字段是**答题解析**的数据源：某选项作为答案时用 `why/clues/tip`，作为干扰项时从各题的 `others` 里汇总

---

## 四、界面规格

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ PET 精读  [原文+题目 | 题目与答案]   ▣小黑板 ▣历史 做题模式 … │
├──────────────────────┬──────────────────┬───────────────────┤
│  第一列：原文 + 题目   │  第二列：小黑板   │  第三列：历史      │
│     1.66fr           │     1.33fr       │     .86fr         │
└──────────────────────┴──────────────────┴───────────────────┘
```

- 三列等宽比例 **1.66 : 1.33 : 0.86**（左侧两列 = **1 : 0.8**，历史列是相对基准的 2 倍）
- 每列 `.col`：白底、圆角、阴影、内部独立滚动
- 列头：标题 + 灰色提示 + 收起按钮 `✕`
- 收起组合：`hide-ana` / `hide-vocab` / 两者都收（原文全屏），三种情况各自重算列宽

### 4.2 顶栏

- 品牌：`PET 精读` + 小字标注（如 `Exam Practice Test 1 · Reading Part 4`）
- 标签页：**原文 + 题目** / **题目与答案**
- 开关：`▣ 小黑板`、`▣ 历史`（选中态蓝色，收起后变成 `▢`）、`做题模式`、`⏹ 停止朗读`、`清空历史`
- 语音警告条：挑不到英音时显示黄条提示

### 4.3 第一列：句子连续排版

**这是本页最特殊的排版，必须严格照做：**

- 句子是 `display:inline` 的 `<span class="sent">`，**一句接一句连排，句与句之间不换行**，像普通段落一样自然折行
- **隔一句一个淡黄底**（`#fdf6da`），交替出现，用来区分句界。第 1 句有底、第 2 句没有、第 3 句又有……
- 底色交替用**跨段落的全局句序号**决定，不是每段重新计数
- 用 `box-decoration-break:clone` 让折行后每一段都带上内边距
- 交互态：hover 淡蓝、当前选中 `cur` 蓝色加边框、**悬停页边「析」按钮时对应句变粉**（`#ffd6e8`）
- 长难句**不再单独上底色**——那会盖掉交替节奏

**页边按钮（右侧悬挂）：**

- `#passage` 右侧留 **58px** 页边，里面绝对定位一组组按钮
- 每句一组：`析`（打开讲解）+ `🔊`（朗读）
- 每组对齐到**它那句第一行的位置**
- 同一行起了两句时，后一组往下让位，不许重叠
- 窄屏（≤1180px）页边放不下 → 隐藏按钮栏，喇叭改从小黑板顶部调用

> **纯 CSS 做不到这件事**：句子是 inline，绝对定位子元素的包含块是「首尾行片段的并集」，左右边界会落在最长那行的末尾而不是容器右缘，按钮会参差不齐。**必须用 JS 量**：`Range` 定位到句子第一个文本节点，取 `getBoundingClientRect().top` 得到第一行顶边，再逐个摆。窗口 resize 防抖重算，`document.fonts.ready` 后也重算一次。

**词与词组：**

- 每个词一个 `<span class="w" data-w="原词形">`，点击 → 小黑板显示词条
- 词组 `<span class="ph" data-ph="小写词组">`，黄底 `#ffe98a`，点击 → 小黑板显示词组词条
- **单词优先于词组**：被词组包住的词，点它仍然查那个词。词组通过词条卡片里的「包含它的词组」入口进入
- 空位 `{16}` 渲染成绿色圆角小标签，点击 → 跳到题目分析页并展开该题

**题目区（文章下方）：**

- 分隔标题 `题目 · Questions 16–20`
- 选项池：每条 = `[字母圆标] [句子（词可点、词组标黄）] [句子分析] [🔊] [答题解析] [→ 第 N 空 / 干扰项]`
- 三个按钮配色区分：句子分析紫、朗读中性、答题解析绿
- **原文页不放 16–20 的题卡**，每题解析从选项的「答题解析」进

### 4.4 第二列：小黑板

三种内容，共用一个渲染区。

**（a）词条**（点词/词组）

```
词条                                    🔊 0.75×
┌────────────────────────────┐
│ lecturer  /ˈlektʃərə/      │  ← 灰底、圆角、加粗
└────────────────────────────┘
释义   [n.] 讲师（大学教师）
用法   词根 lecture（讲课）。
原文   ……a history <em>lecturer</em>, at a historical site!
包含它的词组： [history lecturer]
```

**（b）句子分析**（点句子 / 点「析」 / 点历史里的句）

- **顶部吸顶块**：标题「句子分析」+ 喇叭，下面原句（灰底圆角、加粗、字号紧凑）
- **滚动时这个块固定在面板顶部**，否则翻到下面就看不到原句了
- 板块按**重要性递减**排列（面板宽而矮，先看到的必须是最核心的）：

  1. **句型** — 可点 chip
  2. 翻译
  3. 句子骨架
  4. 成分拆解 — 竖排圆角卡片，成分名在上、内容在下；**底色按序号从浅灰递深到深灰**（明度 95% → 51%），明度低于 72% 时自动切白字
  5. 从句 / 语法点
  6. 本句词组
  7. 考点
  8. 翻译思路

**句型 chip 的点击行为（重点）：**

- 点某个句型 → **在原句里把对应片段标红**（红底 `#ffd9d9`、深红字 `#b32020`、外发光）
- 同时做 **1.1 → 1.0 的缩放动画**凸显
- 点另一个句型 → **先清掉上一次的标记**，再重新标
- 点自己一次 → 取消标记
- 切换句子 → 标记不残留

> **`transform` 对纯 inline 元素无效**。原句是 inline 文本，所以动画期间要临时挂一个类把它变成 `inline-block`，播完（约 520ms）再摘掉，否则一个长片段会拒绝折行、撑破容器。

> **标红不要用 HTML 字符串替换**。短片段（如 `It`）的正则可能匹配进 `class="hl"` 这种标签名里。正确做法：原句容器里只有一段纯文本，直接在**字符串上算位置**，再重新拼 HTML。

**句型 → 成分的映射**（不用手工给每句标对应关系，从 `ana.parts` 推）：

- 先查同义词表（主句型是固定搭配）：

  | 句型 | 对应成分标签 |
  |---|---|
  | 主谓宾 | 主语 / 谓语 / 宾语 |
  | 主系表 | 主语 / 系动词 / 表语 |
  | 主谓双宾 | 主语 / 谓语 / 间接宾语 / 直接宾语 |
  | 主谓 | 主语 / 谓语 |
  | 倒装引语 | 倒装 / 谓语 + 主语 |
  | 被动语态 | 被动 |
  | as…as 比较句 | 比较状语从句 / 比较从句 |
  | with 复合结构 | 伴随状语 |
  | 不定式作目的状语 | 目的状语 |
  | 定语从句嵌套 / 限制性 / 非限制性定语从句 | 定语从句 |

- **匹配要试三个方向**：① 成分标签包含句型名 ② **句型名包含成分标签**（`不定式作目的状语` ↔ `目的状语`）③ 成分描述里提到过句型名。只做①会让近一半句型点不动
- 取出命中成分的 `<code>` 片段；没包 `<code>` 的退回取描述开头的英文；**片段若不在原句里字面出现则丢弃**
- 长片段优先匹配，重叠的跳过

**（c）答题解析**（点选项的「答题解析」）

```
答题解析 · 选项 A                        🔊 0.75×
┌────────────────────────────┐
│ It turned out to be a small figure of a horse. │
└────────────────────────────┘
它是第 20 题的答案
    为什么选它的完整说明……
线索词 / 衔接   [In fact 表解释说明] [it all 的指代] …
别的题里它也出来搅局
    第 16 题 — ……
做题方法
    ……
```

- 该选项**是某题答案** → 显示「它是第 N 题的答案」+ `why` + `clues` + `tip`
- 该选项**是干扰项** → 显示「它不填任何空」+ 它在各题 `others` 里被提到的理由
- **这个动作不写入历史**（见 4.5）

### 4.5 第三列：历史

- 点过的词、点过的句子，各记一行，**最新的在最上面**
- 每行开头是**圆圈徽标**：词 = 蓝底「词」，句 = 橙底「句」
- **词行**：英文加粗 + 中文释义（两行；音标和词性不放，点开小黑板就有）
- **句行**：原句的**前 4 个词 + 空格 + `…`**
- **同一个再点一次 → 提到最上面，不新增行**（去重）
- 点整行 → 重新显示在小黑板
- 行尾 `✕` 删除单条
- 存 `localStorage`，关掉再开还在
- 顶栏「清空历史」一键清空（有确认框）
- **答题解析不进历史**，也不高亮任何历史行

> 行是 `<div>`，里面两个**平级**的 `<button>`（打开 / 删除）。**`<button>` 不能嵌套 `<button>`**，那样是无效 HTML。

### 4.6 朗读

- 用浏览器自带 `speechSynthesis`
- `lang = "en-GB"`、`rate = 0.75`、`pitch = 1`
- 音色优先级：英音里带 `natural|online|neural` 的 → 英音常见音色名（Libby/Sonia/Hazel/Ryan/George…）→ 任意英音 → 任意英语
- **`getVoices()` 首次常返回空数组**，必须监听 `voiceschanged` 并额外 `setTimeout` 重试几次
- 挑不到英音时，顶栏显示黄色警告条说明退回到了什么
- **喇叭互斥**：每次朗读前先 `speechSynthesis.cancel()`，否则会叠在一起读
- 正在朗读的按钮加高亮类，结束后移除

### 4.7 做题模式

顶栏开关，打开时给 `<body>` 加类，**把填入的答案句藏起来**（变灰、去底色），可以把文章当题目自测。

---

## 五、必须遵守的技术约束

1. **单文件产出**，零依赖，双击可开
2. **不用 ES module**，`file://` 下 `type="module"` 会被 CORS 拦死
3. 所有状态用 `localStorage`，key 加版本号（如 `pet-hist-book1-v1`）
4. 存储结构变更时**写迁移逻辑**兼容旧数据（`if ("new" in o) … else if ("old" in o) …`）
5. 所有 `localStorage` 读写包 `try/catch`（隐私模式下会抛异常）
6. 点词/点句一律走**事件委托**，不要给每个词单独绑定
7. 渲染用 `innerHTML` + 字符串拼接时，**所有来自数据的文本必须转义**（`& < > "`）
8. 没有 `speechSynthesis` / `scrollIntoView` 等 API 时**不许崩**，先判断存在性

---

## 六、自检与验收

### 6.1 `tools/verify.cjs`（纯数据，不需要浏览器）

用 `node -e` 或 `require` 载入 `content.js`（先 `global.window = {}`），检查：

- 段落/句子/词数与 `passage` 里声明的数字一致
- **每一条 `phrases` 都真的在原文或选项里逐词出现**（相邻词之间只有空白）
- 每条 `phrases` 在 `glossary` 里都有词条
- **词形覆盖率 100%**：原文 + **选项**里每个不重复词形都能查到词条
- **`pat[0]` 全在白名单内**，且每句 `pat` 非空
- 答案互不重复、干扰项正好 3 个、答案字母都在 `options` 里
- 手打 `ana.phrases` 与正文实际词组的一致性

### 6.2 `tools/smoke.cjs`（jsdom 端到端）

用 `jsdom` 把构建产物真跑一遍（`runScripts: "dangerously"`）。**必须等 `load` 事件后再断言**，jsdom 是异步解析的。

关键断言（本项目的卡口，共 175 项）：

- 首屏：词 span 数、黄标词组数、句子数、空位数
- **逐字比对**：每句渲染后的文字与源数据完全一致（防丢字、防吞空格）
- 交替底色：22 句里恰好 11 句带底色，且第 1 句有、第 2 句没有、第 3 句有
- 页边：每句一组按钮、归属正确、**按钮不在句子内部**
- 点词 → 小黑板出词条 + 历史加一行；屈折形式能回退查到原形
- 词组里的词仍能单独点
- 点句 → 小黑板出讲解；成分卡片底色两两不同
- 句型 chip **全篇一个都不能定位不到**（正文 + 选项各一条卡口）
- 标红：点 chip 后 `.hl` 数量与内容正确、换 chip 先清后标、再点取消、换句不残留
- 答题解析：作为答案 / 作为干扰项两种情况都对，**且历史行数不变**
- **全量扫描每个可点元素，不许出现空面板**
- 列显隐 4 种组合 + 列头 `✕` + 状态持久化
- **解析 CSS 里的 fr 数字**，验证列宽比例没跑偏

### 6.3 jsdom 测不到的（必须人工在浏览器里看）

- 页边按钮是否**真的对齐**到各句首行（jsdom 不做排版计算）
- 窄屏（拖到 1100px）是否单列堆叠
- 缩放动画的手感、标红与既有底色的搭配
- 实际发音

---

## 七、已知的坑（血泪清单，逐条都踩过）

| # | 坑 | 现象 | 正确做法 |
|---|---|---|---|
| 1 | **扫描版 PDF 无文字层** | `pdftotext` 只出 2 字节 | 先判断有无文字层；没有就渲染成图当图片读。缺 poppler 时用 npm 的 `mupdf` 渲染：`page.toPixmap(Matrix.scale(3,3), …)` |
| 2 | **中文引号被规范化成 ASCII 引号** | JS 字符串被提前截断，语法错误 | 写完内容后扫一遍：中文行文里的内层引号必须是 `“”`（U+201C/D）。判定规则——引号后一个字符是字母/数字/汉字 → 左引号，否则右引号；后一个字符是 `,:}])` 或换行 → 那是 JS 的定界符，保留 |
| 3 | **词组相邻性判断写成 token 下标** | 词组一处都标不上黄 | 词与词之间夹着空格 token，下标永远不相等。要单独判断「两词之间的 token 是否全是空白」 |
| 4 | **词组渲染吞空格** | 标黄后 `dig upand` 粘一起 | 词组渲染完把下标推到词组末尾，后面的标点/空格交回主循环，不要自己跳过 |
| 5 | **词组抢走单词的点击** | 点 `opportunity` 出来的是整个词组 | 处理顺序必须**单词优先**，词组通过词条卡片的入口进 |
| 6 | **`grid-area` 在媒体查询里的规范坑** | 窄屏不是堆叠，而是凭空多出隐形列 | `hidden` 的列必须 `display:none`；窄屏要显式重置 `grid-area:auto`——按 CSS Grid 规范，找不到同名线时「所有隐式网格线都视为具有该名字」，元素会被丢进隐式轨道 |
| 7 | **网格行用裸 `1fr`** | 内容一长就撑爆行高，把左栏顶出视口 | 行轨道写 `minmax(0,1fr)`，格子里补 `min-height:0` |
| 8 | **`toggleCol(+key)` 的隐式类型转换** | 按钮点了没反应，全程不报错 | 状态键改成字符串后要**去掉 `+`**。这类「测试全绿但功能坏了」的坑最阴 |
| 9 | **全量重刷重置展开态** | 展开一条后点别的词，展开的又收起来 | 展开态存在 JS 变量里，每次渲染从它还原，不要只写 DOM class |
| 10 | **`<button>` 嵌套 `<button>`** | 无效 HTML，行为不可预测 | 行用 `<div>`，内部两个平级 `<button>` |
| 11 | **`transform` 对 inline 无效** | 缩放动画完全不生效 | 动画期间临时变 `inline-block`，播完摘掉 |
| 12 | **`data-q` 在文档顺序上串位** | 打开错误的题卡 | 同一题在多处出现时，用不同属性名（如 `data-qmini`），或把选择器限定到具体容器 |
| 13 | **覆盖率检查漏扫选项** | 报 100% 覆盖，页面上却一堆「未收录」 | 校验必须**同时扫原文和选项**。选项里的词同样可以点 |
| 14 | **HTML 字符串替换做标红** | 短片段匹配进标签名，或把已包的标签再包一层 | 在纯文本上算位置，再重新拼 HTML |
| 15 | **句型匹配只做一个方向** | 近一半句型 chip 点了没反应 | 三个方向都试（标签含句型 / 句型含标签 / 描述里提到） |
| 16 | **`<code>` 里写了原文没有的东西** | 片段定位失败，标红标不上 | 尽量原文照抄；`(that)` 这类括号插入要有去括号重试的兜底 |
| 17 | **点正文非单词区域** | 面板保持原样，看起来像「显示为空」 | 空 key 直接不动面板；查不到内容的统一给「未收录」，不要渲染空卡片 |
| 18 | **`replace` 传字符串做模板替换** | 内容里的 `$&` `$1` 被当反向引用 | 一律传函数 `() => content` |

---

## 八、参考实现基线

本提示词对应的工作版本（`Digging into the past`，Exam Practice Test 1 · Reading Part 4）：

| 项 | 值 |
|---|---|
| 段落 / 句 / 词 | 7 / 22 / 319 |
| 长难句 | 12 |
| 词组 | 44 条 |
| 词条 | 281 条（覆盖原文 + 选项的不重复词形 202 个，100%） |
| 选项 / 选项分析 | 8 / 8 |
| 题目 | 5 题（16:D 17:F 18:C 19:G 20:A，干扰项 B/E/H） |
| 代码量 | `app.js` ~1270 行、`content.js` ~1060 行、`style.css` ~440 行、`template.html` ~80 行 |
| 测试 | `smoke.cjs` 175 项全绿、`verify.cjs` 内容自检全绿 |

---

## 九、给你的执行指令

拿到这套素材后，按以下顺序做：

1. **先读素材，输出一份内容清单**给我确认：段落数 / 句数 / 空位位置 / 8 个选项 / 你推断的答案与理由（若素材未给答案，明确标注「答案为推断」）。**不要在这一步就写代码。**
2. 搭工程骨架（`build.mjs` + `src/` 四个文件 + `tools/` 两个脚本）
3. **先把 `verify.cjs` 写出来**，再照着它的要求填 `content.js`——这样内容一填完就能立刻知道哪里缺
4. 填 `content.js`：`passage` → `phrases` → `glossary` → `options` → `optionsAna` → `questions`
5. 写 `app.js` / `style.css` / `template.html`，实现第四节的界面规格
6. 跑 `verify.cjs`，把覆盖率补到 **100%**
7. 写 `smoke.cjs`，跑通全部断言
8. `node build.mjs` 出成品，打开浏览器人工确认第七节末尾列的四件事

**每一步做完都报告结果，尤其是测试失败项——不要跳过失败的断言直接说「完成」。**
</pasted_content id="527c">

---

## Claude

看完了。结论分两半——**服务端完全不是问题，生成端才是**，而且生成端的问题会随着篇数线性放大。

---

## 一、服务端：2C2G + 1w 用户，扛得住

我实测了构建产物的压缩率：

| | 大小 |
|---|---|
| 原始 HTML | 164,644 字节 |
| **gzip** | **49,025 字节**（压缩到 30%） |
| brotli | 41,399 字节 |

静态文件、零后端、零数据库、零 API —— nginx 在 2 核上服务这种小文件是几千 req/s 的量级，你的峰值顶多几百。**CPU 和内存根本不是瓶颈，带宽才是**，而且只在一种情况下才是。

算一笔账：1w 人各看一篇 = 490MB 总流量。摊在一个月里可以忽略。但如果是国内云服务器常见的 1–5 Mbps 带宽，5 Mbps ≈ 625KB/s ≈ **每秒 12 个人同时打开就占满了**。平时没事，老师上课让全班同时打开的那个瞬间会卡。

三个措施就够，成本基本为零：

1. **开 `gzip_static`** —— 构建时生成 `.gz` 文件，nginx 直接发预压缩的，连压缩 CPU 都省了
2. **缓存头拉满** —— 文件名带内容哈希 + `Cache-Control: immutable, max-age=31536000`，用户回访 0 请求
3. **前面挂 Cloudflare 免费版** —— 静态文件是 CDN 的最佳场景，挂上去之后服务器直接退出链路，1w 还是 100w 都一样

⚠️ **唯一会真正搞死服务器的架构决定：别把几十篇文章塞进同一个 HTML。** 164KB × 50 篇 = 8MB，手机用户会直接关掉。一篇一个文件 + 一个目录页。

---

## 二、生成端：现在的模式会越来越吃力

现在每一篇都是**一个完整工程**：src 四个文件 + tools 两个脚本 + build，全套来一遍。我看了下体量：

| 文件 | 行数 | 换一篇文章要不要重写 |
|---|---|---|
| `app.js` | 1334 | ❌ 不用，但现在是复制的（已经在漂移——目录里躺着 127KB 的 1.0 版和 164KB 的现版） |
| `style.css` | 481 | ❌ 不用 |
| `template.html` | 83 | ❌ 不用 |
| `content.js` | 1061 | ✅ **只有这个变** |

也就是说 **~1900 行的引擎，每篇文章都在完整重来一遍**。这是最大的浪费。

剩下 `content.js` 的 1061 行里，`glossary` 占 ~303 行（281 条词条，每条要 pos + IPA + 中文 + note），**这是纯机械劳动，占了近 30%，而且重复率极高**——同一本书里 `a/the/of/was/would` 这些，第二篇还得再写一遍。

另外两个会放大的问题：

- **IPA 靠 AI 背，这是准确性问题不只是效率问题**。281 条音标里错几个你很难发现，但学生照着念就错了。
- **跨文章的 localStorage 会串**。我查了 [app.js:9](src/app.js#L9)：三个 key 是 `pet-hist-book1-v1` / `pet-ui-book1-v2` / `pet-zoom-book1-v1`。同域名下它们是**共享 origin** 的 —— 第二篇文章如果直接复用引擎，学生看 A 篇点过的词会出现在 B 篇的历史里。UI 和缩放共享是对的，**历史必须按篇隔离**。

---

## 三、建议：从「一篇 = 一个工程」改成「一个工程 = N 篇数据」

```
pet-reading/
  engine/   app.js  style.css  template.html   ← 冻结一次，全书共用
  articles/ t1-p4-digging.js  t1-p3-xxx.js …   ← 每篇只写这个
  data/     glossary-core.js                   ← 跨篇共享词库
  tools/    verify.mjs  smoke.mjs  indexgen.mjs
  dist/     *.html + index.html                ← 批量产出
```

改造后每篇的活变成「填一个数据文件」，而且能自动化掉一大块：

1. **覆盖率 diff 脚本** —— 扫原文+选项，输出「已收录 / 缺这 47 个词形」的清单，你只补缺的
2. **IPA 走工具**：`espeak-ng -v en-gb --ipa "lecturer"`（`brew install espeak-ng`，机器上还没装）出初稿，AI 只写中文释义和用法 note，再抽检。省事是其次，**准是主要的**
3. **共享词库** —— 功能词和 B1 高频词全书只写一次，第二篇起 glossary 工作量大概能砍一半
4. **批量 verify** —— 一次校验全部文章，还能做跨篇一致性检查（同一个词在两篇里的 IPA/释义是否打架）
5. **批量 build + 自动生成目录页 + 文件名带 hash**

粗估：一篇的产出量从 ~1060 行降到 500–600 行，而且那 500 行是真正需要人（和 AI）判断的句子分析、翻译、题目解析——那部分本来就该花时间。

---

要我现在把这套多文章工程搭起来吗？把现有这篇 `Digging into the past` 作为第一篇迁进去，跑通验证，之后你新素材直接丢过来就行。

搭之前想先跟你确认一件事：**你是打算把 HTML 放到服务器上让学生访问，还是发文件给学生双击打开？** 这决定了 localStorage 隔离和目录页那部分要怎么做——`file://` 下每个文件的存储行为跟 https 同域名是两码事。

---

## 用户

我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等

---

## Claude

这个规模值得认真算一下。先测几个真实数字再回答。

---

## Claude

实测数据出来了，正好是个 50/50 的切分：

| | 原始 | gzip |
|---|---|---|
| **引擎**（app.js + style.css + template） | 78 KB | **24.5 KB** |
| **内容**（content.js） | 86 KB | **24.4 KB** |
| 合计（现在的自包含产物） | 164 KB | 49 KB |

这组数字基本决定了答案。

---

## 一、直接回答：不用换栈，Vue / uni-app 都不解决你的问题

**先看 uni-app：绝对不行。** 你现在这个页面最核心、最花功夫的功能是**页边「析 / 🔊」按钮对齐到每句首行**——它靠 `Range.getBoundingClientRect()` 量 inline 文本的真实排版位置。小程序没有 DOM，这个 API 不存在，这个功能直接做不了。第 4.3 节和血泪坑 #11、#14 整块都得推翻重设计。uni-app 是「要发小程序/App 时的跨端方案」，不是「网页性能方案」——如果那是你的产品目标，那是**另做一个端 + 交互降级**，不是重构。

**再看 Vue。** 它擅长的是组件化、响应式状态、路由——而这三块你已经写完了，而且不难。真正难的三块是：

1. 页边按钮对齐（要量真实排版，框架帮不上）
2. 「单词优先于词组」的点击优先级（事件委托 + token 下标，框架帮不上）
3. 句型 chip → 原文片段标红（纯字符串位移 + 重拼 HTML，第 14 条明确说**不能用 HTML 替换**，在 Vue 里反而要和 `v-html` 的更新时机打架）

**框架帮你解决的是你已经解决的问题，你真正的问题它一个都不碰。** 与之相对，代价很实在：Vue 3 生产运行时 gzip 后跟**你现在整个引擎差不多大**（24.5 KB），加上重写 1334 行调好的 `app.js` 和那 18 条用血换来的坑——**这笔买卖是负收益。**

---

## 二、200 篇真正需要改的是两件事，都在架构层，不在框架层

### A. 引擎与内容分离 —— 用户每篇少下一半

上面那张表就是答案。现在每篇文章都把 24.5 KB 的引擎重新打包一遍。200 篇 = 引擎被复制 200 次。

分离之后（引擎走外部 `app.js` / `style.css`，缓存永久，内容内联）：

| | 现在 | 分离后 |
|---|---|---|
| 第 1 篇 | 49 KB | 49 KB |
| 第 2–200 篇 | 每篇 49 KB | **每篇 24.4 KB** |
| 读完 200 篇的用户 | 9.8 MB | **4.9 MB** |

**省一半，而且是每个用户省一半。** 1w 用户读完 200 篇，光流量就省掉约 49 GB。

关键点：**外置引擎不会破坏「双击即开」**。`file://` 下被拦的是 ES module、`fetch`、`XHR`，而经典 `<script src="app.js">` 和 `<link rel=stylesheet>` 是放行的。所以产物仍然是一个目录、双击 `xxx.html` 就能开。

### B. 词库从「每篇重写」变成「全书一次」

这是 200 篇真正的成本黑洞：

- 现在一篇 = 281 条词条
- 200 篇 naive 累加 = **56,200 条**
- 但里面 `a / the / of / was / would / by / from` 这些功能词，每篇都在重写

如果先建一个**全书共享词库**（一次性，用工具生成 IPA + AI 写释义），之后每篇只补新增词。第二篇起每篇可能只需要补 100–150 条，**而且越往后新增越少**——PET 级别的词汇总量是有限的。粗估整体能砍掉 60% 以上的词条工作量，同时顺带解决跨篇一致性（同一个词在两篇里 IPA 不一样这种事）。

---

## 三、建议的架构

不引入任何框架，还是零依赖，但结构变一下：

```
pet-reading/
  engine/            app.js  style.css   ← 冻结，200 篇共用，缓存永久
  data/
    glossary.core.json      共享词库（一次性建设，逐篇增长）
    manifest.json           书 / Test / Part 层级 + 文章清单
  articles/
    t1-p4-digging-into-the-past.json     ← 每篇只写这个
    t1-p3-xxx.json
    …
  tools/
    verify.mjs        批量校验全部文章（覆盖率 / IPA 一致性 / 答案合法性）
    ipa.mjs           调 espeak-ng 生成音标初稿
    new.mjs           给新素材生成 content 骨架 + 缺失词条清单
    build.mjs         增量构建：只重建改动过的篇
  dist/
    index.html        目录页（从 manifest 生成）
    <slug>.html       每篇一个独立 URL
    engine/*          引擎文件（带内容哈希）
```

几个要点：

- **一篇一个独立 URL**，好分享、好收藏、可被搜索，而且全页刷新天然避免了跨篇状态泄漏（你那个历史面板）
- **manifest 驱动**：目录页、上一篇/下一篇、构建目标全从它生成，200 篇不可能手工维护导航
- **内容用 JSON 不用 JS**：能直接批量加载做去重和交叉校验，也避开血泪坑 #2 那类引号问题
- **localStorage key 必须带 slug**：现在 `pet-hist-book1-v1` 写死在 [app.js:9](src/app.js#L9)，同域名下 200 篇会共用一个历史列表。UI 显隐和缩放可以共享（本来就是用户偏好），**历史必须按篇隔离**
- **别做 SPA**：200 篇用一个 shell + 路由，收益只是省一次页面刷新，代价是引入路由状态和一篇的脏状态带到另一篇的风险。独立页面更稳

---

## 四、服务端：200 篇规模下，CDN 从「可选」变成「建议」

200 篇的内容总量约 5 MB（gzip 后），磁盘上毫无压力。真正变的是流量：读完 200 篇的用户约 4.9 MB，1w 人就是**几十 GB 量级**。

**这些全是静态文件——是 CDN 的最佳场景。** 挂上 Cloudflare 免费版（或直接扔对象存储 / Cloudflare Pages），你的服务器就基本退出链路了，2C2G 扛 1w 还是 10w 没区别，成本是 0。

反过来说一句实话：**如果内容全静态 + CDN，你的 2C2G 服务器在这件事上其实是多余的。** 它可以省下来专门跑 API，或者干脆不用。

---

## 五、那什么时候才真需要后端？

只有当你需要下面这些**状态**的时候：

- 账号、跨设备学习进度、错题本
- 老师/班级看学生数据、统计报表
- 内容付费、权限控制

如果只是「把内容给学生看」，**永远不需要后端**，加了只是给自己增加数据库、会话和单点故障。

真要加的时候，正确的形态是**并挂，不是替换**：

```
内容  →  静态文件 + CDN        （重流量，完全不碰服务器）
API   →  2C2G 上的薄后端       （只传几 KB 的 JSON）
```

1w 用户每天同步 5 次进度 ≈ 5 万请求/天 ≈ 平均 0.6 req/s，峰值几十 —— 2 核跑 Node/Python + SQLite/Postgres 绰绰有余。**唯一会压垮它的做法，是让内容也走后端。**

---

## 六、还有一件比技术选型更要紧的事

200 篇 × 1061 行 = **21 万行内容**。这个量级不可能靠「一次会话产一篇 + 人工确认」的模式完成，那会变成 200 个长会话，每篇还都要重新踩一遍坑。

所以除了架构，内容策略也得跟着变：

1. **质量分档** —— 不是每篇都值得 281 条释义 + 每句 7 字段分析。可以分「精读篇（全量）／常规篇（句子分析 + 题目，词库走共享）／泛读篇（原文 + 题目）」。这一条直接决定总成本是一个月还是半年。
2. **流水线化** —— 每篇走同一条确定性流程：素材 → 骨架生成 → 填内容 → 自动校验 → 构建。**质量靠校验脚本保证，不靠人工复查**——你已经有 `verify.cjs` 和 175 项 smoke 断言了，把它升级成批量版，这是这个项目最值钱的资产。
3. **IPA 走工具不靠 AI 背** —— `brew install espeak-ng` 后 `espeak-ng -v en-gb --ipa "lecturer"` 出初稿，AI 只写中文释义和用法 note。这是 5.6 万条词条规模下唯一现实的做法，也是准确性问题不只是效率问题。

---

## 结论

**不换技术栈，换组织方式。** 你的技术选型（零依赖单文件 + 原生 JS）在 200 篇、1w 用户的规模下依然是对的——它简单、快、没有运维负担。要改的是：引擎抽出来共用、词库全书化、内容 JSON 化 + 清单驱动、构建批量化、前面挂 CDN。

**唯一需要你拍板的产品问题是：要不要做小程序 / App？** 
- 不要 → 现在这套继续用，重构一次结构，之后 200 篇顺利产出
- 要 → 网页端不动，小程序是**第二个端**，而且页边按钮那套交互在小程序里要做完全不同的设计，这属于新项目，不是重构

要我现在动手把多篇文章的工程骨架搭起来吗？我打算先做三件事：把引擎抽到 `engine/`、把现有这篇迁成 `articles/*.json` 并跑通批量 verify、写好 `new.mjs` 让新素材能一键出骨架。搭完你丢下一篇素材可以直接验证流水线。

---

## 用户

好的，干吧，要不要在同一个新的文件夹下面开干？

---

## Claude

好，开干。先看一下当前目录和 git 的实际情况，再定文件夹方案。

---

## Claude

搞清楚了几个关键情况：

- **git 根目录是 `/Users/ei/Desktop/temp`**，`book1/` 是它下面的子目录 —— 所以新建文件夹仍在同一个仓库里，这没问题
- 没有 `.gitignore`，2.8MB 的 PDF 直接进了 git
- `.claude/settings.json` 里全是 Windows 路径（`explorer.exe`、`mingw64`）—— 这项目是从 Windows 搬过来的，那些授权在新机器上已经失效了

## 文件夹方案：新建 `pet-reading/`，`book1/` 原封不动

理由：`book1` 这个名字绑死了「第一本书」，但引擎要服务 N 本；而且迁移期间需要对照原 `src/app.js` 和 `content.js`，**保持它完整是必要的退路**。等迁移验证通过、你确认无误，再决定归档还是删掉。

```
/Users/ei/Desktop/temp/
  pet-reading/          ← 新工程
    engine/             app.js  style.css      ← 200 篇共用
    data/               manifest.json  glossary.core.json
    articles/           *.json                 ← 每篇只写这个
    tools/              verify.mjs  new.mjs  ipa.mjs  indexgen.mjs
    sources/            原始素材（PDF / 扫描图）
    dist/               构建产物（gitignore）
    build.mjs
  book1/                ← 原封不动，作为参照
```

开始动手。

---

## Claude

现在迁移内容数据。先写迁移脚本，把 `content.js` 解析成结构化 JSON。

---

## Claude

迁移脚本抓到一个真实差异：**322 词 vs 声明的 319**。这正是校验该干的事。先看看原工程的计数逻辑，保证迁移用的是同一套口径。

---

## Claude

原工程用的是**字母 token 正则**（`[A-Za-z]+(?:[’'\-][A-Za-z]+)*`），我刚才按空白切分，口径不同。修正成同一套。

---

## Claude

迁移忠实还原：**7 段 / 22 句 / 319 词 / 44 词组 / 281 词条 / 8 选项 / 5 题**，全部对得上。

现在改造引擎。先摸清 `app.js` 的内容接入点和需要按篇隔离的状态。

---

## Claude

现在改引擎的三处状态隔离问题。

---

## Claude

引擎改好了。现在写新的模板——把文章标题和标注做成占位符，引擎改成外链。

---

## Claude

模板好了。现在写构建脚本——批量、增量、带缓存哈希。

---

## Claude

构建跑通了，体积完全符合预测：

| | 迁移前（自包含） | 迁移后 |
|---|---|---|
| 每篇 HTML | 49 KB gzip | **24.4 KB gzip** |
| 引擎 | 打包在每篇里 ×200 | **24.3 KB gzip，只下一份** |

现在写批量校验——这是 200 篇规模下真正的质量卡口。

---

## Claude

硬校验全绿。但那 5 条警告要查清楚——文档正文说 `others` 该有 7 条，示例里却是 3 条。先看实际数据和引擎怎么用它。

---

## Claude

`others` 的语义搞清楚了：**它是「这道题容易误选的几个选项」**，不是「其余全部 7 个」。第 16 题（答案 D）列了 E、F、H —— 其中 F 是第 17 题的答案。

这里发现**提示词文档内部有个自相矛盾**，得先跟你说一声：

- **3.6 节的正文**写：「`others` 列出**其余 7 个选项**各自为什么不行」
- **3.6 节的示例**和**第八节的参考实现基线**（就是这篇文章）里，都是 **3 条**

文档正文和它自己的参考实现对不上。我按**功能不变量**来卡，而不是拍一个数字——真正会让页面开天窗的是「某个干扰项在任何一题的 `others` 里都没出现」，因为那样点它的「答题解析」会是空的。

---

## Claude

校验全绿。现在确认构建产物真的能跑——先看有没有 jsdom 可用。

---

## Claude

jsdom 没装。装一份用于自动化冒烟测试。

---

## Claude

现在移植冒烟测试。先看原测试的断言结构。

---

## Claude

现在把冒烟测试移植成**通用版**——原测试把 `opportunity`、`was given`、22 句、5 个空位全写死了，200 篇下必须从数据里推导。同时测试要覆盖多篇。

---

## Claude

写的时候把计数器和方法名撞了，修掉。

---

## Claude

渲染是空的。我怀疑自己踩了你文档里的**血泪坑 #18**——`String.replace` 传字符串做替换时，`$&`、`` $` ``、`$'` 会被当成反向引用。先确认。

---

## Claude

确认是我犯的错——`app.js:529` 里有 `"\\$&"`，被当成了反向引用，把 `<script src=...>` 整段复制进了引擎代码里。**这正是你文档第 18 条坑**。改成传函数。

---

## Claude

加一条回归卡口，专门盯这类替换污染。

---

## Claude

从 0 渲染到 22 项通过。剩两个问题，其中一个有意思：**引擎渲染出 368 个词，但词表声明 319**。查一下引擎自己的分词逻辑。

---

## Claude

两种口径都是 319。那多出来的 49 个 `.w` 是哪来的？直接探一下 DOM。

---

## Claude

段落的 TOKEN 数确实是 319。但渲染出来每段都多。直接把渲染后的 HTML 打出来看。

---

## Claude

找到了：**多词组内部的空格也被渲染成了 `.w`**（`data-w=" "`），368 − 319 = 49 个正好是词组里的空格数。

这引出一个真问题：点这个空格会怎样？你文档第 17 条坑说的就是「点非单词区域不该渲染空卡片」。测一下。

---

## Claude

点空格**不会出空面板**（守住了第 17 条坑），但**历史行数从 1 变成了 2** —— 点一次词组里的空格就往历史里塞一条垃圾记录。看看那条长什么样。

---

## Claude

确认了：点空格会往历史里写入 `{t:"w", k:" ", ref:""}`，界面上显示成一行**空标签 + "—"** 的垃圾记录。找到点击处理逻辑修掉。

---

## Claude

这就是问题所在——代码注释里写着「词与词之间的空档…才落到词组」，但空格被渲染成了 `.w`，永远轮不到词组分支。修掉。

---

## Claude

`data-w` 保留原始大小写（`Last`），我的样本词是小写的，选择器匹配不上。改成大小写不敏感的映射。

---

## Claude

103 项全通过。补一条回归卡口，盯住刚修的那个空格 bug。

---

## Claude

106 项全绿。现在写新素材的骨架生成器——这是 200 篇流水线的入口。

---

## Claude

两个真 bug：**空位没认出来**（正则写错了），**引号处被切错**（`"` 被切成独立一句）。修掉。

---

## Claude

空位和引号都对了。`空位：NaN` 是我显示代码的切片写错了。

---

## Claude

现在写共享词库的自动提取工具——这是「200 篇词库全书化」的兑现机制。

---

## Claude

现在验证共享词库的提取机制真的能跑通。用一篇文章复制成两篇来测，测完还原。

---

## Claude

预览正确识别出 281 条。现在真写一遍，验证**共享词库合并进构建产物**这条链路。

---

## Claude

共享词库链路完全跑通：提取 281 条 → 文章里清空 → 构建时合并 → 校验和冒烟全绿（**2 篇 × 106 项 = 212 项**）。现在还原测试数据。

---

## Claude

还原干净了（孤儿清理也生效）。清掉测试用的演示文件，然后做**实机浏览器验证**——特别是要确认外链引擎后「双击即开」（`file://`）还成立。

---

## Claude

Playwright 屏蔽了 `file://`。起个本地服务器做 http 验证，`file://` 那条我另外说明。

---

## Claude

只有 favicon 404，无害。看一下目录页。

---

## Claude

目录页正常。现在看文章页——重点是 jsdom 测不到的**页边按钮对齐**。

---

## 用户

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
## 1. Primary Request and Intent

The user's requests evolved across three turns:

1. **Scalability assessment (first ask):** "假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右" — Would the current per-article project pattern have efficiency problems at scale, given a 2-core/2GB server and ~10,000 users?

2. **200-article architecture + tech-stack question:** "我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等" — At 200+ articles, how should the architecture change? Do they need uni-app, Vue, or front-end/back-end separation?

3. **Build approval:** "好的，干吧，要不要在同一个新的文件夹下面开干？" — Go ahead and build it; should we work in a new folder?

Agreed plan (stated by me and approved): (a) extract the engine into `engine/`, (b) migrate the existing article into `articles/*.json` and get batch verify passing, (c) write `new.mjs` so new material produces a skeleton in one command.

## 2. Key Technical Concepts

- **Single self-contained HTML output, zero dependencies, no ES modules** (the `file://` CORS constraint), all state in `localStorage` — these are hard red lines from the user's own prompt doc.
- **Engine/content separation** for N articles: engine files cached once, only content downloaded per article.
- **Cache busting via stable filenames + `?v=<8-char SHA1>`** (chosen over hashed filenames to avoid orphan files).
- **Shared core glossary** (`data/glossary.core.json`) merged at build time, with an automatic "promote" mechanism based on cross-article reuse count.
- **Batch/incremental build** driven by `manifest.json` with a `.build-cache.json` signature file.
- **gzip measurements**: HTML compresses to ~30% (164,644 → 49,025 bytes).
- **jsdom-based smoke testing** with faked `getBoundingClientRect` (jsdom does no layout, so margin-button positioning must be simulated).
- **`Range.getBoundingClientRect()`** — the margin-button alignment technique; impossible in mini-program environments, which is why uni-app was rejected.
- **Pitfall #18**: `String.replace(regex, string)` treats `$&`, `` $` ``, `$'`, `$1` in the replacement as backreferences.
- **Tokenizer contract**: `TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g` — alphabetic sequences only; hyphens/apostrophes are word-internal. Must be identical in engine, verify, and new.

## 3. Files and Code Sections

### Read/analyzed (reference, unmodified)
- **`/Users/ei/Desktop/temp/book1/build.mjs`** — old 4-file merger; showed the `guard()` pattern for `</script>` and the `() => content` function-replacement requirement.
- **`/Users/ei/Desktop/temp/book1/tools/verify.cjs`** (119 lines) — source of the authoritative TOKEN_RE, the `hit()` lookup-fallback chain, and `MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"]`.
- **`/Users/ei/Desktop/temp/book1/tools/smoke.cjs`** (610 lines, 175 assertions) — source for the ported generic smoke test; contains hardcoded fixtures (`opportunity`, `jewellery`, `ancient`, `was found`, 22 sentences) that had to become data-derived.
- **`reading-part4-提示词.md`** — the 26KB prompt doc pasted by the user; contains the 18-item pitfalls list and the internal contradiction about `others`.

### Created — `/Users/ei/Desktop/temp/pet-reading/`

**`engine/app.js`** (copied from book1/src/app.js, then 4 edits):
```js
  var SLUG = (C && C.slug) || "unknown";
  var LS_KEY = "pet:hist:v1:" + SLUG;
```
```js
  var LS_UI = "pet:ui:v2";      // 跨篇共享
  var LS_ZOOM = "pet:zoom:v1";  // 跨篇共享
```
```js
    h += '<div class="passage-meta">' + esc(C.label) + " · " + C.passage.words + " 词 · " +
```
Real bug fix (phrase-internal space click):
```js
      // 单词优先：被词组包住的词，点的仍然是那个词。
      // 但词组内部的空格也带 .w（渲染时靠它撑出连续的黄底），那不是词，
      // 必须放行给下面的 .ph 分支 —— 否则会往历史里写一条 data-w=" " 的垃圾记录。
      var w = t.closest(".w");
      if (w && String(w.dataset.w).trim() !== "") {
        var raw = w.dataset.w;
        markActive(w);
        showWord(raw, ctxOf(w, t.closest(".qcard")));
        pushHistory("w", raw);
        return;
      }
```

**`engine/template.html`** — new; same body markup as the original but with `<!--TITLE-->`, `<!--DESC-->`, `<!--LABEL-->`, `<!--V_CSS-->`, `<!--V_JS-->`, `<!--CONTENT-->` placeholders and external refs:
```html
<link rel="stylesheet" href="engine/style.css?v=<!--V_CSS-->">
...
<script>window.PET_CONTENT = <!--CONTENT-->;</script>
<script src="engine/app.js?v=<!--V_JS-->"></script>
```

**`build.mjs`** — batch/incremental build. Key parts:
```js
const inlineJSON = o => JSON.stringify(o).replace(/</g, "\\u003c");

function render(article) {
  const content = {
    ...article,
    glossary: Object.assign({}, coreGlossary, article.glossary || {})
  };
  /* 替换值一律用函数返回 —— 标题/选项里一旦出现 $&、$'、`$1` 这类
     替换模式，传字符串就会被当成反向引用，把内容写坏（血泪坑 #18）。 */
  return template
    .replace("<!--TITLE-->", () => escHTML("PET 精读 · " + article.title))
    .replace("<!--DESC-->", () => escHTML(article.label + " · " + article.title))
    .replace("<!--LABEL-->", () => escHTML(article.label))
    .replace("<!--V_CSS-->", () => V_CSS)
    .replace("<!--V_JS-->", () => V_JS)
    .replace("<!--CONTENT-->", () => inlineJSON(content));
}
```
Also: `--force` / `--only <slug>` flags, `hash()` (sha1, 8 chars), orphan HTML cleanup, `renderIndex()` producing a grid-card index page.

**`data/manifest.json`** — single source of truth for ordering only (titles come from article files):
```json
{
  "site": { "title": "PET 精读", "tagline": "剑桥PET 官方模考题精讲讲练 23-24" },
  "books": [
    { "id": "pet-23-24", "title": "剑桥PET 官方模考题精讲讲练 23-24",
      "articles": ["t1-p4-digging-into-the-past"] }
  ]
}
```

**`data/glossary.core.json`** — currently `{}` (restored to empty after the promote test).

**`articles/t1-p4-digging-into-the-past.json`** — 104KB pretty-printed; fields `slug, book, label, title, note, passage{words,sentences,paragraphs}, phrases, glossary, options, optionsAna, questions`.

**`tools/migrate-legacy.mjs`** — one-off converter; contains the corrected tokenizer:
```js
const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
const words = s => {
  const o = []; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) if (m[2]) o.push(m[2].toLowerCase());
  return o;
};
```

**`tools/verify.mjs`** — batch validator; per-article: count match, complete `ana` on every sentence and option, phrases literally present in passage-or-options, phrase has a glossary entry, 100% wordform coverage over passage + options, slots match question numbers, answer uniqueness, exactly 3 distractors, `ana.phrases` drift warnings. Cross-article: same word with conflicting IPA/definition. The functional invariant replacing the doc's contradictory number:
```js
  /* 功能不变量：干扰项必须在某一题的 others 里出现过。
     引擎在「答题解析」里靠 others 汇总「它为什么哪个空都不填」，
     一次都没出现的干扰项点开就是空面板。 */
  const mentioned = new Set(qs.flatMap(q => (q.others || []).map(o => o[0])));
  distractors.filter(L => !mentioned.has(L)).forEach(L =>
    err(`${slug}：干扰项 ${L} 在任何一题的 others 里都没出现，点它的「答题解析」会是空的`));
```

**`tools/smoke.mjs`** — generic multi-article jsdom test, 106 assertions per article. Loads the built HTML, asserts external ref paths exist on disk, then inlines them for jsdom:
```js
  /* 必须传函数：引擎里有 "\\$&" 这种字符串，传字符串替换会被当成反向引用，
     把匹配到的 <script src=…> 整段复制进代码里 —— 就是血泪坑 #18。 */
  html = html
    .replace(/<link rel="stylesheet" href="[^"]+">/, () => "<style>" + ENGINE_CSS + "</style>")
    .replace(/<script src="[^"]+"><\/script>/, () => "<script>" + ENGINE_JS + "</script>");
```
Case-insensitive word lookup:
```js
  const byWord = new Map();
  realW.forEach(e => {
    const k = String(e.dataset.w).toLowerCase();
    if (!byWord.has(k)) byWord.set(k, e);
  });
  const wordEl = w => byWord.get(String(w).toLowerCase());
```

**`tools/new.mjs`** — material → skeleton generator. Corrected slot normalizer:
```js
function normSlots(s) {
  return s
    .replace(/[{[(【]{1,3}\s*(\d{1,2})\s*[}\])】]{1,3}/g, (m, n) => "{" + n + "}")   // {16} [16] (16) 【16】
    .replace(/_{2,}\s*(\d{1,2})\s*_{2,}/g, (m, n) => "{" + n + "}")                  // __16__
    .replace(/\b(1[5-9]|2[0-5])\b(?=\s*[A-Z])/g, (m, n) => "{" + n + "}")            // 16 So the first…
    .replace(/\{\s*(\d+)\s*\}/g, "{$1}");                                            // 已经是好的
}
```
Corrected sentence splitter:
```js
const CLOSERS = new Set(['"', "”", "’", ")", "）", "』", "」"]);
function splitSentences(para) {
  const out = []; let buf = "";
  for (let i = 0; i < para.length; i++) {
    buf += para[i];
    const c = para[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    let j = i;
    while (CLOSERS.has(para[j + 1])) buf += para[++j];
    const after = para[j + 1];
    if (after !== undefined && !/\s/.test(after)) { i = j; continue; }
    if (ABBR.test(buf.trim())) { i = j; continue; }
    if (c === "." && /\b[A-Z]\.$/.test(buf.trim())) { i = j; continue; }
    out.push(buf.trim()); buf = "";
    let k = j + 1;
    while (para[k] === " ") k++;
    i = k - 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
```

**`tools/promote.mjs`** — moves glossary entries appearing in ≥N articles (default 2) into core, only when all definitions are identical; reports conflicts and exits 1 if any remain; `--write` / `--min N`.

**`package.json`** — `"type": "module"`, devDependency jsdom ^30.1.2, scripts: `build`, `verify`, `smoke`, `check` (`verify && build && smoke`).

**`.gitignore`** — `dist/`, `node_modules/`, `.DS_Store`, `*.log`.

## 4. Errors and Fixes

1. **Migration word count 322 vs declared 319.** My script split on whitespace; the old `verify.cjs` uses an alphabetic-token regex. Fixed by adopting the identical TOKEN_RE — migration then matched exactly (7/22/319/44/281/8/5).

2. **Smoke test: 0 elements rendered (2 pass / 7 fail).** Root cause: `html.replace(/<script src="[^"]+"><\/script>/, "<script>" + ENGINE_JS + "</script>")` — `engine/app.js:529` contains `"\\$&"`, which `String.replace` interpreted as a backreference, duplicating the matched tag into the engine code. **This is pitfall #18 from the user's own doc, and I made the mistake myself.** Fixed by passing functions; also hardened `build.mjs` render() the same way; added a regression assertion that the built HTML contains exactly 2 `<script>` tags.

3. **Variable collision in smoke.mjs** — declared `let pass = 0, fail = 0` and then `const pass = m => ...` / `const fail = m => ...`. Renamed counters to `nPass`/`nFail`.

4. **`.w` count 368 vs declared 319.** The phrase-internal space is rendered as `.w` with `data-w=" "` (49 of them = exactly the delta). Fixed the assertion to count only non-whitespace `.w` and separately report the gap count.

5. **Real bug found via that investigation:** clicking a phrase-internal space wrote a junk history row `{t:"w", k:" ", ref:""}`, rendered as a blank label with "—". The engine's own comment said that click should fall through to the `.ph` branch. Fixed with `if (w && String(w.dataset.w).trim() !== "")`; added a regression assertion.

6. **`Cannot read properties of null (reading 'dispatchEvent')` at smoke.mjs line 200.** `data-w` preserves source case (`Last`), my fixture words were lowercased. Fixed with a case-insensitive `byWord` Map / `wordEl()` helper; history assertions now compare against the element's actual `dataset.w`.

7. **`new.mjs` slot normalization failed** on `(16)` and `__17__` (malformed character class; the trailing class excluded `)`). Rewrote as the 4-rule `normSlots`.

8. **`new.mjs` split at quotes** — `"I'm never doing this again," he said.` was being split into a stray `"` sentence. Rewrote `splitSentences` with the `CLOSERS` set so closing quotes stay attached.

9. **`空位：NaN`** — `+"16}"` from `x.slice(1)`. Changed to `parseInt(x.slice(1), 10)` with NaN filtering.

10. **Prompt-doc self-contradiction surfaced (not an error of mine):** §3.6 prose says `others` should list "其余 7 个选项", but §3.6's own example and §8's reference baseline both show 3. I flagged this to the user and replaced the count check with the functional invariant (every distractor must appear in some question's `others`).

## 5. Problem Solving

- Established that the server side is not the constraint: gzip ratio measured at 30%, static files, nginx on 2C2G; bandwidth is the only real risk, mitigated by `gzip_static` + immutable cache headers + CDN.
- Quantified the engine/content 50/50 split (24.5KB / 24.4KB gzip) and proved the per-article saving is real by measuring the actual build output: 49KB → 24.4KB.
- Rejected uni-app on a concrete technical ground (`Range.getBoundingClientRect` requires a DOM) rather than a preference.
- Proved the core-glossary merge path end-to-end by duplicating the article, running promote (281 promoted, 562 removed), then verifying build/verify/smoke all passed (212 assertions across 2 articles), then restoring from `/tmp/petbak/` backups.
- Confirmed the whole pipeline: verify ✓, build ✓ (with orphan cleanup), smoke 106/106 ✓.

## 6. All User Messages

1. "好的，前面我提了很多需求，假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右"
2. (Interrupted tool use, then pasted the full `reading-part4-提示词.md` document as a `<pasted_content>` block — reference material for the architecture discussion, containing the 9-section spec, the 18-item pitfalls list, and the reference baseline table.)
3. "我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等"
4. "好的，干吧，要不要在同一个新的文件夹下面开干？"

No security-specific constraints were stated by the user in this conversation.

## 7. Pending Tasks

- Finish real-browser verification, especially the **margin-button alignment** (the one thing jsdom cannot test — the user's own doc §6.3 lists it as requiring manual browser confirmation).
- Confirm the `file://` "double-click to open" property still holds now that the engine is external (Playwright blocks `file://`, so this needs another check or explicit user confirmation).
- Write the workflow README for the new project.
- Report the completed work back to the user.
- Still unresolved from my earlier question to the user: whether students access the pages over HTTP or receive files, and what to do with `book1/` (currently preserved as reference) and the 2.8MB PDF.

## 8. Current Work

I had just completed the full implementation and verification pipeline in `/Users/ei/Desktop/temp/pet-reading/`, restored the test data, removed the demo file, and started real-browser verification.

State at the moment of summarization:
- `node tools/verify.mjs` → ✓ 全部通过 (7 段 / 22 句 / 319 词 / 长难句 12 / 词组 44 / 选项 8 / 题 5; 不重复词形 202 个 · 本篇词条 281 条)
- `node build.mjs` → 1 篇, dist/index.html + dist/t1-p4-digging-into-the-past.html + dist/engine/{app.js,style.css}
- `node tools/smoke.mjs` → ★ 全部通过, 106/106
- Local server running: `python3 -m http.server 8899` in `dist/` (background, log at /tmp/petsrv.log); index.html, article page, and `/engine/app.js?v=637d9398` all return HTTP 200
- Index page screenshot verified correct (PET 精读 heading, book section, article card with "Digging into the past / Exam Practice Test 1 · Reading Part 4 / 319 词 · 22 句"); only console error was a harmless favicon 404
- **Last action:** navigated to `http://127.0.0.1:8899/t1-p4-digging-into-the-past.html` — page loaded successfully with title "PET 精读 · Digging into the past", but I had not yet inspected the rendered result.

## 9. Optional Next Step

Inspect the article page rendering in the browser and verify the margin-button alignment, which is the one invariant my jsdom smoke test explicitly cannot cover. The user's prompt doc §6.3 states: "jsdom 测不到的（必须人工在浏览器里看）— 页边按钮是否**真的对齐**到各句首行（jsdom 不做排版计算）".

Concretely: take a screenshot of the article page, then use `browser_evaluate` to measure whether each `.sbtns` group's `style.top` corresponds to its sentence's actual first-line `getBoundingClientRect().top`, and check for overlap. This directly continues the verification step I was in the middle of, immediately after which I should write the workflow README and report the results (verify ✓ / build ✓ / smoke 106 ✓ / browser ✓) back to the user, along with the two still-open questions: HTTP-serving vs file distribution, and what to do with `book1/` and the PDF.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/ei/.claude/projects/-Users-ei-Desktop-temp-book1/1bd2e541-a836-426b-b848-844e2bf3b35e.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.

---

## Claude

页边按钮对齐已量化确认：22 组全部对齐，最大偏移 1px。再看两件事——手机宽度下的表现，和点词的交互回归。

---

## Claude

浏览器里抓到一个 jsdom 没测出来的真 bug：**正文卡片的大标题渲染成了 `undefined`**。

---

## Claude

标题修复。加一条 smoke 断言，防止再退化：

---

## Claude

新断言立刻抓到第二处：页面上还有别的地方漏 `undefined`。定位它：

---

## Claude

假警报——匹配到的是内联 `<script>` 里的引擎源码本身（源码里当然有 `undefined`）。断言要排除 script/style：

---

## Claude

110/110 通过。回到浏览器验证新构建：

---

## Claude

手机宽度下页边按钮彻底失效（触控宽度 0、偏移 1786px）。看 CSS 在窄屏做了什么：

---

## Claude

标题已修复。手机端阅读正文正常——但每句的「析/🔊」按钮在 ≤1180px 被 `display:none` 隐藏了。验证点句子还能不能出讲解：

---

## Claude

`点空格_历史没长=false` 是我断言写反了——空格应当**穿透到词组分支**、正常加一条词组历史。确认加的是词组而不是垃圾：

---

## Claude

`.slice(-1)` 取的是最旧一条（历史是新行插在最前）。重测：

---

## Claude

交互全部正确（词组内空格穿透到词组分支，历史里没有空白垃圾行）。桌面页边按钮对齐，手机端按设计隐藏。

清理浏览器产物并确认 `file://` 双击可开：

---

## Claude

写工作流 README。先核对各命令的实际接口：

---

## Claude

README 里我写了 `gzip_static on` 省 CPU，但 `build.mjs` 现在并不产出 `.gz` 文件——那句话是假的。先量一下真实体积，再把预压缩补上：

---

## Claude

49 确认。现在让 `build.mjs` 真的产出 `.gz`，`gzip_static` 才不是空话：

---

## Claude

Now add gzip pre-compression as a final build step:

---

## Claude

Also clean up stale `.gz` when an article is removed from the manifest:

---

## Claude

1440px 下有 2 组偏移到 24px（1200px 时是 1px）。这是页边按钮的真实对齐问题，查是哪儿：

---

## Claude

引擎里这是**故意的防重叠让位**（[app.js:430](engine/app.js#L430)）：后一组的按钮若会和前一组的底边撞上，就往下推到 `prevBottom + 2`。量化一下影响面：

---

## Claude

这组数字自相矛盾（最大值 1035 与上一轮 24 冲突），说明我的测法有问题。重新干净地测一遍，逐句打印：

---

## Claude

干净测出来了，结论明确：**22 组里 20 组对齐在 0.7px 内**；句 16 和 18 被下推 21–24px，而这两句的首行间距只有 1–3px——它们都是**从行中间起头**的句子（和上一句共用一行）。同一条线上放不下两个按钮，引擎按设计把后一个下移一个按钮高（22px）。这不是 bug，是取舍。补进 README，免得以后有人当故障查：

---

## Claude

全部完成，管线全绿。

**写给：以后往这个项目里加文章的人（你，或者帮忙的助手）** —— [README.md](pet-reading/README.md) 是照这个读者写的：六步加一篇、字段表、三道防线各查什么、部署 nginx 配置、以及 6 条踩过的坑。

## 浏览器验证的结果

这轮真机验证抓到 **1 个 jsdom 测不出来的真 bug**：

**正文大标题渲染成 `undefined`。** 引擎读 `C.passage.title`，但迁移后的 schema 里标题在顶层 `C.title`。旧项目标题恰好塞在 `passage` 里，所以搬引擎时没暴露。`smoke` 当时有 106 条断言，一条都没管标题——现在补了 4 条（[smoke.mjs:153](pet-reading/tools/smoke.mjs#L153)），其中一条专门拦 `undefined` 漏到页面上。顺带发现那 4 条断言第一次跑还给自己报了假警：`body.textContent` 会把内联 `<script>` 里的引擎源码算进去，而源码里当然有 `undefined` 这个词。

修完重跑：**110/110 通过**。

页边按钮对齐实测（提示词文档 §6.3 点名要人工看的那条）：**22 组里 20 组在 0.7px 内**，剩下 2 组下推了 21–24px。查下来不是故障——那两句是**从行中间起头**的（首行距上一句只有 1–3px，共用一行），一行放不下两组按钮，`layoutGutter` 按设计把后一组下移一个按钮高。已经写进 README，免得以后有人当 bug 查。

## 顺手补的两件事

- **预压缩**：README 里我原本写了 `gzip_static on` 省 CPU，但 `build.mjs` 并不产出 `.gz`——那句话是假的。给构建加了预压缩（内容没变不重写，不动 mtime），现在 `dist/` 里真有 `.gz`，那句话才成立。孤儿清理也带上 `.gz`，否则 manifest 里删掉的篇目会留下能被直接访问到的旧页面。
- **确认 `file://` 双击可开**：产物用的是相对路径 + 普通 `<script>`（不是 ES module），没有 fetch/XHR，所以本地双击能跑。要当文件发给学生的话，`dist/engine/` 得一起发。

## 现在的状态

```
npm run check
  verify  ✓  7 段 · 22 句 · 319 词 · 词组 44 · 题 5 · 词条 281
  build   ✓  1 篇 → dist/（引擎 v=8c3b096a/ce964941，预压缩 4 个文件省 106KB）
  smoke   ✓  110/110
```

实测体积和之前估的一致：引擎 24.5KB + 内容 24.4KB ≈ 首篇 49KB（gzip），之后每篇只下 24.4KB。

预览服务还开着：**http://127.0.0.1:8899/**（`python3 -m http.server 8899` 跑在 `dist/`，不用了就 `pkill -f "http.server 8899"`）。

## 还剩两个问题要你定

1. **学生是走网址还是拿文件？** 这决定要不要给 `?v=` 那套缓存策略配 CDN，以及要不要做移动端适配——现在 ≤1180px 会把每句的「析/🔊」按钮整个隐藏掉，手机上只剩「点句子看讲解」，而小黑板是堆在下面的另一栏，点了当下看不到反馈。如果学生主要用手机，这条得重新设计，不是小修。
2. **`book1/` 和那个 2.8MB 的 PDF 怎么办？** 现在 `book1/` 原样留着当参照（里面有你的提示词文档和 PDF），没动过。新项目已经能完全替代它了，你说删还是留。

---

## 用户

1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除  3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。

---

## Claude

这四条里有一条会动到架构根基，值得先规划再动手：**登录 + 收藏单词** 直接撞上你原提示词里的硬红线（纯静态、零依赖、状态全在 localStorage）。收藏要是只存本地，学生在手机登录、电脑打开就看不到自己的收藏；要跨设备就得有后端，服务器的部署模型跟着变。

先进入规划模式，把现状摸清、把该你定的几个岔路口摆出来。

---

## Claude

Phase 1 — 摸清三块现状：主题/响应式的 CSS 结构（黑暗模式 + 多端）、引擎的状态层与界面骨架（登录态 + 收藏）、构建管线（新页面怎么加）。

---

## Claude

三块现状都摸清了，有几个关键事实直接决定方案：

- **黑暗模式**：CSS 有 19 个变量（`style.css:2-22`），但**另有 67 行硬编码颜色**——这才是真正的工作量，不是加个 `[data-theme=dark]` 就完事。
- **新页面有一堵硬墙**：`build.mjs:114-121` 的孤儿清理会把 `dist/` 里任何不在 manifest 里的 `.html` **删掉**（只豁免 `index.html`）；`build.mjs:72` 同步引擎文件的数组也是写死的两个文件名。登录页不能直接丢进 dist。
- **手机端已有一个真 bug**：`style.css:273` 的 `.hdel{opacity:0}` 靠 `:hover` 显形，触摸设备没有 hover——**历史条目的删除按钮在手机上永远点不到**。另外 `.hist-float` 固定 330px，375px 屏幕上直接溢出。
- **收藏功能完全不存在**，没有可复用的数据结构；但 `renderHistory()` 那套（`histKey`/`pushHistory`/`renderHistory`）是现成可照搬的模式。

有三个岔路口需要你定：

---

## Claude

三个都选了推荐项。进入 Phase 2，让 Plan agent 设计实现方案，我同时自己读关键文件核对。

---

## Claude

Plan agent 还在跑。先把方案骨架落到计划文件里，等它回来再合并：

---

## Claude

计划骨架已落盘。等 Plan agent 的同时，有两个产品决策会直接改变实现，先跟你确认：

---

## Claude

两个答复都改变了方案，特别是第二个——取消收藏列表、只留一个按钮和一个待接的后端接口，这让第 5 步大幅缩小。

但「每个单词右侧有一个按钮」有几种读法，落点不同，实现差别很大：

---

## Claude

收到，☆ 放历史列表每行右侧。四个决策都定了，我更新计划。

有一个**新出现的硬冲突必须先说**：强制登录会**干掉 `file://` 双击打开**这个特性——本地文件的 localStorage 不可靠，而且登录跳转在本地会变成死循环。我在计划里加了「localStorage 不可用时门禁必须放行而不是无限跳转」这条安全设计。

---

## Claude

Plan agent 的另两个前提（收藏列表面板、登录可选）已经被你的答复推翻了，它的产出会有一半是过时的，留着反而是噪音。停掉它，方案我自己已经基于三份探查报告加实际读码定完了。

---

## 用户

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
## 1. Primary Request and Intent

**Pre-compaction (completed):** The user asked whether their per-article HTML reading-comprehension pattern would scale, then how to architect 200+ articles (mentioning uni-app / Vue / front-end-back-end separation as candidates), then approved building a new architecture in a new folder. That work was completed in `/Users/ei/Desktop/temp/pet-reading/`: engine/content separation, `articles/*.json` migration, `tools/new.mjs` skeleton generator, batch build, and a three-gate test pipeline.

**Post-compaction, part 1 (completed):** Finishing browser verification of the new build — specifically the margin-button alignment (the one invariant jsdom can't test) and the `file://` double-click property.

**Post-compaction, part 2 (in planning):** The user issued four new requests verbatim:
> "1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除 3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"

Through three rounds of AskUserQuestion the user made four binding decisions:
1. **Storage: pure front-end but with a backend seam** — login state and favorites in localStorage, but all reads/writes go through a thin async adapter (`engine/store.js`) so swapping in a backend later changes only that one file.
2. **Mobile panel: bottom sheet** — the blackboard slides up from the bottom on narrow screens; the sheet header carries 🔊, so the margin 析/🔊 buttons need not return on mobile.
3. **Hard login gate** — this was the *user's* choice, overriding my recommendation of a non-blocking gate. Unauthenticated users cannot read any article.
4. **Favorites reduced, then narrowed again** — user wrote in a custom answer: "不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。" Then, asked to disambiguate "每个单词右侧", chose **历史列表每行右侧** (each row of the history float gets a ☆ next to the existing ✕). So: no favorites list panel at all; just a ☆ button per history row plus a deferred DB interface.

## 2. Key Technical Concepts

- **Engine/content separation**: engine files cached once site-wide, only per-article JSON downloaded after the first page.
- **Single self-contained HTML output, zero dependencies, classic (non-module) scripts, all state in localStorage** — the original hard red lines; the login gate partially breaks the `file://` property of this.
- **Cache busting via stable filenames + `?v=<8-char SHA1>`**.
- **gzip pre-compression at build time** (`zlib.gzipSync`, level 9) for `nginx gzip_static`; idempotent (skips unchanged, preserves mtime).
- **jsdom smoke testing** with external CSS/JS inlined back (must pass *functions* to `String.replace`).
- **Pitfall #18** (the project's own name for it): `String.replace(regex, string)` treats `$&`, `` $` ``, `$'`, `$1` in the replacement as backreferences.
- **Tokenizer contract** (must be byte-identical in `engine/app.js`, `tools/verify.mjs`, `tools/new.mjs`): `/\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g`
- **`Range.getBoundingClientRect()`** for margin-button alignment.
- **`--zoom` as a CSS custom property** written to `<html>` from JS; 50 `calc(Npx * var(--zoom))` uses across 42 lines; column children all multiply explicitly, never rely on `em` inheritance.
- **Async-from-day-one adapter pattern** for the backend seam.
- **FOUC prevention via an inline `<head>` script** that sets `data-theme` before the blocking stylesheet loads.
- **Fail-open gating** — when localStorage is unavailable the gate must let the user through rather than infinite-redirect.

## 3. Files and Code Sections

### `/Users/ei/Desktop/temp/pet-reading/engine/app.js` (55,536 bytes, ~1344 lines, IIFE, no exports)
**Edited — fixed the `undefined` title bug at line 351:**
```js
    /* 标题在新 schema 里是顶层的 C.title（旧版塞在 passage.title 里）。
       passage.title 只作兜底，别写回 —— 迁移工具、校验、建站脚本一律认顶层。 */
    h += '<h1 class="passage-title">' + esc(C.title || C.passage.title || "") + "</h1>";
```
Key facts established by reading it:
- **`:4`** `var C = window.PET_CONTENT;` — unconditional; a login page loading app.js without PET_CONTENT crashes at init.
- **`:14-15`** `var SLUG = (C && C.slug) || "unknown"; var LS_KEY = "pet:hist:v1:" + SLUG;`
- **`:16-23`** `state = { tab:"read", quiz:false, hist:[], curHist:"", openQ:{}, activeQ:null }`
- **`:36-37`** `var LS_UI = "pet:ui:v2"; var cols = { ana: true, vocab: false };` (note: `cols.vocab` semantically means the *history float*, not a vocabulary book)
- **`:85-105`** `LS_ZOOM = "pet:zoom:v1"`, `applyZoom()` writes `document.documentElement.style.setProperty("--zoom", z)` at `:89` — the only existing `<html>` write path, reusable for `data-theme`.
- **`:182-209`** `lookup(raw)` returns `{key, entry, matched}` where **`key` is the resolved dictionary base form** — clicking "centuries" yields "century". Favorites must store this, not the clicked inflection.
- **`:210-213`** `lookupPhrase(key)` just does `C.glossary[key]`.
- **`:456`** `function histKey(it) { return it.t + ":" + (it.t === "w" ? it.k : it.ref); }`
- **`:458-466`** `pushHistory(t, k, ref)` — filters out same id then unshifts (repeat click = move to top), caps at 300.
- **`:477-511`** `renderHistory()` — each row is `div.hitem.w|.s` containing sibling buttons `.hopen[data-hist]` (`:493`) and `.hdel[data-histdel]` (`:507`). **This is where the ☆ goes.**
- **`:538-574`** `showWord(key, ctx)` — the `.ana-h` header at `:552-553` holds `<button class="ana-spk" data-sayraw="…">🔊</button>`; ends by setting `state.curHist = "w:" + key`.
- **`:805-900`** `showAnalysis(ref)` — header at `:814-816` with `data-say=ref`; sets `state.curHist = "s:" + ref`.
- **`:1044-1135`** `bindPassage(root)` — the click delegation entry, bound 4× (elPassage `:1265`, elAna `:1266`, `#qList` `:1269`, `#qListRead` `:1270`). Dispatch order: `[data-say]` → `[data-sayraw]` → `[data-qexp]` → `[data-ana]` → `[data-pat]` → `.w` → `.ph` → `[data-word]` → `.blank` → `.sent` → `.opt`.
- **`:1101`** phrases are recorded via `pushHistory("w", key)` — history cannot distinguish word from phrase.
- **`:1138-1158`** `bindHistory(root)` — already delegates `[data-histdel]` and `[data-hist]`; the ☆ becomes the third branch here.
- **`:1253-1340`** `init()` order: `buildPhraseIndex` → grab DOM refs → `loadHist()` → `renderPassage()` → `renderHistory()` → `renderQuestions()` → bind events → gutter hover → layout observers → toolbar bindings → `loadUI()` → `switchTab("read")` → `applyZoom(loadZoom())`. **No login gate exists.**
- **`:411-435`** `layoutGutter()` — deliberate anti-overlap: `if (top < prevBottom + 2) top = prevBottom + 2; prevBottom = top + (it.g.offsetHeight || 22);`

### `/Users/ei/Desktop/temp/pet-reading/engine/style.css` (20,717 bytes, ~481 lines)
Not yet modified. Established facts:
- `:root` at **`:2-22`** with 19 custom properties: `--bg --panel --ink --ink-2 --ink-3 --line --line-2 --accent --accent-soft --phrase --phrase-hover --sent-alt --ins-bg --ins-line --hard --hard-bg` plus `--zoom:1` `--radius:10px` `--shadow` (shadow value *contains* colors).
- **`--hard` / `--hard-bg` are dead tokens** (defined, 0 uses).
- **67 lines contain hardcoded colors.** Clusters: `.chip.*` `:352-366`, question area `.qans/.opt/.obtn` `:405-459`, `.mini/.sbtns` `:181-183` and `:226-233`. 14 occurrences of `color:#fff` on colored backgrounds.
- **4 `!important` all at `:167/169/170`** (`.sent:hover/.peek/.cur`).
- **`:381` `.part code{background:rgba(128,128,128,.2)}` is the only dark-friendly pattern in the file.**
- **`:186-189`** `@media(max-width:1180px){ #passage{padding-right:0} .pgutter{display:none} }`
- **`:474-481`** `@media(max-width:1180px){ body{overflow:auto;height:auto;min-height:100vh} .cols,...{grid-template-columns:1fr;flex:none;gap:12px} .col{max-height:78vh;min-height:0} .col-body{max-height:none} }`
- **`:273/275`** `.hdel{opacity:0}` + `.hitem:hover .hdel{opacity:1}` — **touch devices can never reach the delete button**.
- **`:94`** `.hist-float{width:330px;top:64px;right:14px;bottom:14px}` — overflows 375px screens and sits under the wrapped topbar.
- **`:32`** `height:100vh` — should be `100dvh` on iOS.
- No `prefers-color-scheme`, no `data-theme`, no `.dark`, no `color-scheme`, no `env(safe-area-inset-*)`, no `viewport-fit=cover`.

### `/Users/ei/Desktop/temp/pet-reading/engine/template.html` (2,879 bytes, 78 lines) — read in full
6 placeholders: `<!--TITLE-->`(6), `<!--DESC-->`(7), `<!--V_CSS-->`(8), `<!--LABEL-->`(13), `<!--CONTENT-->`(75), `<!--V_JS-->`(76). 20 ids. `<html lang="zh-CN">` has **no class or data-* hook**. `.brand` at `:13` is the natural phone-number mount point; `.tools` at `:22-35` is the natural theme-toggle mount point. No user/login region, no theme button.

### `/Users/ei/Desktop/temp/pet-reading/build.mjs` (8,880 bytes) — **edited**
Added gzip pre-compression and `.gz` orphan cleanup:
```js
import zlib from "zlib";
...
/* ---------- 预压缩 ----------
   产出 .html.gz / .js.gz / .css.gz，nginx 开 gzip_static 就直接发，
   省掉 2 核小机器上每次请求现压的 CPU。没有 .gz 时 nginx 会回落到原文件，
   所以这一步失败不影响可访问性。
   同样按内容判断：没变就不重写，别动 mtime。 */
let gzipped = 0, gzSaved = 0;
function writeGz(file) {
  const body = fs.readFileSync(file);
  const gz = zlib.gzipSync(body, { level: 9 });
  const out = file + ".gz";
  const old = fs.existsSync(out) ? fs.readFileSync(out) : null;
  if (!FORCE && old && old.equals(gz)) return;
  fs.writeFileSync(out, gz);
  gzipped++; gzSaved += body.length - gz.length;
}
function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(html|js|css)$/.test(e.name)) writeGz(f);
  });
}
try { walk(DIST); } catch (e) { console.error("! 预压缩失败（不影响访问）：" + e.message); }
```
And in the orphan cleanup:
```js
    fs.unlinkSync(path.join(DIST, f));
    /* .gz 是派生物，主体删了它也必须跟着走，否则会留下能被直接访问到的旧页面 */
    if (fs.existsSync(path.join(DIST, f + ".gz"))) fs.unlinkSync(path.join(DIST, f + ".gz"));
```
Critical untouched facts: **`:114-121` orphan cleanup deletes any `dist/*.html` whose name isn't a manifest slug, exempting only `index.html`** — this is the hard wall for adding `login.html`. **`:72` hardcodes the engine file sync array** `[["style.css", cssRaw], ["app.js", jsRaw]]`. `V_CSS`/`V_JS` at `:30-31` cover only those two files. `render()` at `:45-60` does 6 `.replace()` calls, **all with function replacements** (pitfall #18). `renderIndex(man, slugs)` at `:159-217` uses external `engine/style.css?v=${V_CSS}` plus its own inline `<style>`, and does not load app.js.

### `/Users/ei/Desktop/temp/pet-reading/tools/smoke.mjs` (30,077 bytes, ~566 lines, 110 assertions/article) — **edited**
Added 4 title/meta assertions (shown in full in section 4 below). Uses `doc` (from jsdom) not global `document`. `loadArticle` at `:32` hardcodes `dist/<slug>.html`; `:37-40` asserts exactly 2 `<script>` tags.

### `/Users/ei/Desktop/temp/pet-reading/README.md` (9,469 bytes) — **created this session**
Covers: purpose and the engine/content split with measured gzip figures; directory structure; the six-step add-an-article workflow; article JSON field table; the three test gates; the `promote.mjs` glossary-promotion mechanism; nginx deployment config; and 6 "hard rules" (pitfalls). Rule #5 was added after browser measurement:
```
5. **从行中间起头的句子，它的页边按钮会低一行 —— 这是故意的，不是坏了。**
   同一行上放不下两组按钮，`layoutGutter` 会把后一组下推一个按钮高（`prevBottom + 2`）。
   实测 22 句里有 2 句这样，偏移 21–24px，其余 20 句都在 0.7px 内。
   jsdom 不做排版，测不到这个（`smoke` 只用假 rect 验算让位逻辑），改布局后要人眼过一遍。
```

### `/Users/ei/.claude/plans/serialized-crunching-swing.md` — **created and rewritten twice (the only file editable in plan mode)**
Contains the full four-feature implementation plan with: Context; the four confirmed decisions in a table; **三个后果** the user must know about the hard gate; a "前置事实" section with line-referenced findings; steps 0-6; a dependency diagram; and a total verification section.

### Not modified
`/Users/ei/Desktop/temp/book1/` is preserved intact (contains the prompt doc `reading-part4-提示词.md` and the 2.8MB PDF). The user said: "pdf先留着吧，我到时候再刪除".

## 4. Errors and Fixes

1. **Passage title rendered as literal `undefined`** — `app.js:351` read `C.passage.title` but the new schema puts `title` at top level. Found by reading a Playwright screenshot, not by any test. Fixed with `esc(C.title || C.passage.title || "")`.

2. **Smoke assertion crashed: `document is not defined`** — smoke.mjs uses `const doc = window.document` from jsdom, not a global. Fixed to `doc.body.textContent`.

3. **The new `undefined` assertion still failed after fixing the title** — `doc.body.textContent` includes the inline `<script>` engine source, which of course contains the literal word `undefined`. Fixed by cloning the body, removing `script`/`style`, then matching:
```js
  const visibleText = [...doc.body.childNodes].length
    ? (() => {
        const c = doc.body.cloneNode(true);
        c.querySelectorAll("script, style").forEach(n => n.remove());
        return c.textContent;
      })()
    : "";
  const leak = visibleText.match(/[^\s]*undefined[^\s]*|\[object [A-Za-z]+\]/);
  ok(!leak, `[${slug}] 页面上没有 undefined / [object Object] 漏出来${leak ? "：" + leak[0] : ""}`);
```

4. **My own false claim in the README** — I wrote that `gzip_static on` saves build-time CPU, but `build.mjs` produced no `.gz` files. Rather than weaken the sentence, I made it true by adding pre-compression.

5. **Broken `walk()` in the first gzip implementation** — I wrote `if (e.name !== "engine" || true) walk(f);`, which is nonsense (`|| true` makes the condition always true). Simplified to `walk(f)`.

6. **Margin-button measurement returned absurd numbers (max offset 1035px)** — my throwaway eval used `r.setEnd(t, Math.min(1, t.length))`; for element nodes (the `.blank` span) `t.length` is `undefined`, so `Math.min(1, undefined)` is `NaN`. Fixed by branching on `t.nodeType === 3` and using `r.selectNodeContents(t)` otherwise. Clean re-measurement on a fresh load gave 20/22 within 0.7px and two at 21.3px / 23.7px.

7. **My own wrong assertion about phrase-internal spaces** — I asserted `点空格_历史没长` should be true; it returned `false`. I had it backwards: falling through to the `.ph` branch legitimately appends a *phrase* history row. Re-tested and confirmed the row is the phrase with a proper 词 badge, not a blank one.

8. **`slice(-1)` to read the newest history row** — history prepends, so `slice(-1)` returns the *oldest*. Re-tested with `rows()[0]` and got coherent results.

9. **Playwright saved screenshots to the wrong project** — its allowed roots were `/Users/ei/Desktop/temp/book1`, not pet-reading. Worked around by reading/writing via book1 paths, then cleaned up (`desktop-article.png`, `phone.png`, `final-desktop.png`, `.playwright-mcp/`) so book1 stayed pristine.

## 5. Problem Solving

- **Proved the title bug was invisible to 106 passing assertions**, then closed the gap with 4 new assertions — one of which immediately caught a second issue (my own over-broad regex), which I then narrowed.
- **Quantified the margin-button alignment honestly** rather than declaring victory: 20/22 within 0.7px, 2 pushed 21–24px by deliberate anti-overlap logic for sentences that start mid-line. Documented as by-design in the README so a future author doesn't hunt it as a bug.
- **Confirmed `file://` viability**: build output uses relative paths (`engine/style.css?v=…`, `engine/app.js?v=…`) with classic scripts, so double-clicking works.
- **Measured the real payload**: engine 24.5KB gzip, per-article content 24.4KB, first visit ≈49KB.
- **Identified that the hard login gate (user's choice) breaks `file://`** — localStorage is unreliable on `file://`/private mode, so a naive gate would infinite-redirect. Designed fail-open gating and flagged the three consequences (no SEO indexing, WeChat-forwarded links land on login, `file://` dies) for the README.
- **Identified the build.mjs orphan cleanup as the hard wall** for adding any new page, and designed a page registry rather than more special-casing.
- **Stopped the background Plan agent** after its premises were invalidated by the user's answers, judging a stale half-plan to be noise.

## 6. All User Messages

1. *(Pre-compaction)* "好的，前面我提了很多需求，假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右"
2. *(Pre-compaction)* Pasted the full `reading-part4-提示词.md` document as reference material.
3. *(Pre-compaction)* "我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等"
4. *(Pre-compaction)* "好的，干吧，要不要在同一个新的文件夹下面开干？"
5. **"1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除  3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"**
6. *(AskUserQuestion round 1)* Chose: 数据存储 = **"先纯前端，预留后端（推荐）"**; 手机端面板 = **"底部抽屉（推荐）"**; 收藏范围 = **"单词 + 词组 + 句子（推荐）"**.
7. *(AskUserQuestion round 2)* 登录门禁 = **"强制登录才能看"** (overriding my "不强制" recommendation); 收藏入口 = custom answer: **"不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。"**
8. *(AskUserQuestion round 3)* ☆ 的位置 = **"历史列表每行右侧"**.

No security-specific constraints were stated by the user in this conversation.

## 7. Pending Tasks

The four features are planned but **not yet implemented**. Per the plan file, in dependency order:

- **Step 0** — Generalize `build.mjs`: page registry (replacing the `index.html` special case at `:115`), engine asset directory scan replacing the hardcoded array at `:72`, generic `<!--V:filename-->` placeholder, fix `--only` truncating `index.html`, fix silently-skipped missing article files.
- **Step 1** — Create `engine/store.js`: async `window.PETStore` global with `available/getUser/login/logout/addFav/isFav/listFav/getTheme/setTheme`; keys `pet:user:v1`, `pet:fav:v1`, `pet:theme:v1`; plus `tools/test-store.mjs`.
- **Step 2** — Dark mode: promote the 67 hardcoded colors to semantic tokens (`--ok/--ok-bg/--ok-line`, `--danger`, `--warn`, `--hl/--hl-2/--hl-peek`, `--chip-*`×4, `--code-bg/--code-ink`, `--scroll`, `--on-accent`); delete dead `--hard`/`--hard-bg`; `:root[data-theme="dark"]` override block; inline `<head>` FOUC-prevention script; `#tglTheme` tri-state button; `color-scheme`/`theme-color` metas.
- **Step 3** — Responsive: replace the single 1180px breakpoint with ≥1100px two-column / <1100px single-column + bottom-sheet `#colAna` (same DOM, CSS-only re-presentation); fix `.hdel` touch-dead, `.hist-float` overflow, `100vh`→`100dvh`; add `viewport-fit=cover`, `-webkit-text-size-adjust`.
- **Step 4** — Login page `engine/login.template.html` → `dist/login.html` (loads style.css + store.js, **not app.js**); hard gate in `init()` using `location.replace`; gate on `index.html` too; **fail-open when `store.available === false`**; same-origin validation of the `next` param; masked phone in `.brand`.
- **Step 5** — Favorites ☆ in each `renderHistory()` row between `.hopen` and `.hdel`, bound as a third branch in `bindHistory`, storing `lookup()`'s resolved base form; must be included in `@media(hover:none)` always-visible list.
- **Step 6** — Tests and docs: generalize `loadArticle` → `loadPage(file, {expectScripts})`, add `testLoginPage()`/`testIndexGate()`, **pre-seed `pet:user:v1` in `testArticle` or all 110 existing assertions will render the redirect page instead**, update README with the three gate consequences and the manual-browser checklist.

## 8. Current Work

Immediately before this summary I was finalizing the plan file at `/Users/ei/.claude/plans/serialized-crunching-swing.md` in plan mode. The last action was a small correction to the plan's page-registry snippet, fixing the `renderIndex` argument order to match the existing signature:

```js
     // 注意 renderIndex 现有签名是 (man, slugs)，参数顺序别写反
     { out: "index.html", render: () => renderIndex(manifest, flat.map(x => x.slug)) },
```

Just before that I had stopped the background Plan agent (`a3a11877d00eba7c4`) because two of its premises — "favorites list panel" and "optional login gate" — had been overturned by the user's answers, making roughly half its output stale. My message to the user stated: "Plan agent 的另两个前提（收藏列表面板、登录可选）已经被你的答复推翻了，它的产出会有一半是过时的，留着反而是噪音。停掉它，方案我自己已经基于三份探查报告加实际读码定完了。"

The plan file is complete and reflects all four user decisions. The session is still in plan mode — **no implementation has begun**, and `build.mjs`/`smoke.mjs` gzip and title fixes from the earlier (completed) phase are the only code changes made in this session.

## 9. Optional Next Step

Call `ExitPlanMode` to present the finished plan for approval. Per the plan-mode workflow: "At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ExitPlanMode to indicate to the user that you are done planning."

If approved, begin with **Step 0 (generalize `build.mjs`)**, which the plan identifies as the prerequisite for everything else: "**第 0 步是一切新页面的前提**；**第 1 步是第 4、5 步的前提**。" After each step, run `npm run check` to keep verify / build / smoke green — noting the plan's explicit warning that Step 4's gate will break all 110 existing smoke assertions unless `pet:user:v1` is pre-seeded: "**注意门禁会让现有 110 条断言全部跳转失效**：`testArticle` 必须在 jsdom 里预置一个已登录的 `pet:user:v1`，否则每个用例都会渲染成跳转页。这是本次改动里最容易漏掉的一处回归。"

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/ei/.claude/projects/-Users-ei-Desktop-temp-book1/1bd2e541-a836-426b-b848-844e2bf3b35e.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.

---

## Claude

Step 0: 泛化 `build.mjs`。先改引擎资产扫描与版本占位符。

---

## Claude

Now `renderIndex` 里的 `V_CSS` 引用：

---

## Claude

Now the template's placeholder syntax:

---

## Claude

Step 0 ✓（增量、`--only`、缺文件报错都验过了）。现在 Step 1：`engine/store.js`。

---

## Claude

两个真问题：一是收藏是 toggle（换篇点同一个词是取消，不是新增），二是我的断言把注释里的字样也算进去了。

---

## Claude

Step 1 ✓（72 条断言）。现在 Step 2 黑暗模式 —— 先通读 `style.css`。

---

## Claude

现在把 67 处硬编码色提升为语义令牌。用一个带计数断言的一次性脚本来做，比手改几十处安全。

---

## Claude

规则全部命中，只剩收尾检查把注释和那一处有意的半透明色也算进去了。修检查器：

---

## Claude

Now 收藏功能 —— `renderHistory` 里的 ☆ 和 `bindHistory` 的第三个分支：

---

## 用户

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:

   **Pre-compaction (completed):** The user asked whether their per-article HTML reading-comprehension pattern would scale, then how to architect 200+ articles (mentioning uni-app / Vue / front-end-back-end separation as candidates), then approved building a new architecture in a new folder. That work was completed in `/Users/ei/Desktop/temp/pet-reading/`: engine/content separation, `articles/*.json` migration, `tools/new.mjs` skeleton generator, batch build, and a three-gate test pipeline.

   **The four current feature requests (verbatim):**
   > "1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除 3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"

   **Four binding decisions made by the user through AskUserQuestion rounds:**
   1. **Storage: pure front-end but with a backend seam** — login state and favorites in localStorage, but all reads/writes go through a thin async adapter (`engine/store.js`) so swapping in a backend later changes only that one file.
   2. **Mobile panel: bottom sheet** — the blackboard slides up from the bottom on narrow screens; the sheet header carries 🔊, so the margin 析/🔊 buttons need not return on mobile.
   3. **Hard login gate** — this was the *user's* choice, overriding my recommendation of a non-blocking gate. Unauthenticated users cannot read any article.
   4. **Favorites reduced, then narrowed again** — user wrote in a custom answer: "不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。" Then, asked to disambiguate "每个单词右侧", chose **历史列表每行右侧** (each row of the history float gets a ☆ next to the existing ✕). So: no favorites list panel at all; just a ☆ button per history row plus a deferred DB interface.

   The plan at `/Users/ei/.claude/plans/serialized-crunching-swing.md` was approved via ExitPlanMode at the start of this session.

2. Key Technical Concepts:
   - **Engine/content separation**: engine files cached once site-wide, only per-article JSON downloaded after the first page.
   - **Single self-contained HTML output, zero dependencies, classic (non-module) scripts, all state in localStorage**; the login gate partially breaks the `file://` property.
   - **Cache busting via stable filenames + `?v=<8-char SHA1>`**, now generalized to `<!--V:filename-->` placeholders filled by a directory scan of `engine/`.
   - **gzip pre-compression at build time** (`zlib.gzipSync`, level 9) for `nginx gzip_static`; idempotent (skips unchanged, preserves mtime).
   - **jsdom smoke testing** with external CSS/JS inlined back (must pass *functions* to `String.replace`) — pitfall #18.
   - **node:vm sandbox testing** for `store.js` (jsdom's `location` is read-only, can't be stubbed; vm gives full control).
   - **Tokenizer contract** (must be byte-identical in `engine/app.js`, `tools/verify.mjs`, `tools/new.mjs`): `/\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g`
   - **`Range.getBoundingClientRect()`** for margin-button alignment.
   - **`--zoom` as a CSS custom property** written to `<html>` from JS; 50 `calc(Npx * var(--zoom))` uses across 42 lines.
   - **Async-from-day-one adapter pattern** for the backend seam.
   - **FOUC prevention via an inline `<head>` script** reading `pet:theme:v1` (JSON-encoded) before the blocking stylesheet, resolving `auto` to a concrete `light`/`dark` at write time so CSS needs no second `@media (prefers-color-scheme)`.
   - **Semantic design tokens** — 65 CSS rules promoted ~67 hardcoded colors to tokens; dark theme overrides tokens only, never components.
   - **Fail-open gating** — when `store.available() === false` the gate must let the user through rather than infinite-redirect.
   - **CSS-only bottom sheet** — reuse the same `#colAna` DOM, `transform:translateY(100%)` when closed (NOT `display:none`, which would kill the slide animation).

3. Files and Code Sections:

   - **`/Users/ei/Desktop/temp/pet-reading/build.mjs`** — EDITED (Step 0 complete, verified).
     Replaced hardcoded engine file list with a directory scan:
     ```js
     const assets = fs.readdirSync(P("engine"))
       .filter(f => /\.(js|css)$/.test(f))
       .sort()
       .map(f => {
         const body = read(P("engine", f));
         return { name: f, body, hash: hash(body) };
       });
     const V = Object.fromEntries(assets.map(a => [a.name, a.hash]));
     /* 任何一篇的产物都内联引用引擎，所以引擎任一文件变了，所有文章的缓存签名都得变 */
     const ENGINE_SIG = assets.map(a => a.name + ":" + a.hash).join("|");

     const PAGES = [
       { out: "index.html", render: () => renderIndex(manifest, present) }
     ];
     const PAGE_OUTS = new Set(PAGES.map(p => p.out));
     ```
     Added:
     ```js
     function fillVersions(html) {
       return html.replace(/<!--V:([A-Za-z0-9_.-]+)-->/g, (m, name) => {
         if (!(name in V)) {
           console.error("✗ 模板引用了 engine/ 下没有的文件：" + name);
           process.exitCode = 1;
           return "0";
         }
         return V[name];
       });
     }
     ```
     `render()` now wraps everything in `fillVersions(...)`; `sig = hash(raw + ENGINE_SIG)`; loop skips missing files with `continue` (collected separately); PAGES loop replaces the index write; orphan cleanup uses `!PAGE_OUTS.has(f)`; `builtSlugs` removed; footer prints `assets.map(a => a.name + " v=" + a.hash)`; missing-file block at end sets exit code 1. `renderIndex` link changed to `${V["style.css"]}`.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/store.js`** — CREATED (Step 1 complete, 72 assertions green).
     IIFE assigning `window.PETStore`. Keys `pet:user:v1`, `pet:fav:v1`, `pet:theme:v1`, `pet:probe:v1`. Contents:
     ```js
     function LS() {
       if (!_lsTried) {
         _lsTried = true;
         try { _ls = window.localStorage || null; } catch (e) { _ls = null; }
       }
       return _ls;
     }
     function available() {
       var s = LS(); if (!s) return false;
       if (_avail === null) {
         try { s.setItem(K_PROBE, "1"); _avail = s.getItem(K_PROBE) === "1"; s.removeItem(K_PROBE); }
         catch (e) { _avail = false; }
       }
       return _avail;
     }
     ```
     `readKey` falls through to `_mem` when storage yields null (so write-broken storage can still toggle off). `writeKey` writes `_mem` first then returns whether storage persisted. `guard()` caches `_guard` promise:
     ```js
     _guard = (async function () {
       if (!available()) return "open";
       if (await getUser()) return "ok";
       var here = window.location.pathname + window.location.search + window.location.hash;
       window.location.replace("login.html?next=" + encodeURIComponent(here));
       return "denied";
     })();
     ```
     `safeNext(raw)` rejects non-http(s) protocols and cross-origin; `favId(it)` = `"s:"+slug+"@"+ref` or `type+":"+key`; `addFav` toggles; `nextTheme()` cycles auto→light→dark; `paint()` writes `data-theme` + `meta[name=theme-color]` (`#12151b` dark / `#eef1f6` light). matchMedia `change` listener repaints only in auto mode. Exports 15 methods including `maskPhone` and `paintTheme`.

   - **`/Users/ei/Desktop/temp/pet-reading/tools/test-store.mjs`** — CREATED. `✓ store.js 单测通过：72 条断言`. Uses `node:vm` with `makeSandbox({lsBroken: "access"|"write", dark, seed})`; sandbox only injects `window`, `document`, `URL`, `console`.

   - **`/Users/ei/Desktop/temp/pet-reading/package.json`** — EDITED: added `"test:store": "node tools/test-store.mjs"`, and `check` now runs verify → build → smoke → test-store.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/style.css`** — HEAVILY EDITED (Steps 2 & 3).
     `:root` now has ~60 semantic tokens in commented sections (表面/字/线/主色/词组/句子三态/绿/红/橙/紫/chip/代码/徽章/成分卡片梯度/滚动条与阴影), dead `--hard`/`--hard-bg` deleted. New `:root[data-theme="dark"]` block with the full dark palette (`--bg:#12151b`, `--panel:#1a1e26`, `--accent:#5b93ff`, `--on-solid:#0e131b`, `--part-lo:23%`, `--part-span:17%`, etc.).
     Component gradient:
     ```css
     .part{
       border-radius:9px;padding:7px 11px;
       background:hsl(220 13% calc(var(--part-lo) + var(--part-span) * var(--pt, 0)));
     }
     ```
     Body: added `-webkit-text-size-adjust:100%` and `height:100dvh` after `height:100vh`.
     `.who`/`.who-num`/`.who-out` styles added.
     `.hist-float` top → `var(--hist-top,64px)`.
     pgutter breakpoint 1180 → 1099.
     `.hfav,.hdel` rewritten with `@media(hover:none){.hfav,.hdel{opacity:1}}`.
     Bottom media query fully rewritten: topbar `flex-wrap:nowrap;overflow-x:auto`, `#colAna` fixed bottom sheet (`height:62dvh; transform:translateY(100%)`, `.cols.hide-ana #colAna{display:flex}`, `.cols:not(.hide-ana) #colAna{transform:translateY(0)}`, `::before` handle bar), `.hist-float` narrow override (`top:auto;left:14px;right:14px;width:auto;max-height:72vh;z-index:70`). `.scrim` block with `@media(max-width:1099px)` and `.cols:not(.hide-ana) ~ .scrim{opacity:1;pointer-events:auto}`.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/template.html`** — REWRITTEN.
     Head: `viewport-fit=cover`, `color-scheme`, `theme-color`, inline FOUC script:
     ```html
     <script>(function(){var t=null;try{t=JSON.parse(localStorage.getItem("pet:theme:v1")||"null")}catch(e){t=null}
     if(t!=="light"&&t!=="dark")t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";
     document.documentElement.setAttribute("data-theme",t)})();</script>
     <link rel="stylesheet" href="engine/style.css?v=<!--V:style.css-->">
     <script src="engine/store.js?v=<!--V:store.js-->"></script>
     <script>PETStore.guard().catch(function(){});</script>
     ```
     Body: `.brand` has `<span class="who" id="who" hidden></span>`; `.tools` has `<button class="tool" id="tglTheme" title="主题：跟随系统">◐ 跟随</button>` as the first button; `<div class="scrim" id="scrim"></div>` after `.cols`; footer has `<script src="engine/app.js?v=<!--V:app.js-->"></script>`.
     NOTE: article HTML now has **5** `<script>` tags, so smoke's "exactly 2 scripts" assertion WILL FAIL until updated.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/app.js`** — EDITED (Steps 2/3 done, Step 5 PARTIAL).
     `.part` render changed:
     ```js
     var t = np > 1 ? i / (np - 1) : 0;
     var ink = t <= 0.5114 ? "var(--part-ink-a)" : "var(--part-ink-b)";
     h += '<div class="part" style="--pt:' + t.toFixed(3) + ';color:' + ink + '">';
     ```
     Line ~915: `style="background:var(--pool-bg)"`.
     `state` gained `favIds: {}`.
     Added `uiSaveOff` + early return in `saveUI()`; `isNarrow()` via `matchMedia("(max-width:1099px)")`; `openAnaOnNarrow()` which sets `uiSaveOff=true; cols.ana=true; applyCols(); uiSaveOff=false;`.
     `openAnaOnNarrow()` called at the top of both `showWord` and `showAnalysis`.
     Added `renderWho(u)`, `THEME_LABEL`/`THEME_TIP`, `renderThemeBtn(t)`, `bindTheme()`, `bindScrim()`; `bindTheme(); bindScrim();` called in `init()` before `loadUI()`.
     Added at the end:
     ```js
     async function boot() {
       var st = window.PETStore;
       if (st && st.guard) {
         try {
           if (await st.guard() === "denied") return;
           renderWho(await st.getUser());
         } catch (e) { /* 门禁自己出岔子 → 放行 */ }
       }
       init();
     }
     if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
     else boot();
     ```
     `renderHistory()` just received a PARTIAL edit adding `var fav = favOf(it); var on = !!(fav.id && state.favIds[fav.id]);` and changing the comment to "三个 button".

   - **`/tmp/patch-css.mjs`** — one-off token-promotion script (65 rules, each asserting exact hit count, aborting without writing on mismatch). Already applied successfully; can be discarded.

   - **`/tmp/style.css.bak`**, **`/tmp/manifest.bak`** — backups made during verification.

4. Errors and fixes:
   - **`patch-css.mjs` final leftover-color check false-positived on my own comment text and the intentional `rgba(128,128,128,.2)`** — fixed by stripping block comments (replacing non-newline chars with spaces) before the scan and whitelisting that one rgba. Re-ran from the pristine backup to avoid partial application.
   - **store test failure: "同一个词在不同篇里反复收藏，只留一条（实际 0，期望 1）"** — my test was wrong, not the code: `addFav` toggles, so adding the same word from a different slug *removes* it. Rewrote the assertions to test toggle semantics (`cross.added === false`, list length 0) and the sentence count changed from 3 to 2.
   - **store test failure: "store.js 里不出现 PET_CONTENT"** — the literal string appeared in a code comment. Fixed with `const bare = CODE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");` before the check.
   - **`readKey` returned the storage default instead of `_mem` when storage was write-broken** — meant a favorite could be lit but never un-toggled. Fixed so a null storage read falls through to `_mem`.
   - **Test assertion ordering bug** — `eq(await s.getUser(), null, "校验失败不留痕迹")` was placed after a *successful* login. Moved it before the valid-phone case.
   - **Sandbox injected host intrinsics** (`Object`, `JSON`, `Array`…) causing cross-realm prototype mismatches. Removed; only `window`, `document`, `URL`, `console` are injected, and comparisons use `JSON.stringify` in an `eq()` helper.

5. Problem Solving:
   - Established `build.mjs` incrementality survives the refactor (1 built, then 1 skipped) and that `--only` no longer truncates `dist/index.html`.
   - Verified the missing-manifest-entry path now exits 1 with a clear message instead of silently succeeding.
   - Proved the token promotion is complete and mechanical: 65 rules, all matched, and a post-scan confirms the only remaining color literals are token definitions plus one deliberate translucent neutral.
   - Designed the `.part` gradient to be theme-driven: JS emits only a rank (`--pt`), the light/dark endpoints and ink colors live in CSS tokens — so dark mode needs zero JS changes.
   - Chose `transform:translateY(100%)` + `.cols.hide-ana #colAna{display:flex}` for the drawer so the slide animation survives; `position:fixed` keeps it out of flow.
   - Introduced `uiSaveOff` so the narrow-screen auto-collapse/auto-open of the drawer does not overwrite the user's desktop column preference in localStorage.
   - Identified that `renderHistory()` is synchronous but `isFav` is async → resolved by caching `state.favIds` at boot and updating it on toggle.

6. All user messages:
   - *(Pre-compaction)* "好的，前面我提了很多需求，假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右"
   - *(Pre-compaction)* Pasted the full `reading-part4-提示词.md` document as reference material.
   - *(Pre-compaction)* "我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等"
   - *(Pre-compaction)* "好的，干吧，要不要在同一个新的文件夹下面开干？"
   - **"1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除  3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"**
   - *(AskUserQuestion round 1)* Chose: 数据存储 = **"先纯前端，预留后端（推荐）"**; 手机端面板 = **"底部抽屉（推荐）"**; 收藏范围 = **"单词 + 词组 + 句子（推荐）"**.
   - *(AskUserQuestion round 2)* 登录门禁 = **"强制登录才能看"** (overriding my "不强制" recommendation); 收藏入口 = custom answer: **"不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。"**
   - *(AskUserQuestion round 3)* ☆ 的位置 = **"历史列表每行右侧"**.
   - *(This session)* Approved the plan via ExitPlanMode.

   No security-specific constraints were stated by the user. The plan itself specifies security design decisions that must be preserved: `safeNext` must reject off-origin/non-http(s) `next` values (open-redirect prevention), the gate must **fail open** when storage is unavailable (`available() === false` → "open"), and the client-side gate is explicitly documented as a *soft* gate that is trivially bypassable — its purpose is collecting phone numbers via a login flow, not preventing access.

7. Pending Tasks:
   - **Step 5 (favorites) is mid-edit and the code is currently BROKEN** — `renderHistory` now calls `favOf(it)` which does not exist.
   - Step 3 residual: `uiSaveOff` is defined but never set around the narrow-screen default collapse in `init()` — the `if (isNarrow()) { uiSaveOff = true; cols.ana = false; }` + `switchTab("read")` + `uiSaveOff = false` block has NOT been added.
   - Step 4: login page (`engine/login.template.html` → `dist/login.html`, loads style.css + store.js but **not** app.js), page registry entry + `renderLogin(manifest)`, gate on `index.html` (add store.js + inline gate to `renderIndex`).
   - Step 6: `tools/verify.mjs` assertion that `engine/store.js` exists and has no `PET_CONTENT` dependency; `tools/smoke.mjs` — generalize `loadArticle` → `loadPage(file, {expectScripts})` (article pages now have 5 scripts, not 2), add `testLoginPage()`/`testIndexGate()`, and **pre-seed `pet:user:v1` in `testArticle` or all 110 existing assertions will render the redirect page**; README updates (three gate consequences, store.js backend-seam note, storage key table, breakpoint table, manual browser checklist).
   - Browser verification via Playwright at 375/768/1024/1180/1440 × light/dark.

8. Current Work:
   I was in the middle of Step 5 (favorites ☆ button). I had just read `renderHistory` (app.js:477-511), `bindPassage` (1063-1172), `bindHistory` (1141-1161) and `lookup` (182-213) to understand the insertion points, then applied exactly ONE edit to `renderHistory`:
   ```js
   var h = "";
   state.hist.forEach(function (it) {
     var isW = it.t === "w";
     var id = histKey(it);
     var fav = favOf(it);
     var on = !!(fav.id && state.favIds[fav.id]);
     // 行本身是 div，内部三个 button 平级 —— button 不能嵌套 button
     h += '<div class="hitem ' + (isW ? "w" : "s") +
       (state.curHist === id ? " cur" : "") + '">';
     h += '<button class="hopen" data-hist="' + esc(id) + '" title="重新显示在小黑板">';
   ```
   **`favOf` is not yet defined anywhere — the file will throw as soon as a history row renders.** The remaining pieces of Step 5 that still need writing are:
   - `favOf(it)` — returns `{id, item}` where `item` is `{type:"s", ref, slug:SLUG, cn:sentLabel(it.ref)}` or `{type:"w", key:resolveFavKey(it.k), slug:SLUG, cn:stripTags(e.cn||"")}` and `id` comes from `window.PETStore.favId(item)` (no duplicated id rule).
   - `resolveFavKey(raw)` — `var r = lookup(raw); if (r) return r.key;` else `String(raw).toLowerCase()` (must store the dictionary base form so `centuries` and `century` are one favorite).
   - `refreshFavs()` — fills `state.favIds` from `PETStore.listFav()`, awaited in `boot()` before `init()`.
   - The ☆ button HTML inserted between the `.hopen` close tag and the `.hdel` button:
     `h += '<button class="hfav' + (on ? " on" : "") + '" data-fav="' + esc(id) + '" title="...">' + (on ? "★" : "☆") + '</button>';`
   - The `[data-fav]` third branch in `bindHistory` (before the `[data-hist]` branch), calling `window.PETStore.addFav(f.item).then(...)` and updating `state.favIds`, the `on` class, the glyph and the title.

9. Optional Next Step:
   Finish Step 5 by adding `resolveFavKey()`, `favOf()`, `refreshFavs()`, the ☆ button markup in `renderHistory()`, and the `[data-fav]` branch in `bindHistory()` in `engine/app.js`; then add the narrow-screen default-collapse block in `init()` that uses the already-defined-but-unused `uiSaveOff`:
   ```js
   loadUI();            // 先读回上次的列状态
   if (isNarrow()) { uiSaveOff = true; cols.ana = false; }   // 窄屏抽屉默认收起，且不写回存储
   switchTab("read");
   uiSaveOff = false;
   ```
   Then run `npm run check` — noting the plan's explicit warning that this will now fail: smoke's `[${slug}] HTML 里恰好 2 个 <script>` assertion (article pages now have 5 scripts) and, once the Step 4 gate lands, all 110 existing assertions will render the redirect page unless `testArticle` pre-seeds `pet:user:v1`, which the plan calls "**本次改动里最容易漏掉的一处回归**". Step 4 (login page + gate) and Step 6 (tests/docs) remain after that.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/ei/.claude/projects/-Users-ei-Desktop-temp-book1/1bd2e541-a836-426b-b848-844e2bf3b35e.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.

---

## Claude

Now `refreshFavs()` in `boot()` — the ☆ state has to be loaded before the first `renderHistory()`:

---

## Claude

Now Step 4 — the login page. Let me look at `build.mjs`:

---

## Claude

Now the login page. Template first:

---

## Claude

Now the login page styles, appended to `style.css`:

---

## Claude

Now a shared `mountWho` so the index page and article page render the same phone chip (the user asked for the number on *every* page):

---

## Claude

Now `app.js` delegates to it:

---

## Claude

Now `build.mjs` — register the login page and add the gate to the index:

---

## Claude

Now swap the two templates' inline FOUC scripts for the placeholder:

---

## Claude

Now smoke.mjs. First let me probe how jsdom handles the new media queries:

---

## Claude

Now the smoke test. First the loader — article pages now have two engine scripts to inline:

---

## Claude

Now the favorites assertions inside `testArticle`, plus the two new page tests:

---

## Claude

Now the two new page tests and the runner:

---

## Claude

Two real failures. Let me look at each:

---

## Claude

Now the storage-unavailable login case — my test never actually broke storage:

---

## Claude

All green at 190. Now the CSS invariants and `verify.mjs`:

---

## Claude

Now the engine-level invariants in `verify.mjs`:

---

## Claude

Let me verify these new checks actually fire (mutation test):

---

## Claude

The color check missed `#ff00ff` — my achromatic test parsed hex as decimals. Fixing:

---

## Claude

Full pipeline green. Now the browser verification the plan requires — dark mode, the bottom drawer, and gutter alignment are things jsdom can't see:

---

## Claude

Only a favicon 404. Let me screenshot the login page in both themes:

---

## Claude

Found a real bug the tests missed — the login `<h1>` is empty. `<!--SITE-->` appears twice (in `<title>` and in the `<h1>`), and `String.replace` with a string pattern only replaces the first:

---

## Claude

Now a regression test so an empty title can't slip through again:

---

## Claude

While the build is green — a latent caching bug I should fix now: `template.html` isn't in the engine signature, so editing the template never invalidates the article cache:

---

## Claude

Now back to the browser:

---

## Claude

Title fixed. Now dark mode and the login flow:

---

## Claude

Dark login page is correct. Now log in and check the article at desktop width:

---

## Claude

Login → article works. Now desktop width:

---

## Claude

Single-column because the page loaded at 375px (correct narrow behavior). Reloading at 1440 to see the real desktop layout:

---

## Claude

Desktop 2-column dark mode is correct. Let me test the word click → history → ☆ flow:

---

## Claude

The ☆ is hover-hidden by design. Let me hover the row:

---

## Claude

Both ☆ and ✕ appear. Now click the ☆:

---

## Claude

The glossary deliberately has both `century` and `centuries` as separate headwords (different IPA, plus a plural-rule note) — so keying on the matched headword is right. Let me confirm the *fallback* path (inflected form with no headword) yields the lemma:

---

## Claude

Lemma fallback works (`years` clicked → `year` stored). Now the mobile bottom drawer:

---

## Claude

No horizontal overflow (375 = 375) and the drawer is parked at `translateY(471px)`. Clicking a word should slide it up:

---

## Claude

The drawer works, but the history float is parked on top of it — tapping a word looks broken when history was open. Let me look at the toggle logic:

---

## Claude

`uiSaveOff` didn't hold: the moment the user toggles *any* column, the narrow-forced `ana:false` gets written as if it were their preference. Let me look at the toggle path:

---

## Claude

Replacing the fragile `uiSaveOff` flag with a separate "user preference" value:

---

## Claude

There's an issue with the selected model (deepseek-flash). It may not exist or you may not have access to it.

---

## 用户

go on

---

## Claude

Now the one thing only a touch device can show — ☆ visibility without hover:

---

## Claude

The touch-context probe needs unsafe code execution, so let me instead make it a machine-checked invariant — that's the durable fix anyway:

---

## Claude

Two false positives — `@keyframes` and the `@media` wrapper. Let me make the scan brace-aware:

---

## Claude

`.scrim` uses `opacity:0` as a fade state, not hover-hiding. Tightening the rule to only hover-gated controls:

---

## Claude

The invariant fires exactly on the regression the plan warned about. Full pipeline:

---

## Claude

Now let me check the index page and the remaining widths. First the index at desktop, dark:

---

## Claude

Resize is handled (60ms debounce). Let me measure alignment and layout across all breakpoints:

---

## Claude

Alignment is correct at 1280 (buttons sit 30.7px into the 58px gutter). Now the iPad Pro 11" landscape case the plan flagged:

---

## Claude

`gapRange` max of 285px looks like it's comparing against question-area sentences. Let me re-measure restricted to the passage:

---

## 用户

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:

   **Pre-compaction (completed earlier):** The user asked whether their per-article HTML reading-comprehension pattern would scale, then how to architect 200+ articles, then approved building a new architecture. That work is done in `/Users/ei/Desktop/temp/pet-reading/`: engine/content separation, `articles/*.json` migration, `tools/new.mjs` skeleton generator, batch build, three-gate test pipeline.

   **The four current feature requests (verbatim):**
   > "1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除 3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"

   **Four binding decisions the user made through AskUserQuestion rounds:**
   1. **Storage: pure front-end but with a backend seam** — login state and favorites in localStorage, but all reads/writes go through a thin async adapter (`engine/store.js`) so swapping in a backend later changes only that one file.
   2. **Mobile panel: bottom sheet** — the blackboard slides up from the bottom on narrow screens; the sheet header carries 🔊, so the margin 析/🔊 buttons need not return on mobile.
   3. **Hard login gate** — the user's own choice, overriding my recommendation of a non-blocking gate. Unauthenticated users cannot read any article.
   4. **Favorites narrowed twice** — the user wrote: "不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。" Then chose **历史列表每行右侧** (each row of the history float gets a ☆ next to the existing ✕). So: no favorites list panel; just ☆ per history row plus a deferred DB interface.

   The plan at `/Users/ei/.claude/plans/serialized-crunching-swing.md` was approved via ExitPlanMode at the start of the previous session.

2. Key Technical Concepts:
   - **Engine/content separation**: engine files cached once site-wide; only per-article JSON downloaded after the first page.
   - **Single self-contained HTML output, zero dependencies, classic (non-module) scripts, localStorage state**; the login gate partially breaks `file://`.
   - **Cache busting**: `<!--V:filename-->` placeholders filled by a directory scan of `engine/`, 8-char SHA1.
   - **`ENGINE_SIG`** must include `template.html` (not just `*.js`/`*.css`) or template edits never invalidate the article cache.
   - **gzip pre-compression at build time** (`zlib.gzipSync` level 9) for `nginx gzip_static`; idempotent, preserves mtime.
   - **jsdom smoke testing** with external CSS/JS inlined back — must pass *functions* to `String.replace` (pitfall #18).
   - **jsdom facts discovered this session**: `window.matchMedia` is **undefined**; `getComputedStyle` **ignores `@media` rules entirely**. So bottom-sheet CSS is invisible to jsdom and must be browser-verified.
   - **node:vm sandbox testing** for `store.js` (jsdom's `location` is read-only).
   - **Tokenizer contract** (byte-identical in `engine/app.js`, `tools/verify.mjs`, `tools/new.mjs`): `/\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g`
   - **Async-from-day-one adapter pattern** for the backend seam.
   - **FOUC prevention**: a single `THEME_HEAD` constant in build.mjs, injected via `<!--THEME_HEAD-->` into all templates, reading `pet:theme:v1` before the blocking stylesheet.
   - **Semantic design tokens** — dark theme overrides tokens only, never components. Enforced mechanically by verify.mjs.
   - **Fail-open gating** — `store.available() === false` → guard returns `"open"`.
   - **CSS-only bottom sheet** — `transform:translateY(100%)` when closed (NOT `display:none`, which would kill the slide animation).
   - **`userAna` vs `cols.ana`** — user preference vs current display state, so the narrow-screen auto-collapse never becomes a saved preference.
   - **`@media(hover:none)` always-visible rule** for controls hidden behind `:hover`, now machine-enforced.

3. Files and Code Sections:

   - **`/Users/ei/Desktop/temp/pet-reading/engine/app.js`** — the engine IIFE. Changes this session:
     - Completed `renderHistory` ☆ markup: three sibling buttons (`.hopen`, `.hfav`, `.hdel`) — "行本身是 div，内部三个 button 平级 —— button 不能嵌套 button".
     - Added `resolveFavKey`, `favOf`, `refreshFavs`:
       ```js
       var store = window.PETStore;
       function resolveFavKey(raw) {
         var r = lookup(raw);
         if (r) return r.key;
         return String(raw == null ? "" : raw).toLowerCase();
       }
       function favOf(it) {
         var item;
         if (it.t === "s") item = { type: "s", ref: it.ref, slug: SLUG, cn: sentLabel(it.ref) };
         else {
           var key = resolveFavKey(it.k);
           var e = (C.glossary && C.glossary[key]) || {};
           item = { type: "w", key: key, slug: SLUG, cn: stripTags(e.cn || "") };
         }
         return { id: store ? store.favId(item) : "", item: item };
       }
       function refreshFavs() {
         state.favIds = {};
         if (!store) return Promise.resolve();
         return store.listFav().then(function (arr) {
           (arr || []).forEach(function (x) { state.favIds[store.favId(x)] = 1; });
         });
       }
       ```
     - `bindHistory` gained a `[data-fav]` branch **first**:
       ```js
       var fv = ev.target.closest("[data-fav]");
       if (fv) {
         var fit = state.hist.filter(function (x) { return histKey(x) === fv.dataset.fav; })[0];
         if (!fit || !store) return;
         var f = favOf(fit);
         store.addFav(f.item).then(function (r) {
           r = r || {};
           if (!r.ok) return;
           if (r.added) state.favIds[f.id] = 1; else delete state.favIds[f.id];
           fv.classList.toggle("on", !!r.added);
           fv.textContent = r.added ? "★" : "☆";
           fv.title = r.added ? "取消收藏" : "收藏这个词，之后汇进生词本";
         });
         return;
       }
       ```
     - Replaced `uiSaveOff` with `userAna`:
       ```js
       var cols = { ana: true, vocab: false };
       var userAna = true;   // 用户对小黑板的**偏好**
       function loadUI() { ...; userAna = cols.ana; }
       function saveUI() {
         try { localStorage.setItem(LS_UI, JSON.stringify({ ana: userAna, vocab: cols.vocab })); } catch (e) {}
       }
       function toggleCol(key) {
         cols[key] = !cols[key];
         if (key === "ana" && !isNarrow()) userAna = cols.ana;
         applyCols();
       }
       ```
     - `openAnaOnNarrow()` now also closes the history float:
       ```js
       function openAnaOnNarrow() {
         if (!isNarrow()) return;
         if (cols.vocab) { cols.vocab = false; applyCols(); }
         if (!cols.ana) { cols.ana = true; applyCols(); }
       }
       ```
     - `init()` ends with:
       ```js
       loadUI();
       if (isNarrow()) cols.ana = false;
       switchTab("read");
       applyZoom(loadZoom());
       ```
     - `renderWho()` now delegates: `if (store && store.mountWho) return store.mountWho(document.getElementById("who"));`
     - `boot()` awaits `refreshFavs()` before `init()`.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/store.js`** — the backend seam. Added `herePath()`, `mountWho(el)`, export `mountWho`. `mountWho` builds `.who-num` + `.who-out` and on logout goes to `"login.html?next=" + encodeURIComponent(back)`.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/login.template.html`** — CREATED. Loads style.css + store.js, **not** app.js. Has `<!--THEME_HEAD-->`, `<!--SITE-->` (twice: `<title>` and `<h1>`), `<!--V:style.css-->`, `<!--V:store.js-->`. Inline script handles: digit-only input washing, submit → `store.login()`, `persisted === false` → warn "当前浏览器禁止保存数据（无痕模式？），这次登录只在本次会话有效。", `location.replace(next)`, auto-forward if already logged in, and a three-state theme button.

   - **`/Users/ei/Desktop/temp/pet-reading/engine/style.css`** — login page section appended (`.login-body`, `.login-card`, `.login-row` with `:focus-within`, `#phone`, `.login-btn`, `.login-note.warn`, `.theme-fab`), all token-based. Total 845 lines.

   - **`/Users/ei/Desktop/temp/pet-reading/build.mjs`**:
     - `PAGES` now `[{out:"index.html", render:...}, {out:"login.html", render:() => renderLogin(manifest)}]`
     - `THEME_HEAD` constant + `subst()` + `fillCommon()`:
       ```js
       function fillCommon(html) {
         const out = fillVersions(subst(html, "THEME_HEAD", THEME_HEAD));
         const left = out.match(/<!--[A-Z][A-Z_]{2,}-->/g);
         if (left) {
           console.error("✗ 模板里有没被替换的占位符：" + [...new Set(left)].join(" "));
           process.exitCode = 1;
         }
         return out;
       }
       function subst(html, name, value) {
         return html.replace(new RegExp("<!--" + name + "-->", "g"), () => value);
       }
       ```
     - `ENGINE_SIG` now includes the template:
       ```js
       const ENGINE_SIG = assets.map(a => a.name + ":" + a.hash).join("|") + "|template.html:" + hash(template);
       ```
     - `render()` uses `subst` for TITLE/DESC/LABEL/CONTENT
     - `renderLogin(man)` = `fillCommon(subst(read(P("engine","login.template.html")), "SITE", escHTML(man.site.title)))`
     - `renderIndex` rewritten: token-based colors, `viewport-fit=cover`, `color-scheme`, `theme-color`, `${THEME_HEAD}`, store.js + `<script>PETStore.guard().catch(function(){});</script>`, `.who` chip in the header, and `<script>window.PETStore.mountWho(document.getElementById("who"));</script>`

   - **`/Users/ei/Desktop/temp/pet-reading/tools/smoke.mjs`** — heavily rewritten:
     - `ENGINE_SRC` map from `dist/engine/*.{js,css}`
     - `FAKE_USER = { phone: "13800138000", ts: 1700000000000 }`
     - `loadPage(file, {expectScripts, slug, seed, query, noStorage})` with `beforeParse` calling `stubMatchMedia(window)` and either `seedInto(window, seed)` or installing a throwing `localStorage` getter
     - `stubMatchMedia` returns `matches:false` for everything (desktop + light theme)
     - `loadArticle = slug => loadPage(slug + ".html", { expectScripts: 5, slug })`, `tick()`
     - Section 8 changed from `p.style.background` to `--pt` rank assertions + token-based `color`
     - New section 13b: favorites (☆ exists, 3 sibling buttons, click → `pet:fav:v1` 1 entry + ★ lit, click again → 0, lemma stored)
     - New `testLoginPage()` (expectScripts 3) and `testIndexGate()` (expectScripts 4)
     - Runner: `const suites = [...targets.map(s => [s, () => testArticle(s)]), ["login.html", testLoginPage], ["index.html", testIndexGate]];`

   - **`/Users/ei/Desktop/temp/pet-reading/tools/verify.mjs`** — added `read`, `stripComments`, `balanced()`, `flattenCSS()`, `isThemeAgnostic()`, `verifyEngine()` checking: engine files exist; store.js has no `PET_CONTENT`; `TOKEN_RE` identical in app.js/verify.mjs/new.mjs; app.js breakpoint === style.css breakpoints; `pet:theme:v1` in store.js and THEME_HEAD; templates use `<!--THEME_HEAD-->` and don't inline their own FOUC script; no chromatic color literals outside `:root` blocks; `:root[data-theme="dark"]` exists and overrides `--bg`; every `opacity:0` selector touched by a `:hover` rule appears in `@media(hover:none)`; template `<!--V:x-->` targets exist.

4. Errors and fixes:

   - **`renderHistory` called undefined `favOf`** (carried over): completed by adding `favOf`/`resolveFavKey`/`refreshFavs`.

   - **smoke: "卡片底色互不相同（依次加深）" failed** — I had changed `.part` rendering to emit `--pt` + `color:var(--part-ink-x)` instead of `background`. Fixed the assertion to check distinct `--pt` ranks and token-based `color`.

   - **smoke: "存储异常也不把按钮永久禁用" failed** — my test never actually broke storage (`localStorage.clear()` doesn't break it; after a successful login the button stays disabled by design). Rewrote using a new `noStorage` option that installs a throwing `localStorage` getter, and asserted the real anti-deadlock property: navigation happened, no "disabled + no navigation" deadlock, and the "只在本次会话有效" warning is shown.

   - **verify.mjs false positive: login `<h1>` empty** — this was a REAL bug found in the browser, not a test bug. `<!--SITE-->` appears twice in login.template.html and `.replace("<!--SITE-->", v)` only replaces the first. Fixed with global-regex `subst()` + a build-time error for any leftover `<!--UPPERCASE-->` placeholder (labeled 血泪坑 #19). Added smoke assertions for a non-empty `.login-title`.

   - **`isThemeAgnostic("#ff00ff")` returned true** — the achromatic check parsed hex as decimal digits (`"00"` → one channel, length < 3 → "agnostic"). Fixed with explicit hex expansion (`#fa0` → `#ffaa00`) and channel comparison. Unit-verified against 13 literals.

   - **verify.mjs false positives in the hover check**: first run flagged `keyframes slidein`, `keyframes pop`, `media(max-width:1099px)`; after the brace-aware fix it flagged `.scrim` (which uses `opacity:0` as a fade state, not hover-hiding). Fixed by only considering selectors that appear in a `:hover` rule. Mutation test (removing `.hfav` from the always-visible list) is now correctly caught.

   - **Latent build caching bug**: `template.html` was not in `ENGINE_SIG`, so editing the template said "跳过 N 篇" and left stale article HTML with build/verify/smoke all green. Fixed by appending the template hash to `ENGINE_SIG`.

   - **`uiSaveOff` did not hold** — the narrow-forced `cols.ana = false` leaked into storage as soon as the user toggled *any* column (verified in the browser: `pet:ui:v2` became `{"ana":false,"vocab":false}` after clicking only the history button). Fixed by deleting `uiSaveOff` entirely and introducing `userAna` as a separate preference value that `saveUI()` writes and `toggleCol` only updates on wide screens.

   - **History float covered the drawer on mobile** (z-index 70 vs 60) making a word tap look broken. Fixed by closing the history float inside `openAnaOnNarrow()`.

   - **`browser_run_code_unsafe` was DENIED by the auto-mode classifier** ("The call invokes Playwright's `browser_run_code_unsafe` — the explicitly-unsafe arbitrary-code-execution mode... the user's bare 'go on' does not name or authorize this unsafe mode"). I did NOT attempt to bypass it; instead I implemented the intended verification as a machine-checked invariant in `verify.mjs`.

5. Problem Solving:
   - Established that jsdom neither implements `matchMedia` nor evaluates `@media` in `getComputedStyle`, so (a) `isNarrow()`'s try/catch makes it desktop-safe in tests and (b) the bottom drawer can only be browser-verified.
   - Confirmed the glossary deliberately contains both `century` and `centuries` as separate headwords (different IPA + plural-rule note), so keying favorites on the matched headword is correct behavior, not a bug. Confirmed the lemma fallback works for words with no inflected headword (`years` clicked → `year` stored).
   - Chose `mountWho` in store.js so the "带手机号到每个页面" requirement is one implementation, not two lookalikes.
   - Verified the login → article redirect, dark login page, dark desktop 2-column article, word → blackboard → history → ☆ flow, and mobile drawer at 375px.
   - Browser-measured layout at 1280 and 1194: two columns, no horizontal overflow, 22 gutter groups, `maxTopDrift 5.4px`, buttons sitting ~31px into the 58px gutter padding.

6. All user messages:
   - *(Pre-compaction)* "好的，前面我提了很多需求，假如我接下来还有很多这样的阅读理解要做成html。用现在的模式效率会不会存在问题。我的服务器是2核2g内存，用户在1w人左右"
   - *(Pre-compaction)* Pasted the full `reading-part4-提示词.md` document as reference material.
   - *(Pre-compaction)* "我大概会有两百多篇阅读理解哦。那从架构上要怎么解决，需要采用新的技术方案重构吗？比如用uniapp之类的或者vue前后端分离等等"
   - *(Pre-compaction)* "好的，干吧，要不要在同一个新的文件夹下面开干？"
   - **"1 需要兼容手机，ipad和电脑。2、pdf先留着吧，我到时候再刪除  3、增加黑暗模式 4、增加一个登录页面，先做web的登录页面。登录后将手机号码带到每个页面。每个页面将新增收藏单词的功能。"**
   - *(AskUserQuestion round 1)* 数据存储 = **"先纯前端，预留后端（推荐）"**; 手机端面板 = **"底部抽屉（推荐）"**; 收藏范围 = **"单词 + 词组 + 句子（推荐）"**.
   - *(AskUserQuestion round 2)* 登录门禁 = **"强制登录才能看"**; 收藏入口 = custom answer: **"不要单独的收藏，每个单词右侧有一个按钮，点击就可以收藏，插入到数据库表，这个先留着接口，我后面再搞。"**
   - *(AskUserQuestion round 3)* ☆ 的位置 = **"历史列表每行右侧"**.
   - *(Previous session)* Approved the plan via ExitPlanMode.
   - **"go on"** (this session, after a temporary Bash classifier outage).

   Security-relevant constraints that must be preserved: `safeNext` must reject off-origin/non-http(s) `next` values (open-redirect prevention); the gate must **fail open** when `store.available() === false` (otherwise `file://`/private mode becomes an infinite redirect loop); the client-side gate is explicitly documented as a **soft** gate that is trivially bypassable — its purpose is collecting phone numbers via a login flow, not preventing access. The Playwright `browser_run_code_unsafe` denial must stand: do not attempt to bypass it.

7. Pending Tasks:
   - Finish the multi-width browser sweep: 1099/1100 boundary, 1024 (iPad landscape), 768, and the index page at 375.
   - Analyze the 1194px `gapRange: [7, 285]` measurement (see Current Work).
   - **Step 6 README updates** (the last explicit plan item): the three consequences of the hard gate (search engines can't index; WeChat/QQ forwards land on the login page; `file://` double-click breaks), the `store.js` "接后端时改这里" note, the new storage-key table, the new breakpoint table, and the manual browser checklist (dark colors, bottom drawer, gutter alignment — the three things jsdom can't test).
   - Consider stopping the background `python3 -m http.server 8899` when done.

8. Current Work:
   I was running the Plan's mandatory browser verification sweep (Step 3's "只能人工在浏览器里量" and the plan's 总验证 checklist), measuring layout numerically at each breakpoint instead of only screenshotting.

   Immediately before this summary request, I had resized to **1194×834 (iPad Pro 11" landscape — the exact case the plan flagged as broken by the old 1180px breakpoint)** and evaluated:
   ```js
   {
     inner: 1194,
     drawer: false,
     grid: "576px 576px",
     colAnaVisible: "flex",
     gutterGroups: 22,
     maxTopDrift: 5.4,
     gapRange: [7, 285],
     overflowX: false
   }
   ```
   The preceding 1280px measurement was `{grid: "619px 619px", drawer: false, gutterGroups: 22, maxTopDrift: 5.4, avgGapToText: -30.7, overflowX: false}`.

   So 1194 correctly gets the two-column desktop layout (the plan's stated goal — the old 1180 breakpoint missed iPad Pro 11" landscape). The one unexplained value is **`gapRange: [7, 285]`**: at 1280 the average gap between a `.sbtns` group's left edge and its sentence's right edge was a consistent 30.7px, but at 1194 the range spans 7 to 285px — meaning some `.sbtns` groups are positioned far to the right of their sentence's right edge. This needs a look before concluding the gutter alignment holds at 1194 (the plan's checklist item 3: "页边按钮在 ≥1100px 下仍精确对齐（源文档 §6.3 点名要人工确认的那条）").

   All automated gates are green as of the last run: `verify ✓ / build ✓ / smoke 193 ✓ / test-store 72 ✓`, engine versions `app.js v=025fad10  store.js v=59248852  style.css v=bfbc6061`.

9. Optional Next Step:
   Investigate the 1194px `gapRange: [7, 285]` gutter measurement — identify which `.sbtns` groups are at 285px and whether that is expected (e.g. short final sentence fragments where the engine pushes the buttons right) or a real misalignment, then finish the width sweep at 1099/1100, 1024 and 768. This is directly the plan's checklist item: "**页边按钮在 ≥1100px 下仍精确对齐**（源文档 §6.3 点名要人工确认的那条）" and the Step 3 verification note: "用 Playwright 在 375 / 768 / 1024 / 1180 / 1440 五个宽度逐档截图 + 实测（抽屉能否拉起、正文有无横向溢出、页边按钮在 ≥1100 时是否仍精确对齐、历史浮层不盖顶栏）". After that, the remaining pending item is Step 6's README update, which the plan specifies as: "**README.md**：补登录页与门禁的说明、上面「三个后果」、`store.js` 的「接后端时改这里」说明、新增的存储键表、新的断点表、以及**人工浏览器清单**".

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/ei/.claude/projects/-Users-ei-Desktop-temp-book1/1bd2e541-a836-426b-b848-844e2bf3b35e.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.

The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.

---

## Claude

All 22 groups are in the passage, so `gapRange` isn't the question-area artifact I guessed. The real §6.3 invariant is whether the buttons form a clean vertical column and sit on the sentence's first line — let me measure that instead of the trailing-edge gap:

---

## Claude

`leftSpread: 0` — all 22 gutter groups share left edge exactly 513px, and drift from the sentence's first line is ≤3.4px (sub-line-height). So §6.3's alignment holds at 1194; the 285px "gap" was an artifact of measuring against an `inline` element's union rect (a short paragraph-final sentence ends mid-column). Not a misalignment.

Now the breakpoint boundary — 1100 must still be two-column:

---

## Claude

1100: two columns (529px each), 22 gutter groups all on one left edge, no overflow, `#colAna` still `position:static`. Boundary is correct. Now 1099 — one pixel below must flip to single column + drawer:

---

## Claude

1099 flips correctly: single column 1071px, `#colAna` becomes `fixed`, gutter `display:none`, no overflow. The drawer is open here only because the page was *loaded* at 1194 (`cols.ana=true`) and then resized — a fresh load at 1099 closes it. Let me check whether app.js re-evaluates the breakpoint on rotate, which is the iPad case that actually matters:

---

## Claude

`resize` only re-lays out the gutter — nothing re-evaluates the breakpoint. That's a real iPad bug in one direction: load in portrait (drawer closed → `cols.ana=false`), rotate to landscape 1194, and the analysis column stays hidden with no indication why. Let me look at the code around that state:

---

## Claude

The fix belongs next to the existing resize wiring, and `userAna` already gives me the right value to restore:

---

## Claude

Green (193 smoke + 72 store). Now verify the crossing with the new engine — load narrow, then rotate wide:

---

## Claude

Crossing forward works — column reappears, preference untouched. Now the reverse (1100 → 1099) and the drawer-then-rotate case:

---

## Claude

Reverse crossing correct — drawer offscreen when closed, rises on word tap, preference still `{ana:true}`. One last case, the one the `userAna` split exists for: collapse the blackboard on wide, detour through narrow, come back — it must stay collapsed.

---

## Claude

All four directions hold. Restoring the preference and continuing the sweep at 1024 (iPad landscape, the case the old 1180px breakpoint got right by accident):

---

## Claude

1024: single column, drawer offscreen, no overflow. Now 768 (iPad portrait) — and this is where I need to exercise the history float, which the plan flagged as overflowing and covering the header:

---

## Claude

Float now spans 14px gutters at 768 with no overflow — the plan's fix works. But `hfav`/`hdel` opacity 0 is expected here: this Chromium reports `hover:hover`, so the touch rule can't fire without device emulation (which needs the denied unsafe mode). Let me confirm that rule textually and check the float's header overlap with the right selector:

---

## Claude

Rule covers both `.hfav` and `.hdel`. Now the header-overlap check with the right selector (`.topbar`), at 768 and then 375:

---

## Claude

768 clean. Now the critical one — 375px phone, where the topbar actually wraps:

---

## Claude

375: no overflow, topbar doesn't wrap, float 347px with clean gutters. Now the fix from earlier — tapping a word while the history float is open must close the float so the drawer isn't buried:

---

## Claude

Confirmed at 375: float closes, drawer rises with real content. Last sweep item — the index page at 375 (gate + who chip):

---

## Claude

Index at 375 is clean — chip shows `138****8000 | 退出` inside the header, no overflow. Now the logout → gate redirect:

---

## Claude

Logout lands on `login.html?next=%2Findex.html`. Checking the login page at 375:

---

## Claude

Login page at 375 is clean: 343px card, tap targets ≥44px (46/52), theme button ("☾ 暗" — dark persisted from testing, so the dark login page renders) and `backLink` correctly derived from `safeNext`. Round trip:

---

## Claude

Full round trip confirmed. The width sweep is complete (375 / 768 / 1024 / 1099 / 1100 / 1194 / 1280), and it turned up one real bug — the rotation case — which is now fixed and verified in both directions. Last plan item is the README:

---

## Claude

Now the README. Several sections need to change, not just additions — the `file://` claim is now false and the breakpoint in 硬规矩 #4 is stale:

---

## Claude

Now the main new section — inserting before 部署, since deployment needs to know about the gate:

---

## Claude

Now the three stale spots — the `file://` claim, the breakpoint in 硬规矩 #4, and the test counts:

---

## Claude

Two more 血泪坑 from this session belong in 硬规矩 — the template hash and the first-occurrence-only replace:

---

## Claude

Let me verify the documented API list matches what `store.js` actually exports:

---

## Claude

Three exports I omitted — including `guard`, which is the gate itself. Making the list complete:

---

## Claude

All README claims check out against the source. Let me get one visual confirmation of the thing that's purely CSS-media-driven — the mobile drawer in dark mode:

---

## Claude

Dark palette resolves correctly (page `rgb(18,21,27)`, drawer panel `rgb(26,30,38)` — elevated, light ink), drawer at 62vh with handle, close button, and TTS in its head. Screenshot for the visual record:

---

## Claude

The MCP server's cwd is the old `book1/` directory, so it landed there. Reading it:

---

## Claude

The dark mobile drawer renders correctly — handle, `小黑板 / 点单词或句子 / ✕` header, 🔊 next to 句子分析, and the passage's phrase highlighting intact above it. The top bar carries `138****8000 · 退出` as required. One thing to check — the plan called for a 遮罩层 (scrim):

---

## Claude

Scrim at z-index 55 sits below the drawer (60) — correct paint order. Let me confirm it's a real dim and, more importantly, that it's suppressed on desktop where the blackboard is a column and not a sheet:

---

## Claude

At 1400 the scrim is `display:none` and `elementFromPoint` resolves into `#passage` — desktop stays fully clickable. Everything in the plan's checklist is now verified. Let me check the working tree and the background server:

---

## Claude

The repo root is `/Users/ei/Desktop/temp` and **the entire `pet-reading/` project is untracked** — none of this architecture is committed yet. Let me check what a commit would pick up and whether I left stray artifacts:

---

## Claude

Plan complete. The README was the last item, and the browser sweep turned up one real bug along the way.

## The bug the sweep found

Rotating an iPad never re-evaluated the 1100px breakpoint — `resize` only re-ran `layoutGutter`. Load in portrait (drawer closed → `cols.ana = false`), rotate to landscape, and the blackboard column stayed hidden with nothing on screen explaining why. Fixed in [app.js:1405-1420](pet-reading/engine/app.js#L1405-L1420) with a `matchMedia` change listener: **wide screens follow `userAna` (the user's preference), narrow screens always collapse.** Verified in all four transitions at 1099↔1100, including the case the `userAna`/`cols.ana` split exists for — collapsing on wide, detouring through narrow, coming back stays collapsed; and opening the drawer on narrow never writes itself into the preference.

## Sweep results (7 widths)

| Width | Layout | Overflow | Gutter |
|---|---|---|---|
| 375 | single + drawer 62vh | none | hidden |
| 768 / 1024 | single + drawer | none | hidden |
| 1099 | single + drawer | none | hidden |
| 1100 / 1194 / 1280 / 1400 | two columns | none | **all groups share one left edge** |

§6.3's alignment holds: at 1194 all 22 `.sbtns` groups sit at exactly 513px, drift from the sentence's first line ≤3.4px. The `gapRange: [7, 285]` that was pending turned out to be a measurement artifact — `.sent` is `display:inline`, so a short paragraph-final sentence's union rect stops mid-column. Measuring the button column instead of the trailing gap is the right check, and I wrote that warning into the README so the next person doesn't chase it.

Also confirmed at 375: word tap closes the history float and raises the drawer with real content; the float spans 14px gutters (was overflowing 330px fixed); the top bar doesn't wrap; logout → `login.html?next=%2Findex.html` → login → masked chip round-trips; input washing turns `"138-0013-8000 99"` into `13800138000`; the dark drawer renders elevated against the page with handle, ✕, and 🔊; and the scrim is `display:none` on desktop with `elementFromPoint` landing inside `#passage`.

## One thing I could not verify

The ☆ and ✕ being visible **on touch** — this Chromium reports `hover:hover`, and emulating touch needs `browser_run_code_unsafe`, which was denied earlier in this session. I did not work around it. What I have instead is the static invariant in `verify.mjs`: `.hfav,.hdel{opacity:1}` inside `@media(hover:none)` is present and machine-enforced against the list of `opacity:0` hover-hidden controls. That's a real check but it is not a browser measurement, so **item 5 of the README's manual checklist still needs a real phone.**

## State

`npm run check` green: verify ✓ / build ✓ / smoke **193** ✓ / test-store **72** ✓, engine `app.js v=56fd0602`.

Two things worth your attention:

- **Nothing is committed.** The repo root is `/Users/ei/Desktop/temp` and all 19 `pet-reading/` files are untracked — the recent commits on `main` are the old `book1` project. Say the word and I'll commit it.
- I left `python3 -m http.server 8899` running so you can click through it yourself at `http://localhost:8899/`. Kill it with `lsof -ti :8899 | xargs kill`.

One stray file: the mobile screenshot landed in `book1/drawer-375-dark.png` rather than `pet-reading/`, because the Playwright MCP server's cwd is `book1`. Delete it if you don't want it — I left it since it's the visual record of the dark drawer.

---

## 用户

如果搞定就打开吧

---

## Claude

All 200s. Opening it:

---

## Claude

打开了，在你默认浏览器里。

会先落到**登录页**（门禁生效）——随便填个手机号，比如 `13800138000`，登录后回到目录页，右上角会显示 `138****8000 · 退出`。

值得亲手过一遍的几处，都是机器测不到的：

1. **手机尺寸**（浏览器开发者工具切到 iPhone，或直接开手机访问同一局域网地址）。点正文里任意一个句子 → 小黑板从底部升起来，顶部有 🔊 可以朗读；点 ✕ 收起后它应该滑到屏幕外，不压正文。
2. **暗色配色**。右上角那个 `◐ 跟随 / ☀ 亮 / ☾ 暗` 按钮循环切。重点看词组黄底、句子交替底色、题目选项的对错色、历史浮层 —— 这些在暗色下最容易出白斑。
3. **旋转屏幕**（如果手边有 iPad）。竖着进文章再横过来，小黑板应当按你上次的偏好恢复；横着转竖屏，抽屉应当自动收起。
4. **收藏**：点个词进历史 → 那一行右侧有 ☆ → 点一下变 ★。这个我在电脑浏览器上只能看到它 hover 才显形，**触摸设备上是否常显需要你在手机上确认**（这是唯一没能自动化验证的一条）。

刷新页面主题和登录态都会保留；换一篇点同一个词，收藏还是同一条（按词典原形存，`centuries` 和 `century` 算一个词）。

用完关掉服务：`lsof -ti :8899 | xargs kill`。另外提醒一句，`pet-reading/` 整个目录**还没提交过**，要提交随时说。

---

## 用户

如果我有新的文章呢？怎么搞？

---

## Claude

`sources/` is empty, so let me actually dry-run the documented path end-to-end rather than just recite it — you'll use this 200 times, so it's worth knowing it works:

---

## Claude

Works, and it even caught that my sample had 4 options instead of 8. Here's what the freshly generated skeleton looks like to `verify` — this is the checklist you'd actually work against:

---

## Claude

验证过了，这条路是通的。整个流程是这样：

## 你要做的，一共 6 步

**1. 素材丢进 `sources/`** —— 纯文本，格式很松：

```
title: Digging into the past
label: Exam Practice Test 1 · Reading Part 4

# 原文

Last year, Kate Marshall was given a very exciting opportunity. She was {16} to lead a team.

（空行分段）

# 选项

A an example
B a reason
...
```

空位写成 `{16}` `(16)` `__16__` `[16]` 都认，四种随便用。

**2. 生成骨架**

```bash
node tools/new.mjs sources/test5-part2.txt --slug t5-p2-my-topic
```

slug 按现有约定走：`t5-p2-` + 标题几个词。这一步自动切句、标记空位、列出还缺哪些词条。

**3. 补内容 —— 这一步是真正的工作量**，也是唯一不能自动化的部分：

- 核对切句（它一定会把缩写、引号里的句号切错一些）
- 补 `glossary`：每个词的 词性 / 音标 / 中文
- 补每句的 `tr`（翻译）和 `ana`（句型分析）
- 补 `phrases` / `optionsAna` / `questions`

**4. 自检到 0 错误**

```bash
node tools/verify.mjs t5-p2-my-topic
```

它会一条条告诉你还缺什么。刚生成的空骨架大约 27 条错误 + 5 条警告，照着列表补就完了 —— 这就是你的 to-do list。

**5. 登记进 `data/manifest.json`** 的 `books[].articles` 数组。

**6. `npm run check`** —— verify / build / smoke / test-store 四条全绿，收工。

## 两点值得先说清

**切句只是草稿。** 生成后务必自己过一眼，切错了后面全歪（翻译、分析都是按句存的）。这是整条链路上最容易埋雷的地方。

**词库会自己长大。** 200 篇必然大量撞词。撞的词不用每篇重写：

```bash
node tools/promote.mjs              # 预览
node tools/promote.mjs --write      # 真的提到共享词库
```

它把出现在 ≥2 篇、**且各篇释义完全一致**的词条上浮到 `data/glossary.core.json`，构建时自动合并。释义打架的会留在原处并报错让你人工统一 —— 共用一条错的释义比各写各的更危险。所以第 10 篇之后，你要补的词条会明显变少。

## 实际怎么配合

真正省事的用法是：**你把素材文本发给我，第 2–5 步我来做**，包括切句核对、词条、翻译、句型分析、题目解析，跑 verify 补到 0 错误。你只需要在浏览器里过一眼成品。

要不现在拿一篇真的试一下？你把下一篇的原文和选项贴过来，我走一遍完整流程给你看，顺便确认一下切句规则在你的素材上表现如何。

---

## 用户

将聊天记录缓存起来，我要上传到git，从另一台服务器下载和继续开始工作

---

## Claude

No `CLAUDE.md` and no repo-root `.gitignore` yet. Before I write anything — the raw transcript is **21MB (9.5MB gzipped) and still being appended to** right now, which is a lot to put in a git history permanently. Let me check what a text-only extract would weigh: