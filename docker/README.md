# Docker - Pyrite

Infraestructura local en Docker. Contenedor **`pyrite`** (nombre personalizado) con instancias internas.

## Servicios
| Servicio | Contenedor | Puerto | Imagen |
|---|---|---|---|
| PostgreSQL | `pyrite-postgres` | 5433 | postgres:17 |
| Redis | `pyrite-redis` | 6379 | redis:7-alpine |

> El host port de Postgres es **5433** (el 5432 queda reservado para otros proyectos locales que ya lo usan). Dentro de la red Docker sigue siendo 5432.

## Comandos
```bash
# levantar
docker compose up -d

# detener
docker compose down

# logs
docker compose logs -f postgres redis
```

## Nota sobre `.env`
El runtime del sistema **no usa `.env`**: la configuración se guarda en DB y se carga al boot (ver `.agents/memory/architecture.md`). Las credenciales de abajo son **solo de bootstrap** del contenedor (usuario/password iniciales de Postgres/Redis). La configuración real de Pyrite se gestiona desde el propio sistema (rotar API keys/proveedores/modelos).

## Arranque al iniciar Windows
El contenedor usa `restart: unless-stopped`. Para que corra solo al boot junto con el backend, el contenedor Docker + el backend se registran como servicio de Windows (`node-windows` / NSSM). Ver `apps/backend/README.md`.

## Volúmenes
- `postgres-data` → datos de Postgres (no van al repo, en `.gitignore`).
- `redis-data` → datos de Redis.