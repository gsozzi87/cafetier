# ☕ CAFETIER - Sistema de Gestión para Tostaduría de Café

## Stack
- **Runtime**: Bun
- **Framework**: Hono
- **Database**: SQLite (better-sqlite3)
- **Deploy**: Railway con disco persistente

## Deploy en Railway

1. Sube este repo a GitHub
2. Crea proyecto en Railway → conecta el repo
3. Railway detecta el Dockerfile
4. Agrega disco persistente: Mount Path `/data`
5. Deploy automático

## Lógica de Inventario Automática

Cada venta o pedido verifica automáticamente:
- ¿Hay café tostado suficiente? → Se descuenta del inventario
- ¿No hay tostado pero sí verde? → Se genera **orden de tueste**
- ¿No hay verde suficiente? → Se genera **orden de compra**
- La merma máxima histórica (default 20%) se usa para calcular cuánto verde se necesita

Las acciones pendientes aparecen en el Dashboard y en el detalle del pedido.

## Configuración de Electricidad
En Configuración, ingresa kW de la máquina y precio por kWh (de tu factura CFE).

## Seguridad y acceso al ERP

La web comercial, `GET /api/site-content/:page` y `GET /api/site-media/:id` siguen públicos.
Todo `/admin`, `/editor-sitio` y las demás rutas de `/api` requieren HTTP Basic Auth.

**Variables obligatorias en Railway** (Settings → Variables):
- `ADMIN_USER`: usuario para acceder (por defecto `admin`).
- `ADMIN_PASSWORD`: contraseña aleatoria larga y única. Si no está definida, el acceso privado devuelve HTTP 503 (seguro por defecto).
- `ANTHROPIC_API_KEY`: clave nueva de Claude, opcional. Se usa solo en el backend para analizar curvas de Artisan.

Usar siempre HTTPS. El navegador pedirá usuario y contraseña al entrar en `/admin` o `/editor-sitio`.
Las solicitudes de escritura del ERP deben incluir `X-Cafetier-Request: 1` (protección CSRF).
**Rotar cualquier clave de Claude anteriormente guardada en el panel**: se elimina de la base SQLite al iniciar.
No guardar credenciales en Git, el frontend, SQLite ni en el contenido público.
