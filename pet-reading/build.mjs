/* 批量构建：manifest + articles/*.json + engine/  →  dist/
   用法：
     node build.mjs              增量构建（跳过没变的）
     node build.mjs --force      全量重建
     node build.mjs --only <slug> 只构建一篇
*/
import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const P = (...a) => path.join(root, ...a);
const read = p => fs.readFileSync(p, "utf8");
const readJSON = p => JSON.parse(read(p));
const hash = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

const DIST = P("dist");
const CACHE_FILE = path.join(DIST, ".build-cache.json");

/* ---------- 引擎资产：扫 engine/ 下的 js/css ----------
   内容是内容，名字是名字：内容一变哈希就变，HTML 里的 ?v= 跟着变，用户缓存自动失效。
   写成扫描而不是写死文件名 —— 以后往 engine/ 里丢一个新的 store.js，
   它自动进 dist/、自动带上版本号，不用回来改这个文件。 */
const assets = fs.readdirSync(P("engine"))
  .filter(f => /\.(js|css)$/.test(f))
  .sort()
  .map(f => {
    const body = read(P("engine", f));
    return { name: f, body, hash: hash(body) };
  });
const V = Object.fromEntries(assets.map(a => [a.name, a.hash]));
const template = read(P("engine", "template.html"));
/* 任何一篇的产物都内联引用引擎，所以引擎任一文件变了，所有文章的缓存签名都得变。
   ★ 模板必须算进来：它不在 assets 里（.html 不参与扫描），漏掉的话
     改模板（加按钮、改结构）之后构建会说「跳过 N 篇」，
     已经生成的文章全停在旧结构上 —— 而构建、校验、冒烟都是绿的。 */
const ENGINE_SIG = assets.map(a => a.name + ":" + a.hash).join("|") + "|template.html:" + hash(template);
const coreGlossary = readJSON(P("data", "glossary.core.json"));
const manifest = readJSON(P("data", "manifest.json"));

/* 顶栏那个「字号缩放」条：所有固定页面都用这一份（文章页的模板里另有一份同样的）
   —— 样式在 .zoom，逻辑在 store.js 的 mountZoom()。
   ⚠ 必须定义在 PAGES 之前：PAGES 的 render 在模块顶层就会跑（TDZ 坑）。 */
const ZOOM_HTML = `<label class="zoom" title="字号缩放：只放大页面内容，顶栏不跟着动">
      <span id="zoomLabel">1x</span>
      <input type="range" id="zoomRange" min="1" max="5" step="0.5" value="1">
    </label>`;

/* ---------- 页面注册表 ----------
   dist/ 顶层所有 .html 都归这里管：构建时逐个重写，孤儿清理时整批豁免。
   登录/注册没有独立页面了 —— 首页左上角圆圈点开弹框（engine/home.js）。 */
const PAGES = [
  { out: "index.html", render: () => renderIndex(manifest, present) },
  { out: "mistakes.html", render: () => renderMistakes(manifest, present) },
  { out: "words.html", render: () => renderWords(manifest, present) },
  { out: "synonyms.html", render: () => renderSynonyms(manifest) },
  { out: "collocations.html", render: () => renderCollocations(manifest) },
  { out: "phrases.html", render: () => renderPhrases(manifest) }
];
const PAGE_OUTS = new Set(PAGES.map(p => p.out));

/* ---------- 工具 ---------- */
const escHTML = s => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* 内联 JSON 必须把 "<" 全部转成 <：
   JSON.stringify 不转义 "/"，内容里一旦出现 </script> 就会提前截断整个页面。 */
const inlineJSON = o => JSON.stringify(o).replace(/</g, "\\u003c");

/* 防闪烁脚本：必须在 <head> 里、外链样式表之前同步跑完，
   否则会先按亮色渲染一帧再跳到暗色。文章页 + 所有固定页面都要它，
   所以只留一份定义 —— 各写一遍的话，主题键名一改就得改三处，漏掉的那页会闪。
   ⚠ 里面的 "pet:theme:v1" 必须与 engine/store.js 的 K_THEME 一致。 */
const THEME_HEAD = `<script>(function(){var t=null;try{t=JSON.parse(localStorage.getItem("pet:theme:v1")||"null")}catch(e){t=null}
if(t!=="light"&&t!=="dark")t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";
document.documentElement.setAttribute("data-theme",t)})();</script>`;

