/**
 * ============================================================
 *  Archivo: Auditoria.gs — lectura del historial y auditoría
 *  de calidad por reglas objetivas (sin inteligencia artificial).
 *  Cada criterio guarda la evidencia textual que lo sustenta.
 * ============================================================
 */
const REGLAS_VERSION = 'reglas-v1';
const SYS_USER = 'SISTEMAS API WEB SALUD DIGNA';
const ENTRY_RE = /^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .]+?) - (\d{2})\/(\d{2})\/(\d{4}) - /gm;
const CIERRE_LINEA_RE = /Se realiz[oó] el cierre del [AÁ]rea - Motivo: .*$/gm;

/** Divide el Historial de Seguimiento en gestiones {a: autor, d: día (ms ingenuo), t: texto, cl: es cierre, auto: cierre automático}. */
function parseHist_(h) {
  const out = []; if (!h) return out; h = String(h);
  const idx = []; let m; ENTRY_RE.lastIndex = 0;
  while ((m = ENTRY_RE.exec(h))) idx.push({ a: m[1].trim(), d: Date.UTC(+m[4], +m[3] - 1, +m[2]), s: m.index, hs: m.index + m[0].length });
  idx.forEach(function (e, i) {
    const end = i + 1 < idx.length ? idx[i + 1].s : h.length; const t = h.slice(e.hs, end).trim();
    out.push({ a: e.a, d: e.d, t: t, cl: /Se realiz[oó] el cierre|Cierre autom[aá]tico/i.test(t), auto: /Cierre autom[aá]tico de queja/i.test(t) });
  });
  return out;
}
function nrm_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' '); }

