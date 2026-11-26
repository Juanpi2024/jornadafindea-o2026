// =====================================================================
// APP CEIA 2027 · "Jornadas fin de año"
// Servidor único: toda la lógica y las llaves viven aquí.
// La página pública no tiene llaves y no toca la base de datos.
// =====================================================================
// Secretos: OPENAI_API_KEY
// La clave del equipo directivo NO es un secreto de Edge Functions: Supabase
// tiene pausado ese almacenamiento, así que vive cifrada con bcrypt en la
// tabla "claves" y se comprueba con la función verificar_clave.
//
// Públicas:        config · nomina
// Con RUT:         entrar · agenda · guardar · extractos · tutor
// Equipo directivo: panel · sintesis
//
// Solo "tutor" y "sintesis" gastan modelo. "extractos" busca en la base y
// devuelve las láminas tal cual: cuesta cero y nadie puede inventar un
// número de lámina.
//
// Cada funcionario pertenece a uno de los 6 perfiles. El perfil decide qué
// caso le toca en cada jornada y qué preguntas propias responde, además del
// núcleo común. El reparto de casos vive en la tabla perfil_caso, porque
// cada jornada con análisis de casos (PEI, RICE) tiene su propio juego.

import { createClient } from "npm:@supabase/supabase-js@2";

const LIMITE_DIA = 400;
const LIMITE_FUNCIONARIO = 40;
const MODELO = "gpt-4o-mini";
const MAX_RESPUESTA = 14000;      // ≈ 2.000 palabras
const MAX_BORRADOR_TUTOR = 6000;

// La actividad es parte de la jornada laboral: se responde en horario de
// trabajo, no en la casa. Cada día abre a las 08:00 y cierra a medianoche.
const ZONA = "America/Santiago";
const ABRE = 8;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const txt = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const norm = (v: unknown) =>
  String(v ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
/** Palabras del nombre, ordenadas: deja comparar sin importar el orden. */
const piezas = (v: unknown) => norm(v).split(" ").filter(Boolean).sort();

/** Fecha y hora en Chile. El servidor corre en UTC: si contáramos con su
 *  reloj, toda la jornada de la noche quedaría marcada fuera de plazo. */
function ahora() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: ZONA });
  return { fecha: s.slice(0, 10), hora: Number(s.slice(11, 13)), reloj: s.slice(11, 16) };
}

/** Las preguntas que le tocan: el núcleo común más las de su perfil. */
const leTocan = (ps: any[], jid: string, perfil: string | null) =>
  ps.filter((p) => p.jornada_id === jid && (p.perfil == null || p.perfil === perfil));

const mapaPregunta = (p: any) => ({
  id: p.codigo, parte: p.parte, tipo: p.tipo, enunciado: p.enunciado,
  ayuda: p.ayuda, min: p.min_etiqueta, max: p.max_etiqueta,
  opciones: p.opciones, informe: p.informe, pistas: p.pistas,
  opcional: p.opcional, perfil: p.perfil,
});

const mapaCaso = (c: any) => ({
  id: c.id, numero: c.numero, titulo: c.titulo, ficha: c.ficha,
  hitos: c.hitos, resultado: c.resultado, video: c.video ?? ("caso-" + c.numero),
  eje: c.eje ?? "mes a mes", tema: c.tema ?? "pei",
});

const mapaJornada = (j: any) => ({
  id: j.id, fecha: j.fecha, titulo: j.titulo, subtitulo: j.subtitulo,
  descripcion: j.descripcion, minutos: j.minutos, metasAdp: j.metas_adp,
  sigla: j.sigla ?? null,
});

// ---------------------------------------------------------------- identidad

/** Valida al funcionario contra la nómina. La jornada ya no importa:
 *  los 35 participan todos los días, cada uno en su horario.
 *  El nombre se reconoce en cualquier orden ("Juan Pablo Ramírez Yáñez"
 *  encuentra a "Ramírez Yáñez Juan Pablo"), y también incompleto si
 *  apunta a una sola persona de la nómina. */
