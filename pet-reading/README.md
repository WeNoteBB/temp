# PET 精读 · 多文章版

一套**引擎与内容分离**的精读页面。引擎只写一次、全站共用，每篇新文章只产出一个 JSON。

和旧做法的区别：旧版每篇是一个自带全部 HTML/CSS/JS 的独立文件，改一次样式要重刷 200 篇；
现在改 `engine/style.css` 重跑一次构建，全站生效。

```
一次访问的下载量（gzip 后，实测）
  首篇：引擎 37.6KB（app.js 21.6 + style.css 11.0 + store.js 5.0）+ 内容 24.6KB ≈ 62KB
  之后每篇：只下内容 24.6KB（引擎已在浏览器缓存里，且带 ?v= 永久缓存）
  目录页 1.6KB · 登录页 2.5KB
```

---

## 目录结构

```
pet-reading/
├── engine/                     ← 引擎：所有文章共用，改一次全站生效
│   ├── app.js                      交互逻辑（唯读内容，不写死任何一篇的数据）
│   ├── store.js                    登录态 / 收藏 / 主题的存取层 —— **接后端时只改这个文件**
│   ├── style.css                   样式（亮暗两套配色都在这，走语义令牌）
│   ├── template.html               文章页骨架，带 <!--占位符-->
│   └── login.template.html         登录页骨架（不加载 app.js，见下）
├── articles/                   ← 内容：一篇一个 JSON，日常只动这里
│   └── t1-p4-digging-into-the-past.json
├── data/
│   ├── manifest.json               站点标题 + 书本分组 + 文章顺序（唯一真相源）
│   └── glossary.core.json          跨篇共享词库，由 tools/promote.mjs 生成
├── sources/                    ← 素材原文（new.mjs 的输入，建议一起提交）
├── tools/
│   ├── new.mjs                     素材 → 文章骨架
│   ├── verify.mjs                  内容自检 + 引擎自检（纯静态，不用浏览器）
│   ├── smoke.mjs                   构建产物端到端测试（jsdom）
│   ├── test-store.mjs              store.js 单测（含存储不可用的降级）
│   ├── promote.mjs                 重复词条上浮到共享词库
│   └── migrate-legacy.mjs          旧单文件 HTML → articles/*.json（一次性，已完成使命）
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
| `ana` | `{ pat, frame, parts, clauses, gram, tip, phrases }` |
| `phrases` | 词组数组，**原文里必须字面出现**（正文或选项里都行） |
| `glossary` | 词条表：`词 → { pos, ipa, cn, note }` |
| `options` | `A`–`H` 八个选项 |
| `optionsAna` | 每个选项一份 `ana`（无 `phrases`） |
| `questions` | 5 题：`{ n, prompt, answer, why, clues, others, tip, ana }` |

空位在正文里写成 `{16}`，引擎渲染成绿色小圆标。

---

## 三道防线

| 命令 | 查什么 | 速度 |
|---|---|---|
| `npm run verify` | ①内容：词数/句数对账、每句每选项都有 `ana`、词组字面存在且有词条、100% 词形覆盖、空位与题号对得上、答案唯一、干扰项齐全、**同一词在不同篇里释义不打架**。②引擎：分词正则三处逐字一致、断点两处一致、模板占位符齐全、`:root` 外无彩色字面量、暗色令牌齐全、hover 藏起来的控件都在常显名单里、`<!--V:x-->` 引用的文件都存在 | 秒级 |
| `npm run build` | 合并共享词库、算引擎哈希、生成全部固定页面、**清理孤儿 HTML**（manifest 里删掉的篇目，dist 里的产物连 `.gz` 一起删）、预压缩 | 秒级 |
| `npm run smoke` | 真在 jsdom 里跑一遍引擎：**193 条断言**（每篇）+ 登录页 + 目录页，含逐字比对防丢字、点词/点句/点词组/点空格的交互、历史记录、**收藏、门禁、主题切换、存储不可用时放行** | 数秒 |
| `node tools/test-store.mjs` | `store.js` 单测 72 条：手机号校验、收藏去重、`isFav` 一致性、主题读写、`safeNext` 拒外站、**假一个会抛异常的 localStorage 断言 `available` 返回 false 而不是抛出去** | 毫秒 |

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

### 三个页面

| 页面 | 由谁生成 | 加载什么 |
|---|---|---|
| `dist/<slug>.html` | `engine/template.html` + 该篇 JSON | `style.css` + `store.js` + `app.js` |
| `dist/index.html` | `build.mjs` 里的 `renderIndex()`（手写模板，没有 `PET_CONTENT`） | `style.css` + `store.js` |
| `dist/login.html` | `engine/login.template.html` | `style.css` + `store.js` |

登录页**不加载 `app.js`**：`app.js` 开头无条件读 `window.PET_CONTENT`，那页没有内容数据，一加载就崩。
加新固定页面时，往 `build.mjs` 的 `PAGES` 注册表里加一条就行，孤儿清理会自动豁免它 ——
别再往清理循环里堆 `if (f === "xxx.html") return;` 那种特例。

### 门禁是**软**门禁，这点必须先说清

未登录访问文章页或目录页 → 跳登录页 → 登完回原页。
但这是**纯客户端**的：懂技术的人改一下 localStorage 就绕过去了。

> 它现在的作用是**让学生走一遍登录流程、把手机号留下来**，不是防住谁。
> 真正的门禁要等后端。

### ⚠ 强制登录带来的三个后果

1. **搜索引擎收录不到。** 200 篇内容不再公开可索引。
2. **微信/QQ 里转发链接，对方打不开正文**，会落到登录页。
   以后要做传播，得改成「试读 N 篇」。
3. **`file://` 双击打开彻底失效。** 本地打开会跳登录页，而 `file://` 下 localStorage 不可靠，
   登录永远存不住。因此门禁做成了**存储不可用时放行**（`store.available() === false` → 直接放行），
   否则「存不住 → 跳回来 → 又跳过去」会变成无限跳转。
   **这条防御不能删**，删了本地和隐私模式就成死循环了（`smoke` 里有断言拦它）。

