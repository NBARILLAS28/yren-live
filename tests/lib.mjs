// Utilidades compartidas por las pruebas: servidor estático y navegador.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const here = path.dirname(new URL(import.meta.url).pathname);
export const SRC = path.join(here, '..', 'src');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav' };

export function startServer(extra = {}) {
  const roots = { '/app/': SRC + '/', '/t/': here + '/', ...extra };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      for (const [p, r] of Object.entries(roots)) if (u.startsWith(p)) {
        const f = path.join(r, u.slice(p.length) || 'index.html');
        if (!f.startsWith(r)) break;
        fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
        return;
      }
      res.writeHead(404); res.end();
    }).listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, close: () => srv.close() }));
  });
}

export function chromePath() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const p = c.find((x) => fs.existsSync(x));
  if (!p) throw new Error('No encuentro Chrome/Chromium. Define CHROME_PATH.');
  return p;
}

export async function launch(extraArgs = []) {
  return puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', ...extraArgs] });
}

export function reporter(title) {
  const R = { failed: 0, total: 0 };
  console.log('\n' + title);
  R.check = (name, ok, extra = '') => { R.total++; if (!ok) R.failed++; console.log((ok ? '  ✔ ' : '  ✘ ') + name + (extra !== '' ? ' — ' + extra : '')); };
  R.near = (name, v, target, tol, unit = '') => R.check(name, Math.abs(v - target) <= tol, `${v}${unit} (esperado ${target} ±${tol})`);
  return R;
}
