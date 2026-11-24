// Comprueba que, con una canción cargada, TODO el escenario (incluido el mezclador) cabe sin desplazarse en pantallas reales.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch();
const R = reporter('Diseño en pantallas de distintos tamaños');
const song = makeSong('Prueba de diseno', 6);
const sizes = [[1120, 720], [1280, 720], [1366, 768], [1440, 800], [1440, 860], [1512, 900], [1728, 1000], [1920, 1080]];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1200);
  await (await p.$('#fileInput')).uploadFile(...song.files);
  await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(900);
  for (const [w, h] of sizes) {
    await p.setViewport({ width: w, height: h }); await sleep(350);
    const m = await p.evaluate(() => {
      const de = document.documentElement, row = document.querySelector('.mixer-row').getBoundingClientRect();
      const route = document.querySelector('#strips .strip[data-id] .route').getBoundingClientRect();
      const pad = document.querySelector('.padcard'), tr = document.querySelector('.transport'), top = document.querySelector('.top');
      const play = document.getElementById('btnPlay').getBoundingClientRect(), trans = document.getElementById('btnTrans').getBoundingClientRect();
      const grid = document.getElementById('padGrid').getBoundingClientRect(), vol = document.getElementById('padVol').getBoundingClientRect();
      return {
        vover: de.scrollHeight - innerHeight, hover: de.scrollWidth - innerWidth, rowBottom: Math.round(row.bottom), vh: innerHeight,
        routeBottom: Math.round(route.bottom), mixBottom: Math.round(row.bottom),
        padOver: pad.scrollHeight - pad.clientHeight, trOver: tr.scrollWidth - tr.clientWidth, topOver: top.scrollWidth - top.clientWidth,
        playOk: play.right <= innerWidth && trans.right <= innerWidth, gridOk: grid.height >= 40 && vol.bottom <= pad.getBoundingClientRect().bottom + 1,
      };
    });
    R.check(`${w}×${h}: todo cabe (mezclador, PAD, transporte) sin desplazarse`, m.vover <= 1 && m.hover <= 0 && m.rowBottom <= m.vh + 1 && m.routeBottom <= m.mixBottom + 1 && m.padOver <= 2 && m.trOver <= 1 && m.topOver <= 1 && m.playOk && m.gridOk, JSON.stringify(m));
  }
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nDiseño OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
