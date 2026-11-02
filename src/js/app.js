// YREN LIVE — interfaz y lógica de la aplicación
import { Engine } from './engine.js';
import { store, requestPersistence } from './store.js';
import * as U from './util.js';
import * as Backup from './backup.js';

const $ = (id) => document.getElementById(id);
const engine = new Engine();
window.__yren = { engine }; // útil para depurar y para las pruebas automáticas (se completa más abajo)

// ───────────────────────── estado ─────────────────────────
const state = {
  songs: new Map(),
  setlists: [],
  slId: null,
  idx: -1,
  loadedSongId: null,
  loadToken: 0,
  cache: new Map(), // songId → Map(trackId → AudioBuffer)
  padOn: false,
  devices: [],
  settings: {
    deviceId: 'default', mode: 'pairs', mainPair: 0, monitorPair: 1,
    jumpMode: 'end', autoNext: false, padMon: true, padFollow: true, padVol: 55, padRoot: 0,
    mainVol: 100, monVol: 100, live: false, deviceLabel: '',
    fadeSec: 4, crossSec: 0, memBudgetMB: 1500, lastBackup: 0, backupSnooze: 0,
  },
  outLost: false,
  inflight: new Map(), // songId → promesa de decodificación en curso
  crossing: false,
  preloadRun: 0,
};

const currentSetlist = () => state.setlists.find((s) => s.id === state.slId) || null;
const currentItem = () => { const sl = currentSetlist(); return sl && state.idx >= 0 ? sl.items[state.idx] || null : null; };
const currentSong = () => { const it = currentItem(); return it ? state.songs.get(it.songId) || null : null; };

// ───────────────────────── utilidades de UI ─────────────────────────
let toastTimer = null;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 5000 : 2600);
}
function showLoading(text, frac) {
  const el = $('loading');
  if (text == null) { el.hidden = true; $('loadingBarWrap').hidden = true; return; }
  $('loadingText').textContent = text;
  const w = $('loadingBarWrap');
  if (frac == null) w.hidden = true;
  else { w.hidden = false; $('loadingBar').style.width = Math.round(U.clamp(frac, 0, 1) * 100) + '%'; }
  el.hidden = false;
}
function askText(title, value = '', okLabel = 'Aceptar') {
  return new Promise((resolve) => {
    const dlg = $('dlgText');
    $('txtTitle').textContent = title;
    $('txtInput').value = value;
    $('txtOk').textContent = okLabel;
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok' ? $('txtInput').value.trim() : null); };
    dlg.addEventListener('close', done);
    dlg.showModal();
    $('txtInput').focus(); $('txtInput').select();
  });
}
function askConfirm(title, text, okLabel = 'Aceptar') {
  return new Promise((resolve) => {
    const dlg = $('dlgConfirm');
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfOk').textContent = okLabel;
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); };
    dlg.addEventListener('close', done);
    dlg.showModal();
  });
}
const anyDialogOpen = () => !!document.querySelector('dialog[open]');

// ───────────────────────── persistencia ─────────────────────────
const timers = new Map();
function debounce(key, fn, ms = 400) { clearTimeout(timers.get(key)); timers.set(key, setTimeout(fn, ms)); }
const songForSave = (s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, solo: false })) });
const saveSongSoon = (song) => debounce('song:' + song.id, () => store.put('songs', songForSave(song)));
const saveSetlistSoon = () => { const sl = currentSetlist(); if (sl) debounce('sl:' + sl.id, () => store.put('setlists', sl)); };
const saveSettingsSoon = () => debounce('settings', () => store.setSetting('settings', state.settings));

async function loadAll() {
  const [songs, setlists, settings, slId] = await Promise.all([
    store.getAll('songs'), store.getAll('setlists'), store.getSetting('settings'), store.getSetting('currentSetlist'),
  ]);
  for (const s of songs) { s.tracks.forEach((t) => (t.solo = false)); state.songs.set(s.id, s); }
  state.setlists = setlists.sort((a, b) => (a.created || 0) - (b.created || 0));
  Object.assign(state.settings, settings || {});
  state.slId = state.setlists.find((s) => s.id === slId) ? slId : state.setlists[0] ? state.setlists[0].id : null;
}

// ───────────────────────── picos de la onda ─────────────────────────
function computePeaks(tracks, buffers, bins = 1400) {
  const music = tracks.filter((t) => t.kind === 'music');
  const use = (music.length ? music : tracks).filter((t) => buffers.get(t.id));
  const energy = new Float64Array(bins);
  let duration = 0;
  for (const t of use) duration = Math.max(duration, buffers.get(t.id).duration);
  for (const t of use) {
    const buf = buffers.get(t.id);
    const ch = buf.getChannelData(0);
    const per = ch.length / bins;
    const step = Math.max(1, Math.floor(per / 160));
    for (let b = 0; b < bins; b++) {
      const a = Math.floor(b * per), z = Math.min(ch.length, Math.floor((b + 1) * per));
      let s = 0, n = 0;
      for (let i = a; i < z; i += step) { s += ch[i] * ch[i]; n++; }
      energy[b] += n ? s / n : 0;
    }
  }
  let max = 0;
  const out = new Array(bins);
  for (let b = 0; b < bins; b++) { out[b] = Math.sqrt(energy[b]); if (out[b] > max) max = out[b]; }
  return out.map((v) => +(max ? Math.pow(v / max, 0.8) : 0).toFixed(3));
}

// ───────────────────────── importar canciones ─────────────────────────
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const isAudio = (f) => U.AUDIO_EXT.test(f.name) || (f.type || '').startsWith('audio/');

async function importFiles(fileList, titleHint) {
  const files = [...fileList].filter(isAudio).sort(natural);
  if (!files.length) { toast('No encontré archivos de audio en esa selección', true); return; }
  try {
    showLoading('Preparando el motor de audio…');
    await engine.init();
    const songId = U.uid();
    const names = U.trackNames(files.map((f) => f.name));
    const tracks = [];
    const buffers = new Map();
    for (let i = 0; i < files.length; i++) {
      showLoading(`Leyendo stems ${i + 1}/${files.length}: ${files[i].name}`);
      let buf;
      try { buf = await engine.decode(files[i]); }
      catch { toast(`No pude leer “${files[i].name}”. Lo omito.`, true); continue; }
      const g = U.guessTrack(files[i].name);
      const tr = { id: U.uid(), name: names[i], fileName: files[i].name, kind: g.kind, route: g.route, transpose: g.transpose, vol: 1, mute: false, solo: false };
      tracks.push(tr); buffers.set(tr.id, buf);
      await store.put('files', { blob: files[i], name: files[i].name, type: files[i].type }, store.fileKey(songId, tr.id));
    }
    if (!tracks.length) { showLoading(null); return; }
    showLoading('Dibujando la onda…');
    await new Promise((r) => setTimeout(r, 20));
    const duration = Math.max(...tracks.map((t) => buffers.get(t.id).duration));
    const song = {
      id: songId, title: titleHint || U.commonTitle(files.map((f) => f.name)), artist: '',
      key: { root: 0, minor: false }, bpm: 120, duration, sections: [], tracks,
      peaks: computePeaks(tracks, buffers), created: Date.now(),
    };
    state.songs.set(song.id, song);
    await store.put('songs', songForSave(song));
    state.cache.set(song.id, buffers);
    let sl = currentSetlist();
    if (!sl) sl = await createSetlist('Servicio');
    sl.items.push({ id: U.uid(), songId: song.id, transpose: 0, tempo: 100 });
    await store.put('setlists', sl);
    showLoading(null);
    renderSetlistSelect(); renderSongList();
    await selectItem(sl.items.length - 1);
    toast(`“${song.title}” lista · ${tracks.length} pistas`);
    openEdit(true);
  } catch (e) {
    console.error(e);
    showLoading(null);
    toast('No se pudo importar: ' + (e && e.message ? e.message : e), true);
  }
}

async function addStemsToSong(song, fileList) {
  const files = [...fileList].filter(isAudio).sort(natural);
  if (!files.length) return false;
  showLoading('Agregando pistas…');
  try {
    await engine.init();
    const bufs = await getBuffers(song);
    const names = U.trackNames(files.map((f) => f.name));
    for (let i = 0; i < files.length; i++) {
      showLoading(`Leyendo ${i + 1}/${files.length}: ${files[i].name}`);
      const buf = await engine.decode(files[i]);
      const g = U.guessTrack(files[i].name);
      const tr = { id: U.uid(), name: names[i], fileName: files[i].name, kind: g.kind, route: g.route, transpose: g.transpose, vol: 1, mute: false, solo: false };
      song.tracks.push(tr); bufs.set(tr.id, buf);
      await store.put('files', { blob: files[i], name: files[i].name, type: files[i].type }, store.fileKey(song.id, tr.id));
    }
    song.duration = Math.max(...song.tracks.map((t) => (bufs.get(t.id) ? bufs.get(t.id).duration : 0)));
    song.peaks = computePeaks(song.tracks, bufs);
    await store.put('songs', songForSave(song));
    return true;
  } finally { showLoading(null); }
}

