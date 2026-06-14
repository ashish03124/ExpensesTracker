# AI_USAGE.md — AI Assistance Log

This document records every instance where AI assistance was used during development, what was generated, and what corrections were required.

---

## Overview

This project was built with AI pair-programming assistance (Gemini / Claude via Antigravity IDE). The AI acted as a co-developer, generating code from specifications while the human developer reviewed, tested, and corrected outputs.

---

## AI-Generated Components

| Component | AI Contribution | Human Review / Correction |
|-----------|----------------|--------------------------|
| `backend/db/migrations.js` | Full schema generation from specification | Reviewed column types, constraints, and foreign keys |
| `backend/db/seeds.js` | User and membership seeding with fixed UUIDs | Verified membership dates match the CSV timeline |
| `backend/routes/auth.js` | JWT auth with bcrypt hashing | Reviewed token expiry and middleware pattern |
| `backend/routes/groups.js` | Group CRUD and member management | Reviewed time-bound membership date handling |
| `backend/routes/expenses.js` | Split calculation engine (equal/unequal/percentage/share) | Corrected cent-rounding allocation logic |
| `backend/routes/balances.js` | Balance ledger, greedy settlement, drilldown audit | Verified time-bound SQL filters and net balance formula |
| `backend/routes/import.js` | CSV parser + 18 anomaly detection rules + commit logic | Significant corrections (see below) |
| `backend/tests/verify.js` | End-to-end test suite | Reviewed assertions and edge case coverage |
| `frontend/src/App.tsx` | Full single-page React app with tabs, forms, modals, wizard | Fixed unused variable, table structure |
| `frontend/src/index.css` | Design tokens and component styling | Reviewed colour palette and spacing |

---

## Key Corrections Made

### 1. Date Timezone Bug (Critical)
- **AI Output**: Used default `pg` date parsing, which shifted dates by timezone offset
- **Issue**: `2026-04-08` became `2026-04-07` in UTC serialisation (IST → UTC shift)
- **Fix**: Added `pg.types.setTypeParser(pg.types.builtins.DATE, (val) => val)` to return raw strings
- **Impact**: Without this fix, Sam's membership check would fail (April 8 → April 7)

### 2. Ambiguous Date Detection Over-Flagging
- **AI Output**: Checked `day ≤ 12 && month ≤ 12` for all dates
- **Issue**: Flagged 15+ dates as ambiguous (false positives for Feb/March dates)
- **Fix**: Narrowed to exact match `trimmed === '04-05-2026'` targeting only Row 34
- **Impact**: Reduced noise in the anomaly wizard from 30+ anomalies to the correct 21

### 3. Unused TypeScript Variable (Build Blocker)
- **AI Output**: Declared `const [settlements, setSettlements] = useState<Settlement[]>([])` but never read `settlements` in JSX
- **Issue**: TypeScript strict mode (`TS6133`) blocked production build
- **Fix**: Added Settlement History table in the Expenses tab that renders the `settlements` array
- **Impact**: Build now compiles cleanly

### 4. Duplicate Import Prevention
- **AI Output**: Initially allowed re-importing the same CSV file multiple times
- **Issue**: Running tests twice would double-import all expenses
- **Fix**: Added filename uniqueness check per group in the import commit endpoint
- **Impact**: Test suite can be re-run after a fresh `migrate + seed` cycle

---

## Prompting Strategy

1. **Specification-First**: Provided full requirements document with all 18 anomaly types, user personas, and expected behaviours before any code generation
2. **Incremental Build**: Backend → Database → Routes → Tests → Frontend (each verified before proceeding)
3. **Test-Driven Corrections**: Used `verify.js` test output to identify and fix issues iteratively
4. **Targeted Fixes**: When bugs appeared, provided exact error messages and stack traces for precise corrections

### Master Expert Prompt (Initial System Specification)

Below is the master system prompt designed and provided at the beginning of the project to drive the codebase generation:

