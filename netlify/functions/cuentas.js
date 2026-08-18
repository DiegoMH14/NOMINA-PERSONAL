'use strict';
/**
 * cuentas.js -> GET /api/cuentas (listar), POST /api/cuentas (crear)
 *
 * Este archivo es el PATRÓN que siguen el resto de módulos
 * (categorias.js, presupuestos.js, metas.js, pagos.js...): mismo formato
 * de autenticación por token, mismo estilo de SELECT explícito.
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

async function calcularSaldo(conn, userId, cuentaId, saldoInicial) {
  const ingresosRs = await conn.execute({
    sql: "SELECT COALESCE(SUM(monto),0) AS total FROM movimientos WHERE user_id=? AND cuenta_id=? AND tipo='ingreso'",
    args: [userId, cuentaId],
  });
  const gastosRs = await conn.execute({
    sql: "SELECT COALESCE(SUM(monto),0) AS total FROM movimientos WHERE user_id=? AND cuenta_id=? AND tipo='gasto'",
    args: [userId, cuentaId],
  });
  const ingresos = ingresosRs.rows[0].total;
  const gastos = gastosRs.rows[0].total;
  return Math.round((saldoInicial + ingresos - gastos) * 100) / 100;
}

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();

  if (event.httpMethod === 'GET') {
    const rs = await conn.execute({
      sql: 'SELECT id, nombre, tipo, saldo_inicial, color, activa FROM cuentas WHERE user_id=? AND activa=1 ORDER BY nombre',
      args: [userId],
    });
    const cuentas = [];
    for (const row of rs.rows) {
      const c = {
        id: row.id,
        nombre: row.nombre,
        tipo: row.tipo,
        saldo_inicial: row.saldo_inicial,
        color: row.color,
        activa: row.activa,
      };
      c.saldo_actual = await calcularSaldo(conn, userId, c.id, c.saldo_inicial);
      cuentas.push(c);
    }
    return jsonResponse(200, { cuentas });
  }

  if (event.httpMethod === 'POST') {
    const data = parseBody(event);
    const nombre = (data.nombre || '').trim();
    const tipo = data.tipo || 'otro';
    const saldoInicial = parseFloat(data.saldo_inicial || 0);
    const color = data.color || '#1D9E75';

    if (!nombre) {
      return jsonResponse(400, { error: 'El nombre de la cuenta es obligatorio' });
    }

    const rs = await conn.execute({
      sql: 'INSERT INTO cuentas (user_id, nombre, tipo, saldo_inicial, color) VALUES (?,?,?,?,?)',
      args: [userId, nombre, tipo, saldoInicial, color],
    });
    return jsonResponse(201, { id: Number(rs.lastInsertRowid), nombre });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
