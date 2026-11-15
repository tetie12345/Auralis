'use strict';
/* Auralis renderer — drives the embedded Apple Music player (MusicKit JS in
   the webview) and renders the custom UI on top of it. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ settings */
const Settings = {
  viz: 'auto',
  accent: 'artwork',
  lyrSize: 19,
  source: '',
  fanSync: false,
  load() {
    try { Object.assign(this, JSON.parse(localStorage.getItem('auralis:settings') || '{}')); } catch {}
  },
  save() {
    localStorage.setItem('auralis:settings', JSON.stringify({
      viz: this.viz, accent: this.accent, lyrSize: this.lyrSize, source: this.source, fanSync: this.fanSync,
    }));
  },
};
Settings.load();

/* ------------------------------------------------------------- Apple bridge */
/* Persistent tap into the Apple player's internal event dispatcher. This is
   the authoritative source: playbackTimeDidChange carries exact time+duration,
   and music may flow through a muted media element (WebAudio graph), so any
   element-sniffing heuristic is unreliable. Reinstalled after page reloads. */
const TAP_JS = `(() => {
  try {
    const mk = window.MusicKit && MusicKit.getInstance ? MusicKit.getInstance() : null;
    if (!mk || !mk.services || !mk.services.dispatcher) return 'no-mk';
    if (window.__auralisTap) return 'already';
    window.__auralisTap = true;
    window.__auralisState = {
      authorized: !!mk.isAuthorized, state: mk.playbackState,
      time: 0, dur: 0, vol: mk.volume == null ? 1 : mk.volume,
      shuffle: mk.shuffleMode === 1,
      sf: mk.storefrontId || (mk.services.mediaAPIAccess && mk.services.mediaAPIAccess.storefrontId) || '',
      item: null,
    };
    const snap = () => {
      try {
        const q = mk.queue; const pos = q._position;
        const entry = (q._queueItems && pos >= 0) ? q._queueItems[pos] : null;
        const item = entry && (entry.item || entry.mediaItem || entry);
        const a = item && item.attributes;
        window.__auralisState.item = a ? {
          id: item.id || '',
          cid: (a.playParams && a.playParams.catalogId) || (a.playParams && a.playParams.id) || item.id || '',
          title: a.name || '', artist: a.artistName || '', album: a.albumName || '',
          art: (a.artwork && a.artwork.url) || '', ms: a.durationInMillis || 0,
        } : null;
        window.__auralisState.authorized = !!mk.isAuthorized;
        window.__auralisState.vol = mk.volume == null ? 1 : mk.volume;
        window.__auralisState.shuffle = mk.shuffleMode === 1;
        window.__auralisState.sf = mk.storefrontId || window.__auralisState.sf;
        window.__auralisState.state = mk.playbackState;
      } catch (e) {}
    };
    window.__auralisSnap = snap; snap();
    const d = mk.services.dispatcher;
    const orig = d.publish.bind(d);
    d.publish = function (topic, msg) {
      try {
        const p = msg && msg.payload !== undefined ? msg.payload : msg;
        if (topic === 'playbackTimeDidChange' && p) {
          window.__auralisState.time = p.currentPlaybackTime || 0;
          window.__auralisState.dur = p.currentPlaybackDuration || 0;
        } else if (/^(playbackStateDidChange|playbackPlay|playbackPause|playbackStop|playbackBuffer)/.test(topic)) {
          window.__auralisState.state = mk.playbackState;
          snap();
        } else if (/queue/i.test(topic)) {
          snap();
        }
      } catch (e) {}
      return orig(topic, msg);
    };
    return 'installed';
  } catch (e) { return 'ERR ' + (e && e.message || e); }
})()`;

const STATE_JS = `(() => {
  try {
    const mk = window.MusicKit && MusicKit.getInstance ? MusicKit.getInstance() : null;
    if (!mk) return JSON.stringify({ ok: false });
    if (!window.__auralisTap) return JSON.stringify({ ok: false, needTap: true });
    if (window.__auralisSnap) window.__auralisSnap();
    return JSON.stringify(Object.assign({ ok: true }, window.__auralisState));
  } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message || e) }); }
})()`;

