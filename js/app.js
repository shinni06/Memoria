/* Memory Jar app: DOM rendering, interaction, and screen flow.
   Physics lives in physics.js; helpers in utils/media/storage. */
(function () {
  'use strict';

  var U = MJUtils;
  var P = MJPhysics;
  var M = MJMedia;
  var S = MJStorage;

  /* Jar-local unit space: the jar body occupies BODY inside the physics
     coordinate system, so on-screen size maps linearly to physics units. */
  var BODY = { x: 14, y: 26, w: 72, h: 86 };
  var MAX_MARBLES = 30;
  var NUDGE_AT = 21;          // marble count that starts nudging the user to seal
  var DRAG_START_PX = 6;      // pointer travel before a press becomes a drag

  var LID_PALETTE = [
    { name: 'Random pastel', value: 'random', random: true },
    { name: 'Mint', value: '#BFE7D4' },
    { name: 'Lavender', value: '#CEC5F0' },
    { name: 'Butter', value: '#F3D88B' },
    { name: 'Sky', value: '#B9DFF0' },
    { name: 'Peach', value: '#F4CDAF' }
  ];
  var FIXED_LIDS = LID_PALETTE.filter(function (color) { return !color.random; });

  /* ---------- State ---------- */

  function newJar() {
    return { id: U.uid(), startDate: U.nowISO(), marbles: [], lidColor: randomLidColor(), lidMode: 'random' };
  }

  function randomLidColor() {
    return FIXED_LIDS[Math.floor(Math.random() * FIXED_LIDS.length)].value;
  }

  /* Deterministic fallback color for jars saved without one. */
  function lidColorFor(jar) {
    if (jar.lidColor) return jar.lidColor;
    var hash = 0;
    for (var i = 0; i < jar.id.length; i++) hash = (hash * 31 + jar.id.charCodeAt(i)) >>> 0;
    jar.lidColor = FIXED_LIDS[hash % FIXED_LIDS.length].value;
    return jar.lidColor;
  }

  function loadInitialState() {
    var saved = S.load();
    if (!saved) return { active: newJar(), sealed: [] };
    S.normalize(saved);
    if (!saved.active) saved.active = newJar();
    return saved;
  }

  var state = loadInitialState();

  function saveState() {
    S.save(state);
  }

  /* ---------- Toast ---------- */

  var toastTimer = null;

  function showToast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
  }

  function toastFallbackNotice() {
    if (!S.isAvailable()) showToast('Photos will stay for this visit only on this browser');
  }

  /* ---------- Seal modal: lid colour picker ---------- */

  var pendingLidColor;
  var pendingLidMode;

  function renderLidPalette(selectedColor, selectedMode) {
    var options = document.getElementById('lid-color-options');
    options.innerHTML = '';
    LID_PALETTE.forEach(function (color) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'lid-color-option' + (color.random ? ' random' : '');
      if (!color.random) option.style.setProperty('--swatch-color', color.value);
      option.title = color.name;
      option.setAttribute('aria-label', color.name + ' jar');
      option.setAttribute('role', 'radio');
      var checked = color.random
        ? selectedMode === 'random'
        : selectedMode !== 'random' && color.value === selectedColor;
      option.setAttribute('aria-checked', checked ? 'true' : 'false');
      option.addEventListener('click', function () {
        if (color.random) {
          pendingLidMode = 'random';
          pendingLidColor = randomLidColor();
        } else {
          pendingLidMode = 'fixed';
          pendingLidColor = color.value;
        }
        renderLidPalette(pendingLidColor, pendingLidMode);
      });
      options.appendChild(option);
    });
  }

  /* ---------- Jar & marble DOM ---------- */

  function buildJarElement(jarData, live) {
    var jar = document.createElement('div');
    jar.className = live ? 'jar jar-live' : 'jar';
    jar.style.setProperty('--lid-color', lidColorFor(jarData || state.active));
    jar.innerHTML =
      '<div class="jar-contact-shadow" aria-hidden="true"></div>' +
      '<div class="jar-body-shell" aria-hidden="true"></div>' +
      '<div class="jar-base" aria-hidden="true"></div>' +
      '<div class="jar-marbles"></div>' +
      '<div class="jar-glass-front" aria-hidden="true"></div>' +
      '<div class="jar-neck" aria-hidden="true"></div>' +
      '<div class="jar-rim" aria-hidden="true"></div>' +
      '<div class="jar-lid" aria-hidden="true">' +
        '<div class="lid-side"></div>' +
        '<div class="lid-top"></div>' +
        '<div class="lid-lip"></div>' +
      '</div>';
    return jar;
  }

  /* Static jars (shelves + viewer) use percent positioning; the live jar uses
     pixel transforms driven by the physics loop. */
  function marbleStaticStyle(el, m) {
    el.style.left = ((m.x - BODY.x) / BODY.w * 100) + '%';
    el.style.top = ((m.y - BODY.y) / BODY.h * 100) + '%';
    el.style.width = (m.r * 2 / BODY.w * 100) + '%';
    el.style.height = (m.r * 2 / BODY.h * 100) + '%';
  }

  /* Layered sphere shading: limb darkening + rim light + hot specular + soft
     fill + photo wash, blended over the photo crop. shadowY sets the cast
     shadow offset (3px in-jar, 14px for the draw floater). */
  function marbleVisual(m) {
    var tint = m.tint;
    var dark = U.shade(tint, 0.52);
    var deeper = U.shade(tint, 0.34);
    var light = U.shade(tint, 1.18);
    return {
      backgroundImage:
        // limb darkening: shaded lower-right edge (multiply keeps photo visible)
        'radial-gradient(circle at 38% 32%, rgba(255,255,255,0) 46%, ' + U.hexToRgba(dark, 0.38) + ' 84%, ' + U.hexToRgba(deeper, 0.72) + ' 100%),' +
        // rim light: thin bright arc on the shaded side keeps the silhouette round
        'radial-gradient(circle at 50% 50%, rgba(255,255,255,0) 86%, rgba(255,255,255,0.5) 94%, rgba(255,255,255,0.08) 100%),' +
        // hot specular highlight
        'radial-gradient(circle at 33% 26%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.45) 10%, rgba(255,255,255,0) 26%),' +
        // soft secondary sheen, lower right
        'radial-gradient(circle at 70% 76%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 42%),' +
        // anti-highlight (core shadow of the sphere)
        'radial-gradient(circle at 74% 70%, rgba(38,30,50,0.45) 0%, rgba(38,30,50,0) 58%),' +
        // photo wash tinted with the marble colour
        'radial-gradient(circle at 42% 36%, ' + U.hexToRgba(tint, 0.55) + ' 0%, ' + U.hexToRgba(light, 0.42) + ' 100%),' +
        'url(' + m.squareCrop + ')',
      backgroundBlendMode: 'multiply,screen,screen,screen,multiply,soft-light,normal'
    };
  }

  function applyMarbleVisual(el, m, shadowY) {
    var vis = marbleVisual(m);
    var sy = shadowY || 3;
    el.style.backgroundImage = vis.backgroundImage;
    el.style.backgroundBlendMode = vis.backgroundBlendMode;
    el.style.boxShadow =
      'inset 0 0 0 1.2px ' + U.hexToRgba(U.shade(m.tint, 0.55), 0.34) + ', ' +
      'inset 0 -2px 3px ' + U.hexToRgba(U.shade(m.tint, 0.42), 0.4) + ', ' +
      '0 ' + sy + 'px ' + (sy * 2.3).toFixed(1) + 'px ' + U.hexToRgba(U.shade(m.tint, 0.4), 0.32);
    return el;
  }

  function buildMarbleEl(m, live) {
    var el = document.createElement('div');
    el.className = 'marble';
    applyMarbleVisual(el, m);
    el.dataset.id = m.id;
    if (live && view.valid) {
      el.style.left = '0px';
      el.style.top = '0px';
      sizeMarbleEl(el, m);
      placeMarbleEl(el, m);
    } else {
      marbleStaticStyle(el, m);
    }
    return el;
  }

  /* ---------- Live jar: mapping physics units to screen pixels ---------- */

  var homeJarEl = null;
  var homeMarbleLayer = null;
  var homeMarbleEls = {};
  var view = { pxX: 0, pxY: 0, rect: null, valid: false };

  function measureJarView() {
    if (!homeJarEl) return;
    var layer = homeMarbleLayer || (homeMarbleLayer = homeJarEl.querySelector('.jar-marbles'));
    var rect = layer.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      view.valid = false;
      return;
    }
    view.rect = rect;
    view.pxX = rect.width / BODY.w;
    view.pxY = rect.height / BODY.h;
    view.valid = true;
  }

  function sizeMarbleEl(el, m) {
    el.style.width = (m.r * 2 * view.pxX) + 'px';
    el.style.height = (m.r * 2 * view.pxY) + 'px';
  }

  function placeMarbleEl(el, m) {
    var px = (m.x - m.r - BODY.x) * view.pxX;
    var py = (m.y - m.r - BODY.y) * view.pxY;
    el.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)' +
      (m === drag.marble ? ' scale(1.07)' : '');
  }

  function refreshMarbleLayout() {
    measureJarView();
    if (!view.valid) return;
    state.active.marbles.forEach(function (m) {
      var el = homeMarbleEls[m.id];
      if (!el) return;
      sizeMarbleEl(el, m);
      placeMarbleEl(el, m);
    });
  }

  /* ---------- Physics loop (runs only while something is awake) ---------- */

  var loop = { running: false, lastTs: null, acc: 0 };

  function physicsLoop(ts) {
    if (loop.lastTs === null) loop.lastTs = ts;
    var frameDt = Math.min((ts - loop.lastTs) / 1000, 0.05);
    loop.lastTs = ts;
    loop.acc = Math.min(loop.acc + frameDt, P.MAX_SUBSTEPS * P.SUBSTEP);

    var held = drag.marble;
    var marbles = state.active.marbles;
    var stepped = false;
    while (loop.acc >= P.SUBSTEP) {
      P.stepPhysics(marbles, P.SUBSTEP, held);
      loop.acc -= P.SUBSTEP;
      stepped = true;
    }
    if (stepped) P.updateSleep(marbles, frameDt, held);

    var anyAwake = false;
    for (var i = 0; i < marbles.length; i++) {
      var m = marbles[i];
      if (m.settled) continue;
      anyAwake = true;
      var el = homeMarbleEls[m.id];
      if (el && view.valid) placeMarbleEl(el, m);
    }

    if (anyAwake || held) {
      requestAnimationFrame(physicsLoop);
    } else {
      loop.running = false;
      loop.lastTs = null;
      loop.acc = 0;
      saveState();
    }
  }

  function ensurePhysicsLoop() {
    if (loop.running) return;
    var awake = state.active.marbles.some(function (m) { return !m.settled; });
    if (!awake && !drag.marble) return;
    loop.running = true;
    loop.lastTs = null;
    loop.acc = 0;
    requestAnimationFrame(physicsLoop);
  }

  /* ---------- Marble dragging (active jar only) ---------- */

  var drag = { marble: null, pointerId: null, el: null, startX: 0, startY: 0, moved: false };
  var dragMovedSinceTouch = false; // suppresses the home/shelves swipe after a drag

  function pointerToJarUnits(clientX, clientY) {
    if (!view.valid || !view.rect) measureJarView();
    var r = view.rect;
    return {
      x: BODY.x + (clientX - r.left) / view.pxX,
      y: BODY.y + (clientY - r.top) / view.pxY
    };
  }

  function beginDrag(ev, m, el) {
    if (drag.marble || currentInspect) return;
    if (!homeJarEl || homeJarEl.classList.contains('sealing') || homeJarEl.classList.contains('slide-off')) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    drag.marble = m;
    drag.pointerId = ev.pointerId;
    drag.el = el;
    drag.startX = ev.clientX;
    drag.startY = ev.clientY;
    drag.moved = false;
    // Seed the spring target at the marble's own position so an already-moving
    // marble hovers instead of springing toward an undefined target.
    m._tx = m.x;
    m._ty = m.y;
    measureJarView();
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (e) { /* pointer already released */ }
  }

  function moveDrag(ev) {
    if (!drag.marble || ev.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      var ddx = ev.clientX - drag.startX, ddy = ev.clientY - drag.startY;
      if (ddx * ddx + ddy * ddy < DRAG_START_PX * DRAG_START_PX) return;
      drag.moved = true;
      dragMovedSinceTouch = true;
      drag.el.classList.add('dragging');
      P.wakeMarble(state.active.marbles, drag.marble);
      ensurePhysicsLoop();
    }
    var p = pointerToJarUnits(ev.clientX, ev.clientY);
    var b = P.BOUNDS, r = drag.marble.r;
    drag.marble._tx = Math.max(b.left + r, Math.min(b.right - r, p.x));
    drag.marble._ty = Math.max(b.top + r, Math.min(b.bottom - r, p.y));
  }

  function endDrag(ev, cancelled) {
    if (!drag.marble || ev.pointerId !== drag.pointerId) return;
    var m = drag.marble, el = drag.el, wasMoved = drag.moved;
    drag.marble = null;
    drag.pointerId = null;
    drag.el = null;
    el.classList.remove('dragging');
    if (wasMoved && !cancelled) {
      var sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      if (sp > P.FLING_CAP) {
        var s = P.FLING_CAP / sp;
        m.vx *= s;
        m.vy *= s;
      }
      ensurePhysicsLoop();
    } else if (!wasMoved) {
      openInspectFromEl(m, el);
    }
  }

  function cancelDrag() {
    if (!drag.marble) return;
    if (drag.el) drag.el.classList.remove('dragging');
    drag.marble = null;
    drag.pointerId = null;
    drag.el = null;
  }

  function attachHomeMarbleEvents(el, m) {
    el.addEventListener('pointerdown', function (ev) { beginDrag(ev, m, el); });
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', function (ev) { endDrag(ev, false); });
    el.addEventListener('pointercancel', function (ev) { endDrag(ev, true); });
  }

  /* ---------- Home jar rendering ---------- */

  var resizeWatcherAttached = false;

  function attachResizeWatcher(stage) {
    if (resizeWatcherAttached || !stage) return;
    resizeWatcherAttached = true;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(refreshMarbleLayout).observe(stage);
    } else {
      window.addEventListener('resize', refreshMarbleLayout);
    }
  }

  function renderHomeJar(opts) {
    cancelDrag();
    var stage = document.getElementById('home-jar-stage');
    var old = stage.querySelector('.jar');
    if (old) old.remove();
    homeJarEl = buildJarElement(state.active, true);
    homeMarbleLayer = homeJarEl.querySelector('.jar-marbles');
    if (opts && opts.animateIn) {
      homeJarEl.classList.add('entering');
      // getBoundingClientRect returns the scaled rect mid-animation; re-measure
      // once the pop-in finishes so marble layout is exact.
      homeJarEl.addEventListener('animationend', refreshMarbleLayout, { once: true });
    }
    stage.appendChild(homeJarEl);
    homeMarbleEls = {};
    measureJarView();
    state.active.marbles.forEach(function (m) {
      var el = buildMarbleEl(m, true);
      attachHomeMarbleEvents(el, m);
      homeMarbleLayer.appendChild(el);
      homeMarbleEls[m.id] = el;
    });
    attachResizeWatcher(stage);
    updateJarCapacityUI();
    ensurePhysicsLoop();
  }

  function updateJarCapacityUI() {
    var count = state.active.marbles.length;
    var addButton = document.getElementById('btn-add');
    var closeButton = document.getElementById('btn-close-jar');
    var nudging = count >= NUDGE_AT && count < MAX_MARBLES;
    var full = count >= MAX_MARBLES;

    addButton.textContent = full ? 'Jar is full \u2014 seal chapter' : 'Add a memory';
    closeButton.textContent = nudging ? 'Ready to seal this jar?' : 'Close this jar';
    closeButton.classList.toggle('nudge', nudging);
    closeButton.style.visibility = full || count === 0 ? 'hidden' : 'visible';
  }

  function addMarbleToActiveJar(data) {
    var m = {
      id: U.uid(),
      full: data.full,
      squareCrop: data.squareCrop,
      tint: data.tint,
      date: U.nowISO()
    };
    P.spawnPhysics(m);
    state.active.marbles.push(m);
    var el = buildMarbleEl(m, true);
    attachHomeMarbleEvents(el, m);
    homeMarbleLayer.appendChild(el);
    homeMarbleEls[m.id] = el;
    updateJarCapacityUI();
    ensurePhysicsLoop();
    saveState();
  }

  /* ---------- Static jars: shelves & viewer ---------- */

  function renderStaticJar(container, jarData, onMarbleClick) {
    var jar = buildJarElement(jarData, false);
    jar.classList.add('sealing');
    container.appendChild(jar);
    var layer = jar.querySelector('.jar-marbles');
    jarData.marbles.forEach(function (m) {
      var el = buildMarbleEl(m, false);
      if (onMarbleClick) {
        el.addEventListener('click', function () { onMarbleClick(m, el); });
      } else {
        el.style.cursor = 'default';
      }
      layer.appendChild(el);
    });
    return jar;
  }

  function renderShelves() {
    var container = document.getElementById('shelves-container');
    container.innerHTML = '';
    if (state.sealed.length === 0) {
      container.innerHTML = '<div class="empty-shelf"><p>Nothing on the shelf yet. Seal a jar from the home screen to see it here.</p></div>';
      updateDrawButton();
      return;
    }
    var perRow = 3;
    for (var i = 0; i < state.sealed.length; i += perRow) {
      var row = document.createElement('div');
      row.className = 'shelf-row';
      state.sealed.slice(i, i + perRow).forEach(function (jarData) {
        row.appendChild(buildShelfJarButton(jarData));
      });
      container.appendChild(row);
    }
    updateDrawButton();
  }

  function buildShelfJarButton(jarData) {
    var btn = document.createElement('button');
    btn.className = 'shelf-jar';
    var stage = document.createElement('div');
    stage.className = 'mini-stage';
    renderStaticJar(stage, jarData, null);
    var label = document.createElement('div');
    label.className = 'shelf-jar-label';
    label.textContent = jarData.title;
    label.title = jarData.title;
    btn.appendChild(stage);
    btn.appendChild(label);
    btn.addEventListener('click', function () { openJarViewer(jarData); });
    return btn;
  }

  function updateDrawButton() {
    var btn = document.getElementById('btn-draw');
    var total = state.sealed.reduce(function (n, j) { return n + j.marbles.length; }, 0);
    btn.disabled = total === 0;
    btn.textContent = total === 0 ? 'Nothing sealed yet' : 'Draw a memory';
  }

  function openJarViewer(jarData) {
    var overlay = document.getElementById('jar-viewer');
    var tint = lidColorFor(jarData);
    overlay.style.setProperty('--viewer-tint', tint);
    overlay.style.setProperty('--viewer-tint-soft', U.hexToRgba(tint, 0.62));
    document.getElementById('viewer-title').textContent = jarData.title;
    var inner = document.getElementById('viewer-jar-inner');
    var old = inner.querySelector('.jar');
    if (old) old.remove();
    renderStaticJar(inner, jarData, openInspectFromEl);
    overlay.classList.remove('hidden');
  }

  function closeJarViewer() {
    document.getElementById('jar-viewer').classList.add('hidden');
  }

  /* ---------- Sealing ---------- */

  function openSealModal() {
    cancelDrag();
    if (state.active.marbles.length === 0) return;
    var input = document.getElementById('seal-title-input');
    input.value = '';
    input.placeholder = U.formatRange(state.active.startDate, U.nowISO());
    pendingLidMode = state.active.lidMode || 'random';
    pendingLidColor = pendingLidMode === 'random' ? randomLidColor() : lidColorFor(state.active);
    renderLidPalette(pendingLidColor, pendingLidMode);
    document.getElementById('seal-modal').classList.remove('hidden');
    setTimeout(function () { input.focus(); }, 50);
  }

  function closeSealModal() {
    document.getElementById('seal-modal').classList.add('hidden');
  }

  function confirmSeal() {
    cancelDrag();
    var input = document.getElementById('seal-title-input');
    var title = input.value.trim() || input.placeholder;
    var endISO = U.nowISO();
    closeSealModal();

    state.active.lidMode = pendingLidMode || 'random';
    state.active.lidColor = pendingLidColor || randomLidColor();
    homeJarEl.style.setProperty('--lid-color', state.active.lidColor);
    homeJarEl.classList.add('sealing');

    setTimeout(function () {
      homeJarEl.classList.add('slide-off');
      setTimeout(function () {
        sealActiveJar(title, endISO);
      }, 560);
    }, 640);
  }

  function sealActiveJar(title, endISO) {
    state.sealed.unshift({
      id: state.active.id,
      lidColor: state.active.lidColor,
      lidMode: state.active.lidMode,
      title: title,
      dateRange: U.formatRange(state.active.startDate, endISO),
      startDate: state.active.startDate,
      endDate: endISO,
      marbles: state.active.marbles.map(function (m) { return Object.assign({}, m); })
    });
    state.active = newJar();
    saveState();
    renderHomeJar({ animateIn: true });
    renderShelves();
    showToast('Jar sealed \u2014 find it on the Shelves');
  }

  /* ---------- Inspect (memory card) ---------- */

  var currentInspect = null;

  function cardTargetRect() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(vw * 0.8, 360);
    var h = w * 1.28;
    if (h > vh * 0.72) {
      h = vh * 0.72;
      w = h / 1.28;
    }
    return { left: (vw - w) / 2, top: (vh - h) / 2 - 10, width: w, height: h };
  }

  function openInspectFromEl(m, el) {
    openInspect(m, el.getBoundingClientRect(), el);
  }

  function openInspect(m, sourceRect, sourceEl, fromLabel) {
    if (currentInspect) return;
    cancelDrag();
    var overlay = document.getElementById('inspect-overlay');
    overlay.classList.remove('hidden');
    requestAnimationFrame(function () { overlay.classList.add('active'); });

    var clone = document.createElement('div');
    clone.className = 'inspect-clone';
    clone.style.backgroundImage = 'url(' + m.full + ')';
    setRect(clone, sourceRect, '50%');
    document.body.appendChild(clone);
    if (sourceEl) sourceEl.style.opacity = '0';

    var caption = document.createElement('div');
    caption.className = 'inspect-caption';
    caption.innerHTML = '<div class="inspect-date">' + U.formatDate(m.date) + '</div>' +
      (fromLabel ? '<div class="inspect-from">from ' + fromLabel + '</div>' : '');
    document.body.appendChild(caption);

    currentInspect = { marble: m, sourceEl: sourceEl, sourceRect: sourceRect, clone: clone, caption: caption };

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var target = cardTargetRect();
        setRect(clone, target, '20px');
        caption.style.left = (target.left + target.width / 2) + 'px';
        caption.style.top = (target.top + target.height + 16) + 'px';
        setTimeout(function () { caption.classList.add('show'); }, 260);
      });
    });

    overlay.onclick = function (e) { if (e.target === overlay) closeInspect(); };
  }

  function closeInspect() {
    if (!currentInspect) return;
    var ci = currentInspect;
    ci.caption.classList.remove('show');
    var rect = ci.sourceEl ? ci.sourceEl.getBoundingClientRect() : ci.sourceRect;
    setRect(ci.clone, rect, '50%');
    document.getElementById('inspect-overlay').classList.remove('active');

    setTimeout(function () {
      ci.clone.remove();
      ci.caption.remove();
      if (ci.sourceEl) ci.sourceEl.style.opacity = '1';
      document.getElementById('inspect-overlay').classList.add('hidden');
      currentInspect = null;
    }, 440);
  }

  function setRect(el, rect, radius) {
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    el.style.borderRadius = radius;
  }

  /* ---------- Random draw from sealed jars ---------- */

  var drawInFlight = false;

  function drawRandomMemory() {
    if (drawInFlight || currentInspect) return;
    var pool = [];
    state.sealed.forEach(function (j) {
      j.marbles.forEach(function (m) { pool.push({ marble: m, jarTitle: j.title }); });
    });
    if (pool.length === 0) return;

    var pick = pool[Math.floor(Math.random() * pool.length)];
    var vw = window.innerWidth, vh = window.innerHeight;
    var br = document.getElementById('btn-draw').getBoundingClientRect();

    drawInFlight = true;
    var floater = document.createElement('div');
    floater.className = 'float-marble';
    applyMarbleVisual(floater, pick.marble, 14);
    placeFloater(floater, br.left + br.width / 2, br.top + br.height / 2, 24);
    document.body.appendChild(floater);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        floater.style.opacity = '1';
        placeFloater(floater, vw / 2, vh / 2 - 70, 66);
      });
    });

    setTimeout(function () {
      placeFloater(floater, vw / 2, vh / 2 - 10, 58);
      setTimeout(function () {
        openInspect(pick.marble, floater.getBoundingClientRect(), null, pick.jarTitle);
        floater.remove();
        drawInFlight = false;
      }, 200);
    }, 520);
  }

  function placeFloater(el, cx, cy, size) {
    el.style.left = (cx - size / 2) + 'px';
    el.style.top = (cy - size / 2) + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
  }

  /* ---------- Navigation ---------- */

  var onShelves = false;

  function goToPage(name) {
    onShelves = name === 'shelves';
    document.getElementById('track').classList.toggle('on-shelves', onShelves);
  }

  function setupSwipe() {
    var startX = null, startY = null, touchActive = false;
    var app = document.getElementById('app');

    app.addEventListener('touchstart', function (e) {
      dragMovedSinceTouch = false;
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchActive = true;
    }, { passive: true });

    app.addEventListener('touchend', function (e) {
      if (!touchActive) return;
      touchActive = false;
      if (dragMovedSinceTouch) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0 && !onShelves) goToPage('shelves');
        else if (dx > 0 && onShelves) goToPage('home');
      }
    }, { passive: true });
  }

  /* ---------- Event wiring ---------- */

  function handleFiles(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    var remaining = MAX_MARBLES - state.active.marbles.length;
    if (remaining <= 0) return;

    // Ingest one at a time so drops feel sequential.
    files.slice(0, remaining).reduce(function (chain, file, idx) {
      return chain.then(function () {
        return M.processImage(file).then(function (data) {
          addMarbleToActiveJar(data);
          if (idx === 0) toastFallbackNotice();
          return new Promise(function (r) { setTimeout(r, 90); });
        }).catch(function () { showToast("Couldn't read that photo"); });
      });
    }, Promise.resolve());
  }

  function wireEvents() {
    document.getElementById('btn-shelves').addEventListener('click', function () { goToPage('shelves'); });
    document.getElementById('btn-home').addEventListener('click', function () { goToPage('home'); });

    document.getElementById('btn-add').addEventListener('click', function () {
      if (state.active.marbles.length >= MAX_MARBLES) openSealModal();
      else document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', handleFiles);

    document.getElementById('btn-close-jar').addEventListener('click', openSealModal);
    document.getElementById('seal-cancel').addEventListener('click', closeSealModal);
    document.getElementById('seal-confirm').addEventListener('click', confirmSeal);
    document.getElementById('seal-title-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') confirmSeal();
    });
    document.getElementById('seal-modal').addEventListener('click', function (e) {
      if (e.target.id === 'seal-modal') closeSealModal();
    });

    document.getElementById('viewer-close').addEventListener('click', closeJarViewer);
    document.getElementById('jar-viewer').addEventListener('click', function (e) {
      if (e.target.id === 'jar-viewer') closeJarViewer();
    });

    document.getElementById('btn-draw').addEventListener('click', drawRandomMemory);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (currentInspect) closeInspect();
      else if (!document.getElementById('seal-modal').classList.contains('hidden')) closeSealModal();
      else if (!document.getElementById('jar-viewer').classList.contains('hidden')) closeJarViewer();
    });

    window.addEventListener('blur', cancelDrag);
  }

  /* ---------- Init ---------- */

  wireEvents();
  setupSwipe();
  renderHomeJar({ animateIn: false });
  renderShelves();
})();
