/*
 *  Archivo: Vencimientos.gs
 *  - Causa probable de vencimiento (se lee del historial de seguimiento).
 *  - Folios reasignados (archivo de Drive indicado en Config → REASIGNADOS_ID).
 *  - Alerta diaria de folios vencidos por correo (ejecutiva, coordinador y administradores).
 *
 *  Reglas vigentes (nov-2026):
 *   · Apertura: un folio en estatus APERTURA vence a las 48 h desde el registro (SLA_1ER_H).
 *   · Seguimiento/término: sin cerrar, vence a los 7 días naturales = 168 h desde el registro (CIERRE_DIAS).
 */

/* ---------------- Causa probable de vencimiento ---------------- */
/* Se busca en los comentarios de las ejecutivas, del más reciente al más antiguo, la primera
   mención de algo que estén esperando. Es una clasificación por palabras clave: trazable, no perfecta. */
const CAUSAS_VENC = [
  ['Esperando respuesta de gerente / clínica', /gerent|gerencia|retroaliment|encargad[oa] de (la )?(sucursal|clinica)|coordinador[a]? de (la )?(sucursal|clinica)|jefe de (sucursal|clinica)|se (le )?solicit[oa] (a|al) (la )?(sucursal|clinica)|en espera de (la )?(sucursal|clinica)/],
  ['Esperando experto técnico / médico', /experto|tecnico|radiolog|interpretaci|reinterpret|valoracion medica|segunda opinion|area medica|medico (radiologo|responsable)/],
  ['Esperando reembolso o compensación', /reembolso|devoluci|bonificaci|nota de credito|facturaci|compensaci|cortesia|estudio sin costo/],
  ['Esperando resultados / sistema', /falla (de|del|en) (el )?(sistema|equipo)|pendiente de (emitir|validar)|no se ha(n)? emitido|resultados? (pendiente|no emitido)|validacion pendiente|ticket|mesa de ayuda/],
  ['Paciente no localizado', /buzon|no contesta|no responde|sin respuesta|no se (logra )?localiz|numero (equivocado|incorrecto|no existe)|fuera de servicio|no atiende|no toma la llamada|apagado/],
  ['Reasignado a otra área', /reasign|se turn(a|o)|se canaliz/],
];
function causaVencimiento_(humanas) {
  if (!humanas || !humanas.length) return { causa: 'Sin seguimiento registrado', evid: '' };
  for (let i = humanas.length - 1; i >= 0; i--) {
    const e = humanas[i]; const t = nrm_(e.t);
    for (let k = 0; k < CAUSAS_VENC.length; k++) {
      if (CAUSAS_VENC[k][1].test(t)) {
        const d = Utilities.formatDate(new Date(e.d), 'UTC', 'dd/MM/yyyy');
        return { causa: CAUSAS_VENC[k][0], evid: e.a + ' · ' + d + ' · ' + String(e.t).replace(/\s+/g, ' ').slice(0, 160) };
      }
    }
  }
  const u = humanas[humanas.length - 1];
  return { causa: 'Sin causa escrita en el historial', evid: u.a + ' · ' + Utilities.formatDate(new Date(u.d), 'UTC', 'dd/MM/yyyy') + ' · ' + String(u.t).replace(/\s+/g, ' ').slice(0, 160) };
}

/* ---------------- Folios reasignados ---------------- */
/**
 * Devuelve { folio: "detalle" } desde el archivo de reasignados. Se relee solo si el archivo cambió.
 * soloGuardado = true (al abrir el dashboard): usa lo ya guardado y no consulta Drive, para no
 * hacer esperar al usuario; el activador horario lo mantiene al día.
 */