const Apple = {
  wv: null,
  ready: false,
  sf: 'us',
  init() { this.wv = $('#apple'); },
  exec(code) { return this.wv.executeJavaScript(code, false); },
  async waitReady(timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await this.exec('!!(window.MusicKit&&MusicKit.getInstance&&MusicKit.getInstance().api)')) {
          this.ready = true;
          this.sf = (await this.exec('(window.MusicKit&&MusicKit.getInstance().storefrontId)||"us"')) || 'us';
          return true;
        }
      } catch {}
      await sleep(700);
    }
    return false;
  },
  api(path) {
    // MusicKit JS wraps responses: { url, status, json (parsed body), ... }
    return this.exec(`MusicKit.getInstance().api.music(${JSON.stringify(path)}).then(r=>(r&&r.json)?r.json:r)`);
  },
  play(ids, startIdx = 0) {
    if (!ids || !ids.length) return;
    const params = startIdx
      ? `songs:${JSON.stringify(ids)},startWith:${startIdx},startPlaying:true`
      : `songs:${JSON.stringify(ids)},startPlaying:true`;
    return this.exec(`MusicKit.getInstance().setQueue({${params}}).then(()=>"ok").catch(e=>"ERR "+(e&&e.message||e))`);
  },
  toggle() {
    return this.exec('(() => { const mk = MusicKit.getInstance(); return (mk.playbackState === 2 ? mk.pause() : mk.play()).then(() => "ok").catch(e => "ERR " + e); })()');
  },
  next() { return this.exec('MusicKit.getInstance().skipToNextItem().then(()=>"ok").catch(e=>"ERR "+e)'); },
  prev() { return this.exec('MusicKit.getInstance().skipToPreviousItem().then(()=>"ok").catch(e=>"ERR "+e)'); },
  seek(t) { return this.exec(`MusicKit.getInstance().seekToTime(${Number(t) || 0})`); },
  setVol(v) { return this.exec(`MusicKit.getInstance().volume=${Number(v)}`); },
};

/* -------------------------------------------------------------------- state */
const State = {
  auth: false,
  item: null,
  playing: false,
  time: 0,
  dur: 0,
  lastTime: null,
  lastItemId: null,
  artItemId: null,
  shuffle: false,
  queueSig: '',
  seeking: false,
  webviewShown: false,
  lyricKey: '',
};

/* -------------------------------------------------------------------- views */
function setView(name) {
  State.view = name;
  for (const s of $$('.view')) s.classList.add('hidden');
  const target = $('#view-' + name);
  if (target) target.classList.remove('hidden');
  for (const b of $$('.nav-item')) b.classList.toggle('active', b.dataset.view === name);
  for (const v of Viz.registry) v.visible = v.mini; // mini strip stays on
  if (name === 'now') {
    const main = Viz.registry.find((v) => v.cv.id === 'viz-main');
    if (main) main.visible = true;
  }
}
let volumeDragging = false;

/* ------------------------------------------------------------ now playing UI */
async function refreshNowPlaying() {
  const it = State.item;
  if (!it) return;
  $('#now-title').textContent = it.title;
  $('#now-artist').textContent = [it.artist, it.album].filter(Boolean).join(' — ');
  $('#pb-title').textContent = it.title;
  $('#pb-artist').textContent = it.artist;

  // artwork (only reload when the track actually changed; a failed fetch
  // leaves artItemId unset so the retry interval picks it up)
  if (it.art && State.artItemId !== it.id) {
    const url = it.art.replace('{w}', '600').replace('{h}', '600');
    const dataUrl = await window.auralis.fetchArt(url);
    if (dataUrl) {
      State.artItemId = it.id;
      $('#now-art').src = dataUrl;
      $('#pb-art').src = dataUrl;
      if (Settings.accent === 'artwork') applyPalette(dataUrl);
    }
  } else if (!it.art) {
    $('#now-art').removeAttribute('src');
  }

  // lyrics
  const key = it.cid || it.id;
  if (key && State.lyricKey !== key) {
    State.lyricKey = key;
    Lyrics.set(key, lyricsCache.has(key) ? lyricsCache.get(key) : null);
    loadLyrics(it, key);
    prefetchNext();
  }
}

const lyricsCache = new Map(); // catalogId -> parsed lines

async function loadLyrics(it, key) {
  if (lyricsCache.has(key)) {
    Lyrics.set(key, lyricsCache.get(key));
    return;
  }
  let parsed = null;
  try {
    const json = await Apple.api(`/v1/catalog/${Apple.sf}/songs/${key}?extend=lyrics&l=en-US`);
    parsed = Lyrics.parse(json);
  } catch {}
  if (!parsed) {
    // Fallback: LRCLIB (free synced-lyrics database, timestamped LRC)
    try {
      const q = `track_name=${encodeURIComponent(it.title)}&artist_name=${encodeURIComponent(it.artist || '')}`;
      const res = await fetch('https://lrclib.net/api/search?' + q);
      const arr = await res.json();
      const dur = (it.ms || 0) / 1000 || State.dur || 0;
      const cands = (arr || []).filter((x) => x.syncedLyrics &&
        (!dur || !x.duration || Math.abs(x.duration - dur) < 14));
      const best = cands.sort((a, b) =>
        Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))[0];
      if (best) parsed = Lyrics.parseLRC(best.syncedLyrics);
    } catch {}
  }
  if (parsed) lyricsCache.set(key, parsed);
  if (State.lyricKey === key) Lyrics.set(key, parsed);
}

