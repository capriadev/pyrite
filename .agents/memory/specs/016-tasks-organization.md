# 016 Tasks organizacion (ficha y estructura)

## Objective

Give tasks their organization layer: a group tree with arbitrary depth
(`freelancer/clientes/cliente-x/proyecto-x`, `eventos` with its birthdays and dates), the
loose classification of a task (sector, priority, state), its descriptive fields
(description plus the existing notes) and the link to a payment expectation. Nothing here
adds recurrence logic: the calendar keeps displaying what the 015 engine materializes, and
kanban is a view over the state field, not a second system.

## Current state (pre-check before this spec)

- Spec 015 built tasks (shell, type, status), the recurrence engine, the financial payload,
  the materialized expectations and the calendar read. `tasks` today: `id`, `title`, `icon`,
  `type`, `status`, `notes`, `starts_on`, timestamps.
- The shared `groups` table (`domain` + `name`, unique per domain) is already the grouping
  system of `apis`, `notes` and `counts` through `GroupsService`. It is flat: no parent.
- p1b asks for folders and free categorization (`trabajo > cliente A/B/C`); the v1 calendar
  already showed folders visually.
- v1 had `description` and `notes`. Both are kept: description is what has to be done (the
  focus), notes is an extra annotation.
- The 015 verification is the regression base: 21 engine assertions and 18 HTTP checks
  (`docs/records/015-calendar-core.md`).

## Scope

- In scope: group tree (`groups.parent_id`), assignment of a task to a group,
  `task_sectors` with creation on the fly from "otro", `tasks.description`,
  `tasks.priority`, `tasks.state`, `tasks.linked_expectation_id`, endpoints for the tree and
  the sectors, and task lists filtered by a branch.
- Out of scope: dates and hours (017), payments v2 (018), notifications (future feature),
  the UI (feature #24) and the agent capture. Kanban as a board is UI work: this spec only
  provides the states it will render.

## Approach

Migration 0009, additive except one index swap:

- `groups.parent_id` uuid nullable, self-FK to `groups.id` with `on delete set null`: the
  tree. Deleting a folder never deletes its children or its tasks.
- **Constraint swap (flagged)**: the current `unique (domain, name)` forbids `clientes` under
  two different parents. It is replaced by two partial unique indexes, one for roots
  (`domain`, `name` where `parent_id is null`) and one for children
  (`domain`, `parent_id`, `name` where `parent_id is not null`). Dropping the old unique
  constraint removes an index, never data.
- `task_sectors`: `id`, `name` (unique), `status`, `created_at`. "Otro" in the form creates
  the sector and it is reused from then on, same idea as the on-the-fly category in finances.
- `tasks` gains: `group_id` (FK `groups`, set null), `sector_id` (FK `task_sectors`, set
  null), `description` text, `priority` enum nullable, `state` enum nullable,
  `linked_expectation_id` (FK `task_expectations`, set null).
- Enums: `task_priority` (`baja`, `media`, `alta`, `critica`) and `task_state`
  (`pendiente`, `en_progreso`, `completado`, `cancelado`). `null` means "sin prioridad" and
  "sin estado": not everything in life has a priority, and a task without a state simply
  does not appear in any board.

## Services and API

- `GroupsService` (shared, extended): `list(domain, parentId?)`, `tree(domain)` nested,
  `create(domain, name, parentId?)`, `rename`, `move(id, parentId)` rejecting cycles (a node
  can never become a child of its own descendant) and `remove` (soft). `tasks` joins the
  `GroupDomain` union.
- `TasksService`: create and update accept `groupId`, `sectorId` (or `sectorName` for the
  "otro" case), `priority`, `state`, `description` and `linkedExpectationId`. Each value is
  validated at the boundary: enum membership, uuid shape, and the linked expectation must
  exist (it may belong to another task: that is exactly how "renovar el dominio" points at
  the domain's payment). Unassigning is an explicit `null`.
- The task list gains `group=<id>&includeDescendants=true`: the branch is resolved with a
  recursive CTE in the DAL, so the tree filter never walks the hierarchy inside the service.
- Gateway: group CRUD with `parentId`, the tree read, the sectors read and the extended
  `/tasks` payload.
- The calendar stays untouched by this spec: state, priority and sector do not change what
  the view shows. The board and the tree are UI concerns over these fields.

Decisions recorded:

- The tree lives in the shared `groups` table instead of a new `task_folders` table: one
  grouping system per repo, and folders for any other domain come for free later.
- Sector is a task field, not a group: the tree is structure, the sector is a loose
  classification, and mixing them would leave two ways of saying the same thing.
- Kanban gets no spec of its own: its columns are `tasks.state` and the ordering inside a
  column belongs to the UI.
- `description` and `notes` are both kept: description is the focus of the task, notes is an
  extra annotation.

## Endpoints

```
GET    /tasks/groups?parentId=          children of a node (roots by default)
GET    /tasks/groups/tree               whole tree of the domain
POST   /tasks/groups                    create under an optional parent
PUT    /tasks/groups/:id                rename or move (cycles rejected)
DELETE /tasks/groups/:id                soft delete: children and tasks stay alive
GET    /tasks/sectors                   list sectors
POST   /tasks/sectors                   create one ("otro" in the form)
GET    /tasks?group=<id>&includeDescendants=true
```

## Acceptance criteria

- [ ] Arbitrary depth works: `freelancer/clientes/cliente-x/proyecto-x` is four levels and
      the list of a branch returns exactly its subtree.
- [ ] The same name is allowed under different parents and rejected at the same level (409).
- [ ] Moving a group keeps its subtree consistent and a cycle is rejected (400), so the tree
      can never become a ring.
- [ ] Soft-deleting a folder leaves its children and its tasks alive (they become roots or
      keep their parent, but never disappear).
- [ ] A task can be assigned, reassigned and unassigned (`null`) to a group.
- [ ] The sector list starts with the fixed set, "otro" creates a sector and the next form
      offers it without recreating it.
- [ ] Priority and state accept `null` and only their enum values; anything else is 400.
- [ ] `linkedExpectationId` accepts an existing expectation and rejects an unknown id (400).
- [ ] The calendar response for a range is byte-identical to the 015 behaviour (this spec
      changes nothing it reads).
- [ ] `npm run tsc` and `npm run build` pass (strict).

## Verification (planned)

- Migration review (0009) with the index swap called out, then apply in `pyrite` and
  `pyrite_test` through the psql workaround of `errors/drizzle-kit-migrate-falla-silenciosa`.
- HTTP smoke extended over the 015 harness (`temp/smoke.mjs`): build the four-level tree,
  assign a task, list its branch, create a sector from "otro" and reuse it, set and clear
  priority and state, link an expectation of its own and reject a foreign one, delete a
  folder and confirm its tasks survive.
- Re-run the 21 engine assertions to confirm the recurrence and expectations are untouched.
- Verification record: `docs/records/016-tasks-organization.md`.

