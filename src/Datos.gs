/**
 * ============================================================
 *  Archivo: Datos.gs — estructura del Google Sheets, configuración,
 *  instalación, menú, activadores y utilidades de lectura/escritura.
 * ============================================================
 */
const HOJAS = {
  FOLIOS: 'Folios', CAMBIOS: 'Cambios', CARGAS: 'Cargas', USUARIOS: 'Usuarios', EQUIPOS: 'Equipos',
  CONFIG: 'Config', AUD: 'Auditoria', BONO_CRIT: 'Bonos_Criterios', BONO_CAP: 'Bonos_Captura', PLANES: 'Planes',
};

/** Columnas de la hoja Folios: [clave interna, encabezado]. Las 34 primeras (desde Folio) son las del reporte. */
const FOL_COLS = [
  ['rk', 'RK (llave folio|área|subestudio|motivo)'], ['folio', 'Folio'], ['asunto', 'Asunto'], ['division', 'División'], ['zona', 'Zona'], ['sucursal', 'Sucursal'],
  ['medio', 'Medio Contacto'], ['captura', 'Usuario Captura'], ['fEstudio', 'Fecha del Estudio'], ['rsv', 'RSV/OPC'], ['destino', 'Destino'], ['area', 'Área'],
  ['subest', 'SubEstudio'], ['motivo', 'Motivo'], ['colab', 'Colaborador Responsable'], ['paciente', 'Nombre Paciente'], ['fnac', 'Fecha de Nacimiento'],
  ['tel', 'Teléfono Contacto'], ['telInt', 'Teléfono Internacional'], ['coment', 'Comentarios'], ['estatus', 'Estatus'], ['fReg', 'Fecha Registro'],
  ['fFs', 'Fecha de primer seguimiento'], ['fCierre', 'Fecha Cierre'], ['acciones', 'Acciones Correctivas (Compensaciones)'], ['hist', 'Historial de Seguimiento'],
  ['impacto', 'Tipo de Impacto'], ['clasif', 'Clasificacion de Cierre'], ['atClin', 'Atención de Clínica'], ['expTec', 'Seguimiento por experto técnico'],
  ['dias', 'Días Transcurridos'], ['causas', 'Causas'], ['ejec', 'Ejecutivo Reactivo o Ejecutivo Atención Clínica'],
  ['reasig', 'Reasignaciones (usuario @ fecha)'], ['prevEjec', 'Ejecutivos anteriores'], ['mes', 'Mes registro'], ['primeraCarga', 'Primera carga'],
  ['ultimaCarga', 'Última carga'], ['hash', 'Hash de control'],
];
const FOL_DATE = ['fEstudio', 'fnac', 'fReg', 'fFs', 'fCierre'];
/** Campos cuyo cambio entre cargas se registra en la hoja Cambios. */
const TRACK = [['estatus', 'Estatus'], ['fFs', 'Fecha primer seguimiento'], ['fCierre', 'Fecha cierre'], ['clasif', 'Clasificación de cierre'], ['ejec', 'Ejecutivo'], ['acciones', 'Acciones correctivas'], ['impacto', 'Tipo de impacto'], ['atClin', 'Atención de clínica'], ['expTec', 'Experto técnico'], ['causas', 'Causas'], ['nEntries', 'Gestiones en historial'], ['reasig', 'Reasignaciones']];