async function collectDropped(dt) {
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) { await new Promise((res) => entry.file((f) => { out.push(f); res(); }, res)); }
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => new Promise((res) => reader.readEntries(res, () => res([])));
      let batch;
      do { batch = await readAll(); for (const e of batch) await walk(e); } while (batch.length);
    }
  };
  const entries = [];
  if (dt.items) for (const it of dt.items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) entries.push(e); }
  if (entries.length) { for (const e of entries) await walk(e); return out; }
  return [...dt.files];
}

// ───────────────────────── buffers (decodificados) ─────────────────────────
const DECODE_PARALLEL = 3;

async function getBuffers(song, onProgress) {
  const running = state.inflight.get(song.id);
  if (running) { try { await running; } catch { /* se reintenta abajo */ } }
  let bufs = state.cache.get(song.id);
  if (!bufs) { bufs = new Map(); state.cache.set(song.id, bufs); }
  const todo = song.tracks.filter((t) => !bufs.has(t.id));
  if (!todo.length) return bufs;
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++];
      try {
        const rec = await store.get('files', store.fileKey(song.id, t.id));
        if (!rec) toast(`Falta el archivo de la pista “${t.name}”`, true);
        else bufs.set(t.id, await engine.decode(rec.blob));
      } finally { done++; if (onProgress) onProgress(done, todo.length); }
    }
  };
  const p = Promise.all(Array.from({ length: Math.min(DECODE_PARALLEL, todo.length) }, worker));
  state.inflight.set(song.id, p);
  try { await p; } finally { if (state.inflight.get(song.id) === p) state.inflight.delete(song.id); }
  return bufs;
}

const songLoaded = (song) => { const b = state.cache.get(song.id); return !!b && song.tracks.every((t) => b.has(t.id)); };
const songBytes = (id) => { const m = state.cache.get(id); let n = 0; if (m) for (const b of m.values()) n += Engine.bufferBytes(b); return n; };
const cacheBytes = () => { let n = 0; for (const id of state.cache.keys()) n += songBytes(id); return n; };
/** Estimación (por exceso) de lo que ocupará una canción en memoria si aún no se ha cargado. */
function estSongBytes(song) {
  if (songLoaded(song)) return songBytes(song.id);
  const sr = engine.ctx ? engine.ctx.sampleRate : 48000;
  return Math.round((song.duration || 240) * sr * 4 * 2 * song.tracks.length);
}

function renderMem() {
  const el = $('memInfo');
  if (!el) return;
  const used = cacheBytes(), budget = state.settings.memBudgetMB * 1048576;
  const loaded = [...state.songs.values()].filter(songLoaded).length;
  el.textContent = state.cache.size ? `En memoria: ${Math.round(used / 1048576)} MB de ${state.settings.memBudgetMB} MB · ${loaded} lista${loaded === 1 ? '' : 's'}` : '';
  el.classList.toggle('high', used > budget * 0.85);
}

function pruneCache(keepIds) {
  for (const id of [...state.cache.keys()]) if (!keepIds.has(id)) state.cache.delete(id);
  renderMem();
}

/** Decide qué canciones del setlist caben en la memoria disponible, libera el resto y precarga en orden las que faltan. */
function planPreload() {
  const sl = currentSetlist();
  const keep = new Set(), order = [];
  if (!sl) return { keep, order };
  const budget = state.settings.memBudgetMB * 1048576;
  let used = 0;
  const consider = (item, force) => {
    const song = item && state.songs.get(item.songId);
    if (!song || keep.has(song.id)) return true;
    const b = estSongBytes(song);
    if (!force && used + b > budget) return false;
    keep.add(song.id); used += b;
    if (!songLoaded(song)) order.push(song);
    return true;
  };
  const cur = currentItem();
  if (cur) consider(cur, true);
  for (let i = state.idx + 1; i < sl.items.length; i++) if (!consider(sl.items[i], false)) break;
  if (state.idx > 0) consider(sl.items[state.idx - 1], false);
  return { keep, order };
}

async function preloadSetlist() {
  const run = ++state.preloadRun;
  const { keep, order } = planPreload();
  pruneCache(keep);
  renderSongList();
  for (const song of order) {
    await new Promise((r) => setTimeout(r, 900));
    if (run !== state.preloadRun) return;
    try { await getBuffers(song); } catch (e) { console.warn('precarga', e); continue; }
    if (run !== state.preloadRun) return;
    renderSongList();
  }
}

// ───────────────────────── setlists ─────────────────────────
async function createSetlist(name) {
  const sl = { id: U.uid(), name, items: [], created: Date.now() };
  state.setlists.push(sl);
  state.slId = sl.id;
  state.idx = -1;
  await store.put('setlists', sl);
  await store.setSetting('currentSetlist', sl.id);
  return sl;
}

function renderSetlistSelect() {
  const sel = $('setlistSel');
  sel.innerHTML = '';
  for (const s of state.setlists) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); }
  if (!state.setlists.length) { const o = document.createElement('option'); o.textContent = '(sin setlists)'; sel.appendChild(o); }
  sel.value = state.slId || '';
  $('btnRenameSetlist').disabled = $('btnDelSetlist').disabled = !state.slId;
}

function itemInfo(item) {
  const song = state.songs.get(item.songId);
  if (!song) return null;
  const key = U.shiftKey(song.key, item.transpose || 0);
  return { song, key, shifted: (item.transpose || 0) !== 0, bpm: Math.round(song.bpm * (item.tempo || 100) / 100) };
}

function renderSongList() {
  const ol = $('songList');
  ol.innerHTML = '';
  const sl = currentSetlist();
  if (!sl || !sl.items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = 'Este setlist está vacío.<br>Agrega una canción con sus <b>stems</b> o elige una de la <b>Biblioteca</b>.';
    ol.appendChild(li);
    $('setlistTotal').textContent = '';
    return;
  }
  let total = 0;
  sl.items.forEach((item, i) => {
    const info = itemInfo(item);
    if (!info) return;
    total += info.song.duration || 0;
    const li = document.createElement('li');
    li.className = 'song-item' + (i === state.idx ? ' active' : '');
    li.innerHTML = `
      <div class="n">${i + 1}</div>
      <div><div class="t"></div><div class="s"></div></div>
      <div class="badges"><span class="badge ${info.shifted ? 'shifted' : ''}">${U.keyLabel(info.key)}</span>
        <span class="s">${info.bpm} bpm</span></div>`;
    li.querySelector('.t').textContent = info.song.title;
    li.querySelector('.s').textContent = (info.song.artist ? info.song.artist + ' · ' : '') + U.fmtTime(info.song.duration).replace(/\.\d$/, '');
    if (songLoaded(info.song)) {
      const ok = document.createElement('span');
      ok.className = 'rdy'; ok.textContent = '✓ lista'; ok.title = 'Ya está en memoria: suena sin esperas';
      li.querySelector('.s').appendChild(ok);
    }
    wireDrag(li, i);
    const mv = document.createElement('div');
    mv.className = 'mv';
    for (const [lbl, act, title] of [['▲', 'up', 'Subir'], ['▼', 'down', 'Bajar'], ['✕', 'del', 'Quitar del setlist']]) {
      const b = document.createElement('button');
      b.className = 'mini'; b.textContent = lbl; b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); moveItem(i, act); });
      mv.appendChild(b);
    }
    li.querySelector('.badges').appendChild(mv);
    li.addEventListener('click', () => selectItem(i));
    ol.appendChild(li);
  });
  $('setlistTotal').textContent = `${sl.items.length} · ${U.fmtTime(total).replace(/\.\d$/, '')}`;
  renderMem();
}

// Arrastrar canciones para cambiar el orden (bloqueado en modo en vivo)
let dragFrom = -1;
function clearDropMarks() { document.querySelectorAll('.song-item.drop-before, .song-item.drop-after, .song-item.dragging').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'dragging')); }
function wireDrag(li, i) {
  if (state.settings.live) return;
  li.draggable = true;
  li.addEventListener('dragstart', (e) => {
    dragFrom = i;
    e.dataTransfer.setData('text/yren-item', String(i));
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragover', (e) => {
    if (dragFrom < 0 || ![...e.dataTransfer.types].includes('text/yren-item')) return;
    e.preventDefault();
    const r = li.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    document.querySelectorAll('.song-item.drop-before, .song-item.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    li.classList.add(before ? 'drop-before' : 'drop-after');
  });
  li.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = li.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    let to = before ? i : i + 1;
    const from = dragFrom;
    if (from < to) to--;
    dragFrom = -1; clearDropMarks();
    reorderItem(from, to);
  });
  li.addEventListener('dragend', () => { dragFrom = -1; clearDropMarks(); });
}

async function reorderItem(from, to) {
  const sl = currentSetlist();
  if (!sl || from === to || from < 0 || to < 0 || from >= sl.items.length || to >= sl.items.length) return;
  const curId = currentItem() ? currentItem().id : null;
  const [it] = sl.items.splice(from, 1);
  sl.items.splice(to, 0, it);
  if (curId) state.idx = sl.items.findIndex((x) => x.id === curId);
  await store.put('setlists', sl);
  renderSongList();
  preloadSetlist();
}