function leerReasignados_(soloGuardado) {
  const id = leerConfig_().REASIGNADOS_ID;
  if (!id) return {};
  if (_memo.reasig) return _memo.reasig;
  if (soloGuardado) {
    try { const j = leerJson_('reasignados.json'); if (j && String(j.sello || '').indexOf(id + '|') === 0) return (_memo.reasig = j.mapa || {}); } catch (e) { }
    return {};
  }
  try {
    const f = DriveApp.getFileById(id);
    const sello = id + '|' + f.getLastUpdated().getTime();
    const j = leerJson_('reasignados.json'); if (j && j.sello === sello) return (_memo.reasig = j.mapa);
    let ss, tmpId = null;
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) ss = SpreadsheetApp.openById(id);
    else {
      const res = { name: 'tmp_rp_reasig', mimeType: MimeType.GOOGLE_SHEETS, parents: [carpetaSistema_().getId()] };
      let tmp; try { tmp = Drive.Files.copy(res, id, { supportsAllDrives: true }); } catch (e) { tmp = Drive.Files.create(res, f.getBlob(), { supportsAllDrives: true }); }
      tmpId = tmp.id; ss = SpreadsheetApp.openById(tmpId);
    }
    const mapa = {};
    try {
      ss.getSheets().forEach(function (sh) {
        if (sh.getLastRow() < 2) return;
        const v = sh.getDataRange().getDisplayValues();
        let hi = -1, fc = -1;
        for (let i = 0; i < Math.min(15, v.length) && hi < 0; i++) for (let j = 0; j < v[i].length; j++) if (/^folio/.test(nrm_(v[i][j]).trim())) { hi = i; fc = j; break; }
        if (hi < 0) return;
        const h = v[hi];
        for (let i = hi + 1; i < v.length; i++) {
          const fol = String(v[i][fc]).replace(/\D/g, ''); if (!fol) continue;
          const det = []; for (let j = 0; j < h.length && det.length < 6; j++) { if (j === fc || !h[j] || !String(v[i][j]).trim()) continue; det.push(String(h[j]).trim() + ': ' + String(v[i][j]).trim()); }
          mapa[fol] = (mapa[fol] ? mapa[fol] + ' | ' : '') + (sh.getName() + (det.length ? ' · ' + det.join(' · ') : ''));
        }
      });
    } finally { if (tmpId) DriveApp.getFileById(tmpId).setTrashed(true); }
    escribirJson_('reasignados.json', { sello: sello, mapa: mapa });
    return (_memo.reasig = mapa);
  } catch (e) { console.warn('Reasignados: ' + e.message); return {}; }
}

