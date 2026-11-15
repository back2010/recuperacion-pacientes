/**
 * ============================================================
 *  INTELIGENCIA OPERATIVA · RECUPERACIÓN DE PACIENTES (v2)
 *  Archivo: Code.gs  —  web app, sesión, permisos y endpoints
 * ============================================================
 *  Origen de datos: el Excel .xlsm de Drive indicado en Config →
 *  ARCHIVO_ORIGEN_ID. Cada hora se revisa si cambió y se consolida
 *  en la hoja Folios (sin duplicar, con registro de cambios).
 *
 *  1) (Opcional) ID del Google Sheets que será la base de datos.
 *     Si lo dejas vacío y el script no está ligado a un Sheets,
 *     instalar() crea uno nuevo ("RP · Base de datos").
 */
const SPREADSHEET_ID = '';

/** Zona horaria de los reportes. Mazatlán no tiene horario de verano. */
const TZ = 'America/Mazatlan';

/* ------------------------------------------------------------
 *  WEB APP
 * ------------------------------------------------------------ */
function doGet(e) {
  let ses;
  try { ses = sesion_(); } catch (err) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:Segoe UI,Arial;padding:40px;max-width:640px">' +
      '<h2>Acceso no autorizado</h2><p>' + escHtml_(err.message) + '</p>' +
      '<p style="color:#666">Pide al administrador que registre tu correo en la hoja <b>Usuarios</b>.</p></div>'
    ).setTitle('Sin acceso');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Inteligencia Operativa · Recuperación de Pacientes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Inserta otro archivo HTML del proyecto sin procesarlo como plantilla. */
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ------------------------------------------------------------
 *  SESIÓN Y PERMISOS (se validan SIEMPRE en el servidor)
 * ------------------------------------------------------------ */
/**
 * Devuelve {correo, nombre, rol, ejecutivas|null}. ejecutivas = null significa "todas" (ADMIN).
 * Lanza error si el correo no está registrado o está inactivo.
 */
function sesion_() {
  const correo = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!correo) throw new Error('No se pudo identificar tu cuenta de Google. Entra con tu cuenta corporativa del mismo dominio donde está publicada la aplicación.');
  const usuarios = leerTabla_(HOJAS.USUARIOS);
  const u = usuarios.find(function (x) { return String(x['Correo']).toLowerCase().trim() === correo && esSi_(x['Activo']); });
  if (!u) throw new Error('Tu correo (' + correo + ') no está registrado o está inactivo en la hoja Usuarios.');
  const rol = String(u['Rol']).toUpperCase().trim();
  if (rol !== 'ADMIN' && rol !== 'COORDINADOR') throw new Error('Rol no válido para ' + correo + ': use ADMIN o COORDINADOR.');
  let ejecutivas = null;
  if (rol === 'COORDINADOR') {
    ejecutivas = leerTabla_(HOJAS.EQUIPOS)
      .filter(function (x) { return String(x['Coordinador (correo)']).toLowerCase().trim() === correo && esSi_(x['Activa']); })
      .map(function (x) { return String(x['Ejecutiva']).trim(); });
  }
  return { correo: correo, nombre: u['Nombre'] || correo, rol: rol, ejecutivas: ejecutivas };
}
function soloAdmin_(ses) { if (ses.rol !== 'ADMIN') throw new Error('Acción permitida solo para administradores.'); }
function puedeVer_(ses, ejecutiva) { return ses.ejecutivas === null || ses.ejecutivas.indexOf(String(ejecutiva).trim()) >= 0; }

/* ------------------------------------------------------------
 *  ENDPOINTS PARA EL FRONTEND (google.script.run)
 * ------------------------------------------------------------ */
function apiSesion() {
  const ses = sesion_();
  const cfg = leerConfig_();
  const equipos = leerTabla_(HOJAS.EQUIPOS).filter(function (x) { return esSi_(x['Activa']); });
  const usuarios = leerTabla_(HOJAS.USUARIOS);
  const nombreDe = {}; usuarios.forEach(function (u) { nombreDe[String(u['Correo']).toLowerCase().trim()] = u['Nombre']; });
  const coordinadores = {};
  equipos.forEach(function (x) {
    const c = String(x['Coordinador (correo)']).toLowerCase().trim();
    if (ses.rol !== 'ADMIN' && c !== ses.correo) return;
    if (!coordinadores[c]) coordinadores[c] = { correo: c, nombre: nombreDe[c] || c, ejecutivas: [] };
    coordinadores[c].ejecutivas.push(String(x['Ejecutiva']).trim());
  });
  const props = PropertiesService.getScriptProperties();
  return JSON.stringify({
    correo: ses.correo, nombre: ses.nombre, rol: ses.rol,
    ejecutivas: ses.ejecutivas,
    coordinadores: Object.keys(coordinadores).map(function (k) { return coordinadores[k]; }),
    config: cfg,
    bono: leerBonoCriterios_(),
    meses: mesesDisponibles_(),
    ultimaActualizacion: props.getProperty('ULTIMA_ACTUALIZACION') || null,
    sheetUrl: ses.rol === 'ADMIN' ? urlLibro_() : null,
    origen: infoOrigen_(false),
    versiones: versionesMeses_(),
    reasignados: leerReasignados_(),
  });
}