async function duplicateSetlist() {
  const sl = currentSetlist();
  if (!sl) return;
  const name = await askText('Nombre de la copia', 'Copia de ' + sl.name, 'Duplicar');
  if (!name) return;
  engine.stop(); engine.unload(); state.loadedSongId = null;
  const copy = { id: U.uid(), name, items: sl.items.map((x) => ({ ...x, id: U.uid() })), created: Date.now() };
  state.setlists.push(copy);
  state.slId = copy.id; state.idx = -1;
  await store.put('setlists', copy);
  await store.setSetting('currentSetlist', copy.id);
  renderSetlistSelect(); renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  toast(`Setlist “${name}” creado con ${copy.items.length} canciones`);
  if (copy.items.length) await selectItem(0);
}

async function moveItem(i, act) {
  const sl = currentSetlist();
  if (!sl) return;
  if (act === 'del') {
    const info = itemInfo(sl.items[i]);
    if (!(await askConfirm('Quitar del setlist', `“${info ? info.song.title : 'Canción'}” seguirá en la biblioteca.`, 'Quitar'))) return;
    const wasCurrent = i === state.idx;
    sl.items.splice(i, 1);
    if (wasCurrent) { engine.unload(); state.loadedSongId = null; state.idx = -1; }
    else if (i < state.idx) state.idx--;
  } else {
    const j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sl.items.length) return;
    [sl.items[i], sl.items[j]] = [sl.items[j], sl.items[i]];
    if (state.idx === i) state.idx = j; else if (state.idx === j) state.idx = i;
  }
  await store.put('setlists', sl);
  renderSongList(); renderNow(); renderMixer(); renderSections();
  preloadSetlist();
}

// ───────────────────────── cargar / seleccionar ─────────────────────────
async function selectItem(i, opts = {}) {
  const sl = currentSetlist();
  if (!sl || !sl.items[i]) return;
  const item = sl.items[i];
  const song = state.songs.get(item.songId);
  if (!song) { toast('Esa canción ya no está en la biblioteca', true); return; }
  const token = ++state.loadToken;
  state.preloadRun++; // detiene una precarga en curso: esta carga tiene prioridad
  state.idx = i;
  renderSongList();
  const needsDecode = !songLoaded(song);
  if (needsDecode) showLoading(`Cargando “${song.title}”…`, 0);
  try {
    await engine.init();
    const bufs = await getBuffers(song, (d, t) => showLoading(`Cargando “${song.title}”… ${d}/${t} pistas`, d / t));
    if (token !== state.loadToken) return; // el usuario eligió otra
    song.tracks.forEach((t) => (t.solo = false));
    const cross = opts.cross > 0 && engine.playing ? opts.cross : 0;
    if (cross) engine.detachGhost(cross); // la canción que suena se apaga sola mientras entra la nueva
    engine.loadSong(song, bufs, { fadeIn: cross });
    engine.setTranspose(item.transpose || 0);
    engine.setTempo((item.tempo || 100) / 100);
    state.loadedSongId = song.id;
    showLoading(null);
    renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); syncPad(); dirtyWave = true;
    preloadSetlist();
    return true;
  } catch (e) {
    console.error(e);
    showLoading(null);
    toast('No se pudo cargar la canción: ' + (e && e.message ? e.message : e), true);
  }
}

function renderNow() {
  const song = currentSong();
  const item = currentItem();
  $('btnEdit').disabled = !song;
  if (!song) {
    $('nowTitle').textContent = 'Sin canción';
    $('nowArtist').textContent = 'Agrega una canción con sus stems para empezar';
    $('chipKey').textContent = '—'; $('chipBpm').textContent = '—'; $('timeTotal').textContent = U.fmtTime(0);
    return;
  }
  $('nowTitle').textContent = song.title;
  $('nowArtist').textContent = (song.artist || 'Sin artista') + ` · ${song.tracks.length} pistas`;
  $('timeTotal').textContent = U.fmtTime(song.duration);
  void item;
}

// ───────────────────────── tonalidad / tempo ─────────────────────────
function updateKeyTempoUI() {
  const song = currentSong(), item = currentItem();
  const sel = $('keySel');
  if (!song || !item) {
    $('keyBig').textContent = '—'; $('keyOrig').textContent = '—'; $('keySemis').textContent = '0 st';
    $('tempoVal').textContent = '100'; $('bpmVal').textContent = '—'; $('chipKey').textContent = '—'; $('chipBpm').textContent = '—';
    return;
  }
  const semis = item.transpose || 0;
  const cur = U.shiftKey(song.key, semis);
  $('keyBig').textContent = U.keyLabel(cur);
  $('chipKey').textContent = U.keyLabel(cur);
  $('keyOrig').textContent = U.keyLabel(song.key);
  $('keySemis').textContent = (semis > 0 ? '+' : '') + semis + ' st';
  sel.innerHTML = '';
  for (let r = 0; r < 12; r++) {
    const o = document.createElement('option');
    o.value = r; o.textContent = U.keyLabel({ root: r, minor: song.key.minor });
    sel.appendChild(o);
  }
  sel.value = cur.root;
  const tempo = item.tempo || 100;
  $('tempoVal').textContent = Math.round(tempo);
  $('tempoRange').value = tempo;
  const bpm = Math.round(song.bpm * tempo / 100 * 10) / 10;
  $('bpmVal').textContent = bpm;
  $('chipBpm').textContent = Math.round(bpm);
  renderSongList();
}

function setSemis(n) {
  const item = currentItem();
  if (!item) return;
  n = U.clamp(Math.round(n), -6, 6);
  item.transpose = n;
  engine.setTranspose(n);
  saveSetlistSoon();
  updateKeyTempoUI(); syncPad();
}
function setTempoPct(p) {
  const item = currentItem();
  if (!item) return;
  p = U.clamp(Math.round(p), 70, 130);
  item.tempo = p;
  engine.setTempo(p / 100);
  saveSetlistSoon();
  updateKeyTempoUI();
}

// ───────────────────────── pad ─────────────────────────
function padRootNow() {
  const song = currentSong(), item = currentItem();
  if (state.settings.padFollow && song && item) return U.shiftKey(song.key, item.transpose || 0).root;
  return state.settings.padRoot;
}
async function togglePad() { await engine.init(); state.padOn = !state.padOn; syncPad(); }
function syncPad() {
  const s = state.settings;
  const root = padRootNow();
  $('padToggle').textContent = state.padOn ? 'PAD encendido' : 'PAD apagado';
  $('padToggle').classList.toggle('on', state.padOn);
  $('padKeyLabel').textContent = U.keyLabel({ root, minor: false });
  $('padRoot').value = s.padFollow ? root : s.padRoot;
  $('padRoot').disabled = s.padFollow;
  $('padFollow').checked = s.padFollow; $('padMon').checked = s.padMon; $('padVol').value = s.padVol;
  if (engine.ctx) { engine.setLevel('pad', s.padVol / 100); engine.padSet({ on: state.padOn, root, toMonitor: s.padMon }); }
}

// ───────────────────────── mezclador ─────────────────────────
const KIND_LABEL = { music: 'Música', click: 'Click', guide: 'Guía' };
const dbText = (v) => (v <= 0.0005 ? '−∞' : (20 * Math.log10(v)).toFixed(1)) + ' dB';
const meterEls = new Map(); // key → <i>

function renderMixer() {
  const box = $('strips');
  box.innerHTML = '';
  meterEls.clear();
  const song = currentSong();
  if (!song) return;
  for (const t of song.tracks) box.appendChild(trackStrip(song, t));
  box.appendChild(masterStrip('main', 'PRINCIPAL', 'Sala', 'mainVol'));
  box.appendChild(masterStrip('monitor', 'MONITOR', 'In-ears', 'monVol'));
  refreshStripStates();
}

function trackStrip(song, t) {
  const el = document.createElement('div');
  el.className = 'strip'; el.dataset.id = t.id;
  el.innerHTML = `
    <div class="kind">${KIND_LABEL[t.kind] || ''}</div>
    <div class="nm"></div>
    <div class="fader-wrap"><input type="range" class="fader" min="0" max="150" step="1"><div class="meter"><i></i></div></div>
    <div class="db"></div>
    <div class="btn-row">
      <button class="sbtn solo" title="Solo">S</button><button class="sbtn mute" title="Silenciar">M</button><button class="sbtn tr" title="Se transpone con la canción">♯</button>
    </div>
    <div class="route">
      <button data-r="main" title="Solo a la mezcla principal (sala)">PRIN</button>
      <button data-r="both" title="A principal y monitor">AMB</button>
      <button data-r="monitor" title="Solo al monitor (in-ears)">MON</button>
    </div>`;
  el.querySelector('.nm').textContent = t.name; el.querySelector('.nm').title = t.fileName || t.name;
  const fader = el.querySelector('.fader');
  fader.value = Math.round((t.vol ?? 1) * 100);
  const db = el.querySelector('.db');
  db.textContent = dbText(t.vol ?? 1);
  fader.addEventListener('input', () => { t.vol = fader.value / 100; db.textContent = dbText(t.vol); engine.refreshMix(); saveSongSoon(song); });
  fader.addEventListener('dblclick', () => { fader.value = 100; fader.dispatchEvent(new Event('input')); });
  const solo = el.querySelector('.solo'), mute = el.querySelector('.mute'), tr = el.querySelector('.tr');
  solo.addEventListener('click', () => { t.solo = !t.solo; engine.refreshMix(); refreshStripStates(); });
  mute.addEventListener('click', () => { t.mute = !t.mute; engine.refreshMix(); refreshStripStates(); saveSongSoon(song); });
  tr.addEventListener('click', () => { t.transpose = !t.transpose; engine.refreshTrackPitch(); refreshStripStates(); saveSongSoon(song); });
  el.querySelectorAll('.route button').forEach((b) => b.addEventListener('click', () => { t.route = b.dataset.r; engine.refreshMix(); refreshStripStates(); saveSongSoon(song); }));
  meterEls.set('t:' + t.id, el.querySelector('.meter i'));
  return el;
}