/* ---------------- Alerta diaria de vencidos ---------------- */
/** Activador diario. prueba = true → todo se envía solo a quien lo ejecuta. */
function alertaDiariaVencidos(prueba) {
  prueba = prueba === true;
  const cfg = leerConfig_();
  if (!prueba && String(cfg.ALERTA_DIARIA).toUpperCase() !== 'SI') return 'Alerta diaria desactivada (Config → ALERTA_DIARIA).';
  const lista = vencidosActuales_(cfg);
  const equipos = leerTabla_(HOJAS.EQUIPOS).filter(function (r) { return String(r['Activa']).toUpperCase() !== 'NO'; });
  const usuarios = leerTabla_(HOJAS.USUARIOS).filter(function (r) { return String(r['Activo']).toUpperCase() !== 'NO'; });
  const admins = usuarios.filter(function (u) { return String(u['Rol']).toUpperCase() === 'ADMIN'; }).map(function (u) { return String(u['Correo']).trim(); }).filter(String);
  const yo = Session.getActiveUser().getEmail();
  const url = (function () { try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; } })();
  const fecha = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const porEj = {}; lista.forEach(function (x) { (porEj[x.ejec] = porEj[x.ejec] || []).push(x); });
  const enviar = function (to, asunto, html) { if (!to) return; MailApp.sendEmail({ to: prueba ? yo : to, subject: (prueba ? '[PRUEBA para ' + to + '] ' : '') + asunto, htmlBody: html, name: 'Recuperación de Pacientes' }); };
  let enviados = 0;
  // 1) a cada ejecutiva, sus folios
  equipos.forEach(function (r) {
    const e = String(r['Ejecutiva']).trim(), correo = String(r['Correo ejecutiva'] || '').trim(); const fs = porEj[e];
    if (!fs || !correo) return;
    enviar(correo, 'Tienes ' + fs.length + ' folio(s) vencido(s) · ' + fecha, htmlCorreo_('Hola ' + e.split(' ')[0] + ', estos folios están vencidos y deben atenderse hoy:', fs, false, url)); enviados++;
  });
  // 2) a cada coordinador, su equipo
  const coords = {}; equipos.forEach(function (r) { const c = String(r['Coordinador (correo)'] || '').trim(); if (c) (coords[c] = coords[c] || []).push(String(r['Ejecutiva']).trim()); });
  Object.keys(coords).forEach(function (c) {
    const fs = lista.filter(function (x) { return coords[c].indexOf(x.ejec) >= 0; });
    if (!fs.length) return;
    enviar(c, 'Equipo: ' + fs.length + ' folio(s) vencido(s) · ' + fecha, htmlCorreo_('Folios vencidos de tu equipo al ' + fecha + ':', fs, true, url)); enviados++;
  });
  // 3) a los administradores, todo (aunque sea cero, para confirmar que corrió)
  const resumenAdm = lista.length ? htmlCorreo_('Folios vencidos al ' + fecha + ' (todas las ejecutivas):', lista, true, url) : '<p style="font-family:Arial">Sin folios vencidos al ' + fecha + '. ✔</p>';
  admins.forEach(function (a) { enviar(a, (lista.length ? lista.length + ' folio(s) vencido(s)' : 'Sin folios vencidos') + ' · ' + fecha, resumenAdm); enviados++; });
  return { vencidos: lista.length, ejecutivas: Object.keys(porEj).length, correos: enviados, prueba: prueba };
}
/** Ejecuta la alerta enviando todos los correos solo a ti (para revisar cómo se ven). */
function probarAlertaDiaria() { const r = alertaDiariaVencidos(true); Logger.log(JSON.stringify(r)); return r; }

