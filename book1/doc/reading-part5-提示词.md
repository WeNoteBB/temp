# PET Reading Part 5 · 下一篇生成提示词（v1 · 2026-10-17 定稿）

> 用法：**把本文整段发给 AI，再附上新课的素材**（训练页 + 真题文章页 + 答案页；优选
> **带文字层的 Word / 可复制文字的 PDF**，那样省掉「看图抄录」这一大块时间）。
> AI 按本文做完，产出与本项目现有 `t1-p5-ice-sculptures` **完全一致**的 Part 5 精读页。

---

## 〇、一句话任务

在 `pet-reading` 工程里**新增一篇 Reading Part 5 文章**：`articles/<slug>.json` +
从**原书扫描裁出的图片**（`assets/img/`）+ manifest 登记；三道防线（verify / build / smoke）
全绿；排版照书（借现有引擎的数据标记，不再改引擎）。

## 一、先读再动手（顺序不能省）

工作目录：`C:\Users\89300\Desktop\pet\pet-reading`

1. `CLAUDE.md` —— 工程约定（分词正则三处一致、`String.replace` 传函数、提交前 `npm run check` 全绿）
2. `README.md` —— 字段表、硬规矩、测试说明
3. `book1/doc/reading-part3-设计方法.md` —— 方法代号字典（A–F 在 Part 1 文档、G–L 在 Part 3 部分、
   **M–O 是 Part 5 新增的三种件**，见该文档末尾「PET Reading Part 5」小节）
4. 唯一权威样板：`articles/t1-p5-ice-sculptures.json`（30 段 38 句 406 词 15 题）
   线上对照：`http://8.138.161.122/t1-p5-ice-sculptures.html`

## 二、素材形态与提取

- **首选**：带文字层的 Word / 文本层 PDF / 可复制文字的电子版 —— 原文直接复制，快且准；
  抄完仍要对渲染图核对一遍（切句、标点、引号都算数）。
- **兜底**：这册书纸样 PDF 是**纯扫描图**（每页一张 ~5049×6620 的 600dpi 位图，提不出一个字符），
  只能渲染读图逐字抄录（渲染代码见 `reading-part3-提示词.md` 第二节，工具在临时目录里现装
  `mupdf` / `sharp`）。
- **图片一律从原书扫描裁**：在整页位图上扫「暗像素占比」找到图片矩形（本册 Part 5 的冰雕照片
  在书 P25，坐标 x3255,y1768 1270×1988），灰度 JPEG q88、宽 ~1100；放
  `pet-reading/assets/img/<slug>-<名字>.jpg`；**裁剪坐标记进 `sources/<slug>.txt`**。
- **官方答案页逐题核对后才写数据**（本册答案在书后 Teacher's Notes & Keys）。

## 三、页面结构（照 t1-p5 抄：段落顺序 = 书页顺序）

训练页在前、真题页在后，一块一段，不重排。题型 → 方法代号：

| 书上 | 方法 | 数据要点 |
|---|---|---|
| ① 介词表 | **M** | `{r:"q", pick:[n1,n2,n3], table:{head:["Adjectives","Preposition"]}}`；段落里每句 = 表格一行，行与 pick 一一对应 |
| ② 改错句 | **H** | 句子 + `ul:"…"`（逐字子串，划「动词+介词」整段）；官方订正（含多解）写进 `ana.tip/gram`，不设题 |
| ③ 选词填空 | — | 每句一块 `{r:"q", pick:[n]}`，句子里的空格写省略号 `…………`；选项小写 a–d |
| Remember 灰框 | **O** | `{r:"i", rmb:"中文说明"}`（空段；自动加 `.rmbwrap`，浮框不挤后面段落） |
| 真题文章 | — | 抬头 `head{l,r}`+`badge`；正文 `{r:"p"}`，三段落都 `frame:true`（连续框自动合成一个）+ 照片浮右；空位 `{21}`–`{26}` |
| 真题 21–26 | **N** | 空段 `{r:"q", pick:[21,22,23,24,25,26]}` → 渲染成六排 A–D 胶囊（行号自动取题号） |

**数据契约（verify 会逐条卡）**：

