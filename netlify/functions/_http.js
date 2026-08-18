'use strict';
// _http.js — helpers chiquitos para no repetir boilerplate en cada función.

const HEADERS = {
  'Content-Type': 'application/json',
  // Mientras frontend y functions viven en el mismo dominio de Netlify
  // esto no es estrictamente necesario, pero no estorba si algún día
  // pruebas el frontend desde otro origen (ej. localhost en desarrollo).
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(status, data) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(data) };
}

function parseBody(event) {
  const body = event.body || '{}';
  try {
    return JSON.parse(body);
  } catch (e) {
    return {};
  }
}

module.exports = { jsonResponse, parseBody };