/* Palabras clave por criterio (texto normalizado: minúsculas, sin acentos). */
const KW = {
  investigacion: ['revis', 'valid', 'verific', 'consult', 'historial', 'corrobor', 'confirm', 'se solicit', 'escal', 'gerent', 'experto', 'sistema', 'reservaci', 'rsv', 'fecha de toma', 'emitid', 'ticket', 'se identific', 'expediente', 'camara', 'supervisor', 'encargad', 'coordinador'],
  contacto: ['llamad', 'llamo', 'contact', 'whatsapp', 'correo', 'buzon', 'marco', 'marque', 'se comunic', 'mensaje', 'no contest', 'sin respuesta', 'telefon', 'se le inform', 'se le explic', 'no responde'],
  evidencia: ['evidencia', 'adjunt', 'captura', 'agrego', 'anexo', 'imagen', 'foto', 'comprobante', 'pantalla'],
  causa: ['causa', 'debido a', 'se debio', 'por error', 'por falla', 'falta de', 'se origin', 'derivado de', 'a consecuencia', 'motivo fue'],
  justificacion: ['por lo que', 'ya que', 'debido', 'en base a', 'con base', 'se confirma', 'se valida', 'procede', 'se aplica', 'se otorga', 'reembols', 'descuento', 'se reprograma', 'se entrega', 'se envia', 'queda conforme', 'acepta', 'se resuelve', 'se aclara', 'se explica', 'se informa', 'resultado', 'se cierra', 'cierro'],
};
/* Categorías de causa raíz inferidas del texto de la gestión (no del comentario del paciente). */
const CAUSA_CAT = [
  ['Falla o error de sistema', ['falla de sistema', 'falla en sistema', 'error de sistema', 'sin sistema', 'no hay sistema', 'interfaz', 'se cayo el sistema', 'sistema lento', 'portal', 'no carga', 'plataforma']],
  ['Retraso o error en emisión/entrega de resultados', ['no estan emitid', 'pendiente de emitir', 'no se han entregado', 'sin resultados', 'retraso en resultados', 'no le han entregado', 'entrega de resultados', 'resultados no']],
  ['Error en toma de estudio o muestra', ['repetir', 'repeticion', 'muestra', 'mal tomad', 'estudio mal', 'toma incorrect', 'hemolizad', 'derramad', 'fuera de temperatura', 'mala calidad de imagen']],
  ['Error de cobro o facturación', ['cobro', 'cobraron', 'cargo doble', 'factura', 'precio', 'tarifa', 'promocion']],
  ['Reembolso o devolución pendiente', ['reembolso', 'devolucion']],
  ['Tiempo de espera / saturación', ['tiempo de espera', 'saturad', 'mucha gente', 'demora']],
  ['Trato inadecuado del personal', ['grosera', 'grosero', 'mal trato', 'maltrato', 'actitud', 'prepotente', 'trato inadecuado']],
  ['Información incorrecta o incompleta al paciente', ['informacion incorrecta', 'mal informad', 'no le informaron', 'informacion erronea', 'no se le explic']],
  ['Desapego a proceso o protocolo', ['desapego', 'no siguio el proceso', 'protocolo', 'procedimiento']],
  ['Falta de personal, insumos o equipo', ['falta de personal', 'sin personal', 'falta de insumos', 'sin insumos', 'equipo descompuesto', 'equipo danado']],
  ['Error diagnóstico o de interpretación', ['diagnostico', 'interpretacion', 'mal interpretad', 'reporte incorrect']],
];
const CRITERIOS = [
  ['C1', 'Claridad de la información', 1], ['C2', 'Identificación del motivo', 1], ['C3', 'Investigación realizada', 1.5],
  ['C4', 'Seguimiento documentado', 1.5], ['C5', 'Evidencia de acciones', 1], ['C6', 'Identificación de causa raíz', 1],
  ['C7', 'Justificación de la resolución', 1.5], ['C8', 'Cumplimiento de tiempos', 1], ['C9', 'Claridad en el cierre', 1],
];
const RECOMENDACION = {
  C1: 'Registrar en cada gestión qué se hizo, con quién y qué resultado se obtuvo, con redacción completa.',
  C2: 'Verificar que cada motivo tenga área y motivo correctos antes de trabajar el folio.',
  C3: 'Documentar la investigación: qué se revisó (historial, sistema, clínica, experto) y qué se encontró.',
  C4: 'Registrar cada intento de contacto con el paciente (llamada, WhatsApp, correo) y su resultado.',
  C5: 'Dejar evidencia de las acciones (capturas, comprobantes, folios de devolución o ticket).',
  C6: 'Identificar y registrar la causa raíz (columna Causas o explicación en la gestión).',
  C7: 'Explicar en la última gestión por qué se resuelve así y qué se ofreció al paciente.',
  C8: 'Hacer el primer contacto dentro de 2 días y cerrar dentro de la meta de tiempo.',
  C9: 'Cerrar con clasificación PROCEDE/NO PROCEDE y, si procede, registrar la acción correctiva.',
};

function hits_(t, lista) { return lista.filter(function (w) { return t.indexOf(w) >= 0; }); }
function fragmento_(texto, palabra) {
  const tn = nrm_(texto); const i = tn.indexOf(palabra); if (i < 0) return '';
  const a = Math.max(0, i - 60), b = Math.min(texto.length, i + palabra.length + 80);
  return (a > 0 ? '…' : '') + texto.slice(a, b).replace(/\s+/g, ' ').trim() + (b < texto.length ? '…' : '');
}

/**
 * Audita un folio cerrado. rows: registros del folio (objetos de la hoja Folios con fechas en ms ingenuos).
 * entries: gestiones humanas (sin SISTEMAS API). f: datos del folio ya calculados. cfg: configuración.
 */
