'use strict';
/**
 * movimientos.js -> GET /api/movimientos?limite=&categoria_id=&cuenta_id=&tipo=&desde=&hasta=
 * POST /api/movimientos (crea, valida duplicado salvo forzar=true)
 * DELETE /api/movimientos?id=N
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
    let q = `
      SELECT m.id, m.tipo, m.monto, m.categoria_id, m.cuenta_id, m.fecha, m.descripcion,
             c.nombre AS categoria_nombre, c.icono AS categoria_icono, c.color AS categoria_color,
             cu.nombre AS cuenta_nombre
      FROM movimientos m
      LEFT JOIN categorias c ON c.id = m.categoria_id
      LEFT JOIN cuentas cu ON cu.id = m.cuenta_id
      WHERE m.user_id = ?
    `;
    const params = [userId];
    if (qs.categoria_id) {
      q += ' AND m.categoria_id=?';
      params.push(qs.categoria_id);
    }
    if (qs.cuenta_id) {
      q += ' AND m.cuenta_id=?';
      params.push(qs.cuenta_id);
    }
    if (qs.tipo) {
      q += ' AND m.tipo=?';
      params.push(qs.tipo);
    }
    if (qs.desde) {
      q += ' AND m.fecha >= ?';
      params.push(qs.desde);
    }
    if (qs.hasta) {
      q += ' AND m.fecha <= ?';
      params.push(qs.hasta);
    }
    q += ' ORDER BY m.fecha DESC, m.id DESC';
    if (qs.limite) {
      q += ' LIMIT ?';
      params.push(parseInt(qs.limite, 10));
    }

    const rs = await conn.execute({ sql: q, args: params });
    const movimientos = rs.rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      monto: r.monto,
      categoria_id: r.categoria_id,
      cuenta_id: r.cuenta_id,
      fecha: r.fecha,
      descripcion: r.descripcion,
      categoria_nombre: r.categoria_nombre,
      categoria_icono: r.categoria_icono,
      categoria_color: r.categoria_color,
      cuenta_nombre: r.cuenta_nombre,
    }));
    return jsonResponse(200, { movimientos });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const tipo = data.tipo;
    const monto = data.monto;
    const cuentaId = data.cuenta_id;
    const categoriaId = data.categoria_id ?? null;
    const fecha = data.fecha || hoyISO();
    const descripcion = (data.descripcion || '').trim() || null;
    const forzar = Boolean(data.forzar);

    if ((tipo !== 'gasto' && tipo !== 'ingreso') || !monto || !cuentaId) {
      return jsonResponse(400, { error: 'tipo, monto y cuenta_id son obligatorios' });
    }

    if (!forzar) {
      const dupRs = await conn.execute({
        sql: 'SELECT id FROM movimientos WHERE user_id=? AND cuenta_id=? AND monto=? AND fecha=? AND tipo=?',
        args: [userId, cuentaId, monto, fecha, tipo],
      });
      if (dupRs.rows.length > 0) {
        const montoFmt = Number(monto).toLocaleString('es-CO', { maximumFractionDigits: 0 });
        return jsonResponse(409, {
          error: `Ya existe un movimiento igual (${fecha}, $${montoFmt}) en esa cuenta.`,
          duplicado: true,
        });
      }
    }

    const rs = await conn.execute({
      sql: 'INSERT INTO movimientos (user_id, tipo, monto, categoria_id, cuenta_id, fecha, descripcion) VALUES (?,?,?,?,?,?,?)',
      args: [userId, tipo, monto, categoriaId, cuentaId, fecha, descripcion],
    });
    return jsonResponse(201, { id: Number(rs.lastInsertRowid) });
  }

  if (metodo === 'DELETE') {
    const movimientoId = qs.id;
    if (!movimientoId) {
      return jsonResponse(400, { error: 'Falta el id del movimiento' });
    }
    await conn.execute({
      sql: 'DELETE FROM movimientos WHERE id=? AND user_id=?',
      args: [movimientoId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
