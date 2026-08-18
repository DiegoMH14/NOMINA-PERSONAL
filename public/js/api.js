// api.js — usar en toda página protegida en vez de fetch() directo.
// Agrega el token guardado en localStorage y, si el servidor responde
// 401 (token inválido o vencido), manda de vuelta al login.

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("np_token");
  if (!token) {
    window.location.href = "/login.html";
    return {};
  }

  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (resp.status === 401) {
    localStorage.removeItem("np_token");
    window.location.href = "/login.html";
    return {};
  }

  return resp.json();
}
