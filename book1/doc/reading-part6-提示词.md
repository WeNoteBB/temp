# PET Reading Part 6 · 下一篇生成提示词（v1 · 2026-10-18 定稿）

> 用法：**把本文整段发给 AI，再附上新课的素材**（训练页 + 真题文章页 + 答案页；
> 有**带笔记版**的话一并给——笔记会整理进「析」里，词组/句型可收藏）。
> AI 按本文做完，产出与本项目现有 `t1-p6-museum-email` **完全一致**的 Part 6 精读页。
>
> 换个说法：Part 6 = 开放填空（open cloze）——正文挖六个空，每个空**自己写一个词**。

---

## 〇、一句话任务

在 `pet-reading` 工程里**新增一篇 Reading Part 6 文章**：`articles/<slug>.json` + manifest 登记；
空位渲染成**输入框**（学生自己写一个词）；三道防线（verify / build / smoke）全绿；
**若素材里带手写批注（笔记版）**，把批注整理进对应句子的「析 → 笔记（书上批注）」，
词组/句型都要能收藏。

## 一、先读再动手（顺序不能省）

工作目录：`C:\Users\89300\Desktop\pet\pet-reading`

1. `CLAUDE.md` —— 工程约定（提交前 `npm run check` 全绿）
2. `README.md` —— 字段表、硬规矩、测试说明
3. `book1/doc/reading-part3-设计方法.md` —— 方法代号字典；**Part 6 看文末的 P（开放填空）与 Q（笔记）**
4. 唯一权威样板：`articles/t1-p6-museum-email.json`（34 段 46 句 448 词 19 题）
   线上对照：`http://8.138.161.122/t1-p6-museum-email.html`

## 二、素材形态

- **优先 Word / 带文字层的 PDF**（直接复制原文）；扫描版就渲染读图逐字抄录（代码见
  `reading-part3-提示词.md` 第二节）。抄完对着渲染图核一遍（切句、标点、引号都算数）。
- **带笔记版**（如「PET Trainers精讲精练带笔记」）：整本 PDF 里**训练页和真题页都可能有批注**——
  两页都要看，别只看一页。批注内容大致三类：
  ① 词组的中文（believe it or not 信不信由你、hand in 提交）；
  ② 句型/语法的提示（as 由于、why don't we…?）；
  ③ 空里填的答案/改错的词（红笔）。
- 官方答案页（书后 Teacher's Notes & Keys）**逐题核对后才写数据**。
- 这两页通常没有图片资产。

## 三、页面结构（照 t1-p6 抄：段落顺序 = 书页顺序）

| 书上 | 方法 | 数据要点 |
|---|---|---|
| ① 大意三题（text type / purpose / topic） | — | 每题一块 `{r:"q", pick:[n]}`；选项 a/b/c 用横排胶囊 |
| ② 开放填空 1–4 | **P** | 正文里写 `{n}`（渲染成输入框）；题没有 `opts`、`gap:"1"`…；段尾自动出「N 解析」排 |
| ③ 连接词二选一 | — | 句内 «» 标记：`…very early «as» / «so» …`；`pickQ` 挂题；**不要**再挂 `pick` 行 |
| ④ 改错句 | **H** | `ul` 划「错的词」（that/unless/wherever/too/because/Despite），订正写 `ana.tip`；不设题 |
| 真题 27–32 | **P** | 邮件全文用连续 `frame: true`（会拼成一个大框）+ 六个 `{n}` 输入框 |
| 手写批注（笔记版） | **Q** | 句子的 `ana.note = ["键" | {k, t?, cn?}]`；词组/句型在 glossary 里建 `"词组"`/`"句型"` 条目 |

**数据契约（verify 会逐条卡）**：

- 训练题编号从 **101** 起（tag ①-1 / ②-3…），真题保留书上的 **27–32**；`question.gap` 写书上的编号；
- 每个 `{n}` 必须有题；开放填空的题必须有 `{n}` 空位；`answer` 只写**一个单词**；
  `others`（可选的「常见错答」）里不许出现答案本身；
- 每题 `why/clues/tip/prompt/ana` 齐全（MC 题的 `others` 覆盖每个错选项）；
- `ana.note` 里每个键必须能在词表里查到（点开有词条、可收藏）；
- 顶层 `inlineQuiz: true`；词表覆盖率 **100%**（原文 + 选项 + 笔记的键）。

## 四、词库（先借后写）

1. 先借共享词库（`data/glossary.core.json`，已 367 条）+ 已有五篇；不规则形式单独成条；
2. 新词组/句型逐条手写：`pos` 用 `"词组"` / `"句型"`，`ipa` 英音，`cn` 写意思，`note` 写用法；
3. 跑 `node tools/promote.mjs --write` 把重复词条上浮（释义打架的先人工统一再 promote）；
4. **笔记里的中文用批注原文**（如「某个时间」「古埃及的东西」）——写在 `ana.note[].cn`。

## 五、构建与三道防线（提交前必须全绿）

```bash
node tools/verify.mjs <slug>   # 内容契约（空位/开放填空/笔记键/词表/…）
node build.mjs                 # 构建 dist/
node tools/smoke.mjs           # 端到端（当前基线 1053 条，只增不减）
node tools/test-store.mjs
# 四连 = npm run check
```

## 六、视觉验收（真浏览器）

1. 起本地静态服务指向 `dist/`，Edge + `playwright-core` 截图：1280 / 375，亮暗；
2. 重点核对：① 胶囊排、② **输入框**（填对变绿、填错变红 + 解析自动展开）、段尾「N 解析」排、
   ③ «» 内联按钮、④ 红下划线、真题**连续边框盒**（多段拼成一个大框）、
   小黑板里的**「笔记（书上批注）」区**（chip + 中文 + ☆）；
3. 已知坑：表格块用 `<div>`；两个 `tip` 浮框并排会互相让位（合成一个）；懒加载图片要先触发滚动。

## 七、收尾清单

- [ ] `data/manifest.json` 按书内顺序登记 slug；
- [ ] `sources/<slug>.txt`：素材出处 + **笔记原文** + 官方答案速查表；
- [ ] 若出现新题型：在 `book1/doc/reading-part3-设计方法.md` 追加新方法代号；
- [ ] README / CLAUDE.md 的统计数字（smoke 总数、文章数）更新；
- [ ] （可选）部署：`SKIP_CHECK=1 bash deploy.sh 8.138.161.122`（git-bash 里跑）。

---

## 附：换篇填空区（复制这段 + 素材，一起发给我）

```
按 book1/doc/reading-part6-提示词.md 做一篇新的 Reading Part 6：

- 新课素材：<Word / PDF 路径>（训练页 + 真题页）
- 答案页：<路径>（书后 Teacher's Notes & Keys）
- 带笔记版：<路径>（可选；有的话批注整理进「析」，词组句型可收藏）
- slug：t<N>-p6-<主题>（小写连字符）
- 标题/标签：title = Training Test <N>，label = Reading Part 6
- 备注：优先给带文字层的版本（Word/可复制 PDF）
```