function masterStrip(which, title, sub, settingKey) {
  const el = document.createElement('div');
  el.className = 'strip master';
  el.innerHTML = `
    <div class="kind">${sub}</div><div class="nm">${title}</div>
    <div class="fader-wrap"><input type="range" class="fader" min="0" max="130" step="1"><div class="meter"><i></i></div></div>
    <div class="db"></div>`;
  const fader = el.querySelector('.fader'), db = el.querySelector('.db');
  fader.value = state.settings[settingKey];
  db.textContent = dbText(fader.value / 100);
  fader.addEventListener('input', () => { state.settings[settingKey] = +fader.value; db.textContent = dbText(fader.value / 100); engine.setLevel(which, fader.value / 100); saveSettingsSoon(); });
  fader.addEventListener('dblclick', () => { fader.value = 100; fader.dispatchEvent(new Event('input')); });
  meterEls.set('m:' + which, el.querySelector('.meter i'));
  return el;
}

function refreshStripStates() {
  const song = currentSong();
  if (!song) return;
  const anySolo = song.tracks.some((t) => t.solo);
  document.querySelectorAll('#strips .strip[data-id]').forEach((el) => {
    const t = song.tracks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    el.querySelector('.solo').classList.toggle('on', !!t.solo);
    el.querySelector('.mute').classList.toggle('on', !!t.mute);
    el.querySelector('.tr').classList.toggle('on', !!t.transpose);
    el.querySelectorAll('.route button').forEach((b) => b.classList.toggle('on', b.dataset.r === t.route));
    el.classList.toggle('dim', t.mute || (anySolo && !t.solo));
  });
}

function updateMeters() {
  if (!engine.ctx) return;
  for (const [key, el] of meterEls) {
    const [kind, id] = key.split(':');
    const p = engine.levelOf(kind === 't' ? 'track' : id, id);
    const db = p > 0.00001 ? 20 * Math.log10(p) : -90;
    el.style.height = U.clamp((db + 54) / 54, 0, 1) * 100 + '%';
  }
}

// ───────────────────────── secciones ─────────────────────────
function renderSections() {
  const box = $('secChips');
  box.innerHTML = '';
  const song = currentSong();
  if (!song) return;
  if (!song.sections.length) {
    const s = document.createElement('span');
    s.className = 'muted small'; s.textContent = 'Sin secciones todavía. Reproduce y toca “+ Sección aquí” en cada cambio (Intro, Verso, Coro…).';
    box.appendChild(s);
    return;
  }
  song.sections.forEach((sec, i) => {
    const b = document.createElement('button');
    b.className = 'sec-chip'; b.dataset.i = i;
    b.innerHTML = `<span></span><small>${U.fmtTime(sec.start).replace(/\.\d$/, '')}</small>`;
    b.firstChild.textContent = sec.name;
    b.addEventListener('click', () => onSectionClick(i));
    box.appendChild(b);
  });
  lastSecIdx = -2;
  updateSectionChips(true);
}

let lastSecIdx = -2, lastPending = null;
function updateSectionChips(force = false) {
  const song = currentSong();
  if (!song || !song.sections.length) return;
  const pos = engine.getPosition();
  const cur = engine.sectionIndexAt(pos);
  const pend = engine.getPending();
  const pt = pend ? pend.target : null;
  if (!force && cur === lastSecIdx && pt === lastPending) return;
  lastSecIdx = cur; lastPending = pt;
  document.querySelectorAll('#secChips .sec-chip').forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle('current', i === cur);
    el.classList.toggle('queued', i === pt);
  });
}

function onSectionClick(i) {
  const song = currentSong();
  if (!song) return;
  const sec = song.sections[i];
  if (!sec) return;
  const pend = engine.getPending();
  if (pend && pend.target === i && engine.cancelPending()) { toast('Salto cancelado'); return; }
  if (engine.playing && state.settings.jumpMode === 'end') engine.queueJump(i);
  else engine.seek(sec.start);
}

async function addSectionHere() {
  const song = currentSong();
  if (!song) return;
  const pos = engine.getPosition();
  const guess = ['Intro', 'Verso 1', 'Coro', 'Verso 2', 'Coro', 'Puente', 'Coro', 'Final'][song.sections.length] || 'Sección';
  const name = await askText(`Nueva sección en ${U.fmtTime(pos)}`, guess, 'Agregar');
  if (!name) return;
  song.sections.push({ id: U.uid(), name, start: Math.round(pos * 100) / 100 });
  song.sections.sort((a, b) => a.start - b.start);
  saveSongSoon(song);
  renderSections(); dirtyWave = true;
}

// ───────────────────────── onda ─────────────────────────
const canvas = $('wave');
const g2 = canvas.getContext('2d');
let dirtyWave = true, lastDrawPos = -1, cw = 0, ch = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  cw = Math.max(10, Math.floor(r.width)); ch = Math.max(10, Math.floor(r.height));
  canvas.width = Math.floor(cw * dpr); canvas.height = Math.floor(ch * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirtyWave = true;
}

function drawWave(pos) {
  const song = currentSong();
  g2.clearRect(0, 0, cw, ch);
  if (!song) {
    g2.fillStyle = '#7f95b6'; g2.font = '13px system-ui'; g2.textAlign = 'center';
    g2.fillText('La onda aparece aquí cuando cargues una canción', cw / 2, ch / 2);
    return;
  }
  const dur = song.duration || 1, peaks = song.peaks || [];
  const mid = ch / 2, px = (pos / dur) * cw;
  // bucle
  if (engine.loop) {
    g2.fillStyle = 'rgba(255,181,71,0.13)';
    g2.fillRect((engine.loop.start / dur) * cw, 0, ((engine.loop.end - engine.loop.start) / dur) * cw, ch);
  }
  // barras
  for (let x = 0; x < cw; x += 2) {
    const p = peaks[Math.min(peaks.length - 1, Math.floor((x / cw) * peaks.length))] || 0;
    const h = Math.max(1, p * mid * 0.9);
    g2.fillStyle = x < px ? '#19d3ff' : '#1b4f9c';
    g2.fillRect(x, mid - h, 1.4, h * 2);
  }
  // secciones
  g2.font = '600 11px system-ui'; g2.textAlign = 'left';
  song.sections.forEach((sec, i) => {
    const x = (sec.start / dur) * cw;
    g2.fillStyle = 'rgba(95,230,255,0.55)';
    g2.fillRect(x, 0, 1, ch);
    const pend = engine.getPending();
    g2.fillStyle = pend && pend.target === i ? '#ffb547' : '#9fb4d4';
    g2.fillText(sec.name, x + 4, 13);
  });
  // cabezal
  g2.fillStyle = '#ffffff';
  g2.shadowColor = '#19d3ff'; g2.shadowBlur = 8;
  g2.fillRect(Math.round(px) - 1, 0, 2, ch);
  g2.shadowBlur = 0;
}

canvas.addEventListener('click', (e) => {
  const song = currentSong();
  if (!song) return;
  const r = canvas.getBoundingClientRect();
  engine.seek(((e.clientX - r.left) / r.width) * song.duration);
  dirtyWave = true;
});

// ───────────────────────── bucle de animación ─────────────────────────
let lastCur = '', lastMeter = 0;
function frame(ts) {
  const song = currentSong();
  const pos = song ? engine.getPosition() : 0;
  const cur = U.fmtTime(pos);
  if (cur !== lastCur) { $('timeCur').textContent = cur; lastCur = cur; }
  if (dirtyWave || pos !== lastDrawPos) { drawWave(pos); lastDrawPos = pos; dirtyWave = false; }
  if (song) updateSectionChips();
  if (ts - lastMeter > 33) { updateMeters(); lastMeter = ts; }
  requestAnimationFrame(frame);
}

// ───────────────────────── transporte ─────────────────────────
function updateTransportUI() {
  const playing = engine.playing;
  if (window.yren && window.yren.setPlaying) window.yren.setPlaying(playing);
  $('btnPlay').textContent = playing ? '⏸' : '▶';
  $('btnPlay').classList.toggle('playing', playing);
  $('btnLoop').classList.toggle('on', !!engine.loop);
  dirtyWave = true;
}

async function togglePlay() {
  if (!currentSong()) { toast('Primero agrega o elige una canción'); return; }
  try {
    if (engine.playing) engine.pause(); else await playSafe();
  } catch (e) { console.error(e); toast('No se pudo reproducir: ' + e.message, true); }
}

