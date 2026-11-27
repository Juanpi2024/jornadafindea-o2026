/* =====================================================================
   APP CEIA 2027 · "Jornadas fin de año"
   Calendario → nómina del día → dosier con las matrices.
   Todo pasa por una sola función en Supabase: esta página no tiene
   llaves y no toca la base de datos directamente.
   ===================================================================== */

const API = 'https://igmmdzrumksuuueqtnex.supabase.co/functions/v1/talleres';
const MAX_PALABRAS = 2000;
const VIDEO_PEI = '_9ueGDS01u0';   // resumen del PEI, generado con NotebookLM

/* Videos de apoyo que viven en el propio sitio. Verticales, cortos: se ven
   bien en el teléfono, que es donde muchos van a entrar. */
const APOYO = [
  {archivo:'ensenar-jovenes-adultos', titulo:'Cómo enseñar a jóvenes y adultos',
   bajada:'Qué cambia cuando quien aprende ya es adulto y llega después de trabajar.', dur:'1:09'},
  {archivo:'escuela-futuros-rotos', titulo:'La escuela que reescribe futuros rotos',
   bajada:'Para qué existe un CEIA y qué significa para quien vuelve a estudiar.', dur:'0:57'}
];
const LS_YO = 'jfa_yo_v1';
const LS_PEND = 'jfa_pendientes_v1';
const LS_BORR = 'jfa_borrador_';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

const app = {
  yo: null,          // {nombre, codigo}
  cfg: null,         // respuesta de "config": jornadas y fecha del servidor
  nomina: [],        // nómina pública: nombres, función y avance
  datos: null,       // respuesta de "agenda"
  jornada: null,     // jornada abierta
  chat: {},          // historial del tutor por jornada
  conectado: null
};

/* ---------------------------------------------------------- utilidades */
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palabras = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const fdate = (iso) => { const [a,m,d] = iso.split('-').map(Number); return `${d} de ${MESES[m-1]}`; };
const fdateLarga = (iso) => {
  const f = new Date(iso + 'T12:00:00');
  return f.toLocaleDateString('es-CL', {weekday:'long', day:'numeric', month:'long'});
};
const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  del: (k) => { try { localStorage.removeItem(k); } catch(e){} }
};

function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms || 4200);
}

async function api(payload) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => ({error: 'El servidor respondió algo ilegible.'}));
  if (d.error) throw new Error(d.error);
  return d;
}
const esRed = (m) => /Failed to fetch|NetworkError|ilegible|Load failed/i.test(m);
const yoApi = () => ({nombre: app.yo.nombre, codigo: app.yo.codigo || ''});

/* ---------------------------------------------------------- arranque */
document.addEventListener('DOMContentLoaded', () => {
  app.yo = ls.get(LS_YO, null);
  $('#formCodigo').addEventListener('submit', confirmarCodigo);
  $('#formPanel').addEventListener('submit', abrirPanel);
  $('#btnSalir').addEventListener('click', salir);
  $('#codVolver').addEventListener('click', volverNomina);
  $('#nomina').addEventListener('click', (e) => {
    const f = e.target.closest('[data-nombre]');
    if (f) elegir(f.dataset.nombre);
  });
  $('#buscaNomina').addEventListener('input', (e) => pintarNomina(app.jornada, e.target.value));
  $('#tutorBtn').addEventListener('click', () => abrirTutor());
  $('#tutorGlobo').addEventListener('click', () => abrirTutor($('#tutorGlobo').dataset.p || ''));
  $('#tutorCerrar').addEventListener('click', cerrarTutor);
  window.addEventListener('hashchange', ruta);
  window.addEventListener('online', reintentar);
  arrancar();
});

const VISTAS = ['vCodigo','vCalendario','vDia','vJornada','vPanel'];
function vista(id) {
  VISTAS.forEach(v => { const n = $('#'+v); if (n) n.hidden = (v !== id); });
  $('#barraUsuario').hidden = !app.yo;
  const enDosier = (id === 'vJornada');
  $('#tutorFlota').hidden = !enDosier;
  if (!enDosier) { $('#tutorPanel').hidden = true; esconderGlobo(); }
}

/** Arranque público: el calendario y la nómina se ven sin pedir nada.
 *  Si este equipo ya recuerda a alguien, además carga su dosier. */
async function arrancar() {
  try {
    const [cfg, nom] = await Promise.all([api({action:'config'}), api({action:'nomina'})]);
    app.cfg = cfg;
    app.nomina = nom.nomina || [];
    app.conectado = true;
  } catch (ex) {
    app.conectado = false;
    vista('vCalendario');
    $('#calendario').innerHTML = `<p class="err">${esRed(ex.message)
      ? 'No hay conexión con el servidor. Revisa tu internet y vuelve a abrir la página.'
      : esc(ex.message)}</p>`;
    return;
  }
  if (app.yo) await cargar(true); else ruta();
}

/* La jornada completa (con preguntas) vive en "agenda"; la del calendario
   solo trae la cabecera. Cuando hay dosier cargado, ese manda. */
const jornadaPorId = (id) =>
  ((app.datos && app.datos.jornadas) || []).find(x => x.id === id) ||
  ((app.cfg && app.cfg.jornadas) || []).find(x => x.id === id);

function ruta() {
  const h = location.hash.replace('#','');
  if (h === 'panel') { vista('vPanel'); return; }
  if (!app.cfg) { vista('vCalendario'); return; }
  if (h.startsWith('dia-')) { const j = jornadaPorId(h.slice(4)); if (j) return verDia(j); }
  if (h.startsWith('resp-')) {
    const j = jornadaPorId(h.slice(5));
    if (j) {
      if (app.yo && app.datos && puedeEntrar(j)) return verJornada(j);
      return verDia(j);     // cerrada, o todavía sin identificarse
    }
  }
  verCalendario();
}

/* ---------------------------------------------------------- identidad */
let elegido = null;

function elegir(nombre) {
  if (app.yo && app.yo.nombre === nombre && app.datos && app.jornada) {
    location.hash = '#resp-' + app.jornada.id; ruta(); return;
  }
  elegido = nombre;
  $('#codNombre').textContent = nombre;
  $('#inCodigo').value = '';
  $('#errCodigo').hidden = true;
  vista('vCodigo');
  setTimeout(() => { try { $('#inCodigo').focus(); } catch(e){} }, 50);
}

function volverNomina() {
  if (app.jornada) { location.hash = '#dia-' + app.jornada.id; ruta(); }
  else { location.hash = ''; ruta(); }
}

