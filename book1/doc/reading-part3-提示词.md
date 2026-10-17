# PET Reading Part 3 · 下一篇生成提示词（v1 · 2026-10-17 定稿）

> 用法：**把本文整段发给 AI，再附上新课的 PDF**（训练页 + 真题文章页 + 真题题目页 + 答案页，
> 通常就是这册书里 `_XX-XX.pdf` 这样的 4 页切片，外加书后 Teacher's Notes & Keys 那一页）。
> AI 按本文做完，产出与本项目现有 `t1-p3-great-ocean-road` **完全一致**的 Part 3 精读页。

---

## 〇、一句话任务

在 `pet-reading` 工程里**新增一篇 Reading Part 3 文章**：`articles/<slug>.json` +
从**原书扫描裁出的图片**（`assets/img/`）+ manifest 登记；三道防线（verify / build / smoke）
全绿；排版与书本一致（借现有引擎的数据标记，不再改引擎）。

## 一、先读再动手（顺序不能省）

工作目录：`C:\Users\89300\Desktop\pet\pet-reading`

1. `CLAUDE.md` —— 工程约定（分词正则三处一致、`String.replace` 传函数、提交前 `npm run check` 全绿等）
2. `README.md` —— 字段表、硬规矩、测试说明
3. `book1/doc/reading-part3-设计方法.md` —— **方法代号 G–L 与全部书本还原标记**（本次的作业图纸）
4. `book1/doc/reading-part1-设计方法.md` —— 正文内联作答的通用体系（pick / optsInline / 解析按钮）
5. 唯一权威样板：`articles/t1-p3-great-ocean-road.json`（58 段 88 句 1027 词 26 题 513 词条）
   线上对照：`http://8.138.161.122/t1-p3-great-ocean-road.html`

## 二、素材形态与提取（重要：这册书 PDF 是**纯扫描图，没有文字层**）

- 每页 = 一张整页高清位图（约 **5035×6658**，即 600dpi 扫描），**文字一个都提取不出来** →
  必须靠渲染图逐字识读抄录；抄完要对着原页再核一遍（切句、标点、引号都算数）。
- 渲染/读图（Node 方案，临时目录装 `mupdf`）：

  ```js
  import * as mupdf from "mupdf";
  const doc = mupdf.Document.openDocument(fs.readFileSync(pdf), "application/pdf");
  const page = doc.loadPage(i);
  const pix = page.toPixmap(mupdf.Matrix.scale(600 / 72, 600 / 72), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync("page.png", pix.asPNG());
  ```

  或者用 `pdfjs-dist` 直接取每页嵌的那张整页位图（`page.objs.get(名字)`，约 100MB/页 RGB）。
- **图片一律从原书扫描裁**，不要找相似图、不要重绘：
  - 量边界：在整页位图上扫描"暗像素占比"，找出图片那块矩形（照片/线稿都会形成
    "绝大多数列为暗"或"绝大多数行为暗"的连续区间），再用 `sharp` 裁剪；
  - 照片 → 灰度 JPEG q88、宽 ~1100；线稿插图 → 灰度 PNG、宽 ~1000；
  - 放 `pet-reading/assets/img/<slug>-<名字>.jpg|png`（构建会自动拷进 `dist/assets/`）；
  - **把裁剪坐标记进 `sources/<slug>.txt`**（t1-p3 的记法：`x440,y1305 2209×1537`）。
- 先把整页渲染图看一遍定结构，再抄文字；官方答案页（Teacher's Notes & Keys）**逐题核对后才写数据**。

## 三、页面结构（照 t1-p3 抄：段落顺序 = 书页顺序）

训练页在前、真题页在后，一块一段，不重排。题型 → 方法代号（细节见 part3 设计方法文档）：

| 书上 | 方法 | 数据要点 |
|---|---|---|
| ① 用方框动词补全 | **G** | `{r:"o",frame:true}` 动词框；8 句各 `{r:"q",pick:[101]}`，`opts` 是全表 8 个动词 |
| ② 改错句 | **H** | 句子 + `"ul":"suggested to go"`（逐字子串）；官方订正（含多解）写进 `ana.tip/gram` |
| ③ 句子意图 | **I** | `{r:"o"}` 意图清单 a–h + `{r:"q",pick:[109..116]}` 一块 8 排；⚠选项顺序要打散 |
| ④ 长段+插图+小题 | **J** | `{r:"q",frame:true,img:{…}}`（插图浮右）+ 每题 `pick` |
| ⑤ 拆题 + 灰底 MCQ | **K** | 小问用 `{r:"i"}`；MCQ 盒 `{r:"q",n:"121",shade:true,optsInline:true}` |
| ⑥ 口语活动 | — | `{r:"i"}` 静态提示 |
| 真题文章 | — | 抬头 `head{l,r}`+`badge`+`tip`；文章段用 `{r:"p"}`；标题 `{r:"h",center:true,img:{side:"left"}}` |
| 真题 11–14 | **L** | `{r:"q",n:"11",optsInline:true}`（整行选项，点行作答） |
| 真题 15（博客卡片） | **L** | `{r:"q",n:"15",optsGrid:true}`（2×2 盒子） |

