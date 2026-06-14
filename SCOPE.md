# SCOPE.md — Shared Expenses Tracker

## 1. Overview

A full-stack shared expenses web application for flatmates (Aisha, Rohan, Priya, Meera, Sam, Dev) to track, split, import, and settle group expenses. Data originates from a messy CSV spreadsheet export (`Expenses Export.csv`) that must be parsed, validated, and cleaned through an interactive anomaly-resolution wizard.

## 2. Core Features

| Feature | Description |
|---------|-------------|
| **Authentication** | JWT-based sign-up & login (bcryptjs password hashing) |
| **Group Management** | Create groups, add/remove members with time-bounded membership dates (joined_at, left_at) |
| **Expense Tracking** | Add expenses with support for equal, unequal, percentage, and share-based splits |
| **Multi-Currency** | Expenses in USD or INR with user-supplied FX rate conversion |
| **Settlement Recording** | Record direct payments between members (separate from expenses) |
| **Balance Engine** | Compute net balances respecting membership time bounds; greedy simplified debt settlement graph |
| **Audit Drilldown** | Per-member ledger showing every paid expense, owed split, paid settlement, and received settlement |
| **CSV Importer** | Upload CSV → detect anomalies → interactive resolution wizard → atomic commit to DB |
| **Import Report** | Post-commit summary: rows imported, anomalies detected, resolutions applied |

## 3. CSV Anomaly Catalogue

The importer detects **18 distinct anomaly types** from the messy CSV:

| Code | Anomaly | Example Row | Default Resolution | [Import action] |
|------|---------|------------|-------------------|-----------------|
| A1 | Duplicate expense (exact match) | Rows 5 & 6 — "Dinner at Marina Bites" | Keep one, discard the other | Discarded duplicate Row 6, kept Row 5 |
| A2 | Comma in amount field | Row 7 — `"1,200"` | Strip commas, parse as 1200 | Stripped comma to import amount as 1200.00 INR |
| A3 | Payer name variant / not recognised | Row 11 — "Priya S" | Map to closest member ("Priya") | Mapped payer "Priya S" to group member "Priya" |
| A4 | Missing payer | Row 13 — empty paid_by | User assigns a payer | Assigned group member "Priya" as payer |
| A5 | Settlement mislabelled as expense | Row 14 — "Rohan paid Aisha back" | Import as settlement record | Imported as a settlement record in the settlements table |
| A6 | Percentage split sums ≠ 100% | Row 15 — sums to 110% | User corrects percentages | Adjusted split details to: Aisha 30%, Rohan 20%, Priya 30%, Meera 20% |
| A7 | Foreign currency (USD) needs FX rate | Rows 20, 21, 23, 26 | User supplies FX rate (e.g. 83.50) | Applied FX rate of 83.50 to convert USD to INR |
| A8 | Non-member participant | Row 23 — "Dev's friend Kabir" | Redistribute Kabir's share among members | Redistributed Kabir's share among Aisha, Rohan, Priya, Meera, Dev |
| A9 | Conflicting duplicate (different amounts) | Rows 24 & 25 — Thalassa dinner | Keep correct version, discard other | Discarded duplicate Row 24, kept Row 25 |
| A10 | Negative amount (refund) | Row 26 — `-30 USD` | Import as refund (negative expense) | Imported as a negative expense (refund) with FX rate 83.50 |
| A11 | Non-standard date format | Row 27 — `Mar-14` | Confirm interpreted date (2026-03-14) | Confirmed date as 2026-03-14 |
| A12 | Missing currency | Row 28 — empty currency | Confirm as INR | Confirmed currency as INR |
| A13 | Zero amount | Row 31 — `0 INR` | Skip / discard | Skipped and discarded row |
| A14 | Ambiguous DD-MM vs MM-DD date | Row 34 — `04-05-2026` | User confirms correct date | Confirmed date as 2026-04-05 |
| A15 | Inactive member in split | Row 36 — Meera after she left Mar 31 | Exclude from split | Excluded Meera from the April split |
| A16 | Deposit/settlement not an expense | Row 38 — "Sam deposit share" | Import as settlement | Imported as a settlement record (Sam paid ₹2,500) |
| A17 | Split type/details conflict | Row 42 — `equal` with share details | Import as equal (ignore share details) | Imported as equal split, ignoring raw share details |
| A18 | Payer name casing mismatch | Rows 9, 27 — `priya`, `rohan` | Normalise to canonical case | Normalised name casing to canonical "Priya" and "Rohan" |