async function confirmarCodigo(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const err = $('#errCodigo');
  err.hidden = true;
  const codigo = $('#inCodigo').value.trim();
  btn.disabled = true; btn.textContent = 'Comprobando…';
  try {
    const r = await api({action:'entrar', nombre: elegido, codigo});
    app.yo = {nombre: r.nombre, codigo};
    ls.set(LS_YO, app.yo);
    await cargar(false);
    if (app.jornada) location.hash = '#resp-' + app.jornada.id;
    ruta();
  } catch (ex) {
    err.textContent = esRed(ex.message)
      ? 'No hay conexión con el servidor. Revisa tu internet y vuelve a intentar.'
      : /c[oó]digo personal no coincide/i.test(ex.message)
        ? 'Esos dígitos no calzan con tu RUT. Son los 4 de antes del guion.'
        : ex.message;
    err.hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Entrar';
}

function salir() {
  const b = $('#btnSalir');
  if (b.dataset.c !== '1') {
    b.dataset.c = '1'; b.textContent = 'Toca otra vez para salir';
    setTimeout(() => { b.dataset.c=''; b.textContent='No soy yo'; }, 4000);
    return;
  }
  app.yo = null; app.datos = null; ls.del(LS_YO);
  location.hash = ''; ruta();
}

/** Trae el dosier de quien ya se identificó. En modo silencioso (al abrir la
 *  página) un fallo no bloquea nada: se olvida la identidad y sigue el calendario. */
async function cargar(silencioso) {
  try {
    app.datos = await api({action:'agenda', ...yoApi()});
    app.conectado = true;
    if (app.datos.nomina && app.datos.nomina.length) app.nomina = app.datos.nomina;
    $('#quienSoy').innerHTML = `<b>${esc(app.datos.nombre)}</b><small>${esc(app.datos.situacion || 'Funcionario del CEIA')}</small>`;
    ruta();
    reintentar();
    return true;
  } catch (ex) {
    app.conectado = false;
    if (!silencioso) throw ex;
    app.yo = null; app.datos = null; ls.del(LS_YO);
    toast(esRed(ex.message) ? 'Sin conexión con el servidor.' : ex.message);
    ruta();
    return false;
  }
}

/* Presentación de un bloque, cuando necesita decir de dónde viene y para qué.
   Se muestra bajo el título de la parte, antes de la primera pregunta. */
const NOTA_PARTE = {
  '2 · Condiciones de seguridad': `<div class="solicita">
    <p class="sqk">Solicitud del Comité Paritario de Higiene y Seguridad</p>
    <p>Aprovechamos esta jornada para pedirte algo del comité: que mires tu propio puesto de trabajo.
      <b>No es una inspección ni una evaluación de tu desempeño</b> — nadie va a ser observado.
      Lo que nos sirve es lo que tú ves todos los días y nosotros no.</p>
    <p class="sqf">Con lo que respondan los 35 armamos la matriz de riesgos y el plan del próximo año.</p>
  </div>`,
  '3 · Mi función en el PEI': `<div class="solicita">
    <p class="sqk">Las mismas preguntas para los seis perfiles</p>
    <p>Este bloque no evalúa a nadie ni revisa si cumpliste tus funciones. Busca <b>dibujar el mapa</b>:
      qué te toca a ti, qué le pasas a otro y dónde ese camino no está claro.
      Lo responden las seis funciones del establecimiento, dirección incluida.</p>
  </div>`
};

/* ---------------------------------------------------------- calendario */

/* Feriados y media jornada. Van aquí y no en la base porque son pocos, fijos
   y conviene verlos de un vistazo al revisar el calendario. */
const FERIADOS = {
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad'
};
const MEDIA_JORNADA = {
  '2026-12-24': 'Solo jornada de mañana',
  '2026-12-30': 'Solo jornada de mañana'
};
const esViernes = (f) => new Date(f + 'T12:00:00').getDay() === 5;
const esFinDeSemana = (f) => [0,6].includes(new Date(f + 'T12:00:00').getDay());

/* Mientras esto esté en true los candados se ven, pero no trancan nada: el
   equipo directivo puede revisar las dos jornadas completas antes del lunes.
   Se cambia a false cuando Juan Pablo diga que ya revisaron. */
const MODO_REVISION = true;

/* Hasta dónde llega el calendario de trabajo. Los días hábiles de este tramo
   que todavía no tienen actividad igual muestran su candado, para que se vea
   la forma completa del plan. */
const ULTIMO_DIA = '2026-12-30';

function hechas(jornadaId) {
  if (!app.datos) return null;
  return (app.datos.respondidas || []).find(r => r.jornadaId === jornadaId) || null;
}

/** La actividad se abre SOLO el día que corresponde. Antes está cerrada
 *  porque todavía no toca; después, porque ya pasó. */
const abiertaHoy = (j) => !!app.cfg && app.cfg.hoy === j.fecha;

/** El estado que se DIBUJA en el calendario: el candado como va a quedar. */
function estadoJornada(j) {
  if (abiertaHoy(j)) return hechas(j.id) ? 'lista' : 'abierta';
  if (hechas(j.id)) return 'lista';
  return app.cfg.hoy < j.fecha ? 'porvenir' : 'cerrada';
}

/** Si de verdad se puede entrar. En modo revisión, siempre. */
function puedeEntrar(j) {
  if (MODO_REVISION) return true;
  const st = estadoJornada(j);
  return st === 'abierta' || st === 'lista';
}
const ETIQ = {
  lista:    {t:'✓ Respondida',       c:'lista'},
  abierta:  {t:'🔓 Abierta hoy',     c:'abierta'},
  porvenir: {t:'🔒 Se abre el día',  c:''},
  cerrada:  {t:'🔒 Cerrada',         c:''}
};

function verCalendario() {
  app.jornada = null;
  vista('vCalendario');
  const js = app.cfg.jornadas || [];
  const hoy = app.cfg.hoy;
  if (!js.length) { $('#calendario').innerHTML = '<p class="muted">Todavía no hay jornadas cargadas.</p>'; return; }
  const porFecha = {};
  js.forEach(j => porFecha[j.fecha] = j);

  // Solo diciembre. El lunes 30 de noviembre cae justo en la casilla que
  // diciembre deja vacía al partir en martes, así que se dibuja ahí en vez
  // de arrastrar un mes entero de días sin nada.
  const ult = new Date(js[js.length-1].fecha + 'T12:00:00');
  const anio = ult.getFullYear();
  const mes = 11;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const celda = (fecha, numero, deOtroMes) => {
    const k = iso(fecha);
    const j = porFecha[k];
    const hoyCl = k === hoy ? ' hoy' : '';
    const sufijo = deOtroMes ? ` <small class="mesAnt">${MESES[fecha.getMonth()].slice(0,3)}</small>` : '';
    const num = `<span class="num">${numero}${sufijo}</span>`;

    // El feriado manda sobre todo lo demás, incluso si cae viernes.
    if (FERIADOS[k]) {
      return `<span class="dia feriado${hoyCl}" title="Feriado · ${esc(FERIADOS[k])}">
        ${num}<span class="eti">${esc(FERIADOS[k])}</span></span>`;
    }
    const med = MEDIA_JORNADA[k];
    // Los viernes se trabaja, pero no llevan actividad ni candado.
    if (esViernes(k)) {
      return `<span class="dia${med?' media':''}${hoyCl}" title="Viernes · día de trabajo, sin actividad">
        ${num}${med?'<span class="eti">½ mañana</span>':''}</span>`;
    }
    if (!j) {
      // Día hábil dentro del tramo: candado de marcador, la actividad va después.
      const enTramo = !esFinDeSemana(k) && k >= js[0].fecha && k <= ULTIMO_DIA;
      if (!enTramo) {
        return `<span class="dia${med?' media':''}${hoyCl}" ${med?`title="${esc(med)}"`:''}>
          ${num}${med?'<span class="eti">½ mañana</span>':''}</span>`;
      }
      return `<span class="dia porprogramar${med?' media':''}${hoyCl}" title="Actividad por definir">
        <span class="cand" aria-hidden="true">🔒</span>
        ${num}<span class="eti">${med ? '½ mañana' : 'por programar'}</span></span>`;
    }

    const st = estadoJornada(j);
    const tono = st === 'lista' ? 'lista' : st === 'abierta' ? 'abierta' : 'trancada';
    const candado = st === 'lista' ? '✓' : st === 'abierta' ? '🔓' : '🔒';
    const tit = st === 'abierta' ? 'Abierta hoy' : st === 'lista' ? 'Ya respondida'
              : st === 'porvenir' ? 'Se abre el ' + fdateLarga(j.fecha) : 'Cerrada: la actividad era el ' + fdateLarga(j.fecha);
    // La sigla identifica el tema de la jornada en la casilla: PEI, RICE…
    const sigla = j.sigla || j.titulo.split(' ')[0];
    const resto = j.titulo.replace(sigla, '').split('·')[0].trim() || j.subtitulo || '';
    return `<a class="dia jor tema-${esc(sigla.toLowerCase())} ${tono}${hoyCl}" href="#dia-${esc(j.id)}"
      title="${esc(j.titulo)} · ${esc(tit)}">
      <span class="cand" aria-hidden="true">${candado}</span>
      ${num}<span class="sigla">${esc(sigla)}</span><span class="eti">${esc(resto.slice(0,16))}</span></a>`;
  };

  const primero = (new Date(anio, mes, 1).getDay() + 6) % 7;
  const total = new Date(anio, mes+1, 0).getDate();
  let celdas = '';
  for (let k = primero; k > 0; k--) {
    const dd = new Date(anio, mes, 1 - k);
    celdas += celda(dd, dd.getDate(), true);
  }
  for (let dd = 1; dd <= total; dd++) celdas += celda(new Date(anio, mes, dd), dd, false);

  $('#calendario').innerHTML = `<div class="mes"><h3>${MESES[mes]} ${anio}</h3>
    <div class="sem">${DIAS.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="dias">${celdas}</div></div>
    <div class="claves">
      <span><i class="mt abierta"></i>🔓 abierta ese día</span>
      <span><i class="mt trancada"></i>🔒 cerrada</span>
      <span><i class="mt porprog"></i>🔒 por programar</span>
      <span><i class="mt lista"></i>✓ respondida</span>
      <span><i class="mt feriado"></i>feriado</span>
      <span><i class="mt media"></i>½ solo mañana</span>
      <span><i class="mt"></i>día de trabajo sin actividad</span>
    </div>
    ${MODO_REVISION ? `<div class="aviso" style="margin-top:14px">
      <b>Modo revisión.</b> Los candados muestran cómo va a quedar, pero por ahora
      <b>no trancan nada</b>: las dos jornadas se pueden abrir y recorrer completas.
      Se activan cuando el equipo directivo dé el visto bueno.</div>` : ''}`;

  if (app.yo && app.datos) {
    const listas = js.filter(j => hechas(j.id)).length;
    $('#miAvance').innerHTML = `<div class="barra"><i style="width:${Math.round(listas/js.length*100)}%"></i></div>
      <p class="muted" style="margin:0">Llevas ${listas} de ${js.length} jornadas respondidas.</p>`;
  } else {
    $('#miAvance').innerHTML = `<p class="muted" style="margin:0">El material de cada día está disponible
      desde ya, aunque la actividad todavía no abra.</p>`;
  }

  $('#listaJornadas').innerHTML = js.map(j => {
    const st = estadoJornada(j); const e = ETIQ[st];
    return `<a class="btn" style="width:100%;justify-content:space-between;text-align:left;margin-bottom:8px" href="#dia-${esc(j.id)}">
      <span><b>${esc(j.titulo)}</b><br><small class="muted">${fdateLarga(j.fecha)} · ${j.minutos} min · ${e.t}</small></span>
      <span>→</span></a>`;
  }).join('');
}

/* ---------------------------------------------------------- día: nómina */
const nrm = (s) => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function verDia(j) {
  app.jornada = j;
  vista('vDia');
  const nom = app.nomina || [];
  const list = nom.filter(f => f.hechas.includes(j.id)).length;

  $('#diaCab').innerHTML = `
    <button class="linkbtn" onclick="location.hash=''">← Volver al calendario</button>
    <p class="eyebrow">${esc(fdateLarga(j.fecha))}</p>
    <h1>${esc(j.titulo)}</h1>
    <p class="lead">${esc(j.subtitulo || '')} · ${j.minutos} minutos aprox.</p>
    <div class="info"><b>Cada uno responde en su horario.</b> No hay hora fija: la actividad queda abierta
      para mañana, tarde y noche, y cada funcionario la llena cuando su jornada se lo permita.</div>`;

  $('#diaAvance').innerHTML = `<div class="kpis">
      <div><b>${list}</b><span class="muted">de ${nom.length} ya respondieron</span></div>
      <div><b>${nom.length - list}</b><span class="muted">pendientes</span></div>
    </div><div class="barra"><i style="width:${nom.length?Math.round(list/nom.length*100):0}%"></i></div>`;

  // El material de estudio es público: se ve y se escucha sin identificarse.
  $('#diaMaterial').innerHTML = `
    <h2>Material de la jornada</h2>
    <p class="muted">Puedes verlo y escucharlo ahora mismo, sin identificarte.
      Es el documento sobre el que vas a trabajar.</p>
    <div class="materiales">
      <a class="mini" href="pei/index.html" target="_blank" rel="noopener">
        <span class="lienzo">
          <span class="lam">
            <span class="lamTag">CEIA Juanita Zúñiga Fuentes · Parral</span>
            <span class="lamTit">Proyecto Educativo Institucional<br>2027–2030</span>
            <span class="lamSub">Principales novedades · Jornada de apropiación</span>
          </span>
          <span class="play" aria-hidden="true">▶</span>
          <span class="dur">15:50</span>
        </span>
        <span class="miniPie">
          <b>Presentación del PEI, narrada</b>
          <small>44 láminas con audio · avanza a tu ritmo, puedes pausar y volver atrás</small>
        </span>
      </a>

      <div class="mini" id="videoPei">
        <button class="lienzo tapa" type="button" data-yt="${VIDEO_PEI}"
                aria-label="Reproducir el resumen en video del PEI">
          <img src="https://i.ytimg.com/vi/${VIDEO_PEI}/hqdefault.jpg" alt="" loading="lazy">
          <span class="play" aria-hidden="true">▶</span>
          <span class="dur">YouTube</span>
        </button>
        <span class="miniPie">
          <b>Resumen del PEI en video</b>
          <small>Versión corta y conversada, si prefieres escuchar antes de leer</small>
        </span>
      </div>
    </div>

    <h3 class="subt">Videos de apoyo</h3>
    <p class="muted" style="margin:0 0 10px">Dos cápsulas cortas para ver antes de responder.
      Se reproducen aquí mismo, sin salir de la página.</p>
    <div class="materiales vert">
      ${APOYO.map(v => `
        <div class="mini corto" data-vid="${esc(v.archivo)}">
          <button class="lienzo tapa" type="button" aria-label="Reproducir ${esc(v.titulo)}">
            <img src="video/${esc(v.archivo)}.jpg" alt="" loading="lazy">
            <span class="play" aria-hidden="true">▶</span>
            <span class="dur">${esc(v.dur)}</span>
          </button>
          <span class="miniPie"><b>${esc(v.titulo)}</b><small>${esc(v.bajada)}</small></span>
        </div>`).join('')}
    </div>
    ${j.descripcion ? `<div class="info" style="margin-top:12px">${esc(j.descripcion)}</div>` : ''}
    <div class="aviso" style="margin-top:12px">
      <b>Horario de esta jornada:</b> abre a las 08:00 y cierra a la medianoche del
      ${esc(fdateLarga(j.fecha))}. Respóndela dentro de tu turno de trabajo.
    </div>`;

  if ((j.sigla || 'PEI') === 'RICE') {
    $('#diaMaterial').innerHTML = `<h2>Material de la jornada · RICE</h2>
      <p class="muted">Recorre la presentación general antes de responder. Las tres partes incluyen 50 láminas con narración de Silvana.</p>
      ${vistaPreviaRice()}
      <p>Parte A: Comunidad y funcionamiento · Parte B: Seguridad y convivencia · Parte C: Protocolos y anexos.</p>
      <p class="muted">Duración de las locuciones: 22 minutos. Puedes pausar, avanzar y volver a cualquier lámina.</p>`;
  }

  // Los videos propios se cargan solo al tocarlos.
  document.querySelectorAll('#diaMaterial .corto .tapa').forEach(b =>
    b.addEventListener('click', () => {
      const id = b.closest('.corto').dataset.vid;
      const d = document.createElement('div');
      d.className = 'lienzo';
      d.innerHTML = `<video src="video/${id}.mp4" poster="video/${id}.jpg" controls autoplay playsinline></video>`;
      b.replaceWith(d);
    }, {once:true}));

  const tapa = document.querySelector('#videoPei .tapa');
  if (tapa) tapa.addEventListener('click', () => {
    const d = document.createElement('div');
    d.className = 'lienzo';
    d.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${tapa.dataset.yt}?autoplay=1&rel=0"
      title="Resumen del PEI en video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    tapa.replaceWith(d);
  }, {once:true});

  $('#buscaNomina').value = '';
  pintarNomina(j, '');

  const reg = hechas(j.id);
  const st = estadoJornada(j);
  const puede = puedeEntrar(j);

  const muestra = MODO_REVISION && st !== 'abierta' && st !== 'lista'
    ? `<div class="aviso" style="margin-bottom:12px"><b>Modo revisión.</b> El ${esc(fdateLarga(j.fecha))}
        esta jornada estará ${st === 'porvenir' ? 'todavía cerrada' : 'ya cerrada'} con candado.
        Ahora la puedes abrir igual para revisarla.</div>` : '';

  $('#diaBoton').innerHTML = muestra + (puede
    ? ((app.yo && app.datos)
        ? `<a class="btn pri" style="width:100%" href="#resp-${esc(j.id)}">
             ${reg ? 'Ver o corregir mis respuestas' : 'Abrir mi dosier y responder'}</a>`
        : '')
    : `<div class="trancado">
         <span class="tcIco" aria-hidden="true">🔒</span>
         <span><b>${st === 'porvenir' ? 'Esta jornada todavía no abre' : 'Esta jornada ya cerró'}</b>
           ${st === 'porvenir'
             ? `Se habilita el <b>${esc(fdateLarga(j.fecha))}</b> a las 08:00 y se cierra a medianoche.`
             : `Se respondía el <b>${esc(fdateLarga(j.fecha))}</b>. Si no alcanzaste, habla con el equipo directivo.`}
           <small>El material de arriba lo puedes ver cuando quieras.</small></span>
       </div>`);
}

/** Pinta la nómina filtrada. Cada palabra que escribes busca por el comienzo
 *  de cualquier parte del nombre, sin importar tildes ni el orden. */
function pintarNomina(j, consulta) {
  if (!j) return;
  const nom = app.nomina || [];
  const trozos = nrm(consulta).split(' ').filter(Boolean);
  const vis = nom.filter(f => {
    if (!trozos.length) return true;
    const partes = nrm(f.nombre).split(' ');
    return trozos.every(t => partes.some(p => p.startsWith(t)));
  });

  const yoNombre = app.datos ? app.datos.nombre : (app.yo ? app.yo.nombre : null);
  $('#nomina').innerHTML = vis.map(f => {
    const ok = f.hechas.includes(j.id);
    const yo = f.nombre === yoNombre;
    return `<button type="button" class="fn ${ok?'ok':''} ${yo?'yo':''}" data-nombre="${esc(f.nombre)}">
      <span class="ini">${esc(f.nombre.slice(0,2).toUpperCase())}</span>
      <span class="n"><b>${esc(f.nombre)}${yo?' (tú)':''}</b><small>${esc(f.funcion || f.situacion || '')}${f.licencia?' · licencia':''}</small></span>
      <span class="mk">${ok?'✓':'›'}</span></button>`;
  }).join('');

  $('#nominaVacia').hidden = vis.length > 0;
  $('#nominaCuenta').textContent = trozos.length
    ? `${vis.length} de ${nom.length} nombres`
    : `${nom.length} funcionarios`;
}

/* ---------------------------------------------------------- jornada: dosier */
let abrioDosier = 0;

function verJornada(j) {
  abrioDosier = Date.now();
  const completa = ((app.datos && app.datos.jornadas) || []).find(x => x.id === j.id);
  if (!completa || !completa.preguntas) { volverNomina(); return; }
  j = completa;
  app.jornada = j;
  vista('vJornada');
  const reg = hechas(j.id);
  const prev = (reg && itemsAObjeto(reg.items)) || ls.get(LS_BORR + j.id, {});
  const caso = (app.datos.casos || {})[j.id] || app.datos.caso;
  const usaCaso = j.preguntas.some(p => p.id.startsWith('c'));

  $('#jCab').innerHTML = `
    <button class="linkbtn" onclick="location.hash='#dia-${esc(j.id)}'">← Volver a la nómina del día</button>
    <p class="eyebrow">${esc(fdateLarga(j.fecha))} · ${j.minutos} min</p>
    <h1>${esc(j.titulo)}</h1>
    <p class="lead">${esc(j.descripcion || '')}</p>
    ${reg ? `<div class="info">Ya respondiste esta jornada${reg.fecha?' el '+new Date(reg.fecha).toLocaleString('es-CL'):''}.
      Puedes corregir y volver a enviar.${reg.fueraDePlazo?' Quedó registrada fuera de plazo.':''}</div>` : ''}
    ${!reg && app.datos.hoy > j.fecha ? `<div class="aviso">El plazo venció, pero puedes responder igual:
      quedará marcada como fuera de plazo y tu participación cuenta.</div>` : ''}`;

  // Su perfil: con quiénes contrasta y por qué le tocó ese caso.
  const pf = app.datos.perfil;
  const banda = pf ? `
    <div class="perfil">
      <span class="pfIco" aria-hidden="true">${{aula:'✎',linea:'◉',pie:'◈',convivencia:'♦',soporte:'⚙',direccion:'▲'}[pf.id] || '●'}</span>
      <span class="pfTx">
        <small>Tu perfil en esta jornada</small>
        <b>${esc(pf.nombre)}</b>
        <span>${esc(pf.descripcion || '')}</span>
      </span>
      <span class="pfN">${pf.personas}<i>personas</i></span>
    </div>
    <p class="muted" style="margin:10px 0 0">Además del trabajo común, tienes preguntas propias de tu función
      y el caso donde esa función era clave. Nadie compara perfiles entre sí.</p>` : '';

  // Presentación y documentos: cada tema trae el suyo.
  const mat = MATERIAL[j.sigla || 'PEI'] || null;
  $('#jDosier').innerHTML = `
    ${banda}
    <h2${pf?' style="margin-top:18px"':''}>Dosier del día</h2>
    ${mat ? ((j.sigla || 'PEI') === 'RICE' ? vistaPreviaRice() : `<a class="btn" style="width:100%;margin-bottom:8px" href="${esc(mat.url)}" target="_blank" rel="noopener">
      ▶ ${esc(mat.titulo)}</a>
    <p class="muted" style="margin:0">${esc(mat.nota)}</p>`)
    : `<div class="aviso" style="margin:0">La presentación y los videos de esta jornada se publican aquí
      antes del día. Puedes responder igual: las preguntas no dependen de ese material.</div>`}`;

  // El caso, mes a mes
  $('#jCaso').hidden = !usaCaso;
  if (usaCaso) {
    if (!caso) {
      $('#jCaso').innerHTML = `<div class="aviso">Todavía no tienes un caso asignado. Avisa al equipo directivo.</div>`;
    } else {
      sim = {caso, paso: -1, decidido: [], abierto: false};
      pintarCaso();
    }
  }

  // Preguntas, agrupadas por parte
  const partes = [];
  j.preguntas.forEach(p => {
    const nom = p.parte || 'Preguntas';
    let g = partes.find(x => x.nombre === nom);
    if (!g) partes.push(g = {nombre: nom, ps: []});
    g.ps.push(p);
  });
  let n = 0;
  $('#formJ').innerHTML = partes.map(g => `
    <fieldset class="q" style="border-color:#2C3A61"><legend>${esc(g.nombre)}</legend>
    ${NOTA_PARTE[g.nombre] || ''}
    ${g.ps.map(p => campo(p, ++n, prev[p.id])).join('')}</fieldset>`).join('')
    + `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px">
        <button class="btn pri" type="submit">${reg ? 'Actualizar mis respuestas' : 'Enviar mis respuestas'}</button>
        <span class="muted">Se guarda en este equipo mientras escribes.</span></div>
       <div class="aviso" style="margin-top:12px">Recuerda: esto se completa <b>dentro de tu jornada
       de trabajo</b>, entre las 08:00 y la medianoche del día de la actividad. Queda como evidencia
       de tu participación, así que no corresponde llevárselo para la casa.</div>`;

  $('#formJ').oninput = () => ls.set(LS_BORR + j.id, leerForm(j));
  $('#formJ').onsubmit = (e) => { e.preventDefault(); enviar(j); };
  document.querySelectorAll('#formJ textarea[data-c]').forEach(t => {
    const p = () => contador(t); t.addEventListener('input', p); p();
  });
  // Al pararse en una pregunta, el tutor asoma un globo. No consulta nada:
  // es solo una invitación. El gasto ocurre si la persona decide tocarlo.
  document.querySelectorAll('#formJ [name]').forEach(c =>
    c.addEventListener('focus', () => asomar(c.getAttribute('name'))));

  prepararTutor(j);
  window.scrollTo(0,0);
}

function itemsAObjeto(items) {
  const o = {};
  (items || []).forEach(i => o[i.id] = i.respuesta);
  return o;
}

function campo(p, n, val) {
  const req = p.opcional ? '' : 'required';
  const secc = p.informe ? `<span class="secc">${esc({fortalezas:'Fortalezas',areasMejora:'Mejoras',acciones:'Acciones',impacto:'Impacto'}[p.informe]||p.informe)}</span>` : '';
  const cab = `<p class="enun"><span class="qn">${n}</span><span style="flex:1">${esc(p.enunciado)}</span>${secc}</p>`;

  if (p.tipo === 'escala') {
    const o = [1,2,3,4,5].map(v =>
      `<label><input type="radio" name="${esc(p.id)}" value="${v}" ${String(val)===String(v)?'checked':''} ${req}><span>${v}</span></label>`).join('');
    return `<div style="margin-bottom:16px">${cab}<div class="escala"><small>${esc(p.min||'')}</small>${o}<small style="text-align:right">${esc(p.max||'')}</small></div></div>`;
  }
  if (p.tipo === 'opcion') {
    const o = (p.opciones||[]).map(x =>
      `<label><input type="radio" name="${esc(p.id)}" value="${esc(x)}" ${val===x?'checked':''} ${req}><span>${esc(x)}</span></label>`).join('');
    return `<div style="margin-bottom:16px">${cab}<div class="ops">${o}</div></div>`;
  }
  if (p.tipo === 'multiple') {
    const ya = String(val || '').split(' | ').filter(Boolean);
    const o = (p.opciones||[]).map((x,i) =>
      `<label class="mx"><input type="checkbox" name="${esc(p.id)}" value="${esc(x)}"
        ${ya.includes(x)?'checked':''}><span>${esc(x)}</span></label>`).join('');
    return `<div style="margin-bottom:16px">${cab}
      <p class="muted" style="margin:-2px 0 8px">Marca todas las que correspondan${p.opcional?', o ninguna':''}.</p>
      <div class="ops multi">${o}</div></div>`;
  }
  if (p.tipo === 'confirmacion') {
    return `<div style="margin-bottom:16px"><label class="chk">
      <input type="checkbox" name="${esc(p.id)}" value="si" ${val==='si'?'checked':''} ${req}>
      <span>${esc(p.enunciado)}</span></label></div>`;
  }
  return `<div style="margin-bottom:16px">${cab}
    <textarea class="in" name="${esc(p.id)}" data-c="1" rows="4" ${req}
      placeholder="Escribe tu respuesta…">${esc(val||'')}</textarea><span class="cuenta"></span></div>`;
}

function contador(t) {
  const n = palabras(t.value);
  const c = t.parentElement.querySelector('.cuenta');
  if (!c) return;
  c.textContent = `${n} de ${MAX_PALABRAS} palabras`;
  c.className = 'cuenta' + (n > MAX_PALABRAS ? ' pasado' : n > MAX_PALABRAS*0.9 ? ' cerca' : '');
}

function leerForm(j) {
  const f = $('#formJ'); const r = {};
  j.preguntas.forEach(p => {
    const uno = f.querySelector(`[name="${p.id}"]`);
    if (!uno) { r[p.id] = ''; return; }
    if (p.tipo === 'escala' || p.tipo === 'opcion') {
      const c = f.querySelector(`input[name="${p.id}"]:checked`); r[p.id] = c ? c.value : '';
    } else if (p.tipo === 'multiple') {
      r[p.id] = [...f.querySelectorAll(`input[name="${p.id}"]:checked`)].map(c => c.value).join(' | ');
    } else if (p.tipo === 'confirmacion') { r[p.id] = uno.checked ? 'si' : ''; }
    else { r[p.id] = uno.value.trim(); }
  });
  return r;
}

async function enviar(j) {
  const resp = leerForm(j);
  const larga = j.preguntas.find(p => p.tipo === 'texto' && palabras(resp[p.id]) > MAX_PALABRAS);
  if (larga) {
    toast(`La pregunta "${larga.enunciado.slice(0,40)}…" pasa las ${MAX_PALABRAS} palabras. Acórtala antes de enviar.`, 6000);
    const t = $('#formJ').querySelector(`[name="${larga.id}"]`);
    if (t) { t.focus(); t.scrollIntoView({behavior:'smooth', block:'center'}); }
    return;
  }
  const items = j.preguntas.map(p => ({id:p.id, enunciado:p.enunciado, informe:p.informe||'', respuesta:resp[p.id]||''}));
  // El recorrido mes a mes viaja junto a las respuestas: al equipo directivo le sirve
  // saber en qué mes habría actuado cada función.
  const rec = resumenSim();
  if (rec) items.push({id:'sim', enunciado:'Recorrido del caso: en qué punto habría actuado', informe:'', respuesta:rec});
  // Datos internos para el panel. Empiezan con "_" y no se muestran como respuestas.
  if (abrioDosier) items.push({id:'_tiempo', enunciado:'Minutos en la plataforma', informe:'',
    respuesta: String(Math.max(1, Math.round((Date.now() - abrioDosier)/1000)))});
  const mesSim = mesEnQueActuaria();
  if (mesSim !== null) items.push({id:'_mes', enunciado:'Mes en que habría actuado', informe:'', respuesta: mesSim});
  const btn = $('#formJ').querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await api({action:'guardar', jornadaId:j.id, casoId:(app.datos.caso||{}).id||'', items, ...yoApi()});
    ls.del(LS_BORR + j.id);
    (app.datos.respondidas = app.datos.respondidas.filter(x => x.jornadaId !== j.id)).push({
      jornadaId:j.id, items, fueraDePlazo:r.fueraDePlazo, fecha:new Date().toISOString()
    });
    const yo = (app.datos.nomina||[]).find(f => f.nombre === app.datos.nombre);
    if (yo && !yo.hechas.includes(j.id)) yo.hechas.push(j.id);
    toast(r.fueraDePlazo ? '✓ Enviado. Quedó marcado fuera de plazo, pero tu participación cuenta.'
                         : '✓ Enviado. ¡Gracias!');
    location.hash = '';
  } catch (ex) {
    if (esRed(ex.message)) {
      const p = ls.get(LS_PEND, []);
      p.push({jornadaId:j.id, casoId:(app.datos.caso||{}).id||'', items, nombre:app.yo.nombre, codigo:app.yo.codigo});
      ls.set(LS_PEND, p);
      toast('Sin conexión: tus respuestas quedaron guardadas aquí y se enviarán solas cuando vuelva el internet.', 6000);
      location.hash = '';
    } else { toast(ex.message, 6000); }
  }
  btn.disabled = false;
}

