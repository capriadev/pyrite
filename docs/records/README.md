# records

Registro de verificacion del trabajo terminado: un archivo por spec, escrito en el momento en que se verifico (mediciones, hallazgos, defectos corregidos). Es un snapshot de ese momento y no se actualiza despues.

- Naming: `NNN-<slug-de-la-spec>.md`, espejando el nombre del spec para que el vinculo sea evidente.
- Lo escribe el agente al cerrar una feature: la spec conserva el plan y la verificacion pensada, aca queda lo que realmente paso.
- Un archivo por spec, no un log unico: el crecimiento es por feature y no un archivo que se vuelve inmantenible.
