/* =====================================================================
   APP CEIA 2027 · "Jornadas fin de año"
   Calendario → nómina del día → dosier con las matrices.
   Todo pasa por una sola función en Supabase: esta página no tiene
   llaves y no toca la base de datos directamente.
   ===================================================================== */

const API = 'https://igmmdzrumksuuueqtnex.supabase.co/functions/v1/talleres';
const MAX_PALABRAS = 2000;
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
  window.addEventListener('hashchange', ruta);
  window.addEventListener('online', reintentar);
  arrancar();
});

const VISTAS = ['vCodigo','vCalendario','vDia','vJornada','vPanel'];
function vista(id) {
  VISTAS.forEach(v => { const n = $('#'+v); if (n) n.hidden = (v !== id); });
  $('#barraUsuario').hidden = !app.yo;
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
    if (j && app.yo && app.datos) return verJornada(j);
    if (j) return verDia(j);
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

/* ---------------------------------------------------------- calendario */
function hechas(jornadaId) {
  if (!app.datos) return null;
  return (app.datos.respondidas || []).find(r => r.jornadaId === jornadaId) || null;
}
function estadoJornada(j) {
  if (hechas(j.id)) return 'lista';
  const hoy = app.cfg.hoy;
  if (hoy < j.fecha) return 'futura';
  if (hoy > j.fecha) return 'atrasada';
  return 'abierta';
}
const ETIQ = {
  lista:   {t:'✓ Respondida',  c:'lista'},
  abierta: {t:'● Abierta hoy', c:'abierta'},
  atrasada:{t:'! Plazo vencido', c:'abierta'},
  futura:  {t:'○ Por venir',   c:''}
};

function verCalendario() {
  app.jornada = null;
  vista('vCalendario');
  const js = app.cfg.jornadas || [];
  const hoy = app.cfg.hoy;
  if (!js.length) { $('#calendario').innerHTML = '<p class="muted">Todavía no hay jornadas cargadas.</p>'; return; }
  const porFecha = {};
  js.forEach(j => porFecha[j.fecha] = j);

  // Rango: desde el primer día del mes de la primera jornada hasta fin de diciembre.
  const ini = new Date(js[0].fecha + 'T12:00:00');
  const fin = new Date(ini.getFullYear(), 11, 30, 12);
  const meses = [];
  for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fin; d = new Date(d.getFullYear(), d.getMonth()+1, 1)) meses.push(new Date(d));

  $('#calendario').innerHTML = meses.map(m => {
    const primero = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7;
    const total = new Date(m.getFullYear(), m.getMonth()+1, 0).getDate();
    let celdas = '';
    for (let k=0;k<primero;k++) celdas += '<span class="dia vacio"></span>';
    for (let d=1; d<=total; d++) {
      const iso = `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const j = porFecha[iso];
      const esHoy = iso === hoy ? ' hoy' : '';
      if (j) {
        const st = estadoJornada(j);
        celdas += `<a class="dia ${st==='lista'?'lista':(st==='abierta'||st==='atrasada')?'abierta':''}${esHoy}"
          href="#dia-${esc(j.id)}" title="${esc(j.titulo)}">
          <span class="num">${d}</span><span class="eti">${esc(j.titulo.replace(/^PEI /,'').slice(0,22))}</span></a>`;
      } else {
        celdas += `<span class="dia${esHoy}">${d}</span>`;
      }
    }
    return `<div class="mes"><h3>${MESES[m.getMonth()]} ${m.getFullYear()}</h3>
      <div class="sem">${DIAS.map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="dias">${celdas}</div></div>`;
  }).join('');

  if (app.yo && app.datos) {
    const listas = js.filter(j => hechas(j.id)).length;
    $('#miAvance').innerHTML = `<div class="barra"><i style="width:${Math.round(listas/js.length*100)}%"></i></div>
      <p class="muted" style="margin:0">Llevas ${listas} de ${js.length} jornadas respondidas.</p>`;
  } else {
    $('#miAvance').innerHTML = `<p class="muted" style="margin:0">Toca el día que te toca: ahí vas a encontrar
      la nómina y tu nombre. El código te lo pedimos recién al abrir tu dosier.</p>`;
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

  $('#buscaNomina').value = '';
  pintarNomina(j, '');

  const reg = hechas(j.id);
  $('#diaBoton').innerHTML = (app.yo && app.datos)
    ? `<a class="btn pri" style="width:100%" href="#resp-${esc(j.id)}">
         ${reg ? 'Ver o corregir mis respuestas' : 'Abrir mi dosier y responder'}</a>`
    : '';
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
function verJornada(j) {
  const completa = ((app.datos && app.datos.jornadas) || []).find(x => x.id === j.id);
  if (!completa || !completa.preguntas) { volverNomina(); return; }
  j = completa;
  app.jornada = j;
  vista('vJornada');
  const reg = hechas(j.id);
  const prev = (reg && itemsAObjeto(reg.items)) || ls.get(LS_BORR + j.id, {});
  const caso = app.datos.caso;
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

  // Presentación y documentos
  $('#jDosier').innerHTML = `
    <h2>Dosier del día</h2>
    <a class="btn" style="width:100%;margin-bottom:8px" href="pei/index.html" target="_blank" rel="noopener">
      ▶ Presentación del PEI con audio · 44 láminas, 15:50</a>
    <p class="muted" style="margin:0">Escúchala antes de responder. Puedes pausarla y seguir donde quedaste.</p>`;

  // Ficha del caso
  $('#jCaso').hidden = !usaCaso;
  if (usaCaso) {
    if (!caso) {
      $('#jCaso').innerHTML = `<div class="aviso">Todavía no tienes un caso asignado. Avisa a la dirección.</div>`;
    } else {
      const pend = /POR COMPLETAR/i.test(caso.titulo);
      $('#jCaso').innerHTML = `
        <h2>Tu caso: N° ${caso.numero} de 3</h2>
        ${pend ? `<div class="aviso">Este caso todavía no tiene su contenido real cargado.</div>` : ''}
        <div class="aviso" style="margin-bottom:12px"><b>Caso real, anonimizado.</b> No aparece ningún nombre y no debes
          escribir ninguno. Analizamos el procedimiento del establecimiento, nunca a un colega ni a un estudiante.</div>
        <p class="lead">${esc(caso.ficha)}</p>
        ${(caso.hitos||[]).map(h => {
          const col = h.nivel==='grave' ? 'var(--rojo)' : h.nivel==='alerta' ? 'var(--ambar)' : 'var(--verde)';
          return `<div class="hito"><span class="bar"><i style="background:${col}"></i><u></u></span>
            <span class="tx"><b style="color:${col}">${esc(h.cuando)}</b>
            <span>${esc(h.que)}</span><small>${esc(h.quien||'')}</small></span></div>`;
        }).join('')}
        ${caso.resultado ? `<div class="info"><b>Resultado:</b> ${esc(caso.resultado)}</div>` : ''}`;
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
    ${g.ps.map(p => campo(p, ++n, prev[p.id])).join('')}</fieldset>`).join('')
    + `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px">
        <button class="btn pri" type="submit">${reg ? 'Actualizar mis respuestas' : 'Enviar mis respuestas'}</button>
        <span class="muted">Se guarda en este equipo mientras escribes.</span></div>`;

  $('#formJ').oninput = () => ls.set(LS_BORR + j.id, leerForm(j));
  $('#formJ').onsubmit = (e) => { e.preventDefault(); enviar(j); };
  document.querySelectorAll('#formJ textarea[data-c]').forEach(t => {
    const p = () => contador(t); t.addEventListener('input', p); p();
  });
  document.querySelectorAll('#formJ [data-pista]').forEach(b =>
    b.addEventListener('click', () => { $('#tutorPregunta').value = b.dataset.pista; pedirTutor('pista'); }));

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
  const pista = p.tipo === 'confirmacion' ? '' :
    `<button type="button" class="chip" data-pista="${esc(p.id)}" style="margin-left:6px;min-height:30px;padding:4px 10px;font-size:11.5px">💡 Pista</button>`;
  const cab = `<p class="enun"><span class="qn">${n}</span><span style="flex:1">${esc(p.enunciado)}${pista}</span>${secc}</p>`;

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

/* ---------------------------------------------------------- tutor */
const MODOS = {
  pista:   {chip:'💡 Dame una pista',    msg:'Dame una pista para esta pregunta.'},
  explicar:{chip:'❓ No entiendo',        msg:'No entiendo bien lo que pide esta pregunta. ¿Me la explicas con otras palabras?'},
  fuente:  {chip:'📄 ¿Qué dice el PEI?', msg:'¿Qué dicen la presentación y los documentos del PEI que me sirva para esta pregunta?'},
  revisar: {chip:'✍️ Revisa mi borrador', msg:'Revisa mi borrador y dime qué puedo mejorar, sin escribirlo por mí.'}
};

function prepararTutor(j) {
  const ps = j.preguntas.filter(p => p.tipo !== 'confirmacion');
  $('#tutorPregunta').innerHTML = ps.map((p,i) =>
    `<option value="${esc(p.id)}">${i+1}. ${esc(p.enunciado.slice(0,62))}${p.enunciado.length>62?'…':''}</option>`).join('');
  $('#tutorChips').innerHTML = Object.entries(MODOS).map(([k,v]) =>
    `<button type="button" class="chip" data-m="${k}">${v.chip}</button>`).join('');
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
    `Hola, ${String(app.datos.nombre).split(' ').slice(-2).join(' ')}. Soy el tutor de la jornada. No respondo por ti, pero te ayudo a pensar: elige una pregunta y pídeme una pista, que te la explique, qué dicen los documentos, o que revise tu borrador.`});
  pintarChat(j);
}

function pintarChat(j) {
  const h = app.chat[j.id] || [];
  $('#tutorMsgs').innerHTML = h.map(m => `<div class="msg ${m.rol==='yo'?'yo':'tutor'}${m.pensando?' pensando':''}">${
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

function pintarPanel() {
  const d = panelDatos;
  const js = d.jornadas, fs = d.funcionarios, rs = d.respuestas;
  const key = (n) => String(n).toLowerCase();
  const hecho = {};
  rs.forEach(r => { (hecho[key(r.nombre)] = hecho[key(r.nombre)] || {})[r.jornadaId] = r; });

  const total = fs.length * js.length;
  const pct = total ? Math.round(rs.length / total * 100) : 0;
  const tarde = rs.filter(r => r.fueraDePlazo).length;

  $('#panelBody').innerHTML = `
    <div class="card"><div class="kpis">
      <div><b>${pct}%</b><span class="muted">de avance total</span></div>
      <div><b>${rs.length}</b><span class="muted">respuestas de ${total} posibles</span></div>
      <div><b>${fs.length}</b><span class="muted">funcionarios en la nómina</span></div>
      ${tarde?`<div><b style="color:var(--ambar)">${tarde}</b><span class="muted">fuera de plazo</span></div>`:''}
    </div></div>
    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <h2 style="margin:0;flex:1">Avance por funcionario</h2>
        <button class="btn sm" id="bCsv">Descargar CSV</button>
        ${js.map(j=>`<button class="btn sm pri" data-ficha="${esc(j.id)}">Ficha ADP · ${esc(j.titulo.replace(/^PEI /,''))}</button>`).join('')}
      </div>
      <div class="tw"><table><thead><tr><th>Funcionario</th><th>Función</th>
        ${js.map(j=>`<th title="${esc(j.titulo)}">${esc(fdate(j.fecha))}</th>`).join('')}</tr></thead>
        <tbody>${fs.map(f=>{
          const h = hecho[key(f.nombre)] || {};
          return `<tr><td>${esc(f.nombre)}${f.licencia?' <small class="muted">(licencia)</small>':''}</td>
            <td class="muted">${esc(f.situacion||'')}</td>
            ${js.map(j=>{const r=h[j.id];
              return r ? `<td class="c ${r.fueraDePlazo?'tarde':'si'}" title="${esc(new Date(r.fecha).toLocaleString('es-CL'))}${r.fueraDePlazo?' · fuera de plazo':''}">✓${r.reenvios?`<small> ${r.reenvios}×</small>`:''}</td>`
                        : `<td class="c no">–</td>`;}).join('')}</tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted">✓ verde a tiempo · ✓ naranjo fuera de plazo (lo marca el servidor con su fecha) · – sin responder</p>
    </div>
    <div id="ficha"></div>`;

  $('#bCsv').onclick = csv;
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

function csv() {
  const d = panelDatos;
  const l = [['fecha','funcionario','funcion','jornada','pregunta','respuesta','palabras','fuera de plazo','reenvios'].map(celda).join(';')];
  d.respuestas.forEach(r => {
    const f = d.funcionarios.find(x => x.nombre === r.nombre) || {};
    const j = d.jornadas.find(x => x.id === r.jornadaId) || {};
    (r.items||[]).forEach(it => l.push([r.fecha, r.nombre, f.situacion||'', j.titulo||r.jornadaId,
      it.enunciado, it.respuesta, palabras(it.respuesta), r.fueraDePlazo?'sí':'no', r.reenvios||0].map(celda).join(';')));
  });
  const b = new Blob(['﻿'+l.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = 'jornadas_respuestas.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