function doFade() {
  if (!engine.playing) { toast('No hay nada sonando'); return; }
  if (!engine.fadeOut(state.settings.fadeSec)) toast('Ya se está haciendo el fundido');
}

function applyTransitions() {
  const s = state.settings;
  engine.nearEndSec = s.autoNext && s.crossSec > 0 ? s.crossSec : 0;
}

function toggleLoop() {
  const song = currentSong();
  if (!song) return;
  if (engine.loop) { engine.clearLoop(); return; }
  const pos = engine.getPosition();
  let start = 0, end = song.duration;
  if (song.sections.length) { const i = Math.max(0, engine.sectionIndexAt(pos)); start = song.sections[i].start; end = engine.sectionEnd(i); }
  if (!engine.setLoop(start, end)) toast('Estás muy cerca del final de la sección. Inténtalo de nuevo al inicio de la siguiente.');
}

function stepSection(dir) {
  const song = currentSong();
  if (!song || !song.sections.length) return;
  const pos = engine.getPosition();
  const cur = Math.max(0, engine.sectionIndexAt(pos));
  let target;
  if (dir > 0) target = cur + 1;
  else target = pos - song.sections[cur].start > 2 ? cur : cur - 1;
  if (target < 0) { engine.seek(0); return; }
  if (target >= song.sections.length) return;
  onSectionClick(target);
}

async function stepSong(dir) {
  const sl = currentSetlist();
  if (!sl) return;
  const j = state.idx + dir;
  if (j < 0 || j >= sl.items.length) return;
  engine.stop();
  await selectItem(j);
}

// ───────────────────────── editar canción ─────────────────────────
let editState = null;

function fmtEditTime(s) { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; }
function parseTime(str) {
  str = String(str).trim();
  if (!str) return NaN;
  if (str.includes(':')) { const [m, s] = str.split(':'); return (+m) * 60 + (+s); }
  return +str;
}

function openEdit(isNew = false) {
  const song = currentSong();
  if (!song) return;
  editState = {
    song,
    title: song.title, artist: song.artist || '', key: { ...song.key }, bpm: song.bpm,
    tracks: song.tracks.map((t) => ({ ...t })),
    sections: song.sections.map((s) => ({ ...s })),
    removed: [], added: false,
  };
  $('edTitle').value = song.title;
  $('edArtist').value = song.artist || '';
  const rootSel = $('edKeyRoot');
  rootSel.innerHTML = '';
  U.ROOT_OPTIONS.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; rootSel.appendChild(o); });
  rootSel.value = song.key.root;
  $('edKeyMinor').checked = !!song.key.minor;
  $('edBpm').value = song.bpm;
  $('edDur').value = U.fmtTime(song.duration);
  renderEditTracks(); renderEditSections();
  $('dlgEdit').showModal();
  if (isNew) $('edTitle').select();
}

function renderEditTracks() {
  const box = $('edTracks');
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'tr-row head';
  head.innerHTML = '<span>Nombre</span><span>Tipo</span><span>Salida</span><span>Transponer</span><span></span>';
  box.appendChild(head);
  editState.tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'tr-row';
    row.innerHTML = `
      <input type="text">
      <select class="k"><option value="music">Música</option><option value="click">Click</option><option value="guide">Guía</option></select>
      <select class="r"><option value="main">Principal (sala)</option><option value="monitor">Monitor (in-ears)</option><option value="both">Ambos</option></select>
      <label class="check"><input type="checkbox" class="tp"> ♯</label>
      <button type="button" class="mini" title="Quitar pista">✕</button>
      <div class="file"></div>`;
    const name = row.querySelector('input[type=text]');
    name.value = t.name; name.addEventListener('input', () => (t.name = name.value));
    const k = row.querySelector('.k'); k.value = t.kind;
    k.addEventListener('change', () => {
      t.kind = k.value;
      if (t.kind !== 'music') { t.route = 'monitor'; t.transpose = false; } else { t.route = 'main'; t.transpose = true; }
      renderEditTracks();
    });
    const r = row.querySelector('.r'); r.value = t.route; r.addEventListener('change', () => (t.route = r.value));
    const tp = row.querySelector('.tp'); tp.checked = !!t.transpose; tp.addEventListener('change', () => (t.transpose = tp.checked));
    row.querySelector('.mini').addEventListener('click', () => {
      if (editState.tracks.length <= 1) { toast('La canción necesita al menos una pista', true); return; }
      editState.removed.push(t.id); editState.tracks.splice(i, 1); renderEditTracks();
    });
    row.querySelector('.file').textContent = t.fileName || '';
    box.appendChild(row);
  });
  const add = document.createElement('div');
  add.className = 'row-btns';
  add.innerHTML = '<button type="button" class="btn ghost sm" id="edAddStems">+ Agregar más stems a esta canción</button>';
  box.appendChild(add);
  $('edAddStems').addEventListener('click', () => { $('stemsInput').value = ''; $('stemsInput').click(); });
}

function renderEditSections() {
  const box = $('edSections');
  box.innerHTML = '';
  if (!editState.sections.length) {
    box.innerHTML = '<span class="muted small">Sin secciones. También puedes marcarlas con “+ Sección aquí” mientras suena la canción.</span>';
    return;
  }
  editState.sections.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sec-row';
    row.innerHTML = '<input type="text" class="sn"><input type="text" class="st"><button type="button" class="mini" title="Quitar">✕</button>';
    const n = row.querySelector('.sn'); n.value = s.name; n.addEventListener('input', () => (s.name = n.value));
    const t = row.querySelector('.st'); t.value = fmtEditTime(s.start);
    t.addEventListener('change', () => { const v = parseTime(t.value); if (isFinite(v)) s.start = U.clamp(v, 0, editState.song.duration); t.value = fmtEditTime(s.start); });
    row.querySelector('.mini').addEventListener('click', () => { editState.sections.splice(i, 1); renderEditSections(); });
    box.appendChild(row);
  });
}

async function applyEdit() {
  const es = editState, song = es.song;
  song.title = $('edTitle').value.trim() || song.title;
  song.artist = $('edArtist').value.trim();
  song.key = { root: +$('edKeyRoot').value, minor: $('edKeyMinor').checked };
  song.bpm = U.clamp(+$('edBpm').value || song.bpm, 30, 260);
  // pistas: nombres, tipo, salida, transponer
  for (const t of es.tracks) {
    const real = song.tracks.find((x) => x.id === t.id);
    if (real) Object.assign(real, { name: t.name, kind: t.kind, route: t.route, transpose: t.transpose });
  }
  let reload = false;
  if (es.removed.length) {
    song.tracks = song.tracks.filter((t) => !es.removed.includes(t.id));
    for (const id of es.removed) { await store.del('files', store.fileKey(song.id, id)); const b = state.cache.get(song.id); if (b) b.delete(id); }
    const bufs = state.cache.get(song.id);
    if (bufs) { song.duration = Math.max(...song.tracks.map((t) => (bufs.get(t.id) ? bufs.get(t.id).duration : 0))); song.peaks = computePeaks(song.tracks, bufs); }
    reload = true;
  }
  song.sections = es.sections.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() })).sort((a, b) => a.start - b.start);
  if (es.added) reload = true;
  await store.put('songs', songForSave(song));
  if (reload) await selectItem(state.idx);
  else { engine.refreshMix(); engine.refreshTrackPitch(); }
  renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); syncPad(); renderSongList(); dirtyWave = true;
  toast('Canción guardada');
}

async function deleteSongFromLibrary() {
  const song = editState && editState.song;
  if (!song) return;
  if (!(await askConfirm('Eliminar canción', `“${song.title}” se borrará de la biblioteca y de todos los setlists, junto con sus archivos de audio.`, 'Eliminar'))) return;
  $('dlgEdit').close('cancel');
  engine.unload(); state.loadedSongId = null;
  for (const sl of state.setlists) { sl.items = sl.items.filter((i) => i.songId !== song.id); await store.put('setlists', sl); }
  state.songs.delete(song.id); state.cache.delete(song.id);
  await store.del('songs', song.id); await store.delFilesOfSong(song.id);
  state.idx = -1;
  renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  toast('Canción eliminada');
}

// ───────────────────────── biblioteca ─────────────────────────
function openLibrary() {
  const box = $('libList');
  box.innerHTML = '';
  const songs = [...state.songs.values()].sort((a, b) => a.title.localeCompare(b.title));
  if (!songs.length) box.innerHTML = '<div class="empty">La biblioteca está vacía.</div>';
  for (const s of songs) {
    const row = document.createElement('div');
    row.className = 'lib-item';
    row.innerHTML = '<div><div class="t"></div><div class="s"></div></div>';
    row.querySelector('.t').textContent = s.title;
    row.querySelector('.s').textContent = `${s.artist ? s.artist + ' · ' : ''}${U.keyLabel(s.key)} · ${s.bpm} bpm · ${s.tracks.length} pistas`;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm'; b.textContent = 'Agregar al setlist';
    b.addEventListener('click', async () => {
      let sl = currentSetlist();
      if (!sl) sl = await createSetlist('Servicio');
      sl.items.push({ id: U.uid(), songId: s.id, transpose: 0, tempo: 100 });
      await store.put('setlists', sl);
      renderSetlistSelect(); renderSongList();
      toast(`“${s.title}” agregada a ${sl.name}`);
    });
    row.appendChild(b);
    box.appendChild(row);
  }
  updateBackupInfo();
  $('dlgLibrary').showModal();
}