async function reintentar() {
  const p = ls.get(LS_PEND, []);
  if (!p.length || !app.yo) return;
  const quedan = [];
  for (const x of p) {
    try { await api({action:'guardar', ...x}); } catch (e) { quedan.push(x); }
  }
  ls.set(LS_PEND, quedan);
  if (quedan.length < p.length) { toast('✓ Se enviaron las respuestas que estaban pendientes.'); cargar(); }
}

/* ---------------------------------------------------- asistente flotante */
/* El globo es gratis: sale de la app, nunca del servidor. Solo invita.
   La consulta de verdad se paga cuando la persona abre el tutor y pregunta. */
let globoTimer = null;
let globoVisto = {};

const INVITA = [
  'Si tienes dudas con esta, pregúntame.',
  '¿Te trabaste? Puedo darte una pista.',
  '¿No se entiende la pregunta? Te la explico.',
  'Cuando tengas un borrador, te lo reviso.',
  '¿Quieres saber qué dice el PEI de esto?'
];

function esconderGlobo() {
  if (globoTimer) { clearTimeout(globoTimer); globoTimer = null; }
  const g = $('#tutorGlobo');
  if (g) g.hidden = true;
}

/** Asoma el globo junto a una pregunta. Una vez por pregunta, para no cansar. */
function asomar(pid) {
  if (!pid || globoVisto[pid]) return;
  if (!$('#tutorPanel').hidden) return;        // ya está conversando
  globoVisto[pid] = true;
  const g = $('#tutorGlobo');
  const i = Object.keys(globoVisto).length - 1;
  g.dataset.p = pid;
  g.innerHTML = `<b>Tutor</b>${esc(INVITA[i % INVITA.length])}`;
  g.hidden = false;
  $('#tutorBtn').classList.add('late');
  if (globoTimer) clearTimeout(globoTimer);
  globoTimer = setTimeout(() => {
    g.hidden = true;
    $('#tutorBtn').classList.remove('late');
  }, 9000);
}

