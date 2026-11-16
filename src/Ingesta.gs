/**
 * ============================================================
 *  Archivo: Ingesta.gs — lee el Excel de origen (.xlsm/.xlsx en
 *  Drive, Config → ARCHIVO_ORIGEN_ID) cuando cambia, lo consolida en
 *  la hoja Folios sin duplicar, registra cambios, audita folios y
 *  genera la caché mensual del dashboard.
 *  Requiere el servicio avanzado "Drive API" (v3) habilitado.
 * ============================================================
 */
/** Encabezados del reporte → clave interna. */
const REP_COLS = [
  ['folio', 'folio'], ['asunto', 'asunto'], ['division', 'division'], ['zona', 'zona'], ['sucursal', 'sucursal'], ['medio', 'medio contacto'], ['captura', 'usuario captura'],
  ['fEstudio', 'fecha del estudio'], ['rsv', 'rsv/opc'], ['destino', 'destino'], ['area', 'area'], ['subest', 'subestudio'], ['motivo', 'motivo'], ['colab', 'colaborador responsable'],
  ['paciente', 'nombre paciente'], ['fnac', 'fecha de nacimiento'], ['tel', 'telefono contacto'], ['telInt', 'telefono internacional'], ['coment', 'comentarios'], ['estatus', 'estatus'],
  ['fReg', 'fecha registro'], ['fFs', 'fecha de primer seguimiento'], ['fCierre', 'fecha cierre'], ['acciones', 'acciones correctivas'], ['hist', 'historial de seguimiento'],
  ['impacto', 'tipo de impacto'], ['clasif', 'clasificacion de cierre'], ['atClin', 'atencion de clinica'], ['expTec', 'seguimiento por experto tecnico'], ['dias', 'dias transcurridos'],
  ['causas', 'causas'], ['ejec', 'ejecutivo reactivo'], ['reasigU', 'usuario reasignado automatico'], ['reasigF', 'fecha re-asignacion automatica'],
];
const REQ = ['folio', 'estatus', 'fReg', 'ejec', 'area', 'motivo'];
/* Apps Script corta cada ejecución a los 6 min: se deja margen para guardar el avance. */
const LIMITE_MS = 4 * 60 * 1000;

/**
 * Punto de entrada del activador horario y del botón "Sincronizar ahora".
 * Solo procesa el Excel si cambió desde la última lectura (o si forzar = true).
 */
function procesarOrigen(forzar) {
  forzar = forzar === true;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { estado: 'Otro proceso está corriendo; intenta en unos minutos.' };
  const t0 = Date.now(); const props = PropertiesService.getScriptProperties();
  const salida = { archivos: [], mesesReconstruidos: [], pendientes: [] };
  try {
    const cfg = leerConfig_();
    const meses = {}; JSON.parse(props.getProperty('MESES_PENDIENTES') || '[]').forEach(function (m) { meses[m] = true; });
    if (cfg.ARCHIVO_ORIGEN_ID) {
      const file = DriveApp.getFileById(cfg.ARCHIVO_ORIGEN_ID);
      const sello = String(file.getLastUpdated().getTime()) + '|' + cfg.ARCHIVO_ORIGEN_ID;
      props.setProperties({ ORIGEN_NOMBRE: file.getName(), ORIGEN_MODIF: Utilities.formatDate(file.getLastUpdated(), TZ, 'yyyy-MM-dd HH:mm') });
      if (forzar || props.getProperty('ORIGEN_SELLO') !== sello) {
        try {
          const r = procesarArchivo_(file, cfg);
          r.meses.forEach(function (m) { meses[m] = true; });
          salida.archivos.push(r);
          // Se guardan ANTES de reconstruir: si se acaba el tiempo, la siguiente corrida termina los meses
          // (antes se perdían y el dashboard no mostraba lo nuevo hasta que el Excel volviera a cambiar).
          props.setProperty('MESES_PENDIENTES', JSON.stringify(Object.keys(meses).sort()));
          props.setProperty('ORIGEN_SELLO', sello);
          props.setProperty('ORIGEN_LEIDO', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
        } catch (e) { salida.archivos.push({ archivo: file.getName(), error: e.message }); registrarCargaError_(file, e.message); }
      } else salida.estado = 'Sin cambios en el Excel desde la última lectura.';
    } else salida.aviso = 'Falta ARCHIVO_ORIGEN_ID en la hoja Config.';
    // Primero los meses más recientes: son los que el dashboard abre al iniciar.
    const lista = Object.keys(meses).sort().reverse(); const ctx = {};
    for (let i = 0; i < lista.length; i++) {
      if (Date.now() - t0 > LIMITE_MS) { salida.pendientes = lista.slice(i); break; }
      salida.mesesReconstruidos.push(reconstruirMes_(lista[i], cfg, ctx));
      props.setProperty('MESES_PENDIENTES', JSON.stringify(lista.slice(i + 1)));
    }
    if (salida.mesesReconstruidos.length || salida.archivos.length) props.setProperty('ULTIMA_ACTUALIZACION', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    programarContinuacion_(salida.pendientes.length > 0);
    if (Date.now() - t0 < LIMITE_MS) { try { salida.cacheCalentada = calentarCache_(4); } catch (e) { } }
    if (Date.now() - t0 < LIMITE_MS) { try { leerReasignados_(); } catch (e) { } }
  } finally { lock.releaseLock(); }
  return salida;
}
/** Si quedaron meses sin reconstruir, se agenda otra corrida en 1 minuto (no se espera a la siguiente hora). */
function programarContinuacion_(hayPendientes) {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'continuarPendientes') ScriptApp.deleteTrigger(t); });
    if (hayPendientes) ScriptApp.newTrigger('continuarPendientes').timeBased().after(60 * 1000).create();
  } catch (e) { console.warn('No se pudo agendar la continuación: ' + e.message); }
}
function continuarPendientes() { return procesarOrigen(false); }
/** Compatibilidad con activadores de la versión anterior. */
function procesarCarpeta() { return procesarOrigen(false); }