/* warm the caches for the next queue entry so switching tracks feels instant */
async function prefetchNext() {
  try {
    const q = JSON.parse(await Apple.exec(QUEUE_JS));
    if (!q.items || q.pos < 0) return;
    const next = q.items[q.pos + 1];
    if (!next || !next.id) return;
    if (!lyricsCache.has(next.id)) {
      // resolve catalog id, fetch lyrics quietly
      const key = next.id;
      try {
        const json = await Apple.api(`/v1/catalog/${Apple.sf}/songs/${key}?extend=lyrics&l=en-US`);
        const parsed = Lyrics.parse(json);
        if (parsed) lyricsCache.set(key, parsed);
      } catch {}
    }
    if (next.art) {
      window.auralis.fetchArt(next.art.replace('{w}', '600').replace('{h}', '600'));
    }
  } catch {}
}

function applyPalette(dataUrl) {
  Palette.extract(dataUrl).then((pal) => {
    if (!pal) return;
    const r = document.documentElement.style;
    r.setProperty('--accent', pal.accent);
    r.setProperty('--accent2', pal.accent2);
    r.setProperty('--tint', pal.tint);
    r.setProperty('--glow', pal.glow || 'rgba(109,125,255,0.45)');
    window.__vizPalette = pal.viz;
    fanPush(pal);
    paintRange($('#pb-seek'));
    paintRange($('#pb-vol'));
  });
}

/* fan RGB sync: push the current accent pair to the legion-rgb daemon */
let fanPal = { accent: null, accent2: null, sent: false };
function fanPush(pal) {
  if (!Settings.fanSync || !pal || !pal.accent) return;
  if (fanPal.sent && pal.accent === fanPal.accent && pal.accent2 === fanPal.accent2) return;
  fanPal = { accent: pal.accent, accent2: pal.accent2, sent: true };
  try { window.auralis.fanSync({ enabled: true, accent: pal.accent, accent2: pal.accent2 }); } catch {}
}
function fanDisable() {
  fanPal = { accent: null, accent2: null, sent: false };
  try { window.auralis.fanSync({ enabled: false }); } catch {}
}

function fixedPalette() {
  const r = document.documentElement.style;
  r.setProperty('--accent', '#6d7dff');
  r.setProperty('--accent2', '#9b8cff');
  r.setProperty('--tint', 'rgba(109,125,255,0.10)');
  r.setProperty('--glow', 'rgba(109,125,255,0.45)');
  window.__vizPalette = { accent: [110, 125, 255], accent2: [155, 140, 255], bg: [10, 12, 18] };
  fanPush({ accent: '#6d7dff', accent2: '#9b8cff' });
}

/* paint the filled portion of range inputs with the accent color */
function paintRange(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.background = `linear-gradient(to right, var(--accent) ${p}%, rgba(255,255,255,0.14) ${p}%)`;
}

/* play and surface queue errors as a toast */
async function playWithToast(ids, idx, label) {
  const r = await Apple.play(ids, idx);
  if (r && String(r).startsWith('ERR')) {
    toast('Playback error: ' + String(r).slice(4).slice(0, 80));
    return false;
  }
  return true;
}

/* -------------------------------------------------------------------- cards */
function artworkUrl(a, size = 300) {
  if (!a || !a.url) return null;
  return a.url.replace('{w}', String(size)).replace('{h}', String(size)).replace('{f}', 'jpg');
}

async function artSrc(attrs, size) {
  const u = artworkUrl(attrs.artwork, size);
  if (!u) return null;
  const d = await window.auralis.fetchArt(u);
  return d;
}

async function makeCard(item, { round = false } = {}) {
  const card = el('div', 'card');
  const cls = 'card-art' + (round ? ' sq' : '');
  const src = await artSrc(item.attributes, 300);
  if (src) {
    const img = el('img', cls);
    img.src = src;
    card.appendChild(img);
  } else {
    const ph = el('div', cls);
    ph.style.background = 'linear-gradient(135deg,#1c2030,#12141c)';
    card.appendChild(ph);
  }
  card.appendChild(el('div', 'card-title', item.attributes.name || ''));
  card.appendChild(el('div', 'card-sub',
    item.attributes.artistName || item.attributes.curatorName || item.type.replace('-', ' ')));
  card.addEventListener('click', () => openItem(item));
  return card;
}

