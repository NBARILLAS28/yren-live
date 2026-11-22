// Ajustes por sistema operativo (platform.js): solo en Windows se añaden los cambios de Windows.
import { createRequire } from 'node:module';
import { reporter } from './lib.mjs';
const require = createRequire(import.meta.url);
const { applySwitches, boostAudioPriority } = require('../platform.js');
const R = reporter('Plataforma');
const fakeApp = (metrics = []) => { const sw = []; return { sw, commandLine: { appendSwitch: (k, v) => sw.push(v === undefined ? [k] : [k, v]) }, getAppMetrics: () => metrics }; };
const has = (a, k) => a.sw.some((x) => x[0] === k);

for (const plat of ['darwin', 'linux']) {
  const a = fakeApp(); applySwitches(a, plat);
  R.check(`${plat}: interruptores base y nada específico de Windows`, has(a, 'autoplay-policy') && has(a, 'disable-renderer-backgrounding') && !has(a, 'disable-features'), JSON.stringify(a.sw));
}
{ const a = fakeApp(); applySwitches(a, 'win32');
  R.check('win32: además se desactiva la detección de ventana tapada', a.sw.some((x) => x[0] === 'disable-features' && x[1] === 'CalculateNativeWinOcclusion'), JSON.stringify(a.sw)); }

const calls = [];
const fakeOs = { constants: { priority: { PRIORITY_ABOVE_NORMAL: -7 } }, setPriority: (pid, lvl) => { if (pid === 99) throw new Error('EPERM'); calls.push([pid, lvl]); } };
const metrics = [{ pid: 1, type: 'Browser' }, { pid: 2, type: 'Tab' }, { pid: 3, type: 'Utility' }, { pid: 4, type: 'GPU' }, { pid: 99, type: 'Tab' }];
R.check('mac/linux: no toca prioridades', boostAudioPriority(fakeApp(metrics), fakeOs, 'darwin') === 0 && calls.length === 0);
const n = boostAudioPriority(fakeApp(metrics), fakeOs, 'win32');
R.check('win32: sube un escalón (no “alta”) a ventana, audio y proceso principal', n === 3 && calls.every(([, l]) => l === -7) && calls.map((c) => c[0]).join() === '1,2,3', JSON.stringify(calls));
R.check('win32: un proceso sin permiso no rompe el resto', n === 3);
R.check('win32: sin métricas no falla', boostAudioPriority({ getAppMetrics() { throw new Error('x'); } }, fakeOs, 'win32') === 0);
console.log(R.failed ? `\n${R.failed} de ${R.total} fallaron` : `\nPlataforma OK (${R.total} comprobaciones)`);
process.exit(R.failed ? 1 : 0);
