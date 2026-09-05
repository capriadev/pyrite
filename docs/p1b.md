# Pyrite - Plan funcional del sistema

Este documento describe cómo funciona (o va a funcionar) cada sección de Pyrite,
y las decisiones de diseño ya tomadas que las atraviesan. No es un plan de trabajo
(eso vive en `features.md` + `specs/`) - es la referencia de "así es como piensa
el sistema", para no tener que reconstruir el razonamiento cada vez.

## Secciones del sistema

### Finances
Control amplio de movimientos: efectivo/digital, ingreso/egreso, ARS/USD,
categorías, notas, conversión de moneda en tiempo real según fecha, y ajuste de
conversión según plataforma (ej. tarjeta Uala vs Mercado Pago tienen distinto
costo real en compras al exterior).

Vistas: todas las operaciones, solo ingresos o egresos, filtrado por categoría
y rango de tiempo (mes actual, mes anterior, semana, año, año anterior, todo).

Gráficos: tipos de dólar con % de cambio diario/mensual, tendencia anual,
ingresos/gastos del mes con diferencia respecto al mes anterior, balance,
capital total en ARS/USD, físico y virtual.

Soporte futuro evaluado: crypto (con sync de precios igual que dólar), acciones
(inversión en empresas/emprendimientos), préstamos (dados y recibidos, de la
mano de calendar), tickets/facturas (de la mano de cloud/bóveda).

**Finance es la única fuente de verdad de montos reales.** Calendar/tasks nunca
validan ni almacenan montos definitivos - solo fechas esperadas (ver
"Reconciliación" más abajo).

### Calendar
Vista unificada de tareas, actividades, horarios, recordatorios y pagos
esperados. No tiene lógica propia de recurrencia - es la vista de lo que
tasks ya calculó.

### Tasks
Más que una lista simple: carpetas, grupos, y tareas con soporte para:
- Tarea puntual (día/hora específico).
- Actividad recurrente (todos los días o días específicos, mismo horario o
  distinto, con fin estimado, fijo, o sin fin).
- Suscripciones/pruebas con tramos de precio y ciclo de facturación propios
  por tramo (ver "Motor de recurrencia" más abajo).
- Categorización libre (trabajo > cliente A/B/C, deporte, proyecto X, etc.).
- Vista kanban opcional para algunos tasks (ej. proyectos), con estados y
  progreso.

Vinculado a calendar y notificaciones.

#### Motor de recurrencia (diseño custom, no RRULE)
Se evaluó usar el estándar RRULE (iCalendar) y se descartó - no resolvía el
caso de precio variable por tramo dentro de una misma suscripción, que es
el caso real más importante del sistema. Modelo propio:

- `recurrence_rule` - frecuencia (semanal/mensual/anual) con intervalo
  configurable ("cada N"), fecha de inicio, condición de fin (nunca / hasta
  fecha / cantidad de ocurrencias).
- `price_tier` - cada tramo de precio tiene su PROPIO ciclo de facturación
  (`billing_interval_value` + `billing_interval_unit`), desacoplado del
  recordatorio general. Ejemplo real: Spotify $2500 cada 2 meses (tramo 1),
  luego $X cada 1 mes (tramo 2, indefinido).
- El monto en `price_tier` es **estimado**, no autoridad - solo sirve para
  mostrar una previsión en calendar. El monto real siempre viene de finance,
  puede diferir sin que eso sea un conflicto.

#### Reconciliación finance ↔ calendar
`reconciliation_link` conecta una ocurrencia esperada (fecha, calculada desde
`recurrence_rule` + tramo activo) con un movimiento real de finance.

**El matching es solo por fecha esperada (con margen de tolerancia) y
categoría/entidad - nunca por monto ni moneda.** Si finance registra el pago
en USD convertido con ajuste de plataforma, y calendar tenía un estimado en
otra cifra, no es conflicto: el estimado nunca se compara contra lo real.

Conflicto real = no aparece ningún movimiento de finance vinculado cerca de
la fecha esperada. Ahí se muestra un panel para resolver manualmente
("lo cancelé", "pagué tarde", "vinculalo a este movimiento").

### Webs y APIs
Dos secciones de almacenamiento paralelas:
- **APIs**: guarda API key, detalle, valor, agrupaciones. Dispara validadores
  al entrar, marcando estado (activa/vencida/inválida) por API.
