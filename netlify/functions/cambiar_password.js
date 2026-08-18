'use strict';
/**
 * cambiar_password.js -> POST /api/cambiar_password
 * Body: {"password_actual": "...", "nueva_password": "..."}
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { usuarioDesdeEvento, respuestaNoAutorizado } = require('./_auth');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  const usuario = usuarioDesdeEvento(event);
  if (!usuario) return respuestaNoAutorizado();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método no permitido' });
  }

  const data = parseBody(event);
  const passwordActual = data.password_actual || '';
  const nuevaPassword = data.nueva_password || '';

  if (nuevaPassword.length < 6) {
    return jsonResponse(400, { error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const conn = getConnection();
  const rs = await conn.execute({
    sql: 'SELECT password_hash FROM usuarios WHERE id=?',
    args: [usuario.user_id],
  });
  const row = rs.rows[0];
  if (!row || !bcrypt.compareSync(passwordActual, row.password_hash)) {
    return jsonResponse(401, { error: 'La contraseña actual no es correcta' });
  }

  await conn.execute({
    sql: 'UPDATE usuarios SET password_hash=? WHERE id=?',
    args: [bcrypt.hashSync(nuevaPassword, 10), usuario.user_id],
  });
  return jsonResponse(200, { ok: true });
};
