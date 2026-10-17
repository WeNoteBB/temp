/* PET 精读 · 首页（个性化主页 + 登录 / 注册弹框）
   ===============================================================
   首页是公开的，不设门禁：
     · 没登录 → 显示「请先登录哦」，六个入口淡化锁住（点了弹登录框）。
       但存储不可用（file:// / 隐私模式）时门禁本来就是放行的，
       这时入口直接可点 —— 不能因为「存不住登录态」把人锁死在首页。
     · 登录后 → 入口可用，「PET 阅读理解」跳上次学到的那篇
       （store.getLastRead；以后换 Redis 也不改这里）。

   登录 / 注册全部发生在本文件的弹框里（没有独立登录页）。
   依赖：store.js（唯一数据层）+ build.mjs 注入的 window.PET_TOC。
*/
(function () {
  "use strict";
  var S = window.PETStore;
  var TOC = window.PET_TOC || { books: [] };
  var $ = function (id) { return document.getElementById(id); };

  var state = { user: null, mode: "login", next: "", toastTimer: null };

  function firstSlug() {
    for (var i = 0; i < TOC.books.length; i++) {
      var arts = TOC.books[i].articles || [];
      if (arts.length) return arts[0].slug;
    }
    return "";
  }

  /* 昵称首字符（emoji / 中英文都取第一个「字」，不是第一个 UTF-16 码元） */
  function firstChar(s) {
    s = String(s || "");
    if (typeof Array.from === "function") return Array.from(s)[0] || "";
    return s.slice(0, 1);
  }

  /* ============ 顶部：用户圆圈 + 头像菜单 ============ */

  function paintUser(u) {
    state.user = (u && u.phone) ? u : null;
    var logged = !!state.user;
    var av = $("avatar"), txt = $("avatarT");
    /* 存储不可用（file:// / 隐私模式）= 门禁本身是放行的：
       提示还是照显示（说明为什么没有个性化内容），但入口不加锁 ——
       加了锁又登不上，人就永远进不了文章了。 */
    var canStore = !S.available || S.available();

    $("homeAsk").hidden = logged;
    $("homeMain").classList.toggle("locked", !logged && canStore);

    if (logged) {
      av.classList.remove("off");
      av.classList.add("on");
      av.style.background = state.user.color || "";
      txt.textContent = firstChar(state.user.nickname) || "👤";
      av.title = (state.user.nickname || S.maskPhone(state.user.phone)) +
        " · 等级 " + (state.user.level || 1) + "（点开菜单）";
      $("uName").textContent = state.user.nickname || S.maskPhone(state.user.phone);
      $("uLv").textContent = String(state.user.level || 1);
      if (state.user.color) $("uDot").style.background = state.user.color;
    } else {
      av.classList.add("off");
      av.classList.remove("on");
      av.style.background = "";
      txt.textContent = "👤";
      av.title = "登录 / 注册";
      $("uMenu").hidden = true;
    }
  }

  function wireTop() {
    $("avatar").addEventListener("click", function (ev) {
      ev.stopPropagation();                 // 别让 document 的「点外面关菜单」立刻又把它关上
      if (state.user) $("uMenu").hidden = !$("uMenu").hidden;
      else openModal("login");
    });
    document.addEventListener("click", function (ev) {
      var m = $("uMenu");
      if (!m.hidden && !(ev.target.closest && ev.target.closest("#uMenu"))) m.hidden = true;
    });
    $("uOut").addEventListener("click", function () {
      S.logout().then(function () { window.location.reload(); });
    });
  }

  /* ============ 入口磁贴 ============ */

  function paintReadHref() {
    S.getLastRead().then(function (lr) {
      var slug = (lr && lr.slug) || firstSlug();
      if (slug) $("tileRead").setAttribute("href", slug + ".html");
    }).catch(function () {
      var slug = firstSlug();
      if (slug) $("tileRead").setAttribute("href", slug + ".html");
    });
  }

  function openRead() {
    var fallback = firstSlug();
    S.getLastRead().then(function (lr) {
      var slug = (lr && lr.slug) || fallback;
      if (!slug) { toast("书目里还没有文章"); return; }
      window.location.href = slug + ".html";
    }).catch(function () {
      if (fallback) window.location.href = fallback + ".html";
    });
  }

  function wireTiles() {
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest("[data-go]") : null;
      if (!a) return;

      var labEl = a.querySelector(".tile-lab");
      var lab = labEl ? labEl.textContent : "这个功能";

      if (a.classList.contains("soon")) {
        ev.preventDefault();
        toast("「" + lab + "」还在开发中，敬请期待");
        return;
      }
      /* 没登录：先请人登录。存储不可用时例外 —— 门禁都放行了，
         这里再拦就成了死路（file:// 永远登录不上）。 */
      if (!state.user && S.available()) {
        ev.preventDefault();
        openModal("login");
        return;
      }
      if (a.id === "tileRead") {
        ev.preventDefault();
        openRead();
      }
    });
  }

  function toast(msg) {
    var el = $("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* ============ 登录 / 注册弹框 ============ */

  function showErr(msg) {
    var el = $("umErr");
    el.textContent = msg || "";
    el.hidden = !msg;
    if (msg) {
      var target = /昵称/.test(msg) ? $("umNick")
        : /密码/.test(msg) ? $("umPass")
        : /手机号/.test(msg) ? $("umPhone") : null;
      if (target) { try { target.focus(); } catch (e) {} }
    }
  }

  function paintMode() {
    var reg = state.mode === "reg";
    document.querySelectorAll(".um-tab").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === state.mode);
    });
    $("umReg").hidden = !reg;
    $("umTitle").textContent = reg ? "注册新账号" : "登录 PET 精读";
    $("umBtn").textContent = reg ? "注册" : "登录";
    $("umPass").setAttribute("autocomplete", reg ? "new-password" : "current-password");
    $("umPass").placeholder = reg ? "6–64 位，以后用它登录" : "输入密码";
  }

  function openModal(mode) {
    state.mode = mode === "reg" ? "reg" : "login";
    paintMode();
    showErr("");
    $("uModal").hidden = false;
    var f = state.mode === "reg" ? $("umNick") : $("umPhone");
    setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
  }

  function closeModal() { $("uModal").hidden = true; }

  function wireModal() {
    $("uModal").addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest('[data-um="close"]')) closeModal();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      closeModal();
      $("uMenu").hidden = true;
    });
    document.querySelectorAll(".um-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        state.mode = b.dataset.mode;
        paintMode();
        showErr("");
      });
    });
    $("umPhone").addEventListener("input", function () {
      /* 只留数字：手机键盘之外还能粘贴、还能用输入法打中文 */
      var v = this.value.replace(/\D/g, "").slice(0, 11);
      if (v !== this.value) this.value = v;
      if (!$("umErr").hidden) showErr("");
    });

    $("umForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var phone = $("umPhone").value;
      var pass = $("umPass").value;
      var nick = $("umNick").value;
      var btn = $("umBtn");
      if (btn.disabled) return;
      btn.disabled = true;

      function done(r) {
        btn.disabled = false;
        if (!r || !r.ok) { showErr((r && r.err) || "操作失败，请重试"); return; }
        closeModal();
        /* 带着 next 来的（从文章页被门禁弹回来）：登完跳回去 */
        if (state.next) { window.location.replace(S.safeNext(state.next)); return; }
        paintUser(r.user || null);
        S.refreshProfile().then(function (u2) { if (u2) paintUser(u2); }).catch(function () {});
      }
      function boom() { btn.disabled = false; showErr("操作失败，请重试"); }

      (state.mode === "reg" ? S.register(phone, nick, pass) : S.login(phone, pass))
        .then(done).catch(boom);
    });
  }

  /* ============ 启动 ============ */

  function boot() {
    if (S.mountTheme) S.mountTheme($("tglTheme"));
    wireTop();
    wireTiles();
    wireModal();

    S.getUser().then(function (u) {
      paintUser(u);
      if (u) {
        S.refreshProfile().then(function (u2) { if (u2) paintUser(u2); }).catch(function () {});
      }
      paintReadHref();

      /* ?login=1：门禁把人弹回来了，自动开登录框（已登录就不打扰）。
         ?next=… 记下来，登完跳回去；safeNext 在真正跳转时才过一遍。 */
      var q = null;
      try { q = new URLSearchParams(window.location.search); } catch (e) {}
      state.next = (q && q.get("next")) || "";
      if (q && q.get("login") === "1" && !u) {
        openModal(q.get("mode") === "reg" ? "reg" : "login");
      }
    }).catch(function () { paintUser(null); });

    $("askLogin").addEventListener("click", function () { openModal("login"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