/** Folios abiertos hoy en APERTURA con más de 48 h o con más de 7 días sin cerrar (sin cierres automáticos ni reasignados). */
function vencidosActuales_(cfg) {
  const ahora = dateANaive_(new Date()) / 60000;
  const limAp = Number(cfg.SLA_1ER_H) * 60, limC = Number(cfg.CIERRE_DIAS) * 1440;
  const reas = leerReasignados_();
  const meses = mesesDisponibles_().slice(-(Number(cfg.ALERTA_MESES) || 3));
  const out = [];
  meses.forEach(function (mes) {
    const c = leerCacheMes_(mes); if (!c) return;
    const d = c.d, s = function (i) { return i == null || i < 0 ? '' : d[i]; };
    c.f.forEach(function (r) {
      if (r[8] & 2) return;                                   // cierre automático
      const folio = String(r[0]); if (reas[folio]) return;    // reasignado
      const est = s(r[2]);
      if (est === 'CIERRE' || est === 'CANCELADO' || (est === 'TERMINO' && cfg.TERMINO_COMO === 'cerrado')) return;
      const fReg = r[9]; if (fReg == null) return;
      const trans = ahora - fReg;
      // Reglas por estatus: APERTURA vence a las 48 h; sin cerrar, vence el día 8 (7 días desde el registro).
      const enApertura = est === 'APERTURA';
      const cierreV = trans > limC, apV = enApertura && trans > limAp;
      if (!cierreV && !apV) return;
      const cv = r[22] ? s(r[22][0]) : '';
      out.push({ folio: folio, ejec: s(r[1]) || '-', estatus: est, sucursal: s(r[4]), zona: s(r[3]), motivo: (r[15] || []).map(function (x) { return s(x[2]); }).filter(String).join(' · '),
        registro: Utilities.formatDate(new Date(fReg * 60000), 'UTC', 'dd/MM/yyyy HH:mm'), dias: Math.floor(trans / 1440),
        tipo: cierreV ? (enApertura ? 'Seguimiento vencido y sigue en APERTURA' : 'Seguimiento vencido (día ' + (Number(cfg.CIERRE_DIAS) + 1) + '+)') : 'En APERTURA más de ' + cfg.SLA_1ER_H + ' h', causa: cierreV ? cv : '' });
    });
  });
  out.sort(function (a, b) { return a.ejec.localeCompare(b.ejec) || b.dias - a.dias; });
  return out;
}
function htmlCorreo_(intro, fs, conEjecutiva, url) {
  const th = 'style="text-align:left;padding:6px 8px;background:#F4F7FE;color:#1B2559;font-size:12px;border-bottom:1px solid #E9EDF7"';
  const td = 'style="padding:6px 8px;border-bottom:1px solid #E9EDF7;font-size:12px;color:#1B2559"';
  const esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  let resumen = '';
  if (conEjecutiva) {
    const c = {}; fs.forEach(function (x) { c[x.ejec] = (c[x.ejec] || 0) + 1; });
    resumen = '<table style="border-collapse:collapse;margin:8px 0 16px;font-family:Arial"><tr><th ' + th + '>Ejecutiva</th><th ' + th + '>Vencidos</th></tr>' +
      Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (e) { return '<tr><td ' + td + '>' + esc(e) + '</td><td ' + td + '><b style="color:#EE5D50">' + c[e] + '</b></td></tr>'; }).join('') + '</table>';
  }
  const filas = fs.slice(0, 400).map(function (x) {
    return '<tr>' + (conEjecutiva ? '<td ' + td + '>' + esc(x.ejec) + '</td>' : '') + '<td ' + td + '><b>' + esc(x.folio) + '</b></td><td ' + td + '>' + esc(x.registro) + '</td><td ' + td + '><b style="color:#EE5D50">' + x.dias + '</b></td><td ' + td + '>' + esc(x.tipo) + '</td><td ' + td + '>' + esc(x.sucursal) + '</td><td ' + td + '>' + esc(x.motivo) + '</td><td ' + td + '>' + esc(x.causa) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial;color:#1B2559"><p>' + esc(intro) + '</p>' + resumen +
    '<table style="border-collapse:collapse;font-family:Arial"><tr>' + (conEjecutiva ? '<th ' + th + '>Ejecutiva</th>' : '') + '<th ' + th + '>Folio</th><th ' + th + '>Registro</th><th ' + th + '>Días</th><th ' + th + '>Situación</th><th ' + th + '>Sucursal</th><th ' + th + '>Motivo</th><th ' + th + '>Causa probable</th></tr>' + filas + '</table>' +
    (fs.length > 400 ? '<p>… y ' + (fs.length - 400) + ' más. Consulta el dashboard.</p>' : '') +
    '<p style="font-size:12px;color:#707EAE">Reglas: APERTURA = máximo 48 h en ese estatus desde el registro · seguimiento/término = máximo 7 días naturales desde el registro (el día 8 ya está vencido). No incluye cierres automáticos ni folios reasignados.' + (url ? ' <a href="' + url + '">Abrir dashboard</a>' : '') + '</p></div>';
}

/** Reconstruye todos los meses (necesario una vez tras actualizar, para agregar la causa de vencimiento). */
function reconstruirTodosLosMeses() {
  const cfg = leerConfig_(); const t0 = Date.now(); const hechos = [], pend = [];
  mesesDisponibles_().forEach(function (m) { if (Date.now() - t0 > LIMITE_MS) { pend.push(m); return; } hechos.push(reconstruirMes_(m, cfg)); });
  PropertiesService.getScriptProperties().setProperty('MESES_PENDIENTES', JSON.stringify(pend));
  Logger.log('Reconstruidos: ' + JSON.stringify(hechos) + (pend.length ? ' · Pendientes (se terminan en la siguiente hora): ' + pend.join(', ') : ''));
  return { hechos: hechos, pendientes: pend };
}
