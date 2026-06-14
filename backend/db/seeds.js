import pool from './db.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const seed = async () => {
  const client = await pool.connect();
  try {
    console.log('Seeding initial data...');
    await client.query('BEGIN');

    // Create default users
    const users = [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Aisha', email: 'aisha@example.com' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Rohan', email: 'rohan@example.com' },
      { id: '33333333-3333-3333-3333-333333333333', name: 'Priya', email: 'priya@example.com' },
      { id: '44444444-4444-4444-4444-444444444444', name: 'Meera', email: 'meera@example.com' },
      { id: '55555555-5555-5555-5555-555555555555', name: 'Sam', email: 'sam@example.com' },
      { id: '66666666-6666-6666-6666-666666666666', name: 'Dev', email: 'dev@example.com' },
    ];

    const passwordHash = await bcrypt.hash('password123', 10);

    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
        [u.id, u.name, u.email, passwordHash]
      );
    }
    console.log('Users seeded successfully.');

    // Create a group
    const groupId = '99999999-9999-9999-9999-999999999999';
    await client.query(
      `INSERT INTO groups (id, name, created_by) 
       VALUES ($1, 'Flat 204B', $2)
       ON CONFLICT (id) DO NOTHING`,
      [groupId, users[0].id]
    );
    console.log('Group seeded successfully.');

    // Add memberships
    const memberships = [
      { id: uuidv4(), group_id: groupId, user_id: users[0].id, joined_at: '2026-02-01', left_at: null }, // Aisha
      { id: uuidv4(), group_id: groupId, user_id: users[1].id, joined_at: '2026-02-01', left_at: null }, // Rohan
      { id: uuidv4(), group_id: groupId, user_id: users[2].id, joined_at: '2026-02-01', left_at: null }, // Priya
      { id: uuidv4(), group_id: groupId, user_id: users[3].id, joined_at: '2026-02-01', left_at: '2026-03-31' }, // Meera
      { id: uuidv4(), group_id: groupId, user_id: users[4].id, joined_at: '2026-04-08', left_at: null }, // Sam
      { id: uuidv4(), group_id: groupId, user_id: users[5].id, joined_at: '2026-03-01', left_at: '2026-04-30' }, // Dev
    ];

    for (const m of memberships) {
      await client.query(
        `INSERT INTO group_members (id, group_id, user_id, joined_at, left_at) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (group_id, user_id, joined_at) DO UPDATE 
         SET left_at = EXCLUDED.left_at`,
        [m.id, m.group_id, m.user_id, m.joined_at, m.left_at]
      );
    }
    console.log('Memberships seeded successfully.');

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    throw err;
  } finally {
    client.release();
  }
};

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