function kindOf(item) {
  const t = item.type;
  if (t === 'playlists' || t === 'library-playlists') return 'playlist';
  if (t === 'albums' || t === 'library-albums') return 'album';
  if (t === 'artists' || t === 'library-artists') return 'artist';
  if (t === 'songs' || t === 'library-songs') return 'song';
  if (t === 'stations') return 'station';
  return t;
}

/* resolve playable song ids for a playlist/album/artist */
async function trackIds(item) {
  const kind = kindOf(item);
  const id = item.id;
  const sf = Apple.sf;
  let path = null;
  if (kind === 'playlist') {
    path = id.startsWith('p.')
      ? `/v1/me/library/playlists/${id}/tracks?limit=100`
      : `/v1/catalog/${sf}/playlists/${id}/tracks?limit=100`;
  } else if (kind === 'album') {
    path = id.startsWith('p.') || id.startsWith('l.')
      ? `/v1/me/library/albums/${id}/tracks?limit=100`
      : `/v1/catalog/${sf}/albums/${id}/tracks?limit=100`;
  } else if (kind === 'artist') {
    path = `/v1/catalog/${sf}/artists/${id}/songs?limit=50`;
  }
  if (!path) return null;
  try {
    const res = await Apple.api(path);
    const data = (res && res.data) || [];
    const ids = data
      .map((t) => (t.attributes && t.attributes.playParams && t.attributes.playParams.catalogId) ||
        (t.attributes && t.attributes.playParams && t.attributes.playParams.id) || t.id)
      .filter((x) => x);
    return ids;
  } catch (e) {
    console.warn('trackIds failed', e);
    return null;
  }
}

async function openItem(item) {
  const kind = kindOf(item);
  if (kind === 'song') {
    toast('Playing “' + item.attributes.name + '”');
    playWithToast([item.attributes.playParams?.catalogId || item.id]);
  } else {
    toast('Loading ' + (item.attributes.name || '') + '…');
    const ids = await trackIds(item);
    if (ids && ids.length) {
      if (await playWithToast(ids)) toast('Queued ' + ids.length + ' tracks');
    } else toast('Could not load this ' + kind);
  }
}

/* ------------------------------------------------------------------ shelves */
function addShelf(container, title, items, opts) {
  if (!items.length) return;
  const shelf = el('div', 'shelf');
  shelf.appendChild(el('h3', null, title));
  const row = el('div', 'shelf-row');
  shelf.appendChild(row);
  container.appendChild(shelf);
  (async () => {
    for (const it of items) row.appendChild(await makeCard(it, opts));
  })();
}

/* -------------------------------------------------------------------- home */
// Recommendation titles arrive as {stringForDisplay: "..."} (or a plain string).
function shelfTitle(rec, idx) {
  const t = rec.attributes && rec.attributes.title;
  const s = typeof t === 'string' ? t
    : t && (t.stringForDisplay || t.string || t.name || t.title);
  return s || (idx === 0 ? 'Made for you' : 'Recommended');
}

async function loadHome() {
  const box = $('#home-rows');
  box.innerHTML = '<p class="muted">Loading recommendations…</p>';
  try {
    const res = await Apple.api(`/v1/me/recommendations?limit=8`);
    box.innerHTML = '';
    const recs = res.data || [];
    let n = 0;
    for (const rec of recs) {
      const rel = rec.relationships && rec.relationships.contents;
      const items = ((rel && rel.data) || []).filter((i) => kindOf(i) !== 'station');
      if (!items.length) continue;
      addShelf(box, shelfTitle(rec, n), items);
      n++;
    }
    if (!n) {
      box.innerHTML = '<p class="muted">No recommendations yet — play something or open your Library.</p>';
      const lib = await Apple.api('/v1/me/library/playlists?limit=20').catch(() => null);
      if (lib && lib.data && lib.data.length) addShelf(box, 'Your playlists', lib.data);
    }
  } catch (e) {
    box.innerHTML = '<p class="muted">Could not load recommendations: ' + (e.message || e) + '</p>';
  }
}

/* ------------------------------------------------------------------ search */
let searchTimer = null;
function wireSearch() {
  const input = $('#search-input');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const term = input.value.trim();
    if (term.length < 2) { $('#search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(term), 350);
  });
}

