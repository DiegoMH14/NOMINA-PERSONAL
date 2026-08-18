'use strict';
/**
 * bot.js -> POST /api/bot  (esta URL se la das a Telegram como webhook)
 *
 * Bot con menú de botones (inline keyboard) + formularios paso a paso:
 * tocas una opción (ej. "Ingreso"), el bot te pregunta un dato a la vez
 * (monto -> cuenta -> descripción, etc.), y al final te muestra UN
 * resumen completo con todo lo que vas a guardar, con botones para
 * "✅ Confirmar", "✏️ Editar" (elige qué campo cambiar y vuelve al
 * resumen) o "❌ Cancelar". Ese mismo patrón (motor "FLUJOS" más abajo)
 * se usa para Gasto, Ingreso, Cuentas, Deudas, Categorías, Metas y
 * Pagos — y es el que hay que reutilizar si agregas algo nuevo.
 *
 * Como cada mensaje que llega es una invocación nueva y sin memoria
 * (serverless), el paso en el que va la conversación se guarda en la
 * columna estado/estado_datos de telegram_vinculos (ver
 * migracion_estado_bot.sql) y se lee/borra en cada mensaje.
 *
 * Para activarlo (una sola vez, después de desplegar a Netlify):
 *
 *   curl "https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://tu-app.netlify.app/api/bot"
 *
 * Variables de entorno requeridas en Netlify:
 *   TELEGRAM_BOT_TOKEN
 *   (+ las mismas TURSO_DATABASE_URL / TURSO_AUTH_TOKEN de siempre)
 */

const { getConnection } = require('./_db');
const { jsonResponse } = require('./_http');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TOKEN}`;

const MONTO_RE = /^\$?([\d.,]+)$/;
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fmt(monto) {
  return `$${Math.round(monto).toLocaleString('en-US')}`.replace(/,/g, '.');
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function parseMonto(texto) {
  const m = MONTO_RE.exec((texto || '').trim().replace(/\s+/g, ''));
  if (!m) return null;
  const val = parseFloat(m[1].replace(/\./g, '').replace(/,/g, ''));
  return Number.isNaN(val) ? null : val;
}

function parseFecha(texto) {
  const t = (texto || '').trim();
  const m = FECHA_RE.exec(t);
  if (!m) return null;
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return t;
}

function siguienteFechaRecurrente(vencActual, recurrente) {
  const d = new Date(`${vencActual}T00:00:00Z`);
  if (recurrente === 'mensual') {
    const mesActual = d.getUTCMonth() + 1;
    const mesNuevo = (mesActual % 12) + 1;
    const anioNuevo = d.getUTCFullYear() + (mesActual === 12 ? 1 : 0);
    const dia = Math.min(d.getUTCDate(), 28);
    return `${anioNuevo}-${String(mesNuevo).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  if (recurrente === 'semanal') {
    return new Date(d.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  }
  if (recurrente === 'anual') {
    return `${d.getUTCFullYear() + 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

// ---------- Telegram API ----------

async function enviar(chatId, texto, replyMarkup) {
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function responderCallback(callbackQueryId, texto) {
  await fetch(`${API_URL}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: texto || undefined }),
  });
}

// ---------- Menú principal (inline keyboard = botones pegados al mensaje) ----------
//
// Simplificado: cada sección (Cuentas, Categorías, Deudas, Metas, Pagos) es
// UN solo botón que abre un submenú con "Ver" + "Nueva/Abonar/Marcar" — así
// el menú principal no muestra 18 botones de una. Gasto e Ingreso quedan
// sueltos arriba, sin submenú, porque son las acciones que más se usan y
// conviene que se registren en un solo toque.

const MENU_PRINCIPAL = {
  inline_keyboard: [
    [{ text: '💰 Saldo', callback_data: 'saldo' }, { text: '🧾 Movimientos', callback_data: 'movimientos' }],
    [{ text: '➖ Gasto', callback_data: 'gasto' }, { text: '➕ Ingreso', callback_data: 'ingreso' }],
    [{ text: '🏦 Cuentas', callback_data: 'sub_cuentas' }, { text: '🗂 Categorías', callback_data: 'sub_categorias' }],
    [{ text: '📉 Deudas', callback_data: 'sub_deudas' }, { text: '🎯 Metas', callback_data: 'sub_metas' }],
    [{ text: '📅 Pagos', callback_data: 'sub_pagos' }],
    [{ text: '🔌 Desvincular', callback_data: 'desvincular' }, { text: '❓ Ayuda', callback_data: 'ayuda' }],
  ],
};

// Submenús de cada sección: "Ver" reutiliza el mismo callback_data que ya
// existía en el menú viejo (cuentas, deudas...), y "Nueva/Abonar/Marcar"
// reutiliza los mismos ids de FLUJOS de siempre — no hay lógica nueva que
// escribir para esas acciones, solo se movieron de sitio.
const SUBMENUS = {
  sub_cuentas: {
    titulo: '🏦 Cuentas — elige una opción:',
    botones: [
      [{ text: '👀 Ver cuentas', callback_data: 'cuentas' }],
      [{ text: '➕ Nueva cuenta', callback_data: 'crear_cuenta' }],
      [{ text: '⬅️ Menú', callback_data: 'menu' }],
    ],
  },
  sub_categorias: {
    titulo: '🗂 Categorías — elige una opción:',
    botones: [
      [{ text: '👀 Ver categorías', callback_data: 'categorias' }],
      [{ text: '➕ Nueva categoría', callback_data: 'crear_categoria' }],
      [{ text: '⬅️ Menú', callback_data: 'menu' }],
    ],
  },
  sub_deudas: {
    titulo: '📉 Deudas — elige una opción:',
    botones: [
      [{ text: '👀 Ver deudas', callback_data: 'deudas' }],
      [{ text: '➕ Nueva deuda', callback_data: 'crear_deuda' }],
      [{ text: '💳 Abonar a deuda', callback_data: 'abono_deuda' }],
      [{ text: '⬅️ Menú', callback_data: 'menu' }],
    ],
  },
  sub_metas: {
    titulo: '🎯 Metas — elige una opción:',
    botones: [
      [{ text: '👀 Ver metas', callback_data: 'metas' }],
      [{ text: '➕ Nueva meta', callback_data: 'crear_meta' }],
      [{ text: '💚 Aportar a meta', callback_data: 'aportar_meta' }],
      [{ text: '⬅️ Menú', callback_data: 'menu' }],
    ],
  },
  sub_pagos: {
    titulo: '📅 Pagos — elige una opción:',
    botones: [
      [{ text: '👀 Ver pagos', callback_data: 'pagos' }],
      [{ text: '➕ Nuevo pago', callback_data: 'crear_pago' }],
      [{ text: '✅ Marcar pago', callback_data: 'marcar_pago' }],
      [{ text: '⬅️ Menú', callback_data: 'menu' }],
    ],
  },
};

const BOTON_CANCELAR = { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'cancelar' }]] };

const URL_REGISTRO = 'https://nomina-personal.netlify.app/';