const ESTRUCTURA = {
  Folios: FOL_COLS.map(function (c) { return c[1]; }),
  Cambios: ['Fecha', 'Carga', 'Archivo', 'Folio', 'RK', 'Campo', 'Antes', 'Después'],
  Cargas: ['ID', 'Fecha', 'Archivo', 'ID archivo Drive', 'Periodo desde', 'Periodo hasta', 'Quincenas', 'Filas', 'Registros', 'Folios', 'Nuevos', 'Actualizados', 'Sin cambio', 'Folios ya existentes', 'Cambios', 'Meses afectados', 'Advertencias', 'Auditoría de calidad (JSON)', 'Resultado'],
  Usuarios: ['Correo', 'Nombre', 'Rol', 'Activo'],
  Equipos: ['Ejecutiva', 'Correo ejecutiva', 'Coordinador (correo)', 'Activa'],
  Config: ['Parámetro', 'Valor', 'Descripción'],
  Auditoria: ['Fecha evaluación', 'Folio', 'Ejecutiva', 'Mes', 'Versión reglas', 'Hash entrada', 'Tipo de evaluación', 'Procedencia', 'Calidad', 'Puntaje', 'Causa raíz', 'Fuente causa',
    'C1 Claridad', 'C2 Motivo', 'C3 Investigación', 'C4 Seguimiento', 'C5 Evidencia', 'C6 Causa raíz', 'C7 Justificación', 'C8 Tiempos', 'C9 Cierre', 'Observaciones', 'Área de oportunidad', 'Evidencia (detalle)'],
  Bonos_Criterios: ['ID', 'Indicador', 'Operador', 'Fuente', 'Meta vigente', 'Puntos vigente', 'Meta propuesta', 'Puntos propuesta', 'Criterio'],
  Bonos_Captura: ['Mes', 'Ejecutiva', 'Monitoreo %', 'Auditoría %', 'Satisfacción (SI/NO)', 'Capturó', 'Fecha'],
  Planes: ['ID', 'Ejecutiva', 'Área de oportunidad', 'Fecha compromiso', 'Fecha seguimiento', 'Responsable', 'Estatus', 'Compromiso', 'Acción correctiva', 'Resultado', 'Creó', 'Actualizado'],
};

