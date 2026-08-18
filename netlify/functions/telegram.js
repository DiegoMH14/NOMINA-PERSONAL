'use strict';
/**
 * telegram.js -> GET /api/telegram (estado actual), POST /api/telegram (genera código nuevo),
 * DELETE /api/telegram (desvincula)
 */

const crypto = require('crypto');
const { getConnection } = require('./_db');
const { jsonResponse } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');

const MINUTOS_VALIDEZ_CODIGO = 10;

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  const userId = usuario.user_id;
  const conn = getConnection();
  const metodo = event.httpMethod;

  if (metodo === 'GET') {
    const rs = await conn.execute({
      sql: `SELECT chat_id, telegram_username, codigo, codigo_expira, vinculado_en
            FROM telegram_vinculos WHERE user_id=?`,
      args: [userId],
    });
    if (rs.rows.length === 0) {
      return jsonResponse(200, { vinculado: false });
    }
    const row = rs.rows[0];
    const vigente = Boolean(row.codigo_expira && new Date() < new Date(row.codigo_expira));
    return jsonResponse(200, {
      vinculado: Boolean(row.chat_id),
      telegram_username: row.telegram_username,
      vinculado_en: row.vinculado_en,
      codigo: vigente ? row.codigo : null,
      codigo_expira: vigente ? row.codigo_expira : null,
    });
  }

  if (metodo === 'POST') {
    const codigo = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expira = new Date(Date.now() + MINUTOS_VALIDEZ_CODIGO * 60000).toISOString();
    await conn.execute({
      sql: `INSERT INTO telegram_vinculos (user_id, codigo, codigo_expira) VALUES (?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET codigo=excluded.codigo, codigo_expira=excluded.codigo_expira`,
      args: [userId, codigo, expira],
    });
    return jsonResponse(201, { codigo, expira, valido_minutos: MINUTOS_VALIDEZ_CODIGO });
  }

  if (metodo === 'DELETE') {
    await conn.execute({
      sql: 'UPDATE telegram_vinculos SET chat_id=NULL, telegram_username=NULL WHERE user_id=?',
      args: [userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