const TEXTO_BIENVENIDA =
  '👋 Bienvenido/a a Nómina Personal\n\n' +
  'Soy el bot que te ayuda a llevar tus cuentas, gastos, ingresos, deudas, metas de ahorro ' +
  'y pagos pendientes sin salir de Telegram — todo sincronizado con tu cuenta de la web.\n\n' +
  '¿Ya tienes cuenta o deseas registrarte en nuestro servicio?';

const BOTON_BIENVENIDA = {
  inline_keyboard: [
    [{ text: '🔑 Ya tengo cuenta', callback_data: 'ya_tengo_cuenta' }],
    [{ text: '📝 Registrarme', url: URL_REGISTRO }],
  ],
};

function botonSaltarCancelar(flujoId, campoKey) {
  return {
    inline_keyboard: [
      [{ text: '⏭️ Omitir', callback_data: `skip:${flujoId}:${campoKey}` }],
      [{ text: '❌ Cancelar', callback_data: 'cancelar' }],
    ],
  };
}

async function enviarMenu(chatId, texto) {
  await enviar(chatId, texto || 'Elige una opción:', MENU_PRINCIPAL);
}

// Envía el resultado (saldo, movimientos, etc.) y el menú EN UN SOLO mensaje
// de Telegram, en vez de dos mensajes seguidos (enviar + enviarMenu). Cada
// llamada a la API de Telegram es un viaje de red completo, así que esto
// reduce a la mitad la latencia percibida en las respuestas más comunes.
async function enviarConMenu(chatId, texto) {
  await enviar(chatId, texto, MENU_PRINCIPAL);
}

// ---------- Estado conversacional (guardado en telegram_vinculos) ----------

async function obtenerEstado(conn, userId) {
  const rs = await conn.execute({
    sql: 'SELECT estado, estado_datos FROM telegram_vinculos WHERE user_id=?',
    args: [userId],
  });
  if (rs.rows.length === 0 || !rs.rows[0].estado) return { estado: null, datos: {} };
  let datos = {};
  try {
    datos = JSON.parse(rs.rows[0].estado_datos || '{}');
  } catch (e) {
    datos = {};
  }
  return { estado: rs.rows[0].estado, datos };
}

async function setEstado(conn, userId, estado, datos) {
  await conn.execute({
    sql: 'UPDATE telegram_vinculos SET estado=?, estado_datos=? WHERE user_id=?',
    args: [estado, JSON.stringify(datos || {}), userId],
  });
}

async function limpiarEstado(conn, userId) {
  await conn.execute({
    sql: 'UPDATE telegram_vinculos SET estado=NULL, estado_datos=NULL WHERE user_id=?',
    args: [userId],
  });
}

// ---------- Datos: vinculación ----------

async function usuarioPorChat(conn, chatId) {
  const rs = await conn.execute({
    sql: `SELECT u.id, u.username FROM telegram_vinculos t
          JOIN usuarios u ON u.id = t.user_id WHERE t.chat_id=?`,
    args: [String(chatId)],
  });
  if (rs.rows.length === 0) return null;
  return { id: rs.rows[0].id, username: rs.rows[0].username };
}

async function vincularConCodigo(conn, codigo, chatId, telegramUsername) {
  const rs = await conn.execute({
    sql: 'SELECT user_id, codigo_expira FROM telegram_vinculos WHERE codigo=?',
    args: [codigo.trim().toUpperCase()],
  });
  if (rs.rows.length === 0) return null;
  const { user_id: userId, codigo_expira: codigoExpira } = rs.rows[0];
  if (!codigoExpira || new Date() > new Date(codigoExpira)) return null;
  await conn.execute({
    sql: `UPDATE telegram_vinculos SET chat_id=?, telegram_username=?,
          codigo=NULL, codigo_expira=NULL, vinculado_en=? WHERE user_id=?`,
    args: [String(chatId), telegramUsername || null, new Date().toISOString(), userId],
  });
  return userId;
}

// ---------- Datos: cuentas ----------

async function cuentasConSaldo(conn, userId) {
  const rs = await conn.execute({
    sql: 'SELECT id, nombre, saldo_inicial FROM cuentas WHERE user_id=? AND activa=1 ORDER BY nombre',
    args: [userId],
  });
  const out = [];
  for (const row of rs.rows) {
    const ingresosRs = await conn.execute({
      sql: "SELECT COALESCE(SUM(monto),0) AS total FROM movimientos WHERE user_id=? AND cuenta_id=? AND tipo='ingreso'",
      args: [userId, row.id],
    });
    const gastosRs = await conn.execute({
      sql: "SELECT COALESCE(SUM(monto),0) AS total FROM movimientos WHERE user_id=? AND cuenta_id=? AND tipo='gasto'",
      args: [userId, row.id],
    });
    const saldo = Math.round((row.saldo_inicial + ingresosRs.rows[0].total - gastosRs.rows[0].total) * 100) / 100;
    out.push({ id: row.id, nombre: row.nombre, saldo_actual: saldo });
  }
  return out;
}

async function crearCuenta(conn, userId, nombre, saldoInicial) {
  const rs = await conn.execute({
    sql: 'INSERT INTO cuentas (user_id, nombre, tipo, saldo_inicial) VALUES (?,?,?,?)',
    args: [userId, nombre, 'otro', saldoInicial || 0],
  });
  return Number(rs.lastInsertRowid);
}

async function nombreCuenta(conn, userId, cuentaId) {
  if (!cuentaId) return 'Sin cuenta';
  const cuentas = await cuentasConSaldo(conn, userId);
  const c = cuentas.find((x) => x.id === cuentaId);
  return c ? c.nombre : `#${cuentaId}`;
}

// ---------- Datos: movimientos ----------

