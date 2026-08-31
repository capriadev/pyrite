# Pyrite - Philosophy

> "Oro de los tontos": humilde por fuera, sólido por dentro. Esta es la intención y las reglas de fondo del proyecto.

## Qué es Pyrite
Sistema personal, **single-user**, privado y **local-first**. Los datos sensibles no salen del equipo. Repo **público** para que cualquiera lo clone y lo use local (no es SaaS).

## Principios
1. **Ordinario por fuera, sólido por dentro.** UI humilde, arquitectura robusta.
2. **Local es la frontera.** Sin cloud de la data salvo decisión explícita.
3. **Seguridad es feature core.** Ingreso robusto (hash + encadenado) y capas por secciones sensibles (apis, claves, bóveda con modo contraseña y modo seguro). Capa física USB opcional a futuro.
4. **Una fuente de verdad por dominio.** Un solo sistema de tasks, un solo esquema crypto, un solo patrón de hooks, un solo store de secretos. Nada de dos sistemas en paralelo.
5. **Integraciones desacopladas.** Los servicios externos viven fuera del core y se consumen por HTTP/CLI. El núcleo jamás importa su código.
6. **Deuda no se arrastra, se reescribe limpio.**
7. **Consistencia específica.** Convenciones claras por área que se cumplen en cada trabajo puntual.

## Cómo se construye (método)
- **Por versiones progresivas**, no MVP: primero lo esencial, luego mejoras, luego servicios.
- **Analizar antes de codificar**: reutilizar, prever conflictos, escribir lo mínimo necesario.
- **Módulos atómicos** reutilizables hasta la mínima acción.
- **Ramas** GitHub Flow + **commits por conjunto relevante** (tarea → commit → repetir).
- **Spec-driven development** obligatorio (specs + `features.md` con `last_id`).

## Stack
- Interfaz: Next.js + TypeScript + Tailwind.
- Backend: Nest.js + TypeScript, modular por capas.
- Postgres + Redis en Docker (contenedor `pyrite`).
- El backend corre solo y aislado, arranca al iniciar Windows.

Ver detalles técnicos en `.agents/memory/architecture.md`; la metodología, en `AGENTS.md`.