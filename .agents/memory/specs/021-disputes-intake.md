# 021 Disputes intake

> DRAFT: written before spec 019 is implemented, not committed on purpose. Depends on 019
> (links and disputes) and on 020 (scoring); anything they change is adjusted here before
> this spec is committed.

## Objective

Close the circuit in the other direction. Up to now the engine looks at what tasks expected
and asks about the money; this spec makes finances the entry point: when a movement lands in
a service or subscription category, the system answers three questions by itself (does it
belong to an existing expectation? does it belong to a task that has no expectation there?
is this something new?) and, in the last case, offers to create the task with the payload
already filled. It also gives those tasks a home: the system group `finances/`, which the
engine uses by default and whose destination the user can point somewhere else.

## Scope

- In scope: the detection triggered when a movement is saved; the suggestion payload for
  creating a task from a movement; the `finances/` system group with its `is_system` flag,
  the configurable destination and the id-based rotation; the endpoints.
- Out of scope: the modal itself and its pre-filled form (UI #24), the notifications
  (#27), and the rest of the engine (019, 020).

## Approach

### A marker for service categories (decision taken while planning the code)

The spec originally said "a movement in a service or subscription category", but nothing in
the schema said what a service category is, and without a marker the engine would either never
fire the question or ask about every ordinary purchase, which the user forbade ("never nag
about a plain purchase"). So `categories` gains `isService` (boolean, default false): marking
a category as a service or subscription category in the finances screen is what turns the
intake question on for it. A movement in a category that is not marked and has no declared
payment task produces no question at all - case 4 of the detection stays silent by design.

### Detection on movement save

The hook lives on the finances create path, wrapped so the engine can never break a movement:
if the intake fails, the movement is already saved and the error is logged, never returned as a
500. The engine reads, the finances service writes.

1. **Linked**: the category is declared by a payment task and an expectation of that task is
   inside its window -> the engine links it and the response carries the auto-link event for
   the side notification.
2. **Task without expectation**: the category belongs to a payment task with no expectation
   there (paused, finished or a one-off) -> `existing_task` with that task id.
3. **New**: the category is marked as a service and has no payment task -> `new_task` with the
   pre-filled draft.
4. **Nothing of the above** (a plain expense) -> no interaction at all.

One hook on the finances create/update path (no second code path: the movement service calls
the engine, the engine never writes movements):

1. **Linked**: the category is declared by a payment task and an expectation of that task is
   inside its window -> the engine links it, same transaction as the movement insert, and the
   UI gets the auto-link event for its side notification.
2. **Task without expectation**: the category belongs to a payment task whose series has no
   expectation there (paused, finished, or a one-off) -> suggestion "does this belong to
   <task>? yes / no, it is something else".
3. **New**: the category has no payment task -> question "is this a new subscription or
   service?" and, on yes, the payload below.
4. **Nothing of the above** (a plain expense category): no interaction, the engine stays out
   of the way. The user's rule: never nag about an ordinary purchase.

### The pre-filled payload

The suggestion is a JSON shape, not a form: the UI decides how to render it.

```
{
  "kind": "new_task" | "existing_task",
  "taskId": null,
  "draft": {
    "type": "pago",
    "title": "<movement.description>",
    "description": "<movement.note>",
    "sectorId": null,
    "groupId": "<finances group id>",
    "startsOn": "<movement.date>",
    "payment": { "mode": "recurrente", "priceFixed": true, "price": "<movement.amount>",
                 "currency": "<movement.amountCurrency>" },
    "categoryIds": ["<movement.categoryId>"]
  }
}
```

The amount is copied as the fixed price **only** because the user said "yes, it is a new
subscription": the linkage of the movement happens after the task exists, and the amount
stays an estimate, never authority (spec 005 rule).

### System group

- `groups` gains `isSystem` (boolean, default false). The boot routine creates
  `finances/` (domain `tasks`, root, `isSystem: true`) if it is missing; the groups service
  refuses to rename or delete a system node, and the tree API marks it so the UI can hide
  those actions.
- Subfolders (`suscripciones/`, `servicios/`) are **not** created: supported but manual, as
  decided. The engine does not impose them.
- Destination: setting `tasks.finances_group_id`, default the system group. Pointing it at
  another existing group is allowed; the engine always resolves the destination by id, so
  rotating it leaves the tasks already created where they are and only new ones land in the
  new group. Renaming the group changes nothing (id is stable).

### Migration 0014 (additive)

- `groups.is_system` boolean not null default false.
- `categories.is_service` boolean not null default false: the marker that turns the intake
  question on for that category.
- `dispute_intake_dismissals`: `movementId` primary key + `createdAt`. Dismissing remembers the
  movement so the same question is not asked twice, and the movement stays linkable by hand.
- Settings: `tasks.finances_group_id` (nullable; null means the system group).


## Endpoints

```
POST /finances/movements            unchanged shape; the response now carries
                                    { intake: { kind, taskId?, draft? } } when the engine
                                    has something to ask or offer
POST /disputes/intake/confirm       { movementId, kind: 'new_task' | 'existing_task',
                                      taskId?, draft? }  creates or links
POST /disputes/intake/dismiss       { movementId }  "no, it is nothing of the sort"; the
                                    movement is remembered so the question is not asked again
GET  /tasks/groups/system           the system groups of the tree (finances/ and its flag)
```

## Acceptance criteria

- [ ] Saving a movement in a declared category with an expectation inside the window links it
      in the same transaction and returns no question.
- [ ] Saving a movement in a declared category whose task has no expectation there returns
      `kind: existing_task` with that task id.
- [ ] Saving a movement in a category with no payment task returns `kind: new_task` with the
      draft filled from the movement (title, note as description, amount, currency, date,
      category) and the destination group already set.
- [ ] Confirming `new_task` creates the task in `finances/`, links the movement to it and the
      task series generates its expectations from the movement date.
- [ ] Dismissing remembers the movement: the question is not asked again, and the movement
      can still be linked by hand later.
- [ ] A movement in an ordinary expense category produces no question at all.
- [ ] `finances/` exists after a fresh boot, is marked `isSystem`, and the groups API refuses
      to rename or delete it.
- [ ] Renaming the destination group in settings keeps existing tasks in the group they were
      created in, and new ones use the new destination.
- [ ] Deleting the group the setting points at falls back to the system group instead of
      failing.

## Recorded for later (not built here)

- Notifications (#27): auto-link raises a side notification ("this payment was linked to X,
  task <-> finances") while a doubt is a modal. The engine section of the UI is for viewing,
  correcting and analysing links and histories only; metrics belong to the system dash,
  cached and recalculated on change (Redis, to be analysed when the frontend is built).
