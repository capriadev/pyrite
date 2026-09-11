# Backend structure - organize layers by domain

## Objective
Reorganize the backend layer folders (dal/, bll/, gateway/, services/) into subfolders by domain, and relocate the loose crypto/ and auth/ files into their proper architectural homes. Pure refactor - zero behavior change, so it scales without collision/name conflicts as the system grows.

## Scope
- In scope:
  - Move repositories into `dal/<domain>/`: finances, apis, settings, rates.
  - Move services into `bll/<domain>/`: finances, apis, settings, rates, auth (AuthService is domain logic).
  - Move controllers into `gateway/<domain>/`: finances, apis, settings, rates, auth (AuthController is gateway concern).
  - Relocate `crypto/` -> `services/crypto/` (CryptoService is a cross-cutting shared service, per architecture.md).
  - Update all imports and module wiring (DalModule, BllModule, GatewayModule, ServicesModule).
- Out of scope:
  - Any behavior or feature change.
  - Moving integrations/ (already organized by provider).
  - Frontend.

## Approach
- Pure `git mv` + import path updates + module registration updates.
- Verify with `tsc`, build, health, and a smoke check of each domain endpoint.

## Acceptance criteria
- [ ] All files in dan dal/bll/gateway are under their domain subfolder; cryptography under services/crypto/.
- [ ] `npm run tsc` passes (strict).
- [ ] Build passes; `/health` returns 200; a smoke of each domain (settings, finances, rates, apis, auth) works.