# Features - SDD index | delete when complete | new ID = last_id + 1

last_id: 16

<!--
One line per feature. Planned features may be registered here without a spec yet (status: pending); a spec is opened when the feature is planned and ready to develop. When a feature is COMPLETE: remove its line here and mark the spec status as completed. SPECS ARE NEVER DELETED - specs/ is a permanent registry, the numbering exists for that. Never reuse an ID; last_id only grows.

Format: #<id> <name> - <one-line summary> [spec: <file>] [status: pending|active|blocked|completed]
-->

#1 Backend skeleton - Nest.js app in apps/backend with layered structure, Drizzle+Redis wiring and /health check [spec: 001-backend-skeleton.md] [status: completed]
#2 Frontend skeleton - Next.js App Router + TS strict + Tailwind v4 in apps/frontend, gateway api client, status view [spec: 002-frontend-skeleton.md] [status: completed]
#3 Config en DB - settings/keys del sistema en DB cargadas al boot (bootstrap de infra via .env) [spec: 003-config-db.md] [status: completed]
#4 Auth core - login passphrase, Argon2id, crypto en capas con perfiles por dominio (light/medium/heavy), KDF+GCM [spec: 004-auth-core.md] [status: completed]
#5 Startup screen - sonido de inicio + mensaje de voz rotativo (ElevenLabs, 2-3 variantes) [status: pending]
#6 APIs section - almacen de API keys con validadores, estado activa/vencida/invalida [spec: 007-api-keys.md] [status: completed]
#7 Finances core - categorias/platformas/balances, movimientos con conversion efectiva snapshot y balance_source [spec: 005-finances-core.md] [status: completed]
#8 Rates sync - sincronizacion diaria de cotizaciones (todos los tipos) desde ArgentinaDatos + intradia dolarapi, reconcile idempotente, cross-check diario [spec: 006-rates-sync.md] [status: completed]
#9 Finances UI - UI de finances; al iniciarse se dispara la sub-spec C (graficos/filtros, spec 005) [status: pending]
#10 Backend restructure - subcarpetas por dominio en dal/bll/gateway, crypto a services, auth separado [spec: 008-backend-restructure.md] [status: completed]
#11 Fix drizzle location - mover schema/migrations/config a apps/backend, build limpio (rootDir ".", dist/src/main.js), scripts orm con cd apps/backend [spec: 009-fix-drizzle-location.md] [status: completed]
#12 Notes backend - notas con modo privado (seccion propia), busqueda por titulo/contenido, tabla groups unificada por dominio [spec: 010-notes-backend.md] [status: completed]
#13 Logging system - pino + pino-roll, correlacion por reqId, redaccion de secretos, rotacion y retencion [spec: 011-logging-system.md] [status: completed]
#14 Counts backend - boveda de credenciales zero-knowledge (cifrado por registro, historial de passwords, fortaleza, duplicados, OAuth) [spec: 012-counts-backend.md] [status: active]
#15 Rotacion de passphrase por seccion - cambiar la passphrase de notes/notes_private/apis/vault/counts en segundo plano (staging durable, resume tras corte, cancel con rollback) y apply atomico del canary al final [spec: 013-section-passphrase-rotation.md] [status: active]
#16 Counts audits extraction - separar weakAudit/duplicatesAudit de counts.service en CountsAuditsService + modulo de vista compartido (refactor sin cambio de comportamiento) [spec: 014-counts-audits-extraction.md] [status: active]