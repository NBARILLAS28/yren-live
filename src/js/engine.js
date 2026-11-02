// YREN LIVE — motor de audio
// Cada stem pasa por su propio SoundTouch (AudioWorklet) para cambiar tonalidad y tempo en tiempo real.
// Salidas: bus PRINCIPAL (sala) y bus MONITOR (click + guía para in-ears) hacia pares de canales de la interfaz USB.

import { SoundTouchNode } from '../vendor/SoundTouchNode.js';

const PROCESSOR_URL = new URL('../vendor/soundtouch-processor.js', import.meta.url).href;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_OUT_CHANNELS = 16;

/** Mide la latencia interna del worklet de SoundTouch (en segundos). */
async function measureLatency(sr) {
  try {
    const len = Math.ceil(sr * 0.8);
    const ctx = new OfflineAudioContext(2, len, sr);
    await SoundTouchNode.register(ctx, PROCESSOR_URL);
    const st = new SoundTouchNode({ context: ctx });
    st.pitch.value = 1; st.pitchSemitones.value = 0; st.playbackRate.value = 1;
    const b = ctx.createBuffer(2, len, sr);
    const at = Math.floor(sr * 0.1);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let j = 0; j < 64; j++) d[at + j] = Math.sin((j / 64) * Math.PI * 6) * 0.9 * (1 - j / 64);
    }
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(st); st.connect(ctx.destination); s.start(0);
    const out = await ctx.startRendering();
    const d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.2) return Math.max(0, (i - at) / sr);
  } catch (e) {
    console.warn('No se pudo medir la latencia, se usa el valor por defecto', e);
  }
  return 0.13;
}

