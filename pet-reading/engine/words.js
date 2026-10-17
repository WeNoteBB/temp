/* PET 精读 · 我的词书（收藏的单词 / 句子）
   ===============================================================
   数据来自 store.listFav()：联网时会先拉服务器收藏再合并
   （本地表 = 界面真相，服务器 = 跨设备恢复），没有 fetch 就纯本地。
   收藏入口在文章页的历史浮层里（每行行尾的 ☆）。

   点一条 → 就地展开详情：
     单词：音标 / 词性 / 释义 / 例句（连翻译）/ 搭配 + 🔊
     句子：原文 / 翻译 / 句子分析（pet_sentence.analysis）+ 🔊
   这些字段由 /api/favs 带全；库里缺字段的老词跑 server/backfill.mjs 补。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- 朗读：与文章页同一口径（英音、0.75 倍速）；不支持就安静忽略 ---------- */
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
    } catch (e) { /* 没有 TTS 的浏览器：点了没声，但不报错 */ }
  }

  function spk(text, extra) {
    return '<button type="button" class="wd-spk' + (extra ? " " + extra : "") +
      '" data-say="' + esc(text) + '" title="朗读">🔊</button>';
  }

  /* ---------- 详情版式 ----------
     句子的 ana 字段（pat/frame/parts/clauses/gram/tip）是内容里的原创 HTML，
     与文章页小黑板同源同名 —— 这里原样注入（和 app.js 一样信任内容），
     纯文本字段（标签、句型等）一律转义。 */
  function anaLines(ana) {
    if (!ana || typeof ana !== "object") return "";
    var h = "";
    if (ana.pat && ana.pat.length) {
      h += '<div class="wd-sec"><span class="wd-t">句型</span><div class="wd-b">' +
        ana.pat.map(function (p) { return '<span class="chip pat static">' + esc(p) + "</span>"; }).join(" ") +
        "</div></div>";
    }
    if (ana.frame) {
      h += '<div class="wd-sec"><span class="wd-t">主干</span><div class="wd-b">' + ana.frame + "</div></div>";
    }
    if (ana.parts && ana.parts.length) {
      h += '<div class="wd-sec"><span class="wd-t">成分</span><div class="wd-b">';
      ana.parts.forEach(function (p) {
        h += '<div class="wd-part"><span class="wd-partk">' + esc(p[0]) + "</span><span>" + p[1] + "</span></div>";
      });
      h += "</div></div>";
    }
    if (ana.clauses && ana.clauses.length) {
      h += '<div class="wd-sec"><span class="wd-t">从句</span><div class="wd-b"><ul class="wd-ul">' +
        ana.clauses.map(function (c) { return "<li>" + c + "</li>"; }).join("") + "</ul></div></div>";
    }
    if (ana.gram) h += '<div class="wd-sec"><span class="wd-t">语法</span><div class="wd-b">' + ana.gram + "</div></div>";
    if (ana.tip) h += '<div class="wd-sec"><span class="wd-t">提示</span><div class="wd-b">' + ana.tip + "</div></div>";
    return h;
  }

  function wordDetail(w) {
    var h = '<div class="wd-head"><span class="wd-word">' + esc(w.key) + "</span>" + spk(w.key);
    if (w.ipa) h += '<span class="wd-ipa">' + esc(w.ipa) + "</span>";
    if (w.pos) h += '<span class="vpos">' + esc(w.pos) + "</span>";
    h += "</div>";
    if (w.cn) h += '<div class="wd-sec"><span class="wd-t">释义</span><div class="wd-b">' + esc(w.cn) + "</div></div>";
    if (w.ex) {
      h += '<div class="wd-sec"><span class="wd-t">例句</span><div class="wd-b">' +
        '<div class="wd-ex"><span>' + esc(w.ex) + "</span>" + spk(w.ex) + "</div>" +
        (w.exTr ? '<div class="wd-extr">' + esc(w.exTr) + "</div>" : "") +
        "</div></div>";
    }
    if (w.ph) {
      h += '<div class="wd-sec"><span class="wd-t">搭配</span><div class="wd-b">' +
        String(w.ph).split("\n").map(function (p) {
          return '<span class="chip ph2 static">' + esc(p) + "</span>";
        }).join(" ") + "</div></div>";
    }
    return h;
  }

  function sentDetail(s) {
    var h = '<div class="wd-head"><span class="wd-word wd-sent">' + esc(s.key) + "</span>" + spk(s.key) + "</div>";
    if (s.cn) h += '<div class="wd-sec"><span class="wd-t">翻译</span><div class="wd-b">' + esc(s.cn) + "</div></div>";
    var a = anaLines(s.ana);
    if (a) h += a;
    if (!s.cn && !a) {
      h += '<div class="wd-sec"><span class="wd-t"></span><div class="wd-b wd-none">这条句子的翻译和分析还没入库。</div></div>';
    }
    return h;
  }

  function render(items) {
    var words = [], sents = [];
    (items || []).forEach(function (x) {
      if (x.type === "s") sents.push(x);
      else if (x.type === "w") words.push(x);
    });
    var box = $("listBox");
    if (!words.length && !sents.length) {
      box.innerHTML = '<div class="list-empty"><span class="big">📖</span>' +
        "词书还是空的。<br>在文章里点开一个词或句子，按行尾的 ☆ 收藏，就会汇到这里。" +
        '<div class="list-cta"><a class="btn pri" href="index.html">回首页去阅读</a></div></div>';
      return;
    }
    var h = "";
    if (words.length) {
      h += '<h2 class="list-h">单词 · ' + words.length + "</h2>";
      words.forEach(function (w, i) {
        h += '<div class="wentry" data-kind="w" data-i="' + i + '">' +
          '<button type="button" class="wrow" aria-expanded="false">' +
            '<span class="wkey">' + esc(w.key) + "</span>" +
            '<span class="wcn">' + esc(w.cn || "—") + "</span>" +
            '<span class="wcaret" aria-hidden="true">▸</span>' +
          "</button>" +
          '<div class="wdetail" hidden>' + wordDetail(w) + "</div>" +
          "</div>";
      });
    }
    if (sents.length) {
      h += '<h2 class="list-h">句子 · ' + sents.length + "</h2>";
      sents.forEach(function (s, i) {
        h += '<div class="wentry" data-kind="s" data-i="' + i + '">' +
          '<button type="button" class="wrow s" aria-expanded="false">' +
            '<span class="wkey">' + esc(s.key) + "</span>" +
            '<span class="wcn">' + esc(s.cn || "—") + "</span>" +
            '<span class="wcaret" aria-hidden="true">▸</span>' +
          "</button>" +
          '<div class="wdetail" hidden>' + sentDetail(s) + "</div>" +
          "</div>";
      });
    }
    box.innerHTML = h;
  }

  /* 行点击用委托：一条一条开（打开新的自动收起旧的；再点自己就收起）。
     喇叭按钮要拦一下，否则点它会顺手把这条详情收掉。 */
  $("listBox").addEventListener("click", function (ev) {
    var sBtn = ev.target.closest("[data-say]");
    if (sBtn) { ev.stopPropagation(); speak(sBtn.dataset.say); return; }
    var row = ev.target.closest(".wrow");
    if (!row) return;
    var det = row.parentElement.querySelector(".wdetail");
    if (!det) return;
    var wasOpen = !det.hidden;
    document.querySelectorAll("#listBox .wdetail").forEach(function (d) { d.hidden = true; });
    document.querySelectorAll("#listBox .wrow").forEach(function (r) { r.setAttribute("aria-expanded", "false"); });
    if (!wasOpen) {
      det.hidden = false;
      row.setAttribute("aria-expanded", "true");
    }
  });

  S.mountWho($("who"));
  if (S.mountTheme) S.mountTheme($("tglTheme"));

  S.listFav().then(render).catch(function () {
    $("listBox").innerHTML = '<div class="list-empty">加载失败：连不上服务器。<br>检查网络后刷新试试。</div>';
  });
})();