/** Datos del Excel de origen. Sin "vivo" sale de las propiedades (rápido); con "vivo" consulta Drive. */
function infoOrigen_(vivo) {
  const props = PropertiesService.getScriptProperties();
  const out = { id: '', nombre: props.getProperty('ORIGEN_NOMBRE') || '', modificado: props.getProperty('ORIGEN_MODIF') || '', leido: props.getProperty('ORIGEN_LEIDO') || '', url: '' };
  try {
    out.id = leerConfig_().ARCHIVO_ORIGEN_ID;
    if (vivo) { const f = DriveApp.getFileById(out.id); out.nombre = f.getName(); out.url = f.getUrl(); out.modificado = Utilities.formatDate(f.getLastUpdated(), TZ, 'yyyy-MM-dd HH:mm'); }
  } catch (e) { out.error = e.message; }
  return out;
}

/* ------------------------------------------------------------
 *  LECTURA Y VALIDACIÓN DEL REPORTE
 * ------------------------------------------------------------ */
/** Devuelve los valores de la hoja que contiene la tabla (fila con Folio y Estatus). */
function hojaConTabla_(ss) {
  const hojas = ss.getSheets();
  for (let i = 0; i < hojas.length; i++) {
    const sh = hojas[i]; if (sh.getLastRow() < 2) continue;
    const top = sh.getRange(1, 1, Math.min(20, sh.getLastRow()), Math.max(1, sh.getLastColumn())).getValues();
    const ok = top.some(function (r) { return r.some(function (c) { return nrm_(c).trim() === 'folio'; }) && r.some(function (c) { return nrm_(c).trim() === 'estatus'; }); });
    if (ok) return sh.getDataRange().getValues();
  }
  return hojas[0].getDataRange().getValues();
}
/** Convierte el .xlsm/.xlsx a un Google Sheets temporal (Drive API v3), lo lee y lo borra. */
function leerValoresArchivo_(file) {
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) { const ss = SpreadsheetApp.openById(file.getId()); return { valores: hojaConTabla_(ss), tz: ss.getSpreadsheetTimeZone() }; }
  const res = { name: 'tmp_rp_' + file.getName(), mimeType: MimeType.GOOGLE_SHEETS, parents: [carpetaSistema_().getId()] };
  let tmp;
  try { tmp = Drive.Files.copy(res, file.getId(), { supportsAllDrives: true }); }
  catch (e) { tmp = Drive.Files.create(res, file.getBlob(), { supportsAllDrives: true }); }
  try {
    const ss = SpreadsheetApp.openById(tmp.id); ss.setSpreadsheetTimeZone(TZ); SpreadsheetApp.flush();
    return { valores: hojaConTabla_(ss), tz: TZ };
  } finally { DriveApp.getFileById(tmp.id).setTrashed(true); }
}
/**
 * Fecha → ms "ingenuos". Los textos se leen dd/mm/aaaa; si ref (Fecha Registro) viene y el texto
 * es ambiguo (p. ej. "10/01/2026 11:25" en Primer seguimiento, que el reporte escribe mm/dd),
 * se elige la lectura más cercana a ref que no sea anterior a ella.
 */