function abrirTutor(pid) {
  esconderGlobo();
  $('#tutorBtn').classList.remove('late');
  if (pid) { const sel = $('#tutorPregunta'); if ([...sel.options].some(o => o.value === pid)) sel.value = pid; }
  $('#tutorPanel').hidden = false;
  const c = $('#tutorMsgs'); if (c) c.scrollTop = c.scrollHeight;
  setTimeout(() => { try { $('#tutorTexto').focus(); } catch(e){} }, 60);
}

function cerrarTutor() { $('#tutorPanel').hidden = true; }

/* ---------------------------------------------------------- tutor */
/* Tres de los cuatro botones responden al tiro, con material ya escrito y
   guardado: no pasan por el modelo y no cuestan nada. Solo "revisa mi
   borrador" y las preguntas escritas a mano consultan de verdad, porque
   ahí el texto es distinto cada vez y no se puede tener preparado. */
const MODOS = {
  pista:    {chip:'💡 Dame una pista',     guardado:true,  msg:'Dame una pista para esta pregunta.'},
  explicar: {chip:'❓ No entiendo',         guardado:true,  msg:'No entiendo bien lo que pide esta pregunta. ¿Me la explicas con otras palabras?'},
  fuente:   {chip:'📄 ¿Qué dice el PEI?',  guardado:'cita', msg:'¿Qué dicen la presentación y los documentos del PEI sobre esta pregunta?'},
  revisar:  {chip:'✍️ Revisa mi borrador', guardado:false, msg:'Revisa mi borrador y dime qué puedo mejorar, sin escribirlo por mí.'}
};

/* Respuestas ya escritas, que viven en la base junto a cada pregunta. */
let vueltaPista = {};
function respuestaGuardada(modo, p) {
  if (modo === 'explicar') {
    return p.ayuda || `Léela así: "${p.enunciado}". No hay respuesta correcta: importa tu mirada, desde tu función y tu horario, y si puedes, con un ejemplo real.`;
  }
  const ps = p.pistas || [];
  if (ps.length) {                       // van rotando, no siempre la misma
    const i = (vueltaPista[p.id] || 0) % ps.length;
    vueltaPista[p.id] = i + 1;
    return ps[i] + (ps.length > 1 && i + 1 < ps.length ? '\n\n¿Quieres otra pista? Toca el botón de nuevo.' : '');
  }
  return p.tipo === 'escala'
    ? 'Piensa en lo que ves día a día, no en lo ideal. Si dudas entre dos números, pregúntate qué tendría que pasar para subir un punto.'
    : p.tipo === 'opcion'
    ? 'Elige donde un cambio pequeño tendría el mayor efecto en los estudiantes.'
    : 'Prueba así:\n- Una idea principal en una frase.\n- Un ejemplo real de tu jornada.\n- Qué significa eso para el PEI.';
}

