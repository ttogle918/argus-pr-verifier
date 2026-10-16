# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Global Default Deny**: Any path not explicitly matched under `/translations/{translationId}` is strictly denied (`allow read, write: if false;`).
2. **Verified Identity**: Only authenticated users with `request.auth != null && request.auth.token.email_verified == true` can read or write `/translations/{translationId}`.
3. **Owner Binding & Immutability**: `ownerId` must match `request.auth.uid` on creation and cannot be mutated on update (`incoming().ownerId == existing().ownerId`).
4. **Strict Key & Size Enforcement**: Every string (`prId`, `lang`, `prTitle`, `prDescription`, `executiveSummary`, `ownerId`) and bounded array (`invariants`, `tests`, `plantedBugs`, `residualRisks`, `sandboxSteps` with `.size() <= 10`) is validated via `isValidPrTranslation()`.
5. **Temporal Integrity**: `createdAt` must equal `request.time` on create and remain immutable on update; `updatedAt` must equal `request.time` on create and update.
6. **Query Enforcement**: `allow list` restricts reads to documents where `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Payloads
1. Unauthenticated write attempt (`request.auth == null`) -> `PERMISSION_DENIED`
2. Unverified email write attempt (`email_verified == false`) -> `PERMISSION_DENIED`
3. Shadow field injection (`isAdmin: true` added to payload) -> `PERMISSION_DENIED`
4. Identity spoofing (`ownerId != request.auth.uid` on create) -> `PERMISSION_DENIED`
5. Owner hijacking (`incoming().ownerId != existing().ownerId` on update) -> `PERMISSION_DENIED`
6. Invalid document ID poisoning (`translationId` > 128 chars or special chars) -> `PERMISSION_DENIED`
7. Oversized `prTitle` (> 500 chars) -> `PERMISSION_DENIED`
8. Oversized `executiveSummary` (> 4000 chars) -> `PERMISSION_DENIED`
9. Invalid `lang` enum value (`lang: "fr"`) -> `PERMISSION_DENIED`
10. Unbounded array exhaustion (`invariants.size() > 10`) -> `PERMISSION_DENIED`
11. Forged client `createdAt` timestamp (`createdAt != request.time`) -> `PERMISSION_DENIED`
12. Unauthorized cross-user `get` or `list` where `resource.data.ownerId != request.auth.uid` -> `PERMISSION_DENIED`
