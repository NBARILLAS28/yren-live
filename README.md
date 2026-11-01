# YREN LIVE
**Audio Sequence System** · *Tu alabanza, en perfecta armonía*

Reproductor de pistas (stems) para el equipo de alabanza de Dios de Pactos. App de escritorio para Mac, aparte de DDP Imagine.

## Qué hace (versión 0.1)

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
| L | Bucle de la sección |
| Re Pág / Av Pág | Canción anterior / siguiente |

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
- **Pruebas hechas:** tonalidad exacta (+12 st = octava), el tempo no altera el tono, salto en cola a ~12 ms del final de la sección, y prueba de estrés con operaciones aleatorias sin errores.

## Pendiente / siguientes pasos

Click generado con subdivisiones · transiciones con crossfade entre canciones · automatizaciones por sección · control remoto desde el celular · MIDI · exportar/importar setlists · firma y notarización de la app.

## Licencias de terceros

SoundTouchJS (`src/vendor/`) — MPL-2.0. Ver `THIRD-PARTY-NOTICES.md`.