function prepararTutor(j) {
  globoVisto = {};
  vueltaPista = {};
  $('#tutorPanel').hidden = true;
  esconderGlobo();
  const ps = j.preguntas.filter(p => p.tipo !== 'confirmacion');
  $('#tutorPregunta').innerHTML = ps.map((p,i) =>
    `<option value="${esc(p.id)}">${i+1}. ${esc(p.enunciado.slice(0,62))}${p.enunciado.length>62?'…':''}</option>`).join('');
  $('#tutorChips').innerHTML = Object.entries(MODOS).map(([k,v]) =>
    `<button type="button" class="chip${v.guardado ? ' ya' : ''}" data-m="${k}"
      title="${v.guardado ? 'Respuesta inmediata, ya preparada' : 'Consulta al tutor'}">${v.chip}</button>`).join('')
    + '<span class="chipNota">Los de borde verde responden al tiro.</span>';
  document.querySelectorAll('#tutorChips [data-m]').forEach(b =>
    b.addEventListener('click', () => pedirTutor(b.dataset.m)));
  $('#tutorForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#tutorTexto').value.trim();
    if (!t) return;
    $('#tutorTexto').value = '';
    pedirTutor('libre', t);
  };
  const h = app.chat[j.id] = app.chat[j.id] || [];
  if (!h.length) h.push({rol:'tutor', texto:
    `Hola, ${String(app.datos.nombre).split(' ').slice(-2).join(' ')}. Soy el tutor de la jornada. No respondo por ti, pero te ayudo a pensar.

Los tres primeros botones de abajo te contestan al tiro: la pista y la explicación ya están escritas para cada pregunta, y las láminas del PEI te las muestro tal cual. Guarda las consultas escritas para lo que de verdad necesites conversar.`});
  pintarChat(j);
}

function pintarChat(j) {
  const h = app.chat[j.id] || [];
  $('#tutorMsgs').innerHTML = h.map(m => `<div class="msg ${m.rol==='yo'?'yo':'tutor'}${m.pensando?' pensando':''}${m.guardado?' guardado':''}">${
    formato(m.texto)}${m.fuentes&&m.fuentes.length?`<span class="fu">Fuentes: ${m.fuentes.map(esc).join(' · ')}</span>`:''}</div>`).join('');
  const c = $('#tutorMsgs'); c.scrollTop = c.scrollHeight;
}

function formato(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/^\s*[-•]\s+(.+)$/gm,'<span class="li">• $1</span>')
    .replace(/\n/g,'<br>');
}

async function pedirTutor(modo, libre) {
  const j = app.jornada;
  const h = app.chat[j.id];
  const pid = $('#tutorPregunta').value;
  const p = j.preguntas.find(x => x.id === pid) || j.preguntas[0];
  const borrador = leerForm(j)[p.id] || '';
  const msg = libre || MODOS[modo].msg;
  const cfgModo = MODOS[modo] || {};

  // Lo que ya está escrito se entrega al tiro, sin pasar por el modelo.
  if (!libre && cfgModo.guardado === true) {
    h.push({rol:'yo', texto:msg});
    h.push({rol:'tutor', texto: respuestaGuardada(modo, p), guardado:true});
    return pintarChat(j);
  }

  // Las láminas del PEI se buscan en la base y se muestran tal cual.
  // Es más barato y más fiel: nadie puede inventar un número de lámina.
  if (!libre && cfgModo.guardado === 'cita') {
    h.push({rol:'yo', texto:msg});
    const buscando = {rol:'tutor', texto:'Buscando en el PEI…', pensando:true};
    h.push(buscando); pintarChat(j);
    try {
      const r = await api({action:'extractos', consulta: p.enunciado, ...yoApi()});
      const fs = r.extractos || [];
      h.splice(h.indexOf(buscando), 1, fs.length
        ? {rol:'tutor', guardado:true,
           texto:'Esto dice el PEI sobre este punto. Es el texto tal cual, sin interpretarlo:\n\n'
             + fs.map(f => `- ${f.titulo}: ${String(f.contenido).replace(/\s+/g,' ').trim().slice(0,320)}…`).join('\n\n'),
           fuentes: fs.map(f => f.titulo)}
        : {rol:'tutor', guardado:true,
           texto:'No encontré una lámina que hable directamente de esto. Puedes abrir la presentación completa desde el día de la jornada, o escribirme tu duda aquí abajo.'});
    } catch (ex) {
      h.splice(h.indexOf(buscando), 1, {rol:'tutor', texto: esRed(ex.message)
        ? 'Sin conexión para buscar en el PEI. Intenta de nuevo en un momento.' : ex.message});
    }
    return pintarChat(j);
  }

  if (modo === 'revisar' && !borrador) {
    h.push({rol:'yo', texto:msg});
    h.push({rol:'tutor', texto:'Primero escribe un borrador en esa pregunta, aunque sea corto. Después vuelve a pedirme que lo revise.'});
    return pintarChat(j);
  }
  h.push({rol:'yo', texto:msg});
  const pensando = {rol:'tutor', texto:'Pensando…', pensando:true};
  h.push(pensando); pintarChat(j);

  try {
    const r = await api({action:'tutor', modo, mensaje:msg, jornadaTitulo:j.titulo,
      instrucciones:j.descripcion, pregunta:p.enunciado, tipoPregunta:p.tipo, borrador,
      historial:h.filter(m=>!m.pensando).slice(-8,-1).map(m=>({rol:m.rol==='yo'?'docente':'tutor', texto:String(m.texto).slice(0,1200)})),
      ...yoApi()});
    h.splice(h.indexOf(pensando), 1, {rol:'tutor', texto:r.respuesta, fuentes:r.fuentes});
  } catch (ex) {
    h.splice(h.indexOf(pensando), 1, {rol:'tutor', texto: pistaLocal(modo, p, borrador, ex.message)});
  }
  pintarChat(j);
}

/* Si el tutor no está disponible, las pistas guardadas en la base. */
function pistaLocal(modo, p, borrador, motivo) {
  const aviso = /l[ií]mite/i.test(motivo) ? 'Por hoy se alcanzó el límite de consultas al tutor. Te dejo una pista guardada:\n\n'
    : esRed(motivo) ? 'Sin conexión con el tutor. Te dejo una pista guardada:\n\n' : '';
  if (modo === 'explicar') return aviso + `Léela así: "${p.enunciado}". No hay respuesta correcta: lo que importa es tu mirada, desde tu función y tu horario, y si puedes, con un ejemplo real.`;
  if (modo === 'revisar') {
    const n = palabras(borrador); const c = [];
    if (n < 25) c.push('- Está breve: agrega un ejemplo concreto de lo que ves en tu jornada.');
    if (!/ejemplo|cuando|estudiante|vez/i.test(borrador)) c.push('- Menciona una situación real que te haya pasado.');
    if (p.informe === 'acciones' && !/(marzo|abril|semana|mes|2027|plazo|horas|d[ií]as)/i.test(borrador)) c.push('- Una acción necesita un "cuándo": pon un plazo.');
    if (p.informe === 'acciones' && !/(profesor|jefe|inspector|dupla|utp|direcci[oó]n|convivencia|yo|nosotros)/i.test(borrador)) c.push('- Indica quién sería responsable.');
    if (!c.length) c.push('- Se ve completa. Revisa que responda exactamente lo que se pregunta y envíala.');
    return aviso + 'Ideas para mejorar tu borrador:\n' + c.join('\n');
  }
  const ps = p.pistas || [];
  if (ps.length) return aviso + ps[Math.floor(Math.random()*ps.length)];
  return aviso + (p.tipo === 'escala'
    ? 'Piensa en lo que ves día a día, no en lo ideal. Si dudas entre dos números, pregúntate qué tendría que pasar para subir un punto.'
    : p.tipo === 'opcion'
    ? 'Elige donde un cambio pequeño tendría el mayor efecto en los estudiantes.'
    : 'Prueba así:\n- Una idea principal en una frase.\n- Un ejemplo real de tu jornada.\n- Qué significa eso para el PEI.');
}

/* ---------------------------------------------------------- panel director */
let panelDatos = null;

async function abrirPanel(e) {
  e.preventDefault();
  const clave = $('#inClave').value;
  const err = $('#errPanel'); err.hidden = true;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    panelDatos = await api({action:'panel', clave});
    panelDatos.clave = clave;
    pintarPanel();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  btn.disabled = false; btn.textContent = 'Ver avance';
}

/* ====================================================================
   Tablero del equipo directivo
   Gráficos dibujados a mano en SVG: sin librerías, sin pedir nada afuera,
   y se imprimen bien.
   ==================================================================== */

// El dosier de cada tema. El de RICE se agrega cuando llegue el material.
const MATERIAL = {
  RICE: {url:'rice/index.html', titulo:'Presentación general del RICE con audio · 50 láminas',
        nota:'Tres partes con locución de Silvana. Puedes pausar y volver a cualquier lámina.'},
  PEI: {url:'pei/index.html', titulo:'Presentación del PEI con audio · 44 láminas, 15:50',
        nota:'Escúchala antes de responder. Puedes pausarla y seguir donde quedaste.'},
};