/* 模板里的 <!--V:文件名--> 一律换成该文件的 8 位内容哈希。
   模板里永远不写死哈希，也永远不写死版本 —— 少一个会被人忘记的地方。 */
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

/* 所有模板都要走的替换：这里漏掉一个，那一页就会把 <!--THEME_HEAD--> 当注释吞掉，
   表现是「这页不跟随主题」而且不报任何错。 */
function fillCommon(html) {
  const out = fillVersions(subst(html, "THEME_HEAD", THEME_HEAD));
  /* 走到这儿还留着 <!--大写名--> 的，就是模板里有个占位符没人管。
     上一版登录页的 <h1> 就是这么空掉的：占位符在模板里出现两次，
     而 .replace("<!--SITE-->", v) 只替第一处，剩下那处以注释的形态静默消失 ——
     页面照常渲染，构建、校验、冒烟全绿，只是标题没了。血泪坑 #19。 */
  const left = out.match(/<!--[A-Z][A-Z_]{2,}-->/g);
  if (left) {
    console.error("✗ 模板里有没被替换的占位符：" + [...new Set(left)].join(" "));
    process.exitCode = 1;
  }
  return out;
}

/* 占位符一律走这个，**不要写 .replace("<!--X-->", v)**（只替第一处）。
   替换值用函数返回，免得 $& 之类被当成反向引用（血泪坑 #18）。 */
function subst(html, name, value) {
  return html.replace(new RegExp("<!--" + name + "-->", "g"), () => value);
}

function render(article) {
  const content = {
    ...article,
    // 共享词库打底，本篇的同名词条覆盖它
    glossary: Object.assign({}, coreGlossary, article.glossary || {})
  };
  /* 替换值一律用函数返回 —— 标题/选项里一旦出现 $&、$'、`$1` 这类
     替换模式，传字符串就会被当成反向引用，把内容写坏（血泪坑 #18）。 */
  let h = subst(template, "TITLE", escHTML("PET 精读 · " + article.title));
  h = subst(h, "DESC", escHTML(article.label + " · " + article.title));
  h = subst(h, "LABEL", escHTML(article.label));
  h = subst(h, "CONTENT", inlineJSON(content));
  /* 目录列的数据：整本书的篇目，每篇都注入一份（页面顶部「☰ 目录」按钮用） */
  h = subst(h, "TOC", inlineJSON(tocData(manifest, present)));
  return fillCommon(h);
}

/* 目录数据（文章页的目录列 / 首页的阅读理解入口 / 错题页的篇名映射共用一个形状）：
   { books:[{ title, articles:[{slug, title, label}] }] } —— 只收 present（文件真在的） */
function tocData(man, slugs) {
  return {
    books: man.books.map(b => ({
      title: b.title,
      articles: b.articles.filter(s => slugs.includes(s)).map(s => {
        const a = readJSON(P("articles", s + ".json"));
        return { slug: s, title: a.title, label: a.label };
      })
    })).filter(b => b.articles.length)
  };
}

/* 页面直接引用的引擎资产版本号（与模板里 `<!--V:文件-->` 同一张表）。
   文件不存在时明确报错并置非零退出码 —— 别让页面带着 ?v=undefined 发出去。 */
function assetV(name) {
  if (!(name in V)) {
    console.error("✗ 页面引用了 engine/ 下没有的文件：" + name);
    process.exitCode = 1;
    return "0";
  }
  return V[name];
}

/* ---------- 收集文章 ---------- */
const flat = [];
manifest.books.forEach(b => b.articles.forEach(slug => flat.push({ book: b, slug })));

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
if (!fs.existsSync(path.join(DIST, "engine"))) fs.mkdirSync(path.join(DIST, "engine"));

const cache = (!FORCE && fs.existsSync(CACHE_FILE)) ? readJSON(CACHE_FILE) : {};

/* manifest 说有的篇目，articles/ 下必须真有文件。
   以前这里静默 continue，结果是「首页列着、点进去 404」，
   而构建还是绿的 —— 作者不会发现。现在攒到最后统一报错并置非零退出码。 */
const missing = flat.filter(x => !fs.existsSync(P("articles", x.slug + ".json"))).map(x => x.slug);
const present = flat.map(x => x.slug).filter(s => !missing.includes(s));