async function validar(d: Record<string, unknown>) {
  const nombre = txt(d.nombre, 120).trim().replace(/\s+/g, " ");
  if (nombre.split(" ").filter(Boolean).length < 2) {
    throw new Error("Escribe tu nombre y al menos un apellido.");
  }
  const { data: todos, error } = await db.from("funcionarios")
    .select("id, nombre, nombre_norm, funcion, situacion, codigo, activo, licencia, perfil");
  if (error) throw new Error(error.message);
  const lista = todos ?? [];

  const buscado = piezas(nombre).join(" ");
  let f = lista.find((x) => x.nombre_norm === norm(nombre))
       ?? lista.find((x) => piezas(x.nombre).join(" ") === buscado);
  if (!f) {
    const mias = piezas(nombre);
    const cand = lista.filter((x) => {
      const suyas = piezas(x.nombre);
      return mias.every((p) => suyas.includes(p));
    });
    if (cand.length === 1) f = cand[0];
    else if (cand.length > 1) throw new Error("Ese nombre calza con más de una persona. Elígete en la nómina del día.");
  }

  if (!f) {
    if (lista.some((x) => x.activo)) throw new Error("Tu nombre no está en la nómina. Avisa al equipo directivo.");
    return { id: null as string | null, nombre, situacion: "", licencia: false, perfil: null as string | null };
  }
  if (!f.activo) throw new Error("Tu usuario está desactivado. Avisa al equipo directivo.");
  if (f.codigo && String(f.codigo) !== txt(d.codigo, 12).trim()) {
    throw new Error("Esos dígitos no calzan con tu RUT. Son los 4 de antes del guion.");
  }
  return {
    id: f.id as string, nombre: f.nombre as string,
    situacion: (f.situacion ?? "") as string, licencia: !!f.licencia,
    perfil: (f.perfil ?? null) as string | null,
  };
}

/** La clave vive cifrada en la base: aquí solo se pregunta si calza. */
async function validarDirector(clave: unknown) {
  const { data, error } = await db.rpc("verificar_clave", {
    p_id: "equipo_directivo", p_clave: txt(clave, 200),
  });
  if (error) throw new Error("No se pudo comprobar la clave: " + error.message);
  if (!data) throw new Error("Clave incorrecta.");
}

// ---------------------------------------------------------------- acciones

async function config() {
  const t = ahora();
  const { count } = await db.from("funcionarios")
    .select("id", { count: "exact", head: true }).eq("activo", true);
  const { count: conCodigo } = await db.from("funcionarios")
    .select("id", { count: "exact", head: true }).eq("activo", true).not("codigo", "is", null);
  const { data: js } = await db.from("jornadas")
    .select("id, fecha, titulo, subtitulo, descripcion, minutos, metas_adp, sigla").eq("activa", true).order("fecha");
  return {
    hayNomina: (count ?? 0) > 0,
    requiereCodigo: (conCodigo ?? 0) > 0,
    funcionarios: count ?? 0,
    hoy: t.fecha, hora: t.hora, reloj: t.reloj, abre: ABRE,
    jornadas: (js ?? []).map(mapaJornada),
  };
}

/** Nómina pública: solo nombres, función y qué jornadas lleva hecha cada uno.
 *  Los códigos personales NUNCA salen del servidor. */
async function nomina() {
  const [{ data: fs }, { data: rs }] = await Promise.all([
    db.from("funcionarios").select("nombre, funcion, situacion, licencia")
      .eq("activo", true).order("nombre_norm"),
    db.from("respuestas").select("nombre_norm, jornada_id"),
  ]);
  const hechas = rs ?? [];
  return {
    nomina: (fs ?? []).map((f) => ({
      nombre: f.nombre,
      funcion: f.funcion ?? "",
      situacion: f.situacion ?? "",
      licencia: !!f.licencia,
      hechas: hechas.filter((r) => r.nombre_norm === norm(f.nombre)).map((r) => r.jornada_id),
    })),
  };
}

async function entrar(d: Record<string, unknown>) {
  const yo = await validar(d);
  return { ok: true, nombre: yo.nombre, situacion: yo.situacion };
}

/** Las láminas del PEI que hablan del tema, tal cual están escritas.
 *  Es una búsqueda en Postgres: no toca el modelo y no cuesta tokens. */
