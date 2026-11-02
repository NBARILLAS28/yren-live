# YREN LIVE
**Audio Sequence System** · *Tu alabanza, en perfecta armonía*

Reproductor de pistas (stems) para el equipo de alabanza de Dios de Pactos. App de escritorio para Mac, aparte de DDP Imagine.

## Qué hace (versión 0.4)

- **Importa stems** (WAV y MP3 mezclados, también M4A/AAC/FLAC/AIFF): arrastra los archivos a la ventana, usa **+ Canción (stems)** o **+ Carpeta** (una carpeta = una canción).
- **Detecta solo** qué pista es *click* y cuál es *guía* (por el nombre del archivo) y las manda al **Monitor**; la batería/percusión no se transpone.
- **Tonalidad en tiempo real** (−6 a +6 semitonos) con botones −/+ o eligiendo la nota destino. Cada pista se puede marcar con **♯** (se transpone) o no.
- **Tempo** del 70% al 130% **sin cambiar el tono**, con BPM resultante.
- **Mezclador** por pista: volumen, solo, mute, medidor, y salida **PRINCIPAL / AMBOS / MONITOR**. Dos masters (Principal y Monitor). Doble clic en un fader = 0 dB.
- **Salidas separadas por interfaz USB**: Principal (sala) en un par de canales (ej. 1-2) y Monitor (click + guía) en otro (ej. 3-4). Modo **Dividido** para interfaces de 2 canales (Monitor a la izquierda, Principal a la derecha).
- **Setlists**: varios, con orden editable. La tonalidad y el tempo se guardan **por canción dentro de cada setlist**.
- **Secciones** (Intro, Verso, Coro…): márcalas mientras suena con **+ Sección aquí**. Tocar una sección programa un **salto sin cortes** al terminar la sección actual (modo *Al terminar*) o inmediato (modo *Ya*). Tocar otra vez la sección en cola cancela el salto.
- **Bucle** de la sección actual.
- **Pad ambiental** sintético que sigue la tonalidad de la canción (o una nota fija), con volumen propio y opción de mandarlo también al monitor.
- **Onda** de la canción con secciones, bucle y cabezal; clic para ir a ese punto.
- Todo se guarda en el Mac (IndexedDB): canciones, audio, setlists y ajustes. Funciona **sin internet**.

## Atajos

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| → / ← | Sección siguiente / anterior |
| ↑ / ↓ | Subir / bajar la tonalidad un semitono |
| Mayús + ↑ / ↓ | Subir / bajar el tempo 1 % |
| L | Bucle de la sección |
| P | Pad ambiental encendido / apagado |
| F | Fundido de salida |
| S | Abrir / cerrar la vista de **Escenario** |
| Esc | Cerrar el escenario |
| Re Pág / Av Pág | Canción anterior / siguiente |

## Novedades de v0.2 – v0.4

Detalle completo en [CHANGELOG.md](CHANGELOG.md). Manual ilustrado en PDF: [docs/YREN-LIVE-Manual-de-uso.pdf](docs/YREN-LIVE-Manual-de-uso.pdf).

### Servicio en vivo (v0.2 – v0.3)
- **Modo en vivo**: bloquea cambios peligrosos; al cerrar con música sonando, la app pregunta antes.
- **Fundido de salida** (F o botón) con duración configurable, y **transición suave** entre canciones (crossfade) cuando el avance automático está activo.
- **Precarga del setlist** con barra de progreso y presupuesto de memoria configurable.
- **Reordenar el setlist arrastrando** y **duplicar setlist**.
- **Respaldo** de toda la biblioteca en un archivo `.yrenpack` (y restaurarlo), con aviso periódico si hace tiempo que no respaldas.

### Para el equipo de alabanza (v0.4)
- **Letras y acordes** por canción, con notas para el equipo. Formato:
  - Acordes en línea entre corchetes: `[C]Santo, [G]santo es el [Am]Señor`
  - O una línea solo de acordes encima de la letra: `C       G      Am`
  - Notación inglesa (C D E F G A B) **o** latina (Do Re Mi Fa Sol La Si); sostenidos y bemoles.
  - Encabezados de bloque: `# Coro`, `{Verso 1}` o `Puente:` en una línea aparte; cada bloque se enlaza con la sección del mismo nombre y se resalta cuando esa sección suena.