// ───────────────────────── respaldo ─────────────────────────
const DAY = 86400000;

function backupAgeText() {
  const last = state.settings.lastBackup;
  if (!last) return 'Todavía no has hecho ningún respaldo en este Mac.';
  const d = Math.floor((Date.now() - last) / DAY);
  return d <= 0 ? 'Último respaldo: hoy.' : `Último respaldo: hace ${d} día${d === 1 ? '' : 's'}.`;
}

function updateBackupInfo() {
  const el = $('backupInfo');
  if (el) el.textContent = backupAgeText() + ' Guarda todo (canciones, setlists y audios) en un solo archivo para no perderlo si cambias de Mac o se borran los datos de la app.';
}

/** ¿Toca recordar el respaldo? Nunca en modo en vivo. Sin respaldo previo: a los 2 días de tener canciones; después, cada 14 días. */
function backupDue() {
  const s = state.settings;
  if (s.live || !state.songs.size) return false;
  const now = Date.now();
  if (s.backupSnooze && now < s.backupSnooze) return false;
  if (s.lastBackup) return now - s.lastBackup > 14 * DAY;
  const oldest = Math.min(...[...state.songs.values()].map((x) => x.created || now));
  return now - oldest > 2 * DAY;
}

function checkBackupReminder() {
  const due = backupDue();
  $('backupBanner').hidden = !due;
  if (due) {
    const s = state.settings;
    $('backupBannerText').textContent = s.lastBackup
      ? `Tu último respaldo fue hace ${Math.floor((Date.now() - s.lastBackup) / DAY)} días.`
      : 'Todavía no tienes un respaldo de tus canciones.';
  }
  return due;
}

/** Espera a que Electron avise si la descarga se guardó o se canceló (en el navegador se da por buena). */
function waitDownloadResult() {
  if (!(window.yren && window.yren.onDownload)) return Promise.resolve({ state: 'completed' });
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ state: 'unknown' }), 15 * 60000);
    window.yren.onDownload((r) => { clearTimeout(t); resolve(r); });
  });
}

async function doBackup() {
  showLoading('Preparando el respaldo…');
  let built;
  try { built = await Backup.buildPack(U.APP_VERSION); }
  catch (e) { showLoading(null); toast('No se pudo preparar el respaldo: ' + e.message, true); return false; }
  showLoading(null);
  const waiting = waitDownloadResult();
  Backup.downloadBlob(built.blob, Backup.packFileName());
  const r = await waiting;
  if (r.state === 'completed' || r.state === 'unknown') {
    state.settings.lastBackup = Date.now(); state.settings.backupSnooze = 0;
    saveSettingsSoon(); updateBackupInfo(); checkBackupReminder();
    toast(`Respaldo guardado · ${built.counts.songs} canciones · ${(built.counts.bytes / 1048576).toFixed(0)} MB`);
    return true;
  }
  toast('El respaldo no se guardó (se canceló). Inténtalo de nuevo.', true);
  return false;
}

async function reloadAfterRestore() {
  engine.stop(); engine.unload(); state.loadedSongId = null;
  state.songs.clear(); state.cache.clear(); state.idx = -1; state.preloadRun++;
  await loadAll();
  renderSetlistSelect(); renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  const sl = currentSetlist();
  if (sl && sl.items.length) await selectItem(0);
}

async function restoreFromFile(file) {
  let pack;
  try { pack = await Backup.readPack(file); }
  catch (e) { toast(e.message, true); return false; }
  const h = pack.header;
  const when = new Date(h.created || 0).toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' });
  const ok = await askConfirm('Restaurar respaldo', `Respaldo del ${when}: ${h.songs.length} canciones, ${h.setlists.length} setlists. Lo que ya exista con el mismo nombre interno se reemplaza; lo demás se conserva.`, 'Restaurar');
  if (!ok) return false;
  const wasEmpty = !state.songs.size && !state.setlists.length;
  try {
    await importPack(pack);
  } catch (e) { showLoading(null); toast('No se pudo restaurar: ' + e.message, true); return false; }
  showLoading(null);
  if (wasEmpty && h.settings) { const keep = { ...h.settings }; delete keep.lastBackup; delete keep.backupSnooze; Object.assign(state.settings, keep); saveSettingsSoon(); applyLive(); applyTransitions(); }
  await reloadAfterRestore();
  toast(`Respaldo restaurado: ${h.songs.length} canciones`);
  return true;
}
async function importPack(pack) {
  return Backup.importPack(pack, (n, t) => showLoading(`Restaurando audios ${n}/${t}…`, n / t));
}

// ───────────────────────── salida de audio perdida ─────────────────────────
function showOutAlert(title, text) {
  $('alertTitle').textContent = title; $('alertText').textContent = text;
  $('outAlert').hidden = false;
}
function hideOutAlert() { $('outAlert').hidden = true; }

/** La interfaz elegida desapareció: pausa YA y bloquea la reproducción para que no suene por las bocinas del Mac. */
function outputLost() {
  if (state.outLost) return;
  state.outLost = true;
  if (engine.playing) engine.pause();
  const name = state.settings.deviceLabel || 'la interfaz de audio';
  showOutAlert('INTERFAZ DESCONECTADA', `No encuentro ${name}. Pausé la música para que no salga por las bocinas del Mac. Reconecta el cable o la interfaz y pulsa «Ya la reconecté», o elige usar la salida del Mac.`);
  updateOutPill();
}

async function outputRestored() {
  if (!state.outLost) return;
  const s = state.settings;
  state.outLost = false; hideOutAlert();
  try { await engine.setOutput({ deviceId: s.deviceId, mode: s.mode, mainPair: s.mainPair, monitorPair: s.monitorPair }); } catch { /* se avisa desde el motor */ }
  updateOutPill();
  toast('Interfaz reconectada. Pulsa reproducir cuando estés listo.');
}

function deviceMissing() {
  const id = state.settings.deviceId;
  if (id === 'default') return false;
  // Si el sistema no está entregando la lista de salidas, no se puede afirmar que falte: se confía en los avisos del motor.
  const listed = state.devices.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  if (!listed.length) return false;
  return !state.devices.some((d) => d.deviceId === id);
}

async function retryOutput() {
  await refreshDevices();
  if (!deviceMissing()) await outputRestored();
  else toast('Todavía no veo la interfaz. Revisa el cable y que esté encendida.', true);
}

async function useDefaultOutput() {
  const s = state.settings;
  s.deviceId = 'default'; s.deviceLabel = ''; saveSettingsSoon();
  state.outLost = false; hideOutAlert();
  await engine.setOutput({ deviceId: 'default', mode: s.mode, mainPair: s.mainPair, monitorPair: s.monitorPair });
  updateOutPill();
  toast('Usando la salida del Mac. El click y la guía no se oirán en ese modo.', true);
}

/** Todo lo que arranca reproducción pasa por aquí para respetar el bloqueo de salida. */
async function playSafe() {
  if (state.outLost) { showOutAlert('SALIDA DE AUDIO NO DISPONIBLE', 'La interfaz elegida no está conectada. Reconéctala o elige la salida del Mac para poder reproducir.'); return false; }
  await engine.play();
  return true;
}

// ───────────────────────── ajustes de audio ─────────────────────────
async function refreshDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    state.devices = all.filter((d) => d.kind === 'audiooutput');
  } catch { state.devices = []; }
}

function devLabel(id) {
  if (!id || id === 'default') return 'Salida predeterminada del sistema';
  const d = state.devices.find((x) => x.deviceId === id);
  return d && d.label ? d.label : 'Dispositivo seleccionado';
}

function populateSettings() {
  const sel = $('devSel');
  sel.innerHTML = '';
  const def = document.createElement('option'); def.value = 'default'; def.textContent = 'Salida predeterminada del sistema'; sel.appendChild(def);
  state.devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d, i) => {
    const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `Dispositivo ${i + 1} (nombre oculto)`; sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === state.settings.deviceId)) sel.value = state.settings.deviceId; else sel.value = 'default';
  $('modeSel').value = state.settings.mode;
  $('fadeSel').value = String(state.settings.fadeSec); $('crossSel').value = String(state.settings.crossSec); $('memSel').value = String(state.settings.memBudgetMB);
  const info = engine.getInfo();
  const pairs = Math.max(1, Math.floor((info.channels || 2) / 2));
  for (const id of ['mainPair', 'monPair']) {
    const s = $(id); s.innerHTML = '';
    for (let p = 0; p < pairs; p++) { const o = document.createElement('option'); o.value = p; o.textContent = `Salidas ${p * 2 + 1}-${p * 2 + 2}`; s.appendChild(o); }
  }
  $('mainPair').value = U.clamp(state.settings.mainPair, 0, pairs - 1);
  $('monPair').value = U.clamp(state.settings.monitorPair, 0, pairs - 1);
  $('pairsRow').style.display = state.settings.mode === 'pairs' ? '' : 'none';
  const w = $('outWarn');
  w.hidden = !info.warning; w.textContent = info.warning || '';
  $('devInfo').textContent = info.ready ? `${info.channels} canales · ${Math.round(info.sampleRate / 100) / 10} kHz · latencia interna ${info.latencyMs} ms` : '';
}

