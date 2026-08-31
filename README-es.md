# Pyrite

> "Oro de los tontos": humilde por fuera, sólido por dentro.

Sistema personal **single-user**, privado y **local-first**. Tus datos sensibles no salen del equipo. Repo público: cualquiera puede clonarlo y correrlo en su propia máquina (no es SaaS).

> English version: [README.md](README.md)

## Qué es
Un panel de control personal que integra finanzas, tareas, calendario, gestor de contraseñas, almacenamiento de API keys, bóveda privada y más - todo en un solo sistema con backend propio, corriendo en tu equipo. La UI es deliberadamente simple; la solidez está adentro (seguridad, arquitectura en capas, datos locales).

## Estado del proyecto
En construcción activa. El andamiaje está montado; los features se desarrollan por versiones progresivas guiadas por specs (ver [Roadmap](#roadmap)).

## Features (progresivos)
- **Dashboard** - KPIs, tareas del día, flujo de caja.
- **Finances** - ingresos/egresos, categorías, multi-moneda (ARS/USD/EUR), export Excel.
- **Tasks** - sistema modular con recurrencias ricas.
- **Calendar** - suscripciones y eventos.
- **Passwords** - gestor cifrado con master key + 2FA.
- **API Keys** - almacén cifrado con validadores por provider.
- **Webs** - links con grupos inteligentes y descripción IA.
- **Bóveda** - cloud privado con modo contraseña y modo seguro.

## Stack

| Capa | Tech |
|---|---|
| Interfaz (`apps/frontend`) | Next.js + TypeScript + Tailwind CSS |
| Backend (`apps/backend`) | Nest.js + TypeScript |
| DB | PostgreSQL + Redis (Docker) |
| ORM | Drizzle (tipado) |
| Seguridad | Argon2id + AES-256-GCM |

## Arquitectura
- **Backend modular por capas**: `dal/` (acceso a datos), `bll/` (lógica de negocio), `gateway/` (entrada HTTP/WS), `services/`, `integrations/` (consumo de servicios externos por HTTP/CLI - nunca se importa su código).
- **Config en DB, no `.env`**: toda la configuración del sistema (incluidas las API keys que usan los modos con IA dentro del sistema) vive en la base de datos y se carga al boot. Permite rotar providers/keys/modelos en runtime.
- **Satellite services** (`satellite-services/`): software de terceros (Cobalt, spotdl, open-notebook) corriendo como procesos independientes.
- **Sidecars** (`sidecars/`): procesos auxiliares propios (Rust/Python) para control a nivel OS (ej. volumen de Spotify en Windows).
- **Arranque en Windows**: el backend corre como servicio (`node-windows`), incluso antes del login.

```
apps/backend · apps/frontend · apps/bot-discord
docker/ · drizzle/ · satellite-services/ · sidecars/
docs/ · .agents/ (memoria y skills del agente)
```

## Seguridad
Feature core desde el día 1:
- Login con passphrase → hash Argon2 (encadenado) → cifrado.
- Secciones sensibles por capas: `apis`, `claves`, `bóveda` (modo contraseña + modo seguro).
- Capa física opcional (USB key) a futuro.

## Requisitos
- nvm (Node Version Manager)
- Node.js 24.20.0 (el repo incluye `.nvmrc`: `nvm install` + `nvm use` lo activa)
- Docker (Docker Desktop)
- rclone (solo si usás backups a cloud)

## Arranque local
```bash
# 1. Infraestructura (Postgres + Redis)
docker compose -f docker/docker-compose.yml up -d
# o: npm run docker:up

# 2. Frontend + backend (una sola terminal)
npm run dev

# o por separado:
npm run dev:backend   # Nest.js
npm run dev:frontend  # Next.js
```

> Sin `.env`: la configuración se gestiona desde el propio sistema (DB), cargada al boot.

## Base de datos (Drizzle)
El esquema se edita en `apps/backend/drizzle/schema.ts` y se aplica **siempre** con el flujo seguro: `npm run tsc` → `npm run orm` (genera `.sql`, no toca la DB) → **revisar el `.sql`** → `npm run orm:migrate`. Nunca `orm:push` con datos reales. Ver `.agents/skills/pyrite-orm/SKILL.md`.

## Backups
```bash
npm run back
```
Copia `backup.config.example.ps1` a `backup.config.ps1` (gitignored) y ajustá tus rutas. Soporta destino local, disco externo y cloud/remotos vía rclone; incluye dump de la DB.

## Roadmap
1. **Fase 0** - Base del repo (andamiaje, docs, backups).
2. **Fase 1** - Esqueleto de apps (Nest + Next), config en DB, auth core.
3. **Fase 2** - Features nucleares: Finances → Tasks → Dashboard → Passwords/API Keys.
4. **Fase 3** - Integraciones: Webs, Calendar, Bóveda, Dólar, Discord bot, Downloads, búsqueda, sidecar Spotify, satellite services, servicio de Windows.

## Metodología
Desarrollo guiado por specs (SDD): cada cambio nace de un spec en `.agents/memory/specs/` indexado en `features.md`. Ramas GitHub Flow, Conventional Commits, TypeScript strict. Detalles en [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) y `AGENTS.md`.

## Licencia
[MIT](LICENSE.md)