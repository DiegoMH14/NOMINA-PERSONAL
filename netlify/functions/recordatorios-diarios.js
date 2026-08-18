'use strict';
/**
 * recordatorios-diarios.js
 * Reemplaza application.job_queue.run_daily(...) del bot original. Netlify
 * la ejecuta sola todos los días a la hora definida en netlify.toml
 * ([[scheduled.functions]], cron "0 13 * * *" = 8am Colombia), sin que
 * nada tenga que estar prendido esperando.
 *
 * Mismo criterio que el banner de alertas del dashboard: pagos vencidos
 * o que vencen en <= 7 días.
 */

const { getConnection } = require('./_db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TOKEN}`;

function fmt(monto) {
  return `$${Math.round(monto).toLocaleString('en-US')}`.replace(/,/g, '.');
}

async function enviar(chatId, texto) {
  try {
    await fetch(`${API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
    });
  } catch (e) {
    // chat bloqueado / bot removido — se ignora y sigue con los demás
  }
}

exports.handler = async () => {
  const conn = getConnection();
  const vinculosRs = await conn.execute({
    sql: 'SELECT user_id, chat_id FROM telegram_vinculos WHERE chat_id IS NOT NULL',
    args: [],
  });

  const hoy = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  for (const vinculo of vinculosRs.rows) {
    const userId = vinculo.user_id;
    const chatId = vinculo.chat_id;

    const pagosRs = await conn.execute({
      sql: `SELECT nombre, monto, fecha_vencimiento FROM pagos_pendientes
            WHERE user_id=? AND pagado=0`,
      args: [userId],
    });

    const alertas = [];
    for (const pago of pagosRs.rows) {
      const venc = new Date(`${pago.fecha_vencimiento}T00:00:00Z`);
      const dias = Math.round((venc - hoy) / 86400000);
      if (dias < 0) {
        alertas.push(`• ${pago.nombre} — ${fmt(pago.monto)} — vencido hace ${-dias} día(s)`);
      } else if (dias <= 7) {
        alertas.push(`• ${pago.nombre} — ${fmt(pago.monto)} — vence en ${dias} día(s)`);
      }
    }

    if (alertas.length > 0) {
      const texto = `⏰ Tienes pagos que requieren atención:\n${alertas.join('\n')}`;
      await enviar(chatId, texto);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