async function doSearch(term) {
  const box = $('#search-results');
  box.innerHTML = '<p class="muted">Searching…</p>';
  try {
    const res = await Apple.api(
      `/v1/catalog/${Apple.sf}/search?term=${encodeURIComponent(term)}&limit=24&types=songs,playlists,albums,artists`);
    box.innerHTML = '';
    const results = res.results || {};
    let songIds = [];
    const songs = (results.songs && results.songs.data) || [];
    if (songs.length) {
      songIds = songs.map((s) => s.id);
      const sec = el('div', 'results-section');
      sec.appendChild(el('h3', null, 'Songs'));
      songs.forEach((s, i) => {
        const row = el('div', 'row-song');
        const img = el('img', 'row-art');
        artSrc(s.attributes, 100).then((d) => { if (d) img.src = d; });
        row.appendChild(el('span', 'row-idx', String(i + 1)));
        row.appendChild(img);
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', s.attributes.name));
        main.appendChild(el('div', 'row-sub', s.attributes.artistName || ''));
        row.appendChild(main);
        row.appendChild(el('span', 'row-dur', fmtTime((s.attributes.durationInMillis || 0) / 1000)));
        row.addEventListener('click', () => playWithToast(songIds, i));
        sec.appendChild(row);
      });
      box.appendChild(sec);
    }
    for (const [key, label] of [['playlists', 'Playlists'], ['albums', 'Albums'], ['artists', 'Artists']]) {
      const data = (results[key] && results[key].data) || [];
      if (data.length) addShelf(box, label, data, { round: key === 'artists' });
    }
    if (!box.childNodes.length) box.innerHTML = '<p class="muted">No results.</p>';
  } catch (e) {
    box.innerHTML = '<p class="muted">Search failed: ' + (e.message || e) + '</p>';
  }
}

/* ----------------------------------------------------------------- library */
let libTab = 'playlists';
async function loadLibrary() {
  const box = $('#library-content');
  box.innerHTML = '<p class="muted">Loading library…</p>';
  try {
    if (libTab === 'playlists') {
      const res = await Apple.api('/v1/me/library/playlists?limit=100');
      box.innerHTML = '';
      const data = res.data || [];
      if (!data.length) { box.innerHTML = '<p class="muted">No playlists yet.</p>'; return; }
      for (const pl of data) box.appendChild(await makeCard(pl));
    } else {
      const res = await Apple.api('/v1/me/library/songs?limit=100');
      box.innerHTML = '';
      const data = res.data || [];
      if (!data.length) { box.innerHTML = '<p class="muted">No songs in your library.</p>'; return; }
      const ids = data.map((s) => (s.attributes && s.attributes.playParams && s.attributes.playParams.catalogId) || s.id);
      data.forEach((s, i) => {
        const row = el('div', 'row-song');
        row.appendChild(el('span', 'row-idx', String(i + 1)));
        const main = el('div', 'row-main');
        main.appendChild(el('div', 'row-title', s.attributes.name));
        main.appendChild(el('div', 'row-sub', s.attributes.artistName || ''));
        row.appendChild(main);
        row.appendChild(el('span', 'row-dur', fmtTime((s.attributes.durationInMillis || 0) / 1000)));
        row.addEventListener('click', () => playWithToast(ids, i));
        box.appendChild(row);
      });
      box.style.flexDirection = 'column';
    }
  } catch (e) {
    box.innerHTML = '<p class="muted">Could not load library: ' + (e.message || e) + '</p>';
  }
}

/* ------------------------------------------------------------- state polling */
function handleState(s) {
  if (!s || !s.ok) return;
  const wasAuth = State.auth;
  State.auth = !!s.authorized;
  if (s.sf && s.sf !== Apple.sf) Apple.sf = s.sf;
  if (State.auth !== wasAuth) {
    $('#auth-chip').classList.toggle('on', State.auth);
    $('#auth-chip').classList.toggle('off', !State.auth);
    $('#auth-label').textContent = State.auth ? 'Connected' : 'Offline';
    if (State.auth && State.view === 'signin') {
      hideWebview();
      setView('home');
      loadHome();
      toast('Apple Music connected');
    } else if (!State.auth) {
      setView('signin');
    }
  }
  // "playing" = explicit state OR playback time advancing since last poll
  const timeAdvanced = State.lastTime != null && s.time > State.lastTime + 0.01 && s.time > 0;
  State.lastTime = s.time;
  State.playing = s.state === 2 || timeAdvanced;
  $('#pb-play').innerHTML = window.icon(State.playing ? 'pause' : 'play', 23);
  window.auralis.audioPaused(!State.playing);
  State.dur = s.dur || (s.item ? s.item.ms / 1000 : 0);
  if (!State.seeking) {
    State.time = s.time || 0;
    $('#pb-time').textContent = fmtTime(State.time);
    $('#pb-seek').value = State.dur ? Math.round((State.time / State.dur) * 1000) : 0;
    $('#pb-dur').textContent = fmtTime(State.dur);
    paintRange($('#pb-seek'));
    Lyrics.sync(State.time);
  }
  if (s.shuffle != null && s.shuffle !== State.shuffle) {
    State.shuffle = s.shuffle;
    $('#pb-shuffle').classList.toggle('on', s.shuffle);
  }
  // new track?
  const it = s.item;
  if (it && (State.lastItemId !== it.id)) {
    State.lastItemId = it.id;
    State.item = it;
    State.lyricKey = '';
    Lyrics.reset();
    refreshNowPlaying();
    highlightPlayingRow(it.cid || it.id);
  } else if (it) {
    State.item = it;
  }
  if (!s.item && State.item) {
    State.item = null; State.lastItemId = null; State.lyricKey = '';
    Lyrics.reset();
    $('#pb-title').textContent = 'Nothing playing';
    $('#pb-artist').textContent = '';
  }
  // volume reflect once
  if (Math.abs(($('#pb-vol').value / 100) - s.vol) > 0.02 && !volumeDragging) {
    $('#pb-vol').value = Math.round(s.vol * 100);
  }
}