async function applyOutputSettings() {
  const s = state.settings;
  const deviceChanged = s.deviceId !== $('devSel').value;
  s.deviceId = $('devSel').value;
  s.deviceLabel = s.deviceId === 'default' ? '' : (state.devices.find((d) => d.deviceId === s.deviceId) || {}).label || s.deviceLabel || '';
  s.mode = $('modeSel').value;
  s.mainPair = +$('mainPair').value; s.monitorPair = +$('monPair').value;
  if (deviceChanged) { s.mainPair = 0; s.monitorPair = 1; } // propuesta típica: sala 1-2, monitor 3-4
  await engine.setOutput({ deviceId: s.deviceId, mode: s.mode, mainPair: s.mainPair, monitorPair: s.monitorPair });
  saveSettingsSoon();
  populateSettings(); updateOutPill();
}

function updateOutPill() {
  const info = engine.getInfo();
  const pill = $('outPill');
  if (!info.ready) { pill.textContent = 'Audio sin iniciar'; pill.className = 'status-pill warn'; return; }
  const name = devLabel(state.settings.deviceId).replace('Salida predeterminada del sistema', 'Predeterminada');
  const modeTxt = info.mode === 'pairs' ? `Sala ${state.settings.mainPair * 2 + 1}-${state.settings.mainPair * 2 + 2} · Mon ${state.settings.monitorPair * 2 + 1}-${state.settings.monitorPair * 2 + 2}` : info.mode === 'split' ? 'Dividido L=Mon R=Sala' : 'Solo principal';
  pill.textContent = `${name} · ${modeTxt}`;
  pill.title = `${info.channels} canales · ${info.latencyMs} ms de latencia interna`;
  pill.className = 'status-pill ' + (info.warning ? 'warn' : 'ok');
}

async function detectDeviceNames() {
  try {
    if (window.yren && window.yren.askMic) await window.yren.askMic();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) { toast('No se concedió el permiso. Puedes elegir el dispositivo sin nombre o activar el permiso en Ajustes del Sistema → Privacidad → Micrófono.', true); }
  await refreshDevices();
  populateSettings();
}

// ───────────────────────── eventos de la interfaz ─────────────────────────
function wire() {
  // diálogos: los botones "cancelar/cerrar" no deben enviar el formulario
  document.querySelectorAll('dialog button[value="cancel"], dialog button[value="close"]').forEach((b) => {
    b.type = 'button';
    b.addEventListener('click', () => b.closest('dialog').close(b.value));
  });

  // Tras usar un botón/deslizador/menú se quita el foco para que la barra espaciadora siempre sea Play/Pausa
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
  document.addEventListener('change', (e) => { const t = e.target; if (t && (t.type === 'range' || t.tagName === 'SELECT' || t.type === 'checkbox') && !t.closest('dialog')) t.blur(); });

  $('btnPlay').addEventListener('click', togglePlay);
  $('btnStop').addEventListener('click', () => engine.stop());
  $('btnPrev').addEventListener('click', () => { if (engine.getPosition() > 3) engine.seek(0); else stepSong(-1); });
  $('btnNext').addEventListener('click', () => stepSong(1));
  $('btnPrevSec').addEventListener('click', () => stepSection(-1));
  $('btnNextSec').addEventListener('click', () => stepSection(1));
  $('btnLoop').addEventListener('click', toggleLoop);
  $('btnAddSection').addEventListener('click', addSectionHere);
  $('btnEdit').addEventListener('click', () => openEdit(false));
  $('autoNext').addEventListener('change', (e) => { state.settings.autoNext = e.target.checked; applyTransitions(); saveSettingsSoon(); });
  $('btnFade').addEventListener('click', doFade);
  document.querySelectorAll('#jumpMode button').forEach((b) => b.addEventListener('click', () => {
    state.settings.jumpMode = b.dataset.mode; saveSettingsSoon(); syncJumpMode();
  }));

  $('keyDown').addEventListener('click', () => { const it = currentItem(); if (it) setSemis((it.transpose || 0) - 1); });
  $('keyUp').addEventListener('click', () => { const it = currentItem(); if (it) setSemis((it.transpose || 0) + 1); });
  $('keyReset').addEventListener('click', () => setSemis(0));
  $('keySel').addEventListener('change', (e) => { const song = currentSong(); if (song) setSemis(U.semisBetween(song.key.root, +e.target.value)); });
  $('tempoDown').addEventListener('click', () => { const it = currentItem(); if (it) setTempoPct((it.tempo || 100) - 1); });
  $('tempoUp').addEventListener('click', () => { const it = currentItem(); if (it) setTempoPct((it.tempo || 100) + 1); });
  $('tempoReset').addEventListener('click', () => setTempoPct(100));
  $('tempoRange').addEventListener('input', (e) => setTempoPct(+e.target.value));

  // pad
  const rootSel = $('padRoot');
  U.ROOT_OPTIONS.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; rootSel.appendChild(o); });
  $('padToggle').addEventListener('click', togglePad);
  $('padMon').addEventListener('change', (e) => { state.settings.padMon = e.target.checked; saveSettingsSoon(); syncPad(); });
  $('padFollow').addEventListener('change', (e) => { state.settings.padFollow = e.target.checked; saveSettingsSoon(); syncPad(); });
  $('padRoot').addEventListener('change', (e) => { state.settings.padRoot = +e.target.value; saveSettingsSoon(); syncPad(); });
  $('padVol').addEventListener('input', (e) => { state.settings.padVol = +e.target.value; saveSettingsSoon(); if (engine.ctx) engine.setLevel('pad', state.settings.padVol / 100); });

  // setlists
  $('setlistSel').addEventListener('change', async (e) => {
    engine.stop(); engine.unload(); state.loadedSongId = null;
    state.slId = e.target.value; state.idx = -1; await store.setSetting('currentSetlist', state.slId);
    renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  });
  $('btnNewSetlist').addEventListener('click', async () => {
    const name = await askText('Nombre del nuevo setlist', new Date().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }), 'Crear');
    if (!name) return;
    engine.stop(); engine.unload(); state.loadedSongId = null;
    await createSetlist(name);
    renderSetlistSelect(); renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  });
  $('btnRenameSetlist').addEventListener('click', async () => {
    const sl = currentSetlist(); if (!sl) return;
    const name = await askText('Renombrar setlist', sl.name, 'Guardar');
    if (!name) return;
    sl.name = name; await store.put('setlists', sl); renderSetlistSelect();
  });
  $('btnDupSetlist').addEventListener('click', duplicateSetlist);
  $('btnDelSetlist').addEventListener('click', async () => {
    const sl = currentSetlist(); if (!sl) return;
    if (!(await askConfirm('Eliminar setlist', `Se elimina “${sl.name}”. Las canciones siguen en la biblioteca.`, 'Eliminar'))) return;
    engine.stop(); engine.unload(); state.loadedSongId = null;
    await store.del('setlists', sl.id);
    state.setlists = state.setlists.filter((s) => s.id !== sl.id);
    state.slId = state.setlists[0] ? state.setlists[0].id : null; state.idx = -1;
    await store.setSetting('currentSetlist', state.slId);
    renderSetlistSelect(); renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); dirtyWave = true;
  });

  // importar
  $('btnAddFiles').addEventListener('click', () => { $('fileInput').value = ''; $('fileInput').click(); });
  $('btnAddFolder').addEventListener('click', () => { $('folderInput').value = ''; $('folderInput').click(); });
  $('fileInput').addEventListener('change', (e) => importFiles(e.target.files));
  $('folderInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    const folder = files[0] && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : undefined;
    importFiles(files, folder);
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('dropzone').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true;
    if (state.settings.live) { toast('Modo en vivo: desactívalo para importar canciones', true); return; }
    const files = await collectDropped(e.dataTransfer);
    if (files.length) importFiles(files);
  });

  // editar canción
  $('formEdit').addEventListener('submit', () => {});
  $('dlgEdit').addEventListener('close', async () => {
    const es = editState;
    if (!es) return;
    if ($('dlgEdit').returnValue === 'ok') await applyEdit();
    else if (es.added && currentSong() === es.song) await selectItem(state.idx); // se agregaron pistas aunque se cerró sin guardar
    editState = null;
  });
  $('edAddSection').addEventListener('click', () => {
    const pos = engine.getPosition();
    editState.sections.push({ id: U.uid(), name: 'Sección', start: Math.round(pos * 100) / 100 });
    editState.sections.sort((a, b) => a.start - b.start); renderEditSections();
  });
  $('edPresetSections').addEventListener('click', () => {
    const dur = editState.song.duration, names = ['Intro', 'Verso 1', 'Coro', 'Verso 2', 'Coro', 'Puente', 'Coro', 'Final'];
    editState.sections = names.map((n, i) => ({ id: U.uid(), name: n, start: Math.round((dur * i) / names.length * 10) / 10 }));
    renderEditSections();
    toast('Plantilla creada con tiempos repartidos: ajusta cada tiempo o vuelve a marcarlos con la canción sonando');
  });
  $('edDelete').addEventListener('click', deleteSongFromLibrary);
  $('edRemoveFromSetlist').addEventListener('click', () => { $('dlgEdit').close('cancel'); moveItem(state.idx, 'del'); });
  const stemsInput = document.createElement('input');
  stemsInput.type = 'file'; stemsInput.multiple = true; stemsInput.accept = 'audio/*'; stemsInput.id = 'stemsInput'; stemsInput.hidden = true;
  document.body.appendChild(stemsInput);
  stemsInput.addEventListener('change', async (e) => {
    if (!editState || !e.target.files.length) return;
    // guarda primero los cambios del editor en memoria para no perderlos
    const keep = { tracks: editState.tracks.map((t) => ({ ...t })), sections: editState.sections.map((s) => ({ ...s })), removed: [...editState.removed] };
    try {
      const ok = await addStemsToSong(editState.song, e.target.files);
      if (ok) { editState.added = true; editState.tracks = editState.song.tracks.map((t) => keep.tracks.find((k) => k.id === t.id) || { ...t }); editState.sections = keep.sections; editState.removed = keep.removed; $('edDur').value = U.fmtTime(editState.song.duration); renderEditTracks(); renderEditSections(); }
    } catch (err) { toast('No se pudieron agregar las pistas: ' + err.message, true); }
  });

  // ajustes de audio / biblioteca
  $('btnSettings').addEventListener('click', async () => { await engine.init().catch(() => {}); await refreshDevices(); populateSettings(); $('dlgSettings').showModal(); });
  $('btnLibrary').addEventListener('click', openLibrary);
  $('btnBackup').addEventListener('click', doBackup);
  $('btnRestore').addEventListener('click', () => { $('packInput').value = ''; $('packInput').click(); });
  $('packInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { $('dlgLibrary').close('cancel'); restoreFromFile(f); } });
  $('backupNow').addEventListener('click', () => { $('backupBanner').hidden = true; doBackup(); });
  $('backupLater').addEventListener('click', () => { state.settings.backupSnooze = Date.now() + 3 * DAY; saveSettingsSoon(); $('backupBanner').hidden = true; });
  $('fadeSel').addEventListener('change', (e) => { state.settings.fadeSec = +e.target.value; saveSettingsSoon(); });
  $('crossSel').addEventListener('change', (e) => { state.settings.crossSec = +e.target.value; applyTransitions(); saveSettingsSoon(); });
  $('memSel').addEventListener('change', (e) => { state.settings.memBudgetMB = +e.target.value; saveSettingsSoon(); preloadSetlist(); });
  $('devSel').addEventListener('change', applyOutputSettings);
  $('modeSel').addEventListener('change', applyOutputSettings);
  $('mainPair').addEventListener('change', applyOutputSettings);
  $('monPair').addEventListener('change', applyOutputSettings);
  $('btnDetectDev').addEventListener('click', detectDeviceNames);
  for (const [id, which] of [['btnTestMain', 'main'], ['btnTestMon', 'monitor']]) {
    $(id).addEventListener('click', async () => {
      if (state.outLost) { toast('La interfaz no está conectada.', true); return; }
      $('btnTestMain').disabled = $('btnTestMon').disabled = true;
      $('testInfo').textContent = which === 'main' ? 'Sonando en PRINCIPAL: primero izquierda (grave), luego derecha (agudo)…' : 'Sonando en MONITOR: primero izquierda (grave), luego derecha (agudo)…';
      try { await engine.testTone(which); } finally { $('btnTestMain').disabled = $('btnTestMon').disabled = false; $('testInfo').textContent = 'Suena un tono grave por la izquierda y uno agudo por la derecha.'; }
    });
  }

  // modo en vivo
  $('btnLive').addEventListener('click', () => { state.settings.live = !state.settings.live; applyLive(); saveSettingsSoon(); toast(state.settings.live ? 'Modo en vivo: edición bloqueada' : 'Modo en vivo apagado'); });

  // atajos de teclado
  window.addEventListener('keydown', (e) => {
    if (anyDialogOpen()) return;
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); stepSection(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); stepSection(-1); }
    else if (e.code === 'KeyL') toggleLoop();
    else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const it = currentItem(); if (!it) return;
      const d = e.code === 'ArrowUp' ? 1 : -1;
      if (e.shiftKey) setTempoPct((it.tempo || 100) + d); else setSemis((it.transpose || 0) + d);
    }
    else if (e.code === 'KeyP') togglePad();
    else if (e.code === 'KeyF') doFade();
    else if (e.code === 'PageDown') stepSong(1);
    else if (e.code === 'PageUp') stepSong(-1);
  });

  window.addEventListener('resize', resizeCanvas);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await refreshDevices();
      if (deviceMissing()) outputLost();
      else if (state.outLost) await outputRestored();
      if ($('dlgSettings').open) populateSettings();
    });
  }

  // motor
  engine.addEventListener('state', updateTransportUI);
  engine.addEventListener('loop', () => { updateTransportUI(); dirtyWave = true; });
  engine.addEventListener('pending', () => { updateSectionChips(true); dirtyWave = true; });
  engine.addEventListener('jumped', () => updateSectionChips(true));
  engine.addEventListener('warn', (e) => toast(e.detail, true));
  engine.addEventListener('sinkerror', () => outputLost());
  engine.addEventListener('sinkchange', () => {
    // la salida cambió sola: si pedimos una interfaz concreta y ya no es esa, se perdió
    const want = state.settings.deviceId, sid = engine.ctx && engine.ctx.sinkId;
    const cur = typeof sid === 'string' ? sid : '';
    if (want !== 'default' && cur !== want) outputLost();
  });
  $('alertRetry').addEventListener('click', retryOutput);
  $('alertDefault').addEventListener('click', useDefaultOutput);
  engine.addEventListener('output', () => { updateOutPill(); if ($('dlgSettings').open) populateSettings(); });
  engine.addEventListener('fade', (e) => {
    $('btnFade').classList.toggle('on', !!e.detail.on);
    $('btnFade').textContent = e.detail.on ? '↘ Fundiendo…' : '↘ Fundido';
    if (e.detail.done) toast('Fundido completo');
  });
  engine.addEventListener('nearend', async () => {
    const cross = state.settings.crossSec, sl = currentSetlist();
    if (!state.settings.autoNext || !(cross > 0) || state.crossing || !sl || state.idx + 1 >= sl.items.length) return;
    state.crossing = true;
    try { const ok = await selectItem(state.idx + 1, { cross }); if (ok) await playSafe(); }
    finally { state.crossing = false; }
  });
  engine.addEventListener('ended', async () => {
    updateTransportUI();
    if (state.crossing) return;
    if (state.settings.autoNext) {
      const sl = currentSetlist();
      if (sl && state.idx + 1 < sl.items.length) { const ok = await selectItem(state.idx + 1); if (ok) await playSafe(); }
    }
  });
}