/* 引擎文件：内容没变就不重写，省掉 mtime 变动导致的 CDN 回源 */
for (const a of assets) {
  const out = path.join(DIST, "engine", a.name);
  if (FORCE || !fs.existsSync(out) || read(out) !== a.body) {
    fs.writeFileSync(out, a.body, "utf8");
  }
}

/* ---------- 内容资产（图片等）：assets/** → dist/assets/** ----------
   书籍还原用的插图（从 PDF 扫描里裁的原图）放这里。逐字节对比，
   没变不重写；HTML 里一律用相对路径引用（assets/img/xxx.jpg），
   整目录拷走放任何静态服务器都能跑。 */
let assetsCopied = 0;
function copyAssets(srcDir, outDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.readdirSync(srcDir, { withFileTypes: true }).forEach(e => {
    const s = path.join(srcDir, e.name), o = path.join(outDir, e.name);
    if (e.isDirectory()) { if (!fs.existsSync(o)) fs.mkdirSync(o, { recursive: true }); copyAssets(s, o); }
    else {
      const a = fs.readFileSync(s), b = fs.existsSync(o) ? fs.readFileSync(o) : null;
      if (!b || !a.equals(b)) { fs.writeFileSync(o, a); assetsCopied++; }
    }
  });
}
copyAssets(P("assets"), path.join(DIST, "assets"));

/* ---------- 逐篇构建 ---------- */
let built = 0, skipped = 0;

for (const { slug } of flat) {
  if (ONLY && slug !== ONLY) continue;
  const src = P("articles", slug + ".json");
  if (!fs.existsSync(src)) continue; // 上面已经收进 missing

  const raw = read(src);
  const sig = hash(raw + ENGINE_SIG);
  const out = path.join(DIST, slug + ".html");

  if (!FORCE && cache[slug] === sig && fs.existsSync(out)) { skipped++; continue; }

  const article = JSON.parse(raw);
  if (article.slug !== slug) {
    console.error("✗ " + slug + ".json 里的 slug 是 " + article.slug + "，与文件名不符");
    process.exitCode = 1; continue;
  }
  fs.writeFileSync(out, render(article), "utf8");
  cache[slug] = sig;
  built++;
}

/* ---------- 固定页面（目录页、登录页…）----------
   注意用的是全量 present，不是本轮真的构建了哪些：
   否则 `--only <slug>` 构建一次，目录页就被截成只剩那一篇。 */
for (const pg of PAGES) {
  fs.writeFileSync(path.join(DIST, pg.out), pg.render(), "utf8");
}

/* ---------- 清掉 manifest 里已删除的文章产物 ---------- */
const alive = new Set(flat.map(a => a.slug));
let removed = 0;
fs.readdirSync(DIST).forEach(f => {
  if (f.endsWith(".html") && !PAGE_OUTS.has(f) && !alive.has(f.slice(0, -5))) {
    fs.unlinkSync(path.join(DIST, f));
    /* .gz 是派生物，主体删了它也必须跟着走，否则会留下能被直接访问到的旧页面 */
    if (fs.existsSync(path.join(DIST, f + ".gz"))) fs.unlinkSync(path.join(DIST, f + ".gz"));
    delete cache[f.slice(0, -5)]; removed++;
  }
});
Object.keys(cache).forEach(k => { if (!alive.has(k)) delete cache[k]; });

fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0), "utf8");

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

console.log("✓ 构建完成：新出 " + built + " 篇，跳过 " + skipped + " 篇" +
  (removed ? "，清理 " + removed + " 个孤儿" : "") +
  "  ·  " + PAGES.length + " 个固定页面" +
  (assetsCopied ? "  ·  更新 " + assetsCopied + " 个资产文件" : ""));
console.log("  引擎 " + assets.map(a => a.name + " v=" + a.hash).join("  "));
console.log("  预压缩 " + gzipped + " 个文件" + (gzipped ? "，共省 " + Math.round(gzSaved / 1024) + "KB" : ""));
console.log("  共 " + flat.length + " 篇  →  dist/");

if (missing.length) {
  console.error("✗ manifest 里列了、但 articles/ 下没有文件的有 " + missing.length + " 篇：");
  missing.forEach(s => console.error("    · " + s + "  （缺 articles/" + s + ".json）"));
  process.exitCode = 1;
}

