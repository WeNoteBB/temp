/* PET 精读 · 错题记录页
   ===============================================================
   数据每次打开现拉（GET /api/mistakes），本机不缓存 —— 换设备也能看到自己的错题。
   篇名映射靠 build.mjs 注入的 window.PET_TOC（slug → 标题）。
   「去订正」跳到 <slug>.html?q=题号：文章页会把那道题的分析直接展开（app.js 的 deepLinkQuestion）。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var TOC = window.PET_TOC || { books: [] };
  var $ = function (id) { return document.getElementById(id); };

  var titleMap = {};
  (TOC.books || []).forEach(function (b) {
    (b.articles || []).forEach(function (a) { titleMap[a.slug] = a; });
  });

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function renderRead(items) {
    var h = "";
    items.forEach(function (m) {
      var a = titleMap[m.slug] || {};
      h += '<div class="mrow">';
      h += '<div class="mrow-main">';
      h += '<div class="mrow-t">' + esc(a.title || m.slug) + "</div>";
      h += '<div class="mrow-m">第 <b>' + m.q + "</b> 题 · 我选了 <b>" + esc(m.chosen) +
        "</b> · 正确答案 <b>" + esc(m.correct) + "</b>";
      if (m.count > 1) h += " · 错过 " + m.count + " 次";
      if (m.ts) h += " · " + fmtTime(m.ts);
      h += "</div></div>";
      h += '<a class="btn" href="' + esc(m.slug) + ".html?q=" + m.q + '">去订正 →</a>';
      h += "</div>";
    });
    return h;
  }

  /* 词组错题（小霸王模式的选择题）：存的是原题 + 你选的选项文本，
     所以不依赖任何映射，直接就能读；「去订正」跳回词组库那一组的选择题。 */
  function renderPhrase(items) {
    var h = "";
    items.forEach(function (m) {
      var g = Math.max(1, Math.ceil((m.no || 1) / 10));
      h += '<div class="mrow">';
      h += '<div class="mrow-main">';
      h += '<div class="mrow-t">第 ' + m.no + " 条 · " + esc(m.phrase) + "</div>";
      if (m.stem) h += '<div class="mrow-m">' + esc(m.stem) + "</div>";
      h += '<div class="mrow-m">我选了 <b>' + esc(m.chosen) + "</b> · 正确答案 <b>" + esc(m.correct) + "</b>";
      if (m.count > 1) h += " · 错过 " + m.count + " 次";
      if (m.ts) h += " · " + fmtTime(m.ts);
      h += "</div></div>";
      h += '<a class="btn" href="phrases.html?g=' + g + "&mode=xbw&q=" + m.no + '">去订正 →</a>';
      h += "</div>";
    });
    return h;
  }

  function render(readItems, phraseItems) {
    var box = $("listBox");
    if (!readItems.length && !phraseItems.length) {
      box.innerHTML = '<div class="list-empty"><span class="big">🎯</span>' +
        "还没有错题记录。<br>去「PET 阅读理解」做题、或在「PET 词组库」玩小霸王模式，做错的会自动记到这里。" +
        '<div class="list-cta"><a class="btn pri" href="index.html">去首页</a></div></div>';
      return;
    }
    var h = "";
    if (readItems.length) {
      h += '<h2 class="list-h">阅读理解 · ' + readItems.length + "</h2>" + renderRead(readItems);
    }
    if (phraseItems.length) {
      h += '<h2 class="list-h">词组（小霸王模式）· ' + phraseItems.length + "</h2>" + renderPhrase(phraseItems);
    }
    box.innerHTML = h;
  }

  S.mountWho($("who"));
  if (S.mountTheme) S.mountTheme($("tglTheme"));
  if (S.mountZoom) S.mountZoom();

  /* 两块错题一起拉：阅读（按篇）+ 词组（小霸王选择题）。哪块失败哪块留空。 */
  Promise.all([
    S.listMistakes().catch(function () { return null; }),
    (S.listPhraseMistakes ? S.listPhraseMistakes() : Promise.resolve([])).catch(function () { return null; })
  ]).then(function (r) {
    var read = r[0], phrase = r[1];
    if (read === null && phrase === null) {
      $("listBox").innerHTML = '<div class="list-empty">加载失败：连不上服务器。<br>检查网络后刷新试试。</div>';
      return;
    }
    render(read || [], phrase || []);
  });
})();
