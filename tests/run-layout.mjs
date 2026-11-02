// Comprueba que, con una canción cargada, TODO el escenario (incluido el mezclador) cabe sin desplazarse en pantallas reales.
import { startServer, launch, reporter } from './lib.mjs';
import { makeSong } from './fixtures.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const b = await launch();
const R = reporter('Diseño en pantallas de distintos tamaños');
const song = makeSong('Prueba de diseno', 6);
const sizes = [[1280, 720], [1366, 768], [1440, 800], [1440, 860], [1512, 900], [1728, 1000], [1920, 1080]];
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.goto(`http://127.0.0.1:${port}/app/index.html`); await sleep(1200);
  await (await p.$('#fileInput')).uploadFile(...song.files);
  await p.waitForSelector('#dlgEdit[open]', { timeout: 60000 }); await p.click('#edSave'); await sleep(900);
  for (const [w, h] of sizes) {
    await p.setViewport({ width: w, height: h }); await sleep(350);
    const m = await p.evaluate(() => {
      const st = document.querySelector('.stage'); const last = [...document.querySelectorAll('#strips .strip')].pop();
      const route = document.querySelector('#strips .strip[data-id] .route'); const rb = route.getBoundingClientRect();
      const sr = st.getBoundingClientRect();
      return { over: st.scrollHeight - st.clientHeight, routeBottom: Math.round(rb.bottom), stageBottom: Math.round(sr.bottom), vh: innerHeight, hscroll: document.documentElement.scrollWidth - innerWidth };
    });
    R.check(`${w}×${h}: el mezclador completo es visible`, m.over <= 2 && m.routeBottom <= m.stageBottom + 1 && m.hscroll <= 0, `desborde ${m.over}px, botones PRIN/AMB/MON en ${m.routeBottom} de ${m.stageBottom}`);
  }
} finally { await b.close(); close(); }
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nDiseño OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