- 训练题编号从 **101** 起、`tag` 形如 `①-1`/`③-5`；真题保留书上的 **21–26**；
- **正文 `{n}` 空位只许真题用**（空位必须恰好等于真题题号 n<100）；训练题的空写 `…………`；
- `h`/`i` 段落按「整段处理」：**每句必须有 `tr`**；
- 每题 `why/clues/others/tip/prompt/ana` 齐全；`others` 必须覆盖**每一个**错选项
  （四选一写 3 条）；
- 表格块：`table.head` 非空、行数 = `pick` 题号数；表格行不挂页边按钮；
- `ul` / 短语 / `head` 的两半，都必须是原文**逐字**子串；
- 顶层 `inlineQuiz: true`；词表覆盖率 **100%**（原文 + 全部选项文本，一个词形都不能漏）。

## 四、词库（先借后写）

1. **先自动借**：词形能在共享词库（`data/glossary.core.json`，已 287 条）或已有四篇里
   命中的，整条拷贝（Part 5 的 285 条里 206 条是借的）；不规则形式（went / grew / fell /
   ran / fed…）与缩写（we'll…）**要单独成条**；
2. **剩下的逐条手写** `{pos, ipa（英音）, cn, note?}`，词形写**可回退的词典形**
   （build / grow / city…，引擎与 verify 的查词回退一致）；
3. 补完跑 `node tools/promote.mjs --write` 把重复词条上浮共享库；释义打架的会被报出来，
   人工统一（当前还留着 24 条老账）。

## 五、构建与三道防线（提交前必须全绿）

```bash
node tools/verify.mjs <slug>   # 内容契约（词数/句数/ana/词表/选项/ul/表格/空位）
node build.mjs                 # 构建 dist/（同时把 assets/ 拷成 dist/assets/）
node tools/smoke.mjs           # 端到端（新篇会自动进测试；总数只增不减：当前 858）
node tools/test-store.mjs      # 数据层单测
# 以上四连 = npm run check
```

写 smoke 断言的纪律：**数据驱动**（从 `C.questions`、`blocks` 推期望值），不要写死题号/字母。

## 六、视觉验收（jsdom 测不到排版，必须真浏览器）

1. 起本地静态服务指向 `dist/`（仓库根 `.serve-dist.mjs` 或临时起 Node 静态服务）；
2. 系统 Edge + `playwright-core`（`channel:"msedge", headless:true`）截图：
   桌面 1280 + 手机 375（+ 744 / 1194 抽查），亮/暗各一套；重点核对：
   扉页黑标题 + 徽章、① 真表格（表头/行高/胶囊换行）、② 红下划线、③ 各排胶囊、
   Remember 灰框位置、Tip 浮框、**连续边框盒（看成一个框）**、图片绕排方向、
   绿色空位 {21}–{26}、六排作答、页边「析/🔊」对齐、无横向溢出；
3. **与原书渲染图逐屏对照**（顺序、号码、图文关系）；
4. 已知坑：
   - 表格块必须用 `<div>` 渲染（`<p>` 里的 `<table>` 会被浏览器拆开）；
   - 两个 `tip` 浮框并排会互相让位——书上并排两个 Tip 时**合成一个字符串**；
   - 懒加载图片（`loading="lazy"`）在无头截图里要先**触发滚动**（或临时改 eager）再拍；
   - 全局 `.ansb` 是 26×26 小圆钮——新的大按钮样式要 `width:auto;height:auto;min-height:0`。

## 七、收尾清单

- [ ] `data/manifest.json` 按书内顺序登记 slug；
- [ ] `sources/<slug>.txt`：素材出处、图片裁剪坐标、官方答案速查表；
- [ ] 若出现**新题型**：在 `book1/doc/reading-part3-设计方法.md` 追加新方法代号与数据写法；
- [ ] README / CLAUDE.md 的统计数字（smoke 总数、文章数）更新；
- [ ] （可选）部署：`SKIP_CHECK=1 bash deploy.sh 8.138.161.122`（git-bash 里跑）。

---

## 附：换篇填空区（复制这段 + 素材，一起发给我）

```
按 book1/doc/reading-part5-提示词.md 做一篇新的 Reading Part 5：

- 新课素材：<Word / PDF 路径>（训练页 + 真题文章页）
- 答案页：<路径>（书后 Teacher's Notes & Keys）
- slug：t<N>-p5-<主题>（小写连字符，如 t2-p5-…）
- 标题/标签：title = Training Test <N>，label = Reading Part 5
- 备注：优先给带文字层的版本（Word/可复制 PDF）——能省大量抄录时间
```
