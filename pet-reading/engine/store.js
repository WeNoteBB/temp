/* PET 精读 · 存储层（登录态 / 收藏 / 主题）
   ===============================================================
   今天它包的是 localStorage。将来接后端时，**只改这个文件里的函数体**，
   页面代码一行不动 —— 这就是把每个接口从第一天起就写成 async 的全部理由：
   把异步性前置，而不是等到接后端时再回头改所有调用点。

   页面只认 window.PETStore 这一个全局（app.js 是 IIFE，没有模块系统）。
   本文件**不依赖 PET_CONTENT**，所以登录页也能加载它。

   改完这里必须跑： node tools/test-store.mjs

   ⚠ 一处刻意的重复：<head> 里那段防闪烁的内联脚本会直接读 `pet:theme:v1`。
     它不能改成加载本文件 —— 它必须赶在外链样式表之前跑完，那时候再去取一个
     js 文件就太晚了，会先闪一帧亮色。两处的键名必须一致，改一个改两个。
*/
window.PETStore = (function () {
  "use strict";

  var K_USER  = "pet:user:v1";
  var K_FAV   = "pet:fav:v1";
  var K_THEME = "pet:theme:v1";   // ← 与 template.html / login.template.html 的 <head> 内联脚本共用
  var K_PROBE = "pet:probe:v1";

  var PHONE_RE = /^1[3-9]\d{9}$/;
  var THEMES = ["auto", "light", "dark"];

  /* ---------- 存储底座 ---------- */

  var _ls = null, _lsTried = false, _avail = null;
  /* 存储不可用时的退路：只活在本次会话里，刷新即失。
     有它才不会出现「点了收藏，星星亮一下又弹回去」这种更像坏了的表现。 */
  var _mem = {};

  function LS() {
    if (!_lsTried) {
      _lsTried = true;
      /* 不是「属性不存在」才叫不可用：Safari 在「禁止网站数据」下
         连读 window.localStorage 这个属性本身都会抛 SecurityError，
         所以取值动作也必须包起来。 */
      try { _ls = window.localStorage || null; } catch (e) { _ls = null; }
    }
    return _ls;
  }

  function available() {
    var s = LS();
    if (!s) return false;
    if (_avail === null) {
      /* 对象在、但写不进去（隐私模式配额为 0）也算不可用。
         只看对象在不在会漏掉这一整类浏览器。 */
      try {
        s.setItem(K_PROBE, "1");
        _avail = s.getItem(K_PROBE) === "1";
        s.removeItem(K_PROBE);
      } catch (e) { _avail = false; }
    }
    return _avail;
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function readKey(key, dflt) {
    var s = LS();
    if (s) {
      try {
        var raw = s.getItem(key);
        if (raw != null) {
          var v = JSON.parse(raw);
          /* 存储里真读到了就以存储为准 —— 换个标签页退出登录，这边能看见。 */
          if (v != null) return v;
        }
      } catch (e) { /* JSON 坏了或读不到，落到内存兜底 */ }
    }
    /* 存储读不到时再看内存：写坏了的存储（隐私模式配额 0）里
       永远读不到刚写的东西，不兜这一下，收藏就变成「点得亮、取消不掉」。 */
    return has(_mem, key) ? _mem[key] : dflt;
  }

  /* 返回是否真的落到存储里了。调用方据此告诉用户「这台设备记不住」，
     而不是假装写成功了。 */
  function writeKey(key, val) {
    _mem[key] = val;
    var s = LS();
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function dropKey(key) {
    delete _mem[key];
    var s = LS();
    if (!s) return false;
    try { s.removeItem(key); return true; } catch (e) { return false; }
  }

  /* ---------- 登录态 ---------- */

  async function getUser() {
    var u = readKey(K_USER, null);
    return (u && u.phone) ? u : null;
  }

  async function login(phone) {
    var p = String(phone == null ? "" : phone).replace(/[\s-]/g, "");
    if (!PHONE_RE.test(p)) return { ok: false, err: "请输入 11 位手机号" };
    var persisted = writeKey(K_USER, { phone: p, ts: Date.now() });
    /* 存不住也返回成功：门禁在存储不可用时本来就是放行的，
       这里再拦一道，用户会被永久卡在登录页出不去。 */
    return { ok: true, phone: p, persisted: persisted };
  }

  async function logout() {
    dropKey(K_USER);
    return { ok: true };
  }

  function maskPhone(p) {
    p = String(p || "");
    return p.length === 11 ? p.slice(0, 3) + "****" + p.slice(7) : p;
  }

  /* ---------- 门禁 ----------
     文章页、目录页共用这一段。不要在两处各写一遍 ——
     两边哪天判得不一样，就会出现「目录能进、文章进不去」这种最难查的毛病。 */

  var _guard = null;

  /* 当前页地址（含 query 与 hash）。门禁和退出登录都要「回到这一页」，
     两处各拼一遍迟早会拼得不一样 —— 一个带 search，一个不带，
     表现就是「退出再登录，筛选条件没了」。 */
  function herePath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function guard() {
    /* 一页只判一次。<head> 里那次是抢在渲染前跳走，app.js 里那次是兜底，
       两边拿到的是同一个 promise，不会重复跳。 */
    if (_guard) return _guard;
    _guard = (async function () {
      /* ★ 本文件最要紧的一条：存不住就直接放行。
         要是照拦不误 —— 登录页写不进登录态 → 跳回文章页 → 判定未登录 →
         再跳登录页，用户被卡死在两个页面之间，且怎么刷新都出不来。
         代价是 file:// 双击打开、隐私模式下门禁形同虚设，这是明知故犯。 */
      if (!available()) return "open";
      if (await getUser()) return "ok";
      window.location.replace("login.html?next=" + encodeURIComponent(herePath()));
      return "denied";
    })();
    return _guard;
  }

  /* 登录成功后要跳回哪。只接受站内地址：
     next 是用户可控的，直接丢给 location.replace 就成了开放重定向，
     别人可以拿站内域名做跳板把人送去钓鱼页。 */
  function safeNext(raw) {
    var fallback = "index.html";
    if (!raw) return fallback;
    if (typeof URL !== "function") return fallback;
    try {
      var u = new URL(String(raw), window.location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return fallback; // javascript: data: file:
      if (u.origin !== window.location.origin) return fallback;               // //外站 、http://外站
      return String(raw);
    } catch (e) { return fallback; }
  }

  /* 顶栏那个「138****8000 退出」角标。文章页和目录页都要显示手机号，
     放这里而不是各页各写一遍 —— 两处的类名也得一致，不然改一处忘一处，
     两个页面的角标会长得不一样。传进来的 el 不存在就什么都不做。 */
  async function mountWho(el) {
    if (!el) return null;
    var u = await getUser();
    el.textContent = "";
    if (!u || !u.phone) { el.hidden = true; return null; }
    var num = document.createElement("span");
    num.className = "who-num";
    num.textContent = maskPhone(u.phone);
    var out = document.createElement("button");
    out.type = "button";
    out.className = "who-out";
    out.textContent = "退出";
    out.addEventListener("click", function () {
      /* 退出后落在登录页，并把「回哪去」带上：不带的话，
         学生退出再登录会被丢回目录页，正在读的那篇就找不着了。 */
      var back = herePath();
      logout().then(function () {
        window.location.href = "login.html?next=" + encodeURIComponent(back);
      });
    });
    el.appendChild(num);
    el.appendChild(out);
    el.hidden = false;
    return u;
  }

  /* ---------- 收藏 ----------
     界面今天只用到 addFav / isFav。真实存储（数据库表）接进来时，
     换掉这三个函数的函数体就够了，bindHistory 里那一行调用不动。
     pet:fav:v1 里攒下的条目天然就是将来补写数据库的 outbox。 */

  function favId(it) {
    if (!it) return "";
    if (it.type === "s") return "s:" + (it.slug || "") + "@" + (it.ref || "");
    return (it.type || "w") + ":" + (it.key || "");
  }

  async function listFav() {
    var arr = readKey(K_FAV, []);
    return Array.isArray(arr) ? arr : [];
  }

  async function isFav(id) {
    var arr = await listFav();
    for (var i = 0; i < arr.length; i++) if (favId(arr[i]) === id) return true;
    return false;
  }

  /* 点一下收藏、再点一下取消 —— 按钮只有一个，两态都走这里。 */
  async function addFav(item) {
    var it = Object.assign({}, item || {});
    var id = favId(it);
    if (!id || id.slice(-1) === ":" || id.slice(-2) === "@") {
      return { ok: false, added: false, err: "缺少标识" };
    }
    var arr = await listFav();
    var at = -1;
    for (var i = 0; i < arr.length; i++) if (favId(arr[i]) === id) { at = i; break; }
    var added;
    if (at >= 0) { arr.splice(at, 1); added = false; }
    else { it.ts = Date.now(); arr.unshift(it); added = true; }
    var persisted = writeKey(K_FAV, arr);
    return { ok: true, added: added, persisted: persisted, id: id };
  }

  /* ---------- 主题 ---------- */

  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (e) { return false; }
  }

  /* "auto" 在写进 DOM 之前就解析成具体值。
     这样 CSS 里只认 [data-theme="light|dark"]，不用再维护第二套
     @media (prefers-color-scheme) —— 两套迟早会不一致。 */
  function resolveTheme(t) {
    if (t === "light" || t === "dark") return t;
    return prefersDark() ? "dark" : "light";
  }

  /* 只写 <html data-theme>。这是本文件唯一碰 DOM 的地方，
     为的是让「读主题」和「上主题」永远成对发生，别处不用记得再调一次。 */
  function paint(t) {
    var v = resolveTheme(t);
    if (typeof document === "undefined" || !document.documentElement) return v;
    document.documentElement.setAttribute("data-theme", v);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", v === "dark" ? "#12151b" : "#eef1f6");
    return v;
  }

  async function getTheme() {
    var t = readKey(K_THEME, "auto");
    return THEMES.indexOf(t) >= 0 ? t : "auto";
  }

  async function setTheme(t) {
    if (THEMES.indexOf(t) < 0) t = "auto";
    writeKey(K_THEME, t);
    paint(t);
    return t;
  }

  /* 三态循环的顺序只写在这一处，按钮那边不要自己数。 */
  async function nextTheme() {
    var cur = await getTheme();
    return setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  }

  /* 只有「跟随系统」时才跟着系统变；用户明确选了亮/暗就不再被系统覆盖。 */
  try {
    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function () {
        getTheme().then(function (t) { if (t === "auto") paint("auto"); });
      });
    }
  } catch (e) { /* 不支持 matchMedia 的老浏览器：不跟随，其他照常 */ }

  return {
    available: available,
    getUser: getUser,
    login: login,
    logout: logout,
    maskPhone: maskPhone,
    guard: guard,
    safeNext: safeNext,
    mountWho: mountWho,
    favId: favId,
    listFav: listFav,
    isFav: isFav,
    addFav: addFav,
    getTheme: getTheme,
    setTheme: setTheme,
    nextTheme: nextTheme,
    paintTheme: function () { return getTheme().then(paint); }
  };
})();
