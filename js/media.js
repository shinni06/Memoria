/* Photo ingestion: standardize every photo to a 3:4 portrait card image,
   make a square crop for the marble, and derive the pastel marble tint from
   the photo's dominant tone. */
(function (global) {
  'use strict';

  var CARD_W = 750;    // card photo: exact 3:4 portrait
  var CARD_H = 1000;
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

  /* Largest center region with the given w/h ratio that fits in the image. */
  function centerCrop(img, ratio) {
    var cw = Math.min(img.width, img.height * ratio);
    var ch = cw / ratio;
    return {
      sx: (img.width - cw) / 2,
      sy: (img.height - ch) / 2,
      sw: cw,
      sh: ch
    };
  }

  /* Returns { full, squareCrop, tint } for the given image File. */
  function processImage(file) {
    return readAsDataURL(file)
      .then(loadImage)
      .then(function (img) {
        // Card photo: always a full-bleed 3:4 portrait, center-cropped.
        var c = centerCrop(img, CARD_W / CARD_H);
        var full = renderScaled(img, CARD_W, CARD_H, c.sx, c.sy, c.sw, c.sh)
          .toDataURL('image/jpeg', 0.85);

        // Marble texture: square center crop.
        var s = centerCrop(img, 1);
        var squareCrop = renderScaled(img, CROP_SIZE, CROP_SIZE, s.sx, s.sy, s.sw, s.sh)
          .toDataURL('image/jpeg', 0.82);

        var sample = renderScaled(img, SAMPLE_SIZE, SAMPLE_SIZE, s.sx, s.sy, s.sw, s.sh);
        var tone = dominantColor(sample.getContext('2d').getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
        var tint = pastelFromColor(tone[0], tone[1], tone[2]);

        return { full: full, squareCrop: squareCrop, tint: tint };
      });
  }

  /* Draw the sx/sy/sw/sh region of img into a w×h canvas. */
  function renderScaled(img, w, h, sx, sy, sw, sh) {
    var canvas = makeCanvas(w, h);
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return canvas;
  }

  var media = { processImage: processImage };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = media;
  } else {
    global.MJMedia = media;
  }
})(typeof window !== 'undefined' ? window : this);
