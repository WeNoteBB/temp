/* PET 精读 · 词组库「复习」（间隔重复 SRS）
   ===============================================================
   做法（SM-2 简化版，调度在服务端 lib.mjs 的 srsNext）：
     · 到期复习：GET /api/phrase-review（只要 due_at <= 今天的）
     · 练没练过的：GET ...&all=1 拿到全部记录，和本页的 254 条一比就知道哪些还没进复习
     · 每题 = 从整座库里挑 4 个选项（优先本组，保证「搭配」能区分），
       中文 + 用法作线索、原句挖空作题干；选一个立刻判分 + 报服务端
     · 答错的：同时进「词组错题本」，和 小霸王 第三关 一个口径
   界面复用 .xbw-* 那套样式（选择题的形状和 小霸王 第三关 一致，学生不用再学一遍）。
   入口：window.PET_SRS.open() / stop()（phrase.js 切到复习 tab 时调）。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var D = window.PET_PHRASES || { items: [] };
  var ALL = D.items || [];
  var $ = function (id) { return document.getElementById(id); };

  var st = {
    mode: "home",     // home（今天的复习卡）| drill（正在做）
    list: [],         // 这一轮要复习的
    i: 0,
    right: 0,
    wrong: [],        // [{no, phrase, chosen}]
    picked: null,
    lock: false,
    due: [],          // 服务端说今天到期的
    learned: {},      // no → 1（有复习记录的）
    timer: null,
    lastDays: 0
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function byNo(n) {
    for (var i = 0; i < ALL.length; i++) if (ALL[i].n === n) return ALL[i];
    return null;
  }
  function groupOf(it) { return Math.max(1, Math.ceil(it.n / 10)); }
  function splitAt(sent, piece) {
    var i = String(sent).indexOf(piece);
    if (i < 0) i = String(sent).toLowerCase().indexOf(String(piece).toLowerCase());
    if (i < 0) return { pre: sent, post: "" };
    return { pre: sent.slice(0, i), post: sent.slice(i + piece.length) };
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* 4 个选项：正确答案 + 3 个干扰（优先同组 —— 同组的词组结构最像，才考得出搭配） */
  function optionsFor(it) {
    var pool = ALL.filter(function (x) { return x.n !== it.n && groupOf(x) === groupOf(it); });
    var others = pool.filter(function (x) { return x.ex !== it.ex; });     // 同句的（如 106/107）尽量避开
    if (others.length < 3) others = others.concat(ALL.filter(function (x) { return x.n !== it.n; }));
    var seen = {}, picked = [];
    shuffle(others).forEach(function (x) {
      if (picked.length >= 3 || seen[x.ph]) return;
      seen[x.ph] = 1;
      picked.push(x.ph);
    });
    return shuffle([it.ph].concat(picked));
  }

  /* ---------- 首页：今天要复习几条 ---------- */
  function renderHome() {
    var box = $("srs");
    var dueN = st.due.length;
    var learnedN = Object.keys(st.learned).length;
    var freshN = ALL.length - learnedN;
    var h = '<div class="xbw-top"><span class="xbw-stage">🔁 复习 · 间隔重复</span>' +
      '<span class="xbw-gtag">' + learnedN + "/" + ALL.length + ' 条已经进过复习</span></div>';
    h += '<div class="xbw-done">' + (dueN
      ? "今天有 <b>" + dueN + "</b> 条到期，练完就会排到下一天。"
      : "今天没有到期的 —— 想练的话，让系统带你过几条没练过的。") + "</div>";
    h += '<p class="srs-tip">怎么排：答对升一级，间隔变成 1 → 2 → 4 → 7 → 15 → 30 天；' +
      "答错回到 1 级，明天再来（错的题同时进词组错题本，在「错题记录」里能看到）。</p>";
    h += '<div class="xbw-foot">' +
      '<button type="button" class="btn pri" data-s="start"' + (dueN ? "" : " disabled") + ">开始复习" +
        (dueN ? "（" + dueN + " 条）" : "") + "</button>" +
      '<button type="button" class="btn" data-s="fresh"' + (freshN ? "" : " disabled") + ">带我练 10 条没练过的" +
        (freshN ? "" : "（都练过了）") + "</button>" +
      '<button type="button" class="btn" data-s="reload">刷新</button>' +
      "</div>";
    box.innerHTML = h;
  }

  /* ---------- 做题 ---------- */
  function startDrill(list, label) {
    st.mode = "drill";
    st.list = list.slice();
    st.i = 0;
    st.right = 0;
    st.wrong = [];
    st.picked = null;
    st.label = label || "";
    renderDrill();
  }
  function renderDrill() {
    var box = $("srs");
    var it = st.list[st.i];
    if (!it) { renderDone(); return; }
    var total = st.list.length;
    var h = '<div class="xbw-top"><span class="xbw-stage">🔁 复习 · 做题</span>' +
      '<span class="xbw-gtag">' + esc(st.label) + "</span>" +
      '<span class="xbw-prog">第 ' + (st.i + 1) + "/" + total + " 题 · 已答对 <b>" + st.right + "</b></span>" +
      '<span class="xbw-ctl"><button type="button" class="btn" data-s="stop">先回去</button></span></div>';
    h += '<div class="xbw-dots">';
    st.list.forEach(function (x, i) {
      var cls = i < st.i ? (st.wrong.some(function (w) { return w.i === i; }) ? " bad" : " ok") : (i === st.i ? " on" : "");
      h += '<span class="xbw-dot' + cls + '"></span>';
    });
    h += "</div>";
    var sp = splitAt(it.ex, it.blank);
    h += '<div class="xbw-q">';
    h += '<div class="xbw-clue">' + esc(it.cn) + '<span class="xbw-use">' + esc(it.use) + "</span></div>";
    h += '<div class="xbw-stem">' + esc(sp.pre) + '<span class="xbw-blank"></span>' + esc(sp.post) + "</div>";
    h += '<div class="xbw-opts">';
    (st.opts || []).forEach(function (ph) {
      var cls = "xbw-opt";
      if (st.picked && st.picked.ph === ph) cls += st.picked.right ? " ok" : " bad";
      if (st.picked && !st.picked.right && ph === it.ph) cls += " ok";   // 错了也把正确答案标出来
      h += '<button type="button" class="' + cls + '" data-opt="' + esc(ph) + '"' +
        (st.picked ? " disabled" : "") + ">" + esc(ph) + "</button>";
    });
    h += "</div>";
    if (st.picked) {
      h += '<div class="xbw-fb ' + (st.picked.right ? "ok" : "bad") + '">' +
        (st.picked.right ? "✔ 对了！" : "✘ 你选的是 <b>" + esc(st.picked.ph) + "</b>，正确答案是 <b>" + esc(it.ph) + "</b>") +
        '<div class="xbw-fbwhy">' + esc(it.why || "") +
          (it.trap ? '<div class="ana-tr">' + esc(it.trap) + "</div>" : "") + "</div></div>";
    } else {
      h += '<p class="xbw-tip">中文 + 用法是线索；选一个就自动进下一题（答完会记进复习计划）。</p>';
    }
    h += "</div>";
    box.innerHTML = h;
  }
  function pick(ph) {
    if (st.picked) return;
    var it = st.list[st.i];
    if (!it) return;
    var right = (ph === it.ph);
    st.picked = { ph: ph, right: right };
    if (right) st.right++;
    else {
      st.wrong.push({ i: st.i, no: it.n, phrase: it.ph, chosen: ph });
      if (S && S.addPhraseMistake) {
        var sp = splitAt(it.ex, it.blank);
        S.addPhraseMistake({
          no: it.n, phrase: it.ph, stem: sp.pre + "＿＿" + sp.post, chosen: ph, correct: it.ph
        });
      }
    }
    /* 报给服务端排下一次；回来的 days 留着给总结页显示 */
    if (S && S.addPhraseReview) {
      S.addPhraseReview({ no: it.n, phrase: it.ph, level: (st.known[it.n] || {}).level || 1, ok: right })
        .then(function (r) { if (r && r.days) st.lastDays = r.days; });
    }
    renderDrill();
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(function () {
      st.picked = null;
      if (st.i >= st.list.length - 1) { renderDone(); return; }
      st.i++;
      st.opts = optionsFor(st.list[st.i]);
      renderDrill();
    }, right ? 900 : 1700);
  }
  function renderDone() {
    st.mode = "done";
    var total = st.list.length, right = st.right;
    var h = '<div class="xbw-top"><span class="xbw-stage">🔁 复习 · 结果</span>' +
      '<span class="xbw-gtag">' + esc(st.label) + "</span>" +
      '<span class="xbw-prog">答对 <b>' + right + "/" + total + "</b></span></div>";
    h += '<div class="xbw-done">' + (right === total
      ? "全对！这些条目的复习间隔都拉长了。"
      : "答对 " + right + "/" + total + " 条。" +
        (st.lastDays ? "这一轮答对的，下次大概 " + st.lastDays + " 天后见。" : "")) +
      "</div>";
    if (st.wrong.length) {
      h += '<h3 class="xbw-h3">错的 · ' + st.wrong.length + " 道（已进词组错题本）</h3>";
      h += '<div class="xbw-mistakes">';
      st.wrong.forEach(function (w) {
        var it = byNo(w.no) || {};
        var sp = splitAt(it.ex || "", it.blank || "");
        h += '<div class="xbw-mist">' +
          '<div class="xbw-mq"><span class="xbw-mn">' + w.no + "</span>" + esc(sp.pre) +
            '<span class="xbw-blank"></span>' + esc(sp.post) + "</div>" +
          '<div class="xbw-ma">你选：<b class="bad">' + esc(w.chosen) + "</b> · 正确：<b class=\"ok\">" + esc(it.ph) + "</b></div>" +
          '<div class="xbw-mwhy">' + esc(it.why || "") + "</div></div>";
      });
      h += "</div>";
    } else {
      h += '<p class="xbw-tip">没有错题。明天再来，到期的会自己冒出来。</p>';
    }
    h += '<div class="xbw-foot">' +
      '<button type="button" class="btn pri" data-s="home">回复习首页</button>' +
      (st.wrong.length ? '<button type="button" class="btn" data-s="again">再练错的 ' + st.wrong.length + " 条</button>" : "") +
      '<button type="button" class="btn" data-s="read">📖 回词组卡看看</button>' +
      "</div>";
    $("srs").innerHTML = h;
  }

  /* ---------- 数据 ---------- */
  function load() {
    var box = $("srs");
    box.innerHTML = '<div class="xbw-top"><span class="xbw-stage">🔁 复习 · 间隔重复</span></div>' +
      '<p class="xbw-tip">正在取复习计划…</p>';
    var p1 = (S && S.listPhraseReviews) ? S.listPhraseReviews({ limit: 50 }) : Promise.resolve([]);
    var p2 = (S && S.listPhraseReviews) ? S.listPhraseReviews({ all: true, limit: 200 }) : Promise.resolve([]);
    return Promise.all([p1, p2]).then(function (r) {
      st.due = (r[0] || []).map(function (x) { return byNo(x.no) || {}; }).filter(function (x) { return x.n; });
      st.known = {};
      (r[1] || []).forEach(function (x) { st.known[x.no] = x; });
      st.learned = st.known;
      st.mode = "home";
      renderHome();
    }).catch(function () {
      box.innerHTML = '<div class="xbw-top"><span class="xbw-stage">🔁 复习 · 间隔重复</span></div>' +
        '<p class="xbw-tip">取不到复习计划（没登录或断网）。登录后再来，或者先去「小霸王模式」练一组。</p>';
    });
  }

  /* ---------- 事件 ---------- */
  function onClick(ev) {
    var t = ev.target;
    var opt = t.closest && t.closest("[data-opt]");
    if (opt) { pick(opt.dataset.opt); return; }
    var s = t.closest && t.closest("[data-s]");
    if (!s) return;
    var act = s.dataset.s;
    if (act === "start") {
      if (!st.due.length) return;
      var list = st.due.slice(0, 20);
      st.opts = optionsFor(list[0]);
      startDrill(list, "今天到期的 " + list.length + " 条");
      return;
    }
    if (act === "fresh") {
      var fresh = ALL.filter(function (x) { return !st.known[x.n]; });
      if (!fresh.length) return;
      var pick10 = shuffle(fresh).slice(0, 10);
      st.opts = optionsFor(pick10[0]);
      startDrill(pick10, "新练 10 条");
      return;
    }
    if (act === "again") {
      var wrongList = st.wrong.map(function (w) { return byNo(w.no) || {}; }).filter(function (x) { return x.n; });
      if (!wrongList.length) return;
      st.opts = optionsFor(wrongList[0]);
      startDrill(wrongList, "再练错的 " + wrongList.length + " 条");
      return;
    }
    if (act === "home") { clearTimer(); load(); return; }
    if (act === "reload") { clearTimer(); load(); return; }
    if (act === "stop") { clearTimer(); load(); return; }
    if (act === "read") { stop(); if (window.PET_PHRASE_UI) window.PET_PHRASE_UI.open(0); return; }
  }
  function clearTimer() { if (st.timer) { clearTimeout(st.timer); st.timer = null; } }

  /* ---------- 开关（phrase.js 切 tab 时调） ---------- */
  function open() {
    var box = $("srs");
    if (!box) return;
    document.addEventListener("click", onClick);
    load();
  }
  function stop() {
    clearTimer();
    document.removeEventListener("click", onClick);
  }

  window.PET_SRS = { open: open, stop: stop, state: st };
})();