- **Escenario** (tecla **S**): pantalla completa con título, tono, BPM, sección actual, cuánto falta para la siguiente, notas y letra con acordes. La letra **se desplaza sola** a la sección en curso y los **acordes se transponen** con la tonalidad de la canción. Tamaño de letra ajustable (A− / A+).
- **Click generado**: si una canción no trae click, créalo desde el BPM (compás de 2, 3, 4 o 6 tiempos y desfase del primer tiempo configurables). Ocupa 0 MB, va solo al Monitor y el primer tiempo del compás suena más agudo.
- **Cuenta previa** (1–4 compases, solo al empezar desde el inicio): los clicks suenan por el **Monitor**, la sala no oye nada hasta que arranca la canción. Opcional: también por la sala.
- **Importar marcadores** como secciones: desde un `.txt`/`.csv` (Audacity, Reaper o lista simple `tiempo,nombre`), o automáticamente desde los **cue points** de un WAV. Tiempos aceptados: `83.5`, `1:23.5`, `0:01:23`.
- **Automatización por sección** (botón ⚙ de cada sección): silenciar pistas y encender/apagar el pad al entrar en esa sección.
- **Control remoto desde el celular** (solo en la app de escritorio): *Ajustes → Control remoto*. Muestra un **código QR** y un **PIN**; el celular debe estar en la **misma red Wi-Fi**. Desde el celular: reproducir/pausa, secciones, tono, tempo, bucle, pad, fundido y elegir canción. Seguridad: PIN obligatorio, bloqueo temporal tras 5 intentos fallidos y lista fija de comandos permitidos. La primera vez, macOS preguntará si permites conexiones entrantes: acepta. Si no abre en el celular, revisa *Ajustes del Sistema → Red → Firewall*.
- **Pedal / controlador MIDI**: *Ajustes → Pedal MIDI*. Pulsa **Aprender** junto a una acción y luego pisa el botón. Acepta notas, controles (pedal ≥ 64) y cambios de programa. 13 acciones asignables: reproducir/pausa, detener, sección ±, canción ±, tono ±, tempo ±, fundido, bucle y pad. Las asignaciones se guardan.

## Correrla (desarrollo)

Requiere [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm start
```

## Crear el instalador .dmg

En un Mac:

```bash
npm install
npm run dist            # .dmg para el tipo de Mac donde lo construyes
npm run dist:universal  # .dmg que sirve en Mac Intel y Apple Silicon
```

El instalador queda en `dist/`.

**Sin Mac a mano:** sube esta carpeta a un repositorio de GitHub y corre el workflow *Build YREN LIVE (macOS)* (pestaña **Actions → Run workflow**). Al terminar, descarga el `.dmg` desde *Artifacts*.

### Primera apertura
La app no está firmada con una cuenta de desarrollador de Apple. La primera vez: **clic derecho sobre YREN LIVE → Abrir → Abrir**.

## Configurar el audio

1. Conecta la interfaz USB y abre **⚙ Audio**.
2. Pulsa **Detectar nombres de dispositivos** (macOS pedirá permiso de micrófono: solo se usa para poder leer los nombres de las salidas, no graba nada).
3. Elige la interfaz, deja *Pares separados*, **Principal = 1-2** y **Monitor = 3-4** (o los pares que uses).
4. Reproduce y ajusta el volumen de cada mezcla en los masters del mezclador.

Si no hay interfaz conectada, la app usa la salida del Mac: lo que está en *Monitor* (click y guía) no se oirá en ese modo; usa el modo **Dividido** o pon esas pistas en **AMBOS** para probar.

## Notas técnicas

- **Motor:** Web Audio + [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (AudioWorklet) por cada pista. Electron.
- **Latencia interna** del cambio de tonalidad: ~130 ms. Es igual para todas las pistas (siguen alineadas) y la app la compensa en los saltos entre secciones. Se mide al iniciar.
- **Alineación entre pistas:** una pista transpuesta puede quedar unos milisegundos desfasada respecto a una que no se transpone (propio del algoritmo). Por eso la batería y el click no se transponen por defecto.
- **Memoria:** el audio se decodifica a WAV de 32 bits en RAM. Una canción de 4 min con 10 stems estéreo usa ~800 MB; la app mantiene en memoria la canción actual y la siguiente.
- **Pruebas automáticas** (`npm test`): letras, marcadores, MIDI, control remoto, motor de audio, interfaz, diseño en varios tamaños y servicio completo v0.2–v0.4, más una prueba en Electron real. Incluyen: tonalidad exacta (+12 st = octava), el tempo no altera el tono, salto en cola a ~12 ms del final de la sección, y prueba de estrés con operaciones aleatorias sin errores.

## Pendiente / siguientes pasos

- **Firma y notarización de Apple** y **actualización automática**: requieren la cuenta de desarrollador de pago; por decisión del equipo no se hacen por ahora.
- **Calidad del cambio de tono en voces**: hay que escucharla con stems reales; si no convence, se puede cambiar el algoritmo.
- **Pruebas en equipo real**: Mac, interfaz USB, pedal MIDI y celular (todo lo anterior se probó con audio sintético y navegador/Electron en Linux).
- Importador específico de marcadores de otros programas (hoy hay importación genérica por texto/CSV y cue points de WAV).

## Licencias de terceros

SoundTouchJS (`src/vendor/`) — MPL-2.0. Ver `THIRD-PARTY-NOTICES.md`.
