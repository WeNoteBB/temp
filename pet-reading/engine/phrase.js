/* PET 精读 · 词组库（分组视图 + 精读模式）
   ===============================================================
   数据由 build.mjs 注入 window.PET_PHRASES —— 内部资料，只放在登录门禁后面。
   · 分组视图：一组一张卡（几条 / 收藏几条 / 错题几道），点进去学
   · 精读模式：一次一张卡 —— 点**词组**看小黑板（释义/用法/例句/翻译/解析/☆），
     点**单词**看读音 + 释义（来自随身小词典）+ 含它的词组；历史浮层记点过的一切
   · 小霸王模式在 engine/xbw.js（window.PET_XBW），这里只负责切视图、传组号
   收藏走和文章页同一条链路（PETStore.addFav）：本地立即生效 + 后台补写。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var D = window.PET_PHRASES || { items: [], dict: {} };
  var ALL = D.items || [];
  var DICT = D.dict || {};
  var PER = 10;                                   // 书上就是 10 个一组
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: "list",          // list | read | xbw | srs
    g: 0,                  // 当前组（0 起）
    i: 0,                  // 精读模式：第几张卡（0 起）
    reading: 0,            // 正在跟读的卡片序号（0 = 没在念）
    favs: {},              // 已收藏（词组按原文、单词按原形）→ 1
    hist: [],              // 历史 [{t:"p"|"w", k}]
    curHist: "",
    ana: true,             // 小黑板是否展开（窄屏 = 底部抽屉升起来）
    mistakes: {},          // 组号 → 错题条数（打开分组视图时现拉）
    today: Date.now()
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function stripTags(s) { return String(s == null ? "" : s).replace(/<[^>]*>/g, ""); }
  function groupCount() { return Math.max(1, Math.ceil(ALL.length / PER)); }
  function groupItems(g) { return ALL.slice(g * PER, g * PER + PER); }
  function rangeTxt(g) {
    var it = groupItems(g);
    return it.length ? it[0].n + "–" + it[it.length - 1].n : "—";
  }
  function byPh(txt) {
    var k = String(txt || "").toLowerCase().trim();
    for (var i = 0; i < ALL.length; i++) if (String(ALL[i].ph).toLowerCase() === k) return ALL[i];
    return null;
  }

  /* ---------- 本地跟读（逐卡 TTS）----------
     一张卡一条跟读：词组（英音）→ 中文意思（女声）→ 例句（英音）→ 例句翻译（女声），
     都是 0.75 倍速（语速可调，记在本机）。念完回调 onDone —— 小霸王就是靠它「读完后 1 秒再翻卡」。
     这段暴露成 window.PET_READ，xbw.js（小霸王）直接复用，两处口径一致。 */
  var K_RATE = "pet:ph:rate";
  var K_VOICE = "pet:ph:voice";                 // { en: "音色名", zh: "音色名" }（空 = 自动挑）
  var RATES = [0.6, 0.75, 1];
  var rate = 0.75;
  var pref = {};
  try {
    var savedRate = parseFloat(localStorage.getItem(K_RATE));
    if (RATES.indexOf(savedRate) >= 0) rate = savedRate;
    var sv = JSON.parse(localStorage.getItem(K_VOICE) || "{}");
    if (sv && typeof sv === "object") pref = sv;
  } catch (e) {}
  var gen = 0;                                  // 每次朗读一个代号，cancel 后旧的 onend 不许再往下走

  function voices() { try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; } }
  function byName(list, name) {
    if (!name) return null;
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  var FEM = /female|woman|女|xiaoxiao|xiaoyi|huihui|yaoyao|tingting|meijia|sinji|lili|zhiyu|xiaohan|xiaomo|xiaorui/i;
  var NAT = /natural|online|neural/i;
  /* 「好音质」的两个信号：名字里带 natural/online，或者根本不是本地音（在线音，比如 Chrome 的 Google 普通话） */
  function good(v) { return !v.localService || NAT.test(v.name); }
  function enList() {
    var vs = voices();
    var gb = vs.filter(function (v) { return /^en[-_]GB/i.test(v.lang); });
    var rest = vs.filter(function (v) { return /^en/i.test(v.lang) && gb.indexOf(v) < 0; });
    return gb.concat(rest);                     // 英音排前面，后面跟其他英语
  }
  function zhList() {
    return voices().filter(function (v) { return /^zh([-_](CN|Hans|SG|Hant))?/i.test(v.lang); });
  }
  function pickEn() {
    var l = enList();
    return byName(l, pref.en) ||                      // ① 学生自己挑的
      l.filter(function (v) { return /^en[-_]GB/i.test(v.lang) && good(v); })[0] ||
      l.filter(function (v) { return /^en[-_]GB/i.test(v.lang); })[0] ||
      l.filter(good)[0] || l[0] || null;
  }
  /* 中文挑女生音：学生自己挑的 > 「好音质 + 女声」> 好音质 > 女声 > 任意中文音 */
  function pickZh() {
    var zh = zhList();
    return byName(zh, pref.zh) ||
      zh.filter(function (v) { return FEM.test(v.name) && good(v); })[0] ||
      zh.filter(good)[0] ||
      zh.filter(function (v) { return FEM.test(v.name); })[0] ||
      zh[0] || null;
  }
  /* 这台设备的语音体检：给页面提示用（没英音、没中文音、没女声…） */
  function diagnose() {
    var en = enList(), zh = zhList();
    var enGb = en.filter(function (v) { return /^en[-_]GB/i.test(v.lang); });
    return {
      en: en.length, zh: zh.length,
      enGb: enGb.length, zhFemale: zh.filter(function (v) { return FEM.test(v.name); }).length,
      enPick: (pickEn() || {}).name || "", zhPick: (pickZh() || {}).name || "",
      noSpeech: !window.speechSynthesis,
      tips: [
        !enGb.length ? "这台设备没有英式语音（en-GB），英文会读成美音 —— Windows：设置→时间和语言→语音→添加「英语（英国）」；iPhone：设置→辅助功能→朗读内容→声音→英语（英国）选 Serena/Kate 并下载增强音。" : "",
        !zh.length ? "这台设备没有中文语音，跟读里的中文会读不出来 —— 装一个中文语音包（安卓：文字转语音里选 Google 语音服务并下载中文数据包）。" : "",
        !zh.filter(function (v) { return FEM.test(v.name); }).length ? "中文没找到女声，会用现有中文音色读。" : ""
      ].filter(Boolean)
    };
  }

  /* 依次念一串句子；mid=每句之间的停顿（毫秒）。
     念完回调 done；等了 700ms 还没出声（iOS 那种「首次必须用户手势」）就回调 onBlocked。 */
  /* 一条卡的跟读素材：有预生成音频（it.ra）就用文件；否则用 TTS 逐句念。
     —— 这是「安卓没有 TTS」的解法：音频文件不依赖设备语音。 */
  var audioEl = null;                 // 复用一个 <audio>，避免每次 new
                                      // ⚠ iOS 上「解锁」是按元素算的：第一次用户手势里 play() 过它，
                                      // 之后小霸王自动翻卡再 play()（没有手势）才不会被拦；换元素就重新上锁。
  function cardAudio(it) {
    if (!it || !it.ra) return "";
    return "assets/read/" + it.n + ".mp3";
  }
  function stopAudio() {
    if (audioEl) { try { audioEl.pause(); } catch (e) {} }
  }

  function speakSeq(list, done, mid) {
    if (!window.speechSynthesis) return;             // 兜底再兜底：连 TTS 都没有就别炸（文件也缺时）
    var my = ++gen;
    var en = pickEn(), zh = pickZh();
    var i = 0, finished = false;
    function step() {
      if (my !== gen) return;                       // 已经被 cancel 了
      if (i >= list.length) { finished = true; if (done) done(); return; }
      var it = list[i++];
      var u = new SpeechSynthesisUtterance(it.t);
      u.lang = it.zh ? "zh-CN" : "en-GB";
      u.rate = rate;
      if (it.zh && zh) u.voice = zh;
      if (!it.zh && en) u.voice = en;
      u.onend = function () { setTimeout(step, mid == null ? 180 : mid); };
      u.onerror = function () { setTimeout(step, 120); };
      window.speechSynthesis.speak(u);
    }
    step();
    if (window.speechSynthesis) {
      setTimeout(function () {
        if (my !== gen || finished) return;
        var ss = window.speechSynthesis;
        if (!ss.speaking && !ss.pending) {          // 还没出声：多半是浏览器要一次用户手势
          gen++;
          try { ss.cancel(); } catch (e) {}
          if (window.PET_READ.onBlocked) window.PET_READ.onBlocked();
        }
      }, 700);
    }
  }
  function speakCancel() {
    gen++;
    stopAudio();
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }
  /* 一张卡的跟读内容：词组 → 中文 → 例句 → 例句翻译 */
  function cardLines(it) {
    var out = [{ t: it.ph, zh: false }];
    if (it.cn) out.push({ t: it.cn, zh: true });
    if (it.ex) out.push({ t: it.ex, zh: false });
    if (it.exCn) out.push({ t: it.exCn, zh: true });
    return out;
  }
  window.PET_READ = {
    has: function () { return !!window.speechSynthesis; },
    /* 这条能不能念：有预生成音频，或者设备有语音合成 */
    canPlay: function (it) { return !!(it && it.ra) || !!window.speechSynthesis; },
    /* 现在这条卡在放的音频地址（空 = 走 TTS 或没在放）；测试/排错用 */
    nowPlaying: function () { return audioEl && audioEl.src ? audioEl.src : ""; },
    _audio: function () { return audioEl; },         // 排错/自动化用：拿到 <audio> 本体（可看 currentTime/paused）
    rate: function () { return rate; },
    setRate: function (r) {
      if (RATES.indexOf(r) < 0) return rate;
      rate = r;
      try { localStorage.setItem(K_RATE, String(r)); } catch (e) {}
      if (audioEl && !audioEl.paused) { try { audioEl.playbackRate = r; } catch (e) {} }
      return rate;
    },
    nextRate: function () { return window.PET_READ.setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]); },
    rates: RATES,
    /* 一条卡：有文件优先播文件（不依赖设备 TTS），没有才退回逐句 TTS */
    card: function (it, done) {
      var src = cardAudio(it);
      if (!src) { speakSeq(cardLines(it), done); return; }
      speakCancel();                                  // 文件优先：TTS 全停
      var my = gen;
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.preload = "auto";
      }
      audioEl.src = src;
      audioEl.playbackRate = rate;                    // 文件按正常语速生成，这里按设置放慢/加快
      audioEl.onended = function () { if (my === gen && done) done(); };
      audioEl.onerror = function () {                 // 文件缺失/坏了 → 退回 TTS
        if (my === gen) speakSeq(cardLines(it), done);
      };
      var p = audioEl.play();
      if (p && p.catch) p.catch(function () {
        if (my === gen && window.PET_READ.onBlocked) window.PET_READ.onBlocked();
      });
    },
    /* 给学生挑音色用：列出这台设备上的音色 + 当前选中的 + 体检提示 */
    voices: function () {
      var pack = function (list) {
        return list.map(function (v) { return { name: v.name, lang: v.lang, nat: NAT.test(v.name) }; });
      };
      var en = enList(), zh = zhList();
      return {
        en: pack(en), zh: pack(zh),
        enPick: (pickEn() || {}).name || "", zhPick: (pickZh() || {}).name || "",
        hint: en.filter(function (v) { return /^en[-_]GB/i.test(v.lang); }).length ? "" :
          "这台设备没报出英式语音（en-GB），英文会用美音读 —— 想听英音就装一个（见下面的办法）"
      };
    },
    setVoice: function (lang, name) {               // "" = 恢复自动
      pref[lang === "zh" ? "zh" : "en"] = String(name || "");
      try { localStorage.setItem(K_VOICE, JSON.stringify(pref)); } catch (e) {}
      return true;
    },
    sample: function (lang) {                       // 试听：英文念第 1 条词组，中文念它的意思
      var it = ALL[0] || { ph: "a couple of", cn: "几个" };
      var en = pickEn(), zh = pickZh();
      speakCancel();
      var u = new SpeechSynthesisUtterance(lang === "zh" ? (it.cn || "你好") : (it.ph || "hello"));
      u.lang = lang === "zh" ? "zh-CN" : "en-GB";
      u.rate = rate;
      if (lang === "zh" && zh) u.voice = zh;
      if (lang !== "zh" && en) u.voice = en;
      window.speechSynthesis.speak(u);
    },
    diagnose: diagnose,
    onBlocked: null,                                // 页面自己挂：iOS 首次要用户点一下时用
    /* 单词读音（词书/小黑板里那种「念一个词」，不属于逐卡跟读） */
    word: function (text) {
      if (!text || !window.speechSynthesis) return;
      speakCancel();
      var en = pickEn();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = "en-GB";
      u.rate = rate;
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    },
    cancel: speakCancel
  };

  /* ---------- 例句分词：单词可点 + 词组标黄（与文章页同一套做法） ---------- */
  var TOKEN_RE = /([A-Za-z]+(?:[’'\-][A-Za-z]+)*)/g;
  function tokenize(text) {
    var out = [], last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) out.push({ k: "p", v: text.slice(last, m.index) });
      out.push({ k: "w", v: m[1] });
      last = TOKEN_RE.lastIndex;
    }
    if (last < text.length) out.push({ k: "p", v: text.slice(last) });
    return out;
  }
  /* 词组索引：整座词组库都用上（例句里的「其他词组」也能点） */
  function buildPhraseIndex() {
    var set = new Map(), max = 1;
    ALL.forEach(function (it) {
      var key = String(it.ph).toLowerCase().trim().replace(/\s+/g, " ");
      var n = key.split(" ").length;
      if (n > max) max = n;
      set.set(key, it);
    });
    return { set: set, max: max };
  }
  var PIDX = buildPhraseIndex();

  function markPhrases(tokens, pidx) {
    var wi = [], wl = [];
    tokens.forEach(function (t, i) {
      if (t.k === "w") { wi.push(i); wl.push(t.v.toLowerCase()); }
    });
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
          if (taken.has(wi[i + j]) || (j > 0 && !onlySpaceBetween(i + j - 1, i + j))) { free = false; break; }
        }
        if (!free) continue;
        var key = wl.slice(i, i + n).join(" ");
        if (pidx.set.has(key)) {
          for (var q = 0; q < n; q++) taken.add(wi[i + q]);
          groups.push({ from: wi[i], to: wi[i + n - 1], key: key, item: pidx.set.get(key) });
          i += n - 1;
        }
      }
    }
    return groups;
  }
  /* 句子 → HTML：单词包成可点按钮，词组整体标黄可点 */
  function renderTokens(src, opts) {
    opts = opts || {};
    var tokens = tokenize(String(src));
    var groups = markPhrases(tokens, PIDX);
    var at = {};
    groups.forEach(function (g) { at[g.from] = g; at[g.to] = g; });
    var out = "", i = 0;
    while (i < tokens.length) {
      var t = tokens[i], g = at[i];
      if (t.k === "p") { out += esc(t.v); i++; continue; }
      if (g && g.from === i) {
        var on = state.curHist === "p:" + g.item.ph ? " cur" : "";
        out += '<button type="button" class="ph-ph' + on + '" data-ph="' + esc(g.item.ph) + '">' +
          esc(tokens.slice(g.from, g.to + 1).map(function (x) { return x.v; }).join("")) + "</button>";
        for (var k = g.from; k <= g.to; k++) delete at[k];
        i = g.to + 1;
        continue;
      }
      if (opts.words === false) { out += esc(t.v); i++; continue; }
      var low = t.v.toLowerCase();
      out += '<button type="button" class="ph-w' + (opts.hl === low ? " hl" : "") +
        '" data-w="' + esc(t.v) + '">' + esc(t.v) + "</button>";
      i++;
    }
    return out;
  }

  /* ---------- 卡片 ---------- */
  function favIdOf(it) { return (it.type || "w") + ":" + it.key; }
  function isFav(id) { return !!state.favs[id]; }
  function phraseFavItem(it) {
    return {
      type: "p",
      key: it.ph,
      cn: it.cn,
      use: it.use || "",
      ex: it.ex,
      exTr: it.exCn,
      no: it.n,
      title: D.title || "PET 词组库",
      slug: "phrases"
    };
  }
  function starBtn(item, cls) {
    var id = favIdOf(item);
    var on = isFav(id);
    var isBtn = cls === "btn";
    return '<button type="button" class="' + (cls || "hfav") + (on ? " on" : "") + '" data-phfav="' + esc(id) +
      '" title="' + (on ? "取消收藏" : "收藏") + '">' +
      (isBtn ? (on ? "★ 已收藏" : "☆ 收藏") : (on ? "★" : "☆")) + "</button>";
  }

  function cardHtml(it) {
    var pos = state.i + 1, total = groupItems(state.g).length;
    var pct = Math.round(pos / total * 100);
    return '<div class="ph-card" data-card="' + it.n + '">' +
      '<div class="ph-nav">' +
        '<button type="button" class="btn" id="phPrev"' + (state.i === 0 ? " disabled" : "") + ">‹ 上一张</button>" +
        '<span class="ph-pos">' + pos + "/" + total + "</span>" +
        '<button type="button" class="btn" id="phNext"' + (state.i >= total - 1 ? " disabled" : "") + ">下一张 ›</button>" +
        '<span class="ph-pbar"><i style="width:' + pct + '%"></i></span>' +
        starBtn(phraseFavItem(it)) +
      "</div>" +
      '<div class="ph-chead">' +
        '<span class="ph-n">' + it.n + "</span>" +
        '<button type="button" class="ph-mainph" data-ph="' + esc(it.ph) + '">' + esc(it.ph) + "</button>" +
        (it.alt ? '<span class="ph-alt">' + esc(it.alt) + "</span>" : "") +
      "</div>" +
      '<div class="ph-cn">' + esc(it.cn) + "</div>" +
      '<div class="ph-use"><span class="ph-usek">用法</span>' + esc(it.use) + "</div>" +
      '<div class="ph-ex">' + renderTokens(it.ex) + "</div>" +
      '<div class="ph-excn">' + esc(it.exCn) + "</div>" +
      '<div class="ph-tools">' +
        '<button type="button" class="btn pri" data-playread="' + it.n + '">▶ 播放跟读</button>' +
        '<button type="button" class="btn" data-phana="' + esc(it.ph) + '">看解析</button>' +
      "</div>" +
    "</div>";
  }

  /* 逐卡跟读的播放状态（精读模式全手动：点「▶ 播放跟读」才念，念完不自动翻卡） */
  function stopRead() {
    if (state.reading) { window.PET_READ.cancel(); state.reading = 0; renderCard(); }
  }
  function playRead() {
    var list = groupItems(state.g);
    var it = list[state.i];
    if (!it) return;
    var btn = document.querySelector("[data-playread]");
    if (!window.PET_READ || !window.PET_READ.canPlay(it)) {
      if (btn) {                                  // 没文件、也没语音合成：给一句话，不装作在念
        btn.textContent = "（这台设备没有语音，这条也没有音频）";
        setTimeout(function () { renderCard(); }, 1600);
      }
      return;
    }
    if (state.reading) { stopRead(); return; }
    state.reading = it.n;
    renderCard();
    window.PET_READ.card(it, function () {          // 念完（词组→中文→例句→翻译）
      if (state.reading === it.n) { state.reading = 0; renderCard(); }
    });
  }

  function renderCard() {
    var list = groupItems(state.g);
    var slot = $("phCard");
    if (!list.length) { slot.innerHTML = '<div class="ph-empty">这一组还没有内容。</div>'; return; }
    if (state.i >= list.length) state.i = list.length - 1;
    $("phCardTitle").textContent = "第 " + (state.g + 1) + " 组 · 词组卡（" + rangeTxt(state.g) + "）";
    slot.innerHTML = cardHtml(list[state.i]);
    var btn = slot.querySelector("[data-playread]");
    if (btn && state.reading === list[state.i].n) btn.textContent = "⏸ 停止跟读";
  }
  function gotoCard(i) {
    var list = groupItems(state.g);
    stopRead();                                     // 翻卡就停掉上一张的跟读（全手动）
    state.i = Math.max(0, Math.min(list.length - 1, i));
    renderCard();
    var el = document.querySelector(".ph-card");
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }

  /* ---------- 小黑板 ---------- */
  /* 窄屏把小黑板当底部抽屉：点东西时才升起来（和文章页一样） */
  function isNarrow() {
    return !!(window.matchMedia && window.matchMedia("(max-width:1099px)").matches);
  }
  function applyAna() {
    var cols = $("cols");
    if (!cols) return;
    cols.classList.toggle("hide-ana", !state.ana);
    var btn = $("anaCollapse");
    if (btn) btn.textContent = state.ana ? "✕" : "▲";
  }
  function ensureAnaShown() {
    if (!state.ana) { state.ana = true; applyAna(); }
  }

  function anaLines(it) {
    var h = '<div class="ana-sec"><h4 class="ana-h">' + esc(it.ph) + "</h4>";
    h += '<div class="ana-row"><span class="ana-k">释义</span><span class="ana-v">' + esc(it.cn) + "</span></div>";
    if (it.use) h += '<div class="ana-row"><span class="ana-k">用法</span><span class="ana-v">' + esc(it.use) + "</span></div>";
    h += '<div class="ana-row"><span class="ana-k">例句</span><span class="ana-v">' + esc(it.ex) +
      '<div class="ana-tr">' + esc(it.exCn) + "</div></span></div>";
    if (it.why) h += '<div class="ana-row"><span class="ana-k">解析</span><span class="ana-v">' + esc(it.why) +
      (it.trap ? '<div class="ana-tr">' + esc(it.trap) + "</div>" : "") + "</span></div>";
    h += '<div class="ph-ana-tools">' + starBtn(phraseFavItem(it), "btn") + "</div>";
    h += "</div>";
    return h;
  }

  function showPhrase(txt, push) {
    var it = byPh(txt);
    if (!it) return;
    if (push !== false) pushHistory("p", it.ph);
    state.curHist = "p:" + it.ph;
    $("anaHint").textContent = "词组 · 点 ☆ 收藏";
    $("analysis").innerHTML = anaLines(it);
    renderCard();                       // 高亮当前词组
    ensureAnaShown();
  }

  /* 单词条：读音 + 释义（随身小词典，没命中就标「词义待补」）+ 含它的词组 + ☆ */
  /* 相关词组：词组里含这个词，或者它的例句里出现了这个词
     （点 piano 时能顺带看到「这条例句里的词组」，点 way 直接看到 a way of doing sth）。 */
  function phrasesWith(word) {
    var w = String(word || "").toLowerCase();
    if (!w) return [];
    var re;
    try { re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"); } catch (e) { return []; }
    var out = [];
    ALL.forEach(function (it) {
      var words = String(it.ph).toLowerCase().match(/[a-z]+(?:['’\-][a-z]+)*/g) || [];
      if (words.indexOf(w) >= 0 || re.test(String(it.ex).toLowerCase())) out.push(it);
    });
    return out;
  }
  function showWord(rawW, ctxEx) {
    var low = String(rawW || "").toLowerCase();
    var d = DICT[low] || null;
    var base = d ? d.w : low;
    pushHistory("w", base);
    state.curHist = "w:" + base;
    var h = '<div class="ana-sec">' +
      '<h4 class="ana-h">' + esc(base) +
      ' <button type="button" class="wd-spk" data-word="' + esc(base) + '" title="读这个单词">🔊</button></h4>';
    if (d) {
      h += '<div class="ana-row"><span class="ana-k">读音</span><span class="ana-v">' + esc(d.ipa || "—") +
        (d.pos ? ' <span class="vpos">' + esc(d.pos) + "</span>" : "") + "</span></div>";
      h += '<div class="ana-row"><span class="ana-k">释义</span><span class="ana-v">' + esc(stripTags(d.cn || "—")) + "</span></div>";
    } else {
      h += '<div class="ana-row"><span class="ana-k">释义</span><span class="ana-v ana-none">' +
        "这个词还没收录（词典分批在补）—— 先看下面含它的词组。</span></div>";
    }
    var ps = phrasesWith(base);
    h += '<div class="ana-row"><span class="ana-k">相关词组</span><span class="ana-v">' +
      (ps.length ? ps.map(function (it) {
        return '<button type="button" class="chip ph2" data-ph="' + esc(it.ph) + '">' + esc(it.ph) + "</button>";
      }).join(" ") : '<span class="ana-none">库里暂时没有和这个词相关的词组。</span>') + "</span></div>";
    /* 单词也能收藏（进「我的词书」）：释义有就带上，没有就留空 */
    var item = {
      type: "w", key: base, cn: d ? stripTags(d.cn || "") : "", ipa: d ? d.ipa : "", pos: d ? d.pos : "",
      ex: ctxEx || "", exTr: "", title: D.title || "PET 词组库", slug: "phrases"
    };
    h += '<div class="ph-ana-tools">' + starBtn(item, "btn") + "</div></div>";
    $("anaHint").textContent = "单词 · 点 ☆ 收藏进词书";
    $("analysis").innerHTML = h;
    renderCard();
    ensureAnaShown();
  }

  /* ---------- 历史 ---------- */
  var LS_HIST = "pet:hist:v1:phrases-";
  function loadHist() {
    try {
      var raw = localStorage.getItem(LS_HIST + (state.g + 1));
      state.hist = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.hist)) state.hist = [];
    } catch (e) { state.hist = []; }
  }
  function saveHist() {
    try { localStorage.setItem(LS_HIST + (state.g + 1), JSON.stringify(state.hist.slice(0, 300))); } catch (e) {}
  }
  function histKey(it) { return it.t + ":" + it.k; }
  function pushHistory(t, k) {
    var it = { t: t, k: k };
    var id = histKey(it);
    state.hist = state.hist.filter(function (x) { return histKey(x) !== id; });
    state.hist.unshift(it);
    saveHist();
    renderHistory();
  }
  function renderHistory() {
    var box = $("history");
    if (!state.hist.length) {
      box.innerHTML = '<div class="empty"><span class="big">🕘</span>点<b>词组</b>或<b>单词</b>，这里会记一行<br><br>同一个再点一次就置顶。</div>';
      return;
    }
    var h = "";
    state.hist.forEach(function (it) {
      var isP = it.t === "p";
      var id = histKey(it);
      var item = isP
        ? (byPh(it.k) ? phraseFavItem(byPh(it.k)) : null)
        : { type: "w", key: it.k, cn: (DICT[it.k] || {}).cn || "" };
      var on = item ? isFav(favIdOf(item)) : false;
      h += '<div class="hitem ' + (isP ? "s" : "w") + (state.curHist === id ? " cur" : "") + '">';
      h += '<button class="hopen" data-hist="' + esc(id) + '" title="重新显示在小黑板">';
      h += '<span class="hbadge">' + (isP ? "组" : "词") + "</span>";
      h += '<span class="hbody"><span class="hlabel">' + esc(it.k) + "</span>";
      if (isP) {
        var it2 = byPh(it.k);
        h += '<span class="hcn">' + esc(it2 ? it2.cn : "") + "</span>";
      } else {
        var d = DICT[it.k] || {};
        h += '<span class="hcn">' + esc(d.cn ? stripTags(d.cn) : "—") + "</span>";
      }
      h += "</span></button>";
      h += '<button class="hfav' + (on ? " on" : "") + '" data-phfav="' + esc(item ? favIdOf(item) : "") +
        '" title="' + (on ? "取消收藏" : "收藏") + '">' + (on ? "★" : "☆") + "</button>";
      h += '<button class="hdel" data-histdel="' + esc(id) + '" title="从历史里删掉">✕</button>';
      h += "</div>";
    });
    box.innerHTML = h;
  }

  /* ---------- 收藏（走 store 的同一条链路） ---------- */
  function favItemById(id) {
    var parts = String(id).split(":");
    var t = parts[0], k = parts.slice(1).join(":");
    if (t === "p") { var it = byPh(k); return it ? phraseFavItem(it) : null; }
    var d = DICT[k] || {};
    return { type: "w", key: k, cn: d.cn ? stripTags(d.cn) : "", ipa: d.ipa || "", pos: d.pos || "",
             title: D.title || "PET 词组库", slug: "phrases" };
  }
  function toggleFav(id) {
    var item = favItemById(id);
    if (!item || !S || !S.addFav) return;
    S.addFav(item).then(function (r) {
      r = r || {};
      if (!r.ok) return;
      if (r.added) state.favs[id] = 1; else delete state.favs[id];
      paintFavs();
      renderCard();
      renderHistory();
      renderGroups();
    });
  }
  function paintFavs() {
    document.querySelectorAll("[data-phfav]").forEach(function (b) {
      var on = !!state.favs[b.dataset.phfav];
      b.classList.toggle("on", on);
      if (b.classList.contains("btn")) b.textContent = on ? "★ 已收藏" : "☆ 收藏";
    });
    document.querySelectorAll(".hfav[data-phfav]").forEach(function (b) {
      var on = !!state.favs[b.dataset.phfav];
      b.textContent = on ? "★" : "☆";
      b.title = on ? "取消收藏" : "收藏";
    });
  }

  /* ---------- 分组视图 ---------- */
  function groupCardHtml(g) {
    var list = groupItems(g);
    var favN = 0;
    list.forEach(function (it) { if (isFav("p:" + it.ph)) favN++; });
    var wrongN = state.mistakes[g] || 0;
    return '<div class="ph-gcard">' +
      '<div class="ph-ghead"><span class="ph-gt">第 ' + (g + 1) + " 组</span>" +
        '<span class="ph-gr">' + rangeTxt(g) + "</span>" +
        '<span class="ph-gm">' + list.length + " 条" +
          (favN ? ' · 已收藏 <b>' + favN + "</b>" : "") +
          (wrongN ? ' · 错题 <b class="warn">' + wrongN + "</b>" : "") + "</span></div>" +
      '<div class="ph-gsub">' + esc(list.slice(0, 3).map(function (x) { return x.ph; }).join(" · ")) +
        (list.length > 3 ? " …" : "") + "</div>" +
      '<div class="ph-gbtns">' +
        '<button type="button" class="btn pri" data-phread="' + g + '">📖 精读模式</button>' +
        '<button type="button" class="btn" data-phxbw="' + g + '">🕹 小霸王模式</button>' +
      "</div></div>";
  }
  function renderGroups() {
    var h = "";
    for (var g = 0; g < groupCount(); g++) h += groupCardHtml(g);
    h += '<p class="ph-foot">速查表（10 个一组的清单 + 填空练习）：<a class="lnk" href="collocations.html">打开 →</a></p>';
    $("phGroups").innerHTML = h;
  }
  /* 错题条数（打开分组视图时现拉一次；离线就按 0 显示） */
  function loadMistakes() {
    if (!S || !S.listPhraseMistakes) return Promise.resolve();
    return S.listPhraseMistakes().then(function (arr) {
      state.mistakes = {};
      (arr || []).forEach(function (m) {
        var g = Math.floor(((Number(m.no) || 1) - 1) / PER);
        state.mistakes[g] = (state.mistakes[g] || 0) + 1;
      });
      renderGroups();
    }).catch(function () {});
  }

  /* ---------- 视图切换 ---------- */
  function setView(v, scroll) {
    state.view = (v === "read" || v === "xbw" || v === "srs") ? v : "list";
    if (state.view !== "read") stopRead();          // 离开精读模式就停掉跟读
    document.querySelectorAll("[data-phview]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.phview === state.view);
    });
    $("viewList").hidden = state.view !== "list";
    $("viewRead").hidden = state.view !== "read";
    $("viewXbw").hidden = state.view !== "xbw";
    $("viewSrs").hidden = state.view !== "srs";
    if (state.view === "xbw") {
      if (window.PET_SRS) window.PET_SRS.stop();
      if (window.PET_XBW) window.PET_XBW.start(state.g);
    } else if (window.PET_XBW) {
      window.PET_XBW.stop();
      if (state.view === "srs") { if (window.PET_SRS) window.PET_SRS.open(); }
      else if (window.PET_SRS) window.PET_SRS.stop();
    }
    if (state.view === "read") renderCard();
    /* 切视图滚回顶部：用 scrollTop 而不是 window.scrollTo ——
       jsdom 的 scrollTo 是「未实现」会往虚拟控制台写一条错误（冒烟会当成 JS 报错） */
    if (scroll) {
      try {
        document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
      } catch (e) {}
    }
  }
  function openGroup(g, view) {
    state.g = Math.max(0, Math.min(groupCount() - 1, g));
    state.i = 0;
    state.curHist = "";
    loadHist();
    renderHistory();
    $("tglHist").classList.remove("on");
    $("histFloat").hidden = true;
    $("analysis").innerHTML = '<div class="empty"><span class="big">💡</span>点左边的<b>词组</b>看释义、用法和解析；<br>点<b>单词</b>听读音、看相关词组。</div>';
    state.ana = !isNarrow();
    applyAna();
    setView(view || "read", true);
  }

  /* ---------- 音色面板（🎙）：列出这台设备的音色，挑英文/中文各一个，能试听 ---------- */
  function voiceRowHtml(v, lang, cur, explicit) {
    var on = !!explicit && v.name === explicit;      // ● 只标「学生自己挑的」；自动挑的在下面那行里写明
    return '<div class="vp-row' + (on ? " on" : "") + '" data-v="' + esc(v.name) + '" data-lang="' + lang + '">' +
      '<button type="button" class="vp-pick" data-voice="' + esc(v.name) + '" data-vlang="' + lang + '">' +
        '<span class="vp-radio">' + (on ? "●" : "○") + "</span>" +
        '<span class="vp-name">' + esc(v.name) + "</span>" +
        '<span class="vp-lang">' + esc(v.lang) + (v.nat ? " · 自然音" : "") + "</span>" +
      "</button>" +
      '<button type="button" class="btn vp-say" data-say2="' + lang + '" title="试听">🔊</button>' +
    "</div>";
  }
  function renderVoicePanel() {
    var box = $("voicePanel");
    if (!box) return;
    var R = window.PET_READ;
    if (!R) { box.hidden = true; return; }
    var V = R.voices();
    var d = R.diagnose();
    var enPref = localPref("en"), zhPref = localPref("zh");
    var shortName = function (n) { return String(n || "—").replace(/\s*[-–—]\s*(English|Chinese|Microsoft|Google)\b.*$/i, "").slice(0, 26); };
    var h = '<div class="syn-pop-mask" data-voice-close="1"></div>' +
      '<div class="syn-pop-card" role="dialog" aria-label="音色设置">' +
      '<div class="syn-pop-h"><span class="syn-pop-w">🎙 跟读音色</span>' +
        '<button type="button" class="syn-pop-x" data-voice-close="1" title="关闭">✕</button></div>' +
      '<p class="syn-pop-from">这台设备报出 ' + (V.en.length + V.zh.length) + " 个可用音色" +
        "（跟读速度固定 " + R.rate() + "×，可在第一关/精读卡上单独调）</p>" +
      '<p class="syn-pop-from">跟读优先播「预生成音频」（晓晓 / Libby，音色固定、不依赖设备）；' +
        "只有没有音频的条目才退回下面这套音色。</p>";
    if (!V.en.length && !V.zh.length) {
      h += '<p class="vp-none">这台设备没报出可用音色（可能是浏览器太老或系统没装语音）。' +
        "有预生成音频的条目照样能跟读；没音频的条目会念不出来 —— 换 Edge / Chrome 一般就有。</p>";
    } else {
      h += '<h4 class="vp-h">英文（词组 / 例句）</h4>';
      h += '<div class="vp-list">' +
        '<button type="button" class="vp-auto' + (enPref ? "" : " on") + '" data-voice="" data-vlang="en">' +
          '自动（推荐）<span class="vp-lang">现在是：' + esc(shortName(V.enPick)) + "</span></button>" +
        V.en.map(function (v) { return voiceRowHtml(v, "en", V.enPick, enPref); }).join("") + "</div>";
      h += '<h4 class="vp-h">中文（意思 / 例句翻译）</h4>';
      h += '<div class="vp-list">' +
        '<button type="button" class="vp-auto' + (zhPref ? "" : " on") + '" data-voice="" data-vlang="zh">' +
          '自动（推荐女声）<span class="vp-lang">现在是：' + esc(shortName(V.zhPick)) + "</span></button>" +
        V.zh.map(function (v) { return voiceRowHtml(v, "zh", V.zhPick, zhPref); }).join("") + "</div>";
      h += '<p class="vp-cur">当前：英文 <b>' + esc(V.enPick || "—") + "</b> · 中文 <b>" + esc(V.zhPick || "—") + "</b></p>";
    }
    if (d.tips.length) h += '<div class="vp-tips">' + d.tips.map(esc).join("<br>") + "</div>";
    h += '<p class="syn-pop-tip">音色存在本机（换设备要重挑）。列表是异步出来的，' +
      "刚打开时可能是空的 —— 关掉重开一次就有。</p></div>";
    box.innerHTML = h;
    box.hidden = false;
  }
  function localPref(lang) {
    try {
      var o = JSON.parse(localStorage.getItem("pet:ph:voice") || "{}");
      return (o && o[lang]) || "";
    } catch (e) { return ""; }
  }

  /* ---------- 事件 ---------- */
  function bind() {
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      /* 音色面板：开关 / 挑音色 / 试听 */
      if (t.closest && t.closest("#tglVoice")) { renderVoicePanel(); return; }
      if (t.closest && t.closest("[data-voice-close]")) { var vp = $("voicePanel"); if (vp) vp.hidden = true; return; }
      var vpSay = t.closest && t.closest("[data-say2]");
      if (vpSay) { ev.stopPropagation(); window.PET_READ.sample(vpSay.dataset.say2); return; }
      var vpPick = t.closest && t.closest("[data-voice]");
      if (vpPick) {
        window.PET_READ.setVoice(vpPick.dataset.vlang, vpPick.dataset.voice);
        renderVoicePanel();
        return;
      }

      var wd = t.closest && t.closest("[data-word]");
      if (wd) { ev.stopPropagation(); window.PET_READ.word(wd.dataset.word); return; }

      var tab = t.closest && t.closest("[data-phview]");
      if (tab) {
        var v = tab.dataset.phview;
        if (v === "list") { setView("list"); return; }
        if (state.view === "list") { openGroup(state.g, v); return; }
        setView(v); return;
      }
      var rd = t.closest && t.closest("[data-phread]");
      if (rd) { openGroup(+rd.dataset.phread, "read"); return; }
      var pr = t.closest && t.closest("[data-playread]");
      if (pr) { playRead(); return; }
      var xb = t.closest && t.closest("[data-phxbw]");
      if (xb) { openGroup(+xb.dataset.phxbw, "xbw"); return; }

      var fav = t.closest && t.closest("[data-phfav]");
      if (fav) { if (fav.dataset.phfav) toggleFav(fav.dataset.phfav); return; }

      var del = t.closest && t.closest("[data-histdel]");
      if (del) {
        var did = del.dataset.histdel;
        state.hist = state.hist.filter(function (x) { return histKey(x) !== did; });
        if (state.curHist === did) state.curHist = "";
        saveHist();
        renderHistory();
        return;
      }
      var hopen = t.closest && t.closest("[data-hist]");
      if (hopen) {
        var hid = hopen.dataset.hist;
        var hk = hid.slice(2);
        if (hid.indexOf("p:") === 0) showPhrase(hk, false);
        else showWord(hk);
        renderHistory();
        return;
      }

      var ph = t.closest && t.closest("[data-ph]");
      if (ph) { showPhrase(ph.dataset.ph); return; }
      var w = t.closest && t.closest("[data-w]");
      if (w) {
        /* 收藏单词时把「点它的那句例句」一起带上（和文章页一个口径） */
        var exp = document.querySelector(".ph-card .ph-ex");
        var ctx = exp ? exp.textContent.replace(/🔊/g, "").trim() : "";
        showWord(w.dataset.w, ctx);
        return;
      }
      var pa = t.closest && t.closest("[data-phana]");
      if (pa) { showPhrase(pa.dataset.phana); return; }

      var prev = t.closest && t.closest("#phPrev");
      if (prev) { gotoCard(state.i - 1); return; }
      var next = t.closest && t.closest("#phNext");
      if (next) { gotoCard(state.i + 1); return; }
      var coll = t.closest && t.closest("#anaCollapse");
      if (coll) { state.ana = !state.ana; applyAna(); return; }
    });

    $("tglHist").addEventListener("click", function () {
      var el = $("histFloat");
      el.hidden = !el.hidden;
      $("tglHist").classList.toggle("on", !el.hidden);
    });
    /* iOS 那种「首次必须用户手势」：跟读起不来时告诉页面（小霸王会弹一个「点一下开始」） */
    if (window.PET_READ) {
      window.PET_READ.onBlocked = function () {
        if (window.PET_XBW && window.PET_XBW.state) window.PET_XBW.state.blocked = true;
        var btn = document.querySelector('[data-x="read"]');
        if (btn && state.view === "xbw" && window.PET_XBW) window.PET_XBW.retry && window.PET_XBW.retry();
        state.reading = 0;
        renderCard();
        if (document.querySelector("[data-playread]")) {
          var pb = document.querySelector("[data-playread]");
          pb.textContent = "▶ 点一下开始（浏览器要先点一次）";
        }
      };
    }
    $("histClose").addEventListener("click", function () {
      $("histFloat").hidden = true;
      $("tglHist").classList.remove("on");
    });

    document.addEventListener("keydown", function (ev) {
      if (state.view !== "read") return;
      if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      if (ev.key === "ArrowLeft") { gotoCard(state.i - 1); }
      else if (ev.key === "ArrowRight") { gotoCard(state.i + 1); }
      else if (ev.key === "Escape") { $("histFloat").hidden = true; $("tglHist").classList.remove("on"); }
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (S && S.mountWho) S.mountWho($("who"));
    if (S && S.mountTheme) S.mountTheme($("tglTheme"));
    if (S && S.mountZoom) S.mountZoom();
    $("phCredit").textContent = D.credit || "";
    $("phNote").textContent = D.note || "";
    bind();
    renderGroups();
    loadHist();
    renderHistory();
    state.ana = !isNarrow();
    applyAna();

    /* 收藏态先备好再画：免得先出一片空心再逐个变实 */
    var ready = (S && S.listFav)
      ? S.listFav().then(function (arr) {
          state.favs = {};
          (arr || []).forEach(function (x) { if (x && x.key) state.favs[(x.type || "w") + ":" + x.key] = 1; });
        }).catch(function () {})
      : Promise.resolve();

    ready.then(function () {
      renderGroups();
      renderCard();
      loadMistakes();
      /* 深链：?g=1&mode=read|xbw&q=9（错题本「去订正」用） */
      var q = {};
      String(location.search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
      var g = Math.max(0, Math.min(groupCount() - 1, (parseInt(q.g, 10) || 1) - 1));
      var mode = (q.mode === "xbw" || q.mode === "srs") ? q.mode : q.mode === "read" ? "read" : "list";
      if (mode !== "list") openGroup(g, mode);
      else setView("list");
      if (mode === "xbw" && q.q && window.PET_XBW && window.PET_XBW.jumpQuiz) {
        window.PET_XBW.jumpQuiz(parseInt(q.q, 10) || 1);
      }
    });
  }
  /* 给别的脚本用的最小接口（小霸王的「回看词组卡」） */
  window.PET_PHRASE_UI = {
    open: function (g) { openGroup(g, "read"); },
    list: function () { setView("list"); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