function aNaive_(v, tz, ref) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) {
    let ms;
    if (tz === TZ) ms = dateANaive_(v);
    else { const s = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss'); ms = Date.UTC(+s.substr(0, 4), +s.substr(5, 2) - 1, +s.substr(8, 2), +s.substr(11, 2), +s.substr(14, 2), +s.substr(17, 2)); }
    // Si al convertir el Excel, Sheets leyó "mm/dd" como "dd/mm", la fecha queda ANTES del registro (imposible).
    // En ese caso se prueba con día y mes invertidos y se usa si ya no queda antes del registro.
    if (ref !== null && ref !== undefined) {
      const dr = new Date(ref), dia = Date.UTC(dr.getUTCFullYear(), dr.getUTCMonth(), dr.getUTCDate());
      if (ms < dia) {
        const d = new Date(ms), dd = d.getUTCDate(), mm = d.getUTCMonth() + 1;
        if (dd <= 12 && dd !== mm) { const alt = Date.UTC(d.getUTCFullYear(), dd - 1, mm, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); if (alt >= dia) ms = alt; }
      }
    }
    return ms;
  }
  if (typeof v === 'number') return Math.round((v - 25569) * 864e5);
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const a = +m[1], b = +m[2], y = m[3].length === 2 ? 2000 + Number(m[3]) : +m[3], hh = +(m[4] || 0), mi = +(m[5] || 0), ss = +(m[6] || 0);
  const dmy = b <= 12 ? Date.UTC(y, b - 1, a, hh, mi, ss) : null;
  const mdy = a <= 12 && b <= 31 ? Date.UTC(y, a - 1, b, hh, mi, ss) : null;
  if (dmy !== null && mdy !== null && a !== b && ref !== null && ref !== undefined) {
    const dia = Date.UTC(new Date(ref).getUTCFullYear(), new Date(ref).getUTCMonth(), new Date(ref).getUTCDate());
    const pena = function (x) { return x < dia ? 1e15 + (dia - x) : x - dia; };
    return pena(dmy) <= pena(mdy) ? dmy : mdy;
  }
  return dmy !== null ? dmy : mdy;
}
function parsearReporte_(valores, tz) {
  const hi = valores.findIndex(function (r) { return r.some(function (c) { return nrm_(c).trim() === 'folio'; }) && r.some(function (c) { return nrm_(c).trim() === 'estatus'; }); });
  if (hi < 0) throw new Error('No se encontró la fila de encabezados (Folio, Estatus).');
  const hdr = valores[hi].map(function (c) { return nrm_(c).trim(); });
  // Coincidencia exacta o por inicio; si no, sin acentos, espacios ni "de/del" ("Fecha Primer Seguimiento" = "fecha de primer seguimiento").
  const compacto = function (t) { return nrm_(t).replace(/\b(de|del|la|el|los|las)\b/g, '').replace(/[^a-z0-9]/g, ''); };
  const hdrC = hdr.map(compacto);
  const map = {}; REP_COLS.forEach(function (c) {
    let i = hdr.findIndex(function (x) { return x === c[1] || x.indexOf(c[1]) === 0; });
    if (i < 0) { const k = compacto(c[1]); i = hdrC.findIndex(function (x) { return x && (x === k || x.indexOf(k) === 0); }); }
    if (i >= 0) map[c[0]] = i;
  });
  const falt = REQ.filter(function (k) { return map[k] === undefined; });
  if (falt.length) throw new Error('Faltan columnas obligatorias: ' + falt.join(', '));
  const warns = []; let pFrom = null, pTo = null;
  const OPCIONALES = { fFs: 'Fecha de primer seguimiento (sin ella la apertura se mide con el historial)', fCierre: 'Fecha Cierre', hist: 'Historial de Seguimiento', clasif: 'Clasificación de Cierre' };
  Object.keys(OPCIONALES).forEach(function (k) { if (map[k] === undefined) warns.push('No se encontró la columna ' + OPCIONALES[k] + '.'); });
  for (let i = 0; i < hi; i++) { const t = valores[i].filter(String).join(' '); const m = t.match(/Del\s+(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/i); if (m) { pFrom = aNaive_(m[1]); pTo = aNaive_(m[2]) + 864e5 - 1; } }
  const DATES = ['fEstudio', 'fnac', 'fReg', 'fFs', 'fCierre', 'reasigF'];
  const porLlave = {}; let filas = 0, dup = 0;
  for (let i = hi + 1; i < valores.length; i++) {
    const r = valores[i]; if (r[map.folio] === '' || r[map.folio] === null) continue; filas++;
    const o = {};
    REP_COLS.forEach(function (c) { let v = map[c[0]] !== undefined ? r[map[c[0]]] : ''; if (DATES.indexOf(c[0]) >= 0) v = aNaive_(v, tz, (c[0] === 'fFs' || c[0] === 'fCierre' || c[0] === 'reasigF') ? o.fReg : null); else if (v === '' || v === null) v = ''; else v = String(v).trim(); o[c[0]] = v; });
    o.folio = String(o.folio).replace(/\.0$/, '');
    const rk = [o.folio, o.area, o.subest, o.motivo].join('|');
    const re = o.reasigU ? { u: o.reasigU, f: o.reasigF } : null;
    if (porLlave[rk]) { dup++; if (re && !porLlave[rk].reasig.some(function (x) { return x.u === re.u && x.f === re.f; })) porLlave[rk].reasig.push(re); continue; }
    o.rk = rk; o.reasig = re ? [re] : []; delete o.reasigU; delete o.reasigF; porLlave[rk] = o;
  }
  let recs = Object.keys(porLlave).map(function (k) { return porLlave[k]; });
  if (!recs.length) throw new Error('El archivo no tiene registros.');
  recs.forEach(function (o) { o.nEntries = parseHist_(o.hist).length; o.mes = mesDe_(o.fReg); });
  const regs = recs.map(function (r) { return r.fReg; }).filter(function (x) { return x !== null; });
  if (!pFrom) { pFrom = Math.min.apply(null, regs); pTo = Math.max.apply(null, regs); warns.push('Sin rango "Del … al …" en el encabezado; se usó el rango de Fecha Registro.'); }
  if (dup) warns.push(dup + ' filas repetidas por reasignación se consolidaron.');
  const sinFecha = recs.filter(function (r) { return r.fReg === null; }).length;
  if (sinFecha) {
    warns.push(sinFecha + ' registros sin Fecha Registro se omitieron (folios: ' + recs.filter(function (r) { return r.fReg === null; }).slice(0, 10).map(function (r) { return r.folio; }).join(', ') + (sinFecha > 10 ? '…' : '') + ').');
    recs = recs.filter(function (r) { return r.fReg !== null; });
    if (!recs.length) throw new Error('Ningún registro tiene Fecha Registro.');
  }
  const calidad = {
    filas: filas, registros: recs.length, folios: Object.keys(recs.reduce(function (a, r) { a[r.folio] = 1; return a; }, {})).length,
    sinEjecutivo: recs.filter(function (r) { return !r.ejec || r.ejec === '-'; }).length,
    sinClasificacionCerrados: recs.filter(function (r) { return r.estatus === 'CIERRE' && !r.clasif; }).length,
    sinHistorial: recs.filter(function (r) { return !r.hist; }).length,
    reasignacionesConsolidadas: dup,
  };
  return { recs: recs, pFrom: pFrom, pTo: pTo, warns: warns, calidad: calidad };
}
function mesDe_(ms) { if (ms === null) return ''; const d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2); }
function quincenas_(a, b) { const out = []; let d = new Date(a); while (d.getTime() <= b) { const q = d.getUTCDate() <= 15 ? 1 : 2; const k = mesDe_(d.getTime()) + '-Q' + q; if (out.indexOf(k) < 0) out.push(k); d = new Date(d.getTime() + 864e5); } return out; }

