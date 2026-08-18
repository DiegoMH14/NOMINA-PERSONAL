'use strict';
/**
 * pagos.js -> GET /api/pagos?incluir_pagados=1, POST /api/pagos,
 * POST /api/pagos?accion=marcar_pagado&id=N, DELETE /api/pagos?id=N
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function conEstado(rows) {
  const hoy = new Date(hoyISO() + 'T00:00:00Z');
  return rows.map((row) => {
    const p = { ...row };
    const venc = new Date(p.fecha_vencimiento + 'T00:00:00Z');
    const dias = Math.round((venc - hoy) / 86400000);
    p.dias_restantes = dias;
    if (p.pagado) {
      p.estado = 'pagado';
    } else if (dias < 0) {
      p.estado = 'vencido';
    } else if (dias <= 7) {
      p.estado = 'proximo';
    } else {
      p.estado = 'pendiente';
    }
    return p;
  });
}

function siguienteFecha(vencActual, recurrente) {
  const d = new Date(`${vencActual}T00:00:00Z`);
  if (recurrente === 'mensual') {
    const mesActual = d.getUTCMonth() + 1; // 1-12
    const mesNuevo = (mesActual % 12) + 1;
    const anioNuevo = d.getUTCFullYear() + (mesActual === 12 ? 1 : 0);
    const dia = Math.min(d.getUTCDate(), 28);
    return `${anioNuevo}-${String(mesNuevo).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  if (recurrente === 'semanal') {
    const nueva = new Date(d.getTime() + 7 * 86400000);
    return nueva.toISOString().slice(0, 10);
  }
  if (recurrente === 'anual') {
    const anioNuevo = d.getUTCFullYear() + 1;
    return `${anioNuevo}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();
  const metodo = event.httpMethod;
  const qs = event.queryStringParameters || {};

  if (metodo === 'GET') {
    let q = `SELECT id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id,
                     pagado, fecha_pago, recurrente FROM pagos_pendientes WHERE user_id=?`;
    const params = [userId];
    if (!qs.incluir_pagados) {
      q += ' AND pagado=0';
    }
    q += ' ORDER BY fecha_vencimiento ASC';
    const rs = await conn.execute({ sql: q, args: params });
    return jsonResponse(200, { pagos: conEstado(rs.rows.map((r) => ({ ...r }))) });
  }

  if (metodo === 'POST' && qs.accion === 'marcar_pagado') {
    const pagoId = qs.id;
    const data = parseBody(event);
    const fechaPago = data.fecha_pago || hoyISO();
    const cuentaOverride = data.cuenta_id;

    const pagoRs = await conn.execute({
      sql: `SELECT id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, recurrente
            FROM pagos_pendientes WHERE id=? AND user_id=?`,
      args: [pagoId, userId],
    });
    if (pagoRs.rows.length === 0) {
      return jsonResponse(404, { error: 'Pago no encontrado' });
    }
    const pago = pagoRs.rows[0];
    const cuentaFinal = cuentaOverride || pago.cuenta_id;
    if (!cuentaFinal) {
      return jsonResponse(400, { error: 'Debes indicar una cuenta desde la que se hizo el pago.' });
    }

    await conn.execute({
      sql: 'UPDATE pagos_pendientes SET pagado=1, fecha_pago=?, cuenta_id=? WHERE id=? AND user_id=?',
      args: [fechaPago, cuentaFinal, pagoId, userId],
    });
    await conn.execute({
      sql: `INSERT INTO movimientos (user_id, tipo, monto, categoria_id, cuenta_id, fecha, descripcion, pago_pendiente_id)
            VALUES (?, 'gasto', ?, ?, ?, ?, ?, ?)`,
      args: [userId, pago.monto, pago.categoria_id, cuentaFinal, fechaPago, `Pago: ${pago.nombre}`, pagoId],
    });

    if (pago.recurrente && pago.recurrente !== 'ninguna') {
      const nuevaFecha = siguienteFecha(pago.fecha_vencimiento, pago.recurrente);
      if (nuevaFecha) {
        await conn.execute({
          sql: `INSERT INTO pagos_pendientes (user_id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, recurrente)
                VALUES (?,?,?,?,?,?,?)`,
          args: [userId, pago.nombre, pago.monto, nuevaFecha, pago.categoria_id, pago.cuenta_id, pago.recurrente],
        });
      }
    }

    return jsonResponse(200, { ok: true });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const nombre = (data.nombre || '').trim();
    const monto = data.monto;
    const fechaVencimiento = data.fecha_vencimiento;
    const categoriaId = data.categoria_id ?? null;
    const cuentaId = data.cuenta_id ?? null;
    const recurrente = data.recurrente || 'ninguna';

    if (!nombre || !monto || !fechaVencimiento) {
      return jsonResponse(400, { error: 'nombre, monto y fecha_vencimiento son obligatorios' });
    }

    const rs = await conn.execute({
      sql: `INSERT INTO pagos_pendientes (user_id, nombre, monto, fecha_vencimiento, categoria_id, cuenta_id, recurrente)
            VALUES (?,?,?,?,?,?,?)`,
      args: [userId, nombre, monto, fechaVencimiento, categoriaId, cuentaId, recurrente],
    });
    return jsonResponse(201, { id: Number(rs.lastInsertRowid) });
  }

  if (metodo === 'DELETE') {
    const pagoId = qs.id;
    if (!pagoId) {
      return jsonResponse(400, { error: 'Falta el id del pago' });
    }
    await conn.execute({
      sql: 'DELETE FROM pagos_pendientes WHERE id=? AND user_id=?',
      args: [pagoId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