function auditarFolio_(f, rows, entries, cfg) {
  const est = {}, evid = {};
  const textoGestion = entries.map(function (e) { return e.t.replace(CIERRE_LINEA_RE, '').trim(); }).join('\n');
  const tn = nrm_(textoGestion); const largo = textoGestion.replace(/\s+/g, ' ').trim().length;
  // C1 Claridad
  est.C1 = largo >= 150 ? 'C' : largo >= 60 ? 'P' : 'N';
  evid.C1 = largo + ' caracteres útiles en ' + entries.length + ' gestión(es) de personas.';
  // C2 Motivo
  const sinMotivo = rows.filter(function (r) { return !r.area || !r.motivo; });
  est.C2 = sinMotivo.length ? 'N' : 'C';
  evid.C2 = rows.map(function (r) { return (r.area || '¿área?') + ' / ' + (r.motivo || '¿motivo?'); }).join(' · ');
  // C3 Investigación
  const inv = hits_(tn, KW.investigacion);
  est.C3 = inv.length >= 2 ? 'C' : inv.length === 1 ? 'P' : 'N';
  evid.C3 = inv.length ? 'Palabras: ' + inv.slice(0, 5).join(', ') + ' — "' + fragmento_(textoGestion, inv[0]) + '"' : 'Sin descripción de revisión o investigación.';
  // C4 Seguimiento
  const con = hits_(tn, KW.contacto);
  est.C4 = con.length && entries.length >= 2 ? 'C' : (con.length || entries.length >= 2) ? 'P' : 'N';
  evid.C4 = entries.length + ' gestión(es); contacto: ' + (con.length ? con.slice(0, 4).join(', ') + ' — "' + fragmento_(textoGestion, con[0]) + '"' : 'no se documenta contacto con el paciente');
  // C5 Evidencia
  const ev = hits_(tn, KW.evidencia);
  est.C5 = ev.length ? 'C' : 'N';
  evid.C5 = ev.length ? '"' + fragmento_(textoGestion, ev[0]) + '"' : 'No se menciona evidencia (capturas, comprobantes, adjuntos).';
  // C6 Causa raíz (y clasificación)
  const causasCol = rows.map(function (r) { return r.causas; }).filter(Boolean);
  let causa = 'No determinable', fuente = 'N';
  if (causasCol.length) { causa = String(causasCol[0]).split(',')[0].trim(); fuente = 'C'; est.C6 = 'C'; evid.C6 = 'Columna Causas: ' + causasCol.join(' · '); }
  else {
    let best = null, bh = 0; CAUSA_CAT.forEach(function (c) { const h = hits_(tn, c[1]).length; if (h > bh) { bh = h; best = c; } });
    const cz = hits_(tn, KW.causa);
    if (best) { causa = best[0]; fuente = 'T'; }
    est.C6 = cz.length || best ? 'P' : 'N';
    evid.C6 = best ? 'Inferida del texto de la gestión (' + hits_(tn, best[1]).join(', ') + ') — "' + fragmento_(textoGestion, hits_(tn, best[1])[0]) + '"' : cz.length ? '"' + fragmento_(textoGestion, cz[0]) + '"' : 'La gestión no identifica causa raíz.';
  }
  // C7 Justificación (últimas 2 gestiones)
  const ult = entries.slice(-2).map(function (e) { return e.t.replace(CIERRE_LINEA_RE, '').trim(); }).join(' ');
  const un = nrm_(ult); const jl = un.trim().length; const ju = hits_(un, KW.justificacion);
  est.C7 = ju.length && jl >= 60 ? 'C' : jl >= 20 ? 'P' : 'N';
  evid.C7 = jl ? '"' + ult.replace(/\s+/g, ' ').slice(0, 220) + (ult.length > 220 ? '…' : '') + '"' : 'La gestión final no explica la resolución.';
  // C8 Tiempos
  const ap = f.fAp !== null ? Math.round((f.fAp - Date.UTC(new Date(f.fReg).getUTCFullYear(), new Date(f.fReg).getUTCMonth(), new Date(f.fReg).getUTCDate())) / 864e5) : null;
  const ok1 = ap !== null && ap <= Number(cfg.APERTURA_DIAS);
  const metaH = String(cfg.TIEMPO_RANKING).toUpperCase() === '7D' ? cfg.CIERRE_DIAS * 24 : cfg.SLA_CIERRE_H;
  const inicio = cfg.INICIO_CIERRE === 'apertura' && f.fAp !== null ? f.fAp : f.fReg;
  const hC = f.fCierre !== null ? (f.fCierre - inicio) / 36e5 : null;
  const ok2 = hC !== null && hC <= metaH;
  est.C8 = ok1 && ok2 ? 'C' : ok1 || ok2 ? 'P' : 'N';
  evid.C8 = 'Registro → 1er comentario: ' + (ap === null ? 'sin comentario' : ap + ' día(s)') + '; cierre: ' + (hC === null ? '—' : (hC / 24).toFixed(1) + ' días') + ' (meta ' + (metaH / 24).toFixed(metaH % 24 ? 1 : 0) + ' días).';
  // C9 Cierre
  const clas = rows.map(function (r) { return r.clasif || ''; });
  const sinDef = clas.some(function (c) { return c !== 'PROCEDE' && c !== 'NO PROCEDE'; });
  const procSinAccion = rows.some(function (r) { return r.clasif === 'PROCEDE' && !r.acciones; });
  est.C9 = sinDef ? 'N' : procSinAccion ? 'P' : 'C';
  evid.C9 = 'Clasificación: ' + clas.map(function (c) { return c || 'vacía'; }).join(' · ') + '; acciones: ' + (rows.map(function (r) { return r.acciones; }).filter(Boolean).join(' · ') || 'ninguna');
  // Puntaje y calidad
  let sum = 0, peso = 0;
  CRITERIOS.forEach(function (c) { const v = est[c[0]]; sum += c[2] * (v === 'C' ? 1 : v === 'P' ? 0.5 : 0); peso += c[2]; });
  const score = sum / peso;
  const calidad = !entries.length || largo < 30 ? 'N' : score >= cfg.AUD_ADECUADA ? 'A' : score >= cfg.AUD_PARCIAL ? 'P' : 'I';
  // Procedencia (no se asume sin evidencia)
  let proc;
  if (sinDef && !clas.some(function (c) { return c === 'PROCEDE'; })) proc = 'D';
  else if (est.C7 === 'N' || calidad === 'N') proc = 'D';
  else proc = clas.indexOf('PROCEDE') >= 0 ? 'P' : 'N';
  const crit = CRITERIOS.map(function (c) { return est[c[0]]; }).join('');
  return { calidad: calidad, score: Math.round(score * 100), proc: proc, causa: causa, fuente: fuente, crit: crit, evid: evid, obs: observacion_(calidad, crit, proc), oport: oportunidad_(crit) };
}