async function crearMovimiento(conn, userId, tipo, monto, cuentaId, descripcion) {
  const fecha = hoyISO();
  const dupRs = await conn.execute({
    sql: 'SELECT id FROM movimientos WHERE user_id=? AND cuenta_id=? AND monto=? AND fecha=? AND tipo=?',
    args: [userId, cuentaId, monto, fecha, tipo],
  });
  if (dupRs.rows.length > 0) return { id: null, error: 'duplicado' };

  const catRs = await conn.execute({
    sql: 'SELECT id FROM categorias WHERE user_id=? AND tipo=? ORDER BY id LIMIT 1',
    args: [userId, tipo],
  });
  const categoriaId = catRs.rows.length > 0 ? catRs.rows[0].id : null;

  const rs = await conn.execute({
    sql: `INSERT INTO movimientos (user_id, tipo, monto, categoria_id, cuenta_id, fecha, descripcion)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, tipo, monto, categoriaId, cuentaId, fecha, descripcion || null],
  });
  return { id: Number(rs.lastInsertRowid), error: null };
}

// ---------- Datos: deudas ----------

async function listarDeudas(conn, userId) {
  const rs = await conn.execute({
    sql: `SELECT id, nombre, monto_total, monto_pagado, fecha_limite FROM deudas
          WHERE user_id=? AND activa=1 ORDER BY fecha_limite IS NULL, fecha_limite`,
    args: [userId],
  });
  return rs.rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    monto_total: row.monto_total,
    monto_pagado: row.monto_pagado,
    falta: Math.round(Math.max(0, row.monto_total - row.monto_pagado) * 100) / 100,
    fecha_limite: row.fecha_limite,
    saldada: row.monto_pagado >= row.monto_total,
  }));
}

async function crearDeuda(conn, userId, nombre, montoTotal, fechaLimite) {
  const rs = await conn.execute({
    sql: 'INSERT INTO deudas (user_id, nombre, monto_total, monto_pagado, fecha_inicio, fecha_limite) VALUES (?,?,?,0,?,?)',
    args: [userId, nombre, montoTotal, hoyISO(), fechaLimite || null],
  });
  return Number(rs.lastInsertRowid);
}

async function abonarDeuda(conn, userId, deudaId, monto) {
  const rs = await conn.execute({
    sql: 'SELECT id FROM deudas WHERE id=? AND user_id=? AND activa=1',
    args: [deudaId, userId],
  });
  if (rs.rows.length === 0) return false;
  await conn.execute({
    sql: 'UPDATE deudas SET monto_pagado = monto_pagado + ? WHERE id=? AND user_id=?',
    args: [monto, deudaId, userId],
  });
  return true;
}

async function nombreDeuda(conn, userId, deudaId) {
  const deudas = await listarDeudas(conn, userId);
  const d = deudas.find((x) => x.id === deudaId);
  return d ? d.nombre : `#${deudaId}`;
}

// ---------- Datos: categorías ----------

async function listarCategorias(conn, userId, tipo) {
  const rs = await conn.execute(
    tipo
      ? { sql: 'SELECT id, nombre, tipo FROM categorias WHERE user_id=? AND tipo=? ORDER BY nombre', args: [userId, tipo] }
      : { sql: 'SELECT id, nombre, tipo FROM categorias WHERE user_id=? ORDER BY tipo, nombre', args: [userId] }
  );
  return rs.rows.map((r) => ({ id: r.id, nombre: r.nombre, tipo: r.tipo }));
}

async function crearCategoria(conn, userId, nombre, tipo) {
  const rs = await conn.execute({
    sql: 'INSERT INTO categorias (user_id, nombre, tipo) VALUES (?,?,?)',
    args: [userId, nombre, tipo],
  });
  return Number(rs.lastInsertRowid);
}

async function nombreCategoria(conn, userId, categoriaId) {
  if (!categoriaId) return 'Sin categoría';
  const cats = await listarCategorias(conn, userId);
  const c = cats.find((x) => x.id === categoriaId);
  return c ? c.nombre : `#${categoriaId}`;
}

// ---------- Datos: metas ----------

async function listarMetas(conn, userId, soloActivas) {
  const rs = await conn.execute({
    sql: `SELECT id, nombre, monto_objetivo, monto_actual, fecha_objetivo FROM metas_ahorro
          WHERE user_id=? ${soloActivas ? 'AND activa=1' : ''} ORDER BY fecha_objetivo`,
    args: [userId],
  });
  return rs.rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    monto_objetivo: row.monto_objetivo,
    monto_actual: row.monto_actual,
    fecha_objetivo: row.fecha_objetivo,
    completada: row.monto_actual >= row.monto_objetivo,
  }));
}

async function crearMeta(conn, userId, nombre, montoObjetivo, fechaObjetivo) {
  const rs = await conn.execute({
    sql: `INSERT INTO metas_ahorro (user_id, nombre, monto_objetivo, monto_actual, fecha_inicio, fecha_objetivo)
          VALUES (?,?,?,0,?,?)`,
    args: [userId, nombre, montoObjetivo, hoyISO(), fechaObjetivo],
  });
  return Number(rs.lastInsertRowid);
}

async function aportarMeta(conn, userId, metaId, monto) {
  const rs = await conn.execute({
    sql: 'SELECT id FROM metas_ahorro WHERE id=? AND user_id=? AND activa=1',
    args: [metaId, userId],
  });
  if (rs.rows.length === 0) return false;
  await conn.execute({
    sql: 'UPDATE metas_ahorro SET monto_actual = monto_actual + ? WHERE id=? AND user_id=?',
    args: [monto, metaId, userId],
  });
  return true;
}

async function nombreMeta(conn, userId, metaId) {
  const metas = await listarMetas(conn, userId, false);
  const m = metas.find((x) => x.id === metaId);
  return m ? m.nombre : `#${metaId}`;
}

// ---------- Datos: pagos pendientes ----------

async function listarPagos(conn, userId, incluirPagados) {
  const rs = await conn.execute({
    sql: `SELECT id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, pagado, recurrente
          FROM pagos_pendientes WHERE user_id=? ${incluirPagados ? '' : 'AND pagado=0'}
          ORDER BY fecha_vencimiento ASC`,
    args: [userId],
  });
  const hoy = new Date(`${hoyISO()}T00:00:00Z`);
  return rs.rows.map((row) => {
    const venc = new Date(`${row.fecha_vencimiento}T00:00:00Z`);
    const dias = Math.round((venc - hoy) / 86400000);
    let estado = 'pendiente';
    if (row.pagado) estado = 'pagado';
    else if (dias < 0) estado = 'vencido';
    else if (dias <= 7) estado = 'proximo';
    return { ...row, dias_restantes: dias, estado };
  });
}

async function crearPago(conn, userId, nombre, monto, fechaVencimiento, categoriaId, cuentaId, recurrente) {
  const rs = await conn.execute({
    sql: `INSERT INTO pagos_pendientes (user_id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, recurrente)
          VALUES (?,?,?,?,?,?,?)`,
    args: [userId, nombre, monto, fechaVencimiento, categoriaId || null, cuentaId || null, recurrente || 'ninguna'],
  });
  return Number(rs.lastInsertRowid);
}

async function marcarPagado(conn, userId, pagoId, cuentaId) {
  const pagoRs = await conn.execute({
    sql: `SELECT id, nombre, monto, fecha_vencimiento, categoria_id, recurrente
          FROM pagos_pendientes WHERE id=? AND user_id=? AND pagado=0`,
    args: [pagoId, userId],
  });
  if (pagoRs.rows.length === 0) return null;
  const pago = pagoRs.rows[0];
  const fechaPago = hoyISO();
  await conn.execute({
    sql: 'UPDATE pagos_pendientes SET pagado=1, fecha_pago=?, cuenta_id=? WHERE id=? AND user_id=?',
    args: [fechaPago, cuentaId, pagoId, userId],
  });
  await conn.execute({
    sql: `INSERT INTO movimientos (user_id, tipo, monto, categoria_id, cuenta_id, fecha, descripcion, pago_pendiente_id)
          VALUES (?, 'gasto', ?, ?, ?, ?, ?, ?)`,
    args: [userId, pago.monto, pago.categoria_id, cuentaId, fechaPago, `Pago: ${pago.nombre}`, pagoId],
  });
  if (pago.recurrente && pago.recurrente !== 'ninguna') {
    const nuevaFecha = siguienteFechaRecurrente(pago.fecha_vencimiento, pago.recurrente);
    if (nuevaFecha) {
      await conn.execute({
        sql: `INSERT INTO pagos_pendientes (user_id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, recurrente)
              VALUES (?,?,?,?,?,?,?)`,
        args: [userId, pago.nombre, pago.monto, nuevaFecha, pago.categoria_id, cuentaId, pago.recurrente],
      });
    }
  }
  return { nombre: pago.nombre, monto: pago.monto };
}

