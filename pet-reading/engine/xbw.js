/* PET 精读 · 词组库「小霸王学习模式」
   ===============================================================
   数据同词组库（window.PET_PHRASES）。三关一总结：
     ① 自动播放：10 张卡自动翻、自动读（默认静音，点一下开声音，选择记住）
     ② 连线：左 10 个词组、右 10 个中文（打乱），点左点右配对，对绿错红、记错次
     ③ 选择题：原稿练习的做法 —— 中文 + 用法 + 挖空句，从本组 10 个词组里挑 1 个；
        选中一个立刻判分并自动进下一题
     ④ 自动批改总结：得分 + 错题清单（你选的 / 正确答案 / 解析）
   选择题答错的题自动进「词组错题本」（PETStore.addPhraseMistake）。
   入口：window.PET_XBW.start(组号) / stop() / jumpQuiz(题号)（错题本「去订正」用）。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var D = window.PET_PHRASES || { items: [] };
  var ALL = D.items || [];
  var PER = 10;
  var $ = function (id) { return document.getElementById(id); };

  var K_SOUND = "pet:xbw:sound";       // 已不用（本地跟读统一走 PET_READ 的语速设置）

    var st = {
      g: 0,
      stage: "play",           // play | link | quiz | done
      play: { i: 0, on: false },          // on = 跟读在走（念完一张会自动接下一张）
      link: null,
      quiz: null,
      blocked: false,                     // true = 浏览器拦了跟读（iOS 首次要用户点一次）
      readTimer: null
    };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function groupItems(g) { return ALL.slice(g * PER, g * PER + PER); }
  function rangeTxt(g) {
    var it = groupItems(g);
    return it.length ? it[0].n + "–" + it[it.length - 1].n : "—";
  }
  /* ---------- 本地跟读：整段念读交给 phrase.js 的 window.PET_READ（英音 + 中文女声、0.75 倍速） ---------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function splitAt(sent, piece) {
    var i = String(sent).indexOf(piece);
    if (i < 0) i = String(sent).toLowerCase().indexOf(String(piece).toLowerCase());
    if (i < 0) return { pre: sent, post: "" };
    return { pre: sent.slice(0, i), post: sent.slice(i + piece.length) };
  }

  /* ============================================================
     渲染
     ============================================================ */
  function topHtml(stageName) {
    var g = st.g, list = groupItems(g);
    var h = '<div class="xbw-top">' +
      '<span class="xbw-stage">' + stageName + "</span>" +
      '<span class="xbw-gtag">第 ' + (g + 1) + " 组 · " + rangeTxt(g) + "</span>" +
      '<span class="spacer"></span>';
    return h;
  }

  /* ---------- 第一关：本地跟读（逐卡；一张读完停 1 秒自动接下一张） ---------- */
  /* ---------- 第一关：本地跟读（逐卡；一张读完停 1 秒自动接下一张） ---------- */
  function playCardHtml() {
    var list = groupItems(st.g), it = list[st.play.i];
    if (!it) return "";
    return '<div class="xbw-card">' +
      '<div class="xbw-chead"><span class="xbw-cn-n">' + it.n + "</span>" +
        '<span class="xbw-ph">' + esc(it.ph) + "</span>" +
        (it.alt ? '<span class="ph-alt">' + esc(it.alt) + "</span>" : "") + "</div>" +
      '<div class="xbw-ccc">' + esc(it.cn) + "</div>" +
      '<div class="xbw-cuse"><span class="ph-usek">用法</span>' + esc(it.use) + "</div>" +
      '<div class="xbw-cex">' + esc(it.ex) + "</div>" +
      '<div class="xbw-cExtr">' + esc(it.exCn) + "</div>" +
    "</div>";
  }
  function readIt() { return groupItems(st.g)[st.play.i]; }
  function renderPlay() {
    var list = groupItems(st.g), n = list.length;
    var R = window.PET_READ;
    var lab = st.blocked ? "▶ 点一下开始跟读" : (st.play.on ? "⏸ 暂停跟读" : "▶ 继续跟读");
    var h = topHtml("第一关 · 本地跟读") +
      '<span class="xbw-prog">' + (st.play.i + 1) + "/" + n + "</span>" +
      '<span class="xbw-ctl">' +
        '<button type="button" class="btn' + (st.play.on || st.blocked ? " on" : "") + '" data-x="read">' + lab + "</button>" +
        '<button type="button" class="btn" data-x="again">↻ 重听本卡</button>' +
        (R ? '<button type="button" class="btn" data-x="speed">语速 ' + R.rate() + "×</button>" : "") +
        '<button type="button" class="btn pri" data-x="skip">进第二关 · 连线 →</button>' +
      "</span></div>";
    h += playCardHtml();
    h += '<div class="xbw-dots">';
    list.forEach(function (_, i) {
      h += '<button type="button" class="xbw-dot' + (i === st.play.i ? " on" : "") + '" data-x="go" data-i="' + i + '" title="第 ' + (i + 1) + ' 张"></button>';
    });
    h += "</div>";
    if (st.blocked) {
      h += '<div class="xbw-fb bad">这台设备要先点一次才肯出声（iPhone / iPad 上常见）：' +
        "点上面那个「▶ 点一下开始跟读」就行。</div>";
    }
    h += '<p class="xbw-tip">一张一张跟读：<b>词组 → 中文 → 例句 → 例句翻译</b>（英音 + 中文女声，' +
      (R ? R.rate() : "0.75") + " 倍速）。一张念完停 1 秒，自动翻到下一张接着念；" +
      "点小圆点可以跳到任意一张，点「暂停跟读」停下来自己看。有预生成音频的卡直接播文件（音色固定），" +
      "退回 TTS 的才受顶栏「🎙 音色」影响。" +
      (voiceHint(readIt()) ? "<br>" + voiceHint(readIt()) : "") + "</p>";
    $("xbw").innerHTML = h;
  }
  /* 这台设备的语音体检：没英音/没中文音时，在第一关提示一句（点「🎙 音色」看办法） */
  function voiceHint(it) {
    if (it && it.ra) return "";                       // 这一条有预生成音频：设备没 TTS 也照样能念
    if (!window.PET_READ || !window.PET_READ.diagnose) return "";
    var d = window.PET_READ.diagnose();
    if (d.noSpeech) return "⚠ 这台设备/浏览器不支持语音朗读，跟读不会出声（换 Edge / Chrome 试试）。";
    if (!d.enGb) return "⚠ 没找到英式语音（en-GB），英文会读成美音 —— 点顶栏「🎙 音色」看安装办法。";
    return "";
  }
  /* 念当前这张卡；念完 → 停 1 秒 → 翻下一张 → 接着念 */
  function readCard() {
    var R = window.PET_READ;
    if (!R) return;
    var it = readIt();
    if (!it) return;
    if (!R.canPlay(it)) return;                       // 没音频文件、也没语音合成就不自动走
    if (st.readTimer) { clearTimeout(st.readTimer); st.readTimer = null; }
    st.blocked = false;
    R.card(it, function () {
      if (!st.play.on || st.stage !== "play") return;  // 中途暂停/切关了就不再往下走
      var list = groupItems(st.g);
      if (st.play.i >= list.length - 1) {              // 念完最后一张就停在这
        st.play.on = false;
        renderPlay();
        return;
      }
      st.readTimer = setTimeout(function () {
        if (!st.play.on || st.stage !== "play") return;
        st.play.i++;
        renderPlay();
        readCard();
      }, 1000);                                        // 念完停 1 秒
    });
  }
  function readStart(fromI) {
    if (fromI != null) st.play.i = fromI;
    st.play.on = true;
    st.blocked = false;                               // 用户点了（在手势里重放）→ 拦截提示立刻收掉
    renderPlay();
    readCard();
  }
  function readStop() {
    st.play.on = false;
    if (st.readTimer) { clearTimeout(st.readTimer); st.readTimer = null; }
    if (window.PET_READ) window.PET_READ.cancel();
    renderPlay();
  }

  /* ---------- 第二关：连线 ---------- */
  function newLink() {
    var list = groupItems(st.g);
    st.link = {
      left: list.slice(),
      right: shuffle(list.map(function (x) { return { n: x.n }; })),
      matched: {}, wrong: 0, sel: null
    };
  }
  function linkItemHtml(it, side) {
    var ok = st.link.matched[it.n];
    var label = side === "l"
      ? (groupItems(st.g).filter(function (x) { return x.n === it.n; })[0] || {}).ph
      : (groupItems(st.g).filter(function (x) { return x.n === it.n; })[0] || {}).cn;
    return '<button type="button" class="xbw-li' + (ok ? " ok" : "") + '" data-xl="' + side + ":" + it.n + '">' +
      esc(label) + "</button>";
  }
  function renderLink() {
    var q = st.link;
    var done = Object.keys(q.matched).length, total = q.left.length;
    var h = topHtml("第二关 · 连线") +
      '<span class="xbw-prog">已连对 <b>' + done + "</b>/" + total +
        (q.wrong ? ' · <span class="warn">错 ' + q.wrong + " 次</span>" : "") + "</span>" +
      '<span class="xbw-ctl"><button type="button" class="btn pri" data-x="toquiz"' +
        (done < total ? " disabled" : "") + ">进第三关 · 选择题 →</button></span></div>";
    if (done === total) {
      h += '<div class="xbw-done">' + (q.wrong ? "本关连完了，中间错了 " + q.wrong + " 次。" : "本关全对！") + "</div>";
    }
    h += '<div class="xbw-lcols"><div class="xbw-lcol">';
    q.left.forEach(function (it) { h += linkItemHtml(it, "l"); });
    h += '</div><div class="xbw-lcol">';
    q.right.forEach(function (it) { h += linkItemHtml(it, "r"); });
    h += "</div></div>";
    h += '<p class="xbw-tip">先点左边一个词组，再点右边它的中文意思；配对了变绿，配错了红一下、记一次。</p>';
    $("xbw").innerHTML = h;
  }
  function linkClick(el) {
    var q = st.link;
    if (!q || el.classList.contains("ok")) return;
    var side = el.dataset.xl.split(":")[0], n = +el.dataset.xl.split(":")[1];
    if (!q.sel) { q.sel = { side: side, n: n, el: el }; el.classList.add("sel"); return; }
    if (q.sel.side === side) {
      q.sel.el.classList.remove("sel");
      q.sel = (q.sel.n === n) ? null : { side: side, n: n, el: el };
      if (q.sel) el.classList.add("sel");
      return;
    }
    var other = q.sel;
    if (other.n === n) {
      other.el.classList.remove("sel");
      other.el.classList.add("ok");
      el.classList.add("ok");
      q.matched[n] = 1;
      q.sel = null;
      renderLink();
    } else {
      other.el.classList.remove("sel");
      other.el.classList.add("bad");
      el.classList.add("bad");
      q.wrong++;
      q.sel = null;
      setTimeout(function () { other.el.classList.remove("bad"); el.classList.remove("bad"); }, 600);
      renderLink();
    }
  }

  /* ---------- 第三关：选择题（10 个词组里挑 1 个） ---------- */
  function newQuiz() {
    var list = groupItems(st.g);
    st.quiz = {
      list: list.slice(),
      i: 0,
      order: shuffle(list.map(function (x) { return x.n; })),   // 选项池：本组 10 个（打乱）
      used: {},         // 已经答对的（从池子里划掉）
      picked: null,     // 当前题选过的（防连点）
      right: 0,
      wrong: [],        // [{n, chosen, correct}]
      lock: false
    };
  }
  function quizHtml() {
    var q = st.quiz, list = q.list, it = list[q.i];
    var total = list.length;
    var h = topHtml("第三关 · 选择题") +
      '<span class="xbw-prog">第 ' + (q.i + 1) + "/" + total + " 题 · 已答对 <b>" + q.right + "</b></span>" +
      '<span class="xbw-ctl"><button type="button" class="btn" data-x="toend">看看成绩</button></span></div>';
    h += '<div class="xbw-dots">';
    list.forEach(function (_, i) {
      var cls = i < q.i ? (q.wrong.some(function (w) { return w.i === i; }) ? " bad" : " ok") : (i === q.i ? " on" : "");
      h += '<span class="xbw-dot' + cls + '"></span>';
    });
    h += "</div>";
    var sp = splitAt(it.ex, it.blank);
    h += '<div class="xbw-q">';
    h += '<div class="xbw-clue">' + esc(it.cn) + '<span class="xbw-use">' + esc(it.use) + "</span></div>";
    h += '<div class="xbw-stem">' + esc(sp.pre) + '<span class="xbw-blank"></span>' + esc(sp.post) + "</div>";
    h += '<div class="xbw-opts">';
    q.order.forEach(function (n) {
      var opt = list.filter(function (x) { return x.n === n; })[0];
      var cls = "xbw-opt";
      if (q.used[n]) cls += " used";
      if (q.picked && q.picked.n === n) cls += q.picked.right ? " ok" : " bad";
      if (q.picked && !q.picked.right && n === it.n) cls += " ok";    // 错了也把正确答案标出来
      h += '<button type="button" class="' + cls + '" data-xo="' + n + '"' +
        (q.picked || q.used[n] ? " disabled" : "") + ">" + esc(opt.ph) + "</button>";
    });
    h += "</div>";
    if (q.picked) {
      var got = list.filter(function (x) { return x.n === q.picked.n; })[0] || {};
      h += '<div class="xbw-fb ' + (q.picked.right ? "ok" : "bad") + '">' +
        (q.picked.right ? "✔ 对了！" : "✘ 你选的是 <b>" + esc(got.ph || "") + "</b>，正确答案是 <b>" + esc(it.ph) + "</b>") +
        '<div class="xbw-fbwhy">' + esc(it.why || "") + "</div></div>";
    } else {
      h += '<p class="xbw-tip">中文 + 用法是线索，空里要填的是上面某一条词组 —— 选一个就自动进下一题。</p>';
    }
    h += "</div>";
    $("xbw").innerHTML = h;
    if (q.picked) {
      var fbi = document.querySelector(".xbw-fb");
      if (fbi && fbi.scrollIntoView) { try { fbi.scrollIntoView({ block: "nearest" }); } catch (e) {} }
    }
  }
  function quizPick(n) {
    var q = st.quiz;
    if (!q || q.picked || q.used[n]) return;
    var it = q.list[q.i];
    var right = (n === it.n);
    q.picked = { n: n, right: right };
    if (right) { q.right++; q.used[n] = 1; }
    else {
      q.wrong.push({ i: q.i, n: it.n, chosen: (q.list.filter(function (x) { return x.n === n; })[0] || {}).ph || "" });
      /* 错题进「词组错题本」（直连，不排队 —— 报不上就算了，别拦着做题） */
      if (S && S.addPhraseMistake) {
        S.addPhraseMistake({
          no: it.n, phrase: it.ph, stem: splitAt(it.ex, it.blank).pre + "＿＿" + splitAt(it.ex, it.blank).post,
          chosen: (q.list.filter(function (x) { return x.n === n; })[0] || {}).ph || "",
          correct: it.ph
        });
      }
    }
    quizHtml();
    quizTimer(right ? 900 : 1700);
  }
  function quizTimer(ms) {
    if (st.quiz && st.quiz.timer) clearTimeout(st.quiz.timer);
    if (!st.quiz) return;
    st.quiz.timer = setTimeout(function () {
      if (!st.quiz) return;
      st.quiz.picked = null;
      if (st.quiz.i >= st.quiz.list.length - 1) { st.stage = "done"; renderDone(); return; }
      st.quiz.i++;
      quizHtml();
    }, ms);
  }
  /* 手动切走（看成绩 / 重做 / 下一组）时把自动跳题的定时器掐掉，
     否则它晚一步触发会把新画面又盖回题面 */
  function clearQuizTimer() {
    if (st.quiz && st.quiz.timer) { clearTimeout(st.quiz.timer); st.quiz.timer = null; }
  }
  function jumpQuiz(no) {
    readStop();                      // 深链直接从选择题进来：把跟读停下来
    clearQuizTimer();
    st.stage = "quiz";
    newQuiz();
    var at = -1;
    st.quiz.list.forEach(function (x, i) { if (x.n === no) at = i; });
    if (at > 0) { st.quiz.i = at; }
    renderQuiz();
  }
  function renderQuiz() { quizHtml(); }

  /* ---------- 总结 ---------- */
  function renderDone() {
    var q = st.quiz || { right: 0, list: [], wrong: [] };
    var total = q.list.length || 0;
    var h = topHtml("批改总结") + '<span class="xbw-prog">得分 <b>' + q.right + "/" + total + "</b></span></div>";
    var linkWrong = st.link ? st.link.wrong : 0;
    h += '<div class="xbw-done">' +
      (q.right === total ? "全对！这组的词组和用法都稳了。" : "选择题答对 " + q.right + "/" + total + " 题。") +
      (linkWrong ? " 连线中间错了 " + linkWrong + " 次。" : " 连线一次没错。") +
      "</div>";
    if (q.wrong.length) {
      h += '<h3 class="xbw-h3">错题 · ' + q.wrong.length + " 道（已经进词组错题本）</h3>";
      h += '<div class="xbw-mistakes">';
      q.wrong.forEach(function (w) {
        var it = q.list.filter(function (x) { return x.n === w.n; })[0] || {};
        var sp = splitAt(it.ex || "", it.blank || "");
        h += '<div class="xbw-mist">' +
          '<div class="xbw-mq"><span class="xbw-mn">' + (w.i + 1) + "</span>" + esc(sp.pre) +
            '<span class="xbw-blank"></span>' + esc(sp.post) + "</div>" +
          '<div class="xbw-ma">你选：<b class="bad">' + esc(w.chosen) + "</b> · 正确：<b class=\"ok\">" + esc(it.ph) + "</b></div>" +
          '<div class="xbw-mwhy">' + esc(it.why || "") +
            (it.trap ? '<div class="ana-tr">' + esc(it.trap) + "</div>" : "") + "</div>" +
        "</div>";
      });
      h += "</div>";
    } else {
      h += '<p class="xbw-tip">没有错题，可以点「下一组」继续。</p>';
    }
    var last = (st.g + 1) >= Math.max(1, Math.ceil(ALL.length / PER));
    h += '<div class="xbw-foot">' +
      '<button type="button" class="btn pri" data-x="again">再练一遍本组</button>' +
      '<button type="button" class="btn" data-x="cards">📖 回看词组卡</button>' +
      '<button type="button" class="btn" data-x="next"' + (last ? " disabled" : "") + ">下一组 →</button>" +
      "</div>";
    $("xbw").innerHTML = h;
  }

  /* ============================================================
     事件 / 开关
     ============================================================ */
  function onClick(ev) {
    var t = ev.target;
    var xo = t.closest && t.closest("[data-xo]");
    if (xo) { quizPick(+xo.dataset.xo); return; }
    var xl = t.closest && t.closest("[data-xl]");
    if (xl) { linkClick(xl); return; }
    var x = t.closest && t.closest("[data-x]");
    if (!x) return;
    var act = x.dataset.x;
    if (act === "read") { st.play.on ? readStop() : readStart(); return; }
    if (act === "again") { readStart(st.play.i); return; }
    if (act === "speed") {
      if (window.PET_READ) window.PET_READ.nextRate();
      renderPlay();                                   // 先把按钮上的倍速刷新（readCard 不一定会重画）
      if (st.play.on) readCard();                     // 换语速就从这张重念
      return;
    }
    if (act === "go") { readStart(+x.dataset.i); return; }
    if (act === "skip") { readStop(); clearQuizTimer(); st.stage = "link"; newLink(); renderLink(); return; }
    if (act === "toquiz") { st.stage = "quiz"; newQuiz(); renderQuiz(); return; }
    if (act === "toend") { clearQuizTimer(); st.stage = "done"; renderDone(); return; }
    if (act === "again2") { clearQuizTimer(); st.stage = "quiz"; newQuiz(); renderQuiz(); return; }
    if (act === "cards") { stop(); if (window.PET_PHRASE_UI) window.PET_PHRASE_UI.open(st.g); return; }
    if (act === "next") { stop(); start(st.g + 1); return; }
  }

  /* ============================================================
     启动 / 停止
     ============================================================ */
  function start(g) {
    st.g = Math.max(0, g || 0);
    st.stage = "play";
    st.play.i = 0;
    st.play.on = false;
    st.link = null;
    st.quiz = null;
    var box = $("xbw");
    if (!box) return;
    renderPlay();
    document.addEventListener("click", onClick);
    readStart(0);                       // 进来就从第一张开始跟读（一张念完自动接下一张）
  }
  function stop() {
    readStop();
    clearQuizTimer();
    document.removeEventListener("click", onClick);
    if (window.PET_READ) window.PET_READ.cancel();
  }

  window.PET_XBW = {
    start: start, stop: stop, jumpQuiz: jumpQuiz, state: st,
    /* 跟读被浏览器拦下时（iOS 首次要手势）由 phrase.js 调：把按钮换成「点一下开始跟读」 */
    retry: function () { st.blocked = true; if (st.stage === "play") renderPlay(); }
  };
})();