function highlightPlayingRow(id) {
  $$('.row-song').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
}

/* ------------------------------------------------------------------ webview */
function showWebview() {
  $('#apple').classList.remove('hidden');
  $('#view-signin').classList.remove('hidden');
  $('#signin-hint').classList.remove('hidden');
  State.webviewShown = true;
}
function hideWebview() {
  $('#apple').classList.add('hidden');
  State.webviewShown = false;
}

/* ------------------------------------------------------------------ settings */
function applySettings() {
  window.__vizMode = Settings.viz === 'nebula' ? 'nebula' : 'spectrum';
  if (Settings.viz === 'off') window.__vizMode = 'off';
  $('#set-viz').value = Settings.viz;
  $('#set-accent').value = Settings.accent;
  $('#set-lyrsize').value = Settings.lyrSize;
  $('#set-fansync').checked = !!Settings.fanSync;
  document.documentElement.style.setProperty('--lyr-size', Settings.lyrSize + 'px');
  if (Settings.accent === 'indigo') fixedPalette();
}

function vizAutoCycle() {
  // in auto mode, alternate every 45 s
  if (Settings.viz !== 'auto') { window.__vizMode = Settings.viz === 'off' ? 'off' : Settings.viz; return; }
  const idx = Math.floor(Date.now() / 45000) % 2;
  window.__vizMode = idx === 0 ? 'spectrum' : 'nebula';
}

/* --------------------------------------------------------------- queue view */
const QUEUE_JS = `(() => {
  try {
    const q = MusicKit.getInstance().queue;
    const items = (q._queueItems || []).map((e) => {
      const it = e && e.item;
      const a = it && it.attributes;
      return it ? {
        id: it.id || '',
        title: (a && a.name) || '', artist: (a && a.artistName) || '',
        ms: (a && a.durationInMillis) || 0,
        art: (a && a.artwork && a.artwork.url) || ''
      } : null;
    });
    return JSON.stringify({ pos: q._position, items });
  } catch (e) { return JSON.stringify({ pos: -1, items: [] }); }
})()`;

let queueShown = false;

function showNowTab(which) {
  const lyrics = which === 'lyrics';
  $('#tab-lyrics').classList.toggle('active', lyrics);
  $('#tab-queue').classList.toggle('active', !lyrics);
  $('#lyrics-scroll').classList.toggle('hidden', !lyrics);
  $('#queue-scroll').classList.toggle('hidden', lyrics);
  queueShown = !lyrics;
  if (queueShown) refreshQueue();
}

async function refreshQueue() {
  if (!queueShown || State.view !== 'now') return;
  try {
    const q = JSON.parse(await Apple.exec(QUEUE_JS));
    const box = $('#queue-scroll');
    if (!q.items || !q.items.length) {
      if (!box.querySelector('.lyrics-empty')) box.innerHTML = '<p class="lyrics-empty">Queue is empty.</p>';
      return;
    }
    const sig = q.items.map((x) => x && x.id).join(',') + '|' + q.pos;
    if (State.queueSig === sig) return;
    State.queueSig = sig;
    box.innerHTML = '';
    // pinned current track, then only what's actually coming up
    if (q.pos >= 0 && q.items[q.pos]) {
      box.appendChild(queueRow(q.items[q.pos], q.pos, true));
      const head = el('p', 'lyrics-empty', 'Up next');
      head.style.cssText = 'padding:14px 0 6px;text-align:left;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;';
      box.appendChild(head);
    }
    q.items.forEach((it, i) => {
      if (!it || i <= q.pos) return;
      box.appendChild(queueRow(it, i, false));
    });
    if (q.pos >= q.items.length - 1) {
      const end = el('p', 'lyrics-empty', 'End of queue');
      box.appendChild(end);
    }
  } catch {}
}

