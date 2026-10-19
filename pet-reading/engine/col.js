/* PET 精读 · 固定搭配页（254 组 · 每 10 个一组）
   ===============================================================
   数据由 build.mjs 注入 window.PET_COL —— 内部资料，只放在登录门禁后面。
   一组一屏：上面是 10 张短语卡（短语 / 中文 / 用法 / 原文例句 + 翻译 + 🔊），
   下面是对应的 10 题填空练习（短语库点选填入，对绿错红、记错次，可对答案 / 重做）。
   站里没有通用词典：这里就是「短语 + 中文 + 用法 + 例句」的清单，别的都不掺。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var D = window.PET_COL || { items: [] };
  var ALL = D.items || [];
  var PER = 10;                                  // 每组的条数（和书上一样，10 个一组）
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    g: 0,                 // 当前第几组（0 起）
    prog: {},             // 每组进度：{ filled:{题号:1}, wrong:错次 }
    order: {},            // 每组的短语库顺序（洗过牌，切组回来不重洗）
    sel: null             // 练习里当前选中的空（题号）
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function groupCount() { return Math.max(1, Math.ceil(ALL.length / PER)); }
  function groupOf(g) { return ALL.slice(g * PER, g * PER + PER); }
  function rangeTxt(g) {
    var it = groupOf(g);
    return it.length ? it[0].n + "–" + it[it.length - 1].n : "—";
  }
  function prog(g) {
    if (!state.prog[g]) state.prog[g] = { filled: {}, wrong: 0 };
    return state.prog[g];
  }

  /* ---------- 朗读：与文章页 / 同义替换页同一口径（英音、0.75 倍速） ---------- */
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

  /* ---------- 工具 ---------- */
  /* 在句子里找出要标黄的那一段（短语 / 挖空的那块）。
     先精确找，再忽略大小写找 —— 找不到就整句不标（数据侧有 verify 盯着）。 */
  function findSpan(sent, piece) {
    if (!piece) return null;
    var i = sent.indexOf(piece);
    if (i < 0) i = sent.toLowerCase().indexOf(piece.toLowerCase());
    return i < 0 ? null : { i: i, len: piece.length };
  }
  function marked(sent, piece) {
    var sp = findSpan(sent, piece);
    if (!sp) return esc(sent);
    return esc(sent.slice(0, sp.i)) + '<span class="col-hl">' +
      esc(sent.slice(sp.i, sp.i + sp.len)) + "</span>" + esc(sent.slice(sp.i + sp.len));
  }
  /* 句子按挖空那一块拆成两半（练习用） */
  function splitAt(sent, piece) {
    var sp = findSpan(sent, piece);
    if (!sp) return { pre: sent, post: "", hole: "" };
    return { pre: sent.slice(0, sp.i), hole: sent.slice(sp.i, sp.i + sp.len), post: sent.slice(sp.i + sp.len) };
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  var SPK = '<button type="button" class="col-spk" data-say="%s" title="朗读">🔊</button>';

  /* ---------- 短语卡 ---------- */
  function cardHtml(it) {
    return '<div class="col-card" data-card="' + it.n + '">' +
      '<div class="col-chead">' +
        '<span class="col-n">' + it.n + "</span>" +
        '<span class="col-ph">' + esc(it.ph) + "</span>" +
        (it.alt ? '<span class="col-alt">' + esc(it.alt) + "</span>" : "") +
        '<span class="col-cn">' + esc(it.cn) + "</span>" +
        '<button type="button" class="col-spk" data-say="' + esc(it.ph) + '" title="朗读短语">🔊</button>' +
      "</div>" +
      '<div class="col-use"><span class="col-usek">用法</span>' + esc(it.use) + "</div>" +
      '<div class="col-ex">' + marked(it.ex, it.blank) +
        '<button type="button" class="col-spk" data-say="' + esc(it.ex) + '" title="朗读例句">🔊</button>' +
      "</div>" +
      '<div class="col-extr">' + esc(it.exCn) + "</div>" +
    "</div>";
  }
  function renderCards() {
    $("colCardsH").textContent = "第 " + (state.g + 1) + " 组 · 短语卡（" + rangeTxt(state.g) + "）";
    $("colCards").innerHTML = groupOf(state.g).map(cardHtml).join("");
  }

  /* ---------- 练习 ---------- */
  function bankOrder(g) {
    if (!state.order[g]) state.order[g] = shuffle(groupOf(g).map(function (x) { return x.n; }));
    return state.order[g];
  }
  function bankHtml() {
    var byN = {};
    groupOf(state.g).forEach(function (x) { byN[x.n] = x; });
    var used = prog(state.g).filled;
    return '<span class="col-banklab">短语库</span>' + bankOrder(state.g).map(function (n) {
      var done = !!used[n];
      return '<button type="button" class="col-chip' + (done ? " used" : "") + '" data-chip="' + n + '"' +
        (done ? " disabled" : "") + ">" +
        (done ? '<span class="col-tick" aria-hidden="true">✓</span>' : "") + esc(byN[n].ph) + "</button>";
    }).join("");
  }
  function qHtml(it) {
    var h = splitAt(it.ex, it.blank);
    var done = !!prog(state.g).filled[it.n];
    var slotTxt = done ? h.hole : "";
    var note = done && h.hole.toLowerCase() !== it.ph.toLowerCase()
      ? '<span class="col-qans">＝ ' + esc(it.ph) + "</span>" : "";
    /* 空后面紧跟标点时（questions, so…），空和标点之间的缝收窄一点 */
    var tight = /^[,.;:!?]/.test(h.post) ? " tight" : "";
    return '<div class="col-q" data-q="' + it.n + '">' +
      '<span class="col-qn">' + it.n + "</span>" +
      '<div class="col-qbody">' +
        '<div class="col-qclue">' + esc(it.cn) + '<span class="col-quse">' + esc(it.use) + "</span></div>" +
        '<div class="col-qsent">' + esc(h.pre) +
          '<button type="button" class="col-slot' + (done ? " ok" : "") + tight + '" data-slot="' + it.n + '">' +
            esc(slotTxt) + "</button>" + esc(h.post) + note +
        "</div>" +
      "</div></div>";
  }
  function renderPractice() {
    $("colPH").textContent = "第 " + (state.g + 1) + " 组练习 · " + rangeTxt(state.g);
    $("colBank").innerHTML = bankHtml();
    $("colQs").innerHTML = groupOf(state.g).map(qHtml).join("");
    paintScore();
  }
  function paintScore() {
    var p = prog(state.g), total = groupOf(state.g).length;
    var done = Object.keys(p.filled).length;
    var el = $("colScore");
    if (el) {
      el.innerHTML = "已填对 <b>" + done + "</b>/" + total +
        (p.wrong ? '<span class="col-pwrong"> · 错 ' + p.wrong + " 次</span>" : "");
    }
    $("colDone").hidden = !(done === total && total > 0);
    if (done === total && total > 0) {
      $("colDone").textContent = p.wrong
        ? "本组填完了，中间错了 " + p.wrong + " 次。" + (state.g >= groupCount() - 1 ? "" : "点「下一组」继续。")
        : "本组全对，太稳了！" + (state.g >= groupCount() - 1 ? "" : "点「下一组」继续。");
    }
  }

  /* 把一个短语填进某个空：对了填进句子里，错了红一下（记错次） */
  function fill(qn, chipN) {
    var p = prog(state.g);
    if (p.filled[qn]) return;
    var slot = document.querySelector('.col-slot[data-slot="' + qn + '"]');
    var chip = document.querySelector('.col-chip[data-chip="' + chipN + '"]');
    if (!slot || !chip) return;
    if (qn === chipN) {                                   // 配对成功
      p.filled[qn] = 1;
      state.sel = null;
      renderPractice();                                   // 整块重画：填进去的那段 + 库里那条打 ✓
    } else {                                              // 配错：红一下再放开
      p.wrong++;
      slot.classList.add("bad");
      chip.classList.add("bad");
      state.sel = null;
      slot.classList.remove("sel");
      paintScore();
      setTimeout(function () {
        slot.classList.remove("bad");
        chip.classList.remove("bad");
      }, 600);
    }
  }
  function revealAll() {
    var p = prog(state.g);
    groupOf(state.g).forEach(function (it) {
      if (p.filled[it.n]) return;
      p.filled[it.n] = 1;
    });
    renderPractice();
  }
  function resetGroup() {
    state.prog[state.g] = { filled: {}, wrong: 0 };
    state.order[state.g] = null;
    state.sel = null;
    renderPractice();
  }

  /* ---------- 组切换 ---------- */
  function renderGroups() {
    var n = groupCount();
    var h = "";
    for (var g = 0; g < n; g++) {
      h += '<button type="button" class="col-g' + (g === state.g ? " on" : "") + '" data-g="' + g + '">' +
        "第 " + (g + 1) + " 组</button>";
    }
    $("colGroups").innerHTML = h;
    $("colPrev").disabled = state.g === 0;
    $("colNext").disabled = state.g >= n - 1;
  }
  function setGroup(g, scroll) {
    var n = groupCount();
    state.g = Math.max(0, Math.min(n - 1, g));
    state.sel = null;
    renderGroups();
    renderCards();
    renderPractice();
    if (scroll) {
      /* 用 scrollTop 而不是 window.scrollTo：jsdom 的 scrollTo 是「未实现」，
         会往虚拟控制台写一条错误（冒烟会当成 JS 报错） */
      var top = $("colCardsH").getBoundingClientRect().top + (document.documentElement.scrollTop || 0) - 8;
      try {
        document.documentElement.scrollTop = top;
        if (document.body) document.body.scrollTop = top;
      } catch (e) {}
    }
  }

  /* ---------- 事件 ---------- */
  function bind() {
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var say = t.closest && t.closest("[data-say]");
      if (say) { ev.stopPropagation(); speak(say.dataset.say); return; }
      var chip = t.closest && t.closest("[data-chip]");
      if (chip) {
        var cn = +chip.dataset.chip;
        var qn = state.sel;
        if (!qn) {                                       // 没选空：自动填到第一个还没填的空
          var empty = document.querySelector('.col-slot:not(.ok)');
          qn = empty ? +empty.dataset.slot : null;
        }
        if (qn) fill(qn, cn);
        return;
      }
      var slot = t.closest && t.closest("[data-slot]");
      if (slot) {
        if (slot.classList.contains("ok")) return;
        state.sel = +slot.dataset.slot;
        document.querySelectorAll(".col-slot").forEach(function (s) { s.classList.toggle("sel", s === slot); });
        return;
      }
      var gb = t.closest && t.closest("[data-g]");
      if (gb) { setGroup(+gb.dataset.g); return; }
    });

    $("colPrev").addEventListener("click", function () { setGroup(state.g - 1, true); });
    $("colNext").addEventListener("click", function () { setGroup(state.g + 1, true); });
    $("colReveal").addEventListener("click", revealAll);
    $("colReset").addEventListener("click", resetGroup);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (S && S.mountWho) S.mountWho($("who"));
    if (S && S.mountTheme) S.mountTheme($("tglTheme"));
  if (S && S.mountZoom) S.mountZoom();
    bind();
    setGroup(0);
    if (D.credit) $("colCredit").textContent = D.credit;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
