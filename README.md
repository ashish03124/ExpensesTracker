# Spreetail Shared Expenses Tracker

A full-stack shared expenses web application for flatmates to track, split, import, and settle group expenses — built with Node.js, React, TypeScript, and PostgreSQL.

Developed with **AI Assistance** (Google DeepMind's Antigravity pair programmer using Gemini 3.5 Flash and Claude 3.5 Sonnet models). Detailed AI prompts and bug corrections are documented in [AI_USAGE.md](./AI_USAGE.md).

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14 running on port 5432
- **npm** ≥ 9

### 1. Install Dependencies

```bash
npm run install:all
```

### 2. Configure Database

Create a PostgreSQL database named `expense_tracker`, then copy the environment file:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your PostgreSQL credentials:

```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password_here
PGDATABASE=expense_tracker
JWT_SECRET=your_jwt_secret_here
```

### 3. Run Migrations & Seed Data

```bash
npm run migrate
npm run seed
```

This creates 8 database tables and seeds 6 users (Aisha, Rohan, Priya, Meera, Sam, Dev) with a group "Flat 204B" and their membership dates.

### 4. Start Development Servers

```bash
npm run dev
```

This runs both servers concurrently:
- **Backend**: http://localhost:5000
- **Frontend**: http://localhost:5173

### 5. Login

Use any seeded user (password for all: `password123`):

| User | Email |
|------|-------|
| Aisha | aisha@example.com |
| Rohan | rohan@example.com |
| Priya | priya@example.com |
| Meera | meera@example.com |
| Sam | sam@example.com |
| Dev | dev@example.com |

---

## Project Structure

```
ExpenseTracker/
├── backend/
│   ├── db/
│   │   ├── db.js              # PostgreSQL connection pool
│   │   ├── migrations.js      # Schema creation (8 tables)
│   │   └── seeds.js           # Initial user/group data
│   ├── routes/
│   │   ├── auth.js            # JWT authentication
│   │   ├── groups.js          # Group & member CRUD
│   │   ├── expenses.js        # Expense + split engine
│   │   ├── balances.js        # Balance calculation + settlement graph
│   │   └── import.js          # CSV parser + anomaly wizard + commit
│   ├── tests/
│   │   └── verify.js          # End-to-end verification suite
│   ├── server.js              # Express app entry point
│   └── .env                   # Environment configuration
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main React application (all tabs + wizard)
│   │   └── index.css          # Design system (CSS custom properties)
│   └── package.json
├── Expenses Export.csv         # Original messy CSV (do not modify)
├── SCOPE.md                   # Feature scope & anomaly catalogue
├── DECISIONS.md               # Engineering decisions log
├── AI_USAGE.md                # AI assistance log
└── README.md                  # This file
```

---

## Features

### Dashboard
- Group members with membership dates
- Net balance summary with colour-coded indicators (green = owed money, red = owes money)
- Click any member to drill down into their full audit trail

### Expenses & Splits
- Add expenses with 4 split types: equal, unequal, percentage, share
- Multi-currency support (INR/USD with FX rate)
- Record direct settlements between members
- Settlement history table

### Balances & Debt Settlement
- Per-member balance breakdown (paid, owed, settlements)
- Greedy simplified debt settlement graph (minimum transactions)
- Time-bounded calculations respecting membership dates

### CSV Importer
- Upload the messy `Expenses Export.csv`
- Interactive anomaly wizard resolves 18 data quality issues one-by-one
- Atomic commit to database with full import report

---

## Running Tests

Ensure the backend server is running, then:

```bash
node backend/tests/verify.js
```

The test suite:
1. Authenticates as Aisha
2. Uploads the CSV and receives 21 anomalies
3. Resolves all anomalies programmatically
4. Commits the import session
5. Verifies Sam has zero pre-membership transactions
6. Verifies Meera has zero post-membership transactions
7. Verifies Rohan's ₹5,000 settlement is recorded correctly
8. Outputs the simplified debt settlement graph

> **Note**: Tests require a fresh database. Run `npm run migrate && npm run seed` before each test run.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get JWT token |
| GET | `/api/groups` | List user's groups |
| GET | `/api/groups/:id` | Get group with members |
| POST | `/api/groups` | Create group |
| POST | `/api/groups/:id/members` | Add member |
| GET | `/api/groups/:id/expenses` | List expenses |
| POST | `/api/groups/:id/expenses` | Add expense |
| GET | `/api/groups/:id/settlements` | List settlements |
| POST | `/api/groups/:id/settlements` | Record settlement |
| GET | `/api/groups/:id/balances` | Get balances + suggested settlements |
| GET | `/api/groups/:id/balances/:userId/drilldown` | Audit trail for a member |
| POST | `/api/groups/:id/import` | Upload CSV |
| POST | `/api/groups/:id/import/anomalies/:anomalyId/resolve` | Resolve anomaly |
| POST | `/api/groups/:id/import/sessions/:sessionId/commit` | Commit import |

---

## Documentation

- **[SCOPE.md](./SCOPE.md)** — Full feature scope, anomaly catalogue, and database schema
- **[DECISIONS.md](./DECISIONS.md)** — Engineering decisions with rationale
- **[AI_USAGE.md](./AI_USAGE.md)** — AI assistance log and corrections
