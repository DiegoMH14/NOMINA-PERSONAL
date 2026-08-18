'use strict';
/**
 * registro.js -> POST /api/registro
 * Body: {"username": "...", "password": "..."}
 * Reemplaza /registro de Flask + sembrar_datos_iniciales().
 */

const { getConnection } = require('./_db');
const { jsonResponse, parseBody } = require('./_http');
const { generarToken } = require('./_auth');
const bcrypt = require('bcryptjs');

const CUENTAS_BASE = [
  ['Efectivo', 'efectivo', 0, '#E8B84B'],
  ['Nu', 'banco', 0, '#8A05BE'],
  ['Ualá', 'banco', 0, '#FF5A5F'],
];

const CATEGORIAS_BASE = [
  ['Comida', 'gasto', '#F2994A', '🍔'],
  ['Transporte', 'gasto', '#2F80ED', '🚗'],
  ['Servicios', 'gasto', '#EB5757', '🧾'],
  ['Arriendo', 'gasto', '#9B51E0', '🏠'],
  ['Entretenimiento', 'gasto', '#56CCF2', '🎮'],
  ['Salud', 'gasto', '#27AE60', '💊'],
  ['Otros gastos', 'gasto', '#828282', '📦'],
  ['Salario', 'ingreso', '#1D9E75', '💼'],
  ['Freelance', 'ingreso', '#04342C', '🧑‍💻'],
  ['Otros ingresos', 'ingreso', '#6FCF97', '➕'],
];

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
  if (password.length < 6) {
    return jsonResponse(400, { error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const conn = getConnection();
  const existe = await conn.execute({
    sql: 'SELECT id FROM usuarios WHERE username=?',
    args: [username],
  });
  if (existe.rows.length > 0) {
    return jsonResponse(409, { error: 'Ese usuario ya existe' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const insertUsuario = await conn.execute({
    sql: 'INSERT INTO usuarios (username, password_hash) VALUES (?,?)',
    args: [username, passwordHash],
  });
  const userId = Number(insertUsuario.lastInsertRowid);

  for (const [nombre, tipo, saldoInicial, color] of CUENTAS_BASE) {
    await conn.execute({
      sql: 'INSERT INTO cuentas (user_id, nombre, tipo, saldo_inicial, color) VALUES (?,?,?,?,?)',
      args: [userId, nombre, tipo, saldoInicial, color],
    });
  }
  for (const [nombre, tipo, color, icono] of CATEGORIAS_BASE) {
    await conn.execute({
      sql: 'INSERT INTO categorias (user_id, nombre, tipo, color, icono) VALUES (?,?,?,?,?)',
      args: [userId, nombre, tipo, color, icono],
    });
  }

  const token = generarToken(userId, username);
  return jsonResponse(201, { token, username, user_id: userId });
};