/* ------------------------------------------------------------
 *  CONSOLIDACIÓN EN LA HOJA FOLIOS (sin duplicar, con trazabilidad)
 * ------------------------------------------------------------ */
function hashRec_(o) { return hash_([o.estatus, o.fFs, o.fCierre, o.clasif, o.ejec, o.acciones, o.impacto, o.atClin, o.expTec, o.causas, hash_(String(o.hist || '')), reasigTxt_(o.reasig), o.zona, o.sucursal].join('¦')); }
function reasigTxt_(lista) { return (lista || []).map(function (x) { return x.u + ' @ ' + (x.f ? Utilities.formatDate(new Date(x.f), 'UTC', 'dd/MM/yyyy HH:mm') : ''); }).join('; '); }
function reasigParse_(txt) { if (!txt) return []; return String(txt).split('; ').map(function (s) { const p = s.split(' @ '); return { u: p[0], f: aNaive_(p[1] || '') }; }); }
/* Datos del paciente que la herramienta no usa: no se guardan (acordado nov-2026). Las columnas se quedan vacías
   para no mover el orden de la hoja Folios. */
const NO_GUARDAR = ['fnac', 'tel', 'telInt'];
function filaDeRec_(o) {
  return FOL_COLS.map(function (c) {
    const k = c[0];
    if (NO_GUARDAR.indexOf(k) >= 0) return '';
    if (FOL_DATE.indexOf(k) >= 0) return naiveADate_(o[k]);
    if (k === 'reasig') return reasigTxt_(o.reasig);
    if (k === 'prevEjec') return (o.prevEjec || []).join(', ');
    return o[k] === null || o[k] === undefined ? '' : o[k];
  });
}
function filaAObjeto_(fila) {
  const o = {};
  FOL_COLS.forEach(function (c, i) {
    const k = c[0], v = fila[i];
    if (FOL_DATE.indexOf(k) >= 0) o[k] = v instanceof Date ? dateANaive_(v) : (v === '' ? null : aNaive_(v));
    else if (k === 'reasig') o[k] = reasigParse_(v);
    else if (k === 'prevEjec') o[k] = v ? String(v).split(', ') : [];
    else o[k] = v === '' ? '' : (k === 'folio' || k === 'mes' ? String(v) : v);
  });
  return o;
}