async function nombrePago(conn, userId, pagoId) {
  const pagos = await listarPagos(conn, userId, true);
  const p = pagos.find((x) => x.id === pagoId);
  return p ? p.nombre : `#${pagoId}`;
}

// ---------- Mensajes de resumen (listas de solo lectura) ----------

async function textoSaldo(conn, usuario) {
  const cuentas = await cuentasConSaldo(conn, usuario.id);
  if (cuentas.length === 0) return 'Todavía no tienes cuentas creadas. Usa "➕ Nueva cuenta" en el menú.';
  const total = cuentas.reduce((acc, c) => acc + c.saldo_actual, 0);
  const lineas = [`💰 Saldo de ${usuario.username}:`];
  for (const c of cuentas) lineas.push(`• ${c.nombre}: ${fmt(c.saldo_actual)}`);
  lineas.push(`\nTotal: ${fmt(total)}`);
  return lineas.join('\n');
}

async function textoMovimientos(conn, usuario, n) {
  const rs = await conn.execute({
    sql: `SELECT m.fecha, m.tipo, m.monto, m.descripcion, cu.nombre AS cuenta_nombre
          FROM movimientos m LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
          WHERE m.user_id=? ORDER BY m.fecha DESC, m.id DESC LIMIT ?`,
    args: [usuario.id, n || 5],
  });
  if (rs.rows.length === 0) return 'No tienes movimientos registrados aún.';
  const lineas = [`🧾 Tus últimos ${rs.rows.length} movimientos:`];
  for (const row of rs.rows) {
    const signo = row.tipo === 'ingreso' ? '+' : '-';
    const desc = row.descripcion || 'Movimiento';
    lineas.push(`${row.fecha} · ${signo}${fmt(row.monto)} · ${desc} (${row.cuenta_nombre})`);
  }
  return lineas.join('\n');
}

async function textoCuentas(conn, usuario) {
  const cuentas = await cuentasConSaldo(conn, usuario.id);
  if (cuentas.length === 0) return 'Todavía no tienes cuentas. Usa "➕ Nueva cuenta" en el menú.';
  const lineas = ['🏦 Tus cuentas:'];
  for (const c of cuentas) lineas.push(`• ${c.nombre}: ${fmt(c.saldo_actual)}`);
  return lineas.join('\n');
}

async function textoDeudas(conn, usuario) {
  const deudas = await listarDeudas(conn, usuario.id);
  if (deudas.length === 0) return 'No tienes deudas registradas. Usa "➕ Nueva deuda" en el menú.';
  const lineas = ['📉 Tus deudas:'];
  for (const d of deudas) {
    const estado = d.saldada
      ? 'saldada ✅'
      : `faltan ${fmt(d.falta)}${d.fecha_limite ? ' · vence ' + d.fecha_limite : ''}`;
    lineas.push(`• ${d.nombre}: ${fmt(d.monto_pagado)} / ${fmt(d.monto_total)} — ${estado}`);
  }
  return lineas.join('\n');
}

async function textoCategorias(conn, usuario) {
  const cats = await listarCategorias(conn, usuario.id);
  if (cats.length === 0) return 'No tienes categorías. Usa "➕ Nueva categoría" en el menú.';
  const lineas = ['🗂 Tus categorías:'];
  for (const c of cats) lineas.push(`• ${c.nombre} (${c.tipo})`);
  return lineas.join('\n');
}

async function textoMetas(conn, usuario) {
  const metas = await listarMetas(conn, usuario.id, true);
  if (metas.length === 0) return 'No tienes metas de ahorro. Usa "➕ Nueva meta" en el menú.';
  const lineas = ['🎯 Tus metas:'];
  for (const m of metas) {
    const pct = m.monto_objetivo ? Math.round((m.monto_actual / m.monto_objetivo) * 100) : 0;
    const estado = m.completada ? '✅ completada' : `${pct}% · vence ${m.fecha_objetivo}`;
    lineas.push(`• ${m.nombre}: ${fmt(m.monto_actual)} / ${fmt(m.monto_objetivo)} — ${estado}`);
  }
  return lineas.join('\n');
}

async function textoPagos(conn, usuario) {
  const pagos = await listarPagos(conn, usuario.id, false);
  if (pagos.length === 0) return 'No tienes pagos pendientes. Usa "➕ Nuevo pago" en el menú.';
  const etiquetas = { vencido: '🔴 vencido', proximo: '🟡 próximo', pendiente: '⚪ pendiente' };
  const lineas = ['📅 Tus pagos pendientes:'];
  for (const p of pagos) {
    lineas.push(`• ${p.nombre}: ${fmt(p.monto)} · vence ${p.fecha_vencimiento} — ${etiquetas[p.estado] || p.estado}`);
  }
  return lineas.join('\n');
}

const TEXTO_AYUDA =
  'Usa el menú de botones para todo — no necesitas escribir comandos. ' +
  'Toca una opción, y si necesita varios datos (monto, cuenta, fecha, etc.) te los voy a preguntar ' +
  'uno por uno. Al final te muestro un resumen completo: puedes tocar "✅ Confirmar" para guardar, ' +
  '"✏️ Editar" para corregir algún dato antes de guardar, o "❌ Cancelar".\n\n' +
  'Comandos rápidos: /saldo, /menu, /ayuda.';

// =====================================================================
// Motor de formularios paso a paso (wizard)
//
// Cada flujo se define en FLUJOS como una lista ordenada de "campos".
// El bot pregunta cada campo uno a la vez (guardando la respuesta en
// estado_datos.valores), y cuando ya tiene todos muestra un resumen
// con botones Confirmar / Editar / Cancelar.
//
// Tipos de campo:
//   'monto'    -> espera un número (admite "20000", "$20.000", etc.)
//   'texto'    -> espera texto libre
//   'fecha'    -> espera AAAA-MM-DD
//   'opciones' -> muestra botones; opciones(conn, usuario, valores) debe
//                 devolver [{ text, value }]. `value` no debe llevar ":"
//                 y debe ser id numérico o palabra corta.
//
// Cada campo puede tener `opcional: true` (aparece un botón "Omitir").
// Si un campo de tipo 'opciones' es opcional y no hay nada para elegir,
// se omite automáticamente sin preguntar.
// =====================================================================

