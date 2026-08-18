'use strict';
/**
 * metas.js -> GET /api/metas, POST /api/metas, POST /api/metas?accion=aportar&id=N,
 * DELETE /api/metas?id=N
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
    const rs = await conn.execute({
      sql: `SELECT id, nombre, monto_objetivo, monto_actual, fecha_inicio, fecha_objetivo
            FROM metas_ahorro WHERE user_id=? AND activa=1 ORDER BY fecha_objetivo`,
      args: [userId],
    });
    const hoy = new Date(hoyISO() + 'T00:00:00Z');
    const metas = rs.rows.map((row) => {
      const mid = row.id;
      const nombre = row.nombre;
      const objetivo = row.monto_objetivo;
      const actual = row.monto_actual;
      const fInicio = row.fecha_inicio;
      const fObjetivo = row.fecha_objetivo;

      const falta = Math.round(Math.max(0, objetivo - actual) * 100) / 100;
      const fechaObj = new Date(fObjetivo + 'T00:00:00Z');
      const diasRestantes = Math.round((fechaObj - hoy) / 86400000);
      const completada = actual >= objetivo;
      let semanal;
      let mensual;
      if (completada || diasRestantes <= 0) {
        semanal = completada ? 0 : falta;
        mensual = completada ? 0 : falta;
      } else {
        semanal = Math.round((falta / Math.max(1, diasRestantes / 7)) * 100) / 100;
        mensual = Math.round((falta / Math.max(1, diasRestantes / 30.44)) * 100) / 100;
      }
      return {
        id: mid,
        nombre,
        monto_objetivo: objetivo,
        monto_actual: actual,
        fecha_inicio: fInicio,
        fecha_objetivo: fObjetivo,
        falta,
        dias_restantes: diasRestantes,
        progreso_pct: objetivo ? Math.round(Math.min(100, (actual / objetivo) * 100) * 10) / 10 : 0,
        completada,
        ahorro_semanal_necesario: semanal,
        ahorro_mensual_necesario: mensual,
      };
    });
    return jsonResponse(200, { metas });
  }

  if (metodo === 'POST' && qs.accion === 'aportar') {
    const metaId = qs.id;
    const data = parseBody(event);
    const monto = data.monto;
    if (!metaId || !monto) {
      return jsonResponse(400, { error: 'Falta el id de la meta o el monto' });
    }
    await conn.execute({
      sql: 'UPDATE metas_ahorro SET monto_actual = monto_actual + ? WHERE id=? AND user_id=?',
      args: [monto, metaId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  if (metodo === 'POST') {
    const data = parseBody(event);
    const nombre = (data.nombre || '').trim();
    const montoObjetivo = data.monto_objetivo;
    const fechaObjetivo = data.fecha_objetivo;
    const montoActual = data.monto_actual || 0;
    if (!nombre || !montoObjetivo || !fechaObjetivo) {
      return jsonResponse(400, { error: 'nombre, monto_objetivo y fecha_objetivo son obligatorios' });
    }
    await conn.execute({
      sql: `INSERT INTO metas_ahorro (user_id, nombre, monto_objetivo, monto_actual, fecha_inicio, fecha_objetivo)
            VALUES (?,?,?,?,?,?)`,
      args: [userId, nombre, montoObjetivo, montoActual, hoyISO(), fechaObjetivo],
    });
    return jsonResponse(201, { ok: true });
  }

  if (metodo === 'DELETE') {
    const metaId = qs.id;
    if (!metaId) {
      return jsonResponse(400, { error: 'Falta el id de la meta' });
    }
    await conn.execute({
      sql: 'DELETE FROM metas_ahorro WHERE id=? AND user_id=?',
      args: [metaId, userId],
    });
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: 'Método no permitido' });
};
