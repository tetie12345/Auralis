'use strict';
/* Lyrics — parses Apple's lyric payloads (TTML or timed-line arrays) and
   renders time-synced karaoke lines into #lyrics-scroll. */

const Lyrics = (() => {
  let lines = null;   // [{t, end, text}]
  let idx = -1;
  let nodes = [];
  let currentKey = '';

  function parseTime(str) {
    if (str == null) return 0;
    if (typeof str === 'number') return str;
    str = String(str).trim();
    if (str.endsWith('s')) str = str.slice(0, -1);
    const parts = str.split(':').map(parseFloat);
    let t = 0;
    for (const p of parts) t = t * 60 + (isNaN(p) ? 0 : p);
    return t;
  }

  function parseTTML(xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const ps = doc.getElementsByTagName('p');
      const out = [];
      for (const p of ps) {
        const t = parseTime(p.getAttribute('begin'));
        const end = parseTime(p.getAttribute('end')) || t + 4;
        const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) out.push({ t, end, text });
      }
      return out.length ? out : null;
    } catch {
      return null;
    }
  }

  function parse(json) {
    try {
      let d = json && json.data && json.data[0];
      if (!d) return null;
      let attrs = d.attributes || {};
      // /songs/{id}/lyrics returns the lyric object directly; ?extend=lyrics
      // nests it under relationships.lyrics
      if (d.type !== 'lyrics') {
        const rel = d.relationships && d.relationships.lyrics;
        const l0 = rel && rel.data && rel.data[0];
        if (!l0) return null;
        attrs = l0.attributes || {};
      }
      if (attrs.ttml) return parseTTML(attrs.ttml);
      if (Array.isArray(attrs.lines)) {
        return attrs.lines
          .map((l) => {
            if (typeof l === 'string') return { t: 0, end: 0, text: l };
            return {
              t: parseTime(l.beginTime != null ? l.beginTime : l.begin),
              end: parseTime(l.endTime != null ? l.endTime : l.end),
              text: String(l.lineText || l.text || '').trim(),
            };
          })
          .filter((l) => l.text);
      }
      return null;
    } catch {
      return null;
    }
  }

  function parseLRC(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const m = line.match(/^\s*\[(\d+):(\d+(?:[.:]\d+)?)\](.*)$/);
      if (!m) continue;
      const t = (+m[1]) * 60 + parseFloat(m[2].replace(':', '.'));
      const txt = m[3].replace(/^\s*<\d+:\d+\.\d+>\s*/, '').trim();
      if (txt) out.push({ t, end: 0, text: txt });
    }
    out.sort((a, b) => a.t - b.t);
    for (let i = 0; i < out.length; i++) {
      out[i].end = out[i + 1] ? out[i + 1].t : out[i].t + 5;
    }
    return out.length ? out : null;
  }

  function set(key, parsed) {
    currentKey = key;
    lines = parsed;
    idx = -1;
    nodes = [];
    const box = document.getElementById('lyrics-scroll');
    box.innerHTML = '';
    if (!parsed || !parsed.length) {
      box.innerHTML = '<p class="lyrics-empty">No lyrics available for this song.</p>';
      return;
    }
    for (const l of lines) {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.textContent = l.text || '\u00A0';
      box.appendChild(div);
      nodes.push(div);
    }
  }

  function reset() {
    if (lines) set('', null);
    lines = null; idx = -1; nodes = []; currentKey = '';
  }

  function sync(time) {
    if (!lines || !lines.length) return;
    let i = idx;
    // advance
    while (i + 1 < lines.length && lines[i + 1].t <= time + 0.08) i++;
    // rewind (seek)
    if (i < 0 || (idx >= 0 && time < lines[idx].t - 0.4)) {
      i = 0;
      while (i + 1 < lines.length && lines[i + 1].t <= time) i++;
    }
    if (i === idx) return;
    idx = i;
    for (let k = 0; k < nodes.length; k++) {
      nodes[k].classList.toggle('active', k === idx);
      nodes[k].classList.toggle('near', k === idx + 1 || k === idx - 1);
    }
    const n = nodes[idx];
    if (n) {
      const box = document.getElementById('lyrics-scroll');
      const target = n.offsetTop - box.clientHeight * 0.42;
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

  return { parse, parseLRC, set, reset, sync, get lines() { return lines; }, get key() { return currentKey; } };
})();