**数据契约（verify 会逐条卡）**：

- 训练题编号从 **101** 起、`tag` 形如 `①-1`/`③-5`；真题保留书上的 **11–15**；
- `h`/`i` 段落按"整段处理"：**每句必须有 `tr`**（整段翻译会缺口）；
- `optsInline`/`optsGrid` 的题**每个选项都要 `optsAna`**（`parts/gram/tr`）；
- 每题 `why/clues/others/tip/prompt/ana` 齐全；`others` 必须覆盖**每一个**错选项
  （8 选项题写 7 条；干扰项如果在别题出现过也要说明）；
- `ul` / 短语 / `head` 的两半，都必须是原文**逐字**子串（verify 强制）；
- 顶层 `inlineQuiz: true`；词表覆盖率 **100%**（原文 + 全部选项文本，一个词形都不能漏）。

## 四、词库（最费工的一步，有省力法）

1. **先自动借**：新词形能命中已有三篇（`t1-p1/t1-p3/t1-p4`）里词条的，**整条原样拷贝**
   （t1-p3 的 513 条里 221 条是这么来的；借来的条目还能保证跨篇释义一致）；
2. **剩下的逐条手写** `{pos, ipa（英音）, cn}`；注意引擎的查词回退规则
   （`-s/-es/-ing/-ed/-er/-est`、`'s`），**不规则形式要单独成条**：
   `went / heard / leaves / left / been / did / saw / came / led / hidden / stolen / slept /
   brought / forgotten / known / seen / …`，缩写也一样
   （`wouldn't / i'm / we're / they're / haven't / there'd` 等）；
3. 补完可跑 `node tools/promote.mjs --write` 把重复词条上浮到共享词库（`data/glossary.core.json`），
   后续篇目新词条会越来越少；
4. verify 有跨篇一致性检查：同一个词的音标/释义在全库必须统一。

## 五、构建与三道防线（提交前必须全绿）

```bash
node tools/verify.mjs <slug>   # 内容契约（词数/句数/ana/词表/选项/ul/装饰标记）
node build.mjs                 # 构建 dist/（同时把 assets/ 拷成 dist/assets/）
node tools/smoke.mjs           # 端到端（新篇会自动进测试；总数只增不减）
node tools/test-store.mjs      # 数据层单测
# 以上四连 = npm run check
```

写 smoke 断言的纪律：**数据驱动**（从 `C.questions`、`blocks` 推期望值），
不要写死题号/字母（Part 1 时代写死的 101:B、106、115 后来全部返工过）。

## 六、视觉验收（jsdom 测不到排版，必须真浏览器）

1. 起本地静态服务指向 `dist/`（或 `file://`，但登录态存不住）；
2. 系统 Edge + `playwright-core`（`channel:"msedge", headless:true`）截图：
   桌面 1280 + 手机 375，亮/暗各一套；重点核对：
   扉页黑标题 + 下划线、答案徽章、Tip 框、图片绕排方向、边框盒、灰底盒、
   ②红下划线、各排「我的答案」、整行选项、2×2 选项盒、页边「析/🔊」对齐、无横向溢出；
3. **与原书渲染图逐屏对照**（顺序、号码、图文关系）；
4. 已知坑：全局 `.ansb` 是 26×26 小圆钮 —— 任何新的"大按钮"类样式都要
   `width:auto;height:auto;min-height:0` 盖掉它（t1-p3 的 2×2 盒子踩过）。

## 七、收尾清单

- [ ] `data/manifest.json` 按书内顺序登记 slug；
- [ ] `sources/<slug>.txt`：素材出处、图片裁剪坐标、官方答案速查表；
- [ ] 若出现**新题型**：在 `book1/doc/reading-part3-设计方法.md` 追加新方法代号与数据写法；
- [ ] README / CLAUDE.md 的统计数字（smoke 总数、文章数）更新；
- [ ] （可选）部署：`bash deploy.sh <服务器>`。

---

## 附：换篇填空区（复制这段 + PDF 路径，一起发给我）

```
按 book1/doc/reading-part3-提示词.md 做一篇新的 Reading Part 3：

- 新课 PDF：<路径>（训练页 + 真题文章页 + 真题题目页）
- 答案页 PDF：<路径>（书后 Teacher's Notes & Keys）
- slug：t<N>-p3-<主题>（小写连字符，如 t2-p3-…）
- 标题/标签：title = Training Test <N>，label = Reading Part 3
- 备注：若这册 PDF 有带文字层的版本（或 Word/拍照以外的文本），一并提供 —— 能省大量抄录时间
```