### `store.js`：留给后端的那个缝

**所有登录态 / 收藏 / 主题的读写都走 `engine/store.js`，从第一天起就是 `async`。**
将来接后端，只把这个文件里的函数体换成 `fetch`，页面代码一行不动 —— 这就是「预留后端」的全部秘密：
把异步性前置，而不是等接后端时再回来改所有调用点。

```js
window.PETStore = {
  available,   // () → boolean          存储能不能用（隐私模式 / file:// 会是 false）
  guard,       // async () → Promise    门禁：未登录就跳登录页；存储不可用时**放行**
  getUser,     // async () → { phone, ts } | null
  login,       // async (phone) → { ok, phone, persisted } | { ok:false, err }
  logout,      // async ()
  maskPhone,   // (phone) → "138****8000"
  safeNext,    // (raw) → string        只放行站内相对路径，防开放重定向
  mountWho,    // (el) → Promise        顶栏脱敏手机号 + 退出（文章页与目录页共用这一份实现）
  addFav,      // async (item) → { ok, added }   ← 现在是往 localStorage 追加，同时天然成为补写数据库的 outbox
  isFav,       // async (id) → boolean
  listFav,     // async () → [item]
  favId,       // (item) → string
  getTheme, setTheme, nextTheme, paintTheme
};
```

`guard()` 是门禁本体，**文章页和目录页调的是同一个它**，不是两处长得像的实现。
`mountWho()` 同理 —— 「手机号带到每个页面」是一个实现被两处调用。

`store.js` **不依赖 `PET_CONTENT`**（`verify` 有一条断言拦着），所以登录页和目录页也能安全加载它。

### 收藏

没有独立的收藏面板。**每个词/句进入历史浮层后，那一行右侧有个 ☆**，点一下收藏、再点取消。

- 收藏的 key 用 `lookup()` 解析后的**词典原形**，不是用户点到的那串字母。
  点 `centuries` 收藏的是 `century`，否则同一个词的不同形式会各存一条。
- 单词/词组是**全局按词**的（同一个词在任何一篇里都是同一条）；句子按篇（`ref` 只在它那一篇里有意义）。
- 条目形状：`{ type:"w"|"ph"|"s", key, ref, slug, cn, ts }`，
  `id = type === "s" ? "s:" + slug + "@" + ref : type + ":" + key`。
- **接口已留好**（`addFav` / `isFav`），真实存储（数据库表）之后补。现在写进 `pet:fav:v1` 的这份数据
  同时也是将来补写数据库的 outbox。

### 存储键

| 键 | 内容 | 范围 |
|---|---|---|
| `pet:user:v1` | `{ phone, ts }` | 跨篇共享 |
| `pet:fav:v1` | 收藏条目数组 | 跨篇共享 |
| `pet:theme:v1` | `"auto"` / `"light"` / `"dark"` | 跨篇共享 |
| `pet:ui:v2` | `{ ana, vocab }` —— 注意 `ana` 存的是**用户偏好**（`userAna`），不是当前显隐 | 跨篇共享 |
| `pet:zoom:v1` | 字号倍数 | 跨篇共享 |

跨篇的键一律不带 slug。所有读写都包了 try/catch —— 隐私模式下 localStorage 会直接抛异常。

**`userAna` 与 `cols.ana` 是两回事**，别合并：`cols.ana` 是「这一刻显不显示」，
`userAna` 是「用户在宽屏上的偏好」。窄屏进来时抽屉必须收起（`cols.ana = false`），
但那只是屏幕窄逼出来的处境，不该写进偏好里。只有宽屏上点顶栏开关才更新 `userAna`。

---

## 主题与三端适配

### 主题

三态循环：跟随系统 → 亮 → 暗（文章页顶栏、登录页右上角各有一个按钮）。

- **配色一律走语义令牌**，暗色只覆写 `:root[data-theme="dark"]` 里的令牌值，**绝不逐条覆写组件**。
  否则以后每加一个组件都要记得配两遍。`verify` 有一条断言禁止 `:root` 之外出现彩色字面量。
