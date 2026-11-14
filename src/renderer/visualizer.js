'use strict';
/* Auralis visualizer — real FFT over system-audio PCM (s16le stereo from
   parec). Two render modes: "spectrum" (mirrored bars) and "nebula"
   (orbital particles driven by band energy). Colors come from
   window.__vizPalette (set by app.js from the album artwork). */

/* ---------------------------------------------------------------- analyser */
const Analyser = (() => {
  const RATE = 44100;
  const N = 2048;
  const BANDS = 96;

  const ring = new Float32Array(RATE); // ~1 s mono ring buffer
  let wpos = 0;
  let count = 0;

  // FFT tables
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0, x = i;
    for (let b = 1; b < N; b <<= 1) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const CT = new Float32Array(N / 2), ST = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    CT[i] = Math.cos((-2 * Math.PI * i) / N);
    ST[i] = Math.sin((-2 * Math.PI * i) / N);
  }
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))); // hann

  // log-spaced band edges, 30 Hz .. 16 kHz
  const edges = new Array(BANDS + 1);
  for (let i = 0; i <= BANDS; i++) {
    const f = 30 * Math.pow(16000 / 30, i / BANDS);
    edges[i] = Math.min(N / 2 - 1, Math.max(1, Math.round((f / (RATE / 2)) * (N / 2))));
  }

  const raw = new Float32Array(BANDS);
  const bands = new Float32Array(BANDS);
  let peak = 0.35;
  const feats = { bass: 0, mid: 0, treble: 0, level: 0 };

  function fft() {
    for (let i = 0; i < N; i++) { re[i] = ring[(wpos - N + i + ring.length * 2) % ring.length] * win[i]; im[i] = 0; }
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = CT[k], s = ST[k];
          const tre = re[j + half] * c - im[j + half] * s;
          const tim = re[j + half] * s + im[j + half] * c;
          re[j + half] = re[j] - tre; im[j + half] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }

  function computeBands() {
    fft();
    let sum = 0;
    for (let b = 0; b < BANDS; b++) {
      let m = 0;
      const lo = edges[b], hi = Math.max(lo + 1, edges[b + 1]);
      for (let k = lo; k < hi; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
        if (mag > m) m = mag;
      }
      // slight tilt boost so highs are visible
      raw[b] = m * (1 + (b / BANDS) * 1.7);
      sum += raw[b];
    }
    // adaptive normalization (peak follower)
    let mx = 0;
    for (let b = 0; b < BANDS; b++) if (raw[b] > mx) mx = raw[b];
    peak = Math.max(0.18, peak * 0.996 + mx * 0.004);
    const norm = 1 / peak;
    for (let b = 0; b < BANDS; b++) {
      let v = Math.min(1, raw[b] * norm);
      v = Math.pow(v, 0.8); // perceived curve
      // smoothing: fast attack, slow decay
      bands[b] = v > bands[b] ? v : bands[b] * 0.86 + v * 0.14;
    }
    feats.bass = avg(bands, 0, 12);
    feats.mid = avg(bands, 12, 44);
    feats.treble = avg(bands, 44, BANDS);
    feats.level = sum / BANDS * 4;
  }

  function avg(a, lo, hi) {
    let s = 0;
    for (let i = lo; i < hi; i++) s += a[i];
    return s / (hi - lo);
  }

  return {
    BANDS,
    feats,
    push(int16) { // interleaved stereo Int16LE
      for (let i = 0; i + 1 < int16.length; i += 2) {
        ring[wpos] = (int16[i] + int16[i + 1]) * 0.000030517578125;
        wpos = (wpos + 1) % ring.length;
      }
      count += int16.length;
    },
    update() {
      if (count < N * 2) return false; // wait until buffer has data
      computeBands();
      return true;
    },
    bands, // Float32Array(96) 0..1
  };
})();

/* ---------------------------------------------------------------- renderers */
function Viz(canvas, opts = {}) {
  this.cv = canvas;
  this.ctx = canvas.getContext('2d');
  this.mini = !!opts.mini;
  this.visible = true;
  this._neb = null;
}
Viz.registry = [];

Viz.prototype.resize = function () {
  const r = this.cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (this.cv.width !== w || this.cv.height !== h) {
    this.cv.width = w; this.cv.height = h;
  }
  return dpr;
};

Viz.prototype.cols = function () {
  const p = window.__vizPalette || { accent: [110, 125, 255], accent2: [155, 140, 255], bg: [10, 12, 18] };
  return p;
};