/** Devuelve los folios (formato compacto) de los meses pedidos, filtrados por permisos. */
function apiMeses(lista) {
  const ses = sesion_();
  const out = [];
  (lista || []).forEach(function (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    const c = leerCacheMes_(mes);
    if (!c) return;
    if (ses.ejecutivas !== null) {
      const permit = {}; ses.ejecutivas.forEach(function (e) { permit[e] = true; });
      c.f = c.f.filter(function (r) { return permit[c.d[r[1]]] === true; });
    }
    out.push(c);
  });
  return JSON.stringify(out);
}

/** Detalle completo de un folio (incluye historial, cambios y auditorías). Valida permiso. */
function apiFolio(folio) {
  const ses = sesion_();
  folio = String(folio).trim();
  if (!/^\d+$/.test(folio)) throw new Error('Folio inválido');
  const sh = hoja_(HOJAS.FOLIOS);
  const col = colIndex_('folio') + 1;
  const found = sh.getRange(2, col, Math.max(1, sh.getLastRow() - 1), 1).createTextFinder(folio).matchEntireCell(true).findAll();
  if (!found.length) return JSON.stringify(null);
  const rows = found.map(function (c) { return filaAObjeto_(sh.getRange(c.getRow(), 1, 1, FOL_COLS.length).getValues()[0]); });
  if (!rows.every(function (r) { return puedeVer_(ses, r.ejec); })) throw new Error('No tienes permiso para consultar este folio.');
  const cambios = buscarFilas_(HOJAS.CAMBIOS, 'Folio', folio);
  const auds = buscarFilas_(HOJAS.AUD, 'Folio', folio);
  rows.forEach(function (r) { delete r.hash; });
  return JSON.stringify({ rows: rows, cambios: cambios, auditorias: auds });
}

/* ---------- Bonos ---------- */
function apiBonos(mes) {
  const ses = sesion_();
  const cap = leerTabla_(HOJAS.BONO_CAP).filter(function (x) { return String(x['Mes']).slice(0, 7) === mes && puedeVer_(ses, x['Ejecutiva']); });
  return JSON.stringify({ criterios: leerBonoCriterios_(), captura: cap });
}
function apiGuardarBonoCaptura(mes, lista) {
  const ses = sesion_();
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido');
  const sh = hoja_(HOJAS.BONO_CAP);
  const datos = sh.getDataRange().getValues();
  const idx = {}; for (let i = 1; i < datos.length; i++) idx[(datos[i][0] instanceof Date ? Utilities.formatDate(datos[i][0], TZ, 'yyyy-MM') : String(datos[i][0]).slice(0, 7)) + '|' + datos[i][1]] = i + 1;
  const ahora = new Date();
  (lista || []).forEach(function (x) {
    const e = String(x.ejecutiva).trim();
    if (!puedeVer_(ses, e)) throw new Error('Sin permiso para capturar a ' + e);
    const num = function (v) { if (v === '' || v === null || v === undefined) return ''; const n = Number(v); if (isNaN(n) || n < 0 || n > 100) throw new Error('Valor fuera de rango para ' + e); return n; };
    const fila = [mes, e, num(x.mon), num(x.aud), x.sat ? 'SI' : 'NO', ses.correo, ahora];
    const r = idx[mes + '|' + e];
    if (r) sh.getRange(r, 1, 1, fila.length).setValues([fila]); else { sh.appendRow(fila); idx[mes + '|' + e] = sh.getLastRow(); }
  });
  return true;
}
function apiGuardarBonoCriterios(obj) {
  const ses = sesion_(); soloAdmin_(ses);
  const sh = hoja_(HOJAS.BONO_CRIT);
  const rows = (obj.ind || []).map(function (i) { return [i.id, i.nombre, i.op, i.fuente, i.vigente.meta === null ? '' : i.vigente.meta, i.vigente.pts, i.propuesta.meta === null ? '' : i.propuesta.meta, i.propuesta.pts, i.criterio]; });
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 9).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 9).setValues(rows);
  limpiarCacheTablas_();
  guardarConfigValores_({ BONO_ESQUEMA: obj.esquema, BONO_A: obj.niveles.A, BONO_B: obj.niveles.B, BONO_CIERRE_DIAS: obj.cierreDias, BONO_CIERRE_DESDE: obj.cierreDesde });
  return true;
}