const FLUJOS = {
  gasto: {
    titulo: 'Gasto',
    campos: [
      { key: 'monto', label: 'Monto', tipo: 'monto', prompt: '¿Cuál es el monto del gasto?' },
      {
        key: 'cuenta',
        label: 'Cuenta',
        tipo: 'opciones',
        prompt: '¿De qué cuenta sale? (efectivo o la cuenta que sea)',
        opciones: async (conn, usuario) =>
          (await cuentasConSaldo(conn, usuario.id)).map((c) => ({ text: `${c.nombre} (${fmt(c.saldo_actual)})`, value: c.id })),
      },
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', prompt: '¿Algún detalle? (ej: mercado, transporte)', opcional: true },
    ],
    resumen: async (conn, usuario, v) =>
      `➖ Gasto\nMonto: ${fmt(v.monto)}\nCuenta: ${await nombreCuenta(conn, usuario.id, v.cuenta)}\nDescripción: ${v.descripcion || '—'}`,
    guardar: async (conn, usuario, v) => {
      const { error } = await crearMovimiento(conn, usuario.id, 'gasto', v.monto, v.cuenta, v.descripcion);
      if (error === 'duplicado') return '⚠️ Ya existe un movimiento igual hoy (misma cuenta, monto y tipo). No lo dupliqué.';
      return `✅ Gasto de ${fmt(v.monto)} registrado en ${await nombreCuenta(conn, usuario.id, v.cuenta)}.`;
    },
  },

  ingreso: {
    titulo: 'Ingreso',
    campos: [
      { key: 'monto', label: 'Monto', tipo: 'monto', prompt: '¿Cuál es el monto del ingreso?' },
      {
        key: 'cuenta',
        label: 'Cuenta',
        tipo: 'opciones',
        prompt: '¿En qué cuenta entra? (efectivo o la cuenta que sea)',
        opciones: async (conn, usuario) =>
          (await cuentasConSaldo(conn, usuario.id)).map((c) => ({ text: `${c.nombre} (${fmt(c.saldo_actual)})`, value: c.id })),
      },
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', prompt: '¿Algún detalle? (ej: salario, venta)', opcional: true },
    ],
    resumen: async (conn, usuario, v) =>
      `➕ Ingreso\nMonto: ${fmt(v.monto)}\nCuenta: ${await nombreCuenta(conn, usuario.id, v.cuenta)}\nDescripción: ${v.descripcion || '—'}`,
    guardar: async (conn, usuario, v) => {
      const { error } = await crearMovimiento(conn, usuario.id, 'ingreso', v.monto, v.cuenta, v.descripcion);
      if (error === 'duplicado') return '⚠️ Ya existe un movimiento igual hoy (misma cuenta, monto y tipo). No lo dupliqué.';
      return `✅ Ingreso de ${fmt(v.monto)} registrado en ${await nombreCuenta(conn, usuario.id, v.cuenta)}.`;
    },
  },

  crear_cuenta: {
    titulo: 'Nueva cuenta',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', prompt: '¿Cómo se llama la cuenta? (ej. Nequi, Bancolombia, Efectivo)' },
      { key: 'saldo_inicial', label: 'Saldo inicial', tipo: 'monto', prompt: '¿Con qué saldo inicial? (escribe 0 si empieza en cero)' },
    ],
    resumen: async (conn, usuario, v) => `🏦 Nueva cuenta\nNombre: ${v.nombre}\nSaldo inicial: ${fmt(v.saldo_inicial)}`,
    guardar: async (conn, usuario, v) => {
      await crearCuenta(conn, usuario.id, v.nombre, v.saldo_inicial);
      return `✅ Cuenta "${v.nombre}" creada con saldo inicial ${fmt(v.saldo_inicial)}.`;
    },
  },

  crear_deuda: {
    titulo: 'Nueva deuda',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', prompt: '¿Cómo se llama la deuda? (ej. Tarjeta Nu, Préstamo Juan)' },
      { key: 'monto_total', label: 'Monto total', tipo: 'monto', prompt: '¿Cuál es el monto total de la deuda?' },
      { key: 'fecha_limite', label: 'Fecha límite', tipo: 'fecha', prompt: '¿Fecha límite para pagarla? (AAAA-MM-DD)', opcional: true },
    ],
    resumen: async (conn, usuario, v) =>
      `📉 Nueva deuda\nNombre: ${v.nombre}\nMonto total: ${fmt(v.monto_total)}\nFecha límite: ${v.fecha_limite || '—'}`,
    guardar: async (conn, usuario, v) => {
      await crearDeuda(conn, usuario.id, v.nombre, v.monto_total, v.fecha_limite);
      return `✅ Deuda "${v.nombre}" registrada por ${fmt(v.monto_total)}.`;
    },
  },

  abono_deuda: {
    titulo: 'Abonar a deuda',
    campos: [
      {
        key: 'deuda',
        label: 'Deuda',
        tipo: 'opciones',
        prompt: '¿A cuál deuda quieres abonar?',
        opciones: async (conn, usuario) =>
          (await listarDeudas(conn, usuario.id)).filter((d) => !d.saldada).map((d) => ({ text: `${d.nombre} (faltan ${fmt(d.falta)})`, value: d.id })),
      },
      { key: 'monto', label: 'Monto', tipo: 'monto', prompt: '¿Cuánto vas a abonar?' },
    ],
    resumen: async (conn, usuario, v) => `💳 Abono a deuda\nDeuda: ${await nombreDeuda(conn, usuario.id, v.deuda)}\nMonto: ${fmt(v.monto)}`,
    guardar: async (conn, usuario, v) => {
      const ok = await abonarDeuda(conn, usuario.id, v.deuda, v.monto);
      return ok ? `✅ Abono de ${fmt(v.monto)} registrado.` : 'No encontré esa deuda.';
    },
  },

  crear_categoria: {
    titulo: 'Nueva categoría',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', prompt: '¿Cómo se llama la categoría? (ej. Mercado, Transporte, Salario)' },
      {
        key: 'tipo',
        label: 'Tipo',
        tipo: 'opciones',
        prompt: '¿Es de gasto o de ingreso?',
        opciones: async () => [
          { text: 'Gasto', value: 'gasto' },
          { text: 'Ingreso', value: 'ingreso' },
        ],
      },
    ],
    resumen: async (conn, usuario, v) => `🗂 Nueva categoría\nNombre: ${v.nombre}\nTipo: ${cap(v.tipo)}`,
    guardar: async (conn, usuario, v) => {
      await crearCategoria(conn, usuario.id, v.nombre, v.tipo);
      return `✅ Categoría "${v.nombre}" (${v.tipo}) creada.`;
    },
  },

  crear_meta: {
    titulo: 'Nueva meta',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', prompt: '¿Cómo se llama la meta? (ej. Viaje, Fondo de emergencia)' },
      { key: 'monto_objetivo', label: 'Monto objetivo', tipo: 'monto', prompt: '¿Cuánto quieres ahorrar en total?' },
      { key: 'fecha_objetivo', label: 'Fecha objetivo', tipo: 'fecha', prompt: '¿Para cuándo? (AAAA-MM-DD)' },
    ],
    resumen: async (conn, usuario, v) =>
      `🎯 Nueva meta\nNombre: ${v.nombre}\nObjetivo: ${fmt(v.monto_objetivo)}\nFecha objetivo: ${v.fecha_objetivo}`,
    guardar: async (conn, usuario, v) => {
      await crearMeta(conn, usuario.id, v.nombre, v.monto_objetivo, v.fecha_objetivo);
      return `✅ Meta "${v.nombre}" creada por ${fmt(v.monto_objetivo)}, para el ${v.fecha_objetivo}.`;
    },
  },

  aportar_meta: {
    titulo: 'Aportar a meta',
    campos: [
      {
        key: 'meta',
        label: 'Meta',
        tipo: 'opciones',
        prompt: '¿A cuál meta quieres aportar?',
        opciones: async (conn, usuario) =>
          (await listarMetas(conn, usuario.id, true)).filter((m) => !m.completada).map((m) => ({ text: m.nombre, value: m.id })),
      },
      { key: 'monto', label: 'Monto', tipo: 'monto', prompt: '¿Cuánto vas a aportar?' },
    ],
    resumen: async (conn, usuario, v) => `💚 Aporte a meta\nMeta: ${await nombreMeta(conn, usuario.id, v.meta)}\nMonto: ${fmt(v.monto)}`,
    guardar: async (conn, usuario, v) => {
      const ok = await aportarMeta(conn, usuario.id, v.meta, v.monto);
      return ok ? `✅ Aporte de ${fmt(v.monto)} registrado.` : 'No encontré esa meta.';
    },
  },

  crear_pago: {
    titulo: 'Nuevo pago',
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', prompt: '¿Cómo se llama el pago? (ej. Arriendo, Internet)' },
      { key: 'monto', label: 'Monto', tipo: 'monto', prompt: '¿Cuál es el monto?' },
      { key: 'fecha_vencimiento', label: 'Fecha de vencimiento', tipo: 'fecha', prompt: '¿Cuándo vence? (AAAA-MM-DD)' },
      {
        key: 'categoria',
        label: 'Categoría',
        tipo: 'opciones',
        prompt: '¿Con qué categoría lo asocio?',
        opcional: true,
        opciones: async (conn, usuario) => (await listarCategorias(conn, usuario.id, 'gasto')).map((c) => ({ text: c.nombre, value: c.id })),
      },
      {
        key: 'recurrente',
        label: 'Recurrencia',
        tipo: 'opciones',
        prompt: '¿Se repite?',
        opciones: async () => [
          { text: 'No se repite', value: 'ninguna' },
          { text: 'Semanal', value: 'semanal' },
          { text: 'Mensual', value: 'mensual' },
          { text: 'Anual', value: 'anual' },
        ],
      },
    ],
    resumen: async (conn, usuario, v) =>
      `📅 Nuevo pago\nNombre: ${v.nombre}\nMonto: ${fmt(v.monto)}\nVence: ${v.fecha_vencimiento}\n` +
      `Categoría: ${v.categoria ? await nombreCategoria(conn, usuario.id, v.categoria) : '—'}\n` +
      `Recurrencia: ${v.recurrente === 'ninguna' || !v.recurrente ? 'No se repite' : cap(v.recurrente)}`,
    guardar: async (conn, usuario, v) => {
      await crearPago(conn, usuario.id, v.nombre, v.monto, v.fecha_vencimiento, v.categoria, null, v.recurrente);
      return `✅ Pago "${v.nombre}" por ${fmt(v.monto)} programado para el ${v.fecha_vencimiento}.`;
    },
  },

  marcar_pago: {
    titulo: 'Marcar pago',
    campos: [
      {
        key: 'pago',
        label: 'Pago',
        tipo: 'opciones',
        prompt: '¿Cuál pago quieres marcar como pagado?',
        opciones: async (conn, usuario) =>
          (await listarPagos(conn, usuario.id, false)).map((p) => ({ text: `${p.nombre} (${fmt(p.monto)})`, value: p.id })),
      },
      {
        key: 'cuenta',
        label: 'Cuenta',
        tipo: 'opciones',
        prompt: '¿Desde qué cuenta se pagó?',
        opciones: async (conn, usuario) => (await cuentasConSaldo(conn, usuario.id)).map((c) => ({ text: c.nombre, value: c.id })),
      },
    ],
    resumen: async (conn, usuario, v) =>
      `✅ Marcar pago\nPago: ${await nombrePago(conn, usuario.id, v.pago)}\nCuenta: ${await nombreCuenta(conn, usuario.id, v.cuenta)}`,
    guardar: async (conn, usuario, v) => {
      const r = await marcarPagado(conn, usuario.id, v.pago, v.cuenta);
      return r ? `✅ Pago "${r.nombre}" marcado como pagado (${fmt(r.monto)}).` : 'No encontré ese pago.';
    },
  },
};

