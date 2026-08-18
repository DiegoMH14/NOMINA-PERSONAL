<div align="center">

<img src="public/img/logo.png" alt="Nómina Personal" width="220">

# Nómina Personal

**Gestor de finanzas personales con app web y bot de Telegram**

Cuentas, categorías, movimientos, presupuestos, metas de ahorro, deudas
y pagos pendientes — todo en un solo lugar, sincronizado en tiempo real
entre la web y [@NexosasBot](https://t.me/NexosasBot).

**🔗 [Ver la app en vivo](https://nomina-personal.netlify.app)**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Netlify](https://img.shields.io/badge/Deploy-Netlify-00C7B7?logo=netlify&logoColor=white)](https://www.netlify.com)
[![Turso](https://img.shields.io/badge/Database-Turso%20(libSQL)-4FF8D2?logo=sqlite&logoColor=black)](https://turso.tech)
[![Telegram Bot](https://img.shields.io/badge/Bot-Telegram-26A5E4?logo=telegram&logoColor=white)](https://t.me/NexosasBot)
[![License](https://img.shields.io/badge/Licencia-MIT-lightgrey)](#licencia)

</div>

---

## Tabla de contenido

- [¿Qué es Nómina Personal?](#qué-es-nómina-personal)
- [Funcionalidades](#funcionalidades)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Puesta en marcha](#puesta-en-marcha)
  - [1. Crear la base de datos en Turso](#1-crear-la-base-de-datos-en-turso)
  - [2. Variables de entorno](#2-variables-de-entorno)
  - [3. Instalar dependencias](#3-instalar-dependencias)
  - [4. Desplegar en Netlify](#4-desplegar-en-netlify)
  - [5. Activar el bot de Telegram](#5-activar-el-bot-de-telegram)
  - [6. Crear tu primer usuario](#6-crear-tu-primer-usuario)
- [Mapa de la API](#mapa-de-la-api)
- [Solución de problemas](#solución-de-problemas)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

---

## ¿Qué es Nómina Personal?

**Nómina Personal** nace para dejar de improvisar con la plata: reemplaza
las notas del celular, los mensajes sueltos y las hojas de cálculo a
medio llenar por un solo lugar donde queda el registro real de cuántas
cuentas tienes, en qué se te va el dinero cada mes y qué pagos están
por vencer.

El proyecto tiene dos puertas de entrada que comparten la misma cuenta
y la misma base de datos:

- **App web** — dashboard con gráficas, formularios y todo el detalle.
- **[@NexosasBot](https://t.me/NexosasBot) en Telegram** — para registrar
  un gasto, consultar el saldo o revisar los últimos movimientos sin
  abrir el navegador.

## Funcionalidades

- 🏦 **Cuentas y saldos reales** — banco, billetera digital o efectivo; el saldo se calcula solo según los movimientos.
- 🏷️ **Categorías personalizadas** — ícono y color propio por categoría, con presupuestos asociados.
- 🧾 **Movimientos** — ingresos y gastos, con gastos compartidos entre varias personas.
- 📊 **Dashboard con gráficas** — gasto por categoría/cuenta y balance mes a mes.
- 🎯 **Metas de ahorro** — con aportes y seguimiento de avance.
- 📉 **Deudas** — control de abonos y saldo pendiente.
- ⏰ **Pagos pendientes** — únicos o recurrentes, con aviso antes de vencer.
- 🤖 **Bot de Telegram** — vinculación por código, menú con botones y formularios conversacionales para registrar todo desde el chat.
- 🔔 **Recordatorios diarios** — cron que avisa de pagos próximos a vencer.

## Arquitectura

```
┌──────────────┐        ┌──────────────────────┐        ┌───────────────┐
│   Frontend   │  HTTP  │   Netlify Functions   │  SQL   │     Turso     │
│  (public/)   │ ─────▶ │ (netlify/functions/)  │ ─────▶ │   (libSQL)    │
│ HTML/CSS/JS  │        │  Node.js serverless    │        │  base de datos│
└──────────────┘        └──────────┬────────────┘        └───────────────┘
                                    │ webhook
                                    ▼
                          ┌───────────────────┐
                          │  @NexosasBot       │
                          │  (Telegram)        │
                          └───────────────────┘
```

Todo el backend corre como funciones serverless de Netlify en
**Node.js**; no hay servidor propio que mantener. La base de datos es
**Turso** (libSQL, compatible con SQLite), y el bot de Telegram recibe
los mensajes por **webhook** — no necesita nada corriendo 24/7 aparte
del sitio desplegado.

## Estructura del proyecto

```
nomina-netlify/
├── public/                      # Frontend estático
│   ├── index.html               # Landing page
│   ├── login.html / registro.html
│   ├── dashboard.html           # + movimientos, categorías, presupuestos,
│   │                             #   metas, deudas, pagos, telegram, cuenta
│   ├── css/style.css            # Paleta y estilos de toda la app
│   ├── js/api.js                # Fetch autenticado con el token de sesión
│   ├── js/layout.js             # Sidebar: usuario y logout
│   └── img/                     # Logo y favicon
├── netlify/functions/           # Backend (Netlify Functions, Node.js)
│   ├── login.js · registro.js · cambiar_password.js
│   ├── cuentas.js · categorias.js · movimientos.js
│   ├── presupuestos.js · metas.js · deudas.js · pagos.js
│   ├── telegram.js              # Genera/consulta el código de vinculación
│   ├── bot.js                   # Webhook del bot de Telegram
│   ├── recordatorios-diarios.js # Cron diario (pagos próximos a vencer)
│   └── _db.js · _auth.js · _http.js  # Helpers compartidos
├── schema.sql                   # Esquema completo de la base de datos
├── migracion_estado_bot.sql     # Migración incremental (ver más abajo)
├── netlify.toml                 # Configuración de build, cron y redirects
└── package.json
```

## Puesta en marcha

### 1. Crear la base de datos en Turso

```bash
# Instalar el CLI (una sola vez)
curl -sSfL https://get.tur.so/install.sh | bash

turso auth login
turso db create nomina-personal

# Aplicar el esquema
turso db shell nomina-personal < schema.sql

# Sacar la URL y el token que van en Netlify
turso db show nomina-personal --url
turso db tokens create nomina-personal
```

> Si ya tenías una base de Turso creada **antes** de que existieran las
> columnas de estado conversacional del bot, corre además:
> `turso db shell nomina-personal < migracion_estado_bot.sql`
> (`schema.sql` ya las incluye por defecto para bases nuevas).

### 2. Variables de entorno

En Netlify → **Site settings → Environment variables**:

| Variable | Descripción |
|---|---|
| `TURSO_DATABASE_URL` | URL que entrega `turso db show` |
| `TURSO_AUTH_TOKEN` | Token que entrega `turso db tokens create` |
| `SECRET_KEY` | Cadena larga y aleatoria para firmar los tokens de sesión (JWT) |
| `TELEGRAM_BOT_TOKEN` | Token del bot, entregado por [@BotFather](https://t.me/BotFather) |

### 3. Instalar dependencias

```bash
npm install
```

### 4. Desplegar en Netlify

Conecta este repositorio a un sitio nuevo de Netlify (recomendado, para
que cada `git push` despliegue solo), o arrastra la carpeta al tab
**Deploys** del sitio.

### 5. Activar el bot de Telegram

Una sola vez, después del primer deploy:

```bash
curl "https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://TU-SITIO.netlify.app/api/bot"
```

Desde ese momento, [@NexosasBot](https://t.me/NexosasBot) responde solo
— Telegram llama directo a esa URL cada vez que alguien le escribe.

### 6. Crear tu primer usuario

Entra a `https://tu-sitio.netlify.app/registro.html` y crea tu cuenta
desde ahí.

## Mapa de la API

Todas las rutas quedan expuestas bajo `/api/*` (redirigidas por
`netlify.toml` hacia `/.netlify/functions/*`).

| Función | Rutas | Descripción |
|---|---|---|
| `login.js` | `POST /api/login` | Inicio de sesión, entrega JWT |
| `registro.js` | `POST /api/registro` | Alta de usuario |
| `cambiar_password.js` | `POST /api/cambiar_password` | Cambio de contraseña |
| `cuentas.js` | `GET`, `POST /api/cuentas` | Cuentas y saldos |
| `categorias.js` | `GET`, `POST`, `DELETE /api/categorias` | Categorías |
| `movimientos.js` | `GET`, `POST`, `DELETE /api/movimientos` | Ingresos y gastos |
| `presupuestos.js` | `GET`, `POST`, `DELETE /api/presupuestos` | Presupuestos por categoría |
| `metas.js` | `GET`, `POST`, `DELETE /api/metas` (+ `?accion=aportar`) | Metas de ahorro |
| `deudas.js` | `GET`, `POST`, `DELETE /api/deudas` | Deudas y abonos |
| `pagos.js` | `GET`, `POST`, `DELETE /api/pagos` (+ `?accion=marcar_pagado`) | Pagos pendientes |
| `telegram.js` | `GET`, `POST`, `DELETE /api/telegram` | Código de vinculación con el bot |
| `bot.js` | Webhook (`/api/bot`) | Toda la conversación de @NexosasBot |
| `recordatorios-diarios.js` | Cron `0 13 * * *` | Avisos de pagos próximos a vencer |

Todas las rutas (salvo `login` y `registro`) requieren el header
`Authorization: Bearer <token>` que entrega el login.

## Solución de problemas

<details>
<summary><strong>"Cannot find module '@libsql/linux-x64-gnu'" en los logs de una función</strong></summary>

<br>

`@libsql/client` usa un binario nativo por plataforma para hablar con
Turso. El bundler `esbuild` de Netlify no sabe empaquetar binarios
nativos, así que hay que marcarlo como externo. Ya está resuelto en
`netlify.toml`:

```toml
[functions]
  external_node_modules = ["@libsql/client"]
```

Si el sitio ya estaba desplegado antes de este cambio, vuelve a
desplegar con **Deploys → Trigger deploy → Clear cache and deploy
site** para que tome el `netlify.toml` actualizado.

</details>

## Roadmap

- [ ] Gastos compartidos/divididos entre varias personas
- [ ] Proyección de saldo a fin de mes en el dashboard
- [ ] Recuperación de contraseña por pregunta secreta (self-service)
- [ ] Exportar movimientos a Excel/PDF

## Licencia

Distribuido bajo licencia MIT. Consulta el archivo `LICENSE` para más
detalles.

---

<div align="center">
<sub>Nómina Personal — hecho para que dejes de improvisar con tus finanzas.</sub>
</div>
