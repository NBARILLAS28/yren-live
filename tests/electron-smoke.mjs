// Prueba de humo en la aplicación Electron REAL (bajo xvfb en CI/Linux).
// Verifica: protocolo yren://, carga de módulos, AudioWorklet (SoundTouch), motor de audio, interfaz.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
const require = createRequire(import.meta.url);
const electronPath = require('electron');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = new URL('..', import.meta.url).pathname;

import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yren-electron-'));
const args = [`--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--autoplay-policy=no-user-gesture-required', root];
const cmd = process.env.DISPLAY ? electronPath : 'xvfb-run';
const argv = process.env.DISPLAY ? args : ['-a', electronPath, ...args];
const child = spawn(cmd, argv, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, YREN_TEST: '1', YREN_TEST_ANSWER: 'stay' } });
let logs = ''; child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));

const R = { checks: [], failed: 0 };
const check = (name, ok, extra = '') => { R.checks.push({ name, ok: !!ok, extra }); if (!ok) R.failed++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra ? ' — ' + extra : '')); };

let browser;
try {
  for (let i = 0; i < 40; i++) { try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` }); break; } catch { await sleep(500); } }
  if (!browser) throw new Error('No pude conectar con Electron');
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('yren://')); if (!page) await sleep(500); }
  check('La ventana carga yren://app/index.html', !!page, page ? page.url() : '');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sleep(2500);
  const info = await page.evaluate(async () => {
    const e = window.__yren && window.__yren.engine;
    return { hasEngine: !!e, ctx: e && e.ctx ? e.ctx.state : null, worklet: !!(e && e.ctx && e.ctx.audioWorklet), latency: e ? e.latency : null,
      title: document.title, pill: document.getElementById('outPill').textContent, preload: typeof window.yren, platform: window.yren && window.yren.platform,
      css: getComputedStyle(document.body).backgroundColor };
  });
  check('Motor de audio iniciado (AudioContext)', info.hasEngine && info.ctx, JSON.stringify({ state: info.ctx }));
  check('AudioWorklet de SoundTouch cargado', info.worklet && info.latency > 0.02 && info.latency < 0.5, 'latencia medida ' + Math.round(info.latency * 1000) + ' ms');
  check('Preload expuesto (window.yren)', info.preload === 'object', info.platform);
  check('Estilos aplicados', info.css !== 'rgba(0, 0, 0, 0)', info.css);
  const play = await page.evaluate(async () => {
    const eng = window.__yren.engine; const ctx = eng.ctx, sr = ctx.sampleRate;
    const b = ctx.createBuffer(2, sr * 4, sr); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr); }
    const song = { id: 'smoke', duration: 4, sections: [{ id: 'a', name: 'A', start: 0 }], tracks: [{ id: 't', name: 't', kind: 'music', route: 'main', transpose: true, vol: 1, mute: false, solo: false }] };
    eng.loadSong(song, new Map([['t', b]])); eng.setTranspose(2); await eng.play();
    await new Promise((r) => setTimeout(r, 1200)); const p = eng.getPosition(); eng.stop();
    return { pos: p };
  });
  check('Reproduce con cambio de tonalidad en Electron', play.pos > 0.8 && play.pos < 1.6, 'pos=' + play.pos.toFixed(2));
  check('Sin errores de JavaScript en la ventana', errors.length === 0, errors.slice(0, 3).join(' | '));
  // cierre con música sonando: debe preguntar
  const notPlaying = await page.evaluate(async () => { window.yren.setPlaying(false); await new Promise((r) => setTimeout(r, 200)); return true; });
  await page.evaluate(() => window.yren.setPlaying(true)); await sleep(300);
  await page.evaluate(() => window.yren.testAnswer('stay'));
  const stayed = await page.evaluate(() => window.yren.testClose());
  check('Con música sonando, cerrar pregunta y «Seguir reproduciendo» mantiene la ventana', notPlaying && stayed === true);
  await page.evaluate(() => window.yren.testAnswer('close'));
  const closed = await Promise.race([page.evaluate(() => window.yren.testClose()).then(() => 'resp').catch(() => 'cerrada'), sleep(4000).then(() => 'timeout')]);
  await sleep(800);
  const alive = (await browser.pages().catch(() => [])).some((p) => p.url().startsWith('yren://'));
  check('«Cerrar de todos modos» cierra la aplicación', !alive || closed === 'cerrada', 'ventana viva: ' + alive);
} catch (e) {
  check('Prueba de humo sin excepciones', false, String(e && e.message || e));
  console.log(logs.split('\n').filter((l) => !/bus\.cc|dbus|NODE_OPTION/.test(l)).slice(-15).join('\n'));
} finally {
  try { if (browser) await browser.disconnect(); } catch {}
  try { process.kill(-child.pid, 'SIGTERM'); } catch {} await sleep(600); try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}
console.log(R.failed ? `\n${R.failed} prueba(s) fallaron` : '\nElectron OK');
process.exit(R.failed ? 1 : 0);