const CAL_LBL = { A: 'Gestión adecuada', P: 'Gestión parcialmente adecuada', I: 'Gestión inadecuada', N: 'Información insuficiente para evaluar' };
const PROC_LBL = { P: 'Procedente', N: 'No procedente', D: 'No determinable por falta de información' };
/** Texto objetivo a partir de los criterios (la misma función existe en el frontend). */
function observacion_(cal, crit, proc) {
  const ok = [], par = [], no = [];
  CRITERIOS.forEach(function (c, i) { const v = crit[i]; (v === 'C' ? ok : v === 'P' ? par : no).push(c[1].toLowerCase()); });
  let s = CAL_LBL[cal] + '. ';
  if (cal === 'N') return s + 'El historial no contiene gestiones de personas suficientes para evaluar la atención.';
  if (ok.length) s += 'Cumple: ' + ok.join(', ') + '. ';
  if (par.length) s += 'Parcial: ' + par.join(', ') + '. ';
  if (no.length) s += 'No cumple: ' + no.join(', ') + '. ';
  if (proc === 'D') s += 'La procedencia no se puede confirmar con la información registrada.';
  return s.trim();
}
function oportunidad_(crit) {
  const no = [], par = [];
  CRITERIOS.forEach(function (c, i) { if (crit[i] === 'N') no.push(c[1]); else if (crit[i] === 'P') par.push(c[1]); });
  return (no.length ? no : par).slice(0, 2).join('; ') || 'Sin área de oportunidad';
}

