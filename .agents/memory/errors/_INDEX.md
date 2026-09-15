# Error Index - Pyrite

Router for conflict/error post-mortems. Add an entry each time you create a file. Keep each file short.

<!--
# <slug> - <one-line problem>
-->

# drizzle-kit-migrate-falla-silencioso - drizzle-kit migrate sale con exit 1 sin aplicar (ver workaround psql)
# drizzle-migraciones-sin-baseline - DB con tablas pero sin drizzle.__drizzle_migrations (incluye falso negativo por comillas)
# drizzle-enum-y-constraint-drift - snapshot reconstruido a mano genera drift falso (malformed, DROP de constraints, _fk vs _fkey)
# pino-roll-size-units - un size sin unidad en pino-roll se lee como MB, no bytes (falsa conclusion de bug)
# compactacion-agresiva-en-bucle - el contexto inyectado dispara compactaciones que borran lo leido y meten al agente en un ciclo de relecturas
# editor-old-text-de-una-sola-linea - old_text multilinea falla en silencio; reescribir con .next + Copy-Item o con WriteAllLines/[string[]]