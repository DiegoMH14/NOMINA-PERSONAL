'use strict';
/**
 * presupuestos.js -> GET /api/presupuestos?anio=&mes=, POST /api/presupuestos,
 * DELETE /api/presupuestos?id=N
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function rangoMes(anio, mes) {
  const inicio = `${anio}-${pad2(mes)}-01`;
  const fin = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${pad2(mes + 1)}-01`;
  return [inicio, fin];
}

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();
  const metodo = event.httpMethod;
  const qs = event.queryStringParameters || {};

  if (metodo === 'GET') {
    const hoy = new Date();
    const anio = parseInt(qs.anio || hoy.getFullYear(), 10);
    const mes = parseInt(qs.mes || hoy.getMonth() + 1, 10);
    const [inicio, fin] = rangoMes(anio, mes);

    const rs = await conn.execute({
      sql: `SELECT p.id, p.categoria_id, p.monto_limite, c.nombre, c.icono, c.color
            FROM presupuestos p JOIN categorias c ON c.id = p.categoria_id
            WHERE p.user_id=? ORDER BY c.nombre`,
      args: [userId],
    });

    const resultado = [];
    for (const row of rs.rows) {
      const pid = row.id;
      const categoriaId = row.categoria_id;
      const montoLimite = row.monto_limite;
      const { nombre, icono, color } = row;

      const gastadoRs = await conn.execute({
        sql: `SELECT COALESCE(SUM(monto),0) AS total FROM movimientos
              WHERE user_id=? AND categoria_id=? AND tipo='gasto' AND fecha>=? AND fecha<?`,
        args: [userId, categoriaId, inicio, fin],
      });
      const gastado = gastadoRs.rows[0].total;
      resultado.push({
        id: pid,
        categoria_id: categoriaId,
        monto_limite: montoLimite,
        categoria_nombre: nombre,
        categoria_icono: icono,
        categoria_color: color,
        gastado: Math.round(gastado * 100) / 100,
        restante: Math.round((montoLimite - gastado) * 100) / 100,
        porcentaje: montoLimite ? Math.round(Math.min(100, (gastado / montoLimite) * 100) * 10) / 10 : 0,
        excedido: gastado > montoLimite,
      });
    }
    return jsonResponse(200, { presupuestos: resultado });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const categoriaId = data.categoria_id;
    const montoLimite = data.monto_limite;
    if (!categoriaId || !montoLimite) {
      return jsonResponse(400, { error: 'categoria_id y monto_limite son obligatorios' });
    }
    await conn.execute({
      sql: `INSERT INTO presupuestos (user_id, categoria_id, monto_limite) VALUES (?,?,?)
            ON CONFLICT(user_id, categoria_id) DO UPDATE SET monto_limite=excluded.monto_limite`,
      args: [userId, categoriaId, montoLimite],
    });
    return jsonResponse(201, { ok: true });
  }

  if (metodo === 'DELETE') {
    const presupuestoId = qs.id;
    if (!presupuestoId) {
      return jsonResponse(400, { error: 'Falta el id del presupuesto' });
    }
    await conn.execute({
      sql: 'DELETE FROM presupuestos WHERE id=? AND user_id=?',
      args: [presupuestoId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