- **防闪烁**：主题属性只能由 JS 写，而外链 CSS 会阻塞渲染，JS 跑完前会闪一帧亮色。
  所以 `<head>` 里、样式表**之前**有一段极小内联脚本先读 `pet:theme:v1` 并写 `data-theme`。
  这段脚本三页共用一份定义（`build.mjs` 的 `THEME_HEAD`，经 `<!--THEME_HEAD-->` 注入）——
  各写一遍的话，改个键名就得改三处，漏掉的那页会闪。
- `auto` 在启动时就被解析成具体值写死，CSS 里不再维护一套 `@media (prefers-color-scheme)`。

### 断点

| 区间 | 布局 | 页边「析/🔊」按钮 |
|---|---|---|
| `≥1100px` | 两列（正文 + 小黑板） | 保留 |
| `<1100px` | 单列正文 + 小黑板变**底部抽屉** | 隐藏（抽屉顶部自带 🔊） |

> 断点从 1180 改到 1100，是因为 1180 正好卡在 iPad Air 横屏上，
> 而 **iPad Pro 11" 横屏是 1194px**，反而不命中两列布局。

抽屉**复用同一份 `#colAna` DOM**，只用 CSS 换表现（`transform:translateY(100%)` 收起），
不新增面板。用 `transform` 而不是 `display:none`，否则滑动动画会没有。
`.cols` 上的显隐逻辑（`applyCols()` 切 class）完全不动。

**跨越断点时要重算列状态**（`app.js` 里监听 `matchMedia` 的 change）：
竖屏进来抽屉是收起的，横过来到 ≥1100 就成了第二列，不恢复的话小黑板是空的、页面上也没提示，
学生会以为讲解丢了。规则是**宽屏一律以 `userAna` 为准，窄屏一律收起**，
两边都是按规则算出来的，绝不把「屏幕窄」这个处境写进偏好里。

**触摸设备**：`@media(hover:none)` 把靠 `:hover` 显形的控件（`.hfav` / `.hdel`）改成常显。
不写这条的话，手机上那两个按钮**永远看不见也点不到**。`verify` 会检查每个藏起来的 hover 控件
都进了这个常显名单，加了新按钮别忘了。

### 人工浏览器清单（jsdom 测不到的，改样式后必须过一遍）

jsdom 有两条硬限制：**没有 `matchMedia`**，且 **`getComputedStyle` 完全忽略 `@media` 规则**。
所以下面这些机器验证不了，只能人眼看：

1. **五个宽度 × 亮/暗两主题**逐档看：375 / 768 / 1024 / 1194 / 1440。
   暗色要覆盖正文、词组黄底、句子交替底色、三态高亮、题目区、选项对错、小黑板各区块、历史浮层、登录页。
2. **手机上点句子 → 抽屉升起、讲解可见、🔊 可用**；抽屉收起时应该在视口下方（不能压住正文）。
3. **页边按钮在 ≥1100px 下仍精确对齐**（源文档 §6.3 点名要人工确认的那条）。
   量法：所有 `.sbtns` 的左边缘应当**只有一个值**；与句子首行的垂直偏移应在几个像素内。
   ⚠ 别拿 `.sent` 的右边缘去减 —— `.sent` 是 `display:inline`，
   一行的并集盒子在段末短句处会缩进去，量出来是个假的大间隙。
4. 未登录打开文章 → 跳登录页 → 登录 → 回到原页 → 顶栏显示脱敏号码。
5. 点词进历史 → 行内 ☆ **在触摸设备上**可见可点 → 收藏成功、★ 点亮。
6. **隐私模式打开，确认门禁放行而不是无限跳转。**
7. iPad 上**旋转屏幕**：竖→横，小黑板应当按偏好恢复；横→竖，抽屉应当收起。

---

## 部署

发布 `dist/` 整个目录即可，全是静态文件，不需要 Node 进程。

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

⚠ **但不能双击本地打开（file://）了** —— 加了登录门禁之后，
本地打开会跳登录页，而 `file://` 下 localStorage 不可靠、登录存不住。
门禁做成了「存储不可用时放行」，所以本地打开**能进**，只是每次都要重新登录。
要给学生当文件发，得走 `http://`（哪怕是本机起个小服务）。

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

4. **页边按钮在 <1100px 会被隐藏**（`.pgutter{display:none}`）。
   窄屏没有「析/🔊」按钮，靠点正文里的句子/单词出讲解（抽屉顶部自带 🔊）。
   这两个值（CSS 的 `@media` 与 `app.js` 的 `isNarrow()`）**必须一致**，
   `verify` 会拿两边对账 —— 改一个忘另一个，抽屉和列状态就会各说各话。

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

---

## 换书 / 加书

`data/manifest.json` 里加一个 `books[]` 条目即可，首页会自动多出一个分组：

```json
{ "id": "pet-25", "title": "PET 官方模考题 25", "articles": ["t2-p2-xxx"] }
```

`new.mjs` 生成骨架时会把 `book` 写成 `books[0].title` —— 不是第一本的话，生成后手工改一下那个字段。