/** Parámetros configurables (hoja Config). Valor por defecto y descripción. */
const CONFIG_DEF = {
  REASIGNADOS_ID: ['', 'ID del archivo (Google Sheets o Excel en Drive) donde el equipo anota los folios reasignados. Debe tener una columna "Folio". Esos folios se excluyen de la evaluación y se cuentan aparte.'],
  ALERTA_DIARIA: ['SI', 'SI = cada mañana se envía por correo la lista de folios vencidos a cada ejecutiva, a su coordinador y a los administradores.'],
  ALERTA_HORA: [7, 'Hora aproximada (0-23) del correo diario de vencidos.'],
  ALERTA_MESES: [3, 'Meses hacia atrás que revisa la alerta diaria.'],
  SEM_VERDE_PCT: [5, 'Semáforo del ranking de vencidos: verde si el % de vencidos es menor o igual a este valor y no tiene abiertos vencidos.'],
  SEM_AMARILLO_PCT: [15, 'Semáforo del ranking de vencidos: amarillo hasta este %; arriba es rojo.'],
  ARCHIVO_ORIGEN_ID: ['1jRsgo300I5zKlFOcPeoWzOBdOrgYHFOU', 'ID del Excel (.xlsm/.xlsx) o Google Sheets de origen en Drive. Se revisa cada hora y se consolida si cambió.'],
  APERTURA_DIAS: [2, 'Días máximos del registro al primer comentario (día del registro = día 0). Comentado a más tardar el día 2 = en tiempo; el día 3 o después = vencida. Se cuenta por día, no por hora.'],
  SLA_CIERRE_H: [48, 'Meta operativa: horas máximas del registro al cierre.'],
  CIERRE_DIAS: [7, 'Días máximos del registro al cierre (día del registro = día 0). Cerrado a más tardar el día 7 = en tiempo; el día 8 o después = vencido.'],
  TIEMPO_RANKING: ['48H', 'Meta de tiempo que usa el ranking y la auditoría: 48H o 7D.'],
  INICIO_CIERRE: ['registro', 'Desde dónde se mide el cierre: registro o apertura (primer comentario).'],
  HORARIO: ['naturales', 'naturales o habiles.'],
  DIAS_HABILES: ['1,2,3,4,5,6', 'Días hábiles (0=domingo … 6=sábado) si HORARIO=habiles.'],
  HORA_INI: [8, 'Inicio de jornada (horas hábiles).'],
  HORA_FIN: [20, 'Fin de jornada (horas hábiles).'],
  PESO_PROD: [30, 'Peso de productividad en el desempeño general (%).'],
  PESO_RES: [35, 'Peso de resolución (% de cierre) (%).'],
  PESO_OPO: [35, 'Peso de oportunidad (cumplimiento de tiempos) (%).'],
  PROD_VOL: [70, 'Productividad: % que pesa el volumen de cierres EN TIEMPO; el resto es cobertura de gestión.'],
  MIN_FOLIOS: [20, 'Folios elegibles mínimos para calificar a una ejecutiva.'],
  TERMINO_COMO: ['abierto', 'Cómo se trata el estatus TERMINO: abierto o cerrado.'],
  MADUREZ_DIAS: [7, 'Días tras el fin del periodo para comparar % y tiempo de cierre.'],
  CORTE: ['hoy', 'Tiempo de abiertos medido hasta: hoy o archivo (último movimiento).'],
  MESES_INICIALES: [2, 'Meses que carga el dashboard al abrir: mes actual + anterior para el comparativo (los demás se cargan solo al elegirlos).'],
  AL_SLA_PREV_PP: [10, 'Alerta preventiva: pp debajo de la mediana del equipo.'],
  AL_SLA_CRIT_PP: [20, 'Alerta crítica: pp debajo de la mediana del equipo.'],
  AL_VENC_PREV: [5, 'Alerta preventiva: folios abiertos vencidos.'],
  AL_VENC_CRIT: [10, 'Alerta crítica: folios abiertos vencidos.'],
  AL_SINSEG_PREV: [2, 'Alerta preventiva: folios sin comentario vencidos.'],
  AL_SINSEG_CRIT: [5, 'Alerta crítica: folios sin comentario vencidos.'],
  AL_TC_PREV: [25, 'Alerta preventiva: aumento % del tiempo de cierre.'],
  AL_TC_CRIT: [50, 'Alerta crítica: aumento % del tiempo de cierre.'],
  AL_PC_PREV: [5, 'Alerta preventiva: caída en pp del % de cierre.'],
  AL_PC_CRIT: [10, 'Alerta crítica: caída en pp del % de cierre.'],
  AL_SC_SEG: [5, 'Alerta de seguimiento: caída del puntaje.'],
  AL_SC_PREV: [10, 'Alerta preventiva: caída del puntaje.'],
  AUD_ADECUADA: [0.80, 'Puntaje mínimo (0–1) para "Gestión adecuada".'],
  AUD_PARCIAL: [0.55, 'Puntaje mínimo (0–1) para "Gestión parcialmente adecuada".'],
  AUD_PATRON_PCT: [30, 'Alerta de patrón: % de folios auditados de la ejecutiva que fallan un mismo criterio.'],
  AUD_PATRON_MIN: [10, 'Folios auditados mínimos para evaluar patrones.'],
  BONO_ESQUEMA: ['vigente', 'vigente o propuesta.'],
  BONO_A: [90, 'Bono A desde (% de puntos).'],
  BONO_B: [81, 'Bono B desde (% de puntos).'],
  BONO_CIERRE_DIAS: [7, 'Días para el indicador de cierre del bono.'],
  BONO_CIERRE_DESDE: ['registro', 'registro o comentario.'],
};

const BONO_INICIAL = [
  ['mon', '% de cumplimiento con monitoreo', '>=', 'manual', 95, 21, 97, 20, 'Llamadas con apego al script, tono y manejo (muestra de 50 pacientes por ejecutiva, un folio por servicio).'],
  ['aud', '% de apego con auditoría', '>=', 'manual', 95, 21, 96, 20, 'Registros correctos en el VOB: clasificación de servicios y motivos, sucursal y seguimientos (muestra de 50).'],
  ['ape', '% de quejas en apertura', '>=', 'auto', 80, 20, 86, 25, 'Quejas con llamada inicial en ≤2 días: días entre el día de la Fecha Registro y el día del primer comentario del historial.'],
  ['sd', '% de quejas sin definir', '<=', 'auto', 10, 18, 5, 10, 'Quejas cerradas con clasificación SIN DEFINIR o vacía ÷ quejas cerradas.'],
  ['cie', '% de quejas en cierre', '>=', 'auto', 95, 15, 97, 25, 'Cerradas en ≤N días ÷ (cerradas + abiertas con más de N días).'],
  ['sat', 'Satisfacción con la resolución de la queja', 'check', 'check', '', 5, '', 0, 'Se palomea en la captura si la ejecutiva cumple o no.'],
];

