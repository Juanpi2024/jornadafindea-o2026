/* Se carga después de los controles originales. Solo cambia la preparación
   de las pistas y la pausa entre narraciones; conserva las voces originales. */
(() => {
  const media = document.getElementById('audio');
  if (!media) return;
  const rice = !!document.getElementById('jump');
  const status = document.getElementById(rice ? 'status' : 'estado');
  const auto = document.getElementById(rice ? 'auto' : 'automatico');
  const next = document.getElementById(rice ? 'next' : 'siguiente');
  const play = document.getElementById(rice ? 'play' : 'reproducir');
  const chooser = document.getElementById(rice ? 'jump' : 'salto');
  const cached = new Audio(); cached.preload = 'auto';
  let pending = null;
  const cancel = () => { if (pending !== null) clearTimeout(pending); pending = null; };
  const say = text => { if (status) status.textContent = text; };
  function prepareNext() {
    const selected = Number(chooser.value);
    const nextPath = rice
      ? (slides[selected + 1] ? (slides[selected + 1].audio || 'audio/' + String(selected + 2).padStart(2, '0') + '.mp3') : null)
      : (typeof datos === 'undefined' ? null : datos?.slides[selected + 1]?.audio);
    if (nextPath) {
      const url = new URL(nextPath, location.href).href;
      if (cached.src !== url) { cached.src = url; cached.load(); }
    }
  }
  media.preload = 'auto';
  media.autoplay = false;
  media.removeAttribute('autoplay');
  const startBox = document.createElement('div');
  startBox.style.cssText = 'margin:18px 0 8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  const start = document.createElement('button');
  start.type = 'button'; start.id = 'iniciarAudio';
  start.className = 'primary';
  start.style.cssText = 'background:#176f6e;color:white;font:inherit;font-weight:bold;border:0;border-radius:8px;padding:14px 20px;cursor:pointer';
  start.textContent = '▶ Iniciar presentación con audio';
  const note = document.createElement('span');
  note.textContent = 'Haz clic una vez. Las láminas y el audio continuarán automáticamente.';
  note.style.cssText = 'font-size:14px;line-height:1.5';
  const direct = document.createElement('a');
  direct.id = 'audioDirecto'; direct.target = '_blank'; direct.rel = 'noopener';
  direct.textContent = 'Abrir audio de esta lámina ↗';
  direct.style.cssText = 'font-size:14px;color:#176f6e;text-decoration:underline';
  function updateDirect() { direct.href = media.currentSrc || media.src; }
  startBox.append(start, note, direct); media.before(startBox); updateDirect();
  media.addEventListener('loadstart', updateDirect);
  start.addEventListener('click', () => {
    cancel(); auto.checked = true;
    if (!media.src) { say('La presentación se está preparando. Vuelve a pulsar Iniciar cuando aparezca la primera lámina.'); return; }
    media.muted = false;
    if (media.volume === 0) media.volume = 1;
    if (media.error) media.load();
    // play se invoca dentro del gesto de la persona, sin esperas ni solicitudes.
    media.play().catch(() => say('El navegador no inició el audio. Prueba Reproducir o el enlace «Abrir audio de esta lámina».'));
  });
  media.addEventListener('pause', () => { start.textContent = '▶ Continuar presentación con audio'; });
  media.addEventListener('play', () => { start.textContent = '▶ Reanudar avance automático'; });
  media.addEventListener('playing', () => { prepareNext(); say('Narración en reproducción · Se conserva cada pista completa.'); });
  media.addEventListener('waiting', () => say('Preparando audio… La narración continuará desde este punto.'));
  media.addEventListener('stalled', () => { if (!media.paused) say('Esperando conexión para continuar el audio.'); });
  media.addEventListener('error', () => { cancel(); say('No se pudo cargar esta pista. Pulsa Reproducir para reintentar; también puedes consultar la transcripción.'); });
  // Intercepta únicamente ended: no hay temporizadores que recorten la voz.
  media.addEventListener('ended', event => {
    event.stopImmediatePropagation(); cancel();
    if (!auto.checked || next.disabled) { say(next.disabled ? 'Presentación finalizada.' : 'Narración finalizada.'); return; }
    say('Narración finalizada · Continuando en la siguiente lámina…');
    const finishedSrc = media.currentSrc;
    pending = setTimeout(() => {
      pending = null;
      if (!auto.checked || !media.ended || media.currentSrc !== finishedSrc) return;
      if (rice) { i++; show(); playRice(); }
      else mostrar(indice + 1, true);
    }, 750);
  }, true);
  function playRice() { media.play().catch(() => say('Pulsa Reproducir para continuar.')); }
  // Una acción de la persona cancela el avance pendiente: nunca salta dos veces.
  document.querySelectorAll('button,select,input').forEach(control => {
    control.addEventListener('click', cancel, true);
    control.addEventListener('change', cancel, true);
  });
  play.addEventListener('click', event => {
    if (!media.error) return;
    event.stopImmediatePropagation(); cancel(); media.load();
    media.play().catch(() => say('No se pudo recuperar el audio. Comprueba la conexión y vuelve a intentarlo.'));
  }, true);
})();