/* ============================================================
   首页（个性化主页）
   ============================================================
   没登录：显示「请先登录哦」+ 淡化锁住的入口（file:// 等存不住登录态的场景
   仍可直接点进去预览 —— 门禁在存储不可用时是放行的）。
   登录：入口可用，「PET 阅读理解」跳到上次学到的那篇（engine/home.js 里查）。
   登录/注册 = 左上角圆圈点开的弹框，不再有独立登录页。 */
function renderIndex(man, slugs) {
  const toc = inlineJSON(tocData(man, slugs));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(man.site.title)}</title>
<meta name="description" content="${escHTML(man.site.tagline || "")}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${assetV("style.css")}">
<script src="engine/store.js?v=${assetV("store.js")}"></script>
</head>
<body class="home-body">

<div class="home-wrap">
  <header class="home-top">
    <!-- 用户圆圈：没登录是灰的、点开登录弹框；登录后按等级上色（1=蓝 … 18=金） -->
    <button class="avatar off" id="avatar" type="button" title="登录 / 注册" aria-haspopup="menu">
      <span class="avatar-t" id="avatarT">👤</span>
    </button>
    <div class="home-brand">
      <h1>${escHTML(man.site.title)}</h1>
      <p>${escHTML(man.site.tagline || "")}</p>
    </div>
    <button class="tool" id="tglTheme" type="button" title="主题：跟随系统">◐ 跟随</button>
    ${ZOOM_HTML}
  </header>

  <div class="home-ask" id="homeAsk" hidden>
    <div class="ask-big">请先登录哦</div>
    <p class="ask-sub">登录后加载你的个性化首页：词书、阅读理解、错题记录都在这。</p>
    <button class="btn pri" id="askLogin" type="button">登录 / 注册</button>
  </div>

  <main class="home-main" id="homeMain">
    <section class="tiles" id="tilesMain" aria-label="学习入口">
      <a class="tile" data-go="words" href="words.html"><span class="tile-ico">📖</span><span class="tile-lab">我的词书</span></a>
      <a class="tile" data-go="read" id="tileRead" href="#"><span class="tile-ico">📕</span><span class="tile-lab">PET 阅读理解</span></a>
      <a class="tile" data-go="syn" href="synonyms.html"><span class="tile-ico">🔀</span><span class="tile-lab">PET 同义替换</span></a>
      <a class="tile" data-go="coll" href="phrases.html"><span class="tile-ico">🧩</span><span class="tile-lab">PET 词组库</span></a>
      <a class="tile soon" data-go="speak" href="#"><span class="tile-ico">🗣</span><span class="tile-lab">PET 口语</span></a>
      <a class="tile soon" data-go="listen" href="#"><span class="tile-ico">🎧</span><span class="tile-lab">PET 听力</span></a>
      <a class="tile soon" data-go="write" href="#"><span class="tile-ico">✍</span><span class="tile-lab">PET 写作</span></a>
      <a class="tile" data-go="mistakes" href="mistakes.html"><span class="tile-ico">📝</span><span class="tile-lab">错题记录</span></a>
    </section>

    <hr class="home-hr">

    <h2 class="home-sec-t">今天的作业</h2>
    <section class="tiles" aria-label="今天的作业">
      <a class="tile soon" data-go="hw-words" href="#"><span class="tile-ico">🔁</span><span class="tile-lab">今天要复习的词书</span></a>
      <a class="tile soon" data-go="hw-math" href="#"><span class="tile-ico">➗</span><span class="tile-lab">数学补习</span></a>
      <a class="tile soon" data-go="hw-cn" href="#"><span class="tile-ico">🉐</span><span class="tile-lab">语文补习</span></a>
    </section>
  </main>
</div>

<!-- 头像菜单：登录后点圆圈弹它 -->
<div class="umenu" id="uMenu" hidden>
  <div class="umenu-name" id="uName">—</div>
  <div class="umenu-lv">等级 <b id="uLv">1</b> <i class="umenu-dot" id="uDot"></i></div>
  <button class="umenu-out" id="uOut" type="button">退出登录</button>
</div>