// Precondiciones: algunos flujos necesitan que exista al menos un
// registro relacionado antes de poder arrancar (ej. no puedes registrar
// un gasto si no tienes ninguna cuenta creada).
const PRECONDICIONES = {
  gasto: { verificar: (conn, usuario) => cuentasConSaldo(conn, usuario.id), mensaje: 'Primero crea una cuenta con "➕ Nueva cuenta".' },
  ingreso: { verificar: (conn, usuario) => cuentasConSaldo(conn, usuario.id), mensaje: 'Primero crea una cuenta con "➕ Nueva cuenta".' },
  abono_deuda: {
    verificar: async (conn, usuario) => (await listarDeudas(conn, usuario.id)).filter((d) => !d.saldada),
    mensaje: 'No tienes deudas pendientes por abonar.',
  },
  aportar_meta: {
    verificar: async (conn, usuario) => (await listarMetas(conn, usuario.id, true)).filter((m) => !m.completada),
    mensaje: 'No tienes metas activas. Crea una con "➕ Nueva meta".',
  },
  marcar_pago: {
    verificar: (conn, usuario) => listarPagos(conn, usuario.id, false),
    mensaje: 'No tienes pagos pendientes.',
  },
};

async function iniciarFlujo(conn, chatId, usuario, flujoId) {
  const precondicion = PRECONDICIONES[flujoId];
  if (precondicion) {
    const lista = await precondicion.verificar(conn, usuario);
    if (!lista || lista.length === 0) {
      await enviarConMenu(chatId, precondicion.mensaje);
      return;
    }
  }
  await avanzar(conn, chatId, usuario, flujoId, {});
}

async function avanzar(conn, chatId, usuario, flujoId, valores) {
  const flujo = FLUJOS[flujoId];
  const siguiente = flujo.campos.find((c) => !(c.key in valores));
  if (!siguiente) {
    await mostrarResumen(conn, chatId, usuario, flujoId, valores);
  } else {
    await pedirCampo(conn, chatId, usuario, flujoId, siguiente, valores);
  }
}

