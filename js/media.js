/* Photo ingestion: downscale, square crop, and derive the pastel marble tint
   from the photo's dominant tone. */
(function (global) {
  'use strict';

  var MAX_EDGE = 1000;
  var CROP_SIZE = 220;
  var SAMPLE_SIZE = 28;

  /* Most common 16-level color bucket, ignoring near-black/near-white.
     Falls back to the overall average when no bucket is dominant. */
  function dominantColor(data) {
    var buckets = {};
    var rSum = 0, gSum = 0, bSum = 0, n = 0;
    for (var i = 0; i < data.length; i += 4) {
      var R = data[i], G = data[i + 1], B = data[i + 2];
      var lum = 0.299 * R + 0.587 * G + 0.114 * B;
      rSum += R; gSum += G; bSum += B; n++;
      if (lum < 28 || lum > 236) continue;
      var key = (R >> 4) + '_' + (G >> 4) + '_' + (B >> 4);
      var bk = buckets[key];
      if (!bk) bk = buckets[key] = { c: 0, r: 0, g: 0, b: 0 };
      bk.c++; bk.r += R; bk.g += G; bk.b += B;
    }

    var best = null;
    for (var k in buckets) {
      if (!best || buckets[k].c > best.c) best = buckets[k];
    }
    if (best && n > 0 && best.c >= n * 0.06) {
      return [best.r / best.c, best.g / best.c, best.b / best.c];
    }
    if (n === 0) return [210, 210, 215];
    return [rSum / n, gSum / n, bSum / n];
  }

  function pastelFromColor(r, g, b) {
    var hsl = MJUtils.rgbToHsl(r, g, b);
    var s = hsl[1];
    var ps = s < 0.06 ? 0.14 : Math.max(0.28, Math.min(0.58, s * 0.9 + 0.16));
    return MJUtils.hslToHex(hsl[0], ps, 0.80);
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /* Returns { full, squareCrop, tint } for the given image File. */
  function processImage(file) {
    return readAsDataURL(file)
      .then(loadImage)
      .then(function (img) {
        var full = renderScaled(img, MAX_EDGE).toDataURL('image/jpeg', 0.85);

        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        var squareCrop = renderScaled(img, CROP_SIZE, sx, sy, side, side)
          .toDataURL('image/jpeg', 0.82);

        var sample = renderScaled(img, SAMPLE_SIZE, sx, sy, side, side);
        var tone = dominantColor(sample.getContext('2d').getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
        var tint = pastelFromColor(tone[0], tone[1], tone[2]);

        return { full: full, squareCrop: squareCrop, tint: tint };
      });
  }

  /* Draw img (optionally the sx/sy/side square region) into a w×w canvas. */
  function renderScaled(img, w, sx, sy, side) {
    var canvas = makeCanvas(w, w);
    var ctx = canvas.getContext('2d');
    if (sx === undefined) {
      var scale = Math.min(1, w / Math.max(img.width, img.height));
      ctx.drawImage(img, 0, 0, Math.round(img.width * scale), Math.round(img.height * scale));
    } else {
      ctx.drawImage(img, sx, sy, side, side, 0, 0, w, w);
    }
    return canvas;
  }

  var media = { processImage: processImage };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = media;
  } else {
    global.MJMedia = media;
  }
})(typeof window !== 'undefined' ? window : this);