<!-- 登录 / 注册弹框 -->
<div class="um" id="uModal" hidden>
  <div class="um-mask" data-um="close"></div>
  <div class="um-card" role="dialog" aria-modal="true" aria-labelledby="umTitle">
    <button class="um-x" type="button" data-um="close" title="关闭">✕</button>
    <h2 class="um-title" id="umTitle">登录 PET 精读</h2>
    <div class="um-tabs">
      <button class="um-tab on" type="button" data-mode="login">登录</button>
      <button class="um-tab" type="button" data-mode="reg">注册</button>
    </div>
    <form id="umForm" novalidate>
      <label class="um-label" for="umPhone">手机号</label>
      <div class="um-row">
        <span class="um-cc">+86</span>
        <input id="umPhone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="11 位手机号">
      </div>
      <div id="umReg" hidden>
        <label class="um-label" for="umNick">昵称</label>
        <div class="um-row">
          <input id="umNick" name="nickname" type="text" maxlength="16" autocomplete="nickname" placeholder="怎么称呼你（1–16 个字）">
        </div>
      </div>
      <label class="um-label" for="umPass">密码</label>
      <div class="um-row">
        <input id="umPass" name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="6–64 位">
      </div>
      <p class="um-err" id="umErr" role="alert" hidden></p>
      <button class="um-btn" id="umBtn" type="submit">登录</button>
    </form>
    <p class="um-note">登录状态在本设备保持 14 天。忘记密码请联系老师重置。</p>
  </div>
</div>

<script>window.PET_TOC = ${toc};</script>
<script src="engine/home.js?v=${assetV("home.js")}"></script>
</body>
</html>`;
}

/* ============================================================
   固定内容页（错题记录 / 我的词书）：同一副骨架，两个列表页共用。
   都过门禁、都显示昵称角标、都有主题按钮。
   ============================================================ */
function renderListPage(man, toc, opts) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(opts.title)} · ${escHTML(man.site.title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${assetV("style.css")}">
<script src="engine/store.js?v=${assetV("store.js")}"></script>
<!-- 门禁：和文章页同一道（存储不可用时放行，见 store.js） -->
<script>PETStore.guard().catch(function(){});</script>
</head>
<body class="page-body">
<div class="page-wrap">
  <header class="page-top">
    <a class="page-back" href="index.html">← 首页</a>
    <h1 class="page-title">${escHTML(opts.title)}</h1>
    <span class="who" id="who" hidden></span>
    <button class="tool" id="tglTheme" type="button" title="主题：跟随系统">◐ 跟随</button>
    ${ZOOM_HTML}
  </header>
  <p class="page-sub">${escHTML(opts.sub)}</p>
  <div class="listbox" id="listBox"><div class="list-empty">加载中…</div></div>
</div>
<script>window.PET_TOC = ${toc};</script>
<script src="engine/${opts.script}?v=${assetV(opts.script)}"></script>
</body>
</html>`;
}

function renderMistakes(man, slugs) {
  const toc = inlineJSON(tocData(man, slugs));
  return renderListPage(man, toc, {
    title: "错题记录",
    sub: "阅读理解里做错过的题都在这。点「去订正」回到那道题看看解析。",
    script: "mlist.js"
  });
}

/* ============================================================
   同义替换页（synonyms.html · 内部资料）
   内容 data/synonyms.json 整份内联（和文章页一个路子：纯静态、登录门禁后面）。
   文件不在时构建给出空数据页（不报错）—— 换机器别让整站构建挂掉。
   ============================================================ */