/* ------------------------------------------------------------
 *  INSTALACIÓN (ejecutar UNA vez desde el editor: instalar)
 * ------------------------------------------------------------ */
function instalar() {
  const ss = libro_();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(ESTRUCTURA).forEach(function (nombre) {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    const enc = ESTRUCTURA[nombre];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#0d2a35').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });
  // Config por defecto
  const cfgSh = ss.getSheetByName(HOJAS.CONFIG);
  const existentes = {}; cfgSh.getDataRange().getValues().slice(1).forEach(function (r) { existentes[r[0]] = true; });
  Object.keys(CONFIG_DEF).forEach(function (k) { if (!existentes[k]) cfgSh.appendRow([k, CONFIG_DEF[k][0], CONFIG_DEF[k][1]]); });
  // Bonos por defecto
  const bc = ss.getSheetByName(HOJAS.BONO_CRIT);
  if (bc.getLastRow() < 2) bc.getRange(2, 1, BONO_INICIAL.length, 9).setValues(BONO_INICIAL);
  // Administrador inicial = quien instala
  const us = ss.getSheetByName(HOJAS.USUARIOS);
  const yo = Session.getActiveUser().getEmail();
  if (us.getLastRow() < 2 && yo) us.appendRow([yo, 'Administrador', 'ADMIN', 'SI']);
  // Validaciones de datos para facilitar la edición
  us.getRange('C2:C500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ADMIN', 'COORDINADOR'], true).build());
  us.getRange('D2:D500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO'], true).build());
  ss.getSheetByName(HOJAS.EQUIPOS).getRange('D2:D500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO'], true).build());
  // Formatos de fecha en Folios
  const fol = ss.getSheetByName(HOJAS.FOLIOS);
  FOL_DATE.forEach(function (k) { fol.getRange(2, colIndex_(k) + 1, fol.getMaxRows() - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm'); });
  fol.getRange(2, colIndex_('mes') + 1, fol.getMaxRows() - 1, 1).setNumberFormat('@');
  fol.getRange(2, colIndex_('folio') + 1, fol.getMaxRows() - 1, 1).setNumberFormat('@');
  const cap = ss.getSheetByName(HOJAS.BONO_CAP); cap.getRange(2, 1, cap.getMaxRows() - 1, 1).setNumberFormat('@');
  const aud = ss.getSheetByName(HOJAS.AUD); aud.getRange(2, 2, aud.getMaxRows() - 1, 1).setNumberFormat('@'); aud.getRange(2, 4, aud.getMaxRows() - 1, 1).setNumberFormat('@');
  const cam = ss.getSheetByName(HOJAS.CAMBIOS); cam.getRange(2, 4, cam.getMaxRows() - 1, 1).setNumberFormat('@');
  // Carpetas de trabajo en Drive (caché e índices)
  carpetaSistema_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  crearActivador();
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  let msg = 'Instalación completa. Base: ' + ss.getUrl() + '. Registra usuarios y equipos.';
  try { const r = procesarOrigen(true); msg += ' Primera sincronización: ' + JSON.stringify(r.archivos || r.estado || r.aviso); } catch (e) { msg += ' No se pudo leer el Excel: ' + e.message; }
  return msg;
}

/** Activador cada hora: revisa si el Excel de origen cambió. */
function crearActivador() {
  ScriptApp.getProjectTriggers().forEach(function (t) { const h = t.getHandlerFunction(); if (h === 'procesarCarpeta' || h === 'procesarOrigen' || h === 'alEditarBase') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('procesarOrigen').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('alEditarBase').forSpreadsheet(libro_()).onEdit().create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'alertaDiariaVencidos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('alertaDiariaVencidos').timeBased().everyDays(1).atHour(Number(leerConfig_().ALERTA_HORA) || 7).inTimezone(TZ).create();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Recuperación')
    .addItem('Sincronizar Excel ahora', 'menuSincronizar_')
    .addItem('Reconstruir caché del mes…', 'menuReconstruirMes_')
    .addSeparator()
    .addItem('Instalar / reparar estructura', 'instalar')
    .addToUi();
}
function menuSincronizar_() { SpreadsheetApp.getUi().alert(JSON.stringify(procesarOrigen(true))); }
function menuReconstruirMes_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Mes a reconstruir (AAAA-MM)');
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const res = reconstruirMes_(r.getResponseText().trim());
  ui.alert(JSON.stringify(res));
}

/* ------------------------------------------------------------
 *  ACCESO A HOJAS
 * ------------------------------------------------------------ */
let _libro = null;
function libro_() {
  if (_libro) return _libro;
  const id = SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  _libro = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_libro) {
    // Proyecto independiente: se crea la base de datos una sola vez
    _libro = SpreadsheetApp.create('RP · Base de datos (Recuperación de Pacientes)');
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', _libro.getId());
  }
  return _libro;
}
/** URL del Sheets base sin abrirlo (abrirlo cuesta tiempo). */
function urlLibro_() { const id = SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'); return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : libro_().getUrl(); }
function hoja_(nombre) { const sh = libro_().getSheetByName(nombre); if (!sh) throw new Error('Falta la hoja "' + nombre + '". Ejecuta instalar().'); return sh; }
function colIndex_(clave) { for (let i = 0; i < FOL_COLS.length; i++) if (FOL_COLS[i][0] === clave) return i; throw new Error('Columna ' + clave); }
/* Tablas chicas que se leen en cada apertura: se guardan en CacheService 10 min
   y se limpian al guardar desde la app o al editarlas en el Sheets (activador alEditarBase). */
const TABLAS_CACHE = ['Usuarios', 'Equipos', 'Config', 'Bonos_Criterios'];
const CACHE_TABLA_SEG = 600;
let _memo = {};
function leerTabla_(nombre) {
  if (_memo['t:' + nombre]) return _memo['t:' + nombre];
  const usaCache = TABLAS_CACHE.indexOf(nombre) >= 0; let out = null;
  if (usaCache) { try { const c = CacheService.getScriptCache().get('tabla_' + nombre); if (c) out = JSON.parse(c); } catch (e) { } }
  if (!out) {
    const v = hoja_(nombre).getDataRange().getValues();
    if (v.length < 2) out = [];
    else { const h = v[0]; out = v.slice(1).filter(function (r) { return r.some(function (x) { return x !== ''; }); }).map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, 'yyyy-MM-dd') : r[i]; }); return o; }); }
    if (usaCache) { try { CacheService.getScriptCache().put('tabla_' + nombre, JSON.stringify(out), CACHE_TABLA_SEG); } catch (e) { } }
  }
  _memo['t:' + nombre] = out;
  return out;
}
function limpiarCacheTablas_() { _memo = {}; try { CacheService.getScriptCache().removeAll(TABLAS_CACHE.map(function (n) { return 'tabla_' + n; })); } catch (e) { } }
/** Activador instalable onEdit del Sheets base: si editan Usuarios, Equipos, Config o criterios, se refresca la caché. */
function alEditarBase(e) {
  try { const n = e && e.range ? e.range.getSheet().getName() : ''; if (!n || TABLAS_CACHE.indexOf(n) >= 0) limpiarCacheTablas_(); } catch (err) { limpiarCacheTablas_(); }
}
function leerUltimas_(nombre, n) {
  const sh = hoja_(nombre); const last = sh.getLastRow(); if (last < 2) return [];
  const desde = Math.max(2, last - n + 1); const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(desde, 1, last - desde + 1, h.length).getValues().reverse().map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, 'yyyy-MM-dd HH:mm') : r[i]; }); return o; });
}
function buscarFilas_(nombre, encabezado, valor) {
  const sh = hoja_(nombre); if (sh.getLastRow() < 2) return [];
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; const c = h.indexOf(encabezado) + 1;
  const found = sh.getRange(2, c, sh.getLastRow() - 1, 1).createTextFinder(String(valor)).matchEntireCell(true).findAll();
  return found.map(function (cell) { const r = sh.getRange(cell.getRow(), 1, 1, h.length).getValues()[0]; const o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, 'yyyy-MM-dd HH:mm') : r[i]; }); return o; });
}
function esSi_(v) { return String(v).toUpperCase().trim() === 'SI' || v === true; }

