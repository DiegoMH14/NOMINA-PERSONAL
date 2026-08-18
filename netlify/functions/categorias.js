'use strict';
/**
 * categorias.js -> GET /api/categorias?tipo=gasto|ingreso, POST /api/categorias,
 * DELETE /api/categorias?id=N
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();
  const metodo = event.httpMethod;
  const qs = event.queryStringParameters || {};

  if (metodo === 'GET') {
    let rs;
    if (qs.tipo) {
      rs = await conn.execute({
        sql: 'SELECT id, nombre, tipo, color, icono FROM categorias WHERE user_id=? AND tipo=? ORDER BY nombre',
        args: [userId, qs.tipo],
      });
    } else {
      rs = await conn.execute({
        sql: 'SELECT id, nombre, tipo, color, icono FROM categorias WHERE user_id=? ORDER BY tipo, nombre',
        args: [userId],
      });
    }
    const categorias = rs.rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      tipo: r.tipo,
      color: r.color,
      icono: r.icono,
    }));
    return jsonResponse(200, { categorias });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const nombre = (data.nombre || '').trim();
    const tipo = data.tipo;
    const color = data.color || '#4FB0FF';
    const icono = data.icono || '💸';
    if (!nombre || (tipo !== 'gasto' && tipo !== 'ingreso')) {
      return jsonResponse(400, { error: "Nombre y tipo ('gasto' o 'ingreso') son obligatorios" });
    }
    const rs = await conn.execute({
      sql: 'INSERT INTO categorias (user_id, nombre, tipo, color, icono) VALUES (?,?,?,?,?)',
      args: [userId, nombre, tipo, color, icono],
    });
    return jsonResponse(201, { id: Number(rs.lastInsertRowid) });
  }

  if (metodo === 'DELETE') {
    const categoriaId = qs.id;
    if (!categoriaId) {
      return jsonResponse(400, { error: 'Falta el id de la categoría' });
    }
    await conn.execute({
      sql: 'DELETE FROM categorias WHERE id=? AND user_id=?',
      args: [categoriaId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
