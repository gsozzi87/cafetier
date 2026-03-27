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

## API Key de Claude
En Configuración → API Key. Se usa para analizar curvas de Artisan con IA.