Viz.prototype.draw = function (time) {
  if (!this.visible) return;
  const dpr = this.resize();
  const ctx = this.ctx;
  const W = this.cv.width, H = this.cv.height;
  const c = this.cols();
  if (this.mini) {
    if (window.__vizMode === 'off') { ctx.clearRect(0, 0, W, H); return; }
    this.drawSpectrum(ctx, W, H, c, dpr, true);
  } else if (window.__vizMode === 'nebula') this.drawNebula(ctx, W, H, c, dpr, time);
  else if (window.__vizMode === 'off') { ctx.clearRect(0, 0, W, H); }
  else this.drawSpectrum(ctx, W, H, c, dpr, false);
};

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

Viz.prototype.drawSpectrum = function (ctx, W, H, c, dpr, mini) {
  const bands = Analyser.bands;
  const B = Analyser.BANDS;
  const baseY = mini ? H * 0.94 : H * 0.86;
  const maxH = mini ? H * 0.88 : H * 0.80;

  // trail fade (erase previous frame instead of painting over, so the
  // underlying view gradient stays visible)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  const n = mini ? 14 : B;
  const gap = mini ? 1.5 * dpr : 2 * dpr;
  const bw = (W - gap * (n - 1)) / n;
  const groups = B / n;

  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < groups; k++) { const x = bands[i * groups + k]; if (x > v) v = x; }
    if (mini) v = Math.min(1, v * 1.15);
    const h = Math.max(2 * dpr, v * maxH);
    const x = i * (bw + gap);
    const col = mixc(c.accent, c.accent2, i / n);
    const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
    g.addColorStop(0, rgba(mixc(col, [255, 255, 255], 0.25), 0.95));
    g.addColorStop(1, rgba(col, 0.85));
    ctx.fillStyle = g;
    const r = Math.min(bw / 2, 3 * dpr);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - h + r);
    ctx.arcTo(x, baseY - h, x + r, baseY - h, r);
    ctx.lineTo(x + bw - r, baseY - h);
    ctx.arcTo(x + bw, baseY - h, x + bw, baseY - h + r, r);
    ctx.lineTo(x + bw, baseY);
    ctx.closePath();
    ctx.fill();
    if (!mini) { // reflection
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = rgba(col, 0.9);
      ctx.fillRect(x, baseY + 2 * dpr, bw, h * 0.22);
      ctx.globalAlpha = 1;
    }
  }
  if (!mini) { // baseline
    ctx.fillStyle = rgba(c.accent, 0.35);
    ctx.fillRect(0, baseY, W, 1 * dpr);
  }
};

Viz.prototype.drawNebula = function (ctx, W, H, c, dpr, time) {
  if (!this._neb) {
    this._neb = [];
    for (let i = 0; i < 240; i++) {
      this._neb.push({
        a: Math.random() * Math.PI * 2,
        r: 0.18 + Math.random() * 0.85,
        sp: (0.10 + Math.random() * 0.55) * (Math.random() < 0.5 ? -1 : 1),
        b: Math.floor(Math.random() * Analyser.BANDS),
        sz: 0.6 + Math.random() * 2.2,
      });
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const cx = W / 2, cy = H * 0.46;
  const base = Math.min(W, H) * 0.34;
  const bands = Analyser.bands;
  const f = Analyser.feats;
  const t = time / 1000;

  // core pulse
  const cr = base * (0.30 + f.bass * 0.16);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
  grad.addColorStop(0, rgba(mixc(c.accent, [255, 255, 255], 0.5), 0.30));
  grad.addColorStop(1, rgba(c.accent, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.fill();

  // orbit ring
  ctx.strokeStyle = rgba(c.accent2, 0.32);
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  const SEG = 120;
  for (let i = 0; i <= SEG; i++) {
    const b = bands[Math.floor((i / SEG) * 40)];
    const rr = base * (1.02 + b * 0.35);
    const ang = (i / SEG) * Math.PI * 2 + t * 0.05;
    const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr * 0.92;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // particles
  for (const p of this._neb) {
    const e = bands[p.b];
    p.a += p.sp * (0.5 + e * 3.2) * 0.016;
    const rr = p.r * base * (1 + e * 0.75) + base * 0.25;
    const x = cx + Math.cos(p.a) * rr;
    const y = cy + Math.sin(p.a) * rr * 0.62 + Math.sin(t * 0.7 + p.r * 9) * 6 * dpr;
    const col = mixc(mixc(c.accent, c.accent2, p.b / Analyser.BANDS), [255, 255, 255], 0.25);
    ctx.fillStyle = rgba(col, 0.4 + Math.min(0.6, e * 1.7));
    const s = p.sz * dpr * (0.9 + e * 2.6);
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
};

/* ---------------------------------------------------------------- loop */
(function loop(t) {
  requestAnimationFrame(loop);
  const ok = Analyser.update();
  if (!ok) return;
  for (const v of Viz.registry) v.draw(t);
})(0);

/* wire IPC audio into the analyser */
window.auralis.on('audio:chunk', (buf) => {
  const u8 = new Uint8Array(buf);
  const i16 = new Int16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
  Analyser.push(i16);
});
