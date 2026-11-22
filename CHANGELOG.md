# Historial de cambios

## 0.6.0 — Cambios de canción sin esperas
- **Botón «⏭ Transición»** (tecla **T**, pedal MIDI y control remoto): pasa a la siguiente canción con fundido cruzado sin parar la música; si está parada, carga y reproduce la siguiente.
- **Precarga por cercanía:** la app mantiene lista la canción actual, la siguiente y la anterior primero, y después el resto del setlist según cabe en memoria; antes solo miraba hacia adelante.
- **Memoria «Automático»** (recomendado): usa ~40 % de la RAM del equipo (entre 1,5 y 8 GB). El ajuste fijo antiguo de 1,5 GB se pasa a Automático una sola vez.
- Precarga más rápida: empieza antes (150 ms en vez de 900 ms) y decodifica más pistas en paralelo.
- La conversión a mono de pistas duales ya no congela la pantalla (se hace por trozos).
- La tarjeta «Cargando…» al elegir otra canción ahora es una **cinta pequeña que no tapa ni bloquea** los controles (fundido, parar, etc. siguen disponibles).
- Barra de transporte más compacta para que quepa el botón nuevo sin bajar el mezclador.
- Pruebas nuevas (13) para precarga, memoria, carga sin bloqueo, transición y migración del ajuste.

## 0.5.0 — Windows y latencia
- **Instalador de Windows** (`.exe`, NSIS, 64 bits) con su propio flujo de GitHub Actions.
- **Audio directo:** con tono 0 y tempo 100 % el audio no pasa por el procesador de tono (0 ms añadidos, mucha menos CPU). Cambio automático y sin cortes a la ruta procesada y de vuelta.
- Arranque más rápido tras pulsar Play (~150 ms menos con la canción en su tono original).
- **Corregido:** mover la posición (seek) o saltar de sección con otro tono o tempo dejaba un silencio de ~130 ms; ahora el sonido anterior continúa hasta que entra el nuevo.
- Windows: se evita que la ventana tapada por otro programa sea tratada como oculta, y los procesos de audio suben un escalón de prioridad. El menú se oculta (Alt lo muestra).
- ⚙ Audio muestra la latencia real (directa o procesando) y lo que añade la salida del sistema.
- Mensajes de permiso del micrófono adaptados a Windows; un equipo sin micrófono ya no muestra un error.
- Pruebas: arranque directo vs procesado, cambio de ruta en vivo, huecos de silencio en seek y saltos; las pruebas de rutas funcionan también en Windows.

## 0.4.0 — Equipo de alabanza
- Letras y acordes por canción (inglesa y latina), notas del equipo y transposición con la tonalidad.
- Vista de **Escenario** (tecla S) con auto-desplazamiento a la sección en curso.
- **Click generado** desde el BPM (solo Monitor, 0 MB de archivo).
- **Cuenta previa** por el Monitor (1–4 compases).
- Importar **marcadores** desde TXT/CSV y desde cue points de WAV.
- **Automatización por sección**: silenciar pistas y pad on/off.
- **Control remoto** desde el celular (QR, PIN, bloqueo por intentos, lista cerrada de comandos).
- **Pedal MIDI** con «Aprender» y 14 acciones.
- Corregido: la salida de audio y MIDI no se podían usar en la app instalada por permisos denegados (`speaker-selection`, `midiSysex`, `persistent-storage`).

## 0.3.0 — Servicio completo
- Fundido de salida y transición suave (crossfade) entre canciones.
- Precarga del setlist con progreso y presupuesto de memoria.
- Reordenar arrastrando y duplicar setlists.
- Respaldo y restauración `.yrenpack` con recordatorio.
- Atajos de teclado ampliados.

## 0.2.0 — Fiabilidad en vivo
- Modo en vivo, confirmación al cerrar con música sonando.
- Pruebas automáticas en el repositorio y CI en GitHub Actions.

## 0.1.0
- Primera versión: stems WAV/MP3, tonalidad y tempo en tiempo real, salidas Principal/Monitor por interfaz USB, setlists, secciones, bucle y pad.
