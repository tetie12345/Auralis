'use strict';
/* Palette extraction from album artwork — bucket quantization, saturation-
   weighted, converted into CSS colors + visualizer RGB triplets. */

const Palette = (() => {
  const cache = new Map();

  function hex(c) {
    return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function toRGB(str) {
    const m = str.match(/\d+/g) || [110, 125, 255];
    return [+m[0], +m[1], +m[2]];
  }

  function darken(c, f) { return c.map((v) => Math.max(0, v * f)); }
  function saturate(c, f) {
    const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    return c.map((v) => Math.max(0, Math.min(255, l + (v - l) * f)));
  }
  // raise dark colors so the visualizer stays visible on near-black covers
  function floorLum(c, minLum) {
    const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    if (l >= minLum) return c;
    return c.map((v) => Math.min(255, v + (minLum - l) * 0.9));
  }
  // visualizer colors keep a minimum saturation even for monochrome covers
  function floorSat(c, minSat) {
    const [h, s, l] = rgb2hsl(c);
    if (s >= minSat) return c;
    return hsl2rgb(h, minSat, Math.max(0.45, Math.min(0.62, l)));
  }

  async function extract(dataUrl) {
    if (!dataUrl) return null;
    if (cache.has(dataUrl)) return cache.get(dataUrl);
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const s = 48;
      const cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, s, s);
      const d = ctx.getImageData(0, 0, s, s).data;

      // average colour of the whole cover (alpha-weighted), so every accent
      // in the UI actually appears on the artwork
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 200) continue;
        r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a;
      }
      if (!n) return null;
      const avg = [r / n, g / n, b / n];

      const c1 = floorLum(saturate(avg, 1.35), 120);
      const c2 = rotateHue(c1, 38);
      const v1 = floorLum(saturate(c1, 1.15), 120);
      const v2 = floorLum(c2, 110);
      const out = {
        accent: hex(v1),
        accent2: hex(v2),
        tint: `rgba(${v1.map((x) => Math.round(x * 0.8)).join(',')},0.15)`,
        glow: `rgba(${v1.map((x) => Math.round(x)).join(',')},0.50)`,
        viz: {
          accent: floorSat(darken(v1, 0.95), 0.38),
          accent2: floorSat(darken(v2, 0.95), 0.38),
          bg: [10, 12, 18],
        },
      };
      cache.set(dataUrl, out);
      return out;
    } catch {
      return null;
    }
  }

  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function rotateHue(c, deg) {
    let [h, s, l] = rgb2hsl(c);
    h = (h + deg / 360) % 1;
    return hsl2rgb(h, s, l);
  }
  function rgb2hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const dd = mx - mn;
      s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      if (mx === r) h = ((g - b) / dd + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / dd + 2;
      else h = (r - g) / dd + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [f(0), f(8), f(4)];
  }

  return { extract, toRGB };
})();
