// layout.js — común a todas las páginas internas (las que tienen sidebar).
// Pinta el nombre de usuario donde haya un elemento con clase "js-username"
// y conecta el botón/enlace de logout (id="btn-logout").

document.querySelectorAll(".js-username").forEach((el) => {
  el.textContent = localStorage.getItem("np_username") || "";
});

const btnLogout = document.getElementById("btn-logout");
if (btnLogout) {
  btnLogout.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("np_token");
    localStorage.removeItem("np_username");
    window.location.href = "/login.html";
  });
}