/* ---------- Planes de acción ---------- */
function apiPlanes() {
  const ses = sesion_();
  return JSON.stringify(leerTabla_(HOJAS.PLANES).filter(function (p) { return puedeVer_(ses, p['Ejecutiva']); }));
}
function apiGuardarPlan(p) {
  const ses = sesion_();
  if (!p.ejecutiva || !p.fecha) throw new Error('Ejecutiva y fecha son obligatorias');
  if (!puedeVer_(ses, p.ejecutiva)) throw new Error('Sin permiso sobre ' + p.ejecutiva);
  const sh = hoja_(HOJAS.PLANES);
  const datos = sh.getDataRange().getValues();
  let id = p.id ? Number(p.id) : 0, fila = 0;
  if (id) { for (let i = 1; i < datos.length; i++) if (Number(datos[i][0]) === id) { fila = i + 1; if (!puedeVer_(ses, datos[i][1])) throw new Error('Sin permiso'); } }
  else { id = datos.slice(1).reduce(function (m, r) { return Math.max(m, Number(r[0]) || 0); }, 0) + 1; }
  const v = [id, p.ejecutiva, p.area || '', p.fecha, p.fechaSeg || '', p.responsable || '', p.estatus || 'Abierto', p.compromiso || '', p.accion || '', p.resultado || '', fila ? datos[fila - 1][10] : ses.correo, new Date()];
  if (fila) sh.getRange(fila, 1, 1, v.length).setValues([v]); else sh.appendRow(v);
  return id;
}
function apiEliminarPlan(id) {
  const ses = sesion_();
  const sh = hoja_(HOJAS.PLANES); const datos = sh.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) if (Number(datos[i][0]) === Number(id)) {
    if (!puedeVer_(ses, datos[i][1])) throw new Error('Sin permiso');
    sh.deleteRow(i + 1); return true;
  }
  return false;
}

/* ---------- Administración ---------- */
function apiAdmin() {
  const ses = sesion_(); soloAdmin_(ses);
  const meses = mesesDisponibles_();
  const enDatos = {};
  meses.slice(-3).forEach(function (m) { const c = leerCacheMes_(m); if (c) c.f.forEach(function (r) { enDatos[c.d[r[1]]] = (enDatos[c.d[r[1]]] || 0) + 1; }); });
  const equipos = leerTabla_(HOJAS.EQUIPOS);
  const asignadas = {}; equipos.forEach(function (x) { if (esSi_(x['Activa'])) asignadas[String(x['Ejecutiva']).trim()] = true; });
  const sinEquipo = Object.keys(enDatos).filter(function (e) { return e && e !== '-' && !asignadas[e]; }).map(function (e) { return { ejecutiva: e, folios: enDatos[e] }; });
  const cargas = leerTabla_(HOJAS.CARGAS).slice(-50).reverse();
  return JSON.stringify({ usuarios: leerTabla_(HOJAS.USUARIOS), equipos: equipos, sinEquipo: sinEquipo, cargas: cargas, sheetUrl: libro_().getUrl(), origen: infoOrigen_(true), meses: meses, cambiosRecientes: leerUltimas_(HOJAS.CAMBIOS, 300) });
}
function apiGuardarConfig(obj) {
  const ses = sesion_(); soloAdmin_(ses);
  const permitidas = Object.keys(CONFIG_DEF);
  const limpio = {};
  Object.keys(obj || {}).forEach(function (k) { if (permitidas.indexOf(k) >= 0) limpio[k] = obj[k]; });
  guardarConfigValores_(limpio);
  return true;
}
function apiProcesarAhora() {
  const ses = sesion_(); soloAdmin_(ses);
  return JSON.stringify(procesarOrigen(true));
}
function apiReconstruirMes(mes) {
  const ses = sesion_(); soloAdmin_(ses);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido');
  return JSON.stringify(reconstruirMes_(mes));
}

function escHtml_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

