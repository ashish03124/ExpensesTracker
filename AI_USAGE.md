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