function procesarArchivo_(file, cfg) {
  const lectura = leerValoresArchivo_(file);
  const p = parsearReporte_(lectura.valores, lectura.tz);
  const sh = hoja_(HOJAS.FOLIOS);
  const n = Math.max(0, sh.getLastRow() - 1);
  const idx = {}, folios = {};
  if (n) {
    const rk = sh.getRange(2, 1, n, 1).getValues(), hs = sh.getRange(2, colIndex_('hash') + 1, n, 1).getValues(), fo = sh.getRange(2, colIndex_('folio') + 1, n, 1).getValues();
    for (let i = 0; i < n; i++) { idx[String(rk[i][0])] = { fila: i + 2, hash: String(hs[i][0]) }; folios[String(fo[i][0])] = true; }
  }
  const cargas = hoja_(HOJAS.CARGAS); const cargaId = Math.max(0, cargas.getLastRow() - 1) + 1;
  const ahora = new Date(), etiqueta = cargaId + ' · ' + file.getName();
  const nuevos = [], cambiados = [], meses = {}; let sinCambio = 0; const previos = {};
  p.recs.forEach(function (o) {
    o.hash = hashRec_(o); o.ultimaCarga = etiqueta;
    const ex = idx[o.rk];
    if (!ex) { o.primeraCarga = etiqueta; o.prevEjec = []; nuevos.push(o); meses[o.mes] = true; if (folios[o.folio]) previos[o.folio] = true; }
    else { previos[o.folio] = true; if (ex.hash === o.hash) sinCambio++; else { o._fila = ex.fila; cambiados.push(o); meses[o.mes] = true; } }
  });
  // Actualizaciones: se leen y escriben por bloques de filas contiguas
  const log = [];
  cambiados.sort(function (a, b) { return a._fila - b._fila; });
  const bloques = []; cambiados.forEach(function (o) { const b = bloques[bloques.length - 1]; if (b && o._fila === b[b.length - 1]._fila + 1) b.push(o); else bloques.push([o]); });
  bloques.forEach(function (b) {
    const rango = sh.getRange(b[0]._fila, 1, b.length, FOL_COLS.length);
    const viejos = rango.getValues();
    const nuevasFilas = b.map(function (o, j) {
      const v = filaAObjeto_(viejos[j]);
      v.nEntries = parseHist_(v.hist).length;
      TRACK.forEach(function (t) {
        const a = t[0] === 'reasig' ? reasigTxt_(v.reasig) : v[t[0]], z = t[0] === 'reasig' ? reasigTxt_(o.reasig) : o[t[0]];
        const fa = FOL_DATE.indexOf(t[0]) >= 0 && a ? Utilities.formatDate(new Date(a), 'UTC', 'dd/MM/yyyy HH:mm') : a;
        const fz = FOL_DATE.indexOf(t[0]) >= 0 && z ? Utilities.formatDate(new Date(z), 'UTC', 'dd/MM/yyyy HH:mm') : z;
        if (String(fa === null ? '' : fa) !== String(fz === null ? '' : fz)) log.push([ahora, cargaId, file.getName(), o.folio, o.rk, t[1], fa === null ? '' : fa, fz === null ? '' : fz]);
      });
      o.primeraCarga = v.primeraCarga;
      const rs = v.reasig.slice(); o.reasig.forEach(function (x) { if (!rs.some(function (y) { return y.u === x.u && String(y.f) === String(x.f); })) rs.push(x); }); o.reasig = rs;
      o.prevEjec = v.prevEjec.slice(); if (v.ejec && o.ejec && v.ejec !== o.ejec && o.prevEjec.indexOf(v.ejec) < 0) o.prevEjec.push(v.ejec);
      o.hash = hashRec_(o);
      return filaDeRec_(o);
    });
    rango.setValues(nuevasFilas);
  });
  if (nuevos.length) { const ini = sh.getLastRow() + 1; formatearFilas_(sh, ini, nuevos.length); sh.getRange(ini, 1, nuevos.length, FOL_COLS.length).setValues(nuevos.map(filaDeRec_)); }
  if (log.length) { const c = hoja_(HOJAS.CAMBIOS); c.getRange(c.getLastRow() + 1, 1, log.length, log[0].length).setValues(log); }
  const lm = Object.keys(meses).sort();
  cargas.appendRow([cargaId, ahora, file.getName(), file.getId(), naiveADate_(p.pFrom), naiveADate_(p.pTo), quincenas_(p.pFrom, p.pTo).join(', '), p.calidad.filas, p.recs.length, p.calidad.folios, nuevos.length, cambiados.length, sinCambio, Object.keys(previos).length, log.length, lm.join(', '), p.warns.join(' | '), JSON.stringify(p.calidad), 'OK']);
  return { archivo: file.getName(), carga: cargaId, registros: p.recs.length, nuevos: nuevos.length, actualizados: cambiados.length, sinCambio: sinCambio, cambios: log.length, meses: lm };
}
/** Formato de texto/fecha para filas nuevas (evita que Sheets convierta folios, meses o teléfonos). */
function formatearFilas_(sh, ini, k) {
  if (sh.getMaxRows() < ini + k - 1) sh.insertRowsAfter(sh.getMaxRows(), ini + k - 1 - sh.getMaxRows());
  ['rk', 'folio', 'rsv', 'tel', 'telInt', 'mes', 'hash'].forEach(function (c) { sh.getRange(ini, colIndex_(c) + 1, k, 1).setNumberFormat('@'); });
  FOL_DATE.forEach(function (c) { sh.getRange(ini, colIndex_(c) + 1, k, 1).setNumberFormat('dd/mm/yyyy hh:mm'); });
}
function registrarCargaError_(file, msg) {
  const c = hoja_(HOJAS.CARGAS); const id = Math.max(0, c.getLastRow() - 1) + 1;
  c.appendRow([id, new Date(), file.getName(), file.getId(), '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ERROR: ' + msg]);
}

