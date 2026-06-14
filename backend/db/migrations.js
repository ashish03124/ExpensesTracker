import pool from './db.js';

const up = async () => {
  const client = await pool.connect();
  try {
    console.log('Starting migration...');
    await client.query('BEGIN');

    // Drop tables if they exist (in reverse dependency order)
    await client.query('DROP TABLE IF EXISTS import_anomalies CASCADE');
    await client.query('DROP TABLE IF EXISTS import_sessions CASCADE');
    await client.query('DROP TABLE IF EXISTS settlements CASCADE');
    await client.query('DROP TABLE IF EXISTS expense_splits CASCADE');
    await client.query('DROP TABLE IF EXISTS expenses CASCADE');
    await client.query('DROP TABLE IF EXISTS group_members CASCADE');
    await client.query('DROP TABLE IF EXISTS groups CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('Tables dropped successfully.');

    // 1. Users
    await client.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // 2. Groups
    await client.query(`
      CREATE TABLE groups (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // 3. Group Members (with time bounds)
    await client.query(`
      CREATE TABLE group_members (
        id UUID PRIMARY KEY,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        joined_at DATE NOT NULL,
        left_at DATE,
        UNIQUE (group_id, user_id, joined_at)
      )
    `);

    // 4. Expenses
    await client.query(`
      CREATE TABLE expenses (
        id UUID PRIMARY KEY,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        paid_by UUID REFERENCES users(id) ON DELETE CASCADE,
        amount_original NUMERIC(12,4) NOT NULL,
        currency_original CHAR(3) NOT NULL DEFAULT 'INR',
        amount_inr NUMERIC(12,4) NOT NULL,
        fx_rate NUMERIC(10,6),
        split_type TEXT NOT NULL CHECK (split_type IN ('equal','unequal','percentage','share','settlement')),
        expense_date DATE NOT NULL,
        notes TEXT,
        is_settlement BOOLEAN DEFAULT FALSE,
        import_source TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // 5. Expense Splits
    await client.query(`
      CREATE TABLE expense_splits (
        id UUID PRIMARY KEY,
        expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        share_amount_inr NUMERIC(12,4) NOT NULL,
        share_raw TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // 6. Settlements
    await client.query(`
      CREATE TABLE settlements (
        id UUID PRIMARY KEY,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        paid_by UUID REFERENCES users(id) ON DELETE CASCADE,
        paid_to UUID REFERENCES users(id) ON DELETE CASCADE,
        amount_inr NUMERIC(12,4) NOT NULL,
        settlement_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // 7. Import Sessions
    await client.query(`
      CREATE TABLE import_sessions (
        id UUID PRIMARY KEY,
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
        imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
        filename TEXT,
        started_at TIMESTAMPTZ DEFAULT now(),
        completed_at TIMESTAMPTZ,
        status TEXT CHECK (status IN ('in_progress','awaiting_review','completed','aborted'))
      )
    `);

    // 8. Import Anomalies
    await client.query(`
      CREATE TABLE import_anomalies (
        id UUID PRIMARY KEY,
        session_id UUID REFERENCES import_sessions(id) ON DELETE CASCADE,
        row_number INT,
        raw_row JSONB,
        anomaly_type TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT CHECK (severity IN ('error','warning','info')),
        resolution TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
};

up()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