const PAL = ['#6E8BFF','#4FD1C5','#F6AD55','#A78BFA','#F56C6C','#63B3ED'];
const mediana = (a) => { if (!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const m=b.length>>1;
  return b.length%2 ? b[m] : Math.round((b[m-1]+b[m])/2); };
const reloj = (seg) => seg >= 3600 ? `${Math.floor(seg/3600)} h ${Math.round(seg%3600/60)} min`
  : seg >= 60 ? `${Math.round(seg/60)} min` : `${seg} s`;

/** Barras horizontales con su etiqueta y su valor. */
function barrasH(datos, {max, sufijo = '', alto = 30} = {}) {
  if (!datos.length) return '<p class="muted"><em>Todavía no hay datos.</em></p>';
  const tope = max ?? Math.max(1, ...datos.map(d => d.v));
  return `<div class="bh">${datos.map((d, i) => `
    <div class="bhf">
      <span class="bhe" title="${esc(d.k)}">${esc(d.k)}</span>
      <span class="bhb"><i style="width:${Math.max(1, d.v / tope * 100)}%;background:${d.c || PAL[i % PAL.length]}"></i></span>
      <span class="bhv">${esc(String(d.etq ?? (d.v + sufijo)))}</span>
    </div>`).join('')}</div>`;
}

/** Anillo de porcentaje. */
function anillo(pct, etiqueta, color = 'var(--azul)') {
  const r = 52, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return `<svg class="anillo" viewBox="0 0 130 130" role="img" aria-label="${esc(etiqueta)}: ${p}%">
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="#1E2740" stroke-width="13"/>
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 65 65)"/>
    <text x="65" y="60" text-anchor="middle" class="anN">${p}%</text>
    <text x="65" y="80" text-anchor="middle" class="anE">${esc(etiqueta)}</text>
  </svg>`;
}

/** Columnas, para repartos ordenados en el tiempo. */
function columnas(datos, {alto = 150} = {}) {
  if (!datos.length) return '<p class="muted"><em>Todavía no hay datos.</em></p>';
  const tope = Math.max(1, ...datos.map(d => d.v));
  const an = 100 / datos.length;
  return `<div class="col" style="height:${alto}px">${datos.map((d, i) => `
    <div class="colb" style="width:${an}%" title="${esc(d.k)}: ${d.v}">
      <span class="colv">${d.v || ''}</span>
      <i style="height:${d.v / tope * 100}%;background:${d.c || PAL[i % PAL.length]}"></i>
      <span class="colk">${esc(d.k)}</span>
    </div>`).join('')}</div>`;
}

function pintarPanel() {
  const d = panelDatos;
  const js = d.jornadas;
  const fs = d.funcionarios;
  // Se ignoran filas sueltas sin jornada: no son respuestas de nadie.
  const rs = (d.respuestas || []).filter(r => r.jornadaId);
  const perfiles = d.perfiles || [];
  const key = (n) => String(n).toLowerCase();

  const hecho = {};
  rs.forEach(r => { (hecho[key(r.nombre)] = hecho[key(r.nombre)] || {})[r.jornadaId] = r; });
  const dato = (r, id) => { const it = (r.items||[]).find(x => x.id === id); return it ? it.respuesta : null; };
  const segs = rs.map(r => Number(dato(r, '_tiempo'))).filter(n => n > 0);

  const total = fs.length * js.length;
  const pct = total ? Math.round(rs.length / total * 100) : 0;
  const tarde = rs.filter(r => r.fueraDePlazo).length;
  const nomP = (id) => (perfiles.find(p => p.id === id) || {}).nombre || 'Sin perfil';

  // ---- avance por jornada y por perfil ----
  const porJornada = js.map(j => {
    const n = rs.filter(r => r.jornadaId === j.id).length;
    return {k: j.titulo.replace(/^PEI /,''), v: n, etq: `${n} de ${fs.length}`};
  });
  const porPerfil = perfiles.map((p, i) => {
    const gente = fs.filter(f => f.perfil === p.id);
    const n = gente.filter(f => Object.keys(hecho[key(f.nombre)] || {}).length).length;
    return {k: p.nombre, v: gente.length ? Math.round(n / gente.length * 100) : 0,
            etq: `${n}/${gente.length}`, c: PAL[i % PAL.length]};
  });

  // ---- en qué mes habría actuado cada perfil ----
  const mesPorPerfil = {};
  rs.forEach(r => {
    const m = dato(r, '_mes'); if (!m) return;
    const f = fs.find(x => key(x.nombre) === key(r.nombre));
    const p = f ? nomP(f.perfil) : 'Sin perfil';
    ((mesPorPerfil[m] = mesPorPerfil[m] || {})[p] = (mesPorPerfil[m][p] || 0) + 1);
  });
  const meses = Object.entries(mesPorPerfil)
    .map(([k, v]) => ({k, v: Object.values(v).reduce((a, c) => a + c, 0), det: v}));

  // ---- lo más marcado en los riesgos del comité ----
  const riesgos = {};
  rs.forEach(r => {
    const v = dato(r, 's2'); if (!v) return;
    v.split(' | ').filter(Boolean).forEach(x => riesgos[x] = (riesgos[x] || 0) + 1);
  });
  const topRiesgos = Object.entries(riesgos).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({k, v, c: k.startsWith('No he visto') ? 'var(--verde)' : 'var(--ambar)'}));

  // ---- banco de acciones para el PME ----
  const acciones = [];
  rs.forEach(r => {
    const f = fs.find(x => key(x.nombre) === key(r.nombre));
    (r.items||[]).forEach(it => {
      if (String(it.id||'').startsWith('_') || !it.respuesta) return;
      const p = d.preguntas.find(x => x.codigo === it.id && x.jornada_id === r.jornadaId);
      if (p && p.informe === 'acciones') acciones.push({perfil: f ? nomP(f.perfil) : '—', txt: it.respuesta});
    });
  });

  const sinResponder = fs.filter(f => !Object.keys(hecho[key(f.nombre)] || {}).length);

  $('#panelBody').innerHTML = `
    <div class="card">
      <div class="tabCab">
        ${anillo(pct, 'avance', pct >= 80 ? 'var(--verde)' : pct >= 40 ? 'var(--azul)' : 'var(--ambar)')}
        <div class="kpis" style="flex:1">
          <div><b>${rs.length}</b><span class="muted">respuestas de ${total} posibles</span></div>
          <div><b>${fs.length - sinResponder.length}</b><span class="muted">de ${fs.length} ya participaron</span></div>
          <div><b${tarde?' style="color:var(--ambar)"':''}>${tarde}</b><span class="muted">fuera de plazo</span></div>
          <div><b>${segs.length ? reloj(mediana(segs)) : '—'}</b><span class="muted">tiempo típico por jornada</span></div>
        </div>
      </div>
    </div>

    <div class="rejilla">
      <div class="card"><h2>Avance por jornada</h2>
        ${barrasH(porJornada, {max: fs.length})}</div>
      <div class="card"><h2>Avance por perfil</h2>
        ${barrasH(porPerfil, {max: 100, sufijo: '%'})}
        <p class="muted" style="margin:10px 0 0">El número es cuántos de ese perfil ya participaron.</p></div>
    </div>

    <div class="card"><h2>En qué punto habría actuado cada uno</h2>
      <p class="muted">Del recorrido del caso. Es el dato que no existía antes:
        muestra cuánto antes se habría movido la ficha si cada función hubiera tenido cómo.</p>
      ${columnas(meses)}
      ${meses.length ? `<div class="leyenda">${meses.map(m => `<span><b>${esc(m.k)}</b>: ${
        Object.entries(m.det).map(([p, n]) => `${esc(p)} ${n}`).join(' · ')}</span>`).join('')}</div>` : ''}
    </div>

    <div class="rejilla">
      <div class="card"><h2>Tiempo en la plataforma</h2>
        ${segs.length ? `
          <div class="kpis"><div><b>${reloj(mediana(segs))}</b><span class="muted">mediana</span></div>
            <div><b>${reloj(Math.min(...segs))}</b><span class="muted">el más rápido</span></div>
            <div><b>${reloj(Math.max(...segs))}</b><span class="muted">el más largo</span></div></div>
          ${columnas([
            {k:'menos de 10', v: segs.filter(x=>x<600).length},
            {k:'10 a 20',     v: segs.filter(x=>x>=600&&x<1200).length},
            {k:'20 a 40',     v: segs.filter(x=>x>=1200&&x<2400).length},
            {k:'40 a 60',     v: segs.filter(x=>x>=2400&&x<3600).length},
            {k:'más de 60',   v: segs.filter(x=>x>=3600).length}], {alto:120})}
          <p class="muted" style="margin:8px 0 0">Minutos entre abrir el dosier y enviar.</p>`
        : '<p class="muted"><em>Se empieza a medir con la primera respuesta enviada.</em></p>'}
      </div>
      <div class="card"><h2>Riesgos marcados por el comité</h2>
        ${barrasH(topRiesgos.slice(0, 8))}
        ${topRiesgos.length ? '<p class="muted" style="margin:10px 0 0">Cuántas personas marcaron cada condición en su puesto.</p>'
                            : '<p class="muted"><em>Aparece cuando respondan el día 1.</em></p>'}
      </div>
    </div>

    ${sinResponder.length ? `<div class="card"><h2>Quiénes faltan · ${sinResponder.length}</h2>
      <div class="faltan">${sinResponder.map(f =>
        `<span class="ft">${esc(f.nombre)}<small>${esc(nomP(f.perfil))}</small></span>`).join('')}</div></div>` : ''}

    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <h2 style="margin:0;flex:1">Quién contestó y cuándo</h2>
        <button class="btn sm" id="bCsv">Descargar CSV</button>
        ${js.map(j=>`<button class="btn sm pri" data-ficha="${esc(j.id)}">Ficha ADP · ${esc(j.titulo.replace(/^PEI /,''))}</button>`).join('')}
      </div>
      <div class="tw"><table><thead><tr><th>Funcionario</th><th>Perfil</th>
        ${js.map(j=>`<th title="${esc(j.titulo)}">${esc(fdate(j.fecha))}</th>`).join('')}<th>Tiempo</th></tr></thead>
        <tbody>${perfiles.flatMap(p => {
          const gente = fs.filter(f => f.perfil === p.id);
          if (!gente.length) return [];
          return [`<tr class="grp"><td colspan="${js.length+3}">${esc(p.nombre)} · ${gente.length}</td></tr>`]
            .concat(gente.map(f => {
              const h = hecho[key(f.nombre)] || {};
              const mis = Object.values(h).map(r => Number(dato(r, '_tiempo'))).filter(n => n > 0);
              return `<tr><td>${esc(f.nombre)}${f.licencia?' <small class="muted">(licencia)</small>':''}</td>
                <td class="muted">${esc(f.situacion||'')}</td>
                ${js.map(j=>{const r=h[j.id];
                  return r ? `<td class="c ${r.fueraDePlazo?'tarde':'si'}" title="${esc(new Date(r.fecha).toLocaleString('es-CL'))}${r.fueraDePlazo?' · fuera de plazo':''}">✓${r.reenvios?`<small> ${r.reenvios}×</small>`:''}</td>`
                            : `<td class="c no">–</td>`;}).join('')}
                <td class="c muted">${mis.length ? reloj(mis.reduce((a,b)=>a+b,0)) : '–'}</td></tr>`;
            }));
        }).join('')}</tbody></table></div>
      <p class="muted">✓ verde a tiempo · ✓ naranjo fuera de plazo (lo marca el servidor con su reloj) · – sin responder</p>
    </div>

    <div class="card"><h2>Banco de acciones para el PME · ${acciones.length}</h2>
      <p class="muted">Todo lo que los 35 propusieron como acción concreta, agrupado por perfil.
        Es el insumo directo para formular el plan.</p>
      ${acciones.length ? `<div class="tw"><table><thead><tr><th>Perfil</th><th>Acción propuesta</th></tr></thead>
        <tbody>${acciones.map(a=>`<tr><td class="muted">${esc(a.perfil)}</td><td>${esc(a.txt)}</td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn sm" id="bAcc" style="margin-top:10px">Descargar el banco en CSV</button>`
      : '<p class="muted"><em>Se va llenando a medida que respondan.</em></p>'}
    </div>

    <div id="ficha"></div>`;

  $('#bCsv').onclick = csv;
  const ba = $('#bAcc'); if (ba) ba.onclick = () => bajar('banco-acciones-pme.csv',
    [['Perfil','Acción propuesta'], ...acciones.map(a => [a.perfil, a.txt])]);
  document.querySelectorAll('[data-ficha]').forEach(b => b.onclick = () => ficha(b.dataset.ficha));
}

function ficha(jornadaId) {
  const d = panelDatos;
  const j = d.jornadas.find(x => x.id === jornadaId);
  const rs = d.respuestas.filter(r => r.jornadaId === jornadaId);
  const ps = d.preguntas.filter(p => p.jornada_id === jornadaId);
  const secc = {fortalezas:[], areasMejora:[], acciones:[], impacto:[]};
  const escalas = {}, cerradas = {};
  rs.forEach(r => (r.items||[]).forEach(it => {
    if (String(it.id||'').startsWith('_')) return;      // datos internos del panel
    const p = ps.find(x => x.codigo === it.id);
    if (!p || !it.respuesta) return;
    if (p.informe && secc[p.informe]) secc[p.informe].push(it.respuesta);
    if (p.tipo === 'escala') (escalas[p.enunciado] = escalas[p.enunciado]||[]).push(Number(it.respuesta));
    if (p.tipo === 'opcion') { const m = cerradas[p.enunciado] = cerradas[p.enunciado]||{}; m[it.respuesta] = (m[it.respuesta]||0)+1; }
  }));
  const META = {'1':'Acompañamiento al Aula','2':'Talleres de Desarrollo Profesional','3':'Reflexiones Pedagógicas',
    '4':'Plan de Capacitaciones','5':'Capacitaciones en Convivencia','6':'Reuniones con Organizaciones',
    '7':'Planificación Directiva','8':'Talleres de Altas Expectativas','9':'Revisión del PEI',
    '10':'Talleres de Convivencia','11':'Indicadores de Desarrollo Personal','12':'Talleres de Temas de Convivencia',
    '13':'Matrícula y Asistencia','14':'Promoción y Repitencia','15':'Aprobación Lenguaje','16':'Aprobación Matemática'};
  const POND = {'1':'8%','2':'6%','3':'6%','4':'4,5%','5':'6%','6':'4,5%','7':'10%','8':'6%','9':'4%','10':'8%',
    '11':'6%','12':'6%','13':'6,2%','14':'6,2%','15':'5%','16':'7,5%'};
  const li = (a) => a.length ? `<ul>${a.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted"><em>Sin respuestas.</em></p>';

  const disp = Object.entries(cerradas).map(([e,m]) => {
    const tot = Object.values(m).reduce((a,c)=>a+c,0);
    const filas = Object.entries(m).sort((a,b)=>b[1]-a[1])
      .map(([k,n])=>`<tr><td>${esc(k)}</td><td class="c">${n}</td><td class="c">${Math.round(n/tot*100)}%</td></tr>`).join('');
    const nd = Object.keys(m).length;
    return `<h3>${esc(e)}</h3><div class="tw"><table>${filas}</table></div>
      ${nd>=4?`<p class="aviso">Las respuestas se reparten en ${nd} alternativas: no hay lectura compartida sobre este punto.</p>`:''}`;
  }).join('');

  $('#ficha').innerHTML = `<div class="card">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <h2 style="flex:1;margin:0">Ficha de Registro de Evidencia ADP</h2>
      <button class="btn sm" onclick="window.print()">Imprimir / PDF</button>
      <button class="btn sm pri" id="bSint">✨ Redactar síntesis con IA</button>
    </div>
    <div class="tw"><table>
      <tr><th>Fecha de ejecución</th><td>${esc(fdateLarga(j.fecha))} de ${j.fecha.slice(0,4)}</td></tr>
      <tr><th>Actividad / tema</th><td>${esc(j.titulo)}. ${esc(j.subtitulo||'')}</td></tr>
      <tr><th>Modalidad</th><td>Remota y asincrónica. Participan las tres jornadas; cada funcionario responde en su horario.</td></tr>
      <tr><th>Objetivo general</th><td>${esc(j.descripcion||'')}</td></tr>
      <tr><th>Participantes</th><td>${rs.length} de ${d.funcionarios.length} funcionarios</td></tr>
    </table></div>
    <h3>Relación con el Convenio de Desempeño ADP</h3>
    <div class="tw"><table><tr><th>Meta</th><th>Nombre</th><th>Ponderación</th></tr>
      ${(j.metas_adp||[]).map(m=>`<tr><td>Meta ${esc(m)}</td><td>${esc(META[m]||'')}</td><td>${esc(POND[m]||'')}</td></tr>`).join('')}
    </table></div>
    ${Object.keys(escalas).length?`<h3>Valoración (promedio de 1 a 5)</h3><div class="tw"><table>
      ${Object.entries(escalas).map(([e,v])=>`<tr><td>${esc(e)}</td><td class="c">${(v.reduce((a,c)=>a+c,0)/v.length).toFixed(1)}</td><td class="c">${v.length} resp.</td></tr>`).join('')}
    </table></div>`:''}
    ${disp?`<h3 style="margin-top:18px">Lectura del caso: en qué coincide y en qué no el equipo</h3>${disp}`:''}
    <div id="sintesis"></div>
    <h3>Fortalezas identificadas</h3>${li(secc.fortalezas)}
    <h3>Áreas de mejora</h3>${li(secc.areasMejora)}
    <h3>Acciones correctivas propuestas</h3>${li(secc.acciones)}
    <h3>Impacto esperado en la gestión</h3>${li(secc.impacto)}
    <h3>Medios de verificación</h3>
    <ol><li>Esta ficha, generada desde la plataforma con las respuestas registradas.</li>
      <li>Nómina de participación con fecha y hora de cada respuesta.</li>
      <li>Declaración de participación firmada en línea por cada funcionario.</li></ol>
    <p class="muted">Revisa y edita esta ficha antes de firmarla.</p>
  </div>`;

  $('#bSint').onclick = async () => {
    const b = $('#bSint'); b.disabled = true; b.textContent = 'Redactando…';
    try {
      const r = await api({action:'sintesis', clave:d.clave, jornadaTitulo:j.titulo,
        participantes:`${rs.length} de ${d.funcionarios.length}`,
        escalas:Object.entries(escalas).map(([e,v])=>({enunciado:e, prom:(v.reduce((a,c)=>a+c,0)/v.length).toFixed(1)})),
        secciones:secc});
      $('#sintesis').innerHTML = `<h3>Síntesis de la jornada</h3><div class="info">${formato(r.sintesis)}</div>`;
    } catch (ex) { $('#sintesis').innerHTML = `<p class="err">${esc(ex.message)}</p>`; }
    b.disabled = false; b.textContent = '✨ Redactar síntesis con IA';
  };
  $('#ficha').scrollIntoView({behavior:'smooth'});
}

function celda(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;   // si no, Excel lo toma como fórmula
  return `"${s.replace(/"/g,'""')}"`;
}

/** Baja una tabla como CSV, con BOM para que Excel lea bien las tildes. */
function bajar(nombre, filas) {
  const txt = filas.map(f => f.map(celda).join(';')).join('\r\n');
  const b = new Blob(['\ufeff' + txt], {type:'text/csv;charset=utf-8'});
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

function csv() {
  const d = panelDatos;
  const perfil = (n) => {
    const f = d.funcionarios.find(x => x.nombre === n) || {};
    return ((d.perfiles||[]).find(p => p.id === f.perfil) || {}).nombre || '';
  };
  const filas = [['fecha','funcionario','funcion','perfil','jornada','pregunta','respuesta',
                  'palabras','fuera de plazo','reenvios']];
  (d.respuestas||[]).filter(r => r.jornadaId).forEach(r => {
    const f = d.funcionarios.find(x => x.nombre === r.nombre) || {};
    const j = d.jornadas.find(x => x.id === r.jornadaId) || {};
    (r.items||[]).forEach(it => {
      if (String(it.id||'').startsWith('_')) return;    // datos internos del panel
      filas.push([r.fecha, r.nombre, f.situacion||'', perfil(r.nombre), j.titulo||r.jornadaId,
        it.enunciado, it.respuesta, palabras(it.respuesta), r.fueraDePlazo?'sí':'no', r.reenvios||0]);
    });
  });
  bajar('jornadas_respuestas.csv', filas);
}


/* ====================================================================
   El caso, mes a mes
   La ficha completa regala el final: con el desenlace a la vista
   cualquiera dice "había que actuar antes". Aquí el mes se vive con la
   información que existía ESE mes, se decide, y recién entonces se ve
   qué pasó. Al final cada uno se compara consigo mismo, no con un colega.
   ==================================================================== */

let sim = null;

const OPCIONES = [
  {id:'nada',     txt:'Todavía nada',            sub:'Puede ser algo puntual. Espero a ver cómo sigue.'},
  {id:'registro', txt:'Lo registro y lo informo', sub:'Lo dejo por escrito y se lo paso a quien corresponda.'},
  {id:'contacto', txt:'Lo abordo yo',             sub:'Desde mi función, hablo o me acerco directamente.'},
  {id:'otro',     txt:'No me corresponde a mí',   sub:'En mi puesto no tengo cómo intervenir en esto.'}
];

const COLOR = {critico:'#A31515', grave:'var(--rojo)', alerta:'var(--ambar)',
               bien:'var(--verde)', neutro:'var(--azul)'};
const NIVEL = {critico:'Crítico', grave:'Grave', alerta:'Señal', bien:'Sin novedad'};

function pintarCaso() {
  const {caso, paso, decidido, abierto} = sim;
  const hitos = caso.hitos || [];
  const total = hitos.length;

  if (paso < 0) return pintarApertura();
  if (paso >= total) return pintarCierre();

  const h = hitos[paso];
  const col = COLOR[h.nivel] || 'var(--azul)';
  const yaDecidio = decidido[paso] != null;

  const puntos = hitos.map((x, i) => {
    const cl = i < paso ? 'ok' : i === paso ? 'hoy' : '';
    return `<span class="pt ${cl}" style="${i < paso ? 'background:'+(COLOR[x.nivel]||'var(--azul)') : ''}"></span>`;
  }).join('');

  const datos = (h.datos || []).map(d => `
    <div class="dato">
      <span class="dk">${esc(d.k)}</span>
      <span class="dv">${esc(d.v)}</span>
      ${d.pct != null ? `<span class="dbar"><i style="width:${Math.max(3,Math.min(100,d.pct))}%;background:${col}"></i></span>` : ''}
    </div>`).join('');

  const opciones = OPCIONES.map(o => `
    <button type="button" class="opc${decidido[paso]===o.id?' sel':''}" data-o="${o.id}" ${abierto?'disabled':''}>
      <span class="mk"></span>
      <span><b>${esc(o.txt)}</b><small>${esc(o.sub)}</small></span>
    </button>`).join('');

  $('#jCaso').innerHTML = `
    <div class="simCab">
      <div>
        <p class="eyebrow">Caso ${caso.numero} de 3 · análisis ${esc(caso.eje || "mes a mes")}</p>
        <h2 style="margin:2px 0 0">${esc(caso.titulo)}</h2>
      </div>
      <span class="simPaso">${paso+1} <i>/ ${total}</i></span>
    </div>

    <div class="aviso" style="margin:12px 0 16px"><b>Caso real, anonimizado.</b> No aparece ningún nombre y no
      debes escribir ninguno. Analizamos el procedimiento del establecimiento, nunca a un colega ni a un estudiante.</div>

    <div class="simPuntos">${puntos}</div>

    <article class="tarjeta" style="--acento:${col}">
      <header>
        <span class="mes">${esc(h.cuando)}</span>
        <span class="nivel" style="background:${col}">${NIVEL[h.nivel] || 'Decisión'}</span>
      </header>
      <p class="rel">${esc(h.que)}</p>
      ${datos ? `<div class="datos">${datos}</div>` : ''}

      <div class="pregunta">
        <p class="pq">Con lo que sabes hasta <b>aquí</b>, y desde tu función: ¿qué haces?</p>
        <p class="pqn">No hay respuesta correcta. Lo que interesa es en qué punto <b>tú</b> sentiste
          que había suficiente para moverte, porque ese punto es distinto en cada función.</p>
        <div class="opciones">${opciones}</div>
      </div>

      ${abierto ? `
        <div class="revela">
          <p class="rk">Qué se sabía en ese momento</p>
          <p class="rt">${esc(h.quien || 'No quedó registro de este punto.')}</p>
        </div>
        ${h.oportunidad ? `<div class="oport">
          <p class="ok">Aquí hay algo que se puede construir</p>
          <p class="ot">${esc(h.oportunidad)}</p>
          <p class="on">Guárdate la idea: al final te la vamos a pedir por escrito.</p>
        </div>` : ''}` : ''}

      <footer>
        ${abierto
          ? `<button type="button" class="btn pri" id="simSig">${paso+1 < total ? 'Avanzar al mes siguiente →' : 'Ver cómo me fue →'}</button>`
          : `<button type="button" class="btn pri" id="simVer" ${yaDecidio?'':'disabled'}>
               ${yaDecidio ? 'Ver qué pasó' : 'Elige una opción para continuar'}</button>`}
      </footer>
    </article>`;

  document.querySelectorAll('#jCaso .opc').forEach(b =>
    b.addEventListener('click', () => { sim.decidido[sim.paso] = b.dataset.o; pintarCaso(); }));
  const ver = $('#simVer');
  if (ver) ver.addEventListener('click', () => { sim.abierto = true; pintarCaso(); });
  const sig = $('#simSig');
  if (sig) sig.addEventListener('click', () => { sim.paso++; sim.abierto = false; pintarCaso(); });
}

/** Apertura: el lugar donde el estudiante ya no está. Seis segundos, sin
 *  explicar nada. El clip no se carga hasta que se toca. */
function pintarApertura() {
  const {caso} = sim;
  const n = caso.video || ('caso-' + caso.numero);
  const eje = caso.eje || 'mes a mes';
  $('#jCaso').innerHTML = `
    <div class="simCab">
      <div>
        <p class="eyebrow">Caso ${caso.numero} de 3 · análisis ${esc(eje)}</p>
        <h2 style="margin:2px 0 0">${esc(caso.titulo)}</h2>
      </div>
    </div>

    <article class="tarjeta apertura">
      <button class="lienzo tapa" type="button" id="simClip" data-n="${n}"
              aria-label="Reproducir la apertura del caso">
        <img src="video/${n}.jpg" alt="" loading="lazy"
             onerror="this.closest('.tapa').remove()">
        <span class="play" aria-hidden="true">▶</span>
        <span class="dur">0:06</span>
      </button>
      <div class="apTx">
        <p class="lead" style="margin:0">${esc(caso.ficha)}</p>
        <div class="aviso" style="margin:14px 0 0"><b>Vas a recorrer el caso ${esc(eje)}.</b>
          En cada paso ves solo lo que se sabía en ese momento y decides qué harías tú, desde tu
          función. Esto no es para buscar culpables: es para encontrar qué nos habría ayudado.</div>
      </div>
      <footer><button type="button" class="btn pri" id="simIr">Empezar por el primer paso →</button></footer>
    </article>`;

  const clip = $('#simClip');
  if (clip) clip.addEventListener('click', (e) => {
    const b = e.currentTarget;
    const d = document.createElement('div');
    d.className = 'lienzo';
    d.innerHTML = `<video src="video/${b.dataset.n}.mp4" poster="video/${b.dataset.n}.jpg"
      controls autoplay playsinline></video>`;
    b.replaceWith(d);
  }, {once:true});
  $('#simIr').addEventListener('click', () => { sim.paso = 0; pintarCaso(); });
}

function pintarCierre() {
  const {caso, decidido} = sim;
  const hitos = caso.hitos || [];
  const miMes = decidido.findIndex(d => d === 'registro' || d === 'contacto');
  const nombre = (hitos[miMes] || {}).cuando;

  const lectura = miMes < 0
    ? `<p class="vt">Recorriste el año sin intervenir en ningún mes.</p>
       <p class="vs">Si desde tu puesto efectivamente no había por dónde, eso no es un descuido:
       es un vacío del procedimiento, y es justo lo que necesitamos que quede escrito.</p>`
    : `<p class="vt">Desde tu función, el punto en que habrías actuado fue <b>${esc(nombre)}</b>.</p>
       <p class="vs">No hay un mes correcto. Cada función ve la señal en un momento distinto, y la
       gracia de hacer esto entre los seis perfiles es justamente ver esa diferencia.</p>`;

  const linea = hitos.map((h, i) => {
    const col = COLOR[h.nivel] || 'var(--azul)';
    const d = decidido[i];
    const act = d === 'registro' || d === 'contacto';
    return `<div class="fila">
      <span class="fm">${esc(h.cuando)}</span>
      <span class="fb" style="background:${col}"></span>
      <span class="fd ${act?'act':''}">${d ? esc((OPCIONES.find(o=>o.id===d)||{}).txt) : '—'}</span>
    </div>`;
  }).join('');

  $('#jCaso').innerHTML = `
    <div class="simCab">
      <div>
        <p class="eyebrow">Caso ${caso.numero} de 3 · tu recorrido</p>
        <h2 style="margin:2px 0 0">${esc(caso.titulo)}</h2>
      </div>
      <button type="button" class="linkbtn" id="simOtra">Volver a empezar</button>
    </div>

    <article class="tarjeta cierre">
      ${lectura}
      <div class="linea">${linea}</div>
      ${caso.resultado ? `<div class="info" style="margin-top:14px"><b>Cómo siguió:</b> ${esc(caso.resultado)}</div>` : ''}

      <div class="cierrePreg">
        <p class="cpk">Lo que sigue</p>
        <p>Este caso no se revisó para ver qué se hizo mal: se revisó para encontrar
          <b>dónde una regla simple habría cambiado el curso</b>. Tú acabas de recorrer seis momentos
          donde cabía una.</p>
        <p style="margin-top:9px"><b>Elige uno solo y escríbelo abajo.</b> El que te parezca más fácil
          de cumplir desde marzo, no el más ambicioso. De ahí salen los acuerdos del año.</p>
      </div>
    </article>

    <p class="muted" style="margin:14px 0 0">Tu recorrido se guarda junto con tus respuestas. Al equipo directivo
      no le sirve para ver quién acertó, sino para saber con cuánta anticipación ve la señal cada función.</p>`;

  $('#simOtra').addEventListener('click', () => { sim.paso = -1; sim.abierto = false; sim.decidido = []; pintarCaso(); });
}

/** El mes en que habría movido la ficha, suelto, para poder graficarlo. */
function vistaPreviaRice() {
  const videos = [
    {id:'tnFxLXMon7s', titulo:'Protocolos de seguridad 2026–2027', duracion:'8:14'},
    {id:'ZpR4jasVdQs', titulo:'Horarios y atrasos', duracion:'4:44'}
  ];
  return vistaPreviaRiceBase() + `<section aria-label="Videos complementarios del RICE" style="margin-top:20px">
    <h3>Videos complementarios del RICE</h3>
    <div class="materiales">${videos.map(v => `
      <a class="mini" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener" aria-label="Ver ${esc(v.titulo)} en YouTube">
        <span class="lienzo">
          <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="Miniatura del video: ${esc(v.titulo)}" loading="lazy">
          <span class="play" aria-hidden="true">▶</span>
          <span class="dur">${v.duracion}</span>
        </span>
        <span class="miniPie"><b>${esc(v.titulo)}</b><small>Ver en YouTube · ${v.duracion} min</small></span>
      </a>`).join('')}</div>
  </section>`;
}

function mesEnQueActuaria() {
  if (!sim || !sim.caso) return null;
  const hitos = sim.caso.hitos || [];
  if (!sim.decidido.filter(Boolean).length) return null;
  const i = sim.decidido.findIndex(d => d === 'registro' || d === 'contacto');
  return i >= 0 ? (hitos[i] || {}).cuando || '' : 'No habría intervenido';
}

/** Resumen de lo decidido, para que viaje junto a las respuestas. */
function resumenSim() {
  if (!sim || !sim.caso) return null;
  const hitos = sim.caso.hitos || [];
  if (!sim.decidido.filter(Boolean).length) return null;
  const partes = hitos.map((h, i) => {
    const d = sim.decidido[i];
    return `${h.cuando}: ${d ? (OPCIONES.find(o=>o.id===d)||{}).txt : 'sin responder'}`;
  });
  const mi = sim.decidido.findIndex(d => d === 'registro' || d === 'contacto');
  return (mi >= 0 ? `Su punto de acción fue ${hitos[mi].cuando}. ` : 'No habría intervenido en ningún mes. ')
    + partes.join(' | ');
}

function vistaPreviaRiceBase(){return `<div class="rice-material"><a class="mini rice-preview" href="rice/index.html?parte=A" target="_blank" rel="noopener" aria-label="Abrir presentación del RICE con audio"><span class="lienzo"><span class="rice-cover"><span class="rice-cover-tag">CEIA Juanita Zúñiga Fuentes · Parral</span><span class="rice-cover-title">Reglamento Interno y de Convivencia Escolar</span><span class="rice-cover-sub">A · Comunidad y funcionamiento<br>B · Seguridad y convivencia<br>C · Protocolos y anexos</span></span><span class="rice-cover-play" aria-hidden="true">▶</span><span class="dur">22:11</span></span><span class="miniPie"><b>Presentación general del RICE con audio</b><small>50 láminas · Voz de Silvana · Toca la miniatura para abrir</small></span></a><nav class="rice-part-links" aria-label="Comenzar la presentación del RICE por una parte"><a href="rice/index.html?parte=A" target="_blank" rel="noopener">Comenzar parte A</a><a href="rice/index.html?parte=B" target="_blank" rel="noopener">Comenzar parte B</a><a href="rice/index.html?parte=C" target="_blank" rel="noopener">Comenzar parte C</a></nav><div class="rice-part-links" aria-label="Consultar el reglamento"><a href="reglamento/index.html" target="_blank" rel="noopener">Consultar reglamento navegable</a><a href="reglamento/Reglamento_CEIA_2026-2027.pdf" target="_blank" rel="noopener">Ver PDF original</a><a href="reglamento/Reglamento_CEIA_2026-2027.pdf" download>Descargar PDF</a></div></div>`;}

