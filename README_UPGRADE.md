# CAFETIER ERP 3.0

Versión reestructurada para operar como ERP de tostadora con reglas de negocio consistentes:

## Flujos cubiertos
- Pedidos de venta retail y mayoreo.
- Órdenes de compra manuales o disparadas por déficit de café verde.
- Validación de caja disponible para compras y gastos.
- Orden automática de ingreso de capital cuando una compra no puede fondearse.
- Aportes de capital ligados o no a una orden de capital.
- Devolución de capital a socios.
- Orden de dividendos de fin de mes, bloqueada hasta recuperar todo el capital.
- Pago de dividendos por porcentajes societarios.
- Inventario con movimientos consistentes.
- Sesiones y batches de tostado con consumo de verde y alta de tostado.
- Gastos y bitácora de máquina.

## Stack
- Bun
- Hono
- SQLite nativo de Bun

## Archivos principales
- `db.ts`: esquema, helpers, transacciones y reglas financieras.
- `api.ts`: API ERP.
- `index.html` + `styles.css` + `app.js`: frontend SPA más robusto.
- `server.ts`: arranque y static serving.
- `Dockerfile`: deploy para Railway.

## Variables
- `DB_PATH` opcional. Por defecto `/data/cafetier.db` en Railway.
- `PORT` opcional. Por defecto `3000`.

## Railway
Adjunta un volumen persistente a `/data`.
