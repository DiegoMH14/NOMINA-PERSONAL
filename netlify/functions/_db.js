'use strict';
/**
 * _db.js
 * Conexión a la base de datos en Turso (libSQL) usando el cliente
 * oficial de Node: @libsql/client. Cada función serverless abre su
 * propia conexión por invocación (igual que se hacía antes en Python).
 *
 * Variables de entorno requeridas (Netlify -> Site settings ->
 * Environment variables):
 *
 *   TURSO_DATABASE_URL   ej: libsql://nomina-personal-tuusuario.turso.io
 *   TURSO_AUTH_TOKEN     el token que da `turso db tokens create nomina-personal`
 *
 * Uso:
 *   const { getConnection } = require('./_db');
 *   const conn = getConnection();
 *   const rs = await conn.execute({ sql: 'SELECT * FROM cuentas WHERE user_id=?', args: [userId] });
 *   rs.rows // array de filas; cada fila se puede leer por nombre de columna, ej. row.nombre
 */

const { createClient } = require('@libsql/client');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

function getConnection() {
  if (!TURSO_URL || !TURSO_TOKEN) {
    throw new Error(
      'Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en las variables de entorno de Netlify.'
    );
  }
  return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
}

module.exports = { getConnection };