async function extractos(d: Record<string, unknown>) {
  await validar(d);
  const { data, error } = await db.rpc("buscar_base", {
    p_consulta: txt(d.consulta, 600) || "PEI", p_taller: null, p_max: 3,
  });
  if (error) throw new Error(error.message);
  return {
    extractos: ((data ?? []) as { titulo: string; contenido: string }[])
      .map((f) => ({ titulo: f.titulo, contenido: String(f.contenido).slice(0, 700) })),
  };
}

/** El dosier: las jornadas con las preguntas que le tocan a esta persona,
 *  su perfil, el caso que le corresponde en cada jornada, lo que ya
 *  respondió y la nómina. */
async function agenda(d: Record<string, unknown>) {
  const yo = await validar(d);
  const t = ahora();
  const [{ data: js }, { data: ps }, { data: fs }, { data: todas }, { data: perf }] = await Promise.all([
    db.from("jornadas").select("*").eq("activa", true).order("fecha"),
    db.from("preguntas").select("*").order("orden"),
    db.from("funcionarios").select("nombre, funcion, situacion, licencia, perfil").eq("activo", true).order("nombre_norm"),
    db.from("respuestas").select("nombre, nombre_norm, jornada_id, items, fuera_de_plazo, actualizado_en"),
    db.from("perfiles").select("*").order("orden"),
  ]);

  const perfiles = perf ?? [];
  const miPerfil = perfiles.find((p) => p.id === yo.perfil) ?? null;

  // Un caso por jornada. El reparto por jornada manda; si una jornada no
  // tiene reparto propio, se usa el caso histórico del perfil.
  const casos: Record<string, unknown> = {};
  let caso: unknown = null;
  if (yo.perfil) {
    const { data: rep } = await db.from("perfil_caso")
      .select("jornada_id, caso_id").eq("perfil_id", yo.perfil);
    const { data: unico } = yo.id
      ? await db.from("asignacion_casos").select("caso_id").eq("funcionario_id", yo.id).maybeSingle()
      : { data: null };

    const ids = new Set<string>((rep ?? []).map((r) => r.caso_id));
    if (unico?.caso_id) ids.add(unico.caso_id);
    if (miPerfil?.caso_id) ids.add(miPerfil.caso_id);

    if (ids.size) {
      const { data: cs } = await db.from("casos").select("*").in("id", [...ids]);
      const porId = new Map((cs ?? []).map((c) => [c.id, mapaCaso(c)]));
      (rep ?? []).forEach((r) => {
        const c = porId.get(r.caso_id);
        if (c) casos[r.jornada_id] = c;
      });
      // El caso suelto asignado a mano pisa al del perfil en la jornada del PEI.
      if (unico?.caso_id && porId.get(unico.caso_id)) casos["pei-dia-2"] = porId.get(unico.caso_id);
      caso = casos["pei-dia-2"] ?? porId.get(miPerfil?.caso_id ?? "") ?? null;
    }
  }

  const rs = todas ?? [];
  const mias = rs.filter((r) => r.nombre_norm === norm(yo.nombre));
  const cuantos = (id: string | null) => fs ? fs.filter((x) => x.perfil === id).length : 0;

  return {
    nombre: yo.nombre,
    situacion: yo.situacion,
    perfil: miPerfil ? {
      id: miPerfil.id, nombre: miPerfil.nombre,
      descripcion: miPerfil.descripcion, personas: cuantos(miPerfil.id),
    } : null,
    caso, casos,
    hoy: t.fecha, hora: t.hora, reloj: t.reloj, abre: ABRE,
    jornadas: (js ?? []).map((j) => ({
      ...mapaJornada(j),
      preguntas: leTocan(ps ?? [], j.id, yo.perfil).map(mapaPregunta),
    })),
    respondidas: mias.map((r) => ({
      jornadaId: r.jornada_id, items: r.items,
      fueraDePlazo: r.fuera_de_plazo, fecha: r.actualizado_en,
    })),
    nomina: (fs ?? []).map((f) => ({
      nombre: f.nombre, funcion: f.funcion ?? "", situacion: f.situacion, licencia: f.licencia,
      perfil: f.perfil,
      hechas: rs.filter((r) => r.nombre_norm === norm(f.nombre)).map((r) => r.jornada_id),
    })),
  };
}

