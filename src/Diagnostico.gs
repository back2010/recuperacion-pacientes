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
    const r = { muestra: k, conFechaPrimerSeguimiento: 0, primerSeguimientoAntesDelRegistro: 0, diasRegistroAPrimerSeg: { 'hasta 2 días': 0, '3 a 7 días': 0, 'más de 7 días': 0 },
      cerradosSinFechaCierre: 0, cierreAntesDelRegistro: 0, registroEnElFuturo: 0, conHistorial: 0, historialSinGestionesLeidas: 0, conGestionHumana: 0,
      enAperturaHoy: { 'hasta 2 días': 0, 'más de 2 días': 0 }, abiertosHoy: { 'hasta 7 días': 0, 'más de 7 días': 0 } };
    const dia = function (ms) { return Math.floor(ms / 864e5); };
    vals.forEach(function (row) {
      const o = filaAObjeto_(row);
      st[o.estatus || '(vacío)'] = (st[o.estatus || '(vacío)'] || 0) + 1;
      ['fReg', 'fFs', 'fCierre'].forEach(function (c) { const v = row[i(c)]; const t = v instanceof Date ? 'fecha' : v === '' ? 'vacía' : 'texto'; tipo[c][t] = (tipo[c][t] || 0) + 1; });
      if (o.fReg !== null && o.fReg > ahora + 864e5) r.registroEnElFuturo++;
      if (o.fFs !== null) {
        r.conFechaPrimerSeguimiento++;
        if (o.fReg !== null && o.fFs < o.fReg - 3600e3) r.primerSeguimientoAntesDelRegistro++;
        else if (o.fReg !== null) { const d = dia(o.fFs) - dia(o.fReg); r.diasRegistroAPrimerSeg[d <= 2 ? 'hasta 2 días' : d <= 7 ? '3 a 7 días' : 'más de 7 días']++; }
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
        const d = dia(ahora) - dia(o.fReg);
        if (o.estatus === 'APERTURA') r.enAperturaHoy[d <= Number(cfg.APERTURA_DIAS) ? 'hasta 2 días' : 'más de 2 días']++;
        r.abiertosHoy[d <= Number(cfg.CIERRE_DIAS) ? 'hasta 7 días' : 'más de 7 días']++;
      }
    });
    r.estatus = st; r.tipoDeCeldaEnFechas = tipo;
    out.folios = r;
  }

  // Conteo por días, por mes de registro, con la misma regla del dashboard
  try { out.conteoPorDias = conteoPorDias_(cfg); } catch (e) { out.conteoPorDias = 'Error: ' + e.message; }

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

/**
 * Conteo por días (día del registro = día 0, hora de Mazatlán), por mes de registro.
 * Aperturas: día del primer comentario (o Fecha de primer seguimiento). Hasta el día APERTURA_DIAS = en tiempo; después = vencida.
 * Cierres: día del cierre. Hasta el día CIERRE_DIAS = en tiempo; después = vencido.
 * Excluye cancelados, cierres automáticos y reasignados (igual que el universo "Gestión" del dashboard).
 */
function conteoPorDias_(cfg) {
  const apMax = Number(cfg.APERTURA_DIAS), cMax = Number(cfg.CIERRE_DIAS);
  const hoy = Math.floor(dateANaive_(new Date()) / 864e5);
  const reas = leerReasignados_(true);
  const dl = function (d) { return d === 0 ? 'mismo día' : d === 1 ? '1 día' : d + ' días'; };
  const out = {};
  mesesDisponibles_().forEach(function (mes) {
    const c = leerCacheMes_(mes); if (!c) return;
    const d = c.d, s = function (i) { return i == null || i < 0 ? '' : d[i]; };
    const ap = {}, ci = {};
    for (let i = 0; i <= apMax; i++) ap[dl(i)] = 0;
    for (let i = 0; i <= cMax; i++) ci[dl(i)] = 0;
    const A = { enTiempo: 0, vencidasComentadasTarde: 0, sinComentarioAunATiempo: 0, sinComentarioVencidas: 0, sinFecha: 0 };
    const C = { enTiempo: 0, vencidosCerradosTarde: 0, abiertosAunATiempo: 0, abiertosVencidos: 0, cerradosSinFecha: 0 };
    let n = 0;
    c.f.forEach(function (r) {
      if (r[8] & 2) return;                                     // cierre automático
      if (reas[String(r[0])]) return;                           // reasignado
      const est = s(r[2]); if (est === 'CANCELADO') return;
      const fReg = r[9]; if (fReg == null) return;
      n++;
      const dReg = Math.floor(fReg / 1440);
      const fsOk = r[10] != null && r[10] >= fReg - 60 ? r[10] : null;   // Fecha de primer seguimiento válida
      const cand = [fsOk, r[11]].filter(function (x) { return x != null; });
      const cerrado = est === 'CIERRE' || (est === 'TERMINO' && cfg.TERMINO_COMO === 'cerrado');
      // Apertura
      if (cand.length) {
        const da = Math.max(0, Math.floor(Math.min.apply(null, cand) / 1440) - dReg);
        if (da <= apMax) { ap[dl(da)]++; A.enTiempo++; } else A.vencidasComentadasTarde++;
      } else if (est === 'APERTURA') { if (hoy - dReg > apMax) A.sinComentarioVencidas++; else A.sinComentarioAunATiempo++; }
      else A.sinFecha++;
      // Cierre
      if (cerrado) {
        if (r[12] == null) { C.cerradosSinFecha++; return; }
        const dc = Math.max(0, Math.floor(r[12] / 1440) - dReg);
        if (dc <= cMax) { ci[dl(dc)]++; C.enTiempo++; } else C.vencidosCerradosTarde++;
      } else { if (hoy - dReg > cMax) C.abiertosVencidos++; else C.abiertosAunATiempo++; }
    });
    A.totalVencidas = A.vencidasComentadasTarde + A.sinComentarioVencidas;
    C.totalVencidos = C.vencidosCerradosTarde + C.abiertosVencidos;
    out[mes] = { folios: n,
      aperturas: { porDiaEnTiempo: ap, resumen: A, regla: 'primer comentario a más tardar el día ' + apMax + '; el día ' + (apMax + 1) + ' o después = vencida' },
      cierres: { porDiaEnTiempo: ci, resumen: C, regla: 'cierre a más tardar el día ' + cMax + '; el día ' + (cMax + 1) + ' o después = vencido' } };
  });
  return out;
}
