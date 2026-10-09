/* ===== PET 精读页 · 引擎 ===== */
(function () {
  "use strict";
  var C = window.PET_CONTENT;

  /* =======================================================
     一、状态
     ======================================================= */
  var LS_KEY = "pet-vocab-book1-v1";
  var state = {
    tab: "read",
    quiz: false,      // 做题模式：藏起填入的答案句
    allTr: false,     // 全部显示翻译
    vocab: [],        // 生词本 [{id,type,key,entry}]
    openQ: {},        // 已展开分析的题号
    openV: {},        // 生词本里已展开的行，键为 v.id。
                      // 必须放在 state 里：addVocab 每次都全量重刷 innerHTML，
                      // 展开态若只写 DOM class，点任意一个词就会把已展开的行重置
    activeQ: null
  };

  function loadVocab() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) state.vocab = JSON.parse(raw) || [];
    } catch (e) { state.vocab = []; }
  }
  function saveVocab() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.vocab)); } catch (e) {}
  }

  /* ---- 右半两栏的显示 / 隐藏（与生词本分开存） ---- */
  var LS_UI = "pet-ui-book1-v1";
  var cols = { ana: true, vocab: true };
  // [状态键, 顶栏按钮 id 后缀, 按钮文案]
  var COL_DEFS = [["ana", "Ana", "句子列"], ["vocab", "Vocab", "单词列"]];

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
    if (!box) return;
    box.classList.toggle("hide-ana", !cols.ana);
    box.classList.toggle("hide-vocab", !cols.vocab);
    COL_DEFS.forEach(function (d) {
      var b = document.getElementById("tgl" + d[1]);
      if (!b) return;
      b.classList.toggle("on", cols[d[0]]);
      b.textContent = (cols[d[0]] ? "▣ " : "▢ ") + d[2];
      b.title = (cols[d[0]] ? "收起" : "展开") + d[2];
    });
    // 第一列提示：两栏都收起时改成"已全屏"。基准文案由 switchTab 写入 dataset.orig
    var hint = document.getElementById("col1Hint");
    if (hint && hint.dataset.orig) {
      hint.innerHTML = (!cols.ana && !cols.vocab)
        ? "已全屏 · 可从顶栏重新展开句子 / 单词栏"
        : hint.dataset.orig;
    }
    saveUI();
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
  var elPassage, elVocab, elAna;

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
    var h = "";
    h += '<h1 class="passage-title">' + esc(C.passage.title) + "</h1>";
    h += '<div class="passage-meta">' + esc(C.meta.label) + " · " + C.passage.words + " 词 · " +
      C.passage.sentences + " 句 · 长难句 " + countHard() + " 句</div>";

    C.passage.paragraphs.forEach(function (para, pi) {
      h += '<p class="para">';
      para.forEach(function (sent, si) {
        var cls = "sent" + (sent.hard ? " hard" : "");
        h += '<span class="' + cls + '" data-sent="' + pi + "-" + si + '">';
        h += '<span class="sent-txt">' + renderSentence(sent) + "</span>";
        h += '<span class="row-btns">';
        // 不需要新 JS：这个按钮不带 .w/.ph/.blank/.spk/.trb 任何类，
        // 点击会自然落到 bindPassage 末尾的 .sent 分支 = 高亮 + showAnalysis
        h += '<button class="mini" title="查看这句的讲解">析</button>';
        h += '<button class="mini spk" data-say="' + pi + "-" + si + '" title="0.75倍速英音朗读">🔊</button>';
        h += '<button class="mini trb" data-tr="' + pi + "-" + si + '" title="显示/隐藏翻译">译</button>';
        h += "</span>";
        if (sent.tr) h += '<span class="tr" data-trbox="' + pi + "-" + si + '">' + esc(sent.tr) + "</span>";
        h += "</span> ";
      });
      h += "</p>";
    });
    return h;
  }

  function countHard() {
    var n = 0;
    C.passage.paragraphs.forEach(function (p) {
      p.forEach(function (s) { if (s.hard) n++; });
    });
    return n;
  }

  /* =======================================================
     五、渲染 · 生词本
     ======================================================= */
  function vocabKeyOf(type, key) { return type + ":" + key; }

  function addVocab(type, key, entry) {
    var id = vocabKeyOf(type, key);
    state.vocab = state.vocab.filter(function (v) { return v.id !== id; });
    state.vocab.unshift({ id: id, type: type, key: key, entry: entry });
    if (state.vocab.length > 200) state.vocab.length = 200;
    saveVocab();
    renderVocab();
  }

  function renderVocab() {
    if (!state.vocab.length) {
      elVocab.innerHTML =
        '<div class="empty"><span class="big">📖</span>' +
        "点左边的<b>单词</b>查词<br>点<b>黄色词组</b>看搭配<br><br>" +
        "查过的会攒在这里，<br>这一课学完就是一份复习清单。" +
        "</div>";
      return;
    }
    var h = "";
    state.vocab.forEach(function (v) {
      var e = v.entry;
      var isPh = v.type === "phrase";
      var open = !!state.openV[v.id];
      h += '<div class="vcard' + (isPh ? " phrase" : "") + (open ? " open" : "") + '">';
      h += '<button class="vhead" type="button" aria-expanded="' + (open ? "true" : "false") +
        '" data-vtoggle="' + esc(v.id) + '">';
      h += '<span class="vline">';
      h += '<span class="vw" title="' + esc(v.key) + '">' + esc(v.key) + "</span>";
      h += '<span class="vipa">' + esc(e.ipa || "") + "</span>";
      h += '<span class="vpos">' + esc(e.pos || "") + "</span>";
      h += '<span class="vcn" title="' + esc(stripTags(e.cn || "")) + '">' + (e.cn || "") + "</span>";
      h += '<span class="vcar">▸</span>';
      h += "</span></button>";

      h += '<div class="vbody">';
      // 单行会被省略号截断，这里给出完整信息兜底
      h += '<div class="vfull">' + esc(v.key) +
        (e.ipa ? ' <span>' + esc(e.ipa) + "</span>" : "") + "</div>";
      if (e.note) h += '<div class="vnote">' + e.note + "</div>";
      if (!isPh) {
        var rel = phrasesWith(v.key);
        if (rel.length) {
          h += '<div class="vph">包含它的词组：';
          rel.slice(0, 4).forEach(function (p) {
            h += '<button class="vphchip" data-vph="' + esc(p) + '">' + esc(p) + "</button>";
          });
          h += "</div>";
        }
      }
      h += '<div class="vrow">';
      h += '<button class="vspk" data-vsay="' + esc(v.key) + '">🔊 0.75×</button>';
      h += '<button class="vdel" data-vdel="' + esc(v.id) + '">移除</button>';
      h += "</div></div></div>";
    });
    elVocab.innerHTML = h;
  }

  // 词条释义里带 <b>/<code> 标签，title 属性里要去掉
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


  /* =======================================================
     六、渲染 · 句子分析
     ======================================================= */
  function findSent(ref) {
    var p = ref.split("-");
    return C.passage.paragraphs[+p[0]][+p[1]];
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

  // 面板宽而矮（1080p 下约 490px 高），板块按重要性递减排，
  // 保证不滚动就能看到最核心的句型 / 翻译 / 骨架
  function showAnalysis(ref) {
    var s = findSent(ref);
    var h = '<div class="ana">';
    h += '<div class="ana-h">句子分析</div>';
    h += '<div class="ana-sent">' + esc(s.s.replace(/\{\d+\}/g, "____")) + "</div>";

    if (s.ana) {
      var a = s.ana;

      // 句型 —— 最上层的结论，最先给
      if (a.pat && a.pat.length) {
        h += '<div class="sec"><div class="sec-t">句型</div><div class="chips">';
        a.pat.forEach(function (p, i) {
          h += '<span class="chip pat' + (i === 0 ? " pat0" : "") + '">' + p + "</span>";
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
        h += '<div class="sec"><div class="sec-t">成分拆解</div><table class="struct">';
        a.parts.forEach(function (p) {
          h += "<tr><td>" + p[0] + "</td><td>" + p[1] + "</td></tr>";
        });
        h += "</table></div>";
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
          h += '<button class="chip ph2" data-vph="' + esc(d.key) + '" title="点一下收进生词本">' +
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
  }

  /* =======================================================
     七、渲染 · 题目
     ======================================================= */
  function buildQuestions() {
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
      h += '<button class="mini spk" data-sayraw="' + esc(C.options[L]) + '" title="朗读">🔊</button>';
      h += '<span class="tag">' + (used ? "→ 第 " + used + " 空" : "干扰项") + "</span>";
      h += "</div>";
    });
    h += "</div>";

    // 逐题
    C.questions.forEach(function (q) {
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
  function bindPassage(root) {
    root.addEventListener("click", function (ev) {
      var t = ev.target;

      // 单词优先：被词组包住的词，点的仍然是那个词
      var w = t.closest(".w");
      if (w) {
        var raw = w.dataset.w;
        var res = lookup(raw);
        markActive(w);
        if (res) {
          addVocab("word", raw, res.entry);
        } else {
          addVocab("word", raw, { pos: "", ipa: "", cn: "（未收录）", note: "这个词没进词表，可以补进去。" });
        }
        return;
      }

      // 词组：点黄色区域本身（词与词之间的空档、内边距）才落到词组
      var ph = t.closest(".ph");
      if (ph) {
        var key = ph.dataset.ph;
        var r = lookupPhrase(key);
        markActive(ph);
        if (r) addVocab("phrase", r.key, r.entry);
        else addVocab("phrase", key, { pos: "phrase", ipa: "", cn: "（词组释义待补）" });
        return;
      }

      // 空位
      var bl = t.closest(".blank");
      if (bl) {
        var n = +bl.dataset.blank;
        toggleQ(n);
        return;
      }

      // 喇叭
      var spk = t.closest(".spk");
      if (spk) {
        ev.stopPropagation();
        if (spk.dataset.sayraw) { TTS.speak(spk.dataset.sayraw, spk); return; }
        var s = findSent(spk.dataset.say);
        TTS.speak(cleanSay(s.s), spk);
        return;
      }

      // 翻译按钮
      var trb = t.closest(".trb");
      if (trb) {
        ev.stopPropagation();
        var box = root.querySelector('[data-trbox="' + trb.dataset.tr + '"]');
        if (box) { box.classList.toggle("show"); trb.classList.toggle("on"); }
        return;
      }

      // 句子 → 右栏分析
      var se = t.closest(".sent");
      if (se) {
        root.querySelectorAll(".sent.cur").forEach(function (x) { x.classList.remove("cur"); });
        se.classList.add("cur");
        showAnalysis(se.dataset.sent);
      }
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

  function bindQuestions(root) {
    root.addEventListener("click", function (ev) {
      var t = ev.target;
      var spk = t.closest(".spk");
      if (spk) { ev.stopPropagation(); TTS.speak(spk.dataset.sayraw || "", spk); return; }

      var w = t.closest(".w");
      if (w) {
        var raw = w.dataset.w, res = lookup(raw);
        markActive(w);
        if (res) addVocab("word", raw, res.entry);
        else addVocab("word", raw, { pos: "", ipa: "", cn: "（未收录）" });
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

  function bindVocab(root) {
    root.addEventListener("click", function (ev) {
      var s = ev.target.closest("[data-vsay]");
      if (s) { TTS.speak(s.dataset.vsay, s); return; }
      var d = ev.target.closest("[data-vdel]");
      if (d) {
        state.vocab = state.vocab.filter(function (v) { return v.id !== d.dataset.vdel; });
        delete state.openV[d.dataset.vdel];   // 顺带清掉，否则已删的 id 在这里留垃圾
        saveVocab(); renderVocab();
        return;
      }
      var pc = ev.target.closest("[data-vph]");
      if (pc) {
        var r = lookupPhrase(pc.dataset.vph);
        if (r) addVocab("phrase", r.key, r.entry);
        return;
      }
      // 展开 / 收起整行。放在最后：上面几个按钮都在 .vbody 里，是 .vhead 的兄弟
      var tg = ev.target.closest("[data-vtoggle]");
      if (tg) {
        if (window.getSelection && String(window.getSelection())) return;  // 拖选文字不误触
        var id = tg.dataset.vtoggle;
        state.openV[id] = !state.openV[id];
        renderVocab();
      }
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
    document.getElementById("qList").innerHTML = buildQuestions();
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === tab);
    });
    var isRead = tab === "read";
    document.getElementById("passage").hidden = !isRead;
    document.getElementById("qList").hidden = isRead;
    document.getElementById("col1Title").textContent = isRead ? "原文" : "题目与答案";
    var h1 = document.getElementById("col1Hint");
    h1.dataset.orig = isRead
      ? '点词查词 · <span style="background:var(--phrase);padding:0 4px;border-radius:3px">黄色</span>是词组 · 🔊 0.75×英音'
      : "点「分析」看解析 · 点选项里的词也能查";
    document.getElementById("colAnaHint").textContent =
      isRead ? "点句子查看 · 22 句都能点" : "点「分析」查看";
    applyCols();   // 重新套用列显隐（会顺带刷新第一列提示）
    elAna.innerHTML = '<div class="empty"><span class="big">🔍</span>' +
      (isRead
        ? '点左边<b>任意一句</b>，这里显示讲解<br>句型 · 翻译 · 骨架 · 成分 · 词组<br><br>' +
          '带<span style="color:var(--hard)">橙色底</span>的是长难句'
        : "点题目的「分析」按钮<br>这里显示题目解析") + "</div>";
  }

  function init() {
    PHRASE_IDX = buildPhraseIndex(C.phrases);
    elPassage = document.getElementById("passage");
    elVocab = document.getElementById("vocab");
    elAna = document.getElementById("analysis");

    loadVocab();
    renderPassage();
    renderVocab();
    renderQuestions();

    bindPassage(elPassage);
    bindVocab(elVocab);
    bindVocab(elAna);   // 分析栏里的词组 chip 也要能点进生词本（闭合"点句子→看词组→收录"）
    bindQuestions(document.getElementById("qList"));

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

    var ta = document.getElementById("tglAllTr");
    ta.addEventListener("click", function () {
      state.allTr = !state.allTr;
      document.body.classList.toggle("alltr", state.allTr);
      ta.classList.toggle("on", state.allTr);
      ta.textContent = state.allTr ? "✓ 全部翻译" : "全部翻译";
    });

    document.getElementById("btnClear").addEventListener("click", function () {
      if (!state.vocab.length) return;
      if (confirm("清空生词本？")) { state.vocab = []; saveVocab(); renderVocab(); }
    });

    document.getElementById("btnStop").addEventListener("click", function () { TTS.stop(); });

    // 右半两栏的显示 / 隐藏
    COL_DEFS.forEach(function (d) {
      document.getElementById("tgl" + d[1])
        .addEventListener("click", function () { toggleCol(d[0]); });
    });
    document.querySelectorAll("[data-collapse]").forEach(function (b) {
      // 注意：不要加 + 号。键已改成 "ana"/"vocab" 字符串，+"ana" 是 NaN，
      // cols[NaN] 不报错但按钮会静默失效
      b.addEventListener("click", function () { toggleCol(b.dataset.collapse); });
    });

    loadUI();            // 先读回上次的列状态，再渲染
    switchTab("read");   // switchTab 内部会调 applyCols()
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
