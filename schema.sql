-- schema.sql
-- Esquema para Turso (libSQL). Es prácticamente idéntico al de SQLite original
-- en database.py -> init_db(). Se corre UNA VEZ contra tu base de Turso:
--
--   turso db shell nomina-personal < schema.sql
--
-- (o pega el contenido en el SQL console del dashboard de Turso)

CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    pregunta_secreta TEXT,
    respuesta_secreta_hash TEXT,
    reset_token TEXT,
    reset_token_expira TEXT
);

CREATE TABLE IF NOT EXISTS cuentas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'otro',
    saldo_inicial REAL NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#1D9E75',
    activa INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('gasto', 'ingreso')),
    color TEXT NOT NULL DEFAULT '#4FB0FF',
    icono TEXT NOT NULL DEFAULT '💸',
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pagos_pendientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha_vencimiento TEXT NOT NULL,
    categoria_id INTEGER,
    cuenta_id INTEGER,
    pagado INTEGER NOT NULL DEFAULT 0,
    fecha_pago TEXT,
    recurrente TEXT NOT NULL DEFAULT 'ninguna',
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
    FOREIGN KEY (cuenta_id) REFERENCES cuentas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('gasto', 'ingreso')),
    monto REAL NOT NULL,
    categoria_id INTEGER,
    cuenta_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    descripcion TEXT,
    pago_pendiente_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
    FOREIGN KEY (cuenta_id) REFERENCES cuentas(id) ON DELETE CASCADE,
    FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS presupuestos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    categoria_id INTEGER NOT NULL,
    monto_limite REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE CASCADE,
    UNIQUE(user_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS metas_ahorro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    monto_objetivo REAL NOT NULL,
    monto_actual REAL NOT NULL DEFAULT 0,
    fecha_inicio TEXT NOT NULL,
    fecha_objetivo TEXT NOT NULL,
    activa INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS divisiones_gasto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    movimiento_id INTEGER NOT NULL,
    parte_nombre TEXT NOT NULL,
    monto REAL NOT NULL,
    pagado INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_vinculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    chat_id TEXT UNIQUE,
    telegram_username TEXT,
    codigo TEXT,
    codigo_expira TEXT,
    vinculado_en TEXT,
    estado TEXT,
    estado_datos TEXT,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deudas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    monto_total REAL NOT NULL,
    monto_pagado REAL NOT NULL DEFAULT 0,
    fecha_inicio TEXT NOT NULL,
    fecha_limite TEXT,
    tasa_interes REAL,
    activa INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