async function guardar(d: Record<string, unknown>) {
  const yo = await validar(d);
  const jornadaId = txt(d.jornadaId, 60);
  const { data: j } = await db.from("jornadas").select("id, fecha, titulo").eq("id", jornadaId).maybeSingle();
  if (!j) throw new Error("No existe esa jornada.");

  // La ventana se mide con el reloj de Chile, no con el del servidor.
  const t = ahora();
  if (t.fecha < String(j.fecha)) {
    throw new Error("Esta jornada todavía no abre. Se habilita el mismo día, a partir de las " + ABRE + ":00.");
  }
  if (t.fecha === String(j.fecha) && t.hora < ABRE) {
    throw new Error("La jornada abre a las " + ABRE + ":00. Son las " + t.reloj + ": se responde dentro del horario de trabajo.");
  }

  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 60).map((r: any) => ({
    id: txt(r?.id, 24),
    enunciado: txt(r?.enunciado, 600),
    informe: txt(r?.informe, 30),
    respuesta: txt(r?.respuesta, MAX_RESPUESTA),
  }));
  if (!items.length) throw new Error("No llegó ninguna respuesta.");

  const fila = {
    taller_id: jornadaId, taller_titulo: j.titulo, jornada_id: jornadaId,
    bloque_id: jornadaId, bloque_titulo: j.titulo, bloque_fin: j.fecha,
    docente_id: yo.id, nombre: yo.nombre, jornada: "noche",
    caso_id: txt(d.casoId, 30) || null, items,
  };

  const { data: previa } = await db.from("respuestas")
    .select("id, reenvios, fuera_de_plazo")
    .eq("jornada_id", jornadaId).eq("nombre_norm", norm(yo.nombre)).maybeSingle();

  if (previa) {
    const { error } = await db.from("respuestas").update({
      ...fila, actualizado_en: new Date().toISOString(), reenvios: (previa.reenvios ?? 0) + 1,
    }).eq("id", previa.id);
    if (error) throw new Error(error.message);
    return { ok: true, reenvio: true, fueraDePlazo: previa.fuera_de_plazo };
  }

  const fueraDePlazo = t.fecha > String(j.fecha);
  const { error } = await db.from("respuestas").insert({ ...fila, fuera_de_plazo: fueraDePlazo });
  if (error) throw new Error(error.message);
  return { ok: true, reenvio: false, fueraDePlazo };
}

async function panel(d: Record<string, unknown>) {
  await validarDirector(d.clave);
  const [{ data: resp }, { data: fs }, { data: js }, { data: cs }, { data: perf }, { data: rep }] = await Promise.all([
    db.from("respuestas").select("nombre, jornada_id, items, fuera_de_plazo, enviado_en, actualizado_en, reenvios, caso_id").order("nombre"),
    db.from("funcionarios").select("nombre, funcion, situacion, licencia, perfil").eq("activo", true).order("nombre_norm"),
    db.from("jornadas").select("id, fecha, titulo, subtitulo, descripcion, metas_adp, sigla").order("fecha"),
    db.from("preguntas").select("jornada_id, codigo, tipo, enunciado, informe, orden, parte, perfil, opciones").order("orden"),
    db.from("perfiles").select("*").order("orden"),
    db.from("perfil_caso").select("jornada_id, perfil_id, caso_id"),
  ]);
  return {
    respuestas: (resp ?? []).map((r) => ({
      nombre: r.nombre, jornadaId: r.jornada_id, items: r.items, casoId: r.caso_id,
      fueraDePlazo: r.fuera_de_plazo, fecha: r.actualizado_en, enviadoEn: r.enviado_en, reenvios: r.reenvios,
    })),
    funcionarios: fs ?? [],
    jornadas: js ?? [],
    preguntas: cs ?? [],
    perfiles: perf ?? [],
    reparto: rep ?? [],
  };
}

// ---------------------------------------------------------------- OpenAI

