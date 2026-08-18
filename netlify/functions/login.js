'use strict';
/**
 * login.js -> POST /api/login
 * Body esperado: {"username": "...", "password": "..."}
 *
 * Reemplaza la ruta @app.route("/login") de Flask. La diferencia grande:
 * en vez de guardar `session["user_id"] = usuario.id` y redirigir, aquí
 * se devuelve un TOKEN en el JSON de respuesta. El frontend (JS) lo debe
 * guardar en localStorage y mandarlo en cada petición siguiente.
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { generarToken } = require('./_auth');
const bcrypt = require('bcryptjs');

const MAX_INTENTOS_LOGIN = 5;
const MINUTOS_BLOQUEO = 15;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método no permitido' });
  }

  const data = parseBody(event);
  const username = (data.username || '').trim();
  const password = data.password || '';

  if (!username || !password) {
    return jsonResponse(400, { error: 'Usuario y contraseña son obligatorios' });
  }

  const conn = getConnection();
  const rs = await conn.execute({
    sql: 'SELECT id, username, password_hash, failed_attempts, locked_until FROM usuarios WHERE username=?',
    args: [username],
  });

  if (rs.rows.length === 0) {
    return jsonResponse(401, { error: 'Usuario o contraseña incorrectos' });
  }

  const row = rs.rows[0];
  const userId = row.id;
  const dbUsername = row.username;
  const passwordHash = row.password_hash;
  const failedAttempts = row.failed_attempts;
  const lockedUntil = row.locked_until;

  const ahora = new Date();
  if (lockedUntil) {
    const bloqueadoHasta = new Date(lockedUntil);
    if (ahora < bloqueadoHasta) {
      const minutosRestantes = Math.max(1, Math.floor((bloqueadoHasta - ahora) / 60000) + 1);
      return jsonResponse(423, { error: `Cuenta bloqueada. Intenta de nuevo en ${minutosRestantes} min.` });
    }
  }

  const passwordOk = bcrypt.compareSync(password, passwordHash);
  if (passwordOk) {
    await conn.execute({
      sql: 'UPDATE usuarios SET failed_attempts=0, locked_until=NULL WHERE id=?',
      args: [userId],
    });
    const token = generarToken(userId, dbUsername);
    return jsonResponse(200, { token, username: dbUsername, user_id: userId });
  }

  const intentos = failedAttempts + 1;
  if (intentos >= MAX_INTENTOS_LOGIN) {
    const bloqueo = new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60000).toISOString();
    await conn.execute({
      sql: 'UPDATE usuarios SET failed_attempts=0, locked_until=? WHERE id=?',
      args: [bloqueo, userId],
    });
    return jsonResponse(423, { error: `Demasiados intentos. Bloqueado ${MINUTOS_BLOQUEO} min.` });
  }

  await conn.execute({
    sql: 'UPDATE usuarios SET failed_attempts=? WHERE id=?',
    args: [intentos, userId],
  });
  return jsonResponse(401, { error: 'Usuario o contraseña incorrectos' });
};