/* ------------------------------------------------------------
 *  CONFIGURACIÓN
 * ------------------------------------------------------------ */
function leerConfig_() {
  if (_memo.cfg) return _memo.cfg;
  const out = {}; Object.keys(CONFIG_DEF).forEach(function (k) { out[k] = CONFIG_DEF[k][0]; });
  leerTabla_(HOJAS.CONFIG).forEach(function (r) {
    const k = r['Parámetro'], v = r['Valor'];
    if (!(k in CONFIG_DEF)) return;
    const def = CONFIG_DEF[k][0];
    out[k] = typeof def === 'number' ? (v === '' ? def : Number(v)) : String(v).trim();
  });
  // Reglas acordadas (nov-2026): cierre a 7 días naturales contados desde la Fecha Registro
  out.TIEMPO_RANKING = '7D'; out.INICIO_CIERRE = 'registro'; out.HORARIO = 'naturales';
  _memo.cfg = out;
  return out;
}
function guardarConfigValores_(obj) {
  const sh = hoja_(HOJAS.CONFIG); const v = sh.getDataRange().getValues();
  Object.keys(obj).forEach(function (k) {
    let fila = 0; for (let i = 1; i < v.length; i++) if (v[i][0] === k) fila = i + 1;
    if (fila) sh.getRange(fila, 2).setValue(obj[k]); else sh.appendRow([k, obj[k], (CONFIG_DEF[k] || ['', ''])[1]]);
  });
  limpiarCacheTablas_();
}
function leerBonoCriterios_() {
  const cfg = leerConfig_();
  const ind = leerTabla_(HOJAS.BONO_CRIT).map(function (r) {
    const num = function (x) { return x === '' ? null : Number(x); };
    return { id: r['ID'], nombre: r['Indicador'], op: r['Operador'], fuente: r['Fuente'], criterio: r['Criterio'], vigente: { meta: num(r['Meta vigente']), pts: Number(r['Puntos vigente']) || 0 }, propuesta: { meta: num(r['Meta propuesta']), pts: Number(r['Puntos propuesta']) || 0 } };
  });
  return { ind: ind, esquema: cfg.BONO_ESQUEMA, niveles: { A: cfg.BONO_A, B: cfg.BONO_B }, cierreDias: cfg.BONO_CIERRE_DIAS, cierreDesde: cfg.BONO_CIERRE_DESDE };
}

