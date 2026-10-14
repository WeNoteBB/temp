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

/* ---------- 页面注册表 ----------
   dist/ 顶层所有 .html 都归这里管：构建时逐个重写，孤儿清理时整批豁免。
   以前 index.html 是写在清理循环里的一个字符串特例，加第二个页面就得再堆一处。 */
const PAGES = [
  { out: "index.html", render: () => renderIndex(manifest, present) },
  { out: "login.html", render: () => renderLogin(manifest) }
];
const PAGE_OUTS = new Set(PAGES.map(p => p.out));

/* ---------- 工具 ---------- */
const escHTML = s => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* 内联 JSON 必须把 "<" 全部转成 <：
   JSON.stringify 不转义 "/"，内容里一旦出现 </script> 就会提前截断整个页面。 */
const inlineJSON = o => JSON.stringify(o).replace(/</g, "\\u003c");

/* 防闪烁脚本：必须在 <head> 里、外链样式表之前同步跑完，
   否则会先按亮色渲染一帧再跳到暗色。三个页面都要它，所以只留一份定义 ——
   各写一遍的话，主题键名一改就得改三处，漏掉的那页会闪。
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
  return fillCommon(h);
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
  "  ·  " + PAGES.length + " 个固定页面");
console.log("  引擎 " + assets.map(a => a.name + " v=" + a.hash).join("  "));
console.log("  预压缩 " + gzipped + " 个文件" + (gzipped ? "，共省 " + Math.round(gzSaved / 1024) + "KB" : ""));
console.log("  共 " + flat.length + " 篇  →  dist/");

if (missing.length) {
  console.error("✗ manifest 里列了、但 articles/ 下没有文件的有 " + missing.length + " 篇：");
  missing.forEach(s => console.error("    · " + s + "  （缺 articles/" + s + ".json）"));
  process.exitCode = 1;
}

/* ============================================================
   目录页
   ============================================================ */
function renderIndex(man, slugs) {
  const arts = slugs.map(s => {
    const a = readJSON(P("articles", s + ".json"));
    return { slug: s, title: a.title, label: a.label, words: a.passage.words, sentences: a.passage.sentences };
  });
  let h = "";
  man.books.forEach(b => {
    const mine = arts.filter(a => b.articles.includes(a.slug));
    if (!mine.length) return;
    h += '<section class="book"><h2>' + escHTML(b.title) + '</h2><ul>';
    mine.forEach(a => {
      h += '<li><a href="' + escHTML(a.slug) + '.html">' +
        '<span class="t">' + escHTML(a.title) + '</span>' +
        '<span class="m">' + escHTML(a.label) + '</span>' +
        '<span class="n">' + a.words + ' 词 · ' + a.sentences + ' 句</span>' +
        '</a></li>';
    });
    h += '</ul></section>';
  });

  /* 目录页是手写模板，不进 engine/template.html（它没有 PET_CONTENT，结构也不同）。
     但它**共用 style.css**，所以样式一律写令牌 —— 写死 #fff 的话，
     学生一进目录页就是一片白，明明文章页已经是暗的。 */
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(man.site.title)}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef1f6">
${THEME_HEAD}
<link rel="stylesheet" href="engine/style.css?v=${V["style.css"]}">
<script src="engine/store.js?v=${V["store.js"]}"></script>
<script>PETStore.guard().catch(function(){});</script>
<style>
  body{background:var(--bg);margin:0;padding:0 16px 64px;
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
       color:var(--ink);-webkit-text-size-adjust:100%}
  .wrap{max-width:880px;margin:0 auto}
  header.site{padding:40px 0 20px}
  header.site h1{margin:0;font-size:30px;letter-spacing:.5px}
  header.site p{margin:6px 0 0;color:var(--ink-2);font-size:14px}
  .book{margin:28px 0 0}
  .book h2{font-size:15px;color:var(--ink-2);font-weight:600;margin:0 0 10px;
           padding-bottom:8px;border-bottom:1px solid var(--line)}
  .book ul{list-style:none;margin:0;padding:0;
           display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
  .book a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;
          padding:14px 16px;text-decoration:none;color:inherit;
          transition:border-color .15s,box-shadow .15s,transform .15s}
  .book a:hover{border-color:var(--border-accent);box-shadow:var(--shadow);transform:translateY(-1px)}
  .book .t{display:block;font-weight:600;font-size:16px}
  .book .m{display:block;color:var(--ink-2);font-size:12.5px;margin-top:3px}
  .book .n{display:block;color:var(--ink-3);font-size:12px;margin-top:6px}
  /* 手机号角标：沿用文章页 .who 的类名（store.mountWho 造的 DOM），
     这里只补目录页自己的排版位置 */
  header.site{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 12px}
  header.site .site-txt{flex:1;min-width:0}
  #who{margin-left:auto;align-self:center}
</style>
</head>
<body>
<div class="wrap">
  <header class="site">
    <div class="site-txt">
      <h1>${escHTML(man.site.title)}</h1>
      <p>${escHTML(man.site.tagline || "")} · 共 ${arts.length} 篇</p>
    </div>
    <span class="who" id="who" hidden></span>
  </header>
  ${h}
</div>
<script>
  /* 只做两件事：显示脱敏手机号、能退出。目录页不加载 app.js
     （那会为了一个角标把整个引擎拖进来）。 */
  (function () { window.PETStore.mountWho(document.getElementById("who")); })();
</script>
</body>
</html>`;
}

/* ============================================================
   登录页
   ============================================================ */
function renderLogin(man) {
  /* 站点名在模板里出现两次（<title> 与 <h1>），必须全局替换 */
  return fillCommon(subst(read(P("engine", "login.template.html")), "SITE", escHTML(man.site.title)));
}
