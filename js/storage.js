/* Persistence: localStorage-backed save/load with capability detection and
   normalization of states saved by older versions. */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'memory-jar-state-v1';

  var storageAvailable = (function () {
    try {
      var t = '__mj_test__';
      global.localStorage.setItem(t, '1');
      global.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function load() {
    if (!storageAvailable) return null;
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save(state) {
    if (!storageAvailable) return;
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* quota or private mode: keep the session in memory */ }
  }

  /* Fill in defaults for state loaded from older versions. Leaves `active`
     null when invalid so the caller decides how to create a fresh jar. */
  function normalize(state) {
    if (!state.sealed) state.sealed = [];
    if (state.active && state.active.marbles) {
      state.active.marbles.forEach(function (m) {
        if (m.r === undefined) m.r = MJPhysics.MARBLE_R;
        if (m.settled === undefined) m.settled = true;
        if (m.slowTime === undefined) m.slowTime = 0;
        m.vx = m.vx || 0;
        m.vy = m.vy || 0;
      });
    } else {
      state.active = null;
    }
    return state;
  }

  var storage = {
    load: load,
    save: save,
    normalize: normalize,
    isAvailable: function () { return storageAvailable; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = storage;
  } else {
    global.MJStorage = storage;
  }
})(typeof window !== 'undefined' ? window : this);
