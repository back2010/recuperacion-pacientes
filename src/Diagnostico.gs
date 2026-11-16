/**
 * ============================================================
 *  Archivo: Diagnostico.gs — revisión rápida de la base y de la
 *  última carga. Ejecutar desde el editor: diagnostico
 *  No muestra datos de pacientes: solo conteos y porcentajes.
 * ============================================================
 */
function diagnostico() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const cfg = leerConfig_();
  const out = {
    origen: infoOrigen_(true),
    ultimaActualizacion: props.getProperty('ULTIMA_ACTUALIZACION'),
    mesesDisponibles: mesesDisponibles_(),
    mesesPendientes: JSON.parse(props.getProperty('MESES_PENDIENTES') || '[]'),
    activadores: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }),
  };
  // Últimas cargas del Excel
  try {
    out.ultimasCargas = leerUltimas_(HOJAS.CARGAS, 3).map(function (c) {
      return { fecha: c['Fecha'], registros: c['Registros'], nuevos: c['Nuevos'], actualizados: c['Actualizados'], meses: c['Meses afectados'], advertencias: c['Advertencias'], resultado: c['Resultado'] };
    });
  } catch (e) { out.ultimasCargas = 'Error: ' + e.message; }

  // Muestra de los últimos registros de Folios
  const sh = hoja_(HOJAS.FOLIOS); const n = Math.max(0, sh.getLastRow() - 1);
  out.filasEnFolios = n;
  if (n) {
    const k = Math.min(n, 4000);
    const vals = sh.getRange(n - k + 2, 1, k, FOL_COLS.length).getValues();
    const i = function (c) { return colIndex_(c); };
    const ahora = dateANaive_(new Date());
    const st = {}, tipo = { fReg: {}, fFs: {}, fCierre: {} };
    const r = { muestra: k, conFechaPrimerSeguimiento: 0, primerSeguimientoAntesDelRegistro: 0, horasRegistroAPrimerSeg: { 'hasta 48 h': 0, '48 h a 7 días': 0, 'más de 7 días': 0 },
      cerradosSinFechaCierre: 0, cierreAntesDelRegistro: 0, registroEnElFuturo: 0, conHistorial: 0, historialSinGestionesLeidas: 0, conGestionHumana: 0,
      enAperturaHoy: { 'hasta 48 h': 0, 'más de 48 h': 0 }, abiertosHoy: { 'hasta 7 días': 0, 'más de 7 días': 0 } };
    vals.forEach(function (row) {
      const o = filaAObjeto_(row);
      st[o.estatus || '(vacío)'] = (st[o.estatus || '(vacío)'] || 0) + 1;
      ['fReg', 'fFs', 'fCierre'].forEach(function (c) { const v = row[i(c)]; const t = v instanceof Date ? 'fecha' : v === '' ? 'vacía' : 'texto'; tipo[c][t] = (tipo[c][t] || 0) + 1; });
      if (o.fReg !== null && o.fReg > ahora + 864e5) r.registroEnElFuturo++;
      if (o.fFs !== null) {
        r.conFechaPrimerSeguimiento++;
        if (o.fReg !== null && o.fFs < o.fReg - 3600e3) r.primerSeguimientoAntesDelRegistro++;
        else if (o.fReg !== null) { const h = (o.fFs - o.fReg) / 3600e3; r.horasRegistroAPrimerSeg[h <= 48 ? 'hasta 48 h' : h <= 168 ? '48 h a 7 días' : 'más de 7 días']++; }
      }
      if (o.estatus === 'CIERRE' && o.fCierre === null) r.cerradosSinFechaCierre++;
      if (o.fCierre !== null && o.fReg !== null && o.fCierre < o.fReg - 3600e3) r.cierreAntesDelRegistro++;
      if (o.hist) {
        r.conHistorial++;
        const g = parseHist_(o.hist);
        if (!g.length) r.historialSinGestionesLeidas++;
        if (g.some(function (e) { return e.a !== SYS_USER; })) r.conGestionHumana++;
      }
      if (o.fReg !== null && o.estatus !== 'CIERRE' && o.estatus !== 'CANCELADO') {
        const h = (ahora - o.fReg) / 3600e3;
        if (o.estatus === 'APERTURA') r.enAperturaHoy[h <= Number(cfg.SLA_1ER_H) ? 'hasta 48 h' : 'más de 48 h']++;
        r.abiertosHoy[h <= Number(cfg.CIERRE_DIAS) * 24 ? 'hasta 7 días' : 'más de 7 días']++;
      }
    });
    r.estatus = st; r.tipoDeCeldaEnFechas = tipo;
    out.folios = r;
  }

  // Caché del dashboard: tamaño de los últimos meses y tiempo de lectura
  out.cacheMeses = mesesDisponibles_().slice(-3).map(function (m) {
    const t = Date.now(); let c = null, err = null;
    try { c = leerCacheMes_(m); } catch (e) { err = e.message; }
    return { mes: m, folios: c ? c.f.length : 0, tamanoKB: c ? Math.round(JSON.stringify(c).length / 1024) : 0, generado: c ? c.generado : null, segundosLectura: (Date.now() - t) / 1000, error: err };
  });
  out.segundosDiagnostico = (Date.now() - t0) / 1000;
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