/* ------------------------------------------------------------
 *  CACHÉ MENSUAL EN DRIVE (JSON compacto por mes)
 * ------------------------------------------------------------ */
function carpetaSistema_() {
  if (_memo.carpeta) return _memo.carpeta;
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('CARPETA_SISTEMA_ID');
  if (id) { try { return (_memo.carpeta = DriveApp.getFolderById(id)); } catch (e) { } }
  const f = DriveApp.createFolder('RP_Sistema (no borrar)');
  props.setProperty('CARPETA_SISTEMA_ID', f.getId());
  return (_memo.carpeta = f);
}
function escribirJson_(nombre, obj) {
  const carpeta = carpetaSistema_(); const txt = JSON.stringify(obj);
  const it = carpeta.getFilesByName(nombre);
  if (it.hasNext()) it.next().setContent(txt); else carpeta.createFile(nombre, txt, MimeType.PLAIN_TEXT);
}
function leerJson_(nombre) {
  const it = carpetaSistema_().getFilesByName(nombre);
  if (!it.hasNext()) return null;
  return JSON.parse(it.next().getBlob().getDataAsString());
}
/* Caché de servidor por mes (CacheService, 6 h). Trozos de 30 000 caracteres: con acentos y
   símbolos un carácter ocupa hasta 3 bytes y el límite es 100 KB por llave (con 50 000 a veces se
   rebasaba, la caché fallaba en silencio y cada apertura leía el archivo de Drive). */