## 4. Database Schema

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│    users     │     │  group_members   │     │    groups     │
├──────────────┤     ├──────────────────┤     ├──────────────┤
│ id (PK)      │◄───┤ user_id (FK)     │     │ id (PK)      │
│ name         │     │ group_id (FK)    ├────►│ name         │
│ email (UQ)   │     │ joined_at (DATE) │     │ created_by   │
│ password_hash│     │ left_at (DATE)   │     │ created_at   │
│ created_at   │     │ id (PK)          │     └──────────────┘
└──────────────┘     └──────────────────┘
        │                                            │
        │            ┌──────────────────┐            │
        └───────────►│    expenses      │◄───────────┘
                     ├──────────────────┤
                     │ id (PK)          │     ┌──────────────────┐
                     │ group_id (FK)    │     │  expense_splits  │
                     │ description      │     ├──────────────────┤
                     │ paid_by (FK)     │◄───┤ expense_id (FK)  │
                     │ amount_original  │     │ user_id (FK)     │
                     │ currency_original│     │ share_amount_inr │
                     │ amount_inr       │     │ share_raw        │
                     │ fx_rate          │     │ id (PK)          │
                     │ split_type       │     └──────────────────┘
                     │ expense_date     │
                     │ notes            │     ┌──────────────────┐
                     │ is_settlement    │     │   settlements    │
                     │ import_source    │     ├──────────────────┤
                     └──────────────────┘     │ id (PK)          │
                                              │ group_id (FK)    │
┌──────────────────┐                          │ paid_by (FK)     │
│ import_sessions  │                          │ paid_to (FK)     │
├──────────────────┤                          │ amount_inr       │
│ id (PK)          │     ┌──────────────────┐ │ settlement_date  │
│ group_id (FK)    │     │ import_anomalies │ │ notes            │
│ imported_by (FK) │     ├──────────────────┤ └──────────────────┘
│ filename         │     │ id (PK)          │
│ raw_rows (JSONB) │◄───┤ session_id (FK)  │
│ started_at       │     │ row_number       │
│ completed_at     │     │ raw_row (JSONB)  │
│ status           │     │ anomaly_type     │
└──────────────────┘     │ description      │
                         │ severity         │
                         │ resolution       │
                         └──────────────────┘
```

### Table Details

| Table | Columns | Purpose |
|-------|---------|---------|
| `users` | id, name, email, password_hash, created_at | User accounts |
| `groups` | id, name, created_by, created_at | Expense groups |
| `group_members` | id, group_id, user_id, joined_at, left_at | Time-bounded membership |
| `expenses` | id, group_id, description, paid_by, amount_original, currency_original, amount_inr, fx_rate, split_type, expense_date, notes, is_settlement, import_source, created_at | Expense records |
| `expense_splits` | id, expense_id, user_id, share_amount_inr, share_raw, created_at | Per-user share of each expense |
| `settlements` | id, group_id, paid_by, paid_to, amount_inr, settlement_date, notes, created_at | Direct payments between members |
| `import_sessions` | id, group_id, imported_by, filename, raw_rows, started_at, completed_at, status | CSV import session state machine |
| `import_anomalies` | id, session_id, row_number, raw_row, anomaly_type, description, severity, resolution, resolved_at, resolved_by | Per-row anomalies and their resolutions |

## 5. Membership Timeline

```
Feb 1 ──────────────────────────────────────────────────► Present
  Aisha  ████████████████████████████████████████████████
  Rohan  ████████████████████████████████████████████████
  Priya  ████████████████████████████████████████████████
  Meera  ██████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░  (left Mar 31)
  Dev    ░░░░████████████████████████████░░░░░░░░░░░░░░░  (Mar 1 → Apr 30)
  Sam    ░░░░░░░░░░░░░░░░░░░░░░░░░░░██████████████████  (joined Apr 8)
```

## 6. Balance Formula

```
net_balance = (paid_expenses + paid_settlements) − (owed_expenses + received_settlements)
```

- **Positive**: group owes this member money
- **Negative**: this member owes the group
- **Time-bounded**: only expenses/settlements within a member's `[joined_at, left_at]` window count