async function pedirCampo(conn, chatId, usuario, flujoId, campo, valores) {
  if (campo.tipo === 'opciones') {
    const opciones = await campo.opciones(conn, usuario, valores);
    if (opciones.length === 0) {
      if (campo.opcional) {
        await manejarValorCampo(conn, chatId, usuario, flujoId, campo.key, null);
        return;
      }
      await limpiarEstado(conn, usuario.id);
      await enviarConMenu(chatId, 'No hay nada disponible para elegir aquí todavía.');
      return;
    }
    await setEstado(conn, usuario.id, `wiz:${flujoId}:${campo.key}`, { valores });
    const filas = opciones.map((o) => [{ text: o.text, callback_data: `wc:${flujoId}:${campo.key}:${o.value}` }]);
    if (campo.opcional) filas.push([{ text: '⏭️ Omitir', callback_data: `skip:${flujoId}:${campo.key}` }]);
    filas.push([{ text: '❌ Cancelar', callback_data: 'cancelar' }]);
    await enviar(chatId, campo.prompt, { inline_keyboard: filas });
  } else {
    await setEstado(conn, usuario.id, `wiz:${flujoId}:${campo.key}`, { valores });
    await enviar(chatId, campo.prompt, campo.opcional ? botonSaltarCancelar(flujoId, campo.key) : BOTON_CANCELAR);
  }
}

async function manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, valor) {
  const { datos } = await obtenerEstado(conn, usuario.id);
  const valores = { ...(datos.valores || {}), [campoKey]: valor };
  if (datos.editando) {
    await mostrarResumen(conn, chatId, usuario, flujoId, valores);
  } else {
    await avanzar(conn, chatId, usuario, flujoId, valores);
  }
}

async function mostrarResumen(conn, chatId, usuario, flujoId, valores) {
  const flujo = FLUJOS[flujoId];
  const texto = await flujo.resumen(conn, usuario, valores);
  await setEstado(conn, usuario.id, `wiz:${flujoId}:resumen`, { valores });
  await enviar(chatId, `${texto}\n\n¿Confirmas o quieres editar algo?`, {
    inline_keyboard: [
      [{ text: '✅ Confirmar', callback_data: 'wiz_confirmar' }],
      [{ text: '✏️ Editar', callback_data: 'wiz_editar' }],
      [{ text: '❌ Cancelar', callback_data: 'cancelar' }],
    ],
  });
}

