# Finances core (sub-spec A)

## Objective
Build the core of the finances domain: categories, platforms (wallets), balances, and movements with effective-rate conversion snapshots and balance_source tracking. This is the backend foundation for all of finance; visuals and dolarapi come in later sub-specs.

## Scope
- In scope:
  - Tables: `categories` (name, type income/expense, status soft-delete), `platforms` (wallet names: MP, Uala...), `balances` (key: cash_ars|digital_ars|cash_usd|digital_usd, amount), `movements` (see approach).
  - DAL/BLL/Gateway: CRUD for movements, categories, platforms, balances.
  - BLL balance logic: income adds to balance_source, expense subtracts; soft-delete restores; edit adjusts the difference.
  - Category "Otro" mk: create-on-the-fly from the form, persisted, separated by type.
  - Effective rate snapshot: paid_amount / amount, stored immutable.
- Out of scope:
  - Dolarapi sync + auto-conversion (sub-spec B).
  - Views/gnets/filters (sub-spec C).
  - Wallet yields, Mercado Pago API integration, pending-review auto-import.
  - EUR/BRL/UYU, stocks, crypto.
  - Any UI - backend only.

## Approach
- `movements`: id uuid, type, amount_currency ('ARS'|'USD'), amount numeric(14,2), paid_currency, paid_amount numeric(14,2), rate_used numeric(14,4) (computed = paid_amount/amount, snapshot), balance_source enum balance key, category_id FK, platform_id FK nullable, description text, note text nullable, date timestamptz, status soft-delete, timestamps.
- Money stored numeric(14,2) - never float. Conversion rate computed at creation and stored immutable.
- Status 'active'|'deleted' for soft delete on categories, platforms, movements.
- Money edits adjust balances in one transaction.

## Acceptance criteria
- [ ] Backend CRUD for movements, categories, platforms, balances.
- [ ] Creating an expense decrements its balance_source; an income increments it.
- [ ] Soft-deleting a movement restores its balance contribution, not hard-deleted.
- [ ] rate_used is computed = paid_amount / amount and stored at creation.
- [ ] Category "Otro" creation from the form persists and is reusable.
- [ ] `npm run tsc` passes (strict).