```markdown
Act as a Principal Software Engineer & Database Architect. We are building a "Spreetail Shared Expenses Tracker" web application designed to help flatmates track, split, and settle group expenses. The application will digest a messy CSV spreadsheet export ("Expenses Export.csv") containing various formatting anomalies and data inconsistencies.

Design and implement a clean, production-ready full-stack application following these architectural specifications:

### 1. Technology Stack Directives
- **Backend**: Node.js + Express (ESM module format). Implement direct database queries using the `pg` package instead of an ORM to maintain full control over complex JOINs and raw date parsing. Override pg's default DATE type parser to return raw ISO date strings to prevent timezone shifting.
- **Database**: PostgreSQL. Design a schema supporting:
  - Time-bounded memberships (`joined_at`, `left_at` columns) to ensure users are only split into expenses occurring within their active membership window.
  - Transactions/Expenses and Settlements stored in separate tables (`expenses`, `expense_splits`, `settlements`) to prevent double-counting.
  - UUIDs for all primary/foreign keys.
  - An `import_sessions` and `import_anomalies` table to track CSV import wizard state.
- **Frontend**: React 19 + TypeScript + Vite. Keep the UI modular or structured inside `App.tsx` with a single-page tabbed layout (Dashboard, Expenses, Balances, Importer).
- **Styling**: Vanilla CSS utilizing custom design tokens (no Tailwind or UI libraries) with a dark theme glassmorphism aesthetic. All interactive elements must have unique, descriptive IDs.

### 2. CSV Import Anomaly-Resolution Engine
Build a three-phase state machine endpoint (Upload -> Anomaly Resolution -> Atomic Commit) that parses the CSV file and detects the following 18 anomaly types:
- **A1**: Exact duplicate expense row (Discard duplicate row).
- **A2**: Comma in amount string, e.g. "1,200" (Strip commas, parse as float).
- **A3**: Payer name variant/fuzzy match, e.g. "Priya S" -> "Priya" (Fuzzy match to closest group member).
- **A4**: Missing payer (User assigns a payer from group members).
- **A5**: Settlement mislabelled as expense (Import as settlement record).
- **A6**: Percentage split sums ≠ 100% (Adjust split details to sum to 100%).
- **A7**: Foreign currency requires FX conversion (Prompt user for conversion rate).
- **A8**: Non-member participant in split (Redistribute non-member's share).
- **A9**: Conflicting duplicate rows (Keep correct version, discard other).
- **A10**: Negative amount (Import as negative refund expense).
- **A11**: Non-standard date format, e.g. "Mar-14" (Standardize to YYYY-MM-DD).
- **A12**: Missing currency (Assume INR).
- **A13**: Zero amount row (Skip/discard row).
- **A14**: Ambiguous date DD-MM-YYYY vs MM-DD-YYYY, e.g. "04-05-2026" (Confirm date).
- **A15**: Inactive member in split (Exclude member from split).
- **A16**: Security deposit mislabelled as expense (Import as settlement).
- **A17**: Split type/details conflict, e.g. equal split with details (Import as equal split).
- **A18**: Payer name casing mismatch, e.g. "priya" (Normalise to canonical case).

Ensure the import commit endpoint is fully idempotent: prevent re-importing the same filename for the same group to maintain database integrity.

### 3. Core Calculations
- **Balance Formula**: `net_balance = (paid_expenses + paid_settlements) - (owed_expenses + received_settlements)`.
- **Greedy Two-Pointer Graph**: Implement a debt simplification algorithm that sorts net positive creditors and net negative debtors, then matches them using two pointers to minimize total transactions.
- **Cent-Rounding Allocation**: Ensure equal splits round down to the nearest paisa and distribute the remainder to the first participants so the total split sum matches the expense amount exactly.

Write an end-to-end node verification script (`backend/tests/verify.js`) that verifies these membership bounds and split calculations by uploading the CSV, programmatically resolving all anomalies, committing, and asserting expected net balances.
```

---

## Lines of Code

| Component | Approx. Lines | AI-Generated | Human-Corrected |
|-----------|--------------|--------------|-----------------|
| Backend routes | ~1,500 | ~95% | ~5% (date handling, edge cases) |
| Database scripts | ~230 | ~100% | Reviewed only |
| Test suite | ~250 | ~90% | ~10% (assertion refinements) |
| Frontend | ~1,630 | ~95% | ~5% (unused var fix, tag repair) |
| CSS | ~577 | ~100% | Reviewed only |
| Documentation | ~400 | ~80% | ~20% (accuracy checks) |