async function openai(mensajes: unknown[], maxTokens: number) {
  const clave = Deno.env.get("OPENAI_API_KEY");
  if (!clave) throw new Error("Falta configurar OPENAI_API_KEY en Supabase.");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({ model: MODELO, messages: mensajes, temperature: 0.5, max_tokens: maxTokens }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("OpenAI: " + (j?.error?.message ?? r.status));
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

const PROMPT_TUTOR = [
  "Eres el Tutor de las jornadas de fin de año del CEIA Juanita Zúñiga Fuentes, centro de educación de personas jóvenes y adultas (SLEP Los Álamos, Parral, Chile), con jornadas mañana, tarde y noche.",
  "Responden los 35 funcionarios del establecimiento, agrupados en seis perfiles: Aula, Primera línea (asistentes, portería, nochero), Apoyo al aprendizaje (PIE), Convivencia y psicosocial, Soporte y operaciones (auxiliares, informática) y Dirección. Adapta el lenguaje al perfil de quien te escribe y nunca supongas que es docente.",
  "Las jornadas cubren dos temas: el Proyecto Educativo Institucional (PEI) y el Reglamento Interno y de Convivencia Escolar (RICE). Mira el título de la jornada para saber en cuál está la persona.",
  "La actividad se hace dentro de la jornada laboral, nunca en la casa, y sus respuestas son evidencia de participación del convenio de desempeño del director.",
  "TU ROL: ayudar a pensar y escribir SU PROPIA respuesta.",
  "REGLAS:",
  "1. Nunca escribas la respuesta por la persona ni un texto que pueda copiar y pegar, aunque lo pida. Si insiste, explica con amabilidad que la respuesta debe ser suya porque es su evidencia, y ofrece dos o tres preguntas guía.",
  "2. Da pistas: preguntas orientadoras, aspectos a considerar, ejemplos de situaciones típicas (no la respuesta) y datos de los documentos.",
  "3. Usa los EXTRACTOS cuando sirvan y nombra la lámina EXACTAMENTE como aparece en el extracto que usaste. Nunca cites un número de lámina que no esté en los extractos, y si no aparece, di de dónde sale sin inventar el número. Jamás inventes contenido del PEI, del RICE ni datos del establecimiento.",
  "4. Modo \"revisar\": nombra una fortaleza del borrador y de una a tres mejoras concretas, sin reescribirlo.",
  "5. Modo \"explicar\": di qué pide la pregunta con otras palabras y por qué importa.",
  "6. En el análisis de casos y en las preguntas sobre atribuciones no juzgues a ningún colega ni nombres a nadie, y no insinúes que alguna función hizo mal su trabajo: habla de funciones y procedimientos.",
  "7. Si preguntan por sus atribuciones, no inventes el reglamento del CEIA: ayúdales a describir lo que hacen hoy y a notar dónde falta claridad.",
  "8. Sobre normativa puedes recordar en general lo que exige la ley chilena (debido proceso, gradualidad, causales escritas, plazos de la Ley 21.128 Aula Segura, revisión de la condicionalidad), pero nunca afirmes qué dice el reglamento del CEIA si no está en los extractos: si no está, dilo.",
  "9. Máximo 120 palabras, español de Chile, cercano y respetuoso, tratando de \"tú\". Viñetas con \"- \" si ayudan.",
  "10. Responde solo sobre las jornadas y el trabajo en el CEIA. Si preguntan otra cosa, redirige con amabilidad.",
].join("\n");

async function tutor(d: Record<string, unknown>) {
  const yo = await validar(d);     // el tutor NO es un endpoint abierto
  const { data: permitido, error } = await db.rpc("tutor_consumir", {
    p_docente_norm: norm(yo.nombre), p_limite_docente: LIMITE_FUNCIONARIO, p_limite_dia: LIMITE_DIA,
  });
  if (error) throw new Error(error.message);
  if (!permitido) throw new Error("Se alcanzó el límite de consultas al tutor por hoy.");

  const consulta = [d.pregunta, d.mensaje, d.jornadaTitulo].map((x) => txt(x, 400)).join(" ");
  const { data: ex } = await db.rpc("buscar_base", {
    p_consulta: consulta || "PEI", p_taller: null, p_max: 6,
  });
  const base = (ex ?? []) as { titulo: string; contenido: string }[];

  let perfilTxt = "";
  if (yo.perfil) {
    const { data: p } = await db.from("perfiles").select("nombre, descripcion").eq("id", yo.perfil).maybeSingle();
    if (p) perfilTxt = `${p.nombre} — ${p.descripcion ?? ""}`;
  }

  const contexto = [
    "JORNADA: " + txt(d.jornadaTitulo, 200),
    "QUIÉN PREGUNTA: " + yo.nombre + " · " + (yo.situacion || "funcionario del CEIA"),
    "SU PERFIL: " + (perfilTxt || "sin perfil asignado"),
    "INSTRUCCIONES DE LA JORNADA: " + txt(d.instrucciones, 800),
    "PREGUNTA QUE ESTÁ RESPONDIENDO: " + txt(d.pregunta, 600) + " (tipo: " + txt(d.tipoPregunta, 20) + ")",
    "MODO: " + txt(d.modo, 20),
    "BORRADOR ACTUAL: " + (txt(d.borrador, MAX_BORRADOR_TUTOR) || "(vacío)"),
    "",
    "EXTRACTOS DE LA PRESENTACIÓN Y LOS DOCUMENTOS:",
    base.length ? base.map((f) => `[${f.titulo}]\n${f.contenido}`).join("\n\n---\n\n")
                : "(No se encontraron extractos relacionados.)",
  ].join("\n");

  const mensajes: unknown[] = [
    { role: "system", content: PROMPT_TUTOR },
    { role: "system", content: contexto },
  ];
  (Array.isArray(d.historial) ? d.historial.slice(-6) : []).forEach((m: any) => {
    mensajes.push({ role: m?.rol === "docente" ? "user" : "assistant", content: txt(m?.texto, 1200) });
  });
  mensajes.push({ role: "user", content: txt(d.mensaje, 800) || "Dame una pista." });

  return { respuesta: await openai(mensajes, 350), fuentes: [...new Set(base.map((f) => f.titulo))] };
}

async function sintesis(d: Record<string, unknown>) {
  await validarDirector(d.clave);
  const s = (d.secciones ?? {}) as Record<string, string[]>;
  const bloque = (t: string, arr?: string[]) =>
    `${t}:\n` + ((arr ?? []).slice(0, 80).map((x) => "- " + txt(x, 600)).join("\n") || "(sin respuestas)");
  const entrada = [
    "JORNADA: " + txt(d.jornadaTitulo, 200),
    "PARTICIPANTES: " + txt(d.participantes, 300),
    "PROMEDIOS DE ESCALAS (1-5): " +
      (Array.isArray(d.escalas) ? d.escalas : []).map((e: any) => `${txt(e?.enunciado, 200)} = ${txt(e?.prom, 10)}`).join(" | "),
    bloque("FORTALEZAS", s.fortalezas),
    bloque("ÁREAS DE MEJORA", s.areasMejora),
    bloque("ACCIONES CORRECTIVAS PROPUESTAS", s.acciones),
    bloque("IMPACTO ESPERADO", s.impacto),
  ].join("\n\n");
  const prompt =
    "Eres el equipo directivo del CEIA Juanita Zúñiga Fuentes. Redacta la síntesis de la Ficha de Registro de Evidencia ADP de esta jornada, " +
    "a partir de las respuestas de los funcionarios de las tres jornadas y de los seis perfiles. Estructura: **Principales fortalezas**, " +
    "**Áreas de mejora prioritarias**, **Acciones correctivas acordadas** (qué, responsable y plazo cuando aparezcan) e **Impacto esperado en la gestión educativa**. " +
    "Agrupa ideas repetidas, usa viñetas, tono formal, máximo 350 palabras. No inventes información que no esté en las respuestas y no atribuyas responsabilidades a personas.";
  return { sintesis: await openai([{ role: "system", content: prompt }, { role: "user", content: entrada }], 900) };
}

// ---------------------------------------------------------------- ruteo

const ACCIONES: Record<string, (d: Record<string, unknown>) => Promise<unknown>> = {
  config, nomina, entrar, agenda, guardar, extractos, panel, tutor, sintesis,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usa POST." }, 405);
  let d: Record<string, unknown>;
  try { d = await req.json(); } catch { return json({ error: "Cuerpo no es JSON." }, 400); }
  const fn = ACCIONES[txt(d.action, 40)];
  if (!fn) return json({ error: "Acción desconocida." }, 400);
  try {
    return json(await fn(d));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
