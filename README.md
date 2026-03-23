# ☕ CAFETIER - Sistema de Gestión para Tostaduría de Café

## Stack
- **Runtime**: Bun
- **Framework**: Hono
- **Database**: SQLite (better-sqlite3)
- **Deploy**: Railway con disco persistente

## Módulos
- **Dashboard** — Resumen financiero, metas, progreso de pedidos
- **Venta Rápida (POS)** — Mostrador y pedidos grandes
- **Producción / Tostado** — Sesiones, batches, merma, análisis AI de curvas Artisan
- **Inventario** — Café verde, tostado, empaquetado, insumos
- **Pedidos** — Pagos parciales, envíos parciales, trazabilidad completa
- **Clientes** — Catálogo con historial
- **Gastos** — Por categoría, quién pagó, costos directos vs indirectos
- **Capital & Utilidades** — Aportes, recuperación, reparto 25/25/50
- **Bitácora de Máquina** — Mantenimiento, mejoras, incidencias
- **Configuración** — Perfiles de tueste, orígenes, variedades, electricidad, API key

## Deploy en Railway

1. Sube este repo a GitHub
2. Crea un nuevo proyecto en Railway
3. Conecta el repo de GitHub
4. Railway detectará el Dockerfile automáticamente
5. Agrega un disco persistente:
   - Mount Path: `/data`
   - Tamaño: 1 GB (suficiente)
6. Variables de entorno (opcionales):
   - `PORT`: 3000 (default)
   - `DB_PATH`: /data/cafetier.db (default)

## Usuarios por defecto
| Usuario | Contraseña | Participación |
|---------|-----------|---------------|
| itzamara | cafetier2026 | 25% |
| axel | cafetier2026 | 50% |
| gaston | cafetier2026 | 25% |

## Desarrollo local
```bash
bun install
bun run dev
```

## Costo de Electricidad
En Configuración, ingresa:
- **kW de la máquina**: potencia nominal del tostador
- **Precio por kWh**: sacarlo de tu factura de CFE

El costo eléctrico se calcula por sesión de tostado usando las horas de máquina registradas en cada batch.

## Análisis AI de Curvas
1. Obtén un API key en console.anthropic.com
2. Ingrésalo en Configuración → API Key de Claude
3. Sube archivos .alog o .csv de Artisan en cada batch
4. Claude analizará la curva y dará su dictamen
