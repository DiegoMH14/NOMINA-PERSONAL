'use strict';
/**
 * deudas.js -> GET /api/deudas, POST /api/deudas, POST /api/deudas?accion=abonar&id=N,
 * DELETE /api/deudas?id=N
 *
 * Sigue el mismo patrón que metas.js: una deuda tiene un monto_total y un
 * monto_pagado que va subiendo con abonos, hasta llegar (o superar) el total.
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();
  const metodo = event.httpMethod;
  const qs = event.queryStringParameters || {};

  if (metodo === 'GET') {
    const rs = await conn.execute({
      sql: `SELECT id, nombre, monto_total, monto_pagado, fecha_inicio, fecha_limite, tasa_interes
            FROM deudas WHERE user_id=? AND activa=1 ORDER BY fecha_limite IS NULL, fecha_limite`,
      args: [userId],
    });
    const deudas = rs.rows.map((row) => {
      const total = row.monto_total;
      const pagado = row.monto_pagado;
      const falta = Math.round(Math.max(0, total - pagado) * 100) / 100;
      const saldada = pagado >= total;
      return {
        id: row.id,
        nombre: row.nombre,
        monto_total: total,
        monto_pagado: pagado,
        fecha_inicio: row.fecha_inicio,
        fecha_limite: row.fecha_limite,
        tasa_interes: row.tasa_interes,
        falta,
        progreso_pct: total ? Math.round(Math.min(100, (pagado / total) * 100) * 10) / 10 : 0,
        saldada,
      };
    });
    return jsonResponse(200, { deudas });
  }

  if (metodo === 'POST' && qs.accion === 'abonar') {
    const deudaId = qs.id;
    const data = parseBody(event);
    const monto = data.monto;
    if (!deudaId || !monto) {
      return jsonResponse(400, { error: 'Falta el id de la deuda o el monto' });
    }
    await conn.execute({
      sql: 'UPDATE deudas SET monto_pagado = monto_pagado + ? WHERE id=? AND user_id=?',
      args: [monto, deudaId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const nombre = (data.nombre || '').trim();
    const montoTotal = data.monto_total;
    const montoPagado = data.monto_pagado || 0;
    const fechaLimite = data.fecha_limite || null;
    const tasaInteres = data.tasa_interes || null;
    if (!nombre || !montoTotal) {
      return jsonResponse(400, { error: 'nombre y monto_total son obligatorios' });
    }
    const rs = await conn.execute({
      sql: `INSERT INTO deudas (user_id, nombre, monto_total, monto_pagado, fecha_inicio, fecha_limite, tasa_interes)
            VALUES (?,?,?,?,?,?,?)`,
      args: [userId, nombre, montoTotal, montoPagado, hoyISO(), fechaLimite, tasaInteres],
    });
    return jsonResponse(201, { id: Number(rs.lastInsertRowid), nombre });
  }

  if (metodo === 'DELETE') {
    const deudaId = qs.id;
    if (!deudaId) {
      return jsonResponse(400, { error: 'Falta el id de la deuda' });
    }
    await conn.execute({
      sql: 'DELETE FROM deudas WHERE id=? AND user_id=?',
      args: [deudaId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
