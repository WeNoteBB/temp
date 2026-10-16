/* 端到端冒烟测试：把构建产物在 jsdom 里真跑一遍
   用法：
     node tools/smoke.mjs                 测 manifest 里的全部文章
     node tools/smoke.mjs <slug> [...]    只测指定的几篇

   与旧版的关键差别：
   1. 引擎是外链的，jsdom 读 file:// 带 ?v= 的路径不可靠，所以测试时把
      engine/app.js 与 style.css 就地内联回去；外链路径本身另做存在性断言。
   2. 所有测试用的「样本」都从文章数据里推导，不再写死 opportunity / 22 句 / 5 个空位，
      这样同一套测试对 200 篇都成立。
   3. jsdom 不做排版，页边按钮的「位置」用假的 getBoundingClientRect 验算。
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM, VirtualConsole } from "jsdom";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => path.join(root, ...a);
const read = p => fs.readFileSync(p, "utf8");

const manifest = JSON.parse(read(P("data", "manifest.json")));
const allSlugs = manifest.books.flatMap(b => b.articles);
const targets = process.argv.slice(2).length ? process.argv.slice(2) : allSlugs;

/* dist/engine 下的全部 js/css，按文件名索引 —— 页面里引了几个就内联几个。
   写死 app.js + style.css 的话，store.js 一加进来就得回来改这里，
   而漏改的表现是「内联没做 → 页面在 jsdom 里少一个脚本 → 一堆断言莫名其妙地挂」。 */
const ENGINE_SRC = Object.fromEntries(
  fs.readdirSync(P("dist", "engine"))
    .filter(f => /\.(js|css)$/.test(f))
    .map(f => [f, read(P("dist", "engine", f))])
);

/* 测试用的登录态。不预置的话，门禁会把每个用例都渲染成跳转页，
   110 条断言全军覆没 —— 这是加门禁时最容易漏掉的一处回归。
   ⚠ ts 必须用「跑测试的现在」：登录态只保持 14 天，写死一个旧时间戳
   会直接被 store.getUser() 判过期（这正是要测的行为，但别在这里撞上）。 */
const FAKE_USER = { phone: "13800138000", ts: Date.now(), nickname: "小明", level: 3, color: "#31d896" };

/* 给页面注入一个假 fetch（jsdom 没有 fetch）。
   routes：{ "POST /api/login": {status?, j}, "GET /api/favs": … }
   键没写 method 默认 GET；返回的函数上挂 .calls 供断言。 */
function fakeFetch(routes) {
  const calls = [];
  const fn = (url, init) => {
    const path = String(url).replace(/^[^?#]*\/api/, "/api").split("?")[0];
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method, body, url: String(url) });
    const r = routes[method + " " + path] || routes[path];
    if (!r) return Promise.reject(new TypeError("no route: " + method + " " + path));
    return Promise.resolve({
      ok: (r.status || 200) < 400,
      status: r.status || 200,
      json: () => Promise.resolve(r.j)
    });
  };
  fn.calls = calls;
  return fn;
}

/* ============================================================
   载入一个页面：外链改内联
   expectScripts：这类页面总共该有几个 <script>（含内联的）。
     血泪坑 #18 的回归卡口 —— 内容或引擎里出现 $& 之类被当成反向引用时，
     这里会立刻炸出多余的标签。各类页面的数量不同，所以按页面传。
   ============================================================ */
function loadPage(file, { expectScripts, slug = file, seed = null, query = "", noStorage = false, fetch = null } = {}) {
  const abs = P("dist", file);
  if (!fs.existsSync(abs)) throw new Error("找不到构建产物 " + abs + "，先跑 node build.mjs");
  let html = read(abs);

  const tagCount = (html.match(/<script[\s>]/g) || []).length;
  ok(tagCount === expectScripts,
    `[${slug}] HTML 里恰好 ${expectScripts} 个 <script>，实际 ${tagCount}`);

  /* 外链路径必须先验对，否则内联掉就永远发现不了路径写错 */
  const cssHref = (html.match(/<link rel="stylesheet" href="([^"]+)"/) || [])[1];
  assertEngineRef(cssHref, slug, "CSS");
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  ok(srcs.length > 0, `[${slug}] 有外链引擎脚本`);
  srcs.forEach(s => assertEngineRef(s, slug, "JS"));

  /* 内联（?v= 已被上面的断言覆盖，这里剥掉）
     必须传函数：引擎里有 "\\$&" 这种字符串，传字符串替换会被当成反向引用，
     把匹配到的 <script src=…> 整段复制进代码里 —— 就是血泪坑 #18。 */
  html = html
    .replace(/<link rel="stylesheet" href="[^"]+">/g, () => "<style>" + ENGINE_SRC["style.css"] + "</style>")
    .replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
      const name = src.split("?")[0].replace(/^engine\//, "");
      const body = ENGINE_SRC[name];
      if (body == null) { fail(`[${slug}] 外链了 dist/engine 里没有的脚本：${src}`); return m; }
      return "<script>" + body + "</script>";
    });

  const vc = new VirtualConsole();
  const logs = [];
  vc.on("jsdomError", e => logs.push("[jsdomError] " + (e.detail ? (e.detail.stack || e.detail) : e.message)));
  vc.on("error", (...a) => logs.push("[error] " + a.join(" ")));

  return new Promise((resolve, reject) => {
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: "http://localhost/" + file + query,
      pretendToBeVisual: true,
      virtualConsole: vc,
      /* 存储要在任何脚本之前就位 —— store.js 在解析阶段就会读它判门禁。
         放到 load 之后再写，页面早跳走了。 */
      beforeParse(window) {
        stubMatchMedia(window);
        /* 假 fetch：store.js 是运行时判 typeof fetch 的，挂 window 上就够 */
        if (fetch) window.fetch = fetch;
        /* 无痕 / 禁止网站数据：连读 window.localStorage 这个属性都抛 SecurityError */
        if (noStorage) {
          Object.defineProperty(window, "localStorage", {
            configurable: true,
            get() { throw new Error("SecurityError: 本页禁止访问存储"); }
          });
        } else seedInto(window, seed);
      }
    });
    const timer = setTimeout(() => reject(new Error(slug + " 载入超时")), 20000);
    dom.window.addEventListener("load", () => {
      /* 门禁链路是 await 出来的，load 之后还要再让出几轮微/宏任务才能断言 */
      setTimeout(() => { clearTimeout(timer); resolve({ dom, logs }); }, 60);
    });
  });
}

function seedInto(window, seed) {
  const data = Object.assign({}, seed || {});
  if (data.__user !== false) data["pet:user:v1"] = JSON.stringify(data.__user || FAKE_USER);
  delete data.__user;
  try {
    Object.keys(data).forEach(k => {
      const v = data[k];
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    });
  } catch (e) { /* jsdom 的存储起不来时，门禁会走「放行」分支，测试照跑 */ }
}

/* jsdom 不实现 matchMedia（真机上是有的）。
   引擎用它判宽窄、判系统主题，所以给一个固定答复的实现：
   宽窄判否（= 桌面两列布局，与现有断言的前提一致），系统主题判否（= 亮色）。
   注意 jsdom 的 getComputedStyle 根本不处理 @media 块，
   所以底部抽屉那套 CSS 在这里是隐形的 —— 那一整块只能人工在浏览器里验。 */
function stubMatchMedia(window) {
  window.matchMedia = q => ({
    media: String(q), matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null
  });
}

const loadArticle = (slug, opts) => loadPage(slug + ".html",
  Object.assign({ expectScripts: 5, slug }, opts || {}));
const tick = () => new Promise(r => setTimeout(r, 0));

function assertEngineRef(href, slug, kind) {
  if (!href) { fail(`[${slug}] HTML 里没有 ${kind} 外链`); return; }
  const clean = href.split("?")[0];
  const abs = path.join(P("dist"), clean);
  if (!fs.existsSync(abs)) fail(`[${slug}] ${kind} 外链指向不存在的文件：${href}`);
  else pass(`[${slug}] ${kind} 外链有效：${href}`);
}

/* ============================================================
   断言账本
   ============================================================ */
let nPass = 0, nFail = 0;
const failures = [];
/* ok：条件断言；pass / fail：直接记一笔（用于已自行判断过的情况） */
const ok = (c, m) => { c ? nPass++ : (nFail++, failures.push(m)); return c; };
const pass = m => { nPass++; };
const fail = m => { nFail++; failures.push(m); };

/* ============================================================
   单篇测试
   ============================================================ */
