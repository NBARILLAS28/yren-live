// Ajustes propios de cada sistema operativo para el audio en vivo (puro y fácil de probar: recibe `app`, `os` y la plataforma).

/** Interruptores de Chromium. En Windows se evita que la ventana, al quedar tapada por otra (ProPresenter, OBS…),
 *  sea tratada como "oculta" y se le recorte el reloj de los temporizadores y del audio. */
function applySwitches(app, platform = process.platform) {
  const sw = app.commandLine;
  sw.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  sw.appendSwitch('disable-renderer-backgrounding');
  sw.appendSwitch('disable-background-timer-throttling');
  sw.appendSwitch('disable-backgrounding-occluded-windows');
  if (platform === 'win32') sw.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

/** Sube un escalón la prioridad de los procesos que hacen el audio (ventana y servicio de audio), solo en Windows,
 *  para que otros programas pesados abiertos a la vez no los dejen sin CPU. No usa "alta": no debe ahogar el sistema.
 *  Devuelve cuántos procesos se ajustaron. */
function boostAudioPriority(app, os, platform = process.platform) {
  if (platform !== 'win32') return 0;
  let n = 0;
  try {
    const level = os.constants.priority.PRIORITY_ABOVE_NORMAL;
    for (const m of app.getAppMetrics()) {
      if (!['Browser', 'Tab', 'Utility'].includes(m.type)) continue;
      try { os.setPriority(m.pid, level); n++; } catch { /* sin permiso para ese proceso: se sigue */ }
    }
  } catch { /* sin métricas: no se ajusta nada */ }
  return n;
}

module.exports = { applySwitches, boostAudioPriority };