// ---------- Handler principal ----------

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(200, { ok: true });
  }

  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(200, { ok: true });
  }

  const conn = getConnection();

  // --- Botón tocado (callback_query) ---
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const data = cq.data;

    if (data === 'ya_tengo_cuenta') {
      // responderCallback (ack visual del botón) y enviar el mensaje no
      // dependen uno del otro: se disparan en paralelo en vez de en serie.
      await Promise.all([
        responderCallback(cq.id),
        enviar(
          chatId,
          '🔑 Perfecto. Entra a la web → menú Telegram → genera un código, y mándamelo aquí ' +
            '(solo el código, sin nada más).'
        ),
      ]);
      return jsonResponse(200, { ok: true });
    }

    // Igual aquí: el ack del botón y la consulta del usuario en la base de
    // datos no dependen entre sí, así que van en paralelo (Promise.all)
    // en vez de uno tras otro — recorta uno de los dos viajes de red.
    const [, usuario] = await Promise.all([
      responderCallback(cq.id),
      usuarioPorChat(conn, chatId),
    ]);
    if (!usuario) {
      await enviar(chatId, 'Todavía no vinculaste este chat. Genera un código en la web (menú Telegram) y mándamelo aquí.');
      return jsonResponse(200, { ok: true });
    }

    if (data === 'menu') {
      await limpiarEstado(conn, usuario.id);
      await enviarMenu(chatId);
    } else if (SUBMENUS[data]) {
      const sub = SUBMENUS[data];
      await enviar(chatId, sub.titulo, { inline_keyboard: sub.botones });
    } else if (data === 'cancelar') {
      await limpiarEstado(conn, usuario.id);
      await enviarMenu(chatId, 'Cancelado. ¿Algo más?');
    } else if (data === 'ayuda') {
      await enviarConMenu(chatId, TEXTO_AYUDA);
    } else if (data === 'saldo') {
      await enviarConMenu(chatId, await textoSaldo(conn, usuario));
    } else if (data === 'movimientos') {
      await enviarConMenu(chatId, await textoMovimientos(conn, usuario, 5));
    } else if (data === 'cuentas') {
      await enviarConMenu(chatId, await textoCuentas(conn, usuario));
    } else if (data === 'deudas') {
      await enviarConMenu(chatId, await textoDeudas(conn, usuario));
    } else if (data === 'categorias') {
      await enviarConMenu(chatId, await textoCategorias(conn, usuario));
    } else if (data === 'metas') {
      await enviarConMenu(chatId, await textoMetas(conn, usuario));
    } else if (data === 'pagos') {
      await enviarConMenu(chatId, await textoPagos(conn, usuario));
    } else if (FLUJOS[data]) {
      // Botón del menú principal que arranca un formulario
      await iniciarFlujo(conn, chatId, usuario, data);
    } else if (data.startsWith('wc:')) {
      // Respuesta con botón a un campo tipo 'opciones'
      const [, flujoId, campoKey, rawValue] = data.split(':');
      const valor = /^-?\d+$/.test(rawValue) ? parseInt(rawValue, 10) : rawValue;
      await manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, valor);
    } else if (data.startsWith('skip:')) {
      const [, flujoId, campoKey] = data.split(':');
      await manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, null);
    } else if (data === 'wiz_confirmar') {
      const { estado, datos } = await obtenerEstado(conn, usuario.id);
      const m = /^wiz:(.+):resumen$/.exec(estado || '');
      let mensaje;
      if (!m) {
        mensaje = 'No hay nada pendiente por confirmar.';
      } else {
        const flujoId = m[1];
        mensaje = await FLUJOS[flujoId].guardar(conn, usuario, datos.valores);
        await limpiarEstado(conn, usuario.id);
      }
      await enviarConMenu(chatId, mensaje);
    } else if (data === 'wiz_editar') {
      const { estado, datos } = await obtenerEstado(conn, usuario.id);
      const m = /^wiz:(.+):resumen$/.exec(estado || '');
      if (!m) {
        await enviarMenu(chatId);
      } else {
        const flujoId = m[1];
        const flujo = FLUJOS[flujoId];
        await setEstado(conn, usuario.id, `wiz:${flujoId}:elegir_campo`, { valores: datos.valores });
        await enviar(chatId, '¿Qué dato quieres cambiar?', {
          inline_keyboard: flujo.campos
            .map((c) => [{ text: c.label, callback_data: `we:${flujoId}:${c.key}` }])
            .concat([[{ text: '⬅️ Volver al resumen', callback_data: 'wiz_volver' }]]),
        });
      }
    } else if (data === 'wiz_volver') {
      const { estado, datos } = await obtenerEstado(conn, usuario.id);
      const m = /^wiz:(.+):elegir_campo$/.exec(estado || '');
      if (m) {
        await mostrarResumen(conn, chatId, usuario, m[1], datos.valores);
      } else {
        await enviarMenu(chatId);
      }
    } else if (data.startsWith('we:')) {
      // Eligió qué campo editar
      const [, flujoId, campoKey] = data.split(':');
      const { datos } = await obtenerEstado(conn, usuario.id);
      const campo = FLUJOS[flujoId].campos.find((c) => c.key === campoKey);
      await setEstado(conn, usuario.id, `wiz:${flujoId}:${campoKey}`, { valores: datos.valores, editando: true });
      // Reutiliza pedirCampo pero preservando el flag "editando" que acabamos de guardar
      if (campo.tipo === 'opciones') {
        const opciones = await campo.opciones(conn, usuario, datos.valores);
        const filas = opciones.map((o) => [{ text: o.text, callback_data: `wc:${flujoId}:${campo.key}:${o.value}` }]);
        filas.push([{ text: '❌ Cancelar', callback_data: 'cancelar' }]);
        await enviar(chatId, campo.prompt, { inline_keyboard: filas });
      } else {
        await enviar(chatId, campo.prompt, BOTON_CANCELAR);
      }
    } else if (data === 'crear_cuenta_desde_menu_deudas') {
      // (sin uso; reservado)
    } else if (data === 'desvincular') {
      await enviar(chatId, '¿Seguro que quieres desvincular este chat de tu cuenta?', {
        inline_keyboard: [[
          { text: '✅ Sí, desvincular', callback_data: 'confirmar_desvincular' },
          { text: '❌ No', callback_data: 'cancelar' },
        ]],
      });
    } else if (data === 'confirmar_desvincular') {
      await conn.execute({
        sql: 'UPDATE telegram_vinculos SET chat_id=NULL, telegram_username=NULL, estado=NULL, estado_datos=NULL WHERE user_id=?',
        args: [usuario.id],
      });
      await enviar(chatId, 'Listo, desvinculé este chat. Genera un código nuevo en la web y mándamelo aquí cuando quieras volver a conectarlo.');
    }

    return jsonResponse(200, { ok: true });
  }

  // --- Mensaje de texto normal ---
  const mensaje = update.message;
  if (!mensaje || !mensaje.text) {
    return jsonResponse(200, { ok: true });
  }

  const chatId = mensaje.chat.id;
  const texto = mensaje.text.trim();
  const telegramUsername = mensaje.from ? mensaje.from.username : undefined;
  const usuario = await usuarioPorChat(conn, chatId);

  // /start y /vincular funcionan sin estar vinculado todavía
  if (texto.toLowerCase().startsWith('/start') || texto.toLowerCase().startsWith('/vincular')) {
    const partes = texto.split(/\s+/);
    const codigo = partes[1];
    if (usuario) {
      await enviarMenu(chatId, `¡Hola de nuevo, ${usuario.username}!`);
    } else if (codigo) {
      const userId = await vincularConCodigo(conn, codigo, chatId, telegramUsername);
      if (userId) {
        await enviarMenu(chatId, '✅ ¡Listo! Tu cuenta quedó vinculada.');
      } else {
        await enviar(chatId, 'Código inválido o expirado. Genera uno nuevo en la web (menú Telegram).');
      }
    } else {
      await enviar(chatId, TEXTO_BIENVENIDA, BOTON_BIENVENIDA);
    }
    return jsonResponse(200, { ok: true });
  }

  if (!usuario) {
    // Ya no hace falta escribir "/vincular CODIGO": si el chat todavía no
    // está vinculado, cualquier texto que mande (que no sea otro comando)
    // se prueba directamente como el código — así, tras tocar "Ya tengo
    // cuenta", el usuario solo pega el código y listo.
    if (!texto.startsWith('/')) {
      const userId = await vincularConCodigo(conn, texto, chatId, telegramUsername);
      if (userId) {
        await enviarMenu(chatId, '✅ ¡Listo! Tu cuenta quedó vinculada.');
        return jsonResponse(200, { ok: true });
      }
      await enviar(chatId, 'Ese código no es válido o ya expiró. Genera uno nuevo en la web (menú Telegram) y mándamelo de nuevo.');
      return jsonResponse(200, { ok: true });
    }
    await enviar(chatId, 'Todavía no vinculaste este chat. Genera un código en la web (menú Telegram) y mándamelo aquí.');
    return jsonResponse(200, { ok: true });
  }

  if (texto === '/ayuda' || texto === '/help') {
    await enviarConMenu(chatId, TEXTO_AYUDA);
    return jsonResponse(200, { ok: true });
  }
  if (texto === '/menu') {
    await limpiarEstado(conn, usuario.id);
    await enviarMenu(chatId);
    return jsonResponse(200, { ok: true });
  }
  if (texto === '/saldo') {
    await enviarConMenu(chatId, await textoSaldo(conn, usuario));
    return jsonResponse(200, { ok: true });
  }

  // ¿Estamos a mitad de un formulario (wizard) esperando texto para un campo?
  const { estado } = await obtenerEstado(conn, usuario.id);
  const partesEstado = (estado || '').split(':');
  const enFormulario = partesEstado[0] === 'wiz' && partesEstado.length === 3;
  const flujoActual = enFormulario ? FLUJOS[partesEstado[1]] : null;
  const campoActual = flujoActual ? flujoActual.campos.find((c) => c.key === partesEstado[2]) : null;

  if (campoActual) {
    const flujoId = partesEstado[1];
    const campoKey = partesEstado[2];
    if (campoActual.tipo === 'monto') {
      const monto = parseMonto(texto);
      if (monto === null) {
        await enviar(chatId, 'No entendí el monto. Escribe solo el número, ej: 20000', campoActual.opcional ? botonSaltarCancelar(flujoId, campoKey) : BOTON_CANCELAR);
      } else {
        await manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, monto);
      }
    } else if (campoActual.tipo === 'fecha') {
      const fecha = parseFecha(texto);
      if (fecha === null) {
        await enviar(chatId, 'Escribe la fecha como AAAA-MM-DD, ej: 2026-09-15', campoActual.opcional ? botonSaltarCancelar(flujoId, campoKey) : BOTON_CANCELAR);
      } else {
        await manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, fecha);
      }
    } else if (campoActual.tipo === 'texto') {
      await manejarValorCampo(conn, chatId, usuario, flujoId, campoKey, texto);
    } else {
      // campo tipo 'opciones' esperando botón, no texto
      await enviar(chatId, 'Usa los botones de arriba para responder esto 🙂');
    }
  } else if ((estado || '').includes(':resumen') || (estado || '').includes(':elegir_campo')) {
    await enviar(chatId, 'Usa los botones de arriba (Confirmar / Editar / Cancelar) 🙂');
  } else {
    // No hay conversación activa ni comando reconocido -> mostrar el menú
    await enviarMenu(chatId);
  }

  return jsonResponse(200, { ok: true });
};
