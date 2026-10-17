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

  function render(items) {
    var box = $("listBox");
    if (!items.length) {
      box.innerHTML = '<div class="list-empty"><span class="big">🎯</span>' +
        "还没有错题记录。<br>去「PET 阅读理解」做题，做错的会自动记到这里。" +
        '<div class="list-cta"><a class="btn pri" href="index.html">去首页</a></div></div>';
      return;
    }
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
    box.innerHTML = h;
  }

  S.mountWho($("who"));
  if (S.mountTheme) S.mountTheme($("tglTheme"));

  S.listMistakes().then(render).catch(function () {
    $("listBox").innerHTML = '<div class="list-empty">加载失败：连不上服务器。<br>检查网络后刷新试试。</div>';
  });
})();
