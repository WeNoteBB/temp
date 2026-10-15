/* ===== PET 精读页 · 引擎 ===== */
(function () {
  "use strict";
  var C = window.PET_CONTENT;

  /* =======================================================
     一、状态
     ======================================================= */
  var LS_KEY = "pet-hist-book1-v1";
  var state = {
    tab: "read",
    quiz: false,      // 做题模式：藏起填入的答案句
    hist: [],         // 历史动作 [{t:"w"|"s", k, ref}]，最新的在前
    curHist: "",      // 当前在小黑板里显示的那条，用于高亮
    openQ: {},        // 已展开分析的题号
    activeQ: null
  };

  function loadHist() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) state.hist = JSON.parse(raw) || [];
    } catch (e) { state.hist = []; }
  }
  function saveHist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.hist)); } catch (e) {}
  }

  /* ---- 右半两栏的显示 / 隐藏（与生词本分开存） ---- */
  var LS_UI = "pet-ui-book1-v2";
  var cols = { ana: true, vocab: false };   // vocab 现在指历史浮层，默认收起

  function loadUI() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_UI) || "null");
      if (!o || typeof o !== "object") return;
      // 兼容上一版的 { "2": 单词, "3": 分析 } 结构
      if ("vocab" in o) cols.vocab = !!o.vocab; else if ("2" in o) cols.vocab = !!o["2"];
      if ("ana" in o) cols.ana = !!o.ana; else if ("3" in o) cols.ana = !!o["3"];
    } catch (e) {}
  }
  function saveUI() {
    try { localStorage.setItem(LS_UI, JSON.stringify(cols)); } catch (e) {}
  }

  function applyCols() {
    var box = document.querySelector(".cols");
    if (box) box.classList.toggle("hide-ana", !cols.ana);

    var bAna = document.getElementById("tglAna");
    if (bAna) {
      bAna.classList.toggle("on", cols.ana);
      bAna.textContent = (cols.ana ? "▣ " : "▢ ") + "小黑板";
      bAna.title = (cols.ana ? "收起" : "展开") + "小黑板";
    }
    var bHist = document.getElementById("tglVocab");
    if (bHist) {
      bHist.classList.toggle("on", cols.vocab);
      bHist.textContent = (cols.vocab ? "▣ " : "▢ ") + "历史";
      bHist.title = (cols.vocab ? "收起" : "展开") + "历史浮动面板";
    }
    // 历史不再是网格列，是右侧浮层
    var fl = document.getElementById("histFloat");
    if (fl) fl.hidden = !cols.vocab;

    // 第一列提示：小黑板也收起时改成"已全屏"
    var hint = document.getElementById("col1Hint");
    if (hint && hint.dataset.orig) {
      hint.innerHTML = !cols.ana
        ? "已全屏 · 可从顶栏重新展开小黑板"
        : hint.dataset.orig;
    }
    saveUI();
  }

  /* ---- 字号缩放 ----
     只作用于原文和小黑板（两栏的 font-size / 盒子尺寸都乘了 --zoom）。
     历史浮层、顶栏、页面骨架不参与。 */
  var LS_ZOOM = "pet-zoom-book1-v1";

  function applyZoom(z) {
    z = Math.min(5, Math.max(1, Number(z) || 1));
    document.documentElement.style.setProperty("--zoom", z);
    var lab = document.getElementById("zoomLabel");
    if (lab) lab.textContent = (z % 1 ? z.toFixed(1) : z) + "x";
    var r = document.getElementById("zoomRange");
    if (r && Number(r.value) !== z) r.value = String(z);
    try { localStorage.setItem(LS_ZOOM, String(z)); } catch (e) {}
    // 字号一变，整篇的行位置全变了，页边按钮必须重新量
    gutterNowAndNextFrame();
  }

  function loadZoom() {
    try {
      var v = localStorage.getItem(LS_ZOOM);
      if (v) return Number(v) || 1;
    } catch (e) {}
    return 1;
  }

  function toggleCol(key) {
    cols[key] = !cols[key];
    applyCols();
  }

  /* =======================================================
     二、分词
     ======================================================= */
  // 把句子切成 词 / 标点空白 / 空位 三类片段
  var TOKEN_RE = /\{(\d+)\}|([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;

  function tokenize(text) {
    var out = [], last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) out.push({ k: "p", v: text.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ k: "b", v: m[1] });
      else out.push({ k: "w", v: m[2] });
      last = TOKEN_RE.lastIndex;
    }
    if (last < text.length) out.push({ k: "p", v: text.slice(last) });
    return out;
  }

  /* ---- 词组标注：最长优先，不重叠 ---- */
  function buildPhraseIndex(phrases) {
    var set = new Map(), max = 1;
    phrases.forEach(function (p) {
      var key = p.toLowerCase().trim().replace(/\s+/g, " ");
      var n = key.split(" ").length;
      if (n > max) max = n;
      set.set(key, p);
    });
    return { set: set, max: max };
  }

  // 返回 Map<tokenIndex, {key, end}> 与分组列表
  function markPhrases(tokens, pidx) {
    var wi = [], wl = [];                 // 词 token 的下标 / 小写词形
    tokens.forEach(function (t, i) {
      if (t.k === "w") { wi.push(i); wl.push(t.v.toLowerCase()); }
    });
    // 两个词之间只能有空白，夹了标点就不算一个词组
    function onlySpaceBetween(a, b) {
      for (var k = wi[a] + 1; k < wi[b]; k++) {
        if (tokens[k].k !== "p" || /\S/.test(tokens[k].v)) return false;
      }
      return true;
    }

    var groups = [], taken = new Set();
    for (var n = pidx.max; n >= 2; n--) {
      for (var i = 0; i + n <= wl.length; i++) {
        var free = true;
        for (var j = 0; j < n; j++) {
          if (taken.has(wi[i + j]) || (j > 0 && !onlySpaceBetween(i + j - 1, i + j))) {
            free = false; break;
          }
        }
        if (!free) continue;
        var key = wl.slice(i, i + n).join(" ");
        if (pidx.set.has(key)) {
          for (var q = 0; q < n; q++) taken.add(wi[i + q]);
          groups.push({ from: wi[i], to: wi[i + n - 1], key: key, label: pidx.set.get(key) });
          i += n - 1;
        }
      }
    }
    return groups;
  }

  /* ---- 查词回退：原形 → 小写 → 去屈折 ---- */
  function dedouble(s) {
    return /([bdfglmnprt])\1$/.test(s) ? s.slice(0, -1) : null;
  }
  function lookup(raw) {
    var g = C.glossary;
    var low = raw.toLowerCase();
    var cands = [low];
    function add(x) { if (x && x.length > 1 && cands.indexOf(x) < 0) cands.push(x); }

    if (/[’']s$/.test(low)) add(low.replace(/[’']s$/, ""));
    if (low.slice(-3) === "ies") add(low.slice(0, -3) + "y");
    if (low.slice(-4) === "ives") add(low.slice(0, -4) + "ife");
    if (low.slice(-2) === "es") add(low.slice(0, -2));
    if (low.slice(-1) === "s") add(low.slice(0, -1));
    if (low.slice(-3) === "ing") {
      add(low.slice(0, -3)); add(low.slice(0, -3) + "e");
      add(dedouble(low.slice(0, -3)));
    }
    if (low.slice(-2) === "ed") {
      add(low.slice(0, -2)); add(low.slice(0, -1));
      add(dedouble(low.slice(0, -2)));
    }
    if (low.slice(-3) === "ies") add(low.slice(0, -3) + "y");
    if (low.slice(-2) === "er") { add(low.slice(0, -2)); add(dedouble(low.slice(0, -2))); }
    if (low.slice(-3) === "est") { add(low.slice(0, -3)); add(dedouble(low.slice(0, -3))); }

    for (var i = 0; i < cands.length; i++) {
      if (g[cands[i]]) return { key: cands[i], entry: g[cands[i]], matched: cands[i] !== low };
    }
    return null;
  }
  function lookupPhrase(key) {
    var e = C.glossary[key];
    return e ? { key: key, entry: e } : null;
  }

  /* =======================================================
     三、英音朗读 (0.75x)
     ======================================================= */
  var TTS = (function () {
    var voices = [], chosen = null, checked = false;
    var btn = null;

    function pick() {
      var list = speechSynthesis.getVoices() || [];
      if (!list.length) return;
      voices = list;
      checked = true;
      var gb = list.filter(function (v) { return /^en[-_]GB/i.test(v.lang); });
      // 优先挑英音里的自然音色，再退到任意英音，最后任意英语
      chosen =
        gb.filter(function (v) { return /natural|online|neural/i.test(v.name); })[0] ||
        gb.filter(function (v) { return /libby|sonia|hazel|serena|kate|stephanie|ryan|george|thomas|oliver/i.test(v.name); })[0] ||
        gb[0] ||
        list.filter(function (v) { return /^en/i.test(v.lang); })[0] ||
        null;
      renderNotice();
    }

    function renderNotice() {
      var el = document.getElementById("voiceWarn");
      if (!el) return;
      if (!checked) { el.hidden = true; return; }
      if (!chosen) {
        el.hidden = false;
        el.textContent = "⚠ 系统没找到英语语音，朗读可能不可用";
      } else if (!/^en[-_]GB/i.test(chosen.lang)) {
        el.hidden = false;
        el.textContent = "⚠ 未找到英音(" + chosen.lang + ")，已退回：" + chosen.name;
      } else {
        el.hidden = true;
      }
    }

    function speak(text, button) {
      if (!("speechSynthesis" in window)) {
        alert("这个浏览器不支持语音朗读，建议用 Edge 或 Chrome 打开。");
        return;
      }
      speechSynthesis.cancel();               // 互斥：掐掉上一句
      if (btn) { btn.classList.remove("speaking"); btn = null; }

      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      u.rate = 0.75;                           // 0.75 倍速
      u.pitch = 1;
      if (chosen) u.voice = chosen;
      if (button) {
        btn = button;
        btn.classList.add("speaking");
      }
      u.onend = u.onerror = function () {
        if (btn) { btn.classList.remove("speaking"); btn = null; }
      };
      speechSynthesis.speak(u);
    }

    function stop() {
      speechSynthesis.cancel();
      if (btn) { btn.classList.remove("speaking"); btn = null; }
    }

    if ("speechSynthesis" in window) {
      pick();
      speechSynthesis.onvoiceschanged = pick;
      // Chrome 首次 getVoices() 常为空，延迟再试
      setTimeout(pick, 300);
      setTimeout(pick, 1200);
    }
    return { speak: speak, stop: stop, ready: function () { return !!chosen; } };
  })();

  /* =======================================================
     四、渲染 · 原文
     ======================================================= */
  var elPassage, elHist, elAna;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // 把一句原文渲染成 HTML（词 / 词组 / 空位）
  function renderSentence(sent) {
    var tokens = tokenize(sent.s);
    var groups = markPhrases(tokens, PHRASE_IDX);

    // tokenIndex -> 词组信息
    var phAt = new Map();
    groups.forEach(function (g) {
      for (var i = g.from; i <= g.to; i++) phAt.set(i, g);
    });

    var html = "", i = 0;
    while (i < tokens.length) {
      var t = tokens[i];
      if (t.k === "p") {
        html += esc(t.v);
        i++;
      } else if (t.k === "b") {
        html += renderBlank(t.v);
        i++;
      } else {
        var g = phAt.get(i);
        if (g && g.from === i) {
          // 整段词组
          var inner = "";
          for (var j = g.from; j <= g.to; j++) {
            inner += '<span class="w" data-w="' + esc(tokens[j].v) + '">' + esc(tokens[j].v) + "</span>";
            if (j < g.to && tokens[j + 1].k === "p") inner += esc(tokens[j + 1].v);
          }
          html += '<span class="ph" data-ph="' + esc(g.key) + '">' + inner + "</span>";
          // 词组占用的词已全部渲染；后面的标点/空格交给主循环，别吞掉
          i = g.to + 1;
        } else {
          html += '<span class="w" data-w="' + esc(t.v) + '">' + esc(t.v) + "</span>";
          i++;
        }
      }
    }
    return html;
  }
  function renderBlank(n) {
    var q = C.questions.filter(function (x) { return String(x.n) === String(n); })[0];
    var filled = q && q.answer;
    var cls = "blank" + (filled ? " filled" : "");
    return '<span class="' + cls + '" data-blank="' + n + '">' + n + "</span>";
  }

  function buildPassage() {
    var h = "", gutter = "", n = 0;   // n 是跨段落的全局句序号，用于交替底色
    h += '<h1 class="passage-title">' + esc(C.passage.title) + "</h1>";
    h += '<div class="passage-meta">' + esc(C.meta.label) + " · " + C.passage.words + " 词 · " +
      C.passage.sentences + " 句 · 长难句 " + countHard() + " 句</div>";
    h += '<div class="pgutter" id="pgutter"></div>';

    C.passage.paragraphs.forEach(function (para, pi) {
      h += '<p class="para">';
      para.forEach(function (sent, si) {
        var ref = pi + "-" + si;
        // 句子 inline 连续排版；序号偶数给淡黄底，奇数留白
        h += '<span class="sent' + (n % 2 === 0 ? " alt" : "") +
          (sent.hard ? " hard" : "") + '" data-sent="' + ref + '">';
        h += '<span class="sent-txt">' + renderSentence(sent) + "</span>";
        h += "</span> ";
        // 按钮单独收进页边容器，稍后由 layoutGutter() 按行首位置摆放
        // 「析」必须带 data-ana：它在页边栏里、不在句子内部，
        // 光靠 t.closest(".sent") 找不到归属，点了会毫无反应
        gutter += '<span class="sbtns" data-for="' + ref + '">' +
          '<button class="mini" data-ana="' + ref + '" title="查看这句的讲解">析</button>' +
          '<button class="mini spk" data-say="' + ref + '" title="0.75倍速英音朗读">🔊</button>' +
          "</span>";
        n++;
      });
      h += "</p>";
    });
    return h.replace('<div class="pgutter" id="pgutter"></div>',
      '<div class="pgutter" id="pgutter">' + gutter + "</div>");
  }

  function countHard() {
    var n = 0;
    C.passage.paragraphs.forEach(function (p) {
      p.forEach(function (s) { if (s.hard) n++; });
    });
    return n;
  }

  /* ---- 页边按钮定位 ----
     句子是连续排版的，按钮得挂到右侧页边、对齐到各自那句的第一行。
     纯 CSS 做不到：句子是 inline，绝对定位子元素的包含块是「首尾行片段的并集」，
     左/右边界会落在最长那行的末尾而不是容器右缘。所以用 Range 量出第一行的
     真实顶边，再逐个摆。同一行起了两句时，后一句往下让位，避免叠在一起。 */
  function firstLineTop(el) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var t = w.nextNode();
    var box = el.getBoundingClientRect();
    if (!t) return box.top;
    // 有些环境（jsdom 等）没有 Range.getBoundingClientRect，缺了就退回整块的顶边 ——
    // 对单行句子来说两者相同，多行句子用并集的顶边也仍然是第一行
    if (!document.createRange) return box.top;
    var r = document.createRange();
    if (!r.getBoundingClientRect) return box.top;
    r.setStart(t, 0);
    r.setEnd(t, Math.min(1, t.length));
    var rect = r.getBoundingClientRect();
    return rect && rect.height ? rect.top : box.top;
  }

  function layoutGutter() {
    var gut = document.getElementById("pgutter");
    var box = document.getElementById("passage");
    if (!gut || !box || box.hidden) return;
    var boxRect = box.getBoundingClientRect();
    if (!boxRect.height) return;                       // 不可见时量出来全是 0

    // 第一遍：只量，一个字节都不写 DOM。
    // 边量边写的话，后一句的测量会受前一次写入影响 —— 缩放刚变、布局还在收敛时最容易出问题
    var items = [].slice.call(gut.children).map(function (g) {
      var sent = box.querySelector('.sent[data-sent="' + g.dataset.for + '"]');
      return { g: g, top: sent ? firstLineTop(sent) - boxRect.top : null };
    });

    // 第二遍：按量好的位置统一分配，重叠的往下让位
    var prevBottom = -1e9;
    items.forEach(function (it) {
      if (it.top === null) { it.g.style.display = "none"; return; }
      var top = it.top;
      if (top < prevBottom + 2) top = prevBottom + 2;
      it.g.style.top = Math.round(top) + "px";
      it.g.style.display = "";
      prevBottom = top + (it.g.offsetHeight || 22);
    });
  }

  var gutterTimer = null;
  function scheduleGutter() {
    if (gutterTimer) clearTimeout(gutterTimer);
    gutterTimer = setTimeout(layoutGutter, 60);        // resize / 尺寸变化时防抖
  }

  // 紧接着再量一次：改完 --zoom 后同步那一次有可能拿到尚未收敛的布局，
  // 补一帧再量，保证拿的是新字号下的真实排版
  function gutterNowAndNextFrame() {
    layoutGutter();
    if (window.requestAnimationFrame) requestAnimationFrame(layoutGutter);
  }

  /* =======================================================
     五、渲染 · 生词本
     ======================================================= */
  /* ---- 历史动作列 ----
     只存「类型 + 键」，词条内容到展示时再查表，所以历史数据很小。
     句子存 ref（段-句），标签由前 4 个词 + 省略号现算。 */
  function histKey(it) { return it.t + ":" + (it.t === "w" ? it.k : it.ref); }

  function pushHistory(t, k, ref) {
    var it = { t: t, k: k || "", ref: ref || "" };
    var id = histKey(it);
    state.hist = state.hist.filter(function (x) { return histKey(x) !== id; });
    state.hist.unshift(it);
    if (state.hist.length > 300) state.hist.length = 300;
    saveHist();
    renderHistory();
  }

  // 句子在历史里只显示前 4 个词，后面省略号
  function sentLabel(ref) {
    var s = anaData(ref);
    if (!s) return ref;
    var ws = String(s.s).replace(/\{\d+\}/g, " ").match(/[A-Za-z’'\-]+/g) || [];
    var head = ws.slice(0, 4).join(" ");
    return ws.length > 4 ? head + " …" : head;
  }

  function renderHistory() {
    if (!state.hist.length) {
      elHist.innerHTML =
        '<div class="empty"><span class="big">🕘</span>' +
        "点<b>单词</b>或<b>句子</b>，这里会记一行<br><br>" +
        "同一个再点一次就置顶。" +
        "</div>";
      return;
    }
    var h = "";
    state.hist.forEach(function (it) {
      var isW = it.t === "w";
      var id = histKey(it);
      // 行本身是 div，内部两个 button 平级 —— button 不能嵌套 button
      h += '<div class="hitem ' + (isW ? "w" : "s") +
        (state.curHist === id ? " cur" : "") + '">';
      h += '<button class="hopen" data-hist="' + esc(id) + '" title="重新显示在小黑板">';
      h += '<span class="hbadge">' + (isW ? "词" : "句") + "</span>";
      if (isW) {
        // 只留英文 + 中文意思。音标和词性去掉了 —— 历史列砍半变窄，
        // 而且那两项点开就在小黑板里，这里不重复占地方
        var e = (lookup(it.k) || lookupPhrase(String(it.k).toLowerCase()) || {}).entry || {};
        h += '<span class="hbody">';
        h += '<span class="hlabel">' + esc(it.k) + "</span>";
        h += '<span class="hcn">' + esc(stripTags(e.cn || "—")) + "</span>";
        h += "</span>";
      } else {
        h += '<span class="hlabel">' + esc(sentLabel(it.ref)) + "</span>";
      }
      h += "</button>";
      h += '<button class="hdel" data-histdel="' + esc(id) + '" title="从历史里删掉">✕</button>';
      h += "</div>";
    });
    elHist.innerHTML = h;
  }

  // 词条释义里带 <b>/<code> 标签，纯文本场景（title / 历史行）要去掉
  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, "");
  }

  // 找出包含某个词的词组
  function phrasesWith(word) {
    var w = word.toLowerCase();
    return C.phrases.filter(function (p) {
      return p.toLowerCase().split(/\s+/).indexOf(w) >= 0;
    });
  }


  // 原文例句里把命中的词高亮出来
  function highlightCtx(ctx, key) {
    var safe = esc(ctx);
    var k = esc(key);
    var re = new RegExp("\\b(" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "gi");
    return safe.replace(re, "<em>$1</em>");
  }

  /* =======================================================
     六、渲染 · 小黑板（点词显示词条，点句显示讲解）
     ======================================================= */
  function showWord(key, ctx) {
    key = String(key == null ? "" : key).trim();
    // 判空：拿到空 key 就直接不动面板，免得渲染出一张空卡片。
    // （点到正文的非单词区域时可能走到这里）
    if (!key) return;
    var r = lookup(key) || lookupPhrase(key.toLowerCase());
    var e = (r && r.entry) || {};
    // 词表里查不到、或者查到了但没有任何可展示内容 → 统一给"未收录"，
    // 不要留一张什么都没有的空卡片
    var hasContent = !!(e.cn || e.ipa || e.pos || e.note);
    if (!hasContent) {
      e = { pos: "", ipa: "", cn: "（未收录）", note: "这个词没进词表，可以补进去。" };
    }
    var h = '<div class="ana">';
    h += '<div class="ana-h">词条' +
      '<button class="ana-spk" data-sayraw="' + esc(key) + '">🔊</button></div>';
    h += '<div class="ana-sent">' + esc(key) +
      (e.ipa ? ' <span style="font-weight:400;color:var(--accent)">' + esc(e.ipa) + "</span>" : "") +
      "</div>";
    h += '<div class="sec"><div class="sec-t">释义</div><div class="sec-b">' +
      (e.pos ? '<span class="vpos">' + esc(e.pos) + "</span> " : "") + (e.cn || "") + "</div></div>";
    if (e.note) h += '<div class="sec"><div class="sec-t">用法</div><div class="sec-b">' + e.note + "</div></div>";
    if (ctx) h += '<div class="sec"><div class="sec-t">原文</div><div class="sec-b">' +
      highlightCtx(ctx, key) + "</div></div>";
    var rel = phrasesWith(key);
    if (rel.length) {
      h += '<div class="sec"><div class="sec-t">包含它的词组</div><div class="chips">';
      rel.slice(0, 6).forEach(function (p) {
        h += '<button class="chip ph2" data-word="' + esc(p) + '">' + esc(p) + "</button>";
      });
      h += "</div></div>";
    }
    h += "</div>";
    elAna.innerHTML = h;
    state.curHist = "w:" + key;
    renderHistory();
  }

  function findSent(ref) {
    var p = ref.split("-");
    return C.passage.paragraphs[+p[0]][+p[1]];
  }

  // 统一的 ref 解析：正文句子用 "段-句"，选项用 "opt:A"。
  // 两种都返回 {s, tr, ana, hard}，好让小黑板、历史、高亮走同一套代码
  function anaData(ref) {
    ref = String(ref || "");
    if (ref.indexOf("opt:") === 0) {
      var L = ref.slice(4);
      var oa = (C.optionsAna || {})[L];
      if (!oa || !C.options[L]) return null;
      return { s: C.options[L], tr: oa.tr, ana: oa, hard: false };
    }
    return findSent(ref) || null;
  }

  // 该句实际包含的词组。直接复用正文黄标那套 tokenize + markPhrases，
  // 输入输出与 renderSentence 逐字一致，所以不可能漂移
  function phrasesOf(sent) {
    var groups = markPhrases(tokenize(sent.s), PHRASE_IDX);
    var seen = {}, out = [];
    groups.forEach(function (g) {
      if (seen[g.key]) return;
      seen[g.key] = 1;
      out.push({ key: g.key, label: g.label });
    });
    return out;
  }

  var normPhrase = function (x) {
    return String(x).toLowerCase().replace(/\s+/g, " ").trim();
  };

  /* ---- 句型 → 句子里的对应片段 ----
     ana.parts 每张成分卡片的描述里都有 <code>真实英文片段</code>，
     所以「点句型 → 标红对应部分」可以按标签 + 描述文本匹配出来，
     不用给 22 句手工再标一遍对应关系。
     主句型（主谓宾/主系表/…）是固定搭配，另给一张同义词表。 */
  var PAT_SYN = {
    "主谓宾": ["主语", "谓语", "宾语"],
    "主系表": ["主语", "系动词", "表语"],
    "主谓双宾": ["主语", "谓语", "间接宾语", "直接宾语"],
    "主谓": ["主语", "谓语"],
    "倒装引语": ["倒装", "谓语 + 主语"],
    // 下面这些光靠"包含"匹配不上，得指名道姓
    "with 复合结构": ["伴随状语", "with 复合", "with 结构"],
    "as…as 比较句": ["比较状语从句", "比较从句", "as...as", "as…as"],
    "并列句": ["转折分句", "并列分句"],
    "引语后置": ["谓语 + 主语"],
    "不定式作目的状语": ["目的状语"],
    "不定式作表语": ["表语"],
    "不定式作同位语": ["同位语"],
    "介词宾语从句": ["介词宾语从句", "介词宾语"],
    "定语从句嵌套": ["定语从句"],
    "限制性定语从句": ["定语从句"],
    "非限制性定语从句": ["定语从句"],
    "代词指代": ["代词", "指代"],
    "被动语态": ["被动语态", "被动"],
    "turn out to be": ["表语", "turn out"]
  };

  var anaParts = null;      // 当前小黑板里那句的成分数据
  var anaRawHTML = "";      // .ana-sent 的原始 HTML，清除标记时用来还原

  function partsForPatWith(parts, pat) {
    if (!parts) return [];
    var keys = PAT_SYN[pat] || [pat];
    var hit = [];
    parts.forEach(function (p, i) {
      var label = String(p[0]), desc = String(p[1]);
      var m = keys.some(function (k) {
        // 三个方向都要试：
        // ① 标签里有句型名  ② 句型名里有标签（「不定式作目的状语」↔「目的状语」）
        // ③ 描述里提到过句型名
        return label.indexOf(k) >= 0 || k.indexOf(label) >= 0 || desc.indexOf(k) >= 0;
      });
      if (m) hit.push(i);
    });
    return hit;
  }
  function partsForPat(pat) { return partsForPatWith(anaParts, pat); }

  // 取描述开头的英文片段，遇到中文（含全角括号）就停。
  // 用来兜住那些没有包 <code> 的成分，比如「主语 | Kate Marshall」
  function englishHead(s) {
    var t = stripTags(s);
    var m = t.match(/^[A-Za-z][A-Za-z0-9 ,'’\-–—.]*/);
    return m ? m[0].replace(/[\s,.\-–—]+$/, "").trim() : "";
  }

  // 从命中的成分卡片里取出原文片段。
  // 优先用 <code> 里的；没有 <code> 的退回取描述开头的英文。
  // 最后必须确认片段真的出现在原句里，否则标不到、白白塞进去。
  function snippetsOf(idxs) {
    var out = [], seen = {};
    var hay = anaRawHTML.toLowerCase();
    var inSent = function (t) { return hay.indexOf(esc(t).toLowerCase()) >= 0; };

    idxs.forEach(function (i) {
      var desc = String(anaParts[i][1]);
      var found = [], m, re = /<code>([\s\S]*?)<\/code>/g;
      while ((m = re.exec(desc)) !== null) found.push(stripTags(m[1]).trim());
      if (!found.length) {
        var h = englishHead(desc);
        if (h) found.push(h);
      }
      found.forEach(function (t) {
        t = String(t).trim();
        if (!t) return;
        var use = t;
        // <code> 里常带编辑性插入，如 "(that) Dad was right"、"(and) said"，
        // 这些在原文里没有字面匹配。去掉括号部分再找一次。
        if (!inSent(use)) {
          var stripped = use.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
          if (stripped && inSent(stripped)) use = stripped;
        }
        if (!inSent(use)) return;      // 还是找不到，跳过，别塞进去
        if (seen[use]) return;
        seen[use] = 1;
        out.push(use);
      });
    });
    return out;
  }

  function clearPatMark() {
    var box = elAna.querySelector(".ana-sent");
    if (box) box.innerHTML = anaRawHTML;
    elAna.querySelectorAll(".chip.pat.on").forEach(function (c) { c.classList.remove("on"); });
  }

  function markPat(pat, chip) {
    var box = elAna.querySelector(".ana-sent");
    if (!box) return;
    clearPatMark();                       // 先清掉上一次的标记，再重新标
    if (!anaParts) return;
    var snips = snippetsOf(partsForPat(pat));
    if (!snips.length) return;
    if (chip) chip.classList.add("on");

    // .ana-sent 里只有一段纯文本（没有子元素），所以直接在字符串上算位置、
    // 再重新拼 HTML。比拿正则在 HTML 上做替换安全得多 ——
    // 后者可能把短片段匹配进 class 名、或把已经包好的标签再包一层
    var text = box.textContent, low = text.toLowerCase();
    snips.sort(function (a, b) { return b.length - a.length; });   // 长片段优先
    var marks = [];
    snips.forEach(function (sn) {
      var i = low.indexOf(sn.toLowerCase());
      while (i >= 0) {
        var j = i + sn.length;
        var clash = marks.some(function (m) { return i < m[1] && j > m[0]; });
        if (!clash) { marks.push([i, j]); break; }
        i = low.indexOf(sn.toLowerCase(), i + 1);     // 被占了，往后找下一个
      }
    });
    if (!marks.length) return;

    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", pos = 0;
    marks.forEach(function (m) {
      out += esc(text.slice(pos, m[0]));
      out += '<span class="hl">' + esc(text.slice(m[0], m[1])) + "</span>";
      pos = m[1];
    });
    out += esc(text.slice(pos));
    box.innerHTML = out;

    // 1.1 → 1.0 缩放凸显。transform 对纯 inline 无效，
    // 所以动画期间挂上 .reveal 变 inline-block，播完摘掉、恢复正常换行
    box.querySelectorAll(".hl").forEach(function (sp) {
      sp.classList.add("reveal");
      setTimeout(function () { sp.classList.remove("reveal"); }, 520);
    });
  }

  /* ---- 答题解析 ----
     把某条选项「作为答案」和「作为干扰项」的解析合在一处。
     按需求，这个动作不写进历史列。 */
  function showQExp(L) {
    var ansQ = null;
    C.questions.forEach(function (q) { if (q.answer === L) ansQ = q; });
    var asTrap = [];
    C.questions.forEach(function (q) {
      (q.others || []).forEach(function (o) {
        if (o[0] === L) asTrap.push({ n: q.n, why: o[1] });
      });
    });

    var h = '<div class="ana">';
    h += '<div class="ana-top">';
    h += '<div class="ana-h">答题解析 · 选项 ' + L +
      '<button class="ana-spk" data-sayraw="' + esc(C.options[L]) + '">🔊</button></div>';
    h += '<div class="ana-sent">' + esc(C.options[L]) + "</div>";
    h += "</div>";

    if (ansQ) {
      h += '<div class="sec"><div class="sec-t">它是第 ' + ansQ.n + ' 题的答案</div>' +
        '<div class="sec-b">' + ansQ.why + "</div></div>";
      h += '<div class="sec"><div class="sec-t">线索词 / 衔接</div><div class="chips">';
      (ansQ.clues || []).forEach(function (c) { h += '<span class="chip cl">' + c + "</span>"; });
      h += "</div></div>";
    } else {
      h += '<div class="sec"><div class="sec-t">它不填任何空</div>' +
        '<div class="sec-b">这句是<b>干扰项</b>——五个空都轮不到它。</div></div>';
    }

    if (asTrap.length) {
      h += '<div class="sec"><div class="sec-t">' +
        (ansQ ? "别的题里它也出来搅局" : "它在这些题里被当成干扰项") +
        '</div><div class="sec-b">';
      asTrap.forEach(function (t) {
        h += '<div class="traprow"><b>第 ' + t.n + ' 题</b> — ' + t.why + "</div>";
      });
      h += "</div></div>";
    }

    if (ansQ && ansQ.tip) {
      h += '<div class="sec"><div class="sec-t">做题方法</div><div class="sec-b">' + ansQ.tip + "</div></div>";
    }
    h += "</div>";
    elAna.innerHTML = h;
    state.curHist = "";        // 答题解析不进历史，也不高亮任何历史行
    renderHistory();
  }

  // 面板宽而矮（1080p 下约 490px 高），板块按重要性递减排，
  // 保证不滚动就能看到最核心的句型 / 翻译 / 骨架
  function showAnalysis(ref) {
    var s = anaData(ref);
    if (!s) return;                                  // ref 对不上任何句子，别硬渲染
    anaParts = s.ana && s.ana.parts ? s.ana.parts : null;
    anaRawHTML = esc(s.s.replace(/\{\d+\}/g, "____"));
    var h = '<div class="ana">';
    // 标题 + 原句一起吸顶：面板内容长，滚到下面时原句不能跑掉
    h += '<div class="ana-top">';
    // 喇叭放在面板顶部：窄屏下页边按钮栏被隐藏，这里是唯一的朗读入口
    h += '<div class="ana-h">句子分析' +
      '<button class="ana-spk" data-say="' + esc(ref) + '">🔊</button></div>';
    h += '<div class="ana-sent">' + anaRawHTML + "</div>";
    h += "</div>";

    if (s.ana) {
      var a = s.ana;

      // 句型 —— 最上层的结论，最先给。可点的会在原句里标红对应成分
      if (a.pat && a.pat.length) {
        h += '<div class="sec"><div class="sec-t">句型' +
          '<span style="font-weight:400;color:var(--ink-3);font-size:11.5px">点一下，原句里标出对应部分</span>' +
          "</div><div class=\"chips\">";
        a.pat.forEach(function (p, i) {
          var has = partsForPatWith(a.parts, p).length > 0;
          h += '<button class="chip pat' + (i === 0 ? " pat0" : "") +
            (has ? "" : " static") + '" data-pat="' + esc(p) + '"' +
            (has ? "" : ' title="这句里没有可直接定位的成分"') + ">" + p + "</button>";
        });
        h += "</div></div>";
      }

      if (s.tr) {
        h += '<div class="sec"><div class="sec-t">翻译</div><div class="sec-b">' + esc(s.tr) + "</div></div>";
      }
      if (a.frame) {
        h += '<div class="sec"><div class="sec-t">句子骨架</div><div class="sec-b">' + a.frame + "</div></div>";
      }
      if (a.parts && a.parts.length) {
        // 每项一张圆角卡片：上面成分名、下面内容。底色依次加深（浅灰 → 深灰），
        // 深到一定程度自动换浅色文字，保证对比度
        var np = a.parts.length;
        h += '<div class="sec"><div class="sec-t">成分拆解</div><div class="parts">';
        a.parts.forEach(function (p, i) {
          var t = np > 1 ? i / (np - 1) : 0;
          var l = Math.round(95 - t * 44);            // 95% → 51%
          var fg = l > 72 ? "#1e2430" : "#ffffff";
          h += '<div class="part" style="background:hsl(220 13% ' + l + '%);color:' + fg + '">';
          h += '<span class="pname">' + p[0] + "</span>";
          h += '<span class="pbody">' + p[1] + "</span>";
          h += "</div>";
        });
        h += "</div></div>";
      }
      if (a.clauses && a.clauses.length) {
        h += '<div class="sec"><div class="sec-t">从句 / 语法点</div><div class="chips">';
        a.clauses.forEach(function (c) { h += '<span class="chip cl">' + c + "</span>"; });
        h += "</div></div>";
      }

      // 本句词组：以正文实际标黄的为准（自动推导），手打的搭配作补充
      var derived = phrasesOf(s);
      var manual = a.phrases || [];
      var extra = manual.filter(function (m) {
        return !derived.some(function (d) { return normPhrase(d.label) === normPhrase(m); });
      });
      if (derived.length || extra.length) {
        h += '<div class="sec"><div class="sec-t">本句词组</div><div class="chips">';
        derived.forEach(function (d) {
          h += '<button class="chip ph2" data-word="' + esc(d.key) + '" title="点一下看释义">' +
            esc(d.label) + "</button>";
        });
        extra.forEach(function (m) {
          h += '<span class="chip ph3" title="搭配 / 结构，未进正文词表">' + m + "</span>";
        });
        h += "</div></div>";
      }

      if (a.gram && a.gram.length) {
        h += '<div class="sec"><div class="sec-t">考点</div><div class="chips">';
        a.gram.forEach(function (c) { h += '<span class="chip gr">' + c + "</span>"; });
        h += "</div></div>";
      }
      if (a.tip) {
        h += '<div class="sec"><div class="sec-t">翻译思路</div><div class="sec-b">' + a.tip + "</div></div>";
      }
    } else {
      // 当前 22 句全有 ana，这个分支实际不可达，留着防御未来数据缺失
      h += '<div class="sec"><div class="sec-b" style="color:var(--ink-3)">' +
        "这句还没有讲解数据。" +
        "</div></div>";
    }
    h += "</div>";
    elAna.innerHTML = h;
    state.curHist = "s:" + ref;
    renderHistory();
  }

  /* =======================================================
     七、渲染 · 题目
     ======================================================= */
  // mode="pool"   只出选项池 A–H（原文页用；每题的分析由「答题解析」按钮给）
  // mode="full"   选项池 + 16–20 五道题卡（题目分析页用）
  function buildQuestions(mode) {
    var withAnalysis = mode === "full";
    var h = "";

    // 选项池
    var usedMap = {};
    C.questions.forEach(function (q) { if (q.answer) usedMap[q.answer] = q.n; });

    h += '<div class="qcard" style="background:#fbfcfe">';
    h += '<div class="qhead"><span class="qnum" style="background:var(--ink-3)">A–H</span>' +
      '<span class="qtxt">备选句（8 选 5，多出 3 句是干扰项）</span></div>';
    Object.keys(C.options).forEach(function (L) {
      var used = usedMap[L];
      h += '<div class="opt' + (used ? " used" : "") + '" data-opt="' + L + '">';
      h += '<span class="ol">' + L + "</span>";
      h += '<span class="otxt">' + renderSentence({ s: C.options[L] }) + "</span>";
      // 三个动作：句子分析（结构讲解）/ 朗读 / 答题解析（作为答案或干扰项）
      h += '<span class="oacts">';
      h += '<button class="obtn" data-ana="opt:' + L + '" title="这句的句子结构讲解">句子分析</button>';
      h += '<button class="obtn" data-sayraw="' + esc(C.options[L]) + '" title="0.75 倍速英音朗读">🔊</button>';
      h += '<button class="obtn" data-qexp="' + L + '" title="它作为答案或干扰项的答题解析">答题解析</button>';
      h += "</span>";
      // 原文页不显示「→ 第 N 空」——那就是答案，等于剧透。
      // 「干扰项」同理（说不是答案也是泄露），所以原文页两个标记都不给。
      if (withAnalysis) {
        h += '<span class="tag">' + (used ? "→ 第 " + used + " 空" : "干扰项") + "</span>";
      }
      h += "</div>";
    });
    h += "</div>";

    if (!withAnalysis) return h;   // 原文页只要选项池，下面的题卡和解析都不要

    // 逐题
    C.questions.forEach(function (q) {
      if (!withAnalysis) {
        // 精简版：只有题号 + 题干，点了跳到题目分析页。
        // 注意用 data-qmini 而不是 data-q —— 否则 toggleQ 的
        // querySelector('[data-q]') 会命中这份（文档顺序在前）
        h += '<div class="qcard qmini" data-qmini="' + q.n + '">';
        h += '<div class="qhead"><span class="qnum">' + q.n + "</span>";
        h += '<span class="qtxt">' + esc(q.prompt) + "</span></div>";
        h += '<div class="qbtns"><button class="btn" data-gotoq="' + q.n + '">去题目分析页看解析 →</button></div>';
        h += "</div>";
        return;
      }

      var open = !!state.openQ[q.n];
      h += '<div class="qcard' + (open ? " open" : "") + '" data-q="' + q.n + '">';
      h += '<div class="qhead"><span class="qnum">' + q.n + "</span>";
      h += '<span class="qtxt">' + esc(q.prompt) + "</span></div>";

      h += '<div class="qbtns">';
      h += '<button class="btn pri" data-qbtn="' + q.n + '">' + (open ? "收起分析" : "分析") + "</button>";
      h += '<button class="btn" data-qsay="' + q.n + '">🔊 朗读答案 0.75×</button>';
      h += "</div>";

      h += '<div class="qbody' + (open ? " show" : "") + '">';
      h += '<div class="qans"><span class="lbl">答案</span><span class="letter">' + q.answer + "</span>" +
        '<span class="atxt">' + renderSentence({ s: C.options[q.answer] }) + "</span>" +
        '<button class="mini spk" data-sayraw="' + esc(C.options[q.answer]) + '">🔊</button></div>';

      h += '<div class="qa-sec"><div class="qa-t">为什么选它</div><div class="qa-b">' + q.why + "</div></div>";
      h += '<div class="qa-sec"><div class="qa-t">线索词 / 衔接</div><div class="chips">';
      q.clues.forEach(function (c) { h += '<span class="chip cl">' + c + "</span>"; });
      h += "</div></div>";
      h += '<div class="qa-sec"><div class="qa-t">其他选项为什么不行</div><div class="qa-b">' +
        q.others.map(function (o) { return "<b>" + o[0] + "</b> — " + o[1]; }).join("<br>") + "</div></div>";
      if (q.tip) {
        h += '<div class="qa-sec"><div class="qa-t">做题方法</div><div class="qa-b">' + q.tip + "</div></div>";
      }
      h += "</div></div>";
    });

    return h;
  }

  function showQAnalysis(n) {
    var q = C.questions.filter(function (x) { return x.n === n; })[0];
    if (!q) return;
    var h = '<div class="ana">';
    h += '<div class="ana-h">第 ' + n + ' 题 · 题目分析</div>';
    h += '<div class="ana-sent">' + esc(q.prompt) + "</div>";

    h += '<div class="sec"><div class="sec-t">正确答案</div><div class="sec-b">' +
      '<b>' + q.answer + "</b> — " + esc(C.options[q.answer]) + "</div></div>";

    h += '<div class="sec"><div class="sec-t">解题思路</div><div class="sec-b">' + q.why + "</div></div>";

    if (q.ana) {
      var a = q.ana;
      if (a.parts && a.parts.length) {
        h += '<div class="sec"><div class="sec-t">答案句拆解</div><table class="struct">';
        a.parts.forEach(function (p) { h += "<tr><td>" + p[0] + "</td><td>" + p[1] + "</td></tr>"; });
        h += "</table></div>";
      }
      if (a.gram && a.gram.length) {
        h += '<div class="sec"><div class="sec-t">语法 / 搭配</div><div class="chips">';
        a.gram.forEach(function (c) { h += '<span class="chip gr">' + c + "</span>"; });
        h += "</div></div>";
      }
      if (a.tr) {
        h += '<div class="sec"><div class="sec-t">答案句翻译</div><div class="sec-b">' + esc(a.tr) + "</div></div>";
      }
    }

    h += '<div class="sec"><div class="sec-t">干扰项</div><div class="sec-b">' +
      q.others.map(function (o) { return "<b>" + o[0] + "</b> — " + o[1]; }).join("<br>") + "</div></div>";

    h += "</div>";
    elAna.innerHTML = h;
  }

  /* =======================================================
     八、事件
     ======================================================= */
  // 取该词/词组所在句子的原文，存进生词本一起显示
  function ctxOf(el, root) {
    var sent = el.closest ? el.closest(".sent") : null;
    var box = sent ? sent.querySelector(".sent-txt") : null;
    if (!box && root && root.classList && root.classList.contains("qcard")) box = root;
    return box ? box.textContent.trim().replace(/\s+/g, " ") : "";
  }

  // 高亮当前句：连同它在页边的那组按钮
  function selectSent(ref) {
    document.querySelectorAll(".sent.cur,.opt.cur").forEach(function (x) { x.classList.remove("cur"); });
    // 正文句子是 .sent，选项是 .opt，两种都要能高亮
    var se = ref.indexOf("opt:") === 0
      ? document.querySelector('.opt[data-opt="' + ref.slice(4) + '"]')
      : document.querySelector('.sent[data-sent="' + ref + '"]');
    if (se) se.classList.add("cur");
    document.querySelectorAll(".sbtns.cur").forEach(function (x) { x.classList.remove("cur"); });
    var g = document.querySelector('.sbtns[data-for="' + ref + '"]');
    if (g) g.classList.add("cur");
  }

  function bindPassage(root) {
    root.addEventListener("click", function (ev) {
      var t = ev.target;

      // 喇叭（页边按钮 / 小黑板顶部）
      var spk = t.closest("[data-say]");
      if (spk) {
        ev.stopPropagation();
        var ss = anaData(spk.dataset.say);
        if (ss) TTS.speak(cleanSay(ss.s), spk);
        return;
      }
      var spkRaw = t.closest("[data-sayraw]");
      if (spkRaw) { ev.stopPropagation(); TTS.speak(spkRaw.dataset.sayraw, spkRaw); return; }

      // 选项的「答题解析」：不写进历史
      var qe = t.closest("[data-qexp]");
      if (qe) { showQExp(qe.dataset.qexp); return; }

      // 句子分析（页边的「析」/ 选项的「句子分析」）
      var ab = t.closest("[data-ana]");
      if (ab) {
        var aref = ab.dataset.ana;
        selectSent(aref);
        showAnalysis(aref);
        pushHistory("s", "", aref);
        return;
      }

      // 小黑板里的句型 chip → 在原句里标出对应成分
      var pc = t.closest("[data-pat]");
      if (pc) {
        if (pc.classList.contains("static")) return;      // 这句里定位不到，不响应
        var on = pc.classList.contains("on");
        clearPatMark();
        if (!on) markPat(pc.dataset.pat, pc);             // 再点一次 = 取消标记
        return;
      }

      // 单词优先：被词组包住的词，点的仍然是那个词
      var w = t.closest(".w");
      if (w) {
        var raw = w.dataset.w;
        markActive(w);
        showWord(raw, ctxOf(w, t.closest(".qcard")));
        pushHistory("w", raw);
        return;
      }

      // 词组：点黄色区域本身（词与词之间的空档、内边距）才落到词组
      var ph = t.closest(".ph");
      if (ph) {
        var key = ph.dataset.ph;
        markActive(ph);
        showWord(key, ctxOf(ph, t.closest(".qcard")));
        pushHistory("w", key);
        return;
      }

      // 小黑板里「包含它的词组」的 chip
      var wd = t.closest("[data-word]");
      if (wd) {
        showWord(wd.dataset.word, "");
        pushHistory("w", wd.dataset.word);
        return;
      }

      // 空位
      var bl = t.closest(".blank");
      if (bl) { toggleQ(+bl.dataset.blank); return; }

      // 句子 → 小黑板
      var se = t.closest(".sent");
      if (se) {
        selectSent(se.dataset.sent);
        showAnalysis(se.dataset.sent);
        pushHistory("s", "", se.dataset.sent);
        return;
      }

      // 选项整句 → 小黑板（选项也当句子讲）
      var op = t.closest(".opt");
      if (op && C.optionsAna && C.optionsAna[op.dataset.opt]) {
        var oref = "opt:" + op.dataset.opt;
        selectSent(oref);
        showAnalysis(oref);
        pushHistory("s", "", oref);
      }
    });
  }

  // 历史列
  function bindHistory(root) {
    root.addEventListener("click", function (ev) {
      var d = ev.target.closest("[data-histdel]");
      if (d) {
        var did = d.dataset.histdel;
        state.hist = state.hist.filter(function (x) { return histKey(x) !== did; });
        if (state.curHist === did) state.curHist = "";
        saveHist(); renderHistory();
        return;
      }
      var op = ev.target.closest("[data-hist]");
      if (!op) return;
      var id = op.dataset.hist;
      var it = state.hist.filter(function (x) { return histKey(x) === id; })[0];
      if (!it) return;
      // 重新显示在小黑板，并把它提到最上面
      if (it.t === "w") showWord(it.k, "");
      else { selectSent(it.ref); showAnalysis(it.ref); }
      pushHistory(it.t, it.k, it.ref);
    });
  }

  function cleanSay(s) {
    return s.replace(/\{\d+\}/g, " ").replace(/\s+/g, " ").trim();
  }

  function markActive(el) {
    var scope = el.closest(".col-body") || document;
    scope.querySelectorAll(".w.act,.ph.act").forEach(function (x) { x.classList.remove("act"); });
    el.classList.add("act");
  }

  // 只处理题目卡片自己的东西。点词、点选项句子、喇叭这些
  // 统一交给 bindPassage（也绑在同样的容器上），避免两套逻辑各写一遍
  function bindQuestions(root) {
    root.addEventListener("click", function (ev) {
      var t = ev.target;
      var gq = t.closest("[data-gotoq]");
      if (gq) {
        var gn = +gq.dataset.gotoq;
        state.openQ[gn] = false;      // 置否，好让 toggleQ 这一次一定是展开
        switchTab("quiz");
        toggleQ(gn);
        return;
      }

      var qb = t.closest("[data-qbtn]");
      if (qb) { toggleQ(+qb.dataset.qbtn); return; }

      var qs = t.closest("[data-qsay]");
      if (qs) {
        var q = C.questions.filter(function (x) { return x.n === +qs.dataset.qsay; })[0];
        if (q) TTS.speak(C.options[q.answer], qs);
        return;
      }
    });
  }

  function toggleQ(n) {
    var card = document.querySelector('[data-q="' + n + '"]');
    if (!card) { state.openQ[n] = !state.openQ[n]; renderQuestions(); return; }
    state.openQ[n] = !state.openQ[n];
    var body = card.querySelector(".qbody");
    var btn = card.querySelector("[data-qbtn]");
    if (state.openQ[n]) {
      body.classList.add("show"); card.classList.add("open"); btn.textContent = "收起分析";
      showQAnalysis(n);
    } else {
      body.classList.remove("show"); card.classList.remove("open"); btn.textContent = "分析";
    }
    // 某些环境（如无头浏览器）没有 scrollIntoView，缺了也不该中断流程
    if (card.scrollIntoView) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* =======================================================
     八点五、导出并发送到邮箱

     页面本身发不了信（静态页面没有 SMTP 凭据）。这里只做两件事：
       1. 判断自己是不是被 server/mail-server.cjs 托管的
       2. 是的话，把历史记录整理成 Word 文档 POST 给那个服务

     双击本地打开（file://）时接口探测会失败，按钮保持禁用。
     磁盘上的 HTML 里没有任何密钥 —— 口令由服务端在托管时注入。
     ======================================================= */
  var MAIL_TOKEN = "__MAIL_TOKEN__";   // 服务端托管时会替换掉；本地打开时保持原样
  var serverMode = false;

  function mailMsg(text, kind) {
    var el = document.getElementById("mailMsg");
    if (!el) return;
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "mail-msg" + (kind ? " " + kind : "");
  }

  // 探测是否由服务器托管 —— 据此决定发送按钮能不能点。
  // 窗口重新获得焦点时也探一次：服务可能是在页面打开之后才启动的。
  function detectMailServer() {
    var btn = document.getElementById("btnMail");
    if (!btn) return;
    if (typeof fetch !== "function") return;    // 老浏览器 / jsdom：按钮保持禁用，不许崩
    fetch("api/health").then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (!j || !j.ok) return;
      serverMode = true;
      btn.disabled = false;
      btn.classList.add("on");
      btn.title = "发送到 " + j.to;
    }).catch(function () {
      // file:// 下 fetch 会直接 reject，按钮保持禁用
      serverMode = false;
      btn.disabled = true;
      btn.classList.remove("on");
    });
  }

  function histGroups() {
    var words = [], phrases = [], sents = [];
    state.hist.forEach(function (it) {
      if (it.t === "w") {
        var e = (lookup(it.k) || lookupPhrase(String(it.k).toLowerCase()) || {}).entry;
        if (!e) return;
        (/\s/.test(it.k) ? phrases : words).push({ k: it.k, e: e });
      } else {
        var d = anaData(it.ref);
        if (d) sents.push({ ref: it.ref, d: d });
      }
    });
    return { words: words, phrases: phrases, sents: sents };
  }

  function esc2(s) {
    return String(s == null ? "" : s)
      .replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
  }

  function two(n) { return (n < 10 ? "0" : "") + n; }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) +
      " " + two(d.getHours()) + ":" + two(d.getMinutes());
  }

  // 分级详略：词给音标+词性+中文，词组给释义，句子给原句+翻译+句型
  function buildExportHtml() {
    var g = histGroups();
    var h = "";
    h += '<h1>PET 精读 · ' + esc2(C.passage.title) + "</h1>";
    h += '<div class="meta">' + esc2(C.meta.label) + " ｜ 导出时间 " + stamp() +
      " ｜ 单词 " + g.words.length + " · 词组 " + g.phrases.length + " · 句子 " + g.sents.length + "</div>";

    if (g.words.length) {
      h += "<h2>一、单词</h2>";
      g.words.forEach(function (w, i) {
        h += '<p class="item"><span class="no">' + (i + 1) + ".</span> " +
          '<span class="en">' + esc2(w.k) + "</span> " +
          (w.e.ipa ? '<span class="ipa">' + esc2(w.e.ipa) + "</span> " : "") +
          (w.e.pos ? '<span class="pos">' + esc2(w.e.pos) + "</span> " : "") +
          '<span class="cn">' + stripTags(w.e.cn || "") + "</span></p>";
      });
    }
    if (g.phrases.length) {
      h += "<h2>二、词组</h2>";
      g.phrases.forEach(function (w, i) {
        h += '<p class="item"><span class="no">' + (i + 1) + ".</span> " +
          '<span class="en">' + esc2(w.k) + "</span> " +
          (w.e.ipa ? '<span class="ipa">' + esc2(w.e.ipa) + "</span> " : "") +
          '<span class="cn">' + stripTags(w.e.cn || "") + "</span></p>";
      });
    }
    if (g.sents.length) {
      h += "<h2>三、句子</h2>";
      g.sents.forEach(function (s, i) {
        var a = s.d.ana || {};
        h += '<p class="item"><span class="no">' + (i + 1) + ".</span> " +
          '<span class="sent">' + esc2(String(s.d.s).replace(/\{\d+\}/g, "____")) + "</span></p>";
        if (s.d.tr) h += '<p class="sub">翻译：' + esc2(s.d.tr) + "</p>";
        if (a.pat && a.pat.length) h += '<p class="sub">句型：' + esc2(a.pat.join(" · ")) + "</p>";
        if (a.frame) h += '<p class="sub">骨架：' + stripTags(a.frame) + "</p>";
      });
    }
    if (!g.words.length && !g.phrases.length && !g.sents.length) {
      h += '<p class="item">（历史记录是空的 —— 先在页面上点几个单词或句子）</p>';
    }
    return h;
  }

  var DOC_CSS =
    "@page{size:A4;margin:2cm}" +
    'body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;font-size:11pt;line-height:1.75;color:#1e2430}' +
    "h1{font-size:19pt;margin:0 0 6pt}" +
    "h2{font-size:13pt;margin:20pt 0 9pt;border-bottom:1px solid #ccd;padding-bottom:4pt}" +
    ".meta{color:#888;font-size:9pt;margin-bottom:16pt}" +
    ".item{margin:0 0 7pt}" +
    ".no{color:#999}" +
    ".en{font-weight:bold}" +
    ".ipa{color:#2f6fed;font-family:Consolas,monospace}" +
    ".pos{color:#666}" +
    ".cn{color:#333}" +
    ".sent{font-weight:bold}" +
    ".sub{color:#555;font-size:10pt;margin:0 0 3pt 16pt}";

  // Word 能打开的 HTML（.doc 就是套了 Word 头的 HTML，不用任何库）
  function wordDoc(inner) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' +
      "<title>PET 精读</title>" +
      "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>" +
      "<w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->" +
      "<style>" + DOC_CSS + "</style></head><body>" + inner + "</body></html>";
  }

  // 中文字符串要先按 UTF-8 转字节再 base64，直接 btoa 会炸
  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function doSend() {
    if (!serverMode || typeof fetch !== "function") return;
    var g = histGroups();
    if (!g.words.length && !g.phrases.length && !g.sents.length) {
      mailMsg("历史记录是空的", "err");
      return;
    }
    var btn = document.getElementById("btnMail");
    btn.disabled = true;
    mailMsg("正在发送…");

    var slug = String(C.passage.title).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var payload = {
      token: MAIL_TOKEN,
      subject: "PET 精读 · " + C.passage.title +
        "（" + g.words.length + " 词 / " + g.phrases.length + " 词组 / " + g.sents.length + " 句）",
      filename: "PET精读-" + slug + "-" + stamp().replace(/[: ]/g, "").slice(0, 13) + ".doc",
      content: b64utf8(wordDoc(buildExportHtml())),
      body: "附件是本次精读导出的学习记录。\n\n" +
        "单词 " + g.words.length + " 个：" + g.words.map(function (w) { return w.k; }).join("、") + "\n" +
        (g.phrases.length ? "词组 " + g.phrases.length + " 个：" + g.phrases.map(function (w) { return w.k; }).join("、") + "\n" : "") +
        "句子 " + g.sents.length + " 句。\n\n" +
        "—— 来自 PET 精读页"
    };

    fetch("api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, j: j };
      });
    }).then(function (r) {
      btn.disabled = false;
      if (r.ok && r.j.ok) {
        mailMsg("已发送 ✓", "ok");
        setTimeout(function () { mailMsg(""); }, 6000);
      } else {
        mailMsg("发送失败：" + (r.j.error || "未知错误"), "err");
      }
    }).catch(function (e) {
      btn.disabled = false;
      mailMsg("连不上发信服务：" + e.message, "err");
    });
  }

  /* =======================================================
     九、装配
     ======================================================= */
  var PHRASE_IDX;

  function renderPassage() {
    elPassage.innerHTML = buildPassage();
  }
  function renderQuestions() {
    document.getElementById("qList").innerHTML = buildQuestions("full");
    // 原文页那份只要选项池：每题的分析改从选项行的「答题解析」看
    document.getElementById("qListRead").innerHTML =
      '<div class="qsec-h">题目 · Questions 16–20</div>' + buildQuestions("pool");
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === tab);
    });
    var isRead = tab === "read";
    document.getElementById("passage").hidden = !isRead;
    document.getElementById("qListRead").hidden = !isRead;
    document.getElementById("qList").hidden = isRead;
    document.getElementById("col1Title").textContent = isRead ? "原文 + 题目" : "题目与答案";
    var h1 = document.getElementById("col1Hint");
    h1.dataset.orig = isRead
      ? '点词查词 · 点句子看讲解 · <span style="background:var(--phrase);padding:0 4px;border-radius:3px">黄色</span>是词组'
      : "点「分析」看解析 · 点选项里的词也能查";
    document.getElementById("colAnaHint").textContent =
      isRead ? "点单词或句子" : "点「分析」看题目解析";
    applyCols();   // 重新套用列显隐（会顺带刷新第一列提示）
    elAna.innerHTML = '<div class="empty"><span class="big">🔍</span>' +
      (isRead
        ? '点左边<b>任意一个单词</b>查词<br>点<b>任意一句</b>看讲解'
        : "点题目的「分析」按钮<br>这里显示题目解析") + "</div>";
    state.curHist = "";
    renderHistory();
    if (isRead) layoutGutter();     // 原文重新可见后，量一次页边位置
  }

  function init() {
    PHRASE_IDX = buildPhraseIndex(C.phrases);
    elPassage = document.getElementById("passage");
    elHist = document.getElementById("history");
    elAna = document.getElementById("analysis");

    loadHist();
    renderPassage();
    renderHistory();
    renderQuestions();

    // bindPassage 同时挂在正文和小黑板上：喇叭、词、句子用的是同一套 data 属性
    bindPassage(elPassage);
    bindPassage(elAna);
    bindHistory(elHist);
    // 点词 / 点选项句子 / 喇叭 统一走 bindPassage，两个题目容器都要绑
    bindPassage(document.getElementById("qList"));
    bindPassage(document.getElementById("qListRead"));
    bindQuestions(document.getElementById("qList"));
    bindQuestions(document.getElementById("qListRead"));

    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    var tq = document.getElementById("tglQuiz");
    tq.addEventListener("click", function () {
      state.quiz = !state.quiz;
      document.body.classList.toggle("quiz", state.quiz);
      tq.classList.toggle("on", state.quiz);
      tq.textContent = state.quiz ? "✓ 做题模式" : "做题模式";
    });

    document.getElementById("btnClear").addEventListener("click", function () {
      if (!state.hist.length) return;
      if (confirm("清空历史记录？")) {
        state.hist = []; state.curHist = ""; saveHist(); renderHistory();
      }
    });

    // 鼠标停到页边的「析」上，把对应那句染成粉色；移开恢复原底色
    function peek(ref, on) {
      var se = document.querySelector('.sent[data-sent="' + ref + '"]');
      if (se) se.classList.toggle("peek", on);
    }
    elPassage.addEventListener("mouseover", function (ev) {
      var ab = ev.target.closest && ev.target.closest("[data-ana]");
      if (ab) peek(ab.dataset.ana, true);
    });
    elPassage.addEventListener("mouseout", function (ev) {
      var ab = ev.target.closest && ev.target.closest("[data-ana]");
      if (ab) peek(ab.dataset.ana, false);
    });

    // 页边按钮的位置完全依赖正文的实际排版。只要 #passage 的尺寸变了就重算 ——
    // 不管是窗口缩放、字号缩放还是别的什么引起的，用观测器兜住最稳。
    // .pgutter 是绝对定位、不占流，所以写它的子元素不会反过来改变 #passage 的尺寸，不会死循环。
    window.addEventListener("resize", scheduleGutter);
    if (window.ResizeObserver) {
      new ResizeObserver(scheduleGutter).observe(elPassage);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(layoutGutter).catch(function () {});
    }

    document.getElementById("btnStop").addEventListener("click", function () { TTS.stop(); });

    // 小黑板列的显隐 + 历史浮层的开关
    document.getElementById("tglAna")
      .addEventListener("click", function () { toggleCol("ana"); });
    document.getElementById("tglVocab")
      .addEventListener("click", function () { toggleCol("vocab"); });
    document.getElementById("histClose")
      .addEventListener("click", function () { toggleCol("vocab"); });
    document.querySelectorAll("[data-collapse]").forEach(function (b) {
      // 注意：不要加 + 号。键是 "ana" 字符串，+"ana" 是 NaN，
      // cols[NaN] 不报错但按钮会静默失效
      b.addEventListener("click", function () { toggleCol(b.dataset.collapse); });
    });

    // 字号缩放滑动条
    var zr = document.getElementById("zoomRange");
    zr.addEventListener("input", function () { applyZoom(zr.value); });

    // 发送到邮箱
    document.getElementById("btnMail").addEventListener("click", doSend);
    detectMailServer();
    window.addEventListener("focus", detectMailServer);

    loadUI();            // 先读回上次的列状态，再渲染
    switchTab("read");   // switchTab 内部会调 applyCols()
    applyZoom(loadZoom());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
