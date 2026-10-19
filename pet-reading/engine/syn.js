/* PET 精读 · 同义替换页（300 组）
   ===============================================================
   数据由 build.mjs 注入 window.PET_SYN —— 内部资料，只放在登录门禁后面。
   两种玩法：
     · 列表：300 组分段列 + 搜索 + 「遮住同义替换」自测；每个英文单词可点，
       弹出小卡片（读音 / 所在组的原文与替换 / ☆ 收藏进「我的词书」）。
     · 连线题：每轮随机 10 组，左右两列点着配对，对绿错红，一轮结束算错几次。
   收藏走和文章页同一条链路（PETStore.addFav）：本地立即生效 + 后台补写；
   没有网络/没登录时按钮照常能点（存储不可用时 store 自己降级）。
   站里没有通用词典：单个词的释义借用所在组的翻译（页面上有说明）。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var D = window.PET_SYN || { groups: [] };
  var G = D.groups || [];
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: "list",        // list | quiz
    q: "",               // 搜索词（中英文都行）
    mask: false,         // 遮住同义替换（自测）
    shown: {},           // 遮住模式下手动翻开的组号
    favs: {},            // 已收藏的词（小写）→ 1
    pop: null,           // 当前小卡片里的词 { word, key, g }
    quiz: null           // 连线题一轮的状态
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function normWord(w) { return String(w || "").toLowerCase().replace(/[^a-z'’-]/g, ""); }

  /* ---------- 朗读：与文章页/词书页同一口径（英音、0.75 倍速） ---------- */
  function speak(text) {
    try {
      if (!window.speechSynthesis || !text) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = "en-GB";
      u.rate = 0.75;
      var vs = window.speechSynthesis.getVoices() || [];
      var gb = vs.filter(function (v) { return /^en[-_]GB/i.test(v.lang); });
      var pick = gb.filter(function (v) { return /natural|online|neural/i.test(v.name); })[0] || gb[0] ||
        vs.filter(function (v) { return /^en/i.test(v.lang); })[0];
      if (pick) u.voice = pick;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 不支持语音的浏览器：点了没声，但不报错 */ }
  }

  /* ---------- 列表 ---------- */
  /* 每个英文单词渲染成可点的小按钮（点开小卡片） */
  var WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  function wordsHtml(text) {
    var out = "", last = 0, m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(String(text))) !== null) {
      if (m.index > last) out += esc(String(text).slice(last, m.index));
      var w = m[0];
      out += '<button type="button" class="syn-w' + (state.favs[normWord(w)] ? " on" : "") +
        '" data-sw="' + esc(w) + '">' + esc(w) + "</button>";
      last = WORD_RE.lastIndex;
    }
    out += esc(String(text).slice(last));
    return out;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    if (!q) return G;
    return G.filter(function (g) {
      return (g.en + " " + g.cn + " " + g.syn + " " + g.synCn).toLowerCase().indexOf(q) >= 0;
    });
  }

  function rowHtml(g) {
    var cls = "syn-row" + (state.mask ? " masked" : "") + (state.mask && state.shown[g.n] ? " shown" : "");
    return '<div class="' + cls + '" data-row="' + g.n + '">' +
      '<span class="syn-n">' + g.n + "</span>" +
      '<div class="syn-side"><div class="syn-en">' + wordsHtml(g.en) + "</div>" +
        '<div class="syn-cn">' + esc(g.cn) + "</div></div>" +
      '<span class="syn-arrow" aria-hidden="true">⇄</span>' +
      '<div class="syn-side r"><div class="syn-en">' + wordsHtml(g.syn) + "</div>" +
        '<div class="syn-cn">' + esc(g.synCn) + "</div>" +
        '<button type="button" class="syn-tap" data-reveal="' + g.n + '">点一下对答案</button>' +
      "</div></div>";
  }

  function renderList() {
    var box = $("synList");
    var list = filtered();
    if (!list.length) {
      box.innerHTML = '<div class="syn-empty"><span class="big">🔍</span>没找到「' + esc(state.q) +
        "」<br>换个词试试 —— 中文、英文都能搜</div>";
      return;
    }
    var h = "", cur = 0;
    list.forEach(function (g) {
      if (g.n > cur) {
        if (cur) h += "</div>";
        cur = Math.ceil(g.n / 10) * 10;
        h += '<div class="syn-sec"><h2 class="syn-sec-h">' + (cur - 9) + "–" + cur + "</h2>";
      }
      h += rowHtml(g);
    });
    h += "</div>";
    box.innerHTML = h;
    box.insertAdjacentHTML("beforeend", '<p class="syn-foot">共 ' + list.length + " 组" +
      (list.length !== G.length ? "（从 " + G.length + " 组里筛出来的）" : "") + "</p>");
  }

  /* 收藏态先备好再画列表：免得先出一片空心再逐个变实 */
  function loadFavs() {
    if (!S || !S.listFav) return Promise.resolve();
    return S.listFav().then(function (arr) {
      state.favs = {};
      (arr || []).forEach(function (x) {
        if (x && x.type === "w" && x.key) state.favs[normWord(x.key)] = 1;
      });
    }).catch(function () { state.favs = {}; });
  }
  function paintFavs() {
    document.querySelectorAll("#synList .syn-w").forEach(function (b) {
      b.classList.toggle("on", !!state.favs[normWord(b.dataset.sw)]);
    });
  }

  /* ---------- 单词小卡片 ---------- */
  function openWord(word, g) {
    var key = normWord(word);
    state.pop = { word: word, key: key, g: g };
    var on = !!state.favs[key];
    var h = '<div class="syn-pop-h"><span class="syn-pop-w">' + esc(word) + "</span>" +
      '<button type="button" class="wd-spk" data-say="' + esc(word) + '" title="朗读">🔊</button>' +
      '<button type="button" class="syn-pop-x" data-pop="close" title="关闭">✕</button></div>';
    h += '<div class="syn-pop-from">出自第 ' + g.n + " 组</div>";
    h += '<div class="syn-pop-g">' +
      '<div class="syn-pop-row"><b>' + esc(g.en) + "</b><span>" + esc(g.cn) + "</span></div>" +
      '<div class="syn-pop-row"><b>' + esc(g.syn) + "</b><span>" + esc(g.synCn) + "</span></div></div>";
    h += '<button type="button" class="btn syn-pop-fav' + (on ? " on" : "") + '" id="synPopFav">' +
      (on ? "★ 已收藏这个词" : "☆ 收藏这个词到我的词书") + "</button>";
    h += '<p class="syn-pop-tip">站里没有通用词典：这个词的释义借用它所在组的翻译。' +
      "收藏后会进「我的词书」，跨设备可恢复。</p>";
    $("synPopCard").innerHTML = h;
    $("synPop").hidden = false;
  }
  function closePop() { $("synPop").hidden = true; state.pop = null; }

  function toggleFav() {
    var p = state.pop;
    if (!p || !S || !S.addFav) return;
    var item = {
      type: "w",
      key: p.key,
      cn: p.g.cn,                                              // 组的中文当释义（页面有说明）
      ex: p.g.en + "  ⇄  " + p.g.syn,                           // 例句 = 这组对照本身
      exTr: p.g.cn + "  ⇄  " + p.g.synCn,
      title: D.title || "PET 阅读同义替换",
      slug: "synonyms"
    };
    S.addFav(item).then(function (r) {
      r = r || {};
      if (!r.ok) return;
      var on = !!r.added;
      if (on) state.favs[p.key] = 1; else delete state.favs[p.key];
      var btn = $("synPopFav");
      if (btn) {
        btn.classList.toggle("on", on);
        btn.textContent = on ? "★ 已收藏这个词" : "☆ 收藏这个词到我的词书";
      }
      paintFavs();     // 列表里所有这个词一起点亮/熄灭
    });
  }

  /* ---------- 连线题 ---------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* 连线题按分组出题（和书上一样）：第 1 组 = 1–10，第 2 组 = 11–20……
     左侧原文按顺序排（书上就是这样），右侧同义替换洗牌打乱。 */
  function secCount() { return Math.ceil(G.length / 10); }
  function newRound(sec) {
    sec = Math.max(0, Math.min(secCount() - 1, sec || 0));
    var base = sec * 10;
    var picked = G.slice(base, base + 10);
    state.quiz = {
      sec: sec, matched: {}, wrong: 0, sel: null,
      left: picked.slice(),                 // 原文：按组内顺序
      right: shuffle(picked.slice())        // 同义替换：洗牌
    };
    renderQuiz();
  }
  function gotoSection(d) {
    if (!state.quiz) return;
    newRound(state.quiz.sec + d);
  }
  function qItemHtml(g, side) {
    var ok = state.quiz.matched[g.n];
    return '<button type="button" class="syn-qitem' + (ok ? " ok" : "") + '" data-q="' + side + ":" + g.n + '">' +
      '<span class="syn-qen">' + esc(side === "l" ? g.en : g.syn) + "</span>" +
      '<span class="syn-qcn">' + esc(side === "l" ? g.cn : g.synCn) + "</span></button>";
  }
  function renderQuiz() {
    var q = state.quiz, box = $("synQuiz");
    if (!q) return;
    var done = Object.keys(q.matched).length;
    var total = q.left.length;
    var lb = q.sec * 10 + 1, rb = lb + total - 1;
    var last = q.sec >= secCount() - 1;
    var h = '<div class="syn-qhead">' +
      '<span class="syn-qtitle">连一连 · 第 ' + (q.sec + 1) + " 组（" + lb + "–" + rb + "）</span>" +
      '<span class="syn-score">已连对 <b>' + done + "</b>/" + total +
      (q.wrong ? "　错 " + q.wrong + " 次" : "") + "</span>" +
      '<span class="syn-qnav">' +
        '<button type="button" class="btn" id="synPrev"' + (q.sec === 0 ? " disabled" : "") + ">← 上一组</button>" +
        '<button type="button" class="btn" id="synNext"' + (last ? " disabled" : "") + ">下一组 →</button>" +
      "</span></div>";
    if (done === total) {
      h += '<div class="syn-done">' + (q.wrong
        ? "本组连完了，中间错了 " + q.wrong + " 次。" + (last ? "" : "点「下一组」继续。")
        : "本组全对，太稳了！" + (last ? "30 组都练完了，厉害。" : "点「下一组」继续。")) + "</div>";
    }
    h += '<div class="syn-qcols"><div class="syn-qcol">';
    q.left.forEach(function (g) { h += qItemHtml(g, "l"); });
    h += '</div><div class="syn-qcol">';
    q.right.forEach(function (g) { h += qItemHtml(g, "r"); });
    h += "</div></div>";
    h += '<p class="syn-qtip">先点左边一句，再点右边对应的替换；配对对了会变绿并显示中文。' +
      "左边按书上的顺序，右边打乱 —— 一组一组往下练。</p>";
    box.innerHTML = h;
  }
  function qClick(el) {
    var q = state.quiz;
    if (!q || el.classList.contains("ok")) return;
    var side = el.dataset.q.split(":")[0], n = +el.dataset.q.split(":")[1];
    if (!q.sel) { q.sel = { side: side, n: n, el: el }; el.classList.add("sel"); return; }
    if (q.sel.side === side) {
      q.sel.el.classList.remove("sel");
      q.sel = (q.sel.n === n) ? null : { side: side, n: n, el: el };
      if (q.sel) el.classList.add("sel");
      return;
    }
    var other = q.sel;
    if (other.n === n) {                       // 配对成功
      other.el.classList.remove("sel");
      other.el.classList.add("ok");
      el.classList.add("ok");
      q.matched[n] = 1;
      q.sel = null;
      if (Object.keys(q.matched).length === q.left.length) renderQuiz();   // 连完出成绩条
      else paintScore();
    } else {                                   // 配错：红一下再放开
      other.el.classList.remove("sel");
      other.el.classList.add("bad");
      el.classList.add("bad");
      q.wrong++;
      q.sel = null;
      paintScore();
      setTimeout(function () {
        other.el.classList.remove("bad");
        el.classList.remove("bad");
      }, 600);
    }
  }
  /* 计分条：连对/连错都即时更新（不整块重渲染，免得把红线重置） */
  function paintScore() {
    var q = state.quiz, el = $("synQuiz") && $("synQuiz").querySelector(".syn-score");
    if (!q || !el) return;
    el.innerHTML = "已连对 <b>" + Object.keys(q.matched).length + "</b>/" + q.left.length +
      (q.wrong ? "　错 " + q.wrong + " 次" : "");
  }

  /* ---------- 视图切换 / 事件 ---------- */
  function setView(v) {
    state.view = v === "quiz" ? "quiz" : "list";
    document.querySelectorAll(".syn-tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.view === state.view);
    });
    $("synList").hidden = state.view !== "list";
    $("synQuiz").hidden = state.view !== "quiz";
    document.querySelector(".syn-bar").classList.toggle("quiz", state.view === "quiz");
    if (state.view === "quiz" && !state.quiz) newRound(0);     // 从第 1 组（1–10）开始
  }

  function bind() {
    $("synSearch").addEventListener("input", function () {
      state.q = this.value;
      state.shown = {};
      renderList();
    });
    var maskBtn = $("synMask");
    maskBtn.addEventListener("click", function () {
      state.mask = !state.mask;
      state.shown = {};
      maskBtn.classList.toggle("on", state.mask);
      maskBtn.textContent = state.mask ? "显示同义替换" : "遮住同义替换";
      renderList();
    });
    document.querySelectorAll(".syn-tab").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });

    /* 列表 + 弹层里的点击统一委托 */
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var say = t.closest && t.closest("[data-say]");
      if (say) { ev.stopPropagation(); speak(say.dataset.say); return; }
      if (t.closest && t.closest("[data-pop='close']")) { closePop(); return; }
      if (t.id === "synPopFav") { toggleFav(); return; }
      if (t.closest && t.closest("#synPrev")) { gotoSection(-1); return; }
      if (t.closest && t.closest("#synNext")) { gotoSection(1); return; }
      if (t.closest && t.closest(".syn-tab")) return;            // 上面单独绑了

      var reveal = t.closest && t.closest("[data-reveal]");
      if (reveal) {
        state.shown[+reveal.dataset.reveal] = 1;
        reveal.closest(".syn-row").classList.add("shown");
        return;
      }
      var sw = t.closest && t.closest(".syn-w");
      if (sw) {
        var row = sw.closest(".syn-row");
        var g = G.filter(function (x) { return String(x.n) === (row && row.dataset.row); })[0];
        if (g) openWord(sw.dataset.sw, g);
        return;
      }
      var qi = t.closest && t.closest("[data-q]");
      if (qi) { qClick(qi); return; }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closePop();
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (S && S.mountWho) S.mountWho($("who"));
    if (S && S.mountTheme) S.mountTheme($("tglTheme"));
    if (S && S.mountZoom) S.mountZoom();
    bind();
    renderList();                    // 先画（数据是内联的，不等网络）
    loadFavs().then(paintFavs);      // 收藏态到了再把 ☆ 点亮
    setView("list");
    if (D.credit) $("synCredit").textContent = D.credit;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
