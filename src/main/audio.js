'use strict';
// Captures the system audio output (the monitor/source of the default sink)
// with `parec` and streams PCM chunks to the renderer for the visualizer.
const { spawn, execFile } = require('child_process');

class AudioCapture {
  constructor(win) {
    this.win = win;
    this.proc = null;
    this.source = null;      // explicit user choice
    this.autoSource = null;  // resolved default sink monitor
    this.pollTimer = null;
    this._acc = [];
    this._accLen = 0;
    this._lastSend = 0;
    this.paused = false;
  }

  _exec(args) {
    return new Promise((resolve) => {
      execFile('pactl', args, { timeout: 3000 }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });
  }

  async defaultSource() {
    const sink = await this._exec(['get-default-sink']);
    return sink ? sink.trim() + '.monitor' : null;
  }

  async listSources() {
    const out = await this._exec(['list', 'short']);
    if (!out) return [];
    return out
      .split('\n')
      .filter((l) => l.includes('.monitor'))
      .map((l) => {
        const [name, , , desc] = l.split('\t');
        return { name, desc: (desc || name).replace(/Monitor of /, '') };
      });
  }

  async useSource(src) {
    this.source = src || null;
    this._restart();
    return true;
  }

  setPaused(p) {
    this.paused = p;
  }

  _send(buf) {
    if (this.paused || !this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('audio:chunk', buf);
  }

  _spawn() {
    const src = this.source || this.autoSource;
    if (!src) return false;
    this._kill();
    try {
      this.proc = spawn('parec', [
        '--raw',
        `-d=${src}`,
        '--format=s16le',
        '--rate=44100',
        '--channels=2',
        '--latency-msec=60',
      ]);
      this.proc.stdout.on('data', (chunk) => {
        this._acc.push(chunk);
        this._accLen += chunk.length;
        const now = Date.now();
        // batch at ~25 ms so IPC traffic stays reasonable
        if (now - this._lastSend >= 25) {
          const buf = Buffer.concat(this._acc);
          if (buf.length) this._send(buf);
          this._acc = [];
          this._accLen = 0;
          this._lastSend = now;
        }
      });
      this.proc.on('error', () => {});
    } catch {
      return false;
    }
    return true;
  }

  _kill() {
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
  }

  _restart() {
    this._spawn();
  }

  async start() {
    this.autoSource = await this.defaultSource();
    this._spawn();
    this.pollTimer = setInterval(async () => {
      const cur = await this.defaultSource();
      if (cur && cur !== this.autoSource && !this.source) {
        this.autoSource = cur;
        this._restart();
      }
    }, 5000);
    return !!this.autoSource;
  }

  stop() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this._kill();
  }
}

module.exports = AudioCapture;
