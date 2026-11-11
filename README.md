# ☕ CAFETIER — Sistema de gestión para tostaduría de café

Sitio público + ERP interno (`/admin`) para ventas, compras, envíos, gastos, capital, inventario y tostado.

## Stack
- **Runtime**: Bun
- **Framework**: Hono
- **Base de datos**: SQLite nativo de Bun (`bun:sqlite`)
- **Deploy**: Railway con volumen persistente en `/data` (el volumen se crea desde el dashboard de Railway; `railway.toml` no puede definir volúmenes)

## Deploy en Railway
1. Conectar este repo a un servicio de Railway (detecta el `Dockerfile`).
2. Crear un volumen desde el dashboard con mount path `/data`.
3. Configurar las variables de entorno (abajo). Cada push a `main` redespliega.

## Variables de entorno
- `ADMIN_USER`: usuario de acceso (por defecto `admin`).
- `ADMIN_PASSWORD`: **obligatoria**, larga y única. Sin ella, todo el acceso privado responde 503 (seguro por defecto). No hay límite de intentos de login, así que conviene que sea larga.
- `APP_TZ` (opcional): zona horaria del negocio para fechas y cierres de mes. Por defecto `America/Mexico_City`.
- `RESET_DB_ON_BOOT` (opcional, un solo uso): `operativo` o `todo` borra datos al arrancar. Quitarla después del deploy.

## Seguridad
- La web comercial, `GET /api/site-content/:page` y `GET /api/site-media/:id` son públicos.
- `/admin`, `/editor-sitio` y el resto de `/api` requieren HTTP Basic Auth (siempre por HTTPS).
- Las escrituras del ERP exigen el header `X-Cafetier-Request: 1` y un `Origin` del mismo sitio (protección CSRF; funciona detrás del proxy de Railway usando `X-Forwarded-Host/Proto`).
- No guardar credenciales en Git, el frontend, SQLite ni el contenido público.

## Reglas de negocio
- **Costo por kilo** = café verde (con su flete de compra y la merma) + empaques usados + envíos a clientes. Gas, luz y demás gastos son gastos comunes y no entran en el costo por kilo.
- **Café verde**: el stock se muestra pero nunca bloquea ventas ni tostado, y no genera órdenes de compra automáticas. Las compras se cargan a mano.
- **Pedidos cancelados** quedan cancelados aunque después se registren pagos o envíos; se reactivan a propósito desde el detalle del pedido.
- **Gastos automáticos** (de compras, envíos o bitácora) y los aportes "espejo" (Itza pagó algo de su bolsillo) se editan desde su origen, nunca sueltos en Gastos o en el Libro de Caja.
- **Devolución de capital**: no puede superar lo que el socio aportó y todavía no se le devolvió.
- **Libro de caja**: muestra saldo inicial, saldo acumulado por movimiento y saldo final; el saldo coincide con la caja real.
