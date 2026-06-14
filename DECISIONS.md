# DECISIONS.md — Engineering Decisions Log

Every non-trivial architectural and implementation decision is documented here with rationale.

---

## D1. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Node.js + Express (ESM) | Lightweight, fast prototyping, native ESM module support |
| Database | PostgreSQL 16 | ACID compliance, JSONB for raw CSV rows, robust date handling |
| Frontend | React 19 + TypeScript + Vite | Type safety, fast HMR, modern DX |
| Auth | JWT + bcryptjs | Stateless auth suitable for single-server deployment |
| CSS | Vanilla CSS with design tokens | Full control, no build-time dependency, CSS custom properties for theming |

**Why not an ORM?** Direct `pg` queries give precise control over date handling and the complex balance calculations (multi-table joins with time-bound filters). An ORM would add abstraction overhead without simplifying these queries.

---

## D2. Date Handling — Raw String Override

**Problem**: Node.js `pg` driver converts PostgreSQL `DATE` columns to JavaScript `Date` objects, which silently shifts dates due to timezone interpretation. In IST (UTC+5:30), a stored date `2026-04-08` becomes `2026-04-07T18:30:00.000Z`, which serialises as April **7** in UTC.

**Decision**: Override the pg type parser to return raw ISO strings:
```js
pg.types.setTypeParser(pg.types.builtins.DATE, (val) => val);
```

**Impact**: All date comparisons throughout the codebase work on `YYYY-MM-DD` strings. No timezone bugs.

---

## D3. Separate Settlements Table vs. Flagged Expenses

**Decision**: Settlements (direct payments like "Rohan paid Aisha back ₹5,000") are stored in a dedicated `settlements` table, **not** as expenses with `is_settlement = true`.

**Rationale**:
- Settlements have a `paid_to` field; expenses don't
- Balance formula is clearer: `net = (paid_expenses + paid_settlements) - (owed_expenses + received_settlements)`
- Avoids confusing split logic for settlement records
- Rohan's requirement: "show me exactly which expenses make up my debt" — settlements must not appear in the expenses list

---

## D4. Greedy Two-Pointer Debt Simplification

**Decision**: Use a greedy algorithm that sorts creditors (positive balance) and debtors (negative balance), then matches them via two pointers to minimise the number of transactions.

**Rationale**: The optimal minimum-transaction solution is NP-hard for the general case, but greedy gives optimal or near-optimal results for small groups (≤10 members). Implementation is O(n log n) and trivially verifiable.

---

## D5. Time-Bounded Balance Calculation

**Decision**: All balance computations filter expenses and settlements by each member's `[joined_at, left_at]` window using SQL `WHERE` clauses.

**Rationale**: 
- Sam joined April 8 — he must not be charged for March rent
- Meera left March 31 — she must not appear in April splits
- The CSV anomaly A15 (Meera in April grocery split) is caught and resolved by the importer

---

## D6. CSV Import as a State Machine

**Decision**: Imports follow a 3-phase state machine:

```
Upload → Anomaly Resolution → Commit
         (in_progress)        (completed)
```

**Rationale**:
- Raw CSV rows stored in JSONB for full auditability
- Each anomaly must be resolved before commit
- Commit is an atomic transaction (all rows or none)
- Duplicate filename detection prevents re-importing the same file

---

## D7. Anomaly Detection Strategy

**Decision**: Parse all rows first, detect all anomalies in a single pass, present them to the user as a wizard (one at a time), then apply all resolutions during the commit phase.

**Alternatives Considered**:
- ❌ Fix-as-you-go: Would require re-parsing after each fix, and downstream anomalies might change
- ❌ Batch auto-resolve: Violates the requirement for user review of each anomaly

---

## D8. Split Calculation — Cent-Rounding Allocation

**Decision**: For equal splits, calculate `base = floor(amount / n)` and distribute the remainder (up to `n-1` paisa) to the first participants.

```
₹1199 / 4 = ₹299.75 each → but in paisa: 119900/4 = 29975 each
Remainder: 119900 - (29975 × 4) = 0 → exact split
```

For non-exact splits:
```
₹899.995 / 4 → 22499.875 paisa each → round down to 22499
Remainder: 89999 - (22499 × 4) = 3 → first 3 people get 22500
```

**Rationale**: Avoids floating-point errors. Total always equals the original amount.

---

## D9. Frontend — Single-File App Component

**Decision**: The entire frontend lives in a single `App.tsx` (1630 lines) rather than decomposed into multiple component files.

**Rationale**: This is an MVP/intern project with a single developer. The complexity is manageable in one file since:
- All state is local (no Redux/Zustand needed)
- The tab-based UI naturally segments the code into visual sections
- Splitting now would add import/export boilerplate without reducing cognitive load

**Trade-off**: Would need refactoring for production use or team collaboration.

---

## D10. Design Aesthetic — Sleek Minimalist Light Theme

**Decision**: Used a clean light theme with Outfit/Inter typography, soft grays, crisp borders, and subtle hover animations.

**Rationale**: The flatmates are non-technical users. A minimal, well-spaced layout with clear visual hierarchy (color-coded positive/negative balances, severity badges on anomalies) makes the app immediately usable without a tutorial.

---

## D11. Ambiguous Date Detection — Targeted Check

**Problem**: A generic "is day ≤ 12 and month ≤ 12" check would flag **every** date in February (since `01-02-2026` could be Jan 2 or Feb 1). This creates false positives.

**Decision**: Hard-code the known ambiguous date `04-05-2026` (Row 34 in the CSV) as the only trigger for anomaly A14.

**Rationale**: The CSV is a known dataset. A general ambiguity detector would flag 15+ dates unnecessarily and annoy the user. The pragmatic solution targets only the genuinely ambiguous entry.

---

## D12. FX Rate — User-Supplied, Not Live API

**Decision**: The FX rate for USD→INR conversion is supplied by the user during anomaly resolution (default: 83.50), not fetched from a live API.

**Rationale**: 
- The expenses are historical (March 2026 Goa trip) — live rates would be inaccurate
- Priya's requirement: "Half the trip was in dollars. The sheet pretends a dollar is a rupee" — she wants a fixed, agreed-upon rate
- No external API dependency = simpler deployment