export class Engine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.latency = 0.13;
    this.song = null;
    this.tracks = [];
    this.rate = 1;
    this.semis = 0;
    this.playing = false;
    this.anchor = { ctxTime: 0, pos: 0 }; // posición AUDIBLE: en ctxTime se oye `pos`
    this.pausedPos = 0;
    this.voice = null;
    this.pending = null;
    this.loop = null;
    this.out = { deviceId: 'default', mainPair: 0, monitorPair: 1, mode: 'pairs' };
    this.levels = { main: 1, monitor: 1, pad: 0.55 };
    this.pad = { on: false, root: 0, toMonitor: true, voice: null };
    this.outInfo = { channels: 2, mode: 'main-only', maxChannels: 2, warning: '' };
    this._timer = null;
    this._outNodes = [];
    this.fading = null; this.songOut = null; this.ghosts = null; this.nearEndSec = 0; this._nearFired = false;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ───────────────────────── inicialización y salidas ─────────────────────────

  async init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    await SoundTouchNode.register(ctx, PROCESSOR_URL);

    this.mainBus = ctx.createGain();
    this.monitorBus = ctx.createGain();
    this.mainBus.gain.value = this.levels.main;
    this.monitorBus.gain.value = this.levels.monitor;
    this.mainAn = this._analyser(); this.monAn = this._analyser();
    this.mainBus.connect(this.mainAn); this.monitorBus.connect(this.monAn);

    // Pad ambiental: va al bus principal y, opcionalmente, al monitor
    this.padGain = ctx.createGain();
    this.padGain.gain.value = this.levels.pad;
    this.padToMain = ctx.createGain();
    this.padToMon = ctx.createGain();
    this.padToMon.gain.value = this.pad.toMonitor ? 1 : 0;
    this.padGain.connect(this.padToMain); this.padGain.connect(this.padToMon);
    this.padToMain.connect(this.mainBus); this.padToMon.connect(this.monitorBus);
    this.padAn = this._analyser(); this.padGain.connect(this.padAn);

    await this._applySink();
    this.latency = await measureLatency(ctx.sampleRate);
    if (typeof ctx.addEventListener === 'function') {
      // Chrome avisa cuando la salida cambia sola (por ejemplo, al desconectar la interfaz USB)
      ctx.addEventListener('sinkchange', () => { if (!this._settingSink) this._emit('sinkchange', { sinkId: ctx.sinkId }); });
    }
    this._timer = setInterval(() => this._tick(), 25);
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* se reanuda al tocar play */ } }
  }

  _analyser() {
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0;
    return an;
  }

  async setOutput(opts) {
    Object.assign(this.out, opts);
    if (this.ctx) await this._applySink();
  }

  async _applySink() {
    const ctx = this.ctx;
    this._settingSink = true;
    if (typeof ctx.setSinkId === 'function') {
      try { await ctx.setSinkId(this.out.deviceId === 'default' ? '' : this.out.deviceId); }
      catch (e) {
        this._emit('warn', 'No se pudo usar esa salida de audio: ' + e.message);
        if (this.out.deviceId !== 'default') this._emit('sinkerror', { message: e.message });
      }
    }
    setTimeout(() => { this._settingSink = false; }, 400);
    this._buildOutput();
  }

  _buildOutput() {
    const ctx = this.ctx, dest = ctx.destination;
    for (const n of this._outNodes) { try { n.disconnect(); } catch { /* ya desconectado */ } }
    this._outNodes = [];
    try { this.mainBus.disconnect(); this.monitorBus.disconnect(); } catch { /* noop */ }
    this.mainBus.connect(this.mainAn); this.monitorBus.connect(this.monAn);

    const max = Math.max(2, dest.maxChannelCount || 2);
    const N = Math.min(max, MAX_OUT_CHANNELS);
    try {
      dest.channelCount = N;
      dest.channelCountMode = 'explicit';
      dest.channelInterpretation = 'discrete';
    } catch (e) { console.warn('channelCount', e); }

    let mode = this.out.mode;
    let warning = '';
    if (mode === 'pairs' && N < 4) { mode = 'main-only'; warning = 'Esta salida solo tiene 2 canales: no hay par separado para el monitor. Usa el modo “Dividido” o una interfaz con más salidas.'; }

    const sm = ctx.createChannelSplitter(2), so = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(N);
    mg.connect(dest);
    this.mainBus.connect(sm); this.monitorBus.connect(so);
    this._outNodes.push(sm, so, mg);

    if (mode === 'split') {
      // Monitor (mono) a la izquierda, Principal (mono) a la derecha
      const gMon = ctx.createGain(), gMain = ctx.createGain();
      gMon.gain.value = 0.5; gMain.gain.value = 0.5;
      so.connect(gMon, 0); so.connect(gMon, 1); gMon.connect(mg, 0, 0);
      sm.connect(gMain, 0); sm.connect(gMain, 1); gMain.connect(mg, 0, 1);
      this._outNodes.push(gMon, gMain);
    } else {
      const pairs = Math.floor(N / 2);
      const mp = clamp(this.out.mainPair, 0, pairs - 1);
      sm.connect(mg, 0, mp * 2); sm.connect(mg, 1, mp * 2 + 1);
      if (mode === 'pairs') {
        const op = clamp(this.out.monitorPair, 0, pairs - 1);
        so.connect(mg, 0, op * 2); so.connect(mg, 1, op * 2 + 1);
      }
    }
    this.outInfo = { channels: N, mode, maxChannels: max, warning };
    this._emit('output', this.outInfo);
  }

  getInfo() {
    return {
      ready: !!this.ctx,
      sampleRate: this.ctx ? this.ctx.sampleRate : 0,
      latencyMs: Math.round(this.latency * 1000),
      ...this.outInfo,
    };
  }

  async decode(blob) {
    await this.init();
    const buf = await blob.arrayBuffer();
    return this.toMonoIfDual(await this.ctx.decodeAudioData(buf));
  }

  /** Si los dos canales son idénticos (stem "estéreo" que en realidad es mono), guarda uno solo: mitad de memoria, mismo sonido. */
  toMonoIfDual(buf) {
    if (!buf || buf.numberOfChannels !== 2) return buf;
    const a = buf.getChannelData(0), b = buf.getChannelData(1);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return buf;
    const mono = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
    mono.getChannelData(0).set(a);
    return mono;
  }

  /** Memoria aproximada (bytes) que ocupa un AudioBuffer. */
  static bufferBytes(buf) { return buf ? buf.length * buf.numberOfChannels * 4 : 0; }

  // ───────────────────────── canción y pistas ─────────────────────────

  /** song: {id, duration, sections:[{id,name,start}], tracks:[{id,name,kind,route,transpose,vol,mute,solo}]}; buffers: Map(trackId→AudioBuffer)
   *  opts.fadeIn: segundos de entrada (transición suave entre canciones). */
  loadSong(song, buffers, opts = {}) {
    this.unload();
    const ctx = this.ctx;
    this.song = song;
    this.rate = 1; this.semis = 0; this.loop = null; this.pending = null; this._nearFired = false;
    // Ganancia por canción: permite fundido de salida y transición suave sin tocar los faders de las pistas
    const outMain = ctx.createGain(), outMon = ctx.createGain();
    outMain.connect(this.mainBus); outMon.connect(this.monitorBus);
    this.songOut = { main: outMain, mon: outMon };
    this.tracks = song.tracks.map((meta) => {
      const gain = ctx.createGain(), toMain = ctx.createGain(), toMon = ctx.createGain();
      const an = this._analyser();
      gain.connect(toMain); gain.connect(toMon); gain.connect(an);
      toMain.connect(outMain); toMon.connect(outMon);
      return { meta, buffer: buffers.get(meta.id) || null, gain, toMain, toMon, an };
    });
    this.refreshMix(true);
    if (opts.fadeIn > 0) this._rampSong(this.songOut, 0, 1, opts.fadeIn);
    this.pausedPos = 0; this.playing = false;
    this._emit('state');
  }

  /** Curva de potencia constante entre dos niveles (0↔1) para que la suma de dos canciones no cambie de volumen. */
  _rampSong(out, from, to, sec) {
    const now = this.ctx.currentTime, N = 48, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      curve[i] = from + (to - from) * (to > from ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2));
    }
    for (const g of [out.main.gain, out.mon.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(from, now);
      g.setValueCurveAtTime(curve, now, Math.max(0.05, sec));
    }
  }

  _resetSongOut() {
    if (!this.songOut || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const g of [this.songOut.main.gain, this.songOut.mon.gain]) { g.cancelScheduledValues(now); g.setValueAtTime(1, now); }
  }

  // ───────────────────────── fundido y transición ─────────────────────────

  /** Baja el volumen de la canción en `sec` segundos y la detiene (vuelve al inicio). */
  fadeOut(sec = 4) {
    if (!this.playing || !this.songOut || this.fading) return false;
    sec = clamp(sec, 0.5, 20);
    const out = this.songOut, now = this.ctx.currentTime;
    const cur = out.main.gain.value;
    for (const g of [out.main.gain, out.mon.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(cur, now);
      g.linearRampToValueAtTime(0, now + sec);
    }
    const id = (this._fadeId = (this._fadeId || 0) + 1);
    this.fading = { id, until: now + sec };
    this._fadeTimer = setTimeout(() => {
      if (!this.fading || this.fading.id !== id) return;
      this.fading = null;
      this.stop();
      this._resetSongOut();
      this._emit('fade', { on: false, done: true });
    }, sec * 1000 + 80);
    this._emit('fade', { on: true, sec });
    return true;
  }

  _cancelFade() {
    if (!this.fading) return;
    clearTimeout(this._fadeTimer);
    this.fading = null;
    this._resetSongOut();
    this._emit('fade', { on: false, done: false });
  }

  /** Separa la canción que suena para que se apague sola en `sec` segundos, y deja el motor libre para cargar la siguiente. */
  detachGhost(sec) {
    if (!this.ctx || !this.song || !this.playing) return false;
    const ctx = this.ctx;
    this._cancelFade();
    this._cancelPendingHard();
    const ghost = { voice: this.voice, tracks: this.tracks, out: this.songOut };
    this.voice = null; this.tracks = []; this.songOut = null; this.song = null; this.playing = false; this.loop = null;
    const now = ctx.currentTime;
    const cur = ghost.out.main.gain.value;
    const N = 48, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) curve[i] = cur * Math.cos((i / (N - 1)) * Math.PI / 2);
    for (const g of [ghost.out.main.gain, ghost.out.mon.gain]) {
      g.cancelScheduledValues(now); g.setValueAtTime(cur, now); g.setValueCurveAtTime(curve, now, Math.max(0.05, sec));
    }
    (this.ghosts || (this.ghosts = new Set())).add(ghost);
    setTimeout(() => {
      if (ghost.voice) this._killVoice(ghost.voice, 0, 0.02);
      setTimeout(() => {
        for (const t of ghost.tracks) for (const n of [t.gain, t.toMain, t.toMon, t.an]) { try { n.disconnect(); } catch { /* noop */ } }
        for (const g of [ghost.out.main, ghost.out.mon]) { try { g.disconnect(); } catch { /* noop */ } }
        this.ghosts.delete(ghost);
      }, 700);
    }, sec * 1000 + 120);
    this._emit('state');
    return true;
  }

  unload() {
    if (!this.ctx) return;
    this._cancelFade();
    this._cancelPendingHard();
    if (this.voice) { this._killVoice(this.voice, this.ctx.currentTime, 0.01); this.voice = null; }
    for (const t of this.tracks) {
      for (const n of [t.gain, t.toMain, t.toMon, t.an]) { try { n.disconnect(); } catch { /* noop */ } }
    }
    if (this.songOut) for (const g of [this.songOut.main, this.songOut.mon]) { try { g.disconnect(); } catch { /* noop */ } }
    this.songOut = null;
    this.tracks = []; this.song = null; this.playing = false; this.loop = null;
  }

  /** Recalcula ganancias (volumen/mute/solo/ruta) de todas las pistas. */
  refreshMix(immediate = false) {
    const anySolo = this.tracks.some((t) => t.meta.solo);
    const now = this.ctx.currentTime;
    for (const t of this.tracks) {
      const m = t.meta;
      const audible = !m.mute && (!anySolo || m.solo);
      const g = audible ? clamp(m.vol ?? 1, 0, 1.5) : 0;
      if (immediate) t.gain.gain.setValueAtTime(g, now);
      else t.gain.gain.setTargetAtTime(g, now, 0.012);
      t.toMain.gain.setValueAtTime(m.route === 'monitor' ? 0 : 1, now);
      t.toMon.gain.setValueAtTime(m.route === 'main' ? 0 : 1, now);
    }
  }

  setLevel(which, v) {
    this.levels[which] = v;
    if (!this.ctx) return;
    const node = which === 'main' ? this.mainBus : which === 'monitor' ? this.monitorBus : this.padGain;
    node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.012);
  }

  levelOf(kind, id) {
    let an = null;
    if (kind === 'main') an = this.mainAn;
    else if (kind === 'monitor') an = this.monAn;
    else if (kind === 'pad') an = this.padAn;
    else { const t = this.tracks.find((x) => x.meta.id === id); an = t && t.an; }
    if (!an) return 0;
    const buf = this._lvlBuf || (this._lvlBuf = new Float32Array(512));
    an.getFloatTimeDomainData(buf);
    let p = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
    return p;
  }

  // ───────────────────────── posición ─────────────────────────

  _posAt(t) {
    const a = this.anchor;
    let p = a.pos + Math.max(0, t - a.ctxTime) * this.rate;
    if (this.loop && p >= this.loop.end) {
      const len = this.loop.end - this.loop.start;
      p = this.loop.start + ((p - this.loop.start) % len);
    }
    return p;
  }

  getPosition() {
    if (!this.playing) return this.pausedPos;
    this._commitPendingIfDue();
    return Math.min(this._posAt(this.ctx.currentTime), this.song ? this.song.duration : Infinity);
  }

  getPending() { return this.pending ? { target: this.pending.target, A: this.pending.A } : null; }

  sectionIndexAt(pos) {
    const secs = this.song ? this.song.sections : [];
    let idx = -1;
    for (let i = 0; i < secs.length; i++) if (secs[i].start <= pos + 0.001) idx = i;
    return idx;
  }

  sectionEnd(i) {
    const secs = this.song.sections;
    return i + 1 < secs.length ? secs[i + 1].start : this.song.duration;
  }

  // ───────────────────────── voces (cadena de reproducción) ─────────────────────────

  _makeVoice(pos, when, loop = this.loop) {
    const ctx = this.ctx;
    const v = { items: [], timer: null };
    for (const t of this.tracks) {
      if (!t.buffer) continue;
      const st = new SoundTouchNode({ context: ctx });
      st.pitch.value = 1;
      st.pitchSemitones.value = t.meta.transpose ? this.semis : 0;
      st.playbackRate.value = this.rate;
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = this.rate;
      if (loop) { src.loop = true; src.loopStart = loop.start; src.loopEnd = loop.end; }
      const vg = ctx.createGain();
      vg.gain.value = 0;
      src.connect(st); st.connect(vg); vg.connect(t.gain);
      src.start(when, clamp(pos, 0, Math.max(0, t.buffer.duration - 0.001)));
      v.items.push({ t, src, st, vg });
    }
    return v;
  }

  _fadeIn(v, audibleAt) {
    const now = this.ctx.currentTime;
    for (const it of v.items) {
      const g = it.vg.gain;
      g.setValueAtTime(0, Math.max(now, audibleAt - 0.006));
      g.linearRampToValueAtTime(1, Math.max(now + 0.002, audibleAt + 0.004));
    }
  }

  _fadeOut(v, audibleAt, srcStop) {
    const now = this.ctx.currentTime;
    for (const it of v.items) {
      const g = it.vg.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(1, now);
      g.setValueAtTime(1, Math.max(now, audibleAt - 0.006));
      g.linearRampToValueAtTime(0, Math.max(now + 0.002, audibleAt + 0.004));
      try { it.src.stop(srcStop); } catch { /* ya detenido */ }
    }
    this._scheduleDispose(v, (Math.max(audibleAt, srcStop) - now) + 0.6);
  }

  /** Silencia YA una voz (pausa/parada). */
  _killVoice(v, _now, fade = 0.03) {
    const now = this.ctx.currentTime;
    for (const it of v.items) {
      const g = it.vg.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      try { it.src.stop(now); } catch { /* noop */ }
    }
    this._scheduleDispose(v, this.latency + fade + 0.5);
  }

  _scheduleDispose(v, seconds) {
    clearTimeout(v.timer);
    v.timer = setTimeout(() => {
      for (const it of v.items) {
        for (const n of [it.src, it.st, it.vg]) { try { n.disconnect(); } catch { /* noop */ } }
      }
      v.items = [];
    }, Math.max(50, seconds * 1000));
  }

  // ───────────────────────── transporte ─────────────────────────

  async play() {
    await this.init();
    if (!this.song || this.playing) return;
    const ctx = this.ctx;
    this._cancelFade();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* noop */ } }
    let pos = this.pausedPos;
    if (pos >= this.song.duration - 0.05) pos = 0;
    if (this.loop && pos >= this.loop.end) { this.loop = null; this._emit('loop'); }
    const when = ctx.currentTime + 0.05;
    this.voice = this._makeVoice(pos, when);
    this._fadeIn(this.voice, when + this.latency);
    this.anchor = { ctxTime: when + this.latency, pos };
    this.playing = true;
    this._emit('state');
  }

  pause() {
    if (!this.playing) return;
    if (this.fading) { clearTimeout(this._fadeTimer); this.fading = null; this._resetSongOut(); this._emit('fade', { on: false, done: false }); }
    const pos = this.getPosition();
    this._cancelPendingHard();
    if (this.voice) this._killVoice(this.voice);
    this.voice = null;
    this.playing = false;
    this.pausedPos = pos;
    this._emit('state');
  }

  stop() {
    if (this.playing) this.pause();
    if (this.loop) this.clearLoop();
    this.pausedPos = 0;
    this._emit('state');
  }

  seek(pos) {
    if (!this.song) return;
    pos = clamp(pos, 0, this.song.duration);
    if (pos < this.song.duration - (this.nearEndSec || 0) - 0.5) this._nearFired = false;
    if (this.loop && (pos < this.loop.start || pos >= this.loop.end)) this.clearLoop();
    if (!this.playing) { this.pausedPos = pos; this._emit('state'); return; }
    this._cancelPendingHard();
    const ctx = this.ctx, now = ctx.currentTime, when = now + 0.02, A = when + this.latency;
    const v = this._makeVoice(pos, when);
    this._fadeIn(v, A);
    if (this.voice) this._fadeOut(this.voice, A, when);
    this.voice = v;
    this.anchor = { ctxTime: A, pos };
    this._emit('state');
  }

  // ───────────────────────── tonalidad y tempo ─────────────────────────

  setTranspose(n) {
    n = clamp(Math.round(n), -12, 12);
    this.semis = n;
    for (const v of [this.voice, this.pending && this.pending.voice]) {
      if (!v) continue;
      for (const it of v.items) it.st.pitchSemitones.value = it.t.meta.transpose ? n : 0;
    }
    this._emit('state');
  }

  /** Aplica el flag "transponer" de una pista a las voces vivas (cuando se cambia en el mezclador). */
  refreshTrackPitch() {
    for (const v of [this.voice, this.pending && this.pending.voice]) {
      if (!v) continue;
      for (const it of v.items) it.st.pitchSemitones.value = it.t.meta.transpose ? this.semis : 0;
    }
  }

  setTempo(r) {
    r = clamp(r, 0.5, 1.5);
    if (this.ctx && this.playing) {
      // La posición audible sigue a la velocidad vieja hasta que el cambio llega a la salida (latencia)
      const tA = this.ctx.currentTime + this.latency;
      const pos = this._posAt(tA);
      this.anchor = { ctxTime: tA, pos };
    }
    this.rate = r;
    for (const v of [this.voice, this.pending && this.pending.voice]) {
      if (!v) continue;
      for (const it of v.items) { it.src.playbackRate.value = r; it.st.playbackRate.value = r; }
    }
    if (this.pending && this.ctx) this._rescheduleAfterTempo();
    this._emit('state');
  }

  _rescheduleAfterTempo() {
    // Si hay un salto en cola, el instante de la frontera cambió: se recalcula.
    const target = this.pending.target;
    if (this.cancelPending()) this.queueJump(target);
  }

  // ───────────────────────── bucle y saltos ─────────────────────────

  setLoop(start, end) {
    if (!this.song || end - start < 0.2) return false;
    if (this.playing) {
      const ctx = this.ctx;
      const srcPos = this._posAt(ctx.currentTime + this.latency);
      if (srcPos >= end - 0.03 || srcPos < start) return false; // ya pasó el final del bucle en el lado "fuente"
    }
    this.loop = { start, end };
    for (const v of [this.voice, this.pending && this.pending.voice]) {
      if (!v) continue;
      for (const it of v.items) { it.src.loop = true; it.src.loopStart = start; it.src.loopEnd = end; }
    }
    this._emit('loop');
    return true;
  }

  clearLoop() {
    if (!this.loop) return;
    if (this.playing) {
      const tA = this.ctx.currentTime + this.latency;
      const pos = this._posAt(tA);
      this.anchor = { ctxTime: tA, pos };
    }
    this.loop = null;
    for (const v of [this.voice, this.pending && this.pending.voice]) {
      if (!v) continue;
      for (const it of v.items) it.src.loop = false;
    }
    this._emit('loop');
  }

  /** Salta a la sección `index` justo cuando termina la sección actual (sin cortes). */
  queueJump(index) {
    const secs = this.song ? this.song.sections : [];
    const sec = secs[index];
    if (!sec) return;
    if (!this.playing) { this.seek(sec.start); return; }
    const ctx = this.ctx, now = ctx.currentTime;
    this._commitPendingIfDue();
    const pos = this.getPosition();
    const cur = this.sectionIndexAt(pos);
    const end = this.loop ? this.loop.end : this.sectionEnd(Math.max(0, cur));
    const A = now + (end - pos) / this.rate; // instante AUDIBLE en que se llega al final
    const when = A - this.latency; // instante en el lado "fuente"
    if (when - now < 0.06) { this.seek(sec.start); return; }

    if (this.pending && !this.cancelPending()) return; // ya es demasiado tarde para cambiar el destino
    const v = this._makeVoice(sec.start, when, null);
    this._fadeIn(v, A);
    const old = this.voice;
    this._fadeOutOldAtBoundary(old, A, when);
    this.pending = { voice: v, A, when, target: index, anchor: { ctxTime: A, pos: sec.start }, old };
    this._emit('pending');
  }

  _fadeOutOldAtBoundary(old, A, when) {
    if (!old) return;
    const now = this.ctx.currentTime;
    for (const it of old.items) {
      const g = it.vg.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(1, now);
      g.setValueAtTime(1, Math.max(now, A - 0.006));
      g.linearRampToValueAtTime(0, Math.max(now + 0.002, A + 0.004));
      try { it.src.stop(when); } catch { /* noop */ }
    }
    this._scheduleDispose(old, (A - now) + 0.6);
  }

  /** Cancela el salto en cola si todavía hay tiempo. Devuelve true si se canceló. */
  cancelPending() {
    if (!this.pending) return false;
    const now = this.ctx.currentTime;
    if (now >= this.pending.when - 0.03) return false; // demasiado tarde
    const { voice, old } = this.pending;
    this._killVoice(voice);
    if (old) {
      clearTimeout(old.timer);
      for (const it of old.items) {
        try { it.src.stop(now + 3600); } catch { /* noop */ }
        const g = it.vg.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(1, now);
      }
    }
    this.pending = null;
    this._emit('pending');
    return true;
  }

  _cancelPendingHard() {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this._killVoice(p.voice);
    if (p.old) this._killVoice(p.old);
    this._emit('pending');
  }

  _commitPendingIfDue() {
    const p = this.pending;
    if (!p || this.ctx.currentTime < p.A) return;
    this.anchor = p.anchor;
    this.voice = p.voice;
    this.pending = null;
    if (this.loop) { this.loop = null; this._emit('loop'); }
    this._emit('jumped', { index: p.target });
    this._emit('pending');
  }

  _tick() {
    if (!this.ctx || !this.song) return;
    this._commitPendingIfDue();
    if (this.playing && !this.pending) {
      const pos = this._posAt(this.ctx.currentTime);
      if (this.nearEndSec > 0 && !this._nearFired && !this.loop && pos >= this.song.duration - this.nearEndSec) {
        this._nearFired = true;
        this._emit('nearend', { remaining: this.song.duration - pos });
      }
      if (pos >= this.song.duration - 0.01) {
        this.pause();
        this.pausedPos = 0;
        this._emit('state');
        this._emit('ended');
      }
    }
  }

  // ───────────────────────── tono de prueba ─────────────────────────

  /** Emite un tono grave por la izquierda y uno agudo por la derecha en la mezcla indicada ('main' | 'monitor'). */
  async testTone(which = 'main') {
    await this.init();
    const ctx = this.ctx;
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* noop */ } }
    const bus = which === 'monitor' ? this.monitorBus : this.mainBus;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);
    const t0 = ctx.currentTime + 0.08;
    const beeps = [[-1, 330, 0], [1, 495, 0.95]];
    for (const [pan, freq, off] of beeps) {
      const o = ctx.createOscillator(), p = ctx.createStereoPanner();
      o.frequency.value = freq; p.pan.value = pan;
      o.connect(p); p.connect(out);
      const a = t0 + off;
      out.gain.setValueAtTime(0, a);
      out.gain.linearRampToValueAtTime(0.2, a + 0.03);
      out.gain.setValueAtTime(0.2, a + 0.7);
      out.gain.linearRampToValueAtTime(0, a + 0.76);
      o.start(a); o.stop(a + 0.8);
    }
    const total = 0.95 + 0.85;
    this._emit('test', { which, on: true });
    await new Promise((r) => setTimeout(r, total * 1000 + 150));
    try { out.disconnect(); } catch { /* noop */ }
    this._emit('test', { which, on: false });
  }

  // ───────────────────────── pad ambiental ─────────────────────────

  padSet({ on, root, toMonitor }) {
    if (toMonitor !== undefined) {
      this.pad.toMonitor = toMonitor;
      if (this.ctx) this.padToMon.gain.setTargetAtTime(toMonitor ? 1 : 0, this.ctx.currentTime, 0.02);
    }
    const rootChanged = root !== undefined && root !== this.pad.root;
    if (root !== undefined) this.pad.root = root;
    if (on !== undefined) this.pad.on = on;
    if (!this.ctx) return;
    if (!this.pad.on) { this._padStop(); return; }
    if (!this.pad.voice || rootChanged) { this._padStop(); this._padStart(this.pad.root); }
  }

  _padStart(root) {
    const ctx = this.ctx, now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 780; lp.Q.value = 0.5;
    lp.connect(out); out.connect(this.padGain);
    const base = 130.8128 * Math.pow(2, root / 12); // do3 + raíz
    const parts = [[0.5, 'sine', 0.5], [1, 'triangle', 0.42], [1.5, 'triangle', 0.3], [2, 'sine', 0.28]];
    const oscs = [];
    for (const [mult, type, amp] of parts) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = base * mult; o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = amp / 2;
        o.connect(g); g.connect(lp); o.start(now);
        oscs.push(o);
      }
    }
    this.pad.voice = { out, lp, oscs };
  }

  _padStop() {
    const v = this.pad.voice;
    if (!v) return;
    this.pad.voice = null;
    const now = this.ctx.currentTime;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + 2.5);
    for (const o of v.oscs) { try { o.stop(now + 2.7); } catch { /* noop */ } }
    setTimeout(() => { try { v.out.disconnect(); v.lp.disconnect(); } catch { /* noop */ } }, 3000);
  }
}