function queueRow(it, i, current) {
  const row = el('div', 'q-row' + (current ? ' current' : ''));
  const img = el('img', 'q-art');
  if (it.art) window.auralis.fetchArt(it.art.replace('{w}', '100').replace('{h}', '100')).then((d) => { if (d) img.src = d; });
  row.appendChild(img);
  const main = el('div', 'q-main');
  main.appendChild(el('div', 'q-title', it.title || '(loading)'));
  main.appendChild(el('div', 'q-artist', it.artist));
  row.appendChild(main);
  row.appendChild(el('span', 'q-dur', fmtTime(it.ms / 1000)));
  row.addEventListener('click', () => {
    Apple.exec(`MusicKit.getInstance().changeToMediaItem(MusicKit.getInstance().queue._queueItems[${i}].item).then(()=>"ok").catch(e=>"ERR "+e)`);
    toast('Jumping to “' + it.title + '”');
  });
  return row;
}

/* --------------------------------------------------------------- fullscreen */
function toggleFullscreen() {
  const on = !document.body.classList.contains('fullscreen');
  document.body.classList.toggle('fullscreen', on);
  $('#pb-full').classList.toggle('on', on);
  window.auralis.win('fullscreen', on);
  if (on) {
    State.prevView = State.view;
    setView('now');
    toast('Fullscreen — press Esc or F to exit');
  } else {
    setView(State.prevView || 'now');
  }
}

/* play/pause driven by our own playing-detection (playbackState is 0 even
   while audio plays through the muted-element WebAudio path) */
function togglePlay() {
  const wasPlaying = State.playing;
  if (!wasPlaying && !State.item) { toast('Nothing to play yet'); return; }
  $('#pb-play').innerHTML = window.icon(wasPlaying ? 'play' : 'pause', 23);
  // IIFE: a bare `const mk` would pollute the webview's global scope and make
  // every subsequent command throw "already declared"
  Apple.exec(`(() => { const mk=MusicKit.getInstance(); try { return (${wasPlaying ? 'mk.pause()' : 'mk.play()'}).then(()=>'ok').catch(e=>'ERR '+e); } catch(e) { return 'ERR '+String(e); } })()`)
    .then((r) => {
      // play() with an empty/stale queue fails — fall back to the last track
      if (r && String(r).startsWith('ERR') && !wasPlaying && State.item) {
        Apple.play([State.item.cid]);
      }
    })
    .catch((e) => console.warn('togglePlay failed:', e));
}

