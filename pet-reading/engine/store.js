/* PET 精读 · 存储层（登录态 / 收藏 / 错题 / 学到哪儿 / 主题）
   ===============================================================
   登录态（手机号 + 昵称 + 等级色）、收藏、错题、主题、阅读进度都包 localStorage：

     · 登录态（pet:user:v1）：注册/登录都打后端校验，缓存 {phone, nickname,
       level, color, ts}；保持 14 天（过期按未登录处理）。没有单独的登录页，
       登录/注册 UI 是首页的弹框（engine/home.js）
     · 收藏是「本地即时 + 后台补写」：
       addFav / isFav / listFav 立刻读写本地表（pet:fav:v1），星星不等网络；
       每次增删都往补写队列（pet:fav:q:v1）记一条，联网后按序推到后端，
       落库的是 user_word / user_sentence（后端见 ../server/）
     · 错题（addMistake / listMistakes）：登记直连后端，失败就算了 ——
       错题登记不该打断做题体验（将来要离线补写再进队列）
     · 学到哪儿（getLastRead / setLastRead）：先存本机、按手机号分账。
       以后上 Redis 只改这两个函数，调用方（app.js / home.js）一行不动
     · 没有 fetch（老浏览器 / 测试沙箱）或没登录时，后端链路静默降级为纯本地

   页面只认 window.PETStore 这一个全局（app.js 是 IIFE，没有模块系统）。
   本文件**不依赖 PET_CONTENT**，所以目录页 / 错题页也能加载它。

   改完这里必须跑： node tools/test-store.mjs

   ⚠ 一处刻意的重复：<head> 里那段防闪烁的内联脚本会直接读 `pet:theme:v1`。
     它不能改成加载本文件 —— 它必须赶在外链样式表之前跑完，那时候再去取一个
     js 文件就太晚了，会先闪一帧亮色。两处的键名必须一致，改一个改两个。
*/
window.PETStore = (function () {
  "use strict";

  var K_USER  = "pet:user:v1";    // { phone, nickname, level, color, ts }
  var K_FAV   = "pet:fav:v1";     // 本地收藏表（界面真相，也是服务器数据的本地镜像）
  var K_FAVQ  = "pet:fav:q:v1";   // 待补写队列（outbox），网络恢复后按序推给后端
  var K_LAST  = "pet:lastread:v1";// 学到哪儿了：{ [phone]: { slug, ref, ts } }
  var K_THEME = "pet:theme:v1";   // ← 与 template.html / 目录页的 <head> 内联脚本共用
  var K_PROBE = "pet:probe:v1";

  var PHONE_RE = /^1[3-9]\d{9}$/;
  var THEMES = ["auto", "light", "dark"];

  /* 登录保持天数：过期就当没登录（顺手清掉登录态）。
     前后端没有 token，这是纯客户端口径 —— 见 README「软门禁」那节。 */
  var LOGIN_DAYS = 14;
  var LOGIN_TTL = LOGIN_DAYS * 24 * 60 * 60 * 1000;

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

  /* ---------- 后端接口 ----------
     地址默认同源 /api：生产由 nginx 反代到 127.0.0.1 的 Node 服务；
     本地联调直接起 server/（它会顺带把 dist/ 伺服出来），什么都不用配。
     特例：拿别的静态服务器（比如 python http.server）开站点时，可以先
     window.PET_API_BASE = "http://localhost:3001/api" 把它指过去。 */

  var API_BASE = (function () {
    try { if (window.PET_API_BASE) return String(window.PET_API_BASE).replace(/\/+$/, ""); } catch (e) {}
    return "/api";
  })();

  var API_TIMEOUT = 8000;

  function apiErr(msg, status) {
    var e = new Error(msg);
    e.status = status || 0;   // 0 = 没到服务器（离线/超时）；4xx = 参数问题，重试没意义
    return e;
  }

  /* 统一接口调用。成功 resolve 解析后的 JSON（要求 ok===true）；
     失败 reject，e.status 区分「暂时失败」和「永久失败」。 */
  function api(path, opts) {
    if (typeof fetch !== "function") return Promise.reject(apiErr("no-fetch", 0));
    var init = { method: (opts && opts.method) || "GET", headers: { "Content-Type": "application/json" } };
    if (opts && opts.body != null) init.body = JSON.stringify(opts.body);
    var ctl = null, timer = null;
    if (typeof AbortController === "function" && typeof setTimeout === "function") {
      ctl = new AbortController();
      init.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, API_TIMEOUT);
    }
    function stop() {
      if (timer != null && typeof clearTimeout === "function") { clearTimeout(timer); timer = null; }
    }
    return fetch(API_BASE + path, init).then(function (res) {
      var body = (res && typeof res.json === "function")
        ? res.json().catch(function () { return null; })
        : Promise.resolve(null);
      return body.then(function (j) {
        stop();
        if (!res || !res.ok) throw apiErr((j && j.err) || ("HTTP " + (res && res.status)), res && res.status);
        if (!j || j.ok !== true) throw apiErr((j && j.err) || "接口返回异常", res.status);
        return j;
      });
    }, function () {
      stop();
      throw apiErr("网络不通", 0);
    });
  }

  /* ---------- 登录态 ---------- */

  async function getUser() {
    var u = readKey(K_USER, null);
    if (!u || !u.phone) return null;
    /* 登录保持 14 天：过期就当未登录，顺手清掉过期登录态（免得一直拖着） */
    var ts = Number(u.ts) || 0;
    if (!ts || Date.now() - ts > LOGIN_TTL) { dropKey(K_USER); return null; }
    return u;
  }

  /* 登录：手机号 + 密码，校验在后端（scrypt 散列比对）。
     失败一律 {ok:false, err}；4xx 拿服务器的原话（「密码不对」之类），
     0/5xx 是网络或服务问题，给一句能懂的提示。 */
  async function login(phone, password) {
    var p = String(phone == null ? "" : phone).replace(/[\s-]/g, "");
    if (!PHONE_RE.test(p)) return { ok: false, err: "请输入 11 位手机号" };
    if (!password) return { ok: false, err: "请输入密码" };
    var r;
    try {
      r = await api("/login", { method: "POST", body: { phone: p, password: String(password) } });
    } catch (e) {
      if (e && e.status >= 400 && e.status < 500) return { ok: false, err: e.message || "登录失败" };
      return { ok: false, err: "连不上服务器，检查网络后再试" };
    }
    var u = Object.assign({ phone: p }, r.user || {}, { ts: Date.now() });
    /* 存不住（隐私模式）也返回 ok：门禁在存储不可用时本来就是放行的，
       这里再拦一道，用户会被永久卡在弹框里出不去。 */
    var persisted = writeKey(K_USER, u);
    return { ok: true, user: u, persisted: persisted };
  }

  /* 注册：手机号 + 昵称 + 密码。规则与 server/lib.mjs 一致（两边都要拦）。 */
  async function register(phone, nickname, password) {
    var p = String(phone == null ? "" : phone).replace(/[\s-]/g, "");
    var nick = String(nickname == null ? "" : nickname).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!PHONE_RE.test(p)) return { ok: false, err: "请输入 11 位手机号" };
    if (!nick || nick.length > 16) return { ok: false, err: "昵称请填 1–16 个字" };
    if (!password || String(password).length < 6 || String(password).length > 64) {
      return { ok: false, err: "密码请填 6–64 位" };
    }
    var r;
    try {
      r = await api("/register", { method: "POST", body: { phone: p, nickname: nick, password: String(password) } });
    } catch (e) {
      if (e && e.status >= 400 && e.status < 500) return { ok: false, err: e.message || "注册失败" };
      return { ok: false, err: "连不上服务器，检查网络后再试" };
    }
    var u = Object.assign({ phone: p }, r.user || {}, { ts: Date.now() });
    var persisted = writeKey(K_USER, u);
    return { ok: true, user: u, completed: !!r.completed, persisted: persisted };
  }

  /* 拉一次最新的昵称/等级/颜色（等级是后端升的，本机缓存可能落后）。
     失败（离线）就返回缓存，绝不清登录态 —— 离线不该被登出。 */
  async function refreshProfile() {
    var u = await getUser();
    if (!u) return null;
    if (typeof fetch !== "function") return u;
    try {
      var r = await api("/me?phone=" + encodeURIComponent(u.phone));
      if (r.user) {
        /* 手机号以本地为准（服务器按 phone 查询，回来的本来就是同一个号）；
           ts 保留：刷新资料不算一次新登录，不该把 14 天重新计时。 */
        var nu = Object.assign({}, u, r.user, { phone: u.phone, ts: u.ts });
        writeKey(K_USER, nu);
        return nu;
      }
    } catch (e) { /* 离线 / 服务挂了：缓存接着用 */ }
    return u;
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
      /* 没有单独的登录页：回到首页并自动弹登录框，登完跳回这里（next）。
         login=1 只是「帮我打开弹框」的记号，不是必须的。 */
      window.location.replace("index.html?login=1&next=" + encodeURIComponent(herePath()));
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

  /* 顶栏那个「昵称（或脱敏手机号）+ 等级色点 + 退出」角标。
     文章页、错题页都要显示登录的人，放这里而不是各页各写一遍 ——
     两处的类名也得一致，不然改一处忘一处，两个页面的角标会长得不一样。
     传进来的 el 不存在就什么都不做。 */
  async function mountWho(el) {
    if (!el) return null;
    var u = await getUser();
    el.textContent = "";
    if (!u || !u.phone) { el.hidden = true; return null; }
    var num = document.createElement("span");
    num.className = "who-num";
    /* 等级色点：颜色来自服务端（pet_user_level 表），没带上就不画 */
    if (u.color) {
      var dot = document.createElement("i");
      dot.className = "who-lv";
      dot.style.background = u.color;
      dot.title = "等级 " + (u.level || 1);
      num.appendChild(dot);
    }
    num.appendChild(document.createTextNode(u.nickname || maskPhone(u.phone)));
    var out = document.createElement("button");
    out.type = "button";
    out.className = "who-out";
    out.textContent = "退出";
    out.addEventListener("click", function () {
      /* 退出后落在首页（首页是公开的，显示「请先登录哦」+ 登录入口）。
         不再像旧版那样自动弹登录框 —— 刚点完退出又被要求登录，会显得没退掉。 */
      logout().then(function () {
        window.location.href = "index.html";
      });
    });
    el.appendChild(num);
    el.appendChild(out);
    el.hidden = false;
    return u;
  }

  /* ---------- 收藏 ----------
     两处数据：
       pet:fav:v1   本地收藏表 —— 界面只认它（renderHistory 是同步的，不等人）
       pet:fav:q:v1 补写队列 —— 每次增删记一条 {k, ph, op, it}，联网时按序推送；
                    推成功的条目在本地表里标 sy=1，防止下次翻页重推一遍。

     条目形状（服务器返回的也是这个形状）：
       单词 { type:"w", key:"century", cn:"世纪", title?, ts? }
       句子 { type:"s", key:"<完整句子文本>", cn:"<翻译>", ana?, title?, ref?, slug?, ts? }
       词组 { type:"p", key:"a couple of", cn:"几个", use?, ex?, exTr?, no?, title?, ts? }
     id = 类型 + key。单词的 key 是词典原形（点 centuries 收的是 century），
     句子的 key 是句子文本 —— 服务端按 sha256(句子) 去重，两边同一把钥匙；
     词组的 key 是词组原文（服务端按 pet_phrase.phrase 去重）。
  */

  function favId(it) {
    if (!it) return "";
    return (it.type || "w") + ":" + (it.key || "");
  }

  function readQ() {
    var q = readKey(K_FAVQ, []);
    return Array.isArray(q) ? q : [];
  }
  function writeQ(q) { writeKey(K_FAVQ, q); }
  function opId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  function pushOp(phone, op) {
    var it = op.it || {};
    var isSent = it.type === "s";
    var isPhrase = it.type === "p";
    if (op.op === "add") {
      if (isSent) {
        return api("/favs/add", { method: "POST", body: {
          phone: phone,
          kind: "sentence",
          sentence: it.key,
          translation: it.cn || "",
          analysis: it.ana ? JSON.stringify(it.ana) : "",
          sourceTitle: it.title || ""
        } });
      }
      if (isPhrase) {
        return api("/favs/add", { method: "POST", body: {
          phone: phone, kind: "phrase", phrase: it.key, meaning: it.cn || "",
          usageNote: it.use || "", example: it.ex || "", exampleCn: it.exTr || "",
          no: it.no || 0, sourceTitle: it.title || ""
        } });
      }
      return api("/favs/add", { method: "POST", body: {
        phone: phone, kind: "word", word: it.key, meaning: it.cn || "",
        phonetic: it.ipa || "", pos: it.pos || "",
        example: it.ex || "", exampleTranslation: it.exTr || "",
        exampleAnalysis: it.exAna ? JSON.stringify(it.exAna) : "",
        phrase: it.ph || "",
        sourceTitle: it.title || ""
      } });
    }
    if (isSent) {
      return api("/favs/remove", { method: "POST", body: { phone: phone, kind: "sentence", sentence: it.key } });
    }
    if (isPhrase) {
      return api("/favs/remove", { method: "POST", body: { phone: phone, kind: "phrase", phrase: it.key } });
    }
    return api("/favs/remove", { method: "POST", body: { phone: phone, kind: "word", word: it.key } });
  }

  /* 推送成功后给本地条目打上「已入库」标记。没有它，reconcile 分不清
     「已同步」和「从没推过」，每次翻页都会把整本收藏重新推一遍。 */
  function markSynced(it) {
    var id = favId(it);
    var arr = readKey(K_FAV, []);
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      if (favId(arr[i]) === id) {
        if (arr[i].sy !== 1) { arr[i].sy = 1; writeKey(K_FAV, arr); }
        return;
      }
    }
  }

  var _flushing = null;

  async function runFlush() {
    if (typeof fetch !== "function") return;
    var u = await getUser();
    var nowPhone = (u && u.phone) || "";
    for (;;) {
      var q = readQ();
      if (!q.length) return;
      var op = q[0];
      /* 条目入队时记下「是谁的收藏」（ph）；换个手机号登录的极端情况下
         也按原主人推送。没记下又没登录 → 等登录了再推。 */
      var phone = op.ph || nowPhone;
      if (!phone) return;
      try {
        await pushOp(phone, op);
      } catch (e) {
        if (e && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
          /* 永久失败（参数/超长之类的 400）：留着会把它后面的所有条目堵死，
             丢掉并留下日志。 */
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[PETStore] 收藏条目推送被拒，已丢弃：", e.message);
          }
        } else {
          throw e;   // 网络不通之类的暂时失败：整队停下，下次再补
        }
      }
      writeQ(readQ().filter(function (x) { return x.k !== op.k; }));
      if (op.op === "add") markSynced(op.it);
    }
  }

  /* 把待补写队列现在就推一遍；addFav / listFav 会自动调它。
     返回的 promise 在这一轮推送结束（成功、失败或被跳过）后 resolve。
     页面别处不直接用它 —— 留成公开接口主要是给测试和调试用。 */
  function syncFavs() {
    if (_flushing) return _flushing;
    var run = Promise.resolve().then(runFlush).catch(function () {});
    _flushing = run.then(function () { _flushing = null; });
    return run;
  }

  /* 对账：本地有条目、服务器还没确认、队列里也没有 → 补进队列。
     覆盖两种来路：断网期间丢队列的操作、旧版本留在 localStorage 里的收藏。
     已标 sy=1 的不重推。 */
  function reconcile(serverIds) {
    var local = readKey(K_FAV, []);
    if (!Array.isArray(local)) return;
    var q = readQ();
    var hasAdd = {};
    q.forEach(function (op) { if (op.op === "add") hasAdd[favId(op.it)] = 1; });
    var listChanged = false, qChanged = false;
    var u = readKey(K_USER, null);
    var ph = (u && u.phone) || "";
    for (var i = 0; i < local.length; i++) {
      var it = local[i];
      var id = favId(it);
      if (!it.key || id.slice(-1) === ":") continue;  // 旧版句子收藏只有 ref/slug，没法补写，跳过
      if (serverIds && serverIds[id]) {
        if (it.sy !== 1) { it.sy = 1; listChanged = true; }
        continue;
      }
      if (it.sy === 1) continue;
      if (hasAdd[id]) continue;
      q.push({ k: opId(), ph: ph, op: "add", it: it });
      hasAdd[id] = 1;
      qChanged = true;
    }
    if (qChanged) writeQ(q);
    if (listChanged) writeKey(K_FAV, local);
  }

  async function listFav() {
    var u = await getUser();
    var serverItems = null;
    if (u && u.phone && typeof fetch === "function") {
      try {
        var r = await api("/favs?phone=" + encodeURIComponent(u.phone));
        serverItems = Array.isArray(r.items) ? r.items : [];
      } catch (e) { serverItems = null; }
    }
    var serverIds = null;
    if (serverItems) {
      /* 服务器读到了 → 本地表重建成「服务器条目 + 还没推上去的本地条目」，
         跨设备收藏在这时并进来。 */
      var delIds = {};
      readQ().forEach(function (op) { if (op.op === "del") delIds[favId(op.it)] = 1; });
      var seen = {}, merged = [];
      serverIds = {};
      serverItems.forEach(function (x) {
        var id = favId(x);
        if (!x.key || id.slice(-1) === ":") return;
        serverIds[id] = 1;
        if (delIds[id] || seen[id]) return;
        seen[id] = 1;
        x.sy = 1;
        merged.push(x);
      });
      /* 本地重读一次再并：拉取期间用户可能又点了一颗星 */
      var local = readKey(K_FAV, []);
      if (Array.isArray(local)) local.forEach(function (it) {
        var id = favId(it);
        if (!it.key || id.slice(-1) === ":" || delIds[id] || seen[id]) return;
        seen[id] = 1;
        merged.push(it);
      });
      writeKey(K_FAV, merged);
    }
    reconcile(serverIds);
    syncFavs();
    var out = readKey(K_FAV, []);
    return Array.isArray(out) ? out : [];
  }

  async function isFav(id) {
    var arr = await listFav();
    for (var i = 0; i < arr.length; i++) if (favId(arr[i]) === id) return true;
    return false;
  }

  /* 点一下收藏、再点一下取消 —— 按钮只有一个，两态都走这里。
     本地立即生效（这个 promise 只等本地写入，不等网络）。 */
  async function addFav(item) {
    var it = Object.assign({}, item || {});
    var id = favId(it);
    if (!id || id.slice(-1) === ":") {
      return { ok: false, added: false, err: "缺少标识" };
    }
    var arr = readKey(K_FAV, []);
    if (!Array.isArray(arr)) arr = [];
    var at = -1;
    for (var i = 0; i < arr.length; i++) if (favId(arr[i]) === id) { at = i; break; }
    var added;
    if (at >= 0) { arr.splice(at, 1); added = false; }
    else { it.ts = Date.now(); it.sy = 0; arr.unshift(it); added = true; }
    var persisted = writeKey(K_FAV, arr);

    /* 队列里记一笔。取消收藏也照记 —— 万一这条的 add 还堵在路上，
       队列按序执行，先 add 后 del 的结果就是最终不存在，不用特殊处理。 */
    var u = readKey(K_USER, null);
    var q = readQ();
    q.push({
      k: opId(),
      ph: (u && u.phone) || "",
      op: added ? "add" : "del",
      it: added ? it : { type: it.type, key: it.key }
    });
    writeQ(q);
    syncFavs();   // 后台推；没有网络就留在队列里

    return { ok: true, added: added, persisted: persisted, id: id };
  }

  /* 固定页面（首页 / 错题页 / 词书页）那个三态主题按钮：
     文案、提示、on 状态一处管 —— 页面只管交一个按钮元素。
     文章页有自己的一份（它要跟顶栏其他工具排一起、并且带更长的提示语），
     两边的「顺序和键名」都归 store.js 的 THEMES / nextTheme 定义，不会走岔。 */
  var THEME_LABEL = { auto: "◐ 跟随", light: "☀ 亮", dark: "☾ 暗" };
  var THEME_TIP = { auto: "主题：跟随系统", light: "主题：亮色", dark: "主题：暗色" };

  function mountTheme(el) {
    if (!el) return;
    function paintBtn(t) {
      el.textContent = THEME_LABEL[t] || THEME_LABEL.auto;
      el.title = THEME_TIP[t] || THEME_TIP.auto;
      el.classList.toggle("on", t !== "auto");
    }
    getTheme().then(paintBtn);
    el.addEventListener("click", function () { nextTheme().then(paintBtn); });
  }

  /* ---------- 字号缩放 ----------
     全站共用一个值（键 pet:zoom:v1，和文章页 app.js 的 LS_ZOOM 同名同范围），
     顶栏那个缩放条由各页面调 PETStore.mountZoom() 装上（id 约定 #zoomRange / #zoomLabel）。
     ⚠ 文章页（app.js）留了自己的一份 applyZoom —— 它额外要重排页边按钮；
     数值范围（1–5，步长 0.5）和存储键两边保持一致，不会走岔。 */
  var K_ZOOM = "pet:zoom:v1";

  async function getZoom() {
    var v = 0;
    try { v = Number(localStorage.getItem(K_ZOOM)); } catch (e) { v = 0; }   // 文章页存的是裸数字 "2"
    if (!(v >= 1 && v <= 5)) v = Number(_mem[K_ZOOM]) || 1;                  // 存储不可用时用内存那份
    return (v >= 1 && v <= 5) ? v : 1;
  }

  async function setZoom(z) {
    z = Math.min(5, Math.max(1, Number(z) || 1));
    /* ⚠ 存「数字」而不是字符串：JSON.stringify(2) === "2"，
       和文章页 app.js 的 localStorage.setItem(LS_ZOOM, String(z)) 同一口径
       （不然两边一个存 "\"2\""、一个存 "2"，换页面缩放就丢）。 */
    writeKey(K_ZOOM, z);
    paintZoom(z);
    return z;
  }

  function paintZoom(z) {
    document.documentElement.style.setProperty("--zoom", z);
    var lab = document.getElementById("zoomLabel");
    if (lab) lab.textContent = (z % 1 ? z.toFixed(1) : z) + "x";
    var r = document.getElementById("zoomRange");
    if (r && Number(r.value) !== z) r.value = String(z);
  }

  /* 固定页面（首页/错题/词书/同义替换/固定搭配/词组库）装缩放条 */
  function mountZoom() {
    var r = document.getElementById("zoomRange");
    if (!r) return;
    r.addEventListener("input", function () { setZoom(r.value); });
    getZoom().then(paintZoom);
  }

  /* ---------- 错题 ----------
     登记走直连（不排队）：错了就报一次，报不上先算了 —— 错题本要的是
     「哪几道错了」这个事实，漏一次比拦着学生做题强。列表页（mistakes.html）
     每次打开都是现拉的，本机不缓存（换设备也能看到自己的错题）。 */

  async function addMistake(item) {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return { ok: false, offline: true };
    try {
      await api("/mistakes", { method: "POST", body: {
        phone: u.phone,
        slug: item && item.slug,
        q: item && item.q,
        chosen: item && item.chosen,
        correct: item && item.correct
      } });
      return { ok: true };
    } catch (e) {
      return { ok: false, err: (e && e.message) || "登记失败" };
    }
  }

  async function listMistakes() {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return [];
    var r = await api("/mistakes?phone=" + encodeURIComponent(u.phone));
    return Array.isArray(r.items) ? r.items : [];
  }

  /* ---------- 词组错题 ----------
     和阅读错题同一套口径：登记直连不排队（错了就报一次，报不上先算了），
     列表每次现拉（换设备也能看到）。 */
  async function addPhraseMistake(item) {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return { ok: false, offline: true };
    try {
      await api("/phrase-mistakes", { method: "POST", body: {
        phone: u.phone,
        no: item && item.no,
        phrase: item && item.phrase,
        stem: item && item.stem,
        chosen: item && item.chosen,
        correct: item && item.correct
      } });
      return { ok: true };
    } catch (e) {
      return { ok: false, err: (e && e.message) || "登记失败" };
    }
  }

  async function listPhraseMistakes() {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return [];
    var r = await api("/phrase-mistakes?phone=" + encodeURIComponent(u.phone));
    return Array.isArray(r.items) ? r.items : [];
  }

  /* ---------- 词组复习（间隔重复） ----------
     答完一题就报一次（对/错 + 当时的等级），服务端算下一级和到期日；
     报不上就算了（跟错题一个口径：漏记一次比拦着学生做题强）。 */
  async function addPhraseReview(item) {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return { ok: false, offline: true };
    try {
      var r = await api("/phrase-review", { method: "POST", body: {
        phone: u.phone,
        no: item && item.no,
        phrase: item && item.phrase,
        level: item && item.level,
        ok: !!(item && item.ok)
      } });
      return { ok: true, level: r && r.level, days: r && r.days };
    } catch (e) {
      return { ok: false, err: (e && e.message) || "登记失败" };
    }
  }

  /* due=1（默认）只要到期的；all=1 拉全部（页面自己算「没练过的」） */
  async function listPhraseReviews(opts) {
    var u = await getUser();
    if (!u || !u.phone || typeof fetch !== "function") return [];
    var q = "/phrase-review?phone=" + encodeURIComponent(u.phone) +
      (opts && opts.all ? "&all=1" : "") + (opts && opts.limit ? "&limit=" + opts.limit : "");
    var r = await api(q);
    return Array.isArray(r.items) ? r.items : [];
  }

  /* ---------- 学到哪儿了 ----------
     现在存本机（按手机号分账，换台设备不通用）。
     上 Redis 时只改这两个函数的内部 —— 接口形状（async、slug + ref）已经定好了，
     调用方（app.js 记录、home.js 跳转）一行不用动。 */

  async function getLastRead() {
    var u = await getUser();
    var map = readKey(K_LAST, null);
    if (!map || typeof map !== "object") return null;
    var it = map[(u && u.phone) || "anon"];
    return (it && it.slug) ? it : null;
  }

  /* ref 是句子 ref（"段-句"）或空；调用方高频调用（每次点词点句），
     这里只写一个小对象，别做重活。 */
  async function setLastRead(slug, ref) {
    if (!slug) return;
    var u = readKey(K_USER, null);
    var key = (u && u.phone) || "anon";
    var map = readKey(K_LAST, null);
    if (!map || typeof map !== "object") map = {};
    /* ref 传空 = 「只想记这篇、保留上次的位置」：同一篇才保留，换篇就清空 */
    var prev = map[key];
    var keep = (prev && prev.slug === slug) ? String(prev.ref || "") : "";
    map[key] = { slug: slug, ref: String(ref || "") || keep, ts: Date.now() };
    writeKey(K_LAST, map);
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

  /* ---- 触摸设备标记 ----
     比 @media(hover:none) 更可靠的一道保险：iPad 接了妙控键盘 / 触控板时，
     hover 媒体查询可能判成 hover:hover，历史行里靠悬停显形的 ☆ / ✕
     就会「永远看不见」（学生在 iPad 上就是这么丢按钮的）。
     这里按 maxTouchPoints 直接给 <html> 挂 .touch，CSS 里常显。 */
  try {
    if (("ontouchstart" in window) || (window.navigator && window.navigator.maxTouchPoints > 0)) {
      document.documentElement.classList.add("touch");
    }
  } catch (e) { /* 老浏览器没有这些属性：跳过，靠 @media(hover:none) 兜 */ }

  return {
    available: available,
    getUser: getUser,
    login: login,
    register: register,
    refreshProfile: refreshProfile,
    logout: logout,
    maskPhone: maskPhone,
    guard: guard,
    safeNext: safeNext,
    mountWho: mountWho,
    mountTheme: mountTheme,
    mountZoom: mountZoom,
    getZoom: getZoom,
    setZoom: setZoom,
    favId: favId,
    listFav: listFav,
    isFav: isFav,
    addFav: addFav,
    syncFavs: syncFavs,
    addMistake: addMistake,
    listMistakes: listMistakes,
    addPhraseMistake: addPhraseMistake,
    listPhraseMistakes: listPhraseMistakes,
    addPhraseReview: addPhraseReview,
    listPhraseReviews: listPhraseReviews,
    getLastRead: getLastRead,
    setLastRead: setLastRead,
    getTheme: getTheme,
    setTheme: setTheme,
    nextTheme: nextTheme,
    paintTheme: function () { return getTheme().then(paint); }
  };
})();
