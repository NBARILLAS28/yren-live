// Pedal / controlador MIDI: se «aprende» qué botón hace cada acción y se guarda en los ajustes.

export const ACTIONS = [
  ['toggle', 'Reproducir / Pausa'], ['stop', 'Detener'],
  ['nextSec', 'Siguiente sección'], ['prevSec', 'Sección anterior'],
  ['next', 'Siguiente canción'], ['prev', 'Canción anterior'],
  ['keyUp', 'Subir tono'], ['keyDown', 'Bajar tono'],
  ['tempoUp', 'Subir tempo'], ['tempoDown', 'Bajar tempo'],
  ['fade', 'Fundido de salida'], ['loop', 'Bucle'], ['pad', 'Pad'],
];

/** Clave estable de un mensaje MIDI «de pulsación», o null si no lo es (soltar, relojes, valores bajos). */
export function messageKey(data) {
  if (!data || data.length < 2) return null;
  const st = data[0], type = st & 0xf0, ch = (st & 0x0f) + 1;
  if (st >= 0xf0) return null; // sistema/tiempo real
  if (type === 0x90 && data[2] > 0) return `n:${data[1]}:${ch}`; // nota encendida (velocidad 0 = soltar)
  if (type === 0xb0 && data[2] >= 64) return `c:${data[1]}:${ch}`; // pedal / botón de control: pisar ≥ 64
  if (type === 0xc0) return `p:${data[1]}:${ch}`; // cambio de programa
  return null;
}

export function describeKey(key) {
  const [t, n, ch] = String(key).split(':');
  const what = t === 'n' ? `Nota ${n}` : t === 'c' ? `Pedal/control ${n}` : `Programa ${n}`;
  return `${what} · canal ${ch}`;
}

export class Midi extends EventTarget {
  constructor() { super(); this.map = {}; this.access = null; this.learning = null; this._last = new Map(); this._timer = null; }

  async init() {
    if (this.access) return { ok: true };
    if (!navigator.requestMIDIAccess) return { ok: false, error: 'Este equipo no ofrece MIDI.' };
    try { this.access = await navigator.requestMIDIAccess({ sysex: false }); }
    catch (e) {
      const denied = e && e.name === 'NotAllowedError' || e && e.name === 'SecurityError';
      return { ok: false, name: e && e.name, error: (denied ? 'No se concedió el permiso de MIDI: ' : 'No se pudo iniciar MIDI en este equipo: ') + (e && e.message ? e.message : e) };
    }
    const attach = () => { for (const i of this.access.inputs.values()) i.onmidimessage = (ev) => this.handle([...ev.data]); this.dispatchEvent(new CustomEvent('devices')); };
    this.access.onstatechange = attach;
    attach();
    return { ok: true };
  }

  inputNames() { return this.access ? [...this.access.inputs.values()].map((i) => i.name || 'Entrada MIDI') : []; }

  /** Espera el próximo botón y lo asigna a `action`. */
  learn(action, ms = 10000) {
    this.cancelLearn();
    this.learning = action;
    this._timer = setTimeout(() => { this.learning = null; this.dispatchEvent(new CustomEvent('learn-timeout', { detail: { action } })); }, ms);
  }
  cancelLearn() { clearTimeout(this._timer); this.learning = null; }

  /** Entrada de un mensaje (de un dispositivo real o de las pruebas). */
  handle(data) {
    const key = messageKey(data);
    if (!key) return;
    const now = performance.now();
    if (now - (this._last.get(key) || -1e9) < 150) return; // rebote del pedal
    this._last.set(key, now);
    if (this.learning) {
      const action = this.learning;
      this.cancelLearn();
      for (const k of Object.keys(this.map)) if (this.map[k] === action || k === key) delete this.map[k]; // una acción = un botón
      this.map[key] = action;
      this.dispatchEvent(new CustomEvent('learned', { detail: { key, action } }));
      return;
    }
    const action = this.map[key];
    if (action) this.dispatchEvent(new CustomEvent('action', { detail: { action, key } }));
  }

  keyOf(action) { return Object.keys(this.map).find((k) => this.map[k] === action) || null; }
}