function syncJumpMode() {
  document.querySelectorAll('#jumpMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.settings.jumpMode));
}

function applyLive() {
  const on = !!state.settings.live;
  document.body.classList.toggle('live', on);
  $('btnLive').classList.toggle('on', on);
  if ($('backupBanner')) $('backupBanner').hidden = on || !backupDue();
  $('btnLive').textContent = on ? '🔒 EN VIVO' : '🔓 Edición';
  renderSongList();
}

// ───────────────────────── arranque ─────────────────────────
async function boot() {
  wire();
  resizeCanvas();
  requestAnimationFrame(frame);
  try { await loadAll(); } catch (e) { console.error(e); toast('No se pudo leer la biblioteca guardada', true); }
  requestPersistence();
  $('autoNext').checked = !!state.settings.autoNext;
  applyLive();
  applyTransitions();
  syncJumpMode();
  renderSetlistSelect(); renderSongList(); renderNow(); renderMixer(); renderSections(); updateKeyTempoUI(); syncPad(); updateTransportUI();

  $('outPill').textContent = 'Iniciando audio…';
  await refreshDevices();
  try {
    await engine.init();
    const s = state.settings;
    engine.levels.main = s.mainVol / 100; engine.levels.monitor = s.monVol / 100;
    engine.mainBus.gain.value = s.mainVol / 100; engine.monitorBus.gain.value = s.monVol / 100;
    if (deviceMissing()) outputLost();
    else await engine.setOutput({ deviceId: s.deviceId, mode: s.mode, mainPair: s.mainPair, monitorPair: s.monitorPair });
    engine.setLevel('pad', s.padVol / 100);
  } catch (e) {
    console.error(e);
    toast('No se pudo iniciar el audio: ' + e.message, true);
  }
  updateOutPill();
  // reabre el último setlist con su primera canción lista
  const sl = currentSetlist();
  if (sl && sl.items.length) await selectItem(0);
  checkBackupReminder();
}

window.__yren.state = state;
window.__yren.api = { selectItem, reorderItem, duplicateSetlist, doFade, doBackup, restoreFromFile, preloadSetlist, planPreload, cacheBytes, songLoaded, checkBackupReminder, backupDue, buildPack: () => Backup.buildPack(U.APP_VERSION) };
window.__yren.outputLost = outputLost;
window.__yren.outputRestored = outputRestored;
window.__yren.playSafe = playSafe;
boot();
