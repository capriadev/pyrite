# Pyrite

Sistema personal **single-user**, privado y **local-first**. Tus datos sensibles no salen de tu equipo y todo queda cifrado en reposo. Es un panel de control personal con backend propio corriendo en tu máquina; la UI es deliberadamente simple, la solidez está adentro (seguridad, arquitectura en capas, datos locales).

> English version: [README.md](README.md)

## Requisitos
- nvm (Node Version Manager)
- Node.js 24.20.0 - el repo incluye `.nvmrc`: `nvm install` y luego `nvm use`
- Docker (Docker Desktop)

## Arranque local
```bash
# 1. Instalar dependencias
npm ci

# 2. Entorno del backend (necesario para arrancar)
copy apps\backend\.env.example apps\backend\.env
# ajustá credenciales/puertos si tu máquina necesita otros

# 3. Infraestructura (Postgres + Redis)
npm run docker:up

# 4. Frontend + backend juntos
npm run dev
# o por separado: npm run dev:backend / npm run dev:frontend
```

> Dos configuraciones distintas: lo que es del usuario (providers, keys, modelos, preferencias) vive en la DB y rota en runtime; los ajustes de arranque del backend (peppers de crypto, params de Argon2id, puerto, credenciales de DB) salen de `apps/backend/.env`.

## Base de datos (Drizzle)
El esquema vive en `apps/backend/drizzle/schema.ts` y se aplica **siempre** con el flujo seguro: `npm run tsc` -> `npm run orm` (genera `.sql`, no toca la DB) -> **revisar el `.sql` generado** -> `npm run orm:migrate`. Nunca `orm:push` contra datos reales. Detalles en [`.agents/skills/pyrite-orm/SKILL.md`](.agents/skills/pyrite-orm/SKILL.md).

## Backups
```bash
npm run back
```
Copiá `backup.config.example.ps1` a `backup.config.ps1` (gitignored) y ajustá tus rutas. Soporta destino local, disco externo y cloud/remotos vía rclone; incluye dump de la base de datos.

## Docs
- [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) - principios, intención y método.
- [`.agents/memory/architecture.md`](.agents/memory/architecture.md) - stack, capas y trade-offs.
- [`AGENTS.md`](AGENTS.md) - cómo se organiza el trabajo en este repo (specs, ramas, commits).

## Licencia
[MIT](LICENSE.md)
