// Servidor del control remoto: PIN, comandos permitidos, eventos en vivo y bloqueo por intentos.
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { reporter } from './lib.mjs';
const require = createRequire(import.meta.url);
const { RemoteServer } = require('../remote-server.js');
const R = reporter('Control remoto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'remote', 'remote.html');
const got = [];
const srv = new RemoteServer({ pagePath: page, onCommand: (c, a) => got.push([c, a]), lockMs: 700 });
const { port, urls } = await srv.start({ port: 0, pin: '4821' });
const base = `http://127.0.0.1:${port}`;
const req = (method, p, { body, pin, headers = {} } = {}) => new Promise((resolve, reject) => {
  const r = http.request(base + p, { method, headers: { ...(pin ? { 'x-pin': pin } : {}), ...headers } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers })); });
  r.on('error', reject); if (body) r.write(body); r.end();
});
try {
  const pg = await req('GET', '/');
  R.check('La página del control se entrega sin PIN (pide el PIN en pantalla)', pg.status === 200 && pg.body.includes('YREN') && pg.headers['content-security-policy']);
  srv.push({ title: 'Santo', key: 'D', playing: false, sections: ['Intro', 'Coro'] });
  R.check('Estado sin PIN → 401', (await req('GET', '/api/state')).status === 401);
  R.check('Estado con PIN correcto → JSON', JSON.parse((await req('GET', '/api/state', { pin: '4821' })).body).title === 'Santo');
  // eventos en vivo
  const events = [];
  await new Promise((resolve) => {
    http.get(`${base}/api/events?pin=4821`, (res) => { res.setEncoding('utf8'); res.on('data', (d) => { for (const l of d.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); if (events.length === 1) srv.push({ title: 'Digno', key: 'E' }); if (events.length === 2) { res.destroy(); resolve(); } }); });
  });
  R.check('Eventos en vivo: estado inicial y cada cambio llega al celular', events[0].title === 'Santo' && events[1].title === 'Digno', events.map((e) => e.title).join(', '));
  R.check('Comando válido con PIN → 200 y llega a la app', (await req('POST', '/api/cmd', { pin: '4821', body: JSON.stringify({ cmd: 'section', arg: 3 }) })).status === 200 && JSON.stringify(got[0]) === '["section",3]', JSON.stringify(got));
  R.check('Comando sin PIN → 401 y no se ejecuta', (await req('POST', '/api/cmd', { body: JSON.stringify({ cmd: 'toggle' }) })).status === 401 && got.length === 1);
  for (const bad of ['deleteSong', 'rm -rf', '__proto__', 'importFiles']) R.check(`Comando no permitido «${bad}» → 400`, (await req('POST', '/api/cmd', { pin: '4821', body: JSON.stringify({ cmd: bad }) })).status === 400);
  R.check('Ningún comando no permitido llegó a la app', got.length === 1);
  R.check('Cuerpo gigante → 413', (await req('POST', '/api/cmd', { pin: '4821', body: 'x'.repeat(5000) }).catch(() => ({ status: 413 }))).status === 413);
  R.check('GET a /api/cmd → 405; ruta desconocida → 404', (await req('GET', '/api/cmd', { pin: '4821' })).status === 405 && (await req('GET', '/etc/passwd')).status === 404);
  R.check('Argumento no entero se ignora (no se inyecta texto)', (await req('POST', '/api/cmd', { pin: '4821', body: JSON.stringify({ cmd: 'song', arg: '1; drop' }) })).status === 200 && got[1][1] === undefined, JSON.stringify(got[1]));
  // bloqueo por intentos
  let st = 0; for (let i = 0; i < 6; i++) st = (await req('GET', '/api/state', { pin: '0000' })).status;
  R.check('Tras 5 PIN equivocados se bloquea (429), incluso con el PIN bueno', st === 429 && (await req('GET', '/api/state', { pin: '4821' })).status === 429);
  await sleep(900);
  R.check('El bloqueo se levanta solo y el PIN correcto vuelve a funcionar', (await req('GET', '/api/state', { pin: '4821' })).status === 200);
  R.check('Direcciones de la red local para el celular (http://IP:puerto/)', Array.isArray(urls) && urls.every((u) => /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/.test(u)), urls.join(' '));
  srv.stop(); await sleep(100);
  R.check('Al apagar, el puerto se cierra', await req('GET', '/').then(() => false, () => true));
  let bad = false; try { await srv.start({ port: 0, pin: '12' }); } catch { bad = true; }
  R.check('Un PIN corto (menos de 4 dígitos) se rechaza', bad);
} finally { srv.stop(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nControl remoto OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
