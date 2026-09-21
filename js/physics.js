/* Physics core for Memory Jar — pure, DOM-free.
   Exports a Node module for headless testing; the browser gets window.MJPhysics.

   Model
   -----
   - Fixed 180 Hz substeps: identical behaviour at any refresh rate, no tunneling.
   - Sequential-impulse contacts; bounce only above BOUNCE_MIN_SPEED, so resting
     contacts are perfectly inelastic.
   - Positional correction with SLOP: overlaps smaller than SLOP are ignored, so a
     settled pile has nothing left to fight about.
   - Sleeping: a supported marble that drifts less than SLEEP_DRIFT for SLEEP_DELAY
     seconds freezes completely (skipped by every loop). Drift-based, not
     speed-based, so micro-bounce noise can't keep piles awake. Impacts above
     WAKE_IMPULSE wake touching neighbours, so the pile reacts as one body.
   - Settled marbles are static bodies (inverse mass 0): the pile is rigid until
     woken, and resting contacts reach a stable equilibrium. */
(function (global) {
  'use strict';

  var MARBLE_R = 6.5;
  var BOUNDS = { left: 15.5, right: 84.5, top: 27.5, bottom: 110.5, cr: 15 };
  var GRAVITY = 640;

  var SUBSTEP = 1 / 180;
  var MAX_SUBSTEPS = 12;   // max ticks consumed per frame (clamp on long tab hides)
  var SLOP = 0.03;
  var CORR_PERCENT = 0.8;
  var CORR_MAX = 2.0;
  var MARBLE_RESTITUTION = 0.16;
  var WALL_RESTITUTION = 0.26;
  var BOUNCE_MIN_SPEED = 90;
  var WAKE_IMPULSE = 14;
  var SLEEP_DRIFT = 0.2;
  var LINEAR_DRAG = 0.55;
  var FLOOR_FRICTION = 5.0;
  var SLEEP_DELAY = 0.35;
  var PRESS_WAKE = 0.05;
  var CONTACT_FRICTION = 0.08;
  var MAX_SPEED = 900;
  var DRAG_K = 1000;
  var DRAG_D = 52;
  var DRAG_MASS = 2.4;
  var FLING_CAP = 520;
  var HELD_SPEED_CAP = 760;

  /* Reset a marble to a random drop just below the jar mouth. */
  function spawnPhysics(m) {
    m.r = MARBLE_R;
    m.x = BOUNDS.left + (BOUNDS.right - BOUNDS.left) / 2 + (Math.random() * 26 - 13);
    m.y = BOUNDS.top + m.r - 0.5;
    m.vx = Math.random() * 36 - 18;
    m.vy = 40 + Math.random() * 40;
    m.settled = false;
    m.slowTime = 0;
    m.sleepRefX = m.x;
    m.sleepRefY = m.y;
  }

  /* Wake a marble and everything touching it, so the pile reacts as a body. */
  function wakeMarble(list, m) {
    if (!m.settled) return;
    m.settled = false;
    m.slowTime = 0;
    m._pressT = 0;
    m.sleepRefX = m.x;
    m.sleepRefY = m.y;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === m || !o.settled) continue;
      var dx = o.x - m.x, dy = o.y - m.y;
      var rr = m.r + o.r + 0.5;
      if (dx * dx + dy * dy < rr * rr) {
        o.settled = false;
        o.slowTime = 0;
      }
    }
  }

  function invMassOf(m, held) {
    if (m.settled) return 0;
    return held === m ? 1 / DRAG_MASS : 1;
  }

  /* Circular jar corner: project back inside the corner circle, reflect the
     normal velocity above BOUNCE_MIN_SPEED, damp the rest. */
  function resolveCornerCircle(m, cx, cy, cr, h) {
    var dx = m.x - cx, dy = m.y - cy;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var maxDist = cr - m.r;
    if (dist > maxDist) {
      var nx = dx / dist, ny = dy / dist;
      m.x = cx + nx * maxDist;
      m.y = cy + ny * maxDist;
      var vn = m.vx * nx + m.vy * ny;
      if (vn > 0) {
        var f = vn > BOUNCE_MIN_SPEED ? 1 + WALL_RESTITUTION : 1;
        m.vx -= vn * nx * f;
        m.vy -= vn * ny * f;
      }
      var tf = Math.exp(-1.2 * h);
      m.vx *= tf;
      m.vy *= tf;
    }
  }

  function resolveContainer(m, h) {
    var b = BOUNDS;
    var inLeftBottom = m.x < b.left + b.cr && m.y > b.bottom - b.cr;
    var inRightBottom = m.x > b.right - b.cr && m.y > b.bottom - b.cr;
    var inLeftTop = m.x < b.left + b.cr && m.y < b.top + b.cr;
    var inRightTop = m.x > b.right - b.cr && m.y < b.top + b.cr;
    if (inLeftBottom) resolveCornerCircle(m, b.left + b.cr, b.bottom - b.cr, b.cr, h);
    else if (inRightBottom) resolveCornerCircle(m, b.right - b.cr, b.bottom - b.cr, b.cr, h);
    else if (inLeftTop) resolveCornerCircle(m, b.left + b.cr, b.top + b.cr, b.cr, h);
    else if (inRightTop) resolveCornerCircle(m, b.right - b.cr, b.top + b.cr, b.cr, h);
    else if (m.y + m.r > b.bottom) {
      m.y = b.bottom - m.r;
      if (m.vy > 0) m.vy = m.vy > BOUNCE_MIN_SPEED ? -m.vy * WALL_RESTITUTION : 0;
      m.vx *= Math.exp(-FLOOR_FRICTION * h);
    }

    if (m.x - m.r < b.left) {
      m.x = b.left + m.r;
      if (m.vx < 0) m.vx = -m.vx > BOUNCE_MIN_SPEED ? -m.vx * WALL_RESTITUTION : 0;
    }
    if (m.x + m.r > b.right) {
      m.x = b.right - m.r;
      if (m.vx > 0) m.vx = m.vx > BOUNCE_MIN_SPEED ? -m.vx * WALL_RESTITUTION : 0;
    }
    if (m.y - m.r < b.top) {
      m.y = b.top + m.r;
      if (m.vy < 0) m.vy = -m.vy > BOUNCE_MIN_SPEED ? -m.vy * WALL_RESTITUTION : 0;
    }
  }

  /* One fixed physics tick: integrate, contain, resolve contacts (impulses),
     correct positions, then a hard projection pass that guarantees no pair
     overlaps beyond SLOP — marbles read as solid objects at any speed. */
  function stepPhysics(list, h, held) {
    var n = list.length;
    var i, j, a, b, m;

    // 1. Integrate: spring drive for the held marble, gravity + drag otherwise.
    for (i = 0; i < n; i++) {
      m = list[i];
      if (m.settled) continue;
      if (held === m) {
        m.vx += (DRAG_K * (held._tx - m.x) - DRAG_D * m.vx) * h;
        m.vy += (DRAG_K * (held._ty - m.y) - DRAG_D * m.vy) * h;
      } else {
        m.vy += GRAVITY * h;
        m.vx *= Math.exp(-LINEAR_DRAG * h);
      }
      var cap = held === m ? HELD_SPEED_CAP : MAX_SPEED;
      var sp2 = m.vx * m.vx + m.vy * m.vy;
      if (sp2 > cap * cap) {
        var s = cap / Math.sqrt(sp2);
        m.vx *= s;
        m.vy *= s;
      }
      m.x += m.vx * h;
      m.y += m.vy * h;
    }

    // 2. Container constraints.
    for (i = 0; i < n; i++) {
      m = list[i];
      if (!m.settled) resolveContainer(m, h);
    }

    // 3. Marble-marble contacts: sequential impulses over 4 iterations.
    for (var iter = 0; iter < 4; iter++) {
      for (i = 0; i < n; i++) {
        a = list[i];
        for (j = i + 1; j < n; j++) {
          b = list[j];
          if (a.settled && b.settled) continue;
          var dx = b.x - a.x, dy = b.y - a.y;
          var minD = a.r + b.r;
          var d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD || d2 === 0) continue;
          var d = Math.sqrt(d2);
          var nx = dx / d, ny = dy / d;
          var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          var vn = rvx * nx + rvy * ny;
          if (vn >= 0) continue;
          var invA = invMassOf(a, held);
          var invB = invMassOf(b, held);
          var invSum = invA + invB;
          if (invSum === 0) continue;
          var e = -vn > BOUNCE_MIN_SPEED ? MARBLE_RESTITUTION : 0;
          var jImp = -(1 + e) * vn / invSum;
          a.vx -= jImp * nx * invA;
          a.vy -= jImp * ny * invA;
          b.vx += jImp * nx * invB;
          b.vy += jImp * ny * invB;

          // Mild tangential friction so piles stop sliding and lock in.
          var vtx = rvx - vn * nx, vty = rvy - vn * ny;
          var vt2 = vtx * vtx + vty * vty;
          if (vt2 > 0.04) {
            var vt = Math.sqrt(vt2);
            var tX = vtx / vt, tY = vty / vt;
            var jt = -vt * CONTACT_FRICTION / invSum;
            a.vx -= jt * tX * invA;
            a.vy -= jt * tY * invA;
            b.vx += jt * tX * invB;
            b.vy += jt * tY * invB;
          }

          if (jImp > WAKE_IMPULSE) {
            if (a.settled) wakeMarble(list, a);
            if (b.settled) wakeMarble(list, b);
          } else if (held) {
            // A slow, sustained push from the dragged marble yields the pile
            // instead of slamming into a wall of frozen marbles.
            if (a === held && b.settled && vn < -1) {
              b._pressT = (b._pressT || 0) + h;
              if (b._pressT >= PRESS_WAKE) wakeMarble(list, b);
            } else if (b === held && a.settled && vn < -1) {
              a._pressT = (a._pressT || 0) + h;
              if (a._pressT >= PRESS_WAKE) wakeMarble(list, a);
            }
          }
        }
      }
    }

    // 4. Positional correction, split by inverse mass, only beyond SLOP. A shove
    //    big enough moves a sleeping marble and wakes it — how gentle pushes
    //    propagate through a settled pile.
    for (i = 0; i < n; i++) {
      a = list[i];
      for (j = i + 1; j < n; j++) {
        b = list[j];
        if (a.settled && b.settled) continue;
        var ddx = b.x - a.x, ddy = b.y - a.y;
        var mD = a.r + b.r;
        var dd2 = ddx * ddx + ddy * ddy;
        if (dd2 >= mD * mD || dd2 === 0) continue;
        var dd = Math.sqrt(dd2);
        var pen = mD - dd;
        if (pen <= SLOP) continue;
        var iA = invMassOf(a, held);
        var iB = invMassOf(b, held);
        var iS = iA + iB;
        if (iS === 0) continue;
        var corr = Math.min((pen - SLOP) * CORR_PERCENT, CORR_MAX);
        var ca = corr * iA / iS;
        var cb = corr * iB / iS;
        if (ca > 0) { a.x -= (ddx / dd) * ca; a.y -= (ddy / dd) * ca; }
        if (cb > 0) { b.x += (ddx / dd) * cb; b.y += (ddy / dd) * cb; }
      }
    }

    // 5. Hard projection: final pass fully resolving any remaining overlap
    //    beyond SLOP, so marbles can never visibly override each other.
    for (var pit = 0; pit < 2; pit++) {
      for (i = 0; i < n; i++) {
        a = list[i];
        for (j = i + 1; j < n; j++) {
          b = list[j];
          var hdx = b.x - a.x, hdy = b.y - a.y;
          var hMin = a.r + b.r;
          var hd2 = hdx * hdx + hdy * hdy;
          if (hd2 >= hMin * hMin || hd2 === 0) continue;
          var hd = Math.sqrt(hd2);
          var hPen = hMin - hd;
          if (hPen <= SLOP) continue;
          if (a.settled && b.settled) {
            // Unreachable in normal play (pen > SLOP keeps marbles awake);
            // guards only against corrupted saved states.
            if (hPen > 1.5) { wakeMarble(list, a); wakeMarble(list, b); }
            continue;
          }
          var hiA = invMassOf(a, held);
          var hiB = invMassOf(b, held);
          var hiS = hiA + hiB;
          if (hiS === 0) continue;
          var push = hPen - SLOP;
          var ha = push * hiA / hiS;
          var hb = push * hiB / hiS;
          if (ha > 0) { a.x -= (hdx / hd) * ha; a.y -= (hdy / hd) * ha; }
          if (hb > 0) { b.x += (hdx / hd) * hb; b.y += (hdy / hd) * hb; }
        }
      }
    }
  }

  /* Sleep bookkeeping, once per frame (not per substep). Sleeps on positional
     drift; settled marbles must keep their support — if what they rested on is
     dragged away, wake so gravity takes over. */
  function updateSleep(list, frameDt, held) {
    var b = BOUNDS;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.settled) continue;
      if (held === m) {
        resetSleep(m);
        continue;
      }
      if (!isSupported(list, i)) {
        resetSleep(m);
        continue;
      }
      if (m.sleepRefX === undefined) {
        m.sleepRefX = m.x;
        m.sleepRefY = m.y;
      }
      var drift = Math.abs(m.x - m.sleepRefX) + Math.abs(m.y - m.sleepRefY);
      if (drift < SLEEP_DRIFT) {
        m.slowTime += frameDt;
        if (m.slowTime >= SLEEP_DELAY) settle(m);
      } else {
        resetSleep(m);
      }
    }

    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (!m.settled) continue;
      if (m.y + m.r >= b.bottom - 0.6) continue;
      if (!isTouching(list, i)) wakeMarble(list, m);
    }
  }

  function settle(m) {
    m.settled = true;
    m.vx = 0;
    m.vy = 0;
    m.slowTime = 0;
    m._pressT = 0;
    m.sleepRefX = m.x;
    m.sleepRefY = m.y;
  }

  function resetSleep(m) {
    m.slowTime = 0;
    m.sleepRefX = m.x;
    m.sleepRefY = m.y;
  }

  /* A marble is supported by the floor or by any nearby marble. */
  function isSupported(list, index) {
    var m = list[index];
    if (m.y + m.r >= BOUNDS.bottom - 0.6) return true;
    for (var j = 0; j < list.length; j++) {
      if (j === index) continue;
      var o = list[j];
      var dx = o.x - m.x, dy = o.y - m.y;
      var rr = m.r + o.r + 0.9;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  function isTouching(list, index) {
    var m = list[index];
    for (var j = 0; j < list.length; j++) {
      if (j === index) continue;
      var o = list[j];
      var dx = m.x - o.x, dy = m.y - o.y;
      var rr = m.r + o.r + 0.5;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  var physics = {
    BOUNDS: BOUNDS,
    MARBLE_R: MARBLE_R,
    GRAVITY: GRAVITY,
    SUBSTEP: SUBSTEP,
    MAX_SUBSTEPS: MAX_SUBSTEPS,
    SLOP: SLOP,
    FLING_CAP: FLING_CAP,
    spawnPhysics: spawnPhysics,
    resolveContainer: resolveContainer,
    wakeMarble: wakeMarble,
    stepPhysics: stepPhysics,
    updateSleep: updateSleep
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = physics;
  } else {
    global.MJPhysics = physics;
  }
})(typeof window !== 'undefined' ? window : this);
