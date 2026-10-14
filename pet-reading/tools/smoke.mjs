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
   110 条断言全军覆没 —— 这是加门禁时最容易漏掉的一处回归。 */
const FAKE_USER = { phone: "13800138000", ts: 1700000000000 };

/* ============================================================
   载入一个页面：外链改内联
   expectScripts：这类页面总共该有几个 <script>（含内联的）。
     血泪坑 #18 的回归卡口 —— 内容或引擎里出现 $& 之类被当成反向引用时，
     这里会立刻炸出多余的标签。各类页面的数量不同，所以按页面传。
   ============================================================ */
function loadPage(file, { expectScripts, slug = file, seed = null, query = "", noStorage = false } = {}) {
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

const loadArticle = slug => loadPage(slug + ".html", { expectScripts: 5, slug });
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
  const { dom, logs } = await loadArticle(slug);
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
  /* 词组内部的空格也带 .w（撑黄底用），它不是词，计数时要排掉 */
  const wEls = [...passage.querySelectorAll(".w")];
  const realW = wEls.filter(e => String(e.dataset.w).trim() !== "");
  const gapW = wEls.length - realW.length;
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
  ok(realW.length === C.passage.words,
    `[${slug}] 单词 span ${realW.length} 个 === 声明 ${C.passage.words} 词（另有词组内空格 ${gapW} 个）`);
  ok(passage.querySelectorAll(".ph").length > 0, `[${slug}] 词组黄标 ${passage.querySelectorAll(".ph").length} 处`);
  ok(passage.querySelectorAll(".sent").length === N, `[${slug}] 句子 ${N} 个`);
  ok(passage.querySelectorAll(".blank").length === (C.questions || []).length,
    `[${slug}] 空位 ${passage.querySelectorAll(".blank").length} 个 === 题目 ${(C.questions || []).length} 道`);

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

  /* ---------- 4. 逐字比对，防丢字 ---------- */
  const norm = s => s.replace(/\s+/g, " ").trim();
  const lost = [];
  C.passage.paragraphs.forEach((p, pi) => p.forEach((s, si) => {
    const el = passage.querySelector(`[data-sent="${pi}-${si}"] .sent-txt`);
    if (!el) { lost.push(`${pi}-${si} 缺元素`); return; }
    const want = norm(s.s.replace(/\{(\d+)\}/g, "$1"));
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
    const easy = passage.querySelector('.sent[data-sent="0-1"]');
    click(easy);
    ok(/句子分析/.test(ana.textContent), `[${slug}] 普通句也出讲解`);
    ok(ana.querySelectorAll(".part").length > 0, `[${slug}] 普通句也有成分拆解卡片`);
  }

  /* ---------- 10. 句型 chip 全量定位（核心卡口） ---------- */
  const MAIN_PAT = ["主谓宾", "主系表", "主谓双宾", "主谓", "倒装引语"];
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
        if (c.classList.contains("static")) chipDead.push(`${pi}-${si}「${c.dataset.pat}」`);
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
  }

  /* ---------- 15. 选项里的词可点 ---------- */
  const optW = qList.querySelector(".opt .w");
  if (optW) {
    click(optW);
    ok(/词条/.test(ana.textContent), `[${slug}] 点选项里的词也进小黑板`);
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

  /* ---------- 22. 运行期无报错 ---------- */
  ok(logs.length === 0, `[${slug}] 运行期没有 JS 报错`);
  logs.slice(0, 3).forEach(l => notes.push("      ✗ " + l));

  if (notes.length) console.log(`\n  ${slug} 细节：\n` + notes.join("\n"));
  return { slug, checks: nPass };
}

/* ============================================================
   登录页
   ============================================================ */
async function testLoginPage() {
  const S = "login";
  /* 未登录进来：表单在、错误态空 */
  {
    const { dom, logs } = await loadPage("login.html", { expectScripts: 3, slug: S, seed: { __user: false } });
    const { window } = dom, doc = window.document;
    const input = doc.getElementById("phone");
    const err = doc.getElementById("loginErr");
    const form = doc.getElementById("loginForm");
    const click = el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const submit = () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

    ok(!!input && !!form, `[${S}] 有手机号输入框和表单`);
    ok(err.hidden, `[${S}] 一进来没有错误提示`);
    /* 占位符没替换干净的话，这里是一段 HTML 注释 —— 页面照常渲染，标题静默消失。
       曾经真的这么空掉过一次（站点名在模板里出现两次，只替了第一处）。
       build.mjs 那边也拦一道，这里再验一次「看得见的结果」。 */
    ok(doc.querySelector(".login-title").textContent.trim().length > 0,
      `[${S}] 卡片大标题不是空的（实际「${doc.querySelector(".login-title").textContent}」）`);
    ok(/^PET/.test(doc.querySelector(".login-title").textContent.trim()),
      `[${S}] 大标题是站点名`);
    ok(/登录/.test(doc.title) && /PET/.test(doc.title), `[${S}] <title> 也是站点名（实际「${doc.title}」）`);
    ok(!window.PET_CONTENT, `[${S}] 登录页不加载内容数据（也不该加载 app.js）`);
    ok(!!window.PETStore, `[${S}] 登录页加载了 store.js`);

    /* 主题按钮由 store.js 驱动，登录页也要能切 —— 否则学生一进来是暗的却关不掉 */
    const tb = doc.getElementById("tglTheme");
    ok(!!tb, `[${S}] 有主题切换按钮`);
    if (tb) {
      click(tb);
      await tick();
      ok(doc.documentElement.getAttribute("data-theme") === "light",
        `[${S}] auto 下点一下 → 亮色（jsdom 无 matchMedia，系统视为亮）`);
      click(tb);
      await tick();
      ok(doc.documentElement.getAttribute("data-theme") === "dark", `[${S}] 再点一下 → 暗色`);
      ok(JSON.parse(window.localStorage.getItem("pet:theme:v1")) === "dark",
        `[${S}] 主题落盘到 pet:theme:v1`);
      ok(doc.querySelector('meta[name="theme-color"]').getAttribute("content") === "#12151b",
        `[${S}] theme-color 跟着变（手机地址栏颜色）`);
    }

    /* 号码不合法：报错、不写存储、不跳转 */
    input.value = "123";
    submit();
    await tick();
    ok(!err.hidden && /11 位/.test(err.textContent), `[${S}] 号码不合法 → 提示 11 位手机号`);
    ok(window.localStorage.getItem("pet:user:v1") === null, `[${S}] 校验不过不写登录态`);
    ok(logs.filter(l => /navigation/i.test(l)).length === 0, `[${S}] 校验不过不跳转`);

    /* 输入框会自动洗掉非数字（粘贴、输入法都可能塞进别的东西） */
    input.value = "138 0013-8000";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    ok(input.value === "13800138000", `[${S}] 输入时自动剥掉非数字（实际「${input.value}」）`);

    /* 合法号码：写登录态 + 跳走 */
    input.value = "13800138000";
    submit();
    await tick();
    const u = JSON.parse(window.localStorage.getItem("pet:user:v1") || "null");
    ok(u && u.phone === "13800138000", `[${S}] 合法号码写入 pet:user:v1`);
    ok(logs.some(l => /navigation/i.test(l)), `[${S}] 登录成功 → 跳转（jsdom 只报「未实现」）`);
    ok(err.hidden, `[${S}] 成功后错误提示收起`);
    ok(logs.filter(l => !/navigation/i.test(l)).length === 0, `[${S}] 运行期没有别的 JS 报错`);
  }

  /* 已登录再进登录页 → 直接放行，不再要求填一遍 */
  {
    const { dom, logs } = await loadPage("login.html", { expectScripts: 3, slug: S + "/已登录" });
    ok(logs.some(l => /navigation/i.test(l)), `[${S}] 已登录进登录页 → 直接跳走`);
  }

  /* next 是这个页面的唯一入口参数，也是唯一的开放重定向风险点。
     逐条断言：站外的必须被丢掉，站内的必须原样保留。 */
  {
    const { dom } = await loadPage("login.html", {
      expectScripts: 3, slug: S + "/next", query: "?next=https%3A%2F%2Fevil.example%2Fx"
    });
    ok(dom.window.document.getElementById("backLink").href === "http://localhost/index.html",
      `[${S}] 站外 next 被丢掉，回落到目录页（开放重定向防线）`);
  }
  {
    const { dom } = await loadPage("login.html", {
      expectScripts: 3, slug: S + "/next2", query: "?next=t1-p4-digging-into-the-past.html"
    });
    ok(/t1-p4-digging-into-the-past\.html$/.test(dom.window.document.getElementById("backLink").href),
      `[${S}] 站内 next 原样保留（登录后回到原来那篇）`);
  }

  /* 存储不可用（无痕 / file://）时登录页不能把人卡死：
     存不住也得放行，只是要明说「这次登录只在本次会话有效」。
     否则用户面对的是一个按了没反应的登录页，还永远出不去。 */
  {
    const { dom, logs } = await loadPage("login.html", { expectScripts: 3, slug: S + "/无存储", noStorage: true });
    const doc = dom.window.document;
    ok(!!doc.getElementById("phone"), `[${S}] 存储抛异常时页面照常渲染`);
    doc.getElementById("phone").value = "13800138000";
    doc.getElementById("loginForm").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    const navigated = logs.some(l => /navigation/i.test(l));
    ok(navigated, `[${S}] 存储不可用也照样放行（不把人卡在登录页）`);
    ok(!doc.getElementById("loginBtn").disabled || navigated,
      `[${S}] 不会出现「按钮禁用 + 不跳转」这种死局`);
    ok(/只在本次会话有效/.test(doc.getElementById("loginNote").textContent),
      `[${S}] 且明确告诉用户这台设备记不住（不假装成功）`);
    ok(logs.filter(l => !/navigation/i.test(l)).length === 0,
      `[${S}] 无存储时也没有别的 JS 报错`);
  }
}

/* ============================================================
   目录页门禁
   ============================================================ */
async function testIndexGate() {
  const S = "index";
  {
    const { dom, logs } = await loadPage("index.html", { expectScripts: 4, slug: S, seed: { __user: false } });
    ok(logs.some(l => /navigation/i.test(l)), `[${S}] 未登录访问目录页 → 被门禁拦下跳转`);
    ok(dom.window.document.getElementById("who").hidden, `[${S}] 没登录就不显示手机号`);
  }
  {
    const { dom, logs } = await loadPage("index.html", { expectScripts: 4, slug: S + "/已登录" });
    const doc = dom.window.document;
    ok(!logs.some(l => /navigation/i.test(l)), `[${S}] 已登录访问目录页 → 正常渲染，不跳`);
    const who = doc.getElementById("who");
    ok(!who.hidden, `[${S}] 顶栏显示手机号角标`);
    ok(who.textContent.includes("138****8000"),
      `[${S}] 手机号是脱敏的（实际「${who.textContent.trim()}」）`);
    ok(!!who.querySelector(".who-out"), `[${S}] 角标带「退出」按钮`);
    ok(doc.querySelectorAll(".book a").length === allSlugs.length,
      `[${S}] 目录列出全部 ${allSlugs.length} 篇`);
    ok(doc.documentElement.getAttribute("data-theme") === "light",
      `[${S}] 主题属性已由内联脚本写上（防闪烁那一环）`);
  }
  /* 主题独立于门禁：存储里存了暗色，属性就得是暗色，不能等 JS 加载完 */
  {
    const { dom } = await loadPage("index.html", { expectScripts: 4, slug: S + "/暗色", seed: { "pet:theme:v1": "\"dark\"" } });
    ok(dom.window.document.documentElement.getAttribute("data-theme") === "dark",
      `[${S}] 存了暗色 → 内联脚本直接写 data-theme=dark（不闪白）`);
  }
}

/* ============================================================
   跑
   ============================================================ */
console.log("冒烟测试 " + targets.length + " 篇 + 登录页 + 目录页…\n");
let firstErr = null;
const suites = [...targets.map(s => [s, () => testArticle(s)]),
                ["login.html", testLoginPage],
                ["index.html", testIndexGate]];
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