/* ------------------------------------------------------------------ init */
async function init() {
  Apple.init();
  applySettings();
  fixedPalette();

  // visualizer canvases
  Viz.registry.push(new Viz($('#viz-main')));
  Viz.registry.push(new Viz($('#viz-mini'), { mini: true }));
  Viz.registry.find((v) => v.cv.id === 'viz-mini').visible = true;
  setInterval(vizAutoCycle, 5000);
  vizAutoCycle();
  setInterval(refreshQueue, 2000);
  // retry failed artwork/palette loads (e.g. momentary network hiccup)
  setInterval(() => {
    if (State.item && State.item.art && State.artItemId !== State.item.id) refreshNowPlaying();
  }, 3000);

  // window controls
  $('#w-min').addEventListener('click', () => window.auralis.win('minimize'));
  $('#w-max').addEventListener('click', () => window.auralis.win('maximize'));
  $('#w-close').addEventListener('click', () => window.auralis.win('close'));

  // nav
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => {
    if (!State.auth && b.dataset.view !== 'settings') { toast('Sign in to Apple Music first'); return; }
    setView(b.dataset.view);
    if (b.dataset.view === 'home' && !$('#home-rows').children.length) loadHome();
    if (b.dataset.view === 'library' && !$('#library-content').children.length) loadLibrary();
    if (b.dataset.view === 'now' && !State.item) toast('Play something first');
  }));
  $$('.lib-tab').forEach((t) => t.addEventListener('click', () => {
    $$('.lib-tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    libTab = t.dataset.lib;
    $('#library-content').style.flexDirection = '';
    loadLibrary();
  }));

  // sign in
  $('#btn-signin').addEventListener('click', () => {
    showWebview();
  });

  // transport
  $('#pb-play').addEventListener('click', togglePlay);
  $('#pb-next').addEventListener('click', () => Apple.next());
  $('#pb-prev').addEventListener('click', () => Apple.prev());
  $('#pb-seek').addEventListener('input', () => { State.seeking = true; $('#pb-time').textContent = fmtTime(($('#pb-seek').value / 1000) * State.dur); paintRange($('#pb-seek')); });
  $('#pb-seek').addEventListener('change', () => { Apple.seek(($('#pb-seek').value / 1000) * State.dur); State.seeking = false; });

  $('#pb-vol').addEventListener('input', () => { Apple.setVol($('#pb-vol').value / 100); paintRange($('#pb-vol')); });
  $('#pb-lyrics').addEventListener('click', () => { setView('now'); showNowTab('lyrics'); });
  $('#pb-queue').addEventListener('click', () => { setView('now'); showNowTab('queue'); });
  $('#pb-viz').addEventListener('click', cycleViz);
  $('#pb-full').addEventListener('click', toggleFullscreen);
  $('#pb-shuffle').addEventListener('click', () => {
    const on = !State.shuffle;
    State.shuffle = on;
    $('#pb-shuffle').classList.toggle('on', on);
    Apple.exec(`MusicKit.getInstance().shuffleMode=${on ? 1 : 0}`);
    toast(on ? 'Shuffle on — applies to newly queued lists' : 'Shuffle off');
  });
  $('#tab-lyrics').addEventListener('click', () => showNowTab('lyrics'));
  $('#tab-queue').addEventListener('click', () => showNowTab('queue'));
  paintRange($('#pb-seek'));
  paintRange($('#pb-vol'));
  $('#pb-viz').classList.add('on');

  // settings
  $('#set-viz').addEventListener('change', (e) => { Settings.viz = e.target.value; Settings.save(); applySettings(); });
  $('#set-accent').addEventListener('change', (e) => { Settings.accent = e.target.value; Settings.save(); applySettings(); if (Settings.accent === 'artwork' && State.item) refreshNowPlaying(); });
  $('#set-lyrsize').addEventListener('input', (e) => { Settings.lyrSize = +e.target.value; document.documentElement.style.setProperty('--lyr-size', Settings.lyrSize + 'px'); Settings.save(); });
  $('#set-fansync').addEventListener('change', (e) => {
    Settings.fanSync = e.target.checked;
    Settings.save();
    if (Settings.fanSync) {
      // re-push whatever palette is live right now (artwork or fixed indigo)
      fanPal.sent = false;
      const cs = getComputedStyle(document.documentElement);
      fanPush({ accent: cs.getPropertyValue('--accent').trim(), accent2: cs.getPropertyValue('--accent2').trim() });
    } else {
      fanDisable();
    }
  });

  // audio source picker
  window.auralis.audioSources().then((srcs) => {
    const sel = $('#set-source');
    for (const s of srcs) {
      const o = el('option', null, s.desc);
      o.value = s.name;
      sel.appendChild(o);
    }
    sel.value = Settings.source || '';
  });
  $('#set-source').addEventListener('change', (e) => {
    Settings.source = e.target.value;
    Settings.save();
    window.auralis.audioSetSource(Settings.source || null);
  });
  $('#btn-show-player').addEventListener('click', () => showWebview());

  // audio capture
  window.auralis.audioStart();

  // search
  wireSearch();

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') Apple.seek(State.time + 10);
    else if (e.key === 'ArrowLeft') Apple.seek(Math.max(0, State.time - 10));
    else if (e.key === 'v' || e.key === 'V') cycleViz();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'l' || e.key === 'L') { setView('now'); showNowTab('lyrics'); }
    else if (e.key === 'Escape') {
      if (document.body.classList.contains('fullscreen')) toggleFullscreen();
      else if (State.webviewShown) hideWebview();
    }
  });

  setView('signin');

  // wait for MusicKit, then start polling
  const ok = await Apple.waitReady();
  if (!ok) {
    $('#signin-hint').textContent = 'Could not reach the Apple Music player. Check your internet connection and restart Auralis.';
    $('#signin-hint').classList.remove('hidden');
    return;
  }
  setInterval(async () => {
    try {
      const s = JSON.parse(await Apple.exec(STATE_JS));
      if (s.needTap) { await Apple.exec(TAP_JS); return; }
      handleState(s);
    } catch {}
  }, 500);
  showWebview(); // let the user sign in (hidden again once authorized)
}

function cycleViz() {
  const order = ['auto', 'spectrum', 'nebula', 'off'];
  Settings.viz = order[(order.indexOf(Settings.viz) + 1) % order.length];
  Settings.save();
  $('#set-viz').value = Settings.viz;
  applySettings();
  toast('Visualizer: ' + Settings.viz);
}

window.addEventListener('DOMContentLoaded', init);