/* ------------------------------------------------------------
 *  CACHÉ MENSUAL + AUDITORÍA
 * ------------------------------------------------------------ */
/**
 * Genera la caché del mes. ctx (opcional) se comparte entre meses de la misma corrida para no
 * releer la columna Mes ni el índice de auditorías. Solo se leen los tramos de filas del mes:
 * cada carga agrega filas al final, así que un mes queda repartido en varios bloques; antes se leía
 * desde la primera hasta la última fila del mes, que en la práctica era casi toda la hoja por cada mes.
 */
function reconstruirMes_(mes, cfg, ctx) {
  cfg = cfg || leerConfig_(); ctx = ctx || {};
  const sh = hoja_(HOJAS.FOLIOS); const n = Math.max(0, sh.getLastRow() - 1);
  if (!n) return { mes: mes, folios: 0 };
  if (!ctx.colMes || ctx.n !== n) { ctx.colMes = sh.getRange(2, colIndex_('mes') + 1, n, 1).getValues(); ctx.n = n; }
  const colMes = ctx.colMes;
  const tramos = [];
  for (let i = 0; i < n; i++) if (String(colMes[i][0]).slice(0, 7) === mes) { const t = tramos[tramos.length - 1]; if (t && i - t[1] <= 30) t[1] = i; else tramos.push([i, i]); }
  if (!tramos.length) return { mes: mes, folios: 0 };
  const grupos = {};
  tramos.forEach(function (t) {
    const vals = sh.getRange(t[0] + 2, 1, t[1] - t[0] + 1, FOL_COLS.length).getValues();
    for (let j = 0; j < vals.length; j++) { if (String(colMes[t[0] + j][0]).slice(0, 7) !== mes) continue; const o = filaAObjeto_(vals[j]); (grupos[o.folio] = grupos[o.folio] || []).push(o); }
  });
  const dict = [], di = {};
  const I = function (s) { s = s === null || s === undefined ? '' : String(s); if (!(s in di)) { di[s] = dict.length; dict.push(s); } return di[s]; };
  const toMin = function (ms) { return ms === null || ms === undefined ? null : Math.round(ms / 60000); };
  const audIdx = ctx.audIdx || (ctx.audIdx = leerJson_('aud_index.json') || {});
  const nuevasAud = []; const ahora = new Date();
  const audHashBase = REGLAS_VERSION + '|' + [cfg.TIEMPO_RANKING, cfg.APERTURA_DIAS, cfg.SLA_CIERRE_H, cfg.CIERRE_DIAS, cfg.INICIO_CIERRE, cfg.AUD_ADECUADA, cfg.AUD_PARCIAL].join(',');
  const IMP = { 'CENTINELA': 6, 'EVENTO ADVERSO': 5, 'ALTO IMPACTO': 4, 'NEAR MISS': 3, 'MEDIO IMPACTO': 2, 'BAJO IMPACTO': 1 };
  const out = [];
  Object.keys(grupos).forEach(function (folio) {
    const rows = grupos[folio];
    const r0 = rows[0];
    const ents = []; const vistos = {};
    rows.forEach(function (r) { parseHist_(r.hist).forEach(function (e) { const k = e.a + '|' + e.d + '|' + e.t.length + '|' + e.t.slice(0, 40); if (!vistos[k]) { vistos[k] = 1; ents.push(e); } }); });
    ents.sort(function (x, y) { return x.d - y.d; });
    const humanas = ents.filter(function (e) { return e.a !== SYS_USER; });
    const auto = ents.length > 0 && ents.every(function (e) { return e.a === SYS_USER; }) && ents.some(function (e) { return e.auto; });
    const encuesta = rows.some(function (r) { return /encuesta digital/.test(nrm_(r.medio)) || (/sistemas api web/.test(nrm_(r.captura)) && /encuesta/.test(nrm_(r.medio))); });
    const fReg = Math.min.apply(null, rows.map(function (r) { return r.fReg; }).filter(function (x) { return x !== null; }));
    const fsL = rows.map(function (r) { return r.fFs; }).filter(function (x) { return x !== null; });
    const fcL = rows.map(function (r) { return r.fCierre; }).filter(function (x) { return x !== null; });
    const fcMax = fcL.length ? Math.max.apply(null, fcL) : null;
    let closer = null;
    if (fcMax !== null) { const cierres = ents.filter(function (e) { return e.cl; }); closer = cierres.length ? cierres[cierres.length - 1].a : r0.ejec; }
    const fAp = humanas.length ? humanas[0].d : null;
    const flags = (encuesta ? 1 : 0) | (auto ? 2 : 0) | (rows.some(function (r) { return r.atClin === 'SI'; }) ? 4 : 0) | (rows.some(function (r) { return r.atClin === 'NO'; }) ? 8 : 0) | (rows.some(function (r) { return r.expTec === 'SI'; }) ? 16 : 0) | (rows.some(function (r) { return r.expTec === 'NO'; }) ? 32 : 0);
    const impacto = rows.map(function (r) { return r.impacto; }).filter(String).sort(function (x, y) { return (IMP[y] || 0) - (IMP[x] || 0); })[0] || '';
    const reas = {}; rows.forEach(function (r) { r.reasig.forEach(function (x) { reas[x.u + x.f] = 1; }); });
    const prev = {}; rows.forEach(function (r) { r.prevEjec.forEach(function (x) { if (x) prev[x] = 1; }); });
    const autores = {}; humanas.forEach(function (e) { autores[e.a] = 1; });
    let aud = null;
    const cerrado = r0.estatus === 'CIERRE' || (r0.estatus === 'TERMINO' && cfg.TERMINO_COMO === 'cerrado');
    if (!auto && cerrado) {
      const fsMin = fsL.length ? Math.min.apply(null, fsL) : null;
      const f = { fReg: fReg, fAp: fsMin !== null && fsMin >= fReg - 3600e3 ? fsMin : fAp, fCierre: fcMax };
      const res = auditarFolio_(f, rows, humanas, cfg);
      aud = [res.calidad, res.score, res.proc, I(res.causa), res.fuente, res.crit, I(res.oport)];
      const h = hash_(audHashBase + '|' + rows.map(function (r) { return r.hash; }).sort().join(','));
      if (audIdx[folio] !== h) {
        audIdx[folio] = h;
        nuevasAud.push([ahora, folio, r0.ejec, mes, REGLAS_VERSION, h, 'Automática por reglas', PROC_LBL[res.proc], CAL_LBL[res.calidad], res.score, res.causa, { C: 'Columna Causas', T: 'Inferida del texto', N: 'No determinable' }[res.fuente]]
          .concat(res.crit.split('').map(function (c) { return { C: 'Cumple', P: 'Parcial', N: 'No cumple' }[c]; }))
          .concat([res.obs, res.oport, JSON.stringify(res.evid)]));
      }
    }
    out.push([folio, I(r0.ejec || '-'), I(r0.estatus), I(r0.zona), I(r0.sucursal), I(r0.division), I(r0.medio), I(r0.asunto), flags,
      toMin(fReg), toMin(fsL.length ? Math.min.apply(null, fsL) : null), toMin(fAp), toMin(fcMax), closer === null ? -1 : I(closer),
      Object.keys(autores).map(I), rows.map(function (r) { return [I(r.area), I(r.subest), I(r.motivo), I(r.clasif)]; }), I(impacto), Object.keys(reas).length,
      humanas.map(function (e) { return [I(e.a), Math.round(e.d / 864e5)]; }), aud, humanas.length ? I(humanas[0].a) : -1, Object.keys(prev).map(I),
      (function () { const cv = causaVencimiento_(humanas); return [I(cv.causa), I(cv.evid)]; })()]);
  });
  if (nuevasAud.length) { const s = hoja_(HOJAS.AUD); s.getRange(s.getLastRow() + 1, 1, nuevasAud.length, nuevasAud[0].length).setValues(nuevasAud); escribirJson_('aud_index.json', audIdx); }
  const ver = Date.now();
  const json = { v: 1, ver: ver, mes: mes, generado: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), d: dict, f: out };
  escribirJson_('mes_' + mes + '.json', json);
  invalidarCacheMes_(mes); guardarMesEnCache_(mes, json); marcarVersionMes_(mes, ver); registrarMes_(mes);
  return { mes: mes, folios: out.length, auditoriasNuevas: nuevasAud.length };
}


/** Una sola vez: borra de la hoja Folios la fecha de nacimiento y los teléfonos ya guardados. Ejecutar desde el editor. */
function borrarTelefonoYNacimiento() {
  const sh = hoja_(HOJAS.FOLIOS); const n = sh.getLastRow() - 1; if (n < 1) return 'Sin filas';
  NO_GUARDAR.forEach(function (k) { sh.getRange(2, colIndex_(k) + 1, n, 1).clearContent(); });
  Logger.log('Borradas ' + NO_GUARDAR.length + ' columnas en ' + n + ' filas'); return n;
}