async function testArticle(slug) {
  const notes = [];
  /* 假后端：错题登记要能看到 POST 体；收藏链路给空列表（本地表才是界面真相）。
     不注入的话 jsdom 没有 fetch，错题登记会走「静默跳过」分支 ——
     那也要测，放在下面的 14b 里分叉。 */
  const api = fakeFetch({
    "GET /api/favs": { j: { ok: true, items: [] } },
    "POST /api/favs/add": { j: { ok: true } },
    "POST /api/favs/remove": { j: { ok: true } },
    "POST /api/mistakes": { j: { ok: true } }
  });
  const { dom, logs } = await loadArticle(slug, { fetch: api });
  const { window } = dom;
  const doc = window.document;
  const C = window.PET_CONTENT;

  const passage = doc.getElementById("passage");
  const ana = doc.getElementById("analysis");
  const hist = doc.getElementById("history");
  const qList = doc.getElementById("qList");
  const qRead = doc.getElementById("qListRead");
  const cols = doc.querySelector(".cols");
  const gutter = doc.getElementById("pgutter");
  const click = (el, w = window) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  /* ---------- 从数据推导样本 ---------- */
  const G = C.glossary || {};
  const sents = C.passage.paragraphs.flat();
  const N = sents.length;
  const TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
  const toks = s => {
    const o = []; let m; TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) o.push(m[2] ? { w: m[2].toLowerCase() } : { slot: +m[1] });
    return o;
  };
  const allWords = [...new Set(sents.flatMap(s => toks(s.s)).filter(t => t.w).map(t => t.w))];

  const dedouble = s => /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
  function resolves(w) {
    const c = [w]; const add = x => { if (x && x.length > 1 && !c.includes(x)) c.push(x); };
    if (/[’']s$/.test(w)) add(w.replace(/[’']s$/, ""));
    if (w.slice(-3) === "ies") add(w.slice(0, -3) + "y");
    if (w.slice(-2) === "es") add(w.slice(0, -2));
    if (w.slice(-1) === "s") add(w.slice(0, -1));
    if (w.slice(-3) === "ing") { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); add(dedouble(w.slice(0, -3))); }
    if (w.slice(-2) === "ed") { add(w.slice(0, -2)); add(w.slice(0, -1)); add(dedouble(w.slice(0, -2))); }
    if (w.slice(-2) === "er") { add(w.slice(0, -2)); add(dedouble(w.slice(0, -2))); }
    if (w.slice(-3) === "est") { add(w.slice(0, -3)); add(dedouble(w.slice(0, -3))); }
    return c.find(x => G[x]) || null;
  }

  const directWord = allWords.find(w => G[w]);
  const fallbackWord = allWords.find(w => !G[w] && resolves(w));
  const optLetters = Object.keys(C.options || {});

  /* ---------- 1. 外链与首屏 ---------- */
  /* 词组内部的空格也带 .w（撑黄底用），它不是词，计数时要排掉。
     统计范围限定在句子的文本里：考试题选项行在正文里也渲染 .w（可查词），
     但它们不属于 passage.words 的口径。 */
  const wEls = [...passage.querySelectorAll(".sent-txt .w")];
  const realW = wEls.filter(e => String(e.dataset.w).trim() !== "");
  const gapW = wEls.length - realW.length;
  /* «…» 标记的备选词（③ 式二选一）渲染成按钮，不再是 .w —— 计数时扣掉。
     注意标记里可能是多词短语（don't need to = 3 个词），要按标记内的实际词数算。 */
  const pickW = C.passage.paragraphs.flat().reduce((a, s) => {
    const segs = String(s.s).split(/[«»]/);
    for (let i = 1; i < segs.length; i += 2) {
      a += (segs[i].match(/[A-Za-z]+(?:[’'\-][A-Za-z]+)*/g) || []).length;
    }
    return a;
  }, 0);
  /* data-w 保留原文大小写（句首是 "Last" 不是 "last"），按小写建索引来取元素 */
  const byWord = new Map();
  realW.forEach(e => {
    const k = String(e.dataset.w).toLowerCase();
    if (!byWord.has(k)) byWord.set(k, e);
  });
  const wordEl = w => byWord.get(String(w).toLowerCase());
  /* 标题与元信息：引擎读的字段名必须和 articles/*.json 的 schema 对上。
     曾经这里写成 C.passage.title，页面上就顶着一个大字 "undefined"，
     而 jsdom 那时根本没断言标题 —— 补上。 */
  const titleEl = passage.querySelector(".passage-title");
  ok(!!titleEl, `[${slug}] 有正文大标题 .passage-title`);
  ok(titleEl && titleEl.textContent.trim() === C.title,
    `[${slug}] 大标题是「${C.title}」，实际渲染「${titleEl && titleEl.textContent.trim()}」`);
  /* 只看可见文本：body.textContent 会把内联 <script> 里的引擎源码也算进来，
     而源码里当然有 undefined 这个词 —— 不过滤就是给自己报假警。 */
  const visibleText = [...doc.body.childNodes].length
    ? (() => {
        const c = doc.body.cloneNode(true);
        c.querySelectorAll("script, style").forEach(n => n.remove());
        return c.textContent;
      })()
    : "";
  const leak = visibleText.match(/[^\s]*undefined[^\s]*|\[object [A-Za-z]+\]/);
  ok(!leak, `[${slug}] 页面上没有 undefined / [object Object] 漏出来${leak ? "：" + leak[0] : ""}`);
  const metaEl = passage.querySelector(".passage-meta");
  ok(metaEl && metaEl.textContent.includes(C.label),
    `[${slug}] 元信息行带上出处「${C.label}」`);

  ok(realW.length > 0, `[${slug}] 单词 span 渲染出来了（${realW.length} 个 + 词组内空格 ${gapW} 个）`);
  ok(realW.length === C.passage.words - pickW,
    `[${slug}] 单词 span ${realW.length} 个 === 声明 ${C.passage.words} 词 − 内联选项词 ${pickW} 个（另有词组内空格 ${gapW} 个）`);
  ok(passage.querySelectorAll(".ph").length > 0, `[${slug}] 词组黄标 ${passage.querySelectorAll(".ph").length} 处`);
  ok(passage.querySelectorAll(".sent").length === N, `[${slug}] 句子 ${N} 个`);
  if (optLetters.length) {
    ok(passage.querySelectorAll(".blank").length === (C.questions || []).length,
      `[${slug}] 空位 ${passage.querySelectorAll(".blank").length} 个 === 题目 ${(C.questions || []).length} 道`);
  } else {
    ok(passage.querySelectorAll(".blank").length === 0,
      `[${slug}] Part 1 式：原文没有空位（${passage.querySelectorAll(".blank").length} 个）`);
  }

  /* 顶栏的「← 首页」按钮 + 段落角色/题号徽章 */
  ok(!!doc.querySelector('.topbar a[href="index.html"]'), `[${slug}] 顶栏有「← 首页」按钮`);
  const wantBadges = ((C.passage.blocks || []).filter(b => b && b.n)).length;
  ok(passage.querySelectorAll(".pbadge").length === wantBadges,
    `[${slug}] 题号徽章 ${passage.querySelectorAll(".pbadge").length} 个 === 声明 ${wantBadges} 个`);

  /* ---------- 2. 交替底色 ---------- */
  const sentEls = [...passage.querySelectorAll(".sent")];
  const altCount = sentEls.filter(s => s.classList.contains("alt")).length;
  ok(altCount === Math.ceil(N / 2), `[${slug}] ${N} 句里 ${altCount} 句带交替底色（应为 ${Math.ceil(N / 2)}）`);
  ok(sentEls[0].classList.contains("alt") && !sentEls[1].classList.contains("alt"),
    `[${slug}] 第 1 句有底色、第 2 句没有`);
  if (N > 2) ok(sentEls[2].classList.contains("alt"), `[${slug}] 第 3 句又有底色（循环）`);

  /* ---------- 3. 页边按钮 ---------- */
  ok(!!gutter, `[${slug}] 有页边容器 .pgutter`);
  const groups = [...gutter.querySelectorAll(".sbtns")];
  ok(groups.length === N, `[${slug}] 页边按钮组 ${groups.length} 组（每句一组）`);
  ok(groups.every(g => /^\d+-\d+$/.test(g.dataset.for)), `[${slug}] 每组都标了归属句子`);
  ok(groups.filter(g => g.querySelector("[data-say]")).length === N, `[${slug}] ${N} 个朗读按钮`);
  ok(!passage.querySelector(".sent .mini"), `[${slug}] 按钮不在句子内部（不打断连续排版）`);

  /* ---------- 3b. 目录列（左边那列题目表） ---------- */
  const tocCol = doc.getElementById("tocCol");
  const tglToc = doc.getElementById("tglToc");
  ok(!!tocCol && !!tglToc, `[${slug}] 目录列和「☰ 目录」按钮都在`);
  ok(!cols.classList.contains("toc-open"), `[${slug}] 目录默认收起`);
  const tocItems = [...doc.querySelectorAll(".toc-item")];
  ok(tocItems.length === allSlugs.length, `[${slug}] 目录列出全部 ${allSlugs.length} 篇`);
  const curItem = tocItems.filter(a => a.classList.contains("on"));
  ok(curItem.length === 1 && curItem[0].getAttribute("href") === slug + ".html",
    `[${slug}] 当前篇高亮，且高亮的是这一篇`);
  const nav0 = logs.filter(l => /navigation/i.test(l)).length;
  click(tglToc);
  ok(cols.classList.contains("toc-open") && tglToc.classList.contains("on"),
    `[${slug}] 点「☰ 目录」→ 展开（再点收起）`);
  click(doc.querySelector(".toc-item.on"));
  ok(!cols.classList.contains("toc-open"), `[${slug}] 点当前篇 → 目录收起`);
  ok(logs.filter(l => /navigation/i.test(l)).length === nav0, `[${slug}] 点当前篇不触发跳转`);
  click(tglToc);
  ok(cols.classList.contains("toc-open"), `[${slug}] 再点「☰ 目录」→ 又展开`);
  click(doc.getElementById("tocClose"));
  ok(!cols.classList.contains("toc-open"), `[${slug}] 目录自己的 ✕ 能收起`);

  /* ---------- 4. 逐字比对，防丢字 ---------- */
  const norm = s => s.replace(/\s+/g, " ").trim();
  const lost = [];
  C.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    const el = passage.querySelector(`[data-sent="${pi}-${si}"] .sent-txt`);
    if (!el) { lost.push(`${pi}-${si} 缺元素`); return; }
    /* «…» 是「句内二选一」的渲染标记（题④③ 那种），不属于文字本身 */
    const want = norm(s.s.replace(/\{(\d+)\}/g, "$1").replace(/[«»]/g, ""));
    const got = norm(el.textContent);
    if (want !== got) lost.push(`${pi}-${si}\n        期望: ${want.slice(0, 80)}\n        实际: ${got.slice(0, 80)}`);
  }));
  ok(lost.length === 0, `[${slug}] 全部 ${N} 句与源数据逐字一致`);
  lost.slice(0, 3).forEach(l => notes.push("      ✗ " + l));

  /* ---------- 5. 点词 → 小黑板 + 历史 ---------- */
  if (directWord && wordEl(directWord)) {
    click(wordEl(directWord));
    const e = G[directWord];
    ok(/词条/.test(ana.textContent), `[${slug}] 点「${directWord}」→ 小黑板出词条`);
    ok(ana.querySelector(".ana-sent").textContent.toLowerCase().includes(directWord.slice(0, 6)),
      `[${slug}] 词形显示正确`);
    if (e.ipa) ok(ana.textContent.includes(e.ipa), `[${slug}] 音标正确（${e.ipa}）`);
    ok(ana.querySelectorAll(".ana-spk").length > 0, `[${slug}] 面板顶部有发音按钮`);
    ok(hist.querySelectorAll(".hitem").length === 1, `[${slug}] 历史加了 1 行`);
    ok(hist.querySelector(".hitem.w .hbadge").textContent === "词", `[${slug}] 历史行徽标是「词」`);
  } else {
    notes.push(`      ! ${slug} 找不到可直接命中的词，跳过点词测试`);
  }

  /* ---------- 6. 屈折形式回退 ---------- */
  if (fallbackWord && wordEl(fallbackWord)) {
    const shown = wordEl(fallbackWord).dataset.w;   // 历史记的是原文大小写
    click(wordEl(fallbackWord));
    ok(!!ana.querySelector(".ana-sent"), `[${slug}] 屈折形式「${shown}」回退查到 ${resolves(fallbackWord)}`);
    ok(hist.querySelector(".hitem .hlabel").textContent === shown,
      `[${slug}] 历史里记的是原词形 ${shown}`);
  }

  /* ---------- 7. 词组里的单词仍可单独点 ---------- */
  const innerW = passage.querySelector(".ph .w");
  if (innerW) {
    const want = innerW.dataset.w;
    click(innerW);
    ok(ana.querySelector(".ana-sent").textContent.toLowerCase().trim().indexOf(want.slice(0, 8)) === 0
      || ana.textContent.indexOf("词条") >= 0,
      `[${slug}] 点到词组里的词，出的是单词「${want}」的词条而不是整个词组`);
    const entry = ana.querySelector("[data-word]");
    if (entry) {
      const ph = entry.dataset.word;
      click(entry);
      ok(ana.querySelector(".ana-sent").textContent.toLowerCase().includes(ph.toLowerCase()),
        `[${slug}] 通过入口进到词组「${ph}」`);
    }
  }

  /* 词组内部的空格也带 .w（撑黄底用），点它必须落到词组，
     不能当成一个词形去查 —— 那样会往历史里写一条 data-w=" " 的空行。
     这是实机验证时抓到的真 bug，留一条卡口守住。 */
  const gapEl = wEls.find(e => String(e.dataset.w).trim() === "");
  if (gapEl && gapEl.closest(".ph")) {
    const phKey = gapEl.closest(".ph").dataset.ph;
    const n0 = hist.querySelectorAll(".hitem").length;
    click(gapEl);
    ok(hist.querySelector(".hitem .hlabel").textContent === phKey,
      `[${slug}] 点词组内空格 → 落到词组「${phKey}」`);
    ok((hist.querySelector(".hitem .hlabel").textContent || "").trim() !== "",
      `[${slug}] 历史里不会出现空词形的行`);
    ok(hist.querySelectorAll(".hitem").length <= n0 + 1 && !!ana.querySelector(".ana-sent"),
      `[${slug}] 点空格不会刷出多条历史或空面板`);
  }

  /* ---------- 8. 点句子 ---------- */
  const s0 = passage.querySelector('.sent[data-sent="0-0"]');
  click(s0);
  ok(/句子分析/.test(ana.textContent), `[${slug}] 点句子 → 小黑板出讲解`);
  ok(ana.querySelectorAll(".part").length > 0, `[${slug}] 成分拆解卡片 ${ana.querySelectorAll(".part").length} 张`);
  ok(ana.querySelectorAll(".part .pname").length === ana.querySelectorAll(".part").length,
    `[${slug}] 每张卡片都有成分名`);
  /* 卡片底色不再由 JS 直接算色值，而是给一个 0→1 的档位 --pt，
     具体色值由 CSS 按主题令牌算 —— 暗色因此不用改一行 JS。
     所以这里验的是「档位互不相同」，不是「background 互不相同」。 */
  const parts = [...ana.querySelectorAll(".part")];
  const ranks = parts.map(p => p.style.getPropertyValue("--pt").trim());
  ok(ranks.every(r => r !== ""), `[${slug}] 每张卡片都带梯度档位 --pt`);
  ok(new Set(ranks).size === ranks.length, `[${slug}] 卡片档位互不相同（底色依次加深）`);
  ok(parts.every(p => /^var\(--part-ink-[ab]\)$/.test(p.style.color)),
    `[${slug}] 卡片字色走令牌（暗色才不必改 JS）`);
  ok(/翻译/.test(ana.textContent), `[${slug}] 有翻译板块`);
  ok(s0.classList.contains("cur"), `[${slug}] 该句高亮`);
  ok(gutter.querySelector('.sbtns[data-for="0-0"]').classList.contains("cur"),
    `[${slug}] 页边对应那组按钮也高亮`);

  /* ---------- 9. 每一句都能点讲（不只长难句） ---------- */
  if (N > 1) {
    /* 挑一句「普通句」来验证。注意启示：段落。拆分后 0-1 可能不存在或者是个碎片 ——
       优先 0-1，找不到就依次找非省略句、再退到任意一句。 */
    const sentByRef = el => {
      const p = el.dataset.sent.split("-").map(Number);
      return (C.passage.paragraphs[p[0]] || [])[p[1]];
    };
    const allSent = [...passage.querySelectorAll(".sent")];
    const easy = allSent.find(el => el.dataset.sent === "0-1") ||
      allSent.find(el => { const s = sentByRef(el); return s && s.ana && s.ana.pat && s.ana.pat[0] !== "省略句"; }) ||
      allSent[0];
    if (easy) {
      click(easy);
      ok(/句子分析/.test(ana.textContent), `[${slug}] 普通句也出讲解`);
      ok(ana.querySelectorAll(".part").length > 0, `[${slug}] 普通句也有成分拆解卡片`);
    }
  }

  /* ---------- 10. 句型 chip 全量定位（核心卡口） ---------- */
  const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语", "省略句"];
  /* 省略句（招牌/留言抬头/署名这类片段）没有可标注的成分映射，
     引擎会把它渲染成 static（不可点），这是设计如此，不算坑。 */
  const PAT_STATIC_OK = ["省略句"];
  const badPat = [];
  C.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    const pat = s.ana && s.ana.pat;
    if (!Array.isArray(pat) || !pat.length || MAIN_PAT.indexOf(pat[0]) < 0) badPat.push(`${pi}-${si}`);
  }));
  ok(badPat.length === 0, `[${slug}] ${N} 句的主句型全部在白名单内`);

  let chipTot = 0; const chipDead = [];
  for (let pi = 0; pi < C.passage.paragraphs.length; pi++) {
    for (let si = 0; si < C.passage.paragraphs[pi].length; si++) {
      click(passage.querySelector(`[data-sent="${pi}-${si}"]`));
      ana.querySelectorAll("button.chip.pat").forEach(c => {
        chipTot++;
        if (c.classList.contains("static") && !PAT_STATIC_OK.includes(c.dataset.pat)) {
          chipDead.push(`${pi}-${si}「${c.dataset.pat}」`);
        }
      });
    }
  }
  ok(chipDead.length === 0, `[${slug}] 正文 ${chipTot} 个句型 chip 全部可定位`);
  chipDead.slice(0, 5).forEach(d => notes.push("      ✗ 定位不到 " + d));

  /* ---------- 11. 句型 → 标红 ---------- */
  click(s0);
  const chips = [...ana.querySelectorAll("button.chip.pat")];
  const liveChip = chips.find(c => !c.classList.contains("static"));
  if (liveChip) {
    const box = ana.querySelector(".ana-sent");
    const rawText = box.textContent;
    click(liveChip);
    const hls = [...ana.querySelectorAll(".ana-sent .hl")];
    ok(hls.length > 0, `[${slug}] 点句型「${liveChip.dataset.pat}」标红 ${hls.length} 处`);
    ok(liveChip.classList.contains("on"), `[${slug}] 该 chip 变选中态`);
    ok(box.textContent === rawText, `[${slug}] 标红不改变原句文字（只加包裹）`);
    const sheet = [...doc.querySelectorAll("style")].map(s => s.textContent).join("");
    ok(/@keyframes hlpop/.test(sheet), `[${slug}] 样式表里有 hlpop 缩放关键帧`);
    ok(hls[0].classList.contains("reveal"), `[${slug}] 动画期间挂 .reveal（inline-block）`);
    click(liveChip);
    ok(ana.querySelectorAll(".ana-sent .hl").length === 0, `[${slug}] 再点一次清除标记`);
    ok(!liveChip.classList.contains("on"), `[${slug}] 选中态也清掉`);
    ok(box.textContent === rawText, `[${slug}] 清除后原句完好`);

    // 换句不残留
    click(liveChip);
    const other = passage.querySelector('.sent[data-sent="0-1"]') || passage.querySelector('.sent[data-sent="1-0"]');
    if (other) {
      click(other);
      ok(ana.querySelectorAll(".ana-sent .hl").length === 0, `[${slug}] 换一句后标记不残留`);
      ok(ana.querySelectorAll(".chip.pat.on").length === 0, `[${slug}] chip 选中态也不残留`);
    }
  }

  /* ---------- 12. 词组推导零漂移 ---------- */
  let drift = [];
  for (let pi = 0; pi < C.passage.paragraphs.length; pi++) {
    for (let si = 0; si < C.passage.paragraphs[pi].length; si++) {
      const el = passage.querySelector(`[data-sent="${pi}-${si}"]`);
      click(el);
      const fromAna = [...ana.querySelectorAll("[data-word]")].map(b => b.dataset.word).sort();
      const fromTxt = [...el.querySelectorAll(".ph")].map(p => p.dataset.ph).sort();
      if (JSON.stringify(fromAna) !== JSON.stringify(fromTxt)) {
        drift.push(`${pi}-${si} 分析=${JSON.stringify(fromAna)} 正文=${JSON.stringify(fromTxt)}`);
      }
    }
  }
  ok(drift.length === 0, `[${slug}] 逐句比对：推导词组 === 正文黄标词组`);
  drift.slice(0, 4).forEach(d => notes.push("      ✗ " + d));

  /* ---------- 13. 历史：去重 / 删除 / 持久化 ---------- */
  const LS_HIST = "pet:hist:v1:" + slug;
  const wRow = [...hist.querySelectorAll(".hitem.w")].pop();
  if (wRow) {
    const key = wRow.querySelector(".hlabel").textContent;
    const total = hist.querySelectorAll(".hitem").length;
    const back = passage.querySelector(`.w[data-w="${key}"]`);
    if (back) {
      click(back);
      ok(hist.querySelectorAll(".hitem").length === total, `[${slug}] 重复点击不新增行`);
      ok(hist.querySelector(".hitem .hlabel").textContent === key, `[${slug}] 重复点击把它提到最上面`);
    }
  }
  /* ---------- 13b. 收藏：每行一个 ☆，点了写进 pet:fav:v1 ---------- */
  const LS_FAV = "pet:fav:v1";
  const favs = () => JSON.parse(window.localStorage.getItem(LS_FAV) || "[]");
  /* 先点一个**确实能查到词条**的词（第一个 .w 可能是词组里的空格，
     拿它测收藏会测成「标识为空 → 按钮不动」那条分支，而不是收藏本身） */
  const favTarget = (directWord && wordEl(directWord)) || realW[0];
  click(favTarget);
  await tick();
  const fRow = hist.querySelector(".hitem.w");
  ok(!!fRow, `[${slug}] 历史里有词行，可测收藏`);
  if (fRow) {
    const fKey = fRow.querySelector(".hlabel").textContent;
    const star = fRow.querySelector(".hfav");
    ok(!!star, `[${slug}] 历史行右侧有收藏按钮 .hfav`);
    ok(star && star.textContent === "☆", `[${slug}] 未收藏时是空心 ☆`);
    /* 行内现在是三个平级 button（打开 / 收藏 / 删除）——
       button 不能嵌套 button，所以形状也得断言一下 */
    ok(fRow.querySelectorAll(":scope > button").length === 3,
      `[${slug}] 历史行内 3 个平级按钮（打开 / 收藏 / 删除）`);

    click(star);
    await tick();
    ok(favs().length === 1, `[${slug}] 点 ☆ → ${LS_FAV} 里 1 条（实际 ${favs().length}）`);
    ok(star.textContent === "★" && star.classList.contains("on"),
      `[${slug}] 点 ☆ → 变实心 ★ 且点亮`);
    ok(favs()[0] && favs()[0].type === "w", `[${slug}] 收藏条目的 type 是 w`);

    click(star);
    await tick();
    ok(favs().length === 0, `[${slug}] 再点一次取消收藏（toggle）`);
    ok(star.textContent === "☆" && !star.classList.contains("on"), `[${slug}] 取消后回到空心 ☆`);

    /* 存的是词典原形，不是点到的那个屈折形式 ——
       centuries 和 century 必须是同一条，否则同一个词会收出好几份 */
    if (fallbackWord && favs().length === 0) {
      click(wordEl(fallbackWord));
      await tick();
      const row = hist.querySelector(".hitem.w");
      if (row) {
        click(row.querySelector(".hfav"));
        await tick();
        const stored = favs()[0];
        ok(stored && stored.key === resolves(fallbackWord),
          `[${slug}] 收藏存的是词典原形「${resolves(fallbackWord)}」而不是「${fallbackWord}」`);
      }
    }
  }

  const cnt0 = hist.querySelectorAll(".hitem").length;
  if (cnt0 > 0) {
    click(hist.querySelector(".hitem .hdel"));
    ok(hist.querySelectorAll(".hitem").length === cnt0 - 1, `[${slug}] 删除按钮少一行`);
  }
  ok(!!window.localStorage.getItem(LS_HIST), `[${slug}] 历史写入 localStorage（键 ${LS_HIST}）`);

  /* ---------- 13c. 学到哪儿了（本机记录；以后换 Redis） ---------- */
  const LR = "pet:lastread:v1";
  /* 挑一句结构上确实存在的第二句（段落结构会变，别写死 ref） */
  const lrSent = [...passage.querySelectorAll(".sent")].find(el => {
    const p = el.dataset.sent.split("-").map(Number);
    return p[1] === 1 && (C.passage.paragraphs[p[0]] || []).length >= 2;
  }) || passage.querySelector(".sent");
  click(lrSent);
  await tick();
  const lrAll = JSON.parse(window.localStorage.getItem(LR) || "null");
  const lrMine = lrAll && lrAll[FAKE_USER.phone];
  ok(lrMine && lrMine.slug === slug, `[${slug}] 「学到哪儿了」记下当前篇`);
  ok(lrMine && lrMine.ref === lrSent.dataset.sent,
    `[${slug}] 点过的句子位置也记下了（${lrSent.dataset.sent}）`);

  /* ---------- 14. 题目页 ---------- */
  click(doc.querySelector('.tab[data-tab="quiz"]'));
  ok(doc.getElementById("passage").hidden, `[${slug}] 切到题目页 → 原文隐藏`);
  ok(!qList.hidden, `[${slug}] 题目显示`);
  ok(qList.querySelectorAll(".opt").length === optLetters.length,
    `[${slug}] 选项池 ${optLetters.length} 条`);
  ok(doc.querySelectorAll("[data-q]").length === (C.questions || []).length,
    `[${slug}] 题卡 ${(C.questions || []).length} 个`);

  const q0 = C.questions[0];
  if (q0) {
    click(qList.querySelector(`[data-qbtn="${q0.n}"]`));
    const box = qList.querySelector(`[data-q="${q0.n}"]`);
    ok(box && box.querySelector(".qbody").classList.contains("show"), `[${slug}] 第 ${q0.n} 题解析展开`);
    ok(box.querySelector(".letter").textContent === q0.answer, `[${slug}] 答案 = ${q0.answer}`);
    ok(/为什么选它/.test(box.textContent), `[${slug}] 有解题思路`);
    ok(/其他选项为什么不行/.test(box.textContent), `[${slug}] 有干扰项分析`);

    /* ---------- 14b. 我的答案 + 错题登记 ---------- */
    const row0 = qList.querySelector(`[data-arow="${q0.n}"]`);
    ok(!!row0, `[${slug}] 第 ${q0.n} 题有「我的答案」行`);
    /* 字母集合：Part 4/5/6 是共享池 A–H，Part 1 是每题自己的选项 */
    const ansLetters = optLetters.length ? optLetters : Object.keys(q0.opts || {});
    const card0 = qList.querySelector(`[data-q="${q0.n}"]`);
    ok(card0 && card0.querySelectorAll(".ansb").length === ansLetters.length,
      `[${slug}] 答案按钮 ${ansLetters.length} 个（${optLetters.length ? "A–H 小圆钮" : "整行选项"}）`);
    if (!optLetters.length) {
      const optRows = [...card0.querySelectorAll(".optrow .otxt")];
      ok(optRows.length === ansLetters.length && optRows.every(r => r.textContent.trim().length > 0),
        `[${slug}] Part 1 式：选项文本直接可见（${optRows.length} 行，非空）`);
    }

    const wrongL = ansLetters.find(L => L !== q0.answer);
    click(qList.querySelector(`[data-ansb="${q0.n}:${wrongL}"]`));
    await tick();
    ok(row0.classList.contains("bad"), `[${slug}] 选错 → 整行变红`);
    ok(/答错了/.test(row0.textContent) && row0.textContent.indexOf(q0.answer) >= 0,
      `[${slug}] 提示答错并给出正确答案 ${q0.answer}`);
    ok(qList.querySelector(`[data-q="${q0.n}"] .qbody`).classList.contains("show"),
      `[${slug}] 答错顺手把解析展开`);

    const mCall = api.calls.filter(c => c.method === "POST" && c.path === "/api/mistakes").pop();
    ok(!!mCall, `[${slug}] 错题已登记到后端（POST /api/mistakes）`);
    ok(mCall && mCall.body && mCall.body.slug === slug && mCall.body.q === q0.n &&
       mCall.body.chosen === wrongL && mCall.body.correct === q0.answer,
      `[${slug}] 登记体带全：篇 / 题号 / 我选的 / 正确答案`);

    /* 再点同一个错答案：不重复登记（prev === L） */
    const mCount = api.calls.filter(c => c.method === "POST" && c.path === "/api/mistakes").length;
    click(qList.querySelector(`[data-ansb="${q0.n}:${wrongL}"]`));
    await tick();
    ok(api.calls.filter(c => c.method === "POST" && c.path === "/api/mistakes").length === mCount,
      `[${slug}] 重复点同一个错答案不重复登记`);

    click(qList.querySelector(`[data-ansb="${q0.n}:${q0.answer}"]`));
    ok(row0.classList.contains("ok") && /答对了/.test(row0.textContent),
      `[${slug}] 改选正确答案 → 整行变绿`);
    ok(JSON.parse(window.localStorage.getItem("pet:ans:v1:" + slug) || "{}")[q0.n] === q0.answer,
      `[${slug}] 做过的答案落盘（刷新后还看得见）`);
  }

  /* ---------- 15. 选项里的词可点（Part 1 用展开的解析里的选项句） ---------- */
  const optW = qList.querySelector(".opt .w") || qList.querySelector(".qbody .w");
  if (optW) {
    click(optW);
    ok(/词条/.test(ana.textContent), `[${slug}] 点选项里的词也进小黑板`);
  }

  /* ---------- 15b. 正文内联作答（inlineQuiz：答题、解析都长在正文里） ---------- */
  if (C.inlineQuiz) {
    const qtab = doc.querySelector('.tab[data-tab="quiz"]');
    ok(qtab && qtab.hidden, `[${slug}] 内联作答的文章：题目分析 tab 收起来了`);
    click(doc.querySelector('.tab[data-tab="read"]'));
    await tick();

    /* 选项清单行首的字母徽章 */
    const badges = [...passage.querySelectorAll(".para.r-o .opletter")];
    ok(badges.length >= 5 && badges.every(b => b.textContent.trim().length === 1),
      `[${slug}] 选项清单行首有单字母徽章（${badges.length} 个）`);

    /* plain 区块：点词不查词（「一行一个解析」就够），点整行才出讲解 */
    const plainW = passage.querySelector(".para.plain .w");
    if (plainW) {
      const before = ana.textContent;
      click(plainW);
      ok(ana.textContent === before, `[${slug}] plain 区块里点词不查词`);
    }

    /* 「我的答案」横排：跟题目、可单选、判对错、与卡片同步 */
    const rows = [...passage.querySelectorAll(".pickrow[data-pickq]")];
    const optsInlineN = (C.passage.blocks || []).filter(b => b && b.optsInline).length;
    ok(rows.length > 0, `[${slug}] 正文里有答案横排 ${rows.length} 排`);
    ok(passage.querySelectorAll("[data-qexp2]").length === rows.length + optsInlineN,
      `[${slug}] 每排答案都带「解析」按钮（共 ${passage.querySelectorAll("[data-qexp2]").length} 个）`);
    const row101 = passage.querySelector('.pickrow[data-pickq="101"]');
    if (row101) {
      const chipB = row101.querySelector('[data-ansb="101:B"]');
      click(chipB);
      await tick();
      ok(chipB.classList.contains("on") && chipB.classList.contains("wrongpick"),
        `[${slug}] 点横排里的错选项 → 选中且变红`);
      const chipC = row101.querySelector('[data-ansb="101:C"]');
      click(chipC);
      await tick();
      ok(chipC.classList.contains("right") && !chipB.classList.contains("on"),
        `[${slug}] 改选正确选项 → 变绿，单选不并存`);
      const card101 = qList.querySelector('[data-ansb="101:C"]');
      ok(card101 && card101.classList.contains("right"),
        `[${slug}] 卡片里的同一题同步变绿`);
    }
    /* ② 答案区的行号 1–5 */
    const pn106 = passage.querySelector('.pickrow[data-pickq="106"] .pn');
    ok(pn106 && pn106.textContent.trim() === "1", `[${slug}] ② 答案区带行号（1 起）`);

    /* ③ 式内联二选一：句子里的备选词本身就是按钮 */
    const pws = [...passage.querySelectorAll(".pickword")];
    const pickPairs = C.passage.paragraphs.flat().reduce((a, s) =>
      a + (String(s.s).match(/«/g) || []).length, 0);
    ok(pws.length > 0 && pws.length === pickPairs,
      `[${slug}] ③ 式备选词按钮 ${pws.length} 个 === «» 标记 ${pickPairs} 个`);
    const pwA = passage.querySelector('[data-ansb="111:A"]');
    const pwB = passage.querySelector('[data-ansb="111:B"]');
    if (pwA && pwB) {
      click(pwB);
      await tick();
      ok(pwB.classList.contains("on") && !pwA.classList.contains("on"),
        `[${slug}] ③ 点右边的备选 → 只选中它（单选）`);
      click(pwA);
      await tick();
      ok(pwA.classList.contains("on") && pwA.classList.contains("right") && !pwB.classList.contains("on"),
        `[${slug}] ③ 改选左边（正确）→ 切换且变绿`);
    }

    /* ④ 每题下面都列着 must / have to / mustn't / don't have to */
    const row115 = passage.querySelector('.pickrow[data-pickq="115"]');
    ok(row115 && /must/.test(row115.textContent) && /have to/.test(row115.textContent),
      `[${slug}] ④ 每题下面列着单词选项`);

    /* 考试题：正文里的整行选项（点行=作答；行内「析」=这个选项的句子分析） */
    const lines = [...passage.querySelectorAll(".optline")];
    ok(lines.length > 0 && lines.length % 3 === 0, `[${slug}] 考试题选项整行 ${lines.length} 条`);
    const lineC1 = passage.querySelector('.optline[data-ansb="1:C"]');
    const lineA1 = passage.querySelector('.optline[data-ansb="1:A"]');
    if (lineC1 && lineA1) {
      click(lineC1);
      await tick();
      ok(lineC1.classList.contains("on") && lineC1.classList.contains("wrongpick"),
        `[${slug}] 考试题点整行错选项 → 选中且变红`);
      click(lineA1);
      await tick();
      ok(lineA1.classList.contains("right") && !lineC1.classList.contains("on"),
        `[${slug}] 改选正确选项 → 变绿`);
      click(lineC1.querySelector("[data-ana]"));
      ok(/句子分析/.test(ana.textContent),
        `[${slug}] 选项行里的「析」→ 这个选项的句子分析`);
      const lineB1 = passage.querySelector('.optline[data-ansb="1:B"]');
      const lw = lineB1 && lineB1.querySelector(".w");
      if (lw) {
        click(lw);
        ok(/词条/.test(ana.textContent), `[${slug}] 点选项里的词 → 查词`);
        ok(!lineB1.classList.contains("on"), `[${slug}] 点选项里的词不顺带作答`);
      }
    }

    /* 正文里的「解析」按钮 → 完整题目分析（每道题都有答案+解析） */
    click(passage.querySelector('[data-qexp2="1"]'));
    ok(/题目分析/.test(ana.textContent) && /解题思路/.test(ana.textContent),
      `[${slug}] 正文里的「解析」→ 完整题目分析`);
  }

  /* ---------- 16. 答题解析 ---------- */
  click(doc.querySelector('.tab[data-tab="read"]'));
  const used = new Set((C.questions || []).map(q => q.answer));
  const ansLetter = optLetters.find(L => used.has(L));
  const disLetter = optLetters.find(L => !used.has(L));
  if (ansLetter) {
    click(qRead.querySelector(`.opt[data-opt="${ansLetter}"] [data-qexp]`));
    ok(new RegExp("答题解析 · 选项 " + ansLetter).test(ana.textContent),
      `[${slug}] 选项 ${ansLetter} 显示答题解析`);
    ok(/它是第 \d+ 题的答案/.test(ana.textContent), `[${slug}] 指出它是第几题的答案`);
    ok(/线索词/.test(ana.textContent), `[${slug}] 有线索词板块`);
    ok(/做题方法/.test(ana.textContent), `[${slug}] 有做题方法板块`);
  }
  if (disLetter) {
    click(qRead.querySelector(`.opt[data-opt="${disLetter}"] [data-qexp]`));
    ok(/它不填任何空/.test(ana.textContent), `[${slug}] 选项 ${disLetter} 指出不填任何空`);
    ok(ana.textContent.replace(/\s+/g, " ").length > 60,
      `[${slug}] 干扰项 ${disLetter} 的解析非空（others 有覆盖）`);
  }

  /* 答题解析不写入历史 */
  window.confirm = () => true;
  click(doc.getElementById("btnClear"));
  ok(hist.querySelectorAll(".hitem").length === 0, `[${slug}] 历史已清空`);
  if (disLetter) click(qRead.querySelector(`.opt[data-opt="${disLetter}"] [data-qexp]`));
  ok(hist.querySelectorAll(".hitem").length === 0, `[${slug}] 点答题解析不产生历史行`);

  /* ---------- 17. 空面板全量扫描 ---------- */
  let scanned = 0; const blanks = [];
  const probe = el => {
    scanned++;
    click(el);
    const t = ana.textContent.replace(/\s+/g, " ").trim();
    if (!ana.querySelector(".ana-sent") || t.length < 12) {
      blanks.push(`${el.dataset.w || el.dataset.ph || "?"} → «${t.slice(0, 40)}»`);
    }
  };
  passage.querySelectorAll(".w").forEach(probe);
  passage.querySelectorAll(".ph").forEach(probe);
  qRead.querySelectorAll(".w").forEach(probe);
  ok(blanks.length === 0, `[${slug}] 扫描 ${scanned} 个可点元素，没有空词条`);
  blanks.slice(0, 5).forEach(b => notes.push("      ✗ 空面板 " + b));

  /* ---------- 18. 列显隐 + 历史浮层 ---------- */
  const colAna = doc.getElementById("colAna");
  const fl = doc.getElementById("histFloat");
  ok(!cols.classList.contains("hide-ana"), `[${slug}] 默认小黑板显示`);
  click(doc.getElementById("tglAna"));
  ok(cols.classList.contains("hide-ana"), `[${slug}] 收起小黑板 → hide-ana`);
  ok(window.getComputedStyle(colAna).display === "none", `[${slug}] 小黑板 display:none`);
  click(doc.querySelector('[data-collapse="ana"]'));
  ok(!cols.classList.contains("hide-ana"), `[${slug}] 列头 ✕ 展开小黑板`);
  ok(fl.hidden === true, `[${slug}] 历史浮层默认收起`);
  ok(window.getComputedStyle(fl).display === "none",
    `[${slug}] 浮层默认 display:none（守住 .hist-float[hidden] 规则）`);
  click(doc.getElementById("tglVocab"));
  ok(fl.hidden === false, `[${slug}] 点顶栏「历史」弹出浮层`);
  click(doc.getElementById("histClose"));
  ok(fl.hidden === true, `[${slug}] 点浮层自己的 ✕ 能关掉`);

  /* ---------- 19. 清空历史 ---------- */
  click(doc.querySelector('.tab[data-tab="read"]'));
  click(passage.querySelector(".w"));
  ok(hist.querySelectorAll(".hitem").length > 0, `[${slug}] 清空前有历史行`);
  click(doc.getElementById("btnClear"));
  ok(hist.querySelectorAll(".hitem").length === 0, `[${slug}] 清空后没有行`);
  ok(/🕘/.test(hist.textContent), `[${slug}] 显示空状态提示`);

  /* ---------- 20. 缩放 + 页边按钮定位 ---------- */
  const zr = doc.getElementById("zoomRange");
  const zlab = doc.getElementById("zoomLabel");
  ok(!!zr && !!zlab, `[${slug}] 顶栏有滑动条和读数`);
  ok(zr.min === "1" && zr.max === "5", `[${slug}] 范围 1x–5x`);
  ok(window.getComputedStyle(doc.documentElement).getPropertyValue("--zoom").trim() === "1",
    `[${slug}] --zoom 初始为 1`);
  zr.value = "3";
  zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  ok(doc.documentElement.style.getPropertyValue("--zoom") === "3", `[${slug}] 拖到 3x 生效`);
  ok(window.localStorage.getItem("pet:zoom:v1") === "3", `[${slug}] 缩放值落盘到跨篇共享键`);
  ok(JSON.parse(window.localStorage.getItem("pet:ui:v2") || "null") !== null,
    `[${slug}] 列显隐落盘到跨篇共享键`);

  /* 造假的 rect：每句比上一句低 30px —— jsdom 不做排版，不造假就永远早退 */
  const realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "passage") return { top: 0, height: 1000, bottom: 1000, left: 0, right: 800, width: 800, x: 0, y: 0 };
    if (this.classList && this.classList.contains("sent")) {
      const p = this.dataset.sent.split("-");
      const n = C.passage.paragraphs.slice(0, +p[0]).reduce((a, q) => a + q.length, 0) + (+p[1]);
      return { top: n * 30, height: 20, bottom: n * 30 + 20, left: 0, right: 0, width: 0, x: 0, y: 0 };
    }
    return realRect.call(this);
  };
  zr.value = "2"; zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  zr.value = "1"; zr.dispatchEvent(new window.Event("input", { bubbles: true }));

  const tops = [...gutter.querySelectorAll(".sbtns")].map(g => parseFloat(g.style.top)).filter(v => !isNaN(v));
  ok(tops.length === N, `[${slug}] 缩放来回后 ${N} 组页边按钮都拿到 top（实际 ${tops.length}）`);
  ok(tops[0] === 0 && tops[1] === 30, `[${slug}] 位置跟着句子走（第 1 组 ${tops[0]}，第 2 组 ${tops[1]}）`);
  let mono = true;
  for (let i = 1; i < tops.length; i++) if (tops[i] < tops[i - 1]) mono = false;
  ok(mono, `[${slug}] top 单调递增，放大再缩小后不会上下错乱`);
  let gapOK = true;
  for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] < 2) gapOK = false;
  ok(gapOK, `[${slug}] 相邻按钮至少隔 2px，没有叠在一起`);

  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "passage") return { top: 0, height: 1000, bottom: 1000, left: 0, right: 800, width: 800, x: 0, y: 0 };
    if (this.classList && this.classList.contains("sent"))
      return { top: 0, height: 20, bottom: 20, left: 0, right: 0, width: 0, x: 0, y: 0 };
    return realRect.call(this);
  };
  zr.value = "1.5"; zr.dispatchEvent(new window.Event("input", { bubbles: true }));
  const flat = [...gutter.querySelectorAll(".sbtns")].map(g => parseFloat(g.style.top));
  ok(flat[1] > flat[0], `[${slug}] 句子都在同一行时后一组自动下移让位（${flat[0]} → ${flat[1]}）`);
  window.Element.prototype.getBoundingClientRect = realRect;

  /* ---------- 21. CSS 不变量（与文章内容无关） ---------- */
  const css = [...doc.querySelectorAll("style")].map(s => s.textContent).join("");
  const m = css.match(/grid-template-columns:minmax\(0,([\d.]+)fr\)\s*minmax\(0,([\d.]+)fr\);[\s\S]{0,200}?hide-ana/);
  ok(!!m, `[${slug}] 找到两列网格定义`);
  if (m) ok(+m[1] === 1 && +m[2] === 1, `[${slug}] 原文 : 小黑板 = ${m[1]} : ${m[2]}（各占一半）`);
  ok(!/grid-template-columns:[^;]*1\.66fr/.test(css), `[${slug}] 旧的三列定义已移除`);
  ok(/\.sent\.peek/.test(css), `[${slug}] 有 .sent.peek 粉色高亮规则`);
  ok(/\.hist-float\{[^}]*font-size:calc\([^)]*var\(--zoom\)/.test(css) === false,
    `[${slug}] 历史浮层不参与缩放`);
  ok(/#col1\{font-size:calc\(17px \* var\(--zoom\)\)\}/.test(css), `[${slug}] 原文列字号随缩放走`);
  ok(/#colAna\{font-size:calc\(16px \* var\(--zoom\)\)\}/.test(css), `[${slug}] 小黑板字号随缩放走`);
  ok(/#passage\{position:relative;padding-right:calc\(58px \* var\(--zoom\)\)\}/.test(css),
    `[${slug}] 页边宽度一起缩放`);
  ok(doc.querySelector("#histFloat").parentElement === doc.body,
    `[${slug}] 历史浮层不在 .cols 网格里`);

  /* ---------- 21b. 再进来：直接高亮上次学到的那一行 ---------- */
  {
    const seeded = {};
    seeded["pet:lastread:v1"] = JSON.stringify({ [FAKE_USER.phone]: { slug: slug, ref: "2-0", ts: Date.now() } });
    const { dom: dom2, logs: logs2 } = await loadArticle(slug, { slug: slug + "/恢复进度", seed: seeded });
    const el2 = dom2.window.document.querySelector('.sent[data-sent="2-0"]');
    ok(el2 && el2.classList.contains("cur"), `[${slug}] 重新进来：上次读到的那句已高亮`);
    ok(logs2.filter(l => !/navigation/i.test(l)).length === 0, `[${slug}] 恢复进度没有别的 JS 报错`);
  }

  /* ---------- 22. 运行期无报错 ---------- */
  ok(logs.length === 0, `[${slug}] 运行期没有 JS 报错`);
  logs.slice(0, 3).forEach(l => notes.push("      ✗ " + l));

  if (notes.length) console.log(`\n  ${slug} 细节：\n` + notes.join("\n"));
  return { slug, checks: nPass };
}

/* ============================================================
   首页（个性化主页 + 登录弹框）
   ============================================================ */
async function testHomePage() {
  const S = "index";

  /* ---- 未登录：显示「请先登录哦」、入口淡化锁住、点入口弹登录框 ---- */
  {
    const { dom, logs } = await loadPage("index.html", { expectScripts: 4, slug: S, seed: { __user: false } });
    const { window } = dom, doc = window.document;
    const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    ok(logs.filter(l => /navigation/i.test(l)).length === 0, `[${S}] 首页是公开的：未登录也不跳转`);
    const ask = doc.getElementById("homeAsk");
    ok(!ask.hidden && /请先登录哦/.test(ask.textContent), `[${S}] 未登录显示「请先登录哦」`);
    ok(doc.getElementById("avatar").classList.contains("off"), `[${S}] 圆圈（未登录）是灰的`);
    ok(doc.querySelectorAll("#tilesMain .tile").length === 6,
      `[${S}] 六个学习入口（实际 ${doc.querySelectorAll("#tilesMain .tile").length}）`);
    const labs = [...doc.querySelectorAll(".tile-lab")].map(x => x.textContent.trim());
    ["我的词书", "PET 阅读理解", "PET 口语", "PET 听力", "PET 写作", "错题记录", "数学补习", "语文补习"]
      .forEach(t => ok(labs.some(l => l.indexOf(t) >= 0), `[${S}] 入口里有「${t}」`));
    ok(doc.querySelectorAll(".home-sec-t").length === 1 && /今天的作业/.test(doc.querySelector(".home-sec-t").textContent),
      `[${S}] 第二部分有标题「今天的作业」`);
    ok(doc.querySelectorAll(".home-hr").length === 1, `[${S}] 两部分用横线划开`);
    ok(doc.getElementById("homeMain").classList.contains("locked"), `[${S}] 未登录时入口处于锁定（淡化）态`);
    ok(/\.html$/.test(doc.getElementById("tileRead").getAttribute("href") || ""),
      `[${S}] 阅读理解入口指向一篇文章`);

    /* 点入口 → 弹登录框（不打网络，也不跳） */
    click(doc.getElementById("tileRead"));
    ok(doc.getElementById("uModal").hidden === false, `[${S}] 未登录点入口 → 弹登录框`);
    ok(!!doc.getElementById("umPhone") && !!doc.getElementById("umPass"), `[${S}] 弹框有手机号和密码输入`);
    ok(doc.getElementById("umReg").hidden === true, `[${S}] 登录模式不显示昵称字段`);
    click(doc.querySelector('.um-tab[data-mode="reg"]'));
    ok(doc.getElementById("umReg").hidden === false, `[${S}] 切到注册 → 出现昵称字段`);
    ok(/注册/.test(doc.getElementById("umBtn").textContent), `[${S}] 按钮文案跟着变成「注册」`);

    /* 密码太短：本地拦住，不打网络 */
    doc.getElementById("umPhone").value = "13800138000";
    doc.getElementById("umNick").value = "小红";
    doc.getElementById("umPass").value = "123";
    doc.getElementById("umForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    ok(!doc.getElementById("umErr").hidden && /密码/.test(doc.getElementById("umErr").textContent),
      `[${S}] 密码太短 → 就地报错（实际「${doc.getElementById("umErr").textContent}」）`);
    ok(window.localStorage.getItem("pet:user:v1") === null, `[${S}] 注册失败不写登录态`);

    /* 手机号输入框自动剥非数字 */
    const phInput = doc.getElementById("umPhone");
    phInput.value = "138 0013-8000";
    phInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    ok(phInput.value === "13800138000", `[${S}] 手机号输入自动剥掉非数字（实际「${phInput.value}」）`);

    ok(logs.filter(l => !/navigation/i.test(l)).length === 0, `[${S}] 未登录流程没有别的 JS 报错`);
  }

  /* ---- 未登录 + ?login=1（被门禁弹回来）：自动弹框；假后端跑通注册 → 进个性化首页 ---- */
  {
    const api = fakeFetch({
      "POST /api/register": { j: { ok: true, completed: false,
        user: { phone: "13800138000", nickname: "小红", level: 1, color: "#3171d8" } } }
    });
    const { dom, logs } = await loadPage("index.html", {
      expectScripts: 4, slug: S + "/?login=1", query: "?login=1", seed: { __user: false }, fetch: api
    });
    const { window } = dom, doc = window.document;
    await tick();
    ok(doc.getElementById("uModal").hidden === false, `[${S}] ?login=1 → 自动打开登录框（门禁弹回的场景）`);
    doc.querySelector('.um-tab[data-mode="reg"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    doc.getElementById("umPhone").value = "13800138000";
    doc.getElementById("umNick").value = "小红";
    doc.getElementById("umPass").value = "secret123";
    doc.getElementById("umForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick(); await tick(); await tick();
    const u = JSON.parse(window.localStorage.getItem("pet:user:v1") || "null");
    ok(u && u.phone === "13800138000" && u.nickname === "小红", `[${S}] 注册成功：登录态落盘（带昵称/等级）`);
    ok(api.calls.some(c => c.path === "/api/register" && c.body && c.body.password === "secret123"),
      `[${S}] 注册打的是 /api/register 且带上密码`);
    ok(doc.getElementById("uModal").hidden === true, `[${S}] 成功后弹框关闭`);
    ok(doc.getElementById("homeAsk").hidden === true, `[${S}] 首页切到个性化（提示块收起）`);
    ok(!doc.getElementById("homeMain").classList.contains("locked"), `[${S}] 入口解锁`);
    const av = doc.getElementById("avatar");
    ok(av.classList.contains("on") && !!av.style.background,
      `[${S}] 圆圈按等级上色（实际「${av.style.background}」）`);
    ok(av.textContent.indexOf("小") >= 0, `[${S}] 圆圈里是昵称首字`);
    ok(logs.filter(l => !/navigation/i.test(l)).length === 0, `[${S}] 注册流程没有别的 JS 报错`);
  }

  /* ---- 已登录：圆圈上色、菜单可退出；阅读理解指向上次学过的篇 ---- */
  {
    const { dom, logs } = await loadPage("index.html", {
      expectScripts: 4, slug: S + "/已登录",
      seed: { "pet:lastread:v1": JSON.stringify({ [FAKE_USER.phone]: { slug: allSlugs[0], ref: "", ts: Date.now() } }) }
    });
    const { window } = dom, doc = window.document;
    const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick();
    ok(logs.filter(l => /navigation/i.test(l)).length === 0, `[${S}] 已登录正常渲染，不跳`);
    ok(doc.getElementById("homeAsk").hidden, `[${S}] 已登录不显示「请先登录哦」`);
    const av = doc.getElementById("avatar");
    ok(av.classList.contains("on") && !av.classList.contains("off"), `[${S}] 圆圈是登录态（按等级上色）`);
    ok((av.title || "").indexOf("小明") >= 0, `[${S}] 圆圈提示带昵称（实际「${av.title}」）`);
    ok(doc.getElementById("tileRead").getAttribute("href") === allSlugs[0] + ".html",
      `[${S}] 阅读理解入口指向上次学过的那篇`);
    click(av);
    ok(doc.getElementById("uMenu").hidden === false, `[${S}] 点圆圈弹头像菜单`);
    ok(doc.getElementById("uMenu").textContent.indexOf("小明") >= 0, `[${S}] 菜单显示昵称`);
    ok(/等级\s*3/.test(doc.getElementById("uMenu").textContent), `[${S}] 菜单显示等级 3`);
    click(doc.getElementById("uOut"));
    await tick(); await tick();
    ok(window.localStorage.getItem("pet:user:v1") === null, `[${S}] 点退出 → 登录态清掉`);
    ok(logs.filter(l => !/navigation/i.test(l)).length === 0,
      `[${S}] 全程没有 JS 报错（退出时的跳转除外）`);
  }

  /* ---- 登录态过期（超过 14 天）→ 当未登录处理 ---- */
  {
    const { dom } = await loadPage("index.html", {
      expectScripts: 4, slug: S + "/过期",
      seed: { __user: { phone: "13800138000", ts: Date.now() - 15 * 24 * 3600 * 1000 } }
    });
    await tick();
    const doc = dom.window.document;
    ok(!doc.getElementById("homeAsk").hidden, `[${S}] 登录态超过 14 天 → 回到「请先登录哦」`);
  }

  /* ---- 主题：防闪烁属性 + 三态按钮 ---- */
  {
    const { dom } = await loadPage("index.html", {
      expectScripts: 4, slug: S + "/暗色", seed: { "pet:theme:v1": "\"dark\"" }
    });
    const { window } = dom, doc = window.document;
    const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    ok(doc.documentElement.getAttribute("data-theme") === "dark",
      `[${S}] 存了暗色 → 内联脚本直接写 data-theme=dark（不闪白）`);
    const tb = doc.getElementById("tglTheme");
    ok(!!tb, `[${S}] 有主题切换按钮`);
    click(tb);
    await tick();
    ok(doc.documentElement.getAttribute("data-theme") === "light",
      `[${S}] 点一下：dark → auto（系统不是暗色 → 解析为亮）`);
    ok(JSON.parse(window.localStorage.getItem("pet:theme:v1")) === "auto", `[${S}] 主题落盘`);
  }

  /* ---- 存储不可用（file:// / 隐私模式）：门禁放行，入口直接可点 ---- */
  {
    const { dom, logs } = await loadPage("index.html", { expectScripts: 4, slug: S + "/无存储", noStorage: true });
    const { window } = dom, doc = window.document;
    const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    ok(!doc.getElementById("homeMain").classList.contains("locked"),
      `[${S}] 存储不可用：入口不加锁（门禁本身就是放行的）`);
    click(doc.getElementById("tileRead"));
    await tick();
    ok(logs.some(l => /navigation/i.test(l)), `[${S}] 存储不可用时点入口直接进文章`);
    ok(doc.getElementById("uModal").hidden === true, `[${S}] 也不会被弹登录框拦住`);
  }
}

/* ============================================================
   错题记录页 + 我的词书页
   ============================================================ */
async function testListPages() {
  const item = { slug: allSlugs[0], q: 16, chosen: "B", correct: "C", count: 2, ts: 1700000000000 };

  /* ---- 错题记录：列表 / 篇名映射 / 去订正链接 ---- */
  {
    const api = fakeFetch({ "GET /api/mistakes": { j: { ok: true, items: [item] } } });
    const { dom, logs } = await loadPage("mistakes.html", { expectScripts: 5, slug: "mistakes", fetch: api });
    const doc = dom.window.document;
    await tick();
    ok(logs.filter(l => /navigation/i.test(l)).length === 0, "[mistakes] 已登录正常渲染，不跳");
    ok(api.calls.some(c => c.method === "GET" && c.path === "/api/mistakes"),
      "[mistakes] 现拉 /api/mistakes（本机不缓存）");
    const rows = doc.querySelectorAll(".mrow");
    ok(rows.length === 1, "[mistakes] 错题列表 1 行");
    const txt = rows[0] ? rows[0].textContent : "";
    ok(/第\s*16\s*题/.test(txt) && txt.indexOf("B") >= 0 && txt.indexOf("C") >= 0 && /错过\s*2\s*次/.test(txt),
      `[mistakes] 行里有题号 / 我选的 / 正确答案 / 错过次数（实际「${txt.replace(/\s+/g, " ")}」）`);
    ok(rows[0] && rows[0].querySelector(".mrow-t").textContent.trim() !== allSlugs[0],
      '[mistakes] 篇名来自目录数据（不是 slug 原文）');
    ok(rows[0] && rows[0].querySelector("a").getAttribute("href") === allSlugs[0] + ".html?q=16",
      "[mistakes] 「去订正」链到那篇的那道题");
    ok(!doc.getElementById("who").hidden && /小明/.test(doc.getElementById("who").textContent),
      "[mistakes] 顶栏显示登录的人（昵称角标）");
  }

  /* ---- 错题为空：给去首页的引导 ---- */
  {
    const api = fakeFetch({ "GET /api/mistakes": { j: { ok: true, items: [] } } });
    const { dom } = await loadPage("mistakes.html", { expectScripts: 5, slug: "mistakes/空", fetch: api });
    await tick();
    ok(/还没有错题记录/.test(dom.window.document.body.textContent), "[mistakes] 空状态有提示");
  }

  /* ---- 未登录访问错题页 → 门禁弹回首页（带 login=1） ---- */
  {
    const { logs } = await loadPage("mistakes.html", { expectScripts: 5, slug: "mistakes/未登录", seed: { __user: false } });
    ok(logs.some(l => /navigation/i.test(l)), "[mistakes] 未登录 → 被门禁拦下");
  }

  /* ---- 我的词书：单词 + 句子两段；点开有详情 ---- */
  {
    const api = fakeFetch({ "GET /api/favs": { j: { ok: true, items: [
      { type: "w", key: "century", cn: "世纪", pos: "n.", ipa: "/ˈsentʃəri/",
        ex: "This century was hard.", exTr: "这个世纪很难。", ph: "the twentieth century", ts: 1 },
      { type: "s", key: "Hello there.", cn: "你好", ts: 2,
        ana: { pat: ["主系表"], frame: "主干：<b>Hello there</b>", parts: [["主语", "Hello"]], tip: "打招呼的说法" } }
    ] } } });
    const { dom } = await loadPage("words.html", { expectScripts: 5, slug: "words", fetch: api });
    const doc = dom.window.document;
    const click = el => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await tick();
    ok(doc.querySelectorAll(".wrow").length === 2, "[words] 单词 + 句子各一行");
    ok(/century/.test(doc.body.textContent) && /世纪/.test(doc.body.textContent), "[words] 单词行有词和释义");
    ok(/Hello there\./.test(doc.body.textContent) && /你好/.test(doc.body.textContent), "[words] 句子行有原文和翻译");

    /* 点单词行 → 详情展开：音标 / 词性 / 例句(连翻译) / 搭配 / 喇叭 */
    const wrow = doc.querySelector('.wentry[data-kind="w"] .wrow');
    click(wrow);
    await tick();
    const wdet = doc.querySelector('.wentry[data-kind="w"] .wdetail');
    ok(wdet && !wdet.hidden, "[words] 点单词行 → 详情展开");
    ok(/ˈsentʃəri/.test(wdet.textContent) && /n\./.test(wdet.textContent), "[words] 详情有音标和词性");
    ok(/This century was hard\./.test(wdet.textContent) && /这个世纪很难/.test(wdet.textContent),
      "[words] 详情有例句和它的翻译");
    ok(/the twentieth century/.test(wdet.textContent), "[words] 详情有搭配");
    ok(wdet.querySelectorAll(".wd-spk").length >= 2, "[words] 词和例句都有喇叭");

    /* 点句子行 → 句子详情展开、单词详情自动收起 */
    const srow = doc.querySelector('.wentry[data-kind="s"] .wrow');
    click(srow);
    await tick();
    const sdet = doc.querySelector('.wentry[data-kind="s"] .wdetail');
    ok(sdet && !sdet.hidden, "[words] 点句子行 → 详情展开");
    ok(/主系表/.test(sdet.textContent) && /打招呼/.test(sdet.textContent),
      "[words] 句子详情有句型和提示（来自分析字段）");
    ok(wdet.hidden, "[words] 打开新一条时旧的自动收起");

    /* 再点自己 → 收起 */
    click(srow);
    await tick();
    ok(sdet.hidden, "[words] 再点一次 → 详情收起");
  }

  /* ---- 我的词书为空：引导去收藏 ---- */
  {
    const api = fakeFetch({ "GET /api/favs": { j: { ok: true, items: [] } } });
    const { dom } = await loadPage("words.html", { expectScripts: 5, slug: "words/空", fetch: api });
    await tick();
    ok(/词书还是空的/.test(dom.window.document.body.textContent), "[words] 空状态有提示");
  }
}

/* ============================================================
   门禁：文章页未登录 → 弹回首页登录框；存储不可用 → 放行
   ============================================================ */
async function testGates() {
  const slug = allSlugs[0];
  {
    const { dom, logs } = await loadArticle(slug, { slug: "gate/" + slug, seed: { __user: false } });
    ok(logs.some(l => /navigation/i.test(l)), "[gate] 未登录访问文章 → 被门禁弹走");
    ok(!dom.window.document.querySelector("#passage .sent"), "[gate] 弹走时不渲染正文");
  }
  {
    const { dom, logs } = await loadArticle(slug, { slug: "gate/无存储", noStorage: true });
    ok(logs.filter(l => /navigation/i.test(l)).length === 0,
      "[gate] 存储不可用 → 放行，不跳转（file:// 不被锁死）");
    ok(dom.window.document.querySelectorAll("#passage .sent").length > 0, "[gate] 放行后正文正常渲染");
  }
}

/* ============================================================
   跑
   ============================================================ */
console.log("冒烟测试 " + targets.length + " 篇 + 首页 + 错题页 + 词书页…\n");
let firstErr = null;
const suites = [...targets.map(s => [s, () => testArticle(s)]),
                ["index.html", testHomePage],
                ["mistakes.html + words.html", testListPages],
                ["门禁", testGates]];
for (const [name, fn] of suites) {
  try {
    await fn();
  } catch (e) {
    firstErr = firstErr || e;
    fail(`[${name}] 中断：${e.message}\n      ${(e.stack || "").split("\n").slice(1, 3).join("\n      ")}`);
  }
}

console.log("\n" + (nFail === 0 ? "★ 全部通过" : "★ " + nFail + " 项失败") +
  "  ——  通过 " + nPass + " / 失败 " + nFail);
if (failures.length) {
  console.log("\n失败清单：");
  failures.forEach(f => console.log("  ✗ " + f));
}
process.exit(nFail === 0 ? 0 : 1);
