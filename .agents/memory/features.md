# Features - SDD index | delete when complete | new ID = last_id + 1

last_id: 8

<!--
One line per feature. Planned features may be registered here without a spec yet (status: pending); a spec is opened when the feature is planned and ready to develop. When a feature is COMPLETE: remove its line here and mark the spec status as completed. SPECS ARE NEVER DELETED - specs/ is a permanent registry, the numbering exists for that. Never reuse an ID; last_id only grows.

Format: #<id> <name> - <one-line summary> [spec: <file>] [status: pending|active|blocked]
-->

#2 Frontend skeleton - Next.js App Router + TS strict + Tailwind v4 in apps/frontend, gateway api client, status view [spec: 002-frontend-skeleton.md] [status: completed]
#3 Config en DB - settings/keys del sistema en DB cargadas al boot, sin .env [spec: 003-config-db.md] [status: completed]
#4 Auth core - login passphrase, Argon2id, crypto en capas con perfiles por dominio (light/medium/heavy), KDF+GCM [spec: 004-auth-core.md] [status: completed]
#5 Startup screen - sonido de inicio + mensaje de voz rotativo (ElevenLabs, 2-3 variantes) [status: pending]
#6 APIs section - almacen de API keys con validadores, estado activa/vencida/invalida [status: pending]
#7 Finances core - categorias/platformas/balances, movimientos con conversion efectiva snapshot y balance_source [spec: 005-finances-core.md] [status: completed]
#8 Rates sync - sincronizacion diaria de cotizaciones (todos los tipos) desde ArgentinaDatos + intradia dolarapi, reconcile idempotente, cross-check diario [spec: 006-rates-sync.md] [status: completed]