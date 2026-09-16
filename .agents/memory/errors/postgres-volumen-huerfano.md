# Volumen de Postgres huerfano y credenciales reseteadas a mano

## Summary
El contenedor real monta `docker_postgres-data`; `pyrite_postgres-data` quedo huerfano y vacio, y el volumen vivo se inicializo en su momento con credenciales distintas a las del compose actual.

## Context
Se descubre al comparar la base real con lo que declara el compose: el volumen vivo tiene la password reseteada a mano a `pyrite/pyrite` y el otro quedo vacio con las credenciales viejas. Solo afecta a un entorno local ya inicializado, no a un clon nuevo.

## Solution
1. No borrar el volumen vivo: ahi estan los datos reales.
2. Si el compose no conecta, revisar primero que volumen monta el contenedor y con que credenciales, antes de tocar nada.
3. Entorno nuevo: dejar que el compose inicialice el suyo; el volumen huerfano se ignora sin consecuencias.
4. Borrar un volumen es destructivo: requiere confirmacion explicita del usuario (ver `AGENTS.md`).

## Tags
<docker> <postgres> <volumen> <entorno> <windows>
