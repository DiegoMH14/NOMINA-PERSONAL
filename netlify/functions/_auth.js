'use strict';
/**
 * _auth.js
 * Reemplazo de `session["user_id"]` de Flask. Como las Netlify Functions
 * no mantienen un servidor con estado, el login no puede depender de una
 * sesión guardada en el servidor: en vez de eso, al hacer login se genera
 * un TOKEN (JWT) que el navegador guarda (en localStorage) y manda en cada
 * petición siguiente dentro del header `Authorization: Bearer <token>`.
 *
 * El servidor no "recuerda" nada entre peticiones -> lee el token, lo
 * valida, y de ahí saca el user_id. Es sin estado, por eso funciona bien
 * en serverless.
 */

const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.SECRET_KEY || 'cambia-esto-en-netlify-env-vars';
const EXPIRA_SEGUNDOS = 60 * 60 * 24 * 30; // 30 días, como una sesión "recuérdame"

function generarToken(userId, username) {
  return jwt.sign({ user_id: userId, username }, SECRET_KEY, {
    algorithm: 'HS256',
    expiresIn: EXPIRA_SEGUNDOS,
  });
}

function usuarioDesdeEvento(event) {
  const headers = event.headers || {};
  // Netlify normaliza headers a minúscula
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] });
    return { user_id: payload.user_id, username: payload.username };
  } catch (e) {
    return null;
  }
}

function respuestaNoAutorizado() {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'No autenticado. Inicia sesión de nuevo.' }),
  };
}

module.exports = { generarToken, usuarioDesdeEvento, respuestaNoAutorizado };