- **Webs**: grupos para categorizar URL, ícono, detalle, pros/contras.
  Buscador que filtra por esos campos.

De la intersección con tasks sale:
- **Notes**: bloc de notas simple (tipo OneNote), más notas seguras con
  password propio y cifrado.

### Accounts (bóveda de credenciales)
La sección más crítica de seguridad del sistema. Guarda cuentas (mail, webs,
apps) con ícono, nombre, fecha, mail, password, generador de password
avanzado con reglas custom, usuario, número, categorías, notas, códigos de
respaldo 2FA, frase de seguridad, preguntas de seguridad.

Switch para marcar una cuenta como habilitada para OAuth (ej. cuenta de
GitHub guardada y marcada, disponible luego como opción de vinculación).
Tipos de credencial: tradicional (password), OAuth (select de cuentas
habilitadas), SSO, API key, otro (DNI, etc. - a definir).

Historial de passwords cambiadas, validador de fortaleza, detector de
passwords repetidas entre cuentas (excluyendo OAuth sin password propio).

### Cloud / Bóveda
Nueva sección: cloud estilo Drive (genérico, con carpetas) + cloud seguro
(cifrado, para lo más crítico - ahí van naturalmente tickets/facturas de
finance).

### Agent
Agente integrado con cronjobs, análisis, consultas. **Aislado por dominio**:
finance tiene su propio agente específico, no comparte el agente global, para
evitar fuga de datos entre dominios. Acceso a datos locales usa modelo local;
otros casos usan DeepSeek V4 Flash (sujeto a cambio).

### Satellite services
Software externo vendorizado, no propio: Cobalt + spotdl (descargas
customizadas, historial), open-notebook + ideas de RAGFlow/Onyx adaptadas
(sección propia de notebooks).

### Sidecars
Código propio de bajo nivel: Spotify tracker, arranca con Windows, SQLite
propio, sincroniza con el backend vía WebSocket solo mientras la UI está
abierta. Lenguaje a definir al construirlo: el sidecar histórico usaba
Rust/Python, pero queda abierto si el modo dual se logra sin eso.

### Dashboard y Settings
Dash con vista general del sistema. Settings amplio - la mayoría de las
secciones de arriba son configurables/personalizables desde acá.

### Bot de Discord (fuera del alcance inicial)
Permite usar el sistema fuera de casa, con matices de seguridad a definir por
separado. No forma parte del cierre del flujo inicial.

## Decisiones transversales de seguridad (crypto en capas)

No hay un único esquema de cifrado para todo el sistema - el nivel de
seguridad escala según qué protege cada sección:

| Sección | Nivel | Esquema |
|---|---|---|
| Notes | Bajo | Cifrado simple, clave derivada de la passphrase general del sistema |
| APIs / vault | Medio | Argon2id, passphrase separada de la general |
| Accounts | Alto | Zero-knowledge - clave maestra independiente, nunca persistida, **sin mecanismo de recovery** (pérdida de datos aceptada si se olvida, a cambio de seguridad máxima) |

La barrera general (login que bloquea toda la app) y la passphrase de
accounts son **independientes entre sí** - desbloquear la app día a día no
expone la sección más crítica.

Límite aceptado y entendido: esto es cifrado en reposo (protege contra robo
de disco/backup/acceso directo a la DB). No protege contra un proceso en
ejecución con acceso legítimo que sea inducido a actuar mal - ningún esquema
de software resuelve eso del todo (ver AGENTS.md, sección Security, para las
reglas de confirmación que mitigan ese riesgo específico).

## Frontend - sistema de diseño

**Atomic Lazy Design**: versión reducida de Atomic Design, tres capas en vez
de cinco (`components/atoms/` primitivos, `components/molecules/` intermedios,
`components/organisms/` compuestos por dominio) - elegido para evitar el costo
de clasificación de un sistema completo en un proyecto solo.

**Theming modular**: tokens centralizados (`theme/tokens.css`), presets
intercambiables en runtime, fuentes y sonidos como extras plugables,
dark/light + custom desde el día uno.

**Multi-idioma**: español e inglés únicamente.

**Política de sourcing de componentes**: antes de instalar una librería
completa, evaluar si copiar/adaptar el fragmento mínimo necesario alcanza
(estilo shadcn/ui - código copiado al repo, no dependencia opaca). Evita
traer un sistema de theming ajeno que compita con el propio.