const TROZO = 30000, MAX_TROZOS = 240;
function guardarMesEnCache_(mes, obj) {
  try {
    const txt = JSON.stringify(obj); const n = Math.ceil(txt.length / TROZO); if (n > MAX_TROZOS) return false;
    const m = {}; for (let i = 0; i < n; i++) m['mes_' + mes + '_' + i] = txt.slice(i * TROZO, (i + 1) * TROZO);
    m['mes_' + mes + '_n'] = String(n); m['mes_' + mes + '_t'] = String(Date.now());
    CacheService.getScriptCache().putAll(m, 21600); return true;
  } catch (e) { return false; }
}
function leerCacheMes_(mes) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get('mes_' + mes + '_n');
  if (meta) { const keys = Array.from({ length: Number(meta) }, function (_, i) { return 'mes_' + mes + '_' + i; }); const parts = cache.getAll(keys); const s = keys.map(function (k) { return parts[k]; }); if (s.every(function (x) { return x; })) return JSON.parse(s.join('')); }
  const obj = leerJson_('mes_' + mes + '.json');
  if (obj) guardarMesEnCache_(mes, obj);
  return obj;
}
function invalidarCacheMes_(mes) { CacheService.getScriptCache().removeAll(['mes_' + mes + '_n', 'mes_' + mes + '_t']); }
/** Lo llama el activador horario: mantiene precargados los meses recientes antes de que caduquen. */
function calentarCache_(cuantos) {
  const cache = CacheService.getScriptCache(); const out = [];
  mesesDisponibles_().slice(-(cuantos || 4)).forEach(function (mes) {
    const t = Number(cache.get('mes_' + mes + '_t') || 0);
    if (Date.now() - t < 4 * 3600e3 && cache.get('mes_' + mes + '_n')) return;
    const obj = leerJson_('mes_' + mes + '.json'); if (obj && guardarMesEnCache_(mes, obj)) out.push(mes);
  });
  return out;
}
/** Versión de cada mes (marca de tiempo de su última reconstrucción); el navegador la usa para su caché. */
function versionesMeses_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('MES_VER') || '{}'); }
function marcarVersionMes_(mes, ver) { const v = versionesMeses_(); v[mes] = ver; PropertiesService.getScriptProperties().setProperty('MES_VER', JSON.stringify(v)); }
function mesesDisponibles_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('MESES') || '[]'); }
function registrarMes_(mes) { const m = mesesDisponibles_(); if (m.indexOf(mes) < 0) { m.push(mes); m.sort(); PropertiesService.getScriptProperties().setProperty('MESES', JSON.stringify(m)); } }

/* ------------------------------------------------------------
 *  FECHAS: hora "local ingenua" (ms donde los campos UTC = reloj de pared)
 * ------------------------------------------------------------ */
let _off = null;
function offsetMs_() { if (_off === null) { const z = Utilities.formatDate(new Date(), TZ, 'Z'); const s = z[0] === '-' ? -1 : 1; _off = s * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2))) * 60000; } return _off; }
function dateANaive_(d) { return d instanceof Date ? d.getTime() + offsetMs_() : null; }
function naiveADate_(ms) { return ms === null || ms === undefined || ms === '' ? '' : new Date(ms - offsetMs_()); }
function hash_(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); }

