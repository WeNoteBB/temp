/* 通用视频课 · 播放页（video.html?id=…）
   ================================================================
   这个页面只做四件事：
     ① 按 URL 里的 id 从 /api/video 取视频信息和该用户的进度；
     ② 用原生 <video> 播放，提供 0.75 / 1.0 / 1.25 / 1.5 / 2.0 倍速；
     ③ 如实上报「本次实际观看的墙钟秒数、自然播放位置、是否拖动过」；
     ④ 关闭/切后台时用 sendBeacon 兜底，尽量不丢最后一段进度。

   进度规则在服务端（server/lib.mjs 的 videoProgressNext）：
     · 同一用户 + 视频累计墙钟观看满 5 分钟，才启用续播点；
     · 本次一旦拖动，之后的位置不再更新续播点（拖动前会单独上报一次）；
     · 自然播放到剩余 ≤5 秒算看完，下次从头开始。
   ⚠ 下面的 RECORD_AFTER / COMPLETE_WITHIN 必须与服务端常量一致。
*/
(function () {
  "use strict";

  var RECORD_AFTER = 300;       // 5 分钟（墙钟）
  var COMPLETE_WITHIN = 5;      // 最后 5 秒算看完
  var RATES = [0.75, 1, 1.25, 1.5, 2];
  var LS_RATE = "edu:video:rate";

  var video = document.getElementById("video");
  var titleEl = document.getElementById("videoTitle");
  var metaEl = document.getElementById("videoMeta");
  var statusEl = document.getElementById("videoStatus");
  var tipEl = document.getElementById("videoTip");
  var speedsEl = document.getElementById("videoSpeeds");
  var whoEl = document.getElementById("who");
  var themeEl = document.getElementById("tglTheme");

  if (!video) return;

  var info = null;              // /api/video 返回的 video
  var progress = null;          // 该用户进度（可能 null）
  var currentRate = 1;
  var lastWall = 0;
  var pendingWatched = 0;       // 还没上报的墙钟秒数（可带小数）
  var lastNatural = 0;          // 最后一次自然播放到的位置（拖动后冻结）
  var sessionSeeked = false;    // 本次页面是否发生过用户拖动
  var programmaticSeek = false; // 正在执行「自动续播」的程序跳转
  var completedSent = false;    // 本次页面是否已经报过完成
  var completedConfirmed = false; // 服务端已经确认收到完成状态
  var heartbeat = null;
  var reportChain = Promise.resolve();
  var started = false;
  var loadedOnce = false;

  function now() {
    try { if (window.performance && performance.now) return performance.now(); } catch (e) {}
    return Date.now();
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function setTip(text) {
    if (tipEl) tipEl.textContent = text || "";
  }

  function durationNow() {
    var d = Number(video.duration);
    return isFinite(d) && d > 0 ? d : (info && info.duration) || 0;
  }

  function visible() {
    try { return !document.visibilityState || document.visibilityState !== "hidden"; }
    catch (e) { return true; }
  }

  function nearEnd() {
    var dur = durationNow();
    var pos = Number(video.currentTime) || 0;
    return dur > 0 && dur - pos <= COMPLETE_WITHIN;
  }

  /* 把「距离上次 tick 的墙钟时间」加进待上报秒数。
     只在页面可见、视频正在播放、且没有在拖动时计数。
     force=true 用在 pause / seeking / ended：这些事件触发时状态已经变了，
     但刚刚那一段确实是在播放的，不能漏。 */
  function tick(force) {
    var t = now();
    if (!lastWall) { lastWall = t; return; }
    var canCount = force || (!video.paused && !video.seeking && !video.ended && visible());
    if (canCount && visible()) {
      var d = (t - lastWall) / 1000;
      if (d > 0) pendingWatched += Math.min(d, 5); // 防后台节流/长时间卡顿一次性灌入
    }
    lastWall = t;
  }

  function readRate() {
    try {
      var v = Number(localStorage.getItem(LS_RATE));
      if (RATES.indexOf(v) >= 0) return v;
    } catch (e) {}
    return 1;
  }

  function saveRate(rate) {
    try { localStorage.setItem(LS_RATE, String(rate)); } catch (e) {}
  }

  function paintRate() {
    if (!speedsEl) return;
    var bs = speedsEl.querySelectorAll("[data-rate]");
    for (var i = 0; i < bs.length; i++) {
      var on = Number(bs[i].getAttribute("data-rate")) === currentRate;
      bs[i].classList.toggle("on", on);
      bs[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function applyRate(rate) {
    rate = Number(rate);
    if (RATES.indexOf(rate) < 0) rate = 1;
    currentRate = rate;
    try { video.playbackRate = rate; } catch (e) {}
    paintRate();
  }

  function buildRateButtons() {
    if (!speedsEl) return;
    RATES.forEach(function (rate) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn video-rate";
      b.setAttribute("data-rate", String(rate));
      b.textContent = rate.toFixed(2).replace(/0$/, "") + "×";
      b.title = "设为 " + b.textContent + " 倍速";
      b.addEventListener("click", function () {
        applyRate(rate);
        saveRate(rate);
        setStatus("播放速度 " + b.textContent);
      });
      speedsEl.appendChild(b);
    });
    applyRate(readRate());
  }

  function announceProgress(r, justCompleted) {
    if (!r) return;
    if (justCompleted && r.completed) {
      setStatus("已看完 · 下次打开从头开始");
      setTip("已看完：下次打开会从 0:00 开始。");
      return;
    }
    if (sessionSeeked) {
      setStatus("本次已拖动 · 不更新续播点");
      return;
    }
    var watched = Number(r.watchedSec) || 0;
    if (watched < RECORD_AFTER) {
      setStatus("累计观看 " + fmt(watched) + " / " + fmt(RECORD_AFTER) + "，满 5 分钟后开始记录");
    } else if (r.savedPosition) {
      setStatus("已记录到 " + fmt(r.positionSec));
    }
  }

  /* 一次上报。watchedDelta 是「还没报过的墙钟秒数」，不是 currentTime 的增量。
     opts.force=true 时即使这次没有新的观看秒数也会发（拖动前保存位置用）。 */
  function report(opts) {
    opts = opts || {};
    if (!info || !info.id) return Promise.resolve(null);
    tick(opts.tickForce === true);

    var delta = Math.floor(pendingWatched);
    if (!opts.force && delta < 1) return Promise.resolve(null);
    if (delta > 0) pendingWatched -= delta;
    else pendingWatched = Math.max(0, pendingWatched);

    var body = {
      videoId: info.id,
      position: Math.floor(opts.position != null ? opts.position : lastNatural),
      duration: Math.floor(durationNow()),
      watchedDelta: Math.max(0, delta),
      seeked: !!sessionSeeked,
      completed: !!opts.completed
    };

    reportChain = reportChain.then(function () {
      return PETStore.saveVideoProgress(body);
    }).then(function (r) {
      if (!r || r.ok !== true) throw new Error((r && r.err) || "进度没保存上");
      progress = {
        position: Number(r.positionSec) || 0,
        duration: Number(r.durationSec) || 0,
        watched: Number(r.watchedSec) || 0,
        completed: !!r.completed,
        resume: Number(r.resume) || 0
      };
      if (opts.completed && !r.completed) completedSent = false;
      if (opts.completed && r.completed) completedConfirmed = true;
      if (opts.notify) announceProgress(r, !!opts.completed);
      return r;
    }).catch(function (e) {
      /* 网络类失败把这段观看秒数还回去，下次心跳再试；4xx 说明参数/登录有问题，
         不还回去（否则会一直堵着），页面上的提示交给调用方。 */
      if (!e || !e.status || e.status === 0) pendingWatched += delta;
      if (opts.completed) completedSent = false;
      if (opts.notify) setStatus("进度暂时没同步上，稍后会自动重试");
      return null;
    });

    return reportChain;
  }

  function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(function () {
      report({ notify: false });
    }, 15000);
  }

  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function jumpTo(sec) {
    programmaticSeek = true;
    try { video.currentTime = Math.max(0, Number(sec) || 0); }
    catch (e) { programmaticSeek = false; }
    /* 万一浏览器没有触发 seeked，别让后面的用户拖动一直被当成程序跳转 */
    setTimeout(function () { programmaticSeek = false; }, 3000);
  }

  function onLoadedMetadata() {
    if (loadedOnce) return;
    loadedOnce = true;
    var dur = durationNow();
    var resume = progress && progress.resume ? Number(progress.resume) : 0;
    if (resume > 0 && dur > 0 && resume < dur - 1) {
      jumpTo(resume);
      setStatus("已续播到 " + fmt(resume));
    } else if (progress && progress.completed) {
      setStatus("上次已看完 · 从 0:00 开始");
    } else {
      setStatus("从 0:00 开始");
    }
    lastNatural = Math.max(0, Number(video.currentTime) || 0);
    applyRate(currentRate);
    var watched = progress ? Number(progress.watched) || 0 : 0;
    if (progress && progress.completed && !(resume > 0)) {
      setTip("已看完：下次打开会从 0:00 开始。");
    } else if (watched < RECORD_AFTER) {
      setTip("累计观看满 5 分钟后开始记录续播点；拖动进度条的这一次不记录。");
    } else {
      setTip("进度按账号保存，换设备登录后也能续播。");
    }
  }

  function onTimeUpdate() {
    if (!started) return;
    tick();
    if (video.seeking || programmaticSeek || sessionSeeked) return;
    lastNatural = Math.max(0, Number(video.currentTime) || 0);

    var dur = durationNow();
    if (!completedSent && dur > 0 && dur - lastNatural <= COMPLETE_WITHIN) {
      completedSent = true;
      lastNatural = dur;
      report({ completed: true, force: true, notify: true, tickForce: true });
    }
  }

  function onPlay() {
    started = true;
    lastWall = now();
    applyRate(currentRate);
    startHeartbeat();
  }

  function onPause() {
    tick(true);
    if (!sessionSeeked && !completedSent && nearEnd()) {
      completedSent = true;
      lastNatural = durationNow();
      report({ completed: true, force: true, notify: true });
    } else {
      report({ notify: true });
    }
    stopHeartbeat();
  }

  function onSeeking() {
    /* 自动续播的程序跳转不算用户拖动 */
    if (programmaticSeek) return;
    if (!sessionSeeked) {
      tick(true);
      /* 先把拖动前的自然位置单独报一次；这次 seeked=false，所以
         如果累计已满 5 分钟，服务端会把它写成续播点。
         pre=0 时不上报：避免「刚打开还没加载完就拖动」把已有进度写成 0。 */
      var pre = Math.floor(lastNatural);
      if (pre > 0) report({ position: pre, force: true, notify: true, tickForce: false });
      sessionSeeked = true;
      setStatus("已拖动 · 本次播放不再更新续播点");
      setTip("拖动不会记录；本次只保留拖动前自然播放到的位置。重新打开页面后恢复记录。");
    }
    lastWall = now();
  }

  function onSeeked() {
    if (programmaticSeek) {
      programmaticSeek = false;
      lastNatural = Math.max(0, Number(video.currentTime) || 0);
    }
    lastWall = now();
  }

  function onEnded() {
    tick(true);
    stopHeartbeat();
    if (sessionSeeked) {
      report({ notify: true });
      setStatus("拖动过，本次不算看完");
      return;
    }
    if (!completedSent) {
      completedSent = true;
      lastNatural = durationNow();
      report({ completed: true, force: true, notify: true, tickForce: false });
    }
  }

  function onWaiting() {
    tick(true);
    lastWall = 0;
  }

  function onPlaying() {
    lastWall = now();
    startHeartbeat();
  }

  function flushBeacon() {
    if (!info || !info.id) return;
    tick();
    if (!sessionSeeked && !completedSent && nearEnd()) {
      completedSent = true;
      lastNatural = durationNow();
    }
    var delta = Math.floor(pendingWatched);
    var body = {
      videoId: info.id,
      position: Math.floor(sessionSeeked ? lastNatural : (video.currentTime || lastNatural)),
      duration: Math.floor(durationNow()),
      watchedDelta: Math.max(0, delta),
      seeked: !!sessionSeeked,
      completed: !!completedSent && !completedConfirmed && !sessionSeeked
    };
    if (delta <= 0 && !body.completed) return;
    if (delta > 0) pendingWatched -= delta;
    var sent = false;
    try { sent = PETStore.videoProgressBeacon(body); } catch (e) { sent = false; }
    if (!sent) {
      /* 老浏览器没有 sendBeacon：退回 keepalive fetch（不保证一定发出去） */
      try {
        var base = (window.PET_API_BASE || "/api").replace(/\/+$/, "");
        var u = null;
        try { u = JSON.parse(localStorage.getItem("pet:user:v1") || "null"); } catch (e2) {}
        if (u && u.phone) {
          body.phone = u.phone;
          fetch(base + "/video/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true
          });
        }
      } catch (e3) { /* 页面已经要走了，发不出去也没别的办法 */ }
    }
  }

  function fail(msg) {
    setStatus(msg);
    setTip(msg);
    video.hidden = true;
  }

  async function init() {
    if (whoEl) PETStore.mountWho(whoEl);
    if (themeEl) PETStore.mountTheme(themeEl);
    PETStore.mountZoom();
    buildRateButtons();

    var id = "";
    try {
      var q = new URLSearchParams(window.location.search);
      id = q.get("id") || q.get("vid") || "";
    } catch (e) { id = ""; }
    if (!/^\d+$/.test(id) || Number(id) < 1) {
      fail("缺少视频参数：请在地址后面加 ?id=1（数字是数据库里的视频 id；也认 ?vid=1）");
      return;
    }

    var user = await PETStore.getUser();
    if (!user) {
      fail("请先登录，登录后才能保存和恢复播放进度。");
      return;
    }

    var r;
    try {
      r = await PETStore.getVideo(id);
    } catch (e) {
      fail((e && e.message) || "视频信息加载失败");
      return;
    }

    info = r.video;
    progress = r.progress;
    if (titleEl) titleEl.textContent = info.lesson || "课程视频";
    document.title = (info.lesson || "课程视频") + " · 课程视频";
    /* 课名里已经保留了【真题练】；这里只显示 科目/年级/课程，避免重复。
       lessonType 仍然入库，留给以后筛选/统计用。 */
    if (metaEl) {
      metaEl.textContent = [info.subject, info.grade, info.course]
        .filter(function (x) { return !!x; }).join(" · ");
    }
    if (!info.fileUrl) {
      fail("这个视频还没有配置播放地址。");
      return;
    }

    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.controls = true;

    /* 监听先挂好，再设 src —— 否则命中缓存的小视频可能在监听挂上之前就跑完 metadata */
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("ratechange", function () {
      /* 只在外部（比如浏览器记住的倍速）改了 rate 时同步按钮 */
      var r0 = Number(video.playbackRate);
      if (RATES.indexOf(r0) >= 0 && r0 !== currentRate) {
        currentRate = r0;
        paintRate();
      }
    });
    video.addEventListener("error", function () {
      stopHeartbeat();
      fail("视频加载失败：检查播放地址和文件格式（MKV 建议先转 MP4）。");
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        tick(true);
        flushBeacon();
      } else {
        lastWall = now();
      }
    });
    window.addEventListener("pagehide", flushBeacon);
    window.addEventListener("beforeunload", flushBeacon);

    applyRate(currentRate);
    video.src = info.fileUrl;
    try { video.load(); } catch (e) {}
  }

  init().catch(function (e) {
    fail((e && e.message) || "页面初始化失败");
  });
})();