function renderSynonyms(man) {
  const src = P("data", "synonyms.json");
  let D;
  try { D = readJSON(src); } catch (e) {
    console.error("! 读不到 data/synonyms.json（同义替换页会是空页）：" + e.message);
    D = { title: "PET 阅读同义替换", credit: "", groups: [] };
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(D.title || "PET 阅读同义替换")} · ${escHTML(man.site.title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${assetV("style.css")}">
<script src="engine/store.js?v=${assetV("store.js")}"></script>
<!-- 门禁：和文章页同一道（存储不可用时放行，见 store.js） -->
<script>PETStore.guard().catch(function(){});</script>
</head>
<body class="page-body">
<div class="page-wrap syn-wrap">
  <header class="page-top">
    <a class="page-back" href="index.html">← 首页</a>
    <h1 class="page-title">PET 同义替换</h1>
    <span class="who" id="who" hidden></span>
    <button class="tool" id="tglTheme" type="button" title="主题：跟随系统">◐ 跟随</button>
    ${ZOOM_HTML}
  </header>
  <p class="page-sub">${(D.groups || []).length} 组「原文 ⇄ 同义替换」：点英文单词听读音、☆ 收藏进词书；切到「连线题」按书上的玩法练。</p>
  <p class="syn-credit" id="synCredit"></p>
  <div class="syn-bar">
    <input id="synSearch" class="syn-search" type="search" placeholder="搜索：中文、英文都行（如 野餐 / picnic）" autocomplete="off">
    <button class="btn" id="synMask" type="button">遮住同义替换</button>
    <div class="syn-tabs">
      <button class="syn-tab on" data-view="list" type="button">列表</button>
      <button class="syn-tab" data-view="quiz" type="button">连线题</button>
    </div>
  </div>
  <div id="synList" class="syn-list"><div class="syn-empty">加载中…</div></div>
  <div id="synQuiz" class="syn-quiz" hidden></div>
</div>
<div class="syn-pop" id="synPop" hidden>
  <div class="syn-pop-mask" data-pop="close"></div>
  <div class="syn-pop-card" id="synPopCard" role="dialog" aria-modal="true" aria-label="单词卡片"></div>
</div>
<script>window.PET_SYN = ${inlineJSON(D)};</script>
<script src="engine/syn.js?v=${assetV("syn.js")}"></script>
</body>
</html>`;
}

/* ============================================================
   固定搭配页（collocations.html · 内部资料）
   内容 data/phrases.json 整份内联（同义替换页一个路子：纯静态、登录门禁后面）。
   一组一屏：短语卡 + 同组填空练习，10 个一组（和书上一样）。
   文件不在时构建给出空数据页（不报错）—— 换机器别让整站构建挂掉。
   ============================================================ */
function renderCollocations(man) {
  const src = P("data", "phrases.json");
  let D;
  try { D = readJSON(src); }
  catch (e) {
    console.error("! 读不到 data/phrases.json（固定搭配页会是空页）：" + e.message);
    D = { title: "PET 必会固定搭配", credit: "", note: "", items: [] };
  }
  const cnt = (D.items || []).length;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(D.title || "PET 必会固定搭配")} · ${escHTML(man.site.title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${assetV("style.css")}">
<script src="engine/store.js?v=${assetV("store.js")}"></script>
<!-- 门禁：和文章页同一道（存储不可用时放行，见 store.js） -->
<script>PETStore.guard().catch(function(){});</script>
</head>
<body class="page-body">
<div class="page-wrap col-wrap">
  <header class="page-top">
    <a class="page-back" href="index.html">← 首页</a>
    <h1 class="page-title">PET 固定搭配</h1>
    <span class="who" id="who" hidden></span>
    <button class="tool" id="tglTheme" type="button" title="主题：跟随系统">◐ 跟随</button>
    ${ZOOM_HTML}
  </header>
  <p class="page-sub">${escHTML(D.note || "")}</p>
  <p class="col-credit" id="colCredit"></p>
  <div class="col-bar">
    <div class="col-groups" id="colGroups"></div>
    <a class="btn col-jump" href="#colPractice">本组练习 ↓</a>
  </div>
  <h2 class="col-h2" id="colCardsH">短语卡</h2>
  <div class="col-cards" id="colCards"></div>
  <section class="col-practice" id="colPractice">
    <div class="col-phead">
      <span class="col-ptitle" id="colPH">练习</span>
      <span class="col-pscore" id="colScore"></span>
      <span class="col-pnav">
        <button class="btn" id="colReveal" type="button">对答案</button>
        <button class="btn" id="colReset" type="button">重做本组</button>
      </span>
    </div>
    <div class="col-done" id="colDone" hidden></div>
    <div class="col-bank" id="colBank"></div>
    <p class="col-ptip">先点句子里的横线、再点短语库里的短语；直接点短语也能填到第一个空。</p>
    <div class="col-qlist" id="colQs"></div>
    <div class="col-pfoot">
      <button class="btn" id="colPrev" type="button">← 上一组</button>
      <button class="btn" id="colNext" type="button">下一组 →</button>
      <span class="col-pcount">${cnt} 条 · 每 10 个一组</span>
    </div>
  </section>
</div>
<script>window.PET_COL = ${inlineJSON(D)};</script>
<script src="engine/col.js?v=${assetV("col.js")}"></script>
</body>
</html>`;
}

/* ============================================================
   词组库（phrases.html · 内部资料）
   两种模式 + 一张速查表：
     · 精读模式（engine/phrase.js）—— 一次一张卡、点词组看小黑板、点单词听读音、☆ 收藏
     · 小霸王模式（engine/xbw.js）—— 自动播放 → 连线 → 选择题 → 自动批改（错题进错题本）
     · 速查表 = 老页面 collocations.html（10 个一组的清单 + 填空练习），从组页里链过去
   内容 data/phrases.json 整份内联；随页带一份「例句里出现的词」的小词典（dict），
   点单词就能出释义（没命中的显示「词义待补」—— 词典分批补，往 glossary.core.json 里加词）。
   ============================================================ */

/* 从共享词库（glossary.core.json）里挑出「词组例句里用到的词」，
   顺手做一遍屈折回退（与 app.js lookup() 同一口径），命中的才带上。
   这就是「词典分批补」的落点：往 glossary.core.json 加词，页面自动变厚。 */
function phraseDict(items) {
  const dict = {};
  const wordRe = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const cands = w => {
    const out = [w];
    const add = x => { if (x && x.length > 1 && out.indexOf(x) < 0) out.push(x); };
    if (/[’']s$/.test(w)) add(w.replace(/[’']s$/, ""));
    if (w.slice(-3) === "ies") add(w.slice(0, -3) + "y");
    if (w.slice(-4) === "ives") add(w.slice(0, -4) + "ife");
    if (w.slice(-2) === "es") add(w.slice(0, -2));
    if (w.slice(-1) === "s") add(w.slice(0, -1));
    if (w.slice(-3) === "ing") {
      add(w.slice(0, -3)); add(w.slice(0, -3) + "e");
      if (/([bdfglmnprt])\1$/.test(w.slice(0, -3))) add(w.slice(0, -4));
    }
    if (w.slice(-2) === "ed") {
      add(w.slice(0, -2)); add(w.slice(0, -1));
      if (/([bdfglmnprt])\1$/.test(w.slice(0, -2))) add(w.slice(0, -3));
    }
    if (w.slice(-2) === "er") { add(w.slice(0, -2)); if (/([bdfglmnprt])\1$/.test(w.slice(0, -2))) add(w.slice(0, -3)); }
    if (w.slice(-3) === "est") { add(w.slice(0, -3)); if (/([bdfglmnprt])\1$/.test(w.slice(0, -3))) add(w.slice(0, -4)); }
    return out;
  };
  const words = new Set();
  (items || []).forEach(it => {
    (String(it.ex || "").match(wordRe) || []).forEach(w => words.add(w.toLowerCase()));
  });
  words.forEach(w => {
    for (const c of cands(w)) {
      const e = coreGlossary[c];
      if (e) {
        dict[w] = { w: c, ipa: e.ipa || "", pos: e.pos || "", cn: e.cn || "" };
        return;
      }
    }
  });
  return dict;
}

function renderPhrases(man) {
  const src = P("data", "phrases.json");
  let D;
  try { D = readJSON(src); }
  catch (e) {
    console.error("! 读不到 data/phrases.json（词组库会是空页）：" + e.message);
    D = { title: "PET 词组库", credit: "", note: "", items: [] };
  }
  const items = D.items || [];
  const cnt = items.length;
  /* 随页带的小词典：例句里出现的词（核心词库命中）+ data/phrases.dict.json 里补的词。
     「词典分批补」= 往 phrases.dict.json 加词（每批上线时把这批例句里的生词补齐）。 */
  let extra = {};
  try {
    const x = readJSON(P("data", "phrases.dict.json"));
    Object.keys(x.words || {}).forEach(k => {
      const e = x.words[k] || {};
      extra[String(k).toLowerCase()] = { w: k, ipa: e.ipa || "", pos: e.pos || "", cn: e.cn || "" };
    });
  } catch (e) { /* 没有这份文件也能跑：词典只少几条 */ }
  const dict = Object.assign({}, phraseDict(items), extra);
  /* 哪些条目已经有「预生成的跟读音频」（assets/read/<n>.mp3）：
     有就优先播文件（不依赖设备的 TTS），没有才退回 TTS。
     构建期扫目录，页面不用发请求探文件在不在。 */
  let haveAudio = new Set();
  try {
    const ad = P("assets", "read");
    if (fs.existsSync(ad)) {
      fs.readdirSync(ad).forEach(f => {
        const m = /^(\d+)\.mp3$/.exec(f);
        if (m) haveAudio.add(Number(m[1]));
      });
    }
  } catch (e) { /* 目录没有也能跑：全部走 TTS */ }
  const payloadItems = items.map(it => Object.assign({}, it, haveAudio.has(it.n) ? { ra: 1 } : {}));
  const payload = { title: D.title || "PET 词组库", credit: D.credit || "", note: D.note || "",
                    items: payloadItems, dict: dict };
  console.log("  词组库跟读音频：" + haveAudio.size + "/" + cnt + " 条");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(D.title || "PET 词组库")} · ${escHTML(man.site.title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${assetV("style.css")}">
<script src="engine/store.js?v=${assetV("store.js")}"></script>
<!-- 门禁：和文章页同一道（存储不可用时放行，见 store.js） -->
<script>PETStore.guard().catch(function(){});</script>
</head>
<body class="page-body ph-body">
<div class="topbar">
  <a class="page-back" href="index.html">← 首页</a>
  <div class="brand">PET 词组库<small>${cnt} 条 · 每 10 个一组</small></div>
  <div class="tabs">
    <button class="tab on" data-phview="list" type="button">分组</button>
    <button class="tab" data-phview="read" type="button">📖 精读模式</button>
    <button class="tab" data-phview="xbw" type="button">🕹 小霸王模式</button>
    <button class="tab" data-phview="srs" type="button">🔁 复习</button>
  </div>
  <div class="spacer"></div>
  <div class="tools">
    <button class="tool" id="tglVoice" type="button" title="挑跟读的音色（英文 / 中文）">🎙 音色</button>
    <button class="tool" id="tglHist" type="button" title="显示 / 隐藏历史浮动面板">▣ 历史</button>
    <span class="who" id="who" hidden></span>
    <button class="tool" id="tglTheme" type="button" title="主题：跟随系统">◐ 跟随</button>
    ${ZOOM_HTML}
  </div>
</div>

<main class="ph-main">
  <p class="col-credit" id="phCredit"></p>
  <p class="page-sub" id="phNote"></p>

  <!-- 分组列表 -->
  <section id="viewList">
    <div class="ph-groups" id="phGroups"></div>
  </section>

  <!-- 精读模式：左卡片 / 右小黑板（窄屏小黑板是底部抽屉） -->
  <section id="viewRead" hidden>
    <div class="cols" id="cols">
      <div class="col" id="col1">
        <div class="col-head">
          <span id="phCardTitle">词组卡</span>
          <span class="hint">点<b>词组</b>看小黑板 · 点<b>单词</b>听读音</span>
        </div>
        <div class="col-body" id="cardBox">
          <div id="phCard"></div>
        </div>
      </div>
      <div class="col" id="colAna">
        <div class="col-head">
          <span>小黑板</span>
          <span class="hint" id="anaHint">点卡片上的词组或单词</span>
          <button class="collapse" id="anaCollapse" type="button" title="收起小黑板">✕</button>
        </div>
        <div class="col-body" id="analysis"></div>
      </div>
    </div>
    <div class="scrim" id="phScrim"></div>
    <aside class="hist-float" id="histFloat" hidden>
      <div class="hist-head">
        <span>历史</span>
        <span class="hist-hint">点过的都记在这 · 重复点击置顶</span>
        <button class="hist-close" id="histClose" type="button" title="收起历史">✕</button>
      </div>
      <div class="hist-body" id="history"></div>
    </aside>
  </section>

  <!-- 小霸王模式：三关 + 总结 -->
  <section id="viewXbw" hidden>
    <div class="xbw" id="xbw"></div>
  </section>

  <!-- 复习（间隔重复）：今天到期的词组 + 没练过的 -->
  <section id="viewSrs" hidden>
    <div class="xbw" id="srs"></div>
  </section>
</main>

<!-- 音色面板（点顶栏「🎙 音色」） -->
<div class="syn-pop" id="voicePanel" hidden></div>

<script>window.PET_PHRASES = ${inlineJSON(payload)};</script>
<script src="engine/phrase.js?v=${assetV("phrase.js")}"></script>
<script src="engine/xbw.js?v=${assetV("xbw.js")}"></script>
<script src="engine/srs.js?v=${assetV("srs.js")}"></script>
</body>
</html>`;
}

function renderWords(man, slugs) {
  const toc = inlineJSON(tocData(man, slugs));
  return renderListPage(man, toc, {
    title: "我的词书",
    sub: "在文章里按 ☆ 收藏过的单词和句子都会汇到这里。点任意一条，看音标、例句和句子分析。",
    script: "words.js"
  });
}
