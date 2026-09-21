/* Shared helpers: ids, date formatting, color math. */
(function (global) {
  'use strict';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatShort(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* "Jun 3" or "Jun 3 – Aug 12, 2026" depending on year span. */
  function formatRange(startISO, endISO) {
    var s = new Date(startISO), e = new Date(endISO);
    if (s.toDateString() === e.toDateString()) return formatShort(startISO);
    var sameYear = s.getFullYear() === e.getFullYear();
    var thisYear = new Date().getFullYear() === e.getFullYear();
    var startStr = formatShort(startISO);
    var endStr = formatShort(endISO);
    if (!thisYear || !sameYear) {
      endStr += ', ' + e.getFullYear();
      if (!sameYear) startStr += ', ' + s.getFullYear();
    }
    return startStr + ' \u2013 ' + endStr;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function hslToHex(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var rgb;
    if (hp < 1) rgb = [c, x, 0];
    else if (hp < 2) rgb = [x, c, 0];
    else if (hp < 3) rgb = [0, c, x];
    else if (hp < 4) rgb = [0, x, c];
    else if (hp < 5) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    var m = l - c / 2;
    function part(v) {
      var n = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
      return ('0' + n.toString(16)).slice(-2);
    }
    return '#' + part(rgb[0]) + part(rgb[1]) + part(rgb[2]);
  }

  function hexToRgb(hex) {
    var v = hex.replace('#', '');
    return {
      r: parseInt(v.substring(0, 2), 16),
      g: parseInt(v.substring(2, 4), 16),
      b: parseInt(v.substring(4, 6), 16)
    };
  }

  function shade(hex, f) {
    var rgb = hexToRgb(hex);
    return '#' + [rgb.r * f, rgb.g * f, rgb.b * f].map(function (c) {
      var n = Math.max(0, Math.min(255, Math.round(c)));
      return ('0' + n.toString(16)).slice(-2);
    }).join('');
  }

  function hexToRgba(hex, a) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
  }

  var utils = {
    uid: uid,
    nowISO: nowISO,
    formatDate: formatDate,
    formatShort: formatShort,
    formatRange: formatRange,
    rgbToHsl: rgbToHsl,
    hslToHex: hslToHex,
    shade: shade,
    hexToRgba: hexToRgba
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = utils;
  } else {
    global.MJUtils = utils;
  }
})(typeof window !== 'undefined' ? window : this);
