/* 通用视频课 · 课程目录（videos.html）
   ================================================================
   首页「数学补习」磁贴现在指向这里。
   /api/videos 返回：课程 + 每个视频 + 该用户的进度（position/watched/completed/resume）。
   这个页面只负责把目录和「看到哪」画出来；点任意一课进 video.html?id=…。
*/
(function () {
  "use strict";

  var S = window.PETStore;
  var subEl = document.getElementById("vcSub");
  var listEl = document.getElementById("vcList");
  var whoEl = document.getElementById("who");
  var themeEl = document.getElementById("tglTheme");

  if (!listEl || !S) return;

  var RECORD_AFTER = 300; // 与 engine/video.js、server/lib.mjs 保持一致

  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function text(tag, cls, value) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = value == null ? "" : String(value);
    return el;
  }

  function statusText(v) {
    if (v.completed) {
      return v.resume > 0 ? "看到 " + fmt(v.resume) + " · 已看完" : "已看完";
    }
    if (v.position > 0 && v.watched >= RECORD_AFTER) return "看到 " + fmt(v.position);
    if (v.watched > 0) return "已看 " + fmt(v.watched) + " · 满 5 分钟后记录";
    return "未开始";
  }

  function pct(v) {
    if (v.completed) return 100;
    if (v.duration > 0 && v.position > 0) {
      return Math.max(0, Math.min(100, v.position / v.duration * 100));
    }
    return 0;
  }

  function pickResume(videos) {
    var best = null;
    videos.forEach(function (v) {
      if (v.lastPlayedAt > 0 && !v.completed && (!best || v.lastPlayedAt > best.lastPlayedAt)) best = v;
    });
    if (best) return best;
    for (var i = 0; i < videos.length; i++) if (!videos[i].completed) return videos[i];
    return videos[0] || null;
  }

  function empty(msg) {
    listEl.textContent = "";
    listEl.appendChild(text("div", "vc-empty", msg));
    if (subEl) subEl.textContent = "";
  }

  function renderCourse(c) {
    var sec = document.createElement("section");
    sec.className = "vc-course";

    var head = document.createElement("div");
    head.className = "vc-head";

    var left = document.createElement("div");
    left.className = "vc-head-main";
    left.appendChild(text("h2", "vc-title-h", c.name || "课程"));
    var meta = [c.subject, c.grade, c.videos.length + " 课"].filter(function (x) { return !!x; }).join(" · ");
    left.appendChild(text("p", "vc-meta", meta));
    head.appendChild(left);

    var resume = pickResume(c.videos);
    if (resume) {
      var go = document.createElement("a");
      go.className = "btn pri vc-go";
      go.href = "video.html?id=" + encodeURIComponent(resume.id);
      go.textContent = resume.completed
        ? "重新播放"
        : (resume.lastPlayedAt > 0
          ? "继续上次" + (resume.resume > 0 ? " · " + fmt(resume.resume) : "")
          : "开始学习");
      head.appendChild(go);
    }
    sec.appendChild(head);

    var rows = document.createElement("div");
    rows.className = "vc-rows";
    c.videos.forEach(function (v) {
      var a = document.createElement("a");
      a.className = "vc-row" + (v.completed ? " done" : "");
      a.href = "video.html?id=" + encodeURIComponent(v.id);
      a.title = (v.lesson || "") + " · " + statusText(v);

      a.appendChild(text("span", "vc-seq", String(v.seq).padStart(2, "0")));

      var main = document.createElement("span");
      main.className = "vc-main";
      main.appendChild(text("span", "vc-title", v.lesson || "未命名课程"));

      var bar = document.createElement("span");
      bar.className = "vc-bar";
      var fill = document.createElement("i");
      fill.style.width = pct(v).toFixed(1) + "%";
      bar.appendChild(fill);
      main.appendChild(bar);

      var sub = v.duration > 0 ? "总时长 " + fmt(v.duration) : "时长待回填";
      if (v.lessonType && (v.lesson || "").indexOf("【" + v.lessonType + "】") < 0 && v.lessonType !== "正课") {
        sub = v.lessonType + " · " + sub;
      }
      main.appendChild(text("span", "vc-sub", sub));
      a.appendChild(main);

      a.appendChild(text("span", "vc-state" + (v.completed ? " ok" : ""), statusText(v)));
      rows.appendChild(a);
    });

    sec.appendChild(rows);
    return sec;
  }

  function render(courses) {
    listEl.textContent = "";
    if (!courses || !courses.length) {
      empty("还没有上架的视频。等老师把课程数据导入后，这里就会出现。");
      return;
    }
    var total = 0;
    courses.forEach(function (c) {
      total += (c.videos || []).length;
      listEl.appendChild(renderCourse(c));
    });
    if (subEl) {
      subEl.textContent = "共 " + courses.length + " 个课程 · " + total +
        " 个视频；点任意一课开始，进度按账号保存。";
    }
  }

  async function init() {
    if (whoEl) S.mountWho(whoEl);
    if (themeEl) S.mountTheme(themeEl);
    S.mountZoom();
    try {
      var courses = await S.listVideoCourses();
      render(courses);
    } catch (e) {
      empty((e && e.message) || "课程列表加载失败，刷新试试。");
    }
  }

  init().catch(function (e) {
    empty((e && e.message) || "课程列表加载失败，刷新试试。");
  });
})();
