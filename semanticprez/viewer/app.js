(function () {
  "use strict";
  var T = window.TAXONOMY;
  var root = document.getElementById("impress");
  var LANGS = T.languages;
  var PRIMARY = LANGS[0];
  var MEDIA_AS = { image: 1, video: 1 };
  var STAGE_SKIP = { note: 1, links: 1, chips: 1 }; // omitted on cards that host children

  // ---------- config-driven styling (branch colors + language visibility) ----------
  (function injectStyle() {
    var css = ":root{";
    Object.keys(T.branchColors).forEach(function (id) { css += "--" + id + ":" + T.branchColors[id] + ";"; });
    css += "}";
    LANGS.forEach(function (lg) { css += "body.show-" + lg + " .l:not(.l-" + lg + "){display:none!important}"; });
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  })();

  // ---------- Model ----------
  var node = {};
  T.steps.forEach(function (s) { node[s.id] = Object.assign({}, s); });
  node.overview = {
    id: "overview", depth: 0, parent: null, branch: null,
    child_ids: T.tops.slice(),
    fields: { title: T.scheme.title, description: T.scheme.description }
  };
  T.tops.forEach(function (t) { if (node[t]) node[t].parent = "overview"; });
  T.index.overview = T.scheme.title;

  function kids(id) { return (node[id] && node[id].child_ids) || []; }
  function accent(id) { var b = node[id] && node[id].branch; return b ? "var(--" + b + ")" : "#c9d1d9"; }

  // ---------- Nested-box layout ----------
  var BOX_W = 1280, BOX_H = 800, ASPECT = BOX_H / BOX_W, ROOT_W = 14400;
  var pos = {};
  var STAGE_TOP = 0.40;    // children start here (leaves a gap below the divider line)...
  var STAGE_BOTTOM = 0.97; // ...down to here. Content area is the top 36% (see CSS).
  var MAX_ROWS = 2;
  var FANOUT_LIMIT = 8;    // more children than this -> bullet list, not nested cards
  function layout(id, cx, cy, w) {
    pos[id] = { cx: cx, cy: cy, scale: w / BOX_W };
    var ch = kids(id);
    if (!ch.length) return;
    var n = ch.length, h = w * ASPECT;

    // high fan-out: the parent shows a bullet list (see cardHTML); lay the
    // children out as full-size slides in a grid BELOW the parent box, so they
    // sit off-screen when the parent is shown but fill the screen when entered.
    if (n > FANOUT_LIMIT) {
      var lcols = 5, lcw = w * 0.30, lchh = lcw * ASPECT, lgap = 0.05 * w;
      var lrows = Math.ceil(n / lcols);
      // start the grid a full box-height below the parent so it never peeks
      // into view while the parent slide is shown
      var topY = cy + h / 2 + h + lchh / 2;
      var li = 0;
      for (var lr = 0; lr < lrows; lr++) {
        var lcount = Math.min(lcols, n - lr * lcols);
        var lrowW = lcw * lcount + lgap * (lcount - 1);
        var lsx = cx - lrowW / 2 + lcw / 2;
        var lry = topY + lr * (lchh + lgap);
        for (var lc = 0; lc < lcount; lc++) layout(ch[li++], lsx + lc * (lcw + lgap), lry, lcw);
      }
      return;
    }
    var stripW = 0.92 * w, stripH = (STAGE_BOTTOM - STAGE_TOP) * h;
    var stripMidY = cy - h / 2 + (STAGE_TOP + STAGE_BOTTOM) / 2 * h;
    var gap = 0.02 * stripW;

    // pick the row count (1..MAX_ROWS) that maximises the child box size
    var best = null;
    for (var r = 1; r <= Math.min(MAX_ROWS, n); r++) {
      var c = Math.ceil(n / r);
      var cw = Math.min((stripW - gap * (c - 1)) / c, ((stripH - gap * (r - 1)) / r) / ASPECT);
      if (!best || cw > best.cw) best = { r: r, c: c, cw: cw };
    }
    var rows = best.r, cols = best.c, cw = best.cw, chh = cw * ASPECT;
    var gridH = chh * rows + gap * (rows - 1);
    var firstRowCY = stripMidY - gridH / 2 + chh / 2;

    var idx = 0;
    for (var ri = 0; ri < rows; ri++) {
      var count = Math.min(cols, n - ri * cols);
      var rowW = cw * count + gap * (count - 1);
      var startCX = cx - rowW / 2 + cw / 2;
      var rowCY = firstRowCY + ri * (chh + gap);
      for (var ci = 0; ci < count; ci++) layout(ch[idx++], startCX + ci * (cw + gap), rowCY, cw);
    }
  }
  layout("overview", 0, 0, ROOT_W);

  // ---------- Helpers ----------
  function esc(x) {
    return (x == null ? "" : String(x)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function titleText(id, lang) { var o = T.index[id] || {}; return o[lang] || o[PRIMARY] || id; }
  function locHTML(val, isMulti, prefix) {
    if (val == null) return "";
    prefix = prefix || "";
    return LANGS.map(function (lg) {
      var v = val[lg];
      if (v == null || (Array.isArray(v) && !v.length)) return "";
      var txt = Array.isArray(v) ? v.join(", ") : v;
      return '<span class="l l-' + lg + (lg === PRIMARY ? " primary" : " secondary") + '">' +
        esc(prefix) + esc(txt) + "</span>";
    }).join("");
  }
  function labelHTML(lbl) { return !lbl ? "" : (typeof lbl === "string" ? esc(lbl) : locHTML(lbl, false)); }
  // localized HTML, falling back to the id wrapped in a proper .l span so the
  // title/chip styling (and language rules) still apply to unlabeled nodes
  function locOrId(valObj, id, prefix) {
    prefix = prefix || "";
    return locHTML(valObj, false, prefix) ||
      '<span class="l l-' + PRIMARY + ' primary">' + esc(prefix) + esc(titleText(id, PRIMARY)) + "</span>";
  }
  function chipLabel(id) { return locOrId(T.index[id] || {}, id); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function breadcrumb(n) {
    var chain = [], p = n.parent;
    while (p && node[p]) { chain.unshift(p); p = node[p].parent; }
    if (!chain.length) return "";
    return '<div class="breadcrumb">' + chain.map(function (id) {
      return esc(titleText(id, PRIMARY));   // primary language only, to stay compact
    }).join('<span class="sep">›</span>') + "</div>";
  }

  // ---------- Slot renderer (driven by config `display`) ----------
  function renderSlot(entry, n) {
    var val = n.fields && n.fields[entry.field];
    if (val == null || (Array.isArray(val) && !val.length)) return "";
    var arr = Array.isArray(val) ? val : [val];
    switch (entry.as) {
      case "subtitle":  return '<div class="subtitle">' + locHTML(val, true) + "</div>";
      case "paragraph": return '<div class="def">' + locHTML(val, false) + "</div>";
      case "note":      return '<p class="note"><b>' + labelHTML(entry.label) + ":</b> " + locHTML(val, false) + "</p>";
      case "image":     return '<div class="imgwrap"><img src="' + esc(arr[0]) + '" alt="" decoding="async" loading="eager" onerror="this.parentNode.style.display=\'none\'"></div>';
      case "video":     return '<div class="vidwrap"><video src="' + esc(arr[0]) + '" controls preload="metadata"></video></div>';
      case "links":     return '<div class="chips"><span class="lbl">' + labelHTML(entry.label) + "</span>" +
                          arr.map(function (u) { return '<a class="chip link" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(hostOf(u)) + "</a>"; }).join("") + "</div>";
      case "chips":     var ids = arr.filter(function (id) { return node[id]; });
                        if (!ids.length) return "";
                        return '<div class="chips"><span class="lbl">' + labelHTML(entry.label) + "</span>" +
                          ids.map(function (id) { return '<span class="chip" data-goto="' + esc(id) + '">' + chipLabel(id) + "</span>"; }).join("") + "</div>";
    }
    return "";
  }

  function cardHTML(n) {
    var hasKids = kids(n.id).length > 0;
    var media = [], text = [];
    T.display.forEach(function (entry) {
      if (hasKids && STAGE_SKIP[entry.as]) return;             // keep host cards compact
      var html = renderSlot(entry, n);
      if (!html) return;
      (MEDIA_AS[entry.as] ? media : text).push(html);
    });

    // number = this node's position among its parent's children, shown inline
    // before the title as "N. " (same font/colour as the title)
    var idx = n.parent ? (kids(n.parent).indexOf(n.id) + 1) : 0;
    var eyebrow = n.id === "overview" ? "Taxonomy" : (n.branch ? esc(titleText(n.branch, PRIMARY)) : "");
    var titleHtml = locOrId(n.fields.title, n.id, idx ? idx + ". " : "");
    var left = '<div class="eyebrow">' + eyebrow + "</div>" + breadcrumb(n) +
      '<h1 class="title">' + titleHtml + "</h1>" + text.join("");
    // top region: title + text on the left, image on the top-right
    var top = '<div class="top' + (media.length ? " has-media" : "") + '">' +
      '<div class="top-left">' + left + "</div>" +
      (media.length ? '<div class="top-right">' + media.join("") + "</div>" : "") +
      "</div>";

    if (hasKids) {
      var kd = kids(n.id), many = kd.length > FANOUT_LIMIT;
      var inner = '<div class="content">' + top + "</div>";
      if (many) {
        inner += '<div class="childlist">' + kd.map(function (id, i) {
          return '<button class="cl-item" data-goto="' + esc(id) + '"><span class="cl-num">' +
            (i + 1) + ".</span> " + chipLabel(id) + "</button>";
        }).join("") + "</div>";
      }
      return '<div class="card has-stage' + (many ? " list-mode" : "") + '">' + inner + "</div>";
    }
    return '<div class="card">' + top + "</div>";
  }

  function makeStep(id) {
    var n = node[id], p = pos[id];
    var el = document.createElement("div");
    el.id = "step-" + id;
    el.className = "step depth-" + n.depth + (kids(id).length ? " has-kids" : " leaf");
    el.style.setProperty("--accent", accent(id));
    el.setAttribute("data-x", Math.round(p.cx));
    el.setAttribute("data-y", Math.round(p.cy));
    el.setAttribute("data-scale", +p.scale.toFixed(4));
    el.innerHTML = cardHTML(n);
    return el;
  }

  root.appendChild(makeStep("overview"));
  (function dfs(id) {
    if (id !== "overview") root.appendChild(makeStep(id));
    kids(id).forEach(dfs);
  })("overview");

  window.addEventListener("load", function () {
    root.querySelectorAll("img").forEach(function (im) { if (im.decode) im.decode().catch(function () {}); });
  });

  // ---------- detail-slide visibility for high-fan-out (list-mode) nodes ----------
  // Any slide whose nearest ancestor is a list-mode node (>FANOUT_LIMIT children)
  // is a "detail" slide: hidden everywhere except when the current slide is inside
  // that same subtree. Works at any depth.
  var stepGroup = {}, groupMembers = {};
  Object.keys(node).forEach(function (id) {
    var p = node[id].parent, g = null;
    while (p) { if (kids(p).length > FANOUT_LIMIT) { g = p; break; } p = node[p].parent; }
    stepGroup[id] = g;
    if (g) {
      (groupMembers[g] = groupMembers[g] || []).push(id);
      var el = document.getElementById("step-" + id);
      if (el) el.classList.add("detail");
    }
  });
  var revealedGroup = null;
  function setGroupReveal(g, on) {
    (groupMembers[g] || []).forEach(function (id) {
      var el = document.getElementById("step-" + id);
      if (el) el.classList.toggle("reveal", on);
    });
  }
  function updateReveal() {
    var g = stepGroup[current] || null;
    if (g === revealedGroup) return;
    if (revealedGroup) setGroupReveal(revealedGroup, false);
    if (g) setGroupReveal(g, true);
    revealedGroup = g;
  }

  // ---------- impress init ----------
  var api = impress();
  var current = "overview";
  function gotoId(id) { var el = document.getElementById("step-" + id); if (el) api.goto(el); }
  root.addEventListener("impress:stepenter", function (e) {
    current = e.target.id.replace(/^step-/, "");
    updateReveal();
  });

  function siblings(id) { var p = node[id] && node[id].parent; return p ? kids(p) : ["overview"]; }
  var ready = false, lockUntil = 0;
  function move(dir) {
    if (!ready) return;
    var t = Date.now();
    if (t < lockUntil) return;
    lockUntil = t + 260;
    var n = node[current];
    if (!n) return;
    if (dir === "root") gotoId("overview");
    else if (dir === "down") { var c = kids(current); if (c.length) gotoId(c[0]); }
    else if (dir === "up") { if (n.parent) gotoId(n.parent); }
    else {
      var sib = siblings(current), i = sib.indexOf(current);
      if (i < 0) return;
      var j = dir === "right" ? (i + 1) % sib.length : (i - 1 + sib.length) % sib.length;
      gotoId(sib[j]);
    }
  }

  // digit key -> jump straight to the numbered slide (the badges shown on the
  // current slide's children; or, on a leaf, to that sibling of the same level)
  function jumpTo(d) {
    if (!ready) return;
    var t = Date.now();
    if (t < lockUntil) return;
    lockUntil = t + 260;
    var group = kids(current).length ? kids(current) : siblings(current);
    if (d >= 1 && d <= group.length) gotoId(group[d - 1]);
  }

  var KEYS = {
    ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down",
    " ": "right", Spacebar: "right", Tab: "up", PageDown: "right", PageUp: "left",
    Escape: "root", Home: "root"
  };
  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault(); e.stopImmediatePropagation(); jumpTo(+e.key); return;
    }
    var dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    move(dir);
  }, true);
  window.addEventListener("keyup", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!KEYS[e.key]) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  api.init();

  // one-time warm-up behind the loading cover
  window.addEventListener("load", function () {
    var cover = document.getElementById("warmup"), firstTop = T.tops[0], D = 560;
    gotoId(firstTop);
    setTimeout(function () {
      gotoId("overview");
      setTimeout(function () {
        ready = true;
        if (cover) { cover.classList.add("hide"); setTimeout(function () { cover.remove(); }, 500); }
      }, D);
    }, D);
  });

  // click chips / legend / cards
  document.addEventListener("click", function (e) {
    var g = e.target.closest("[data-goto]");
    if (g) { gotoId(g.getAttribute("data-goto")); return; }
    if (e.target.closest("a.link")) return;               // let external links open
    var st = e.target.closest(".step");
    if (st && st.id !== "step-" + current) api.goto(st);
  });
  document.getElementById("overview-btn").addEventListener("click", function () { gotoId("overview"); });

  // ---------- Auto-hide bottom nav bar ----------
  var navbar = document.getElementById("navbar");
  var navTimer;
  function showNav() { clearTimeout(navTimer); navbar.classList.add("show"); }
  function hideNavSoon() {
    clearTimeout(navTimer);
    navTimer = setTimeout(function () { if (!navbar.matches(":hover")) navbar.classList.remove("show"); }, 500);
  }
  window.addEventListener("mousemove", function (e) {
    if (window.innerHeight - e.clientY <= 90) showNav(); else hideNavSoon();
  });
  navbar.addEventListener("mouseenter", showNav);
  navbar.addEventListener("mouseleave", hideNavSoon);
  // reveal briefly on load so it's discoverable, then tuck away
  window.addEventListener("load", function () { showNav(); setTimeout(hideNavSoon, 2600); });

  // ---------- Language switch (one button per language, single selection) ----------
  var switchEl = document.getElementById("lang-switch");
  function setLang(lg) {
    document.body.className = "show-" + lg;
    Array.prototype.forEach.call(switchEl.children, function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === lg);
    });
  }
  LANGS.forEach(function (lg) {
    var b = document.createElement("button");
    b.textContent = lg.toUpperCase();
    b.setAttribute("data-lang", lg);
    b.title = "Show " + lg.toUpperCase();
    b.addEventListener("click", function () { setLang(lg); });
    switchEl.appendChild(b);
  });
  setLang(LANGS[0]);  // default = first configured language (English)

  // L cycles to the next language
  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || (e.key !== "l" && e.key !== "L")) return;
    var cur = document.body.className.replace("show-", "");
    var i = LANGS.indexOf(cur);
    setLang(LANGS[(i + 1) % LANGS.length]);
  });
})();
