import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

// Apply auth middleware to all group routes
router.use(authenticateToken);

// Create Group
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  try {
    const groupId = uuidv4();
    const creatorId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    await query(
      'INSERT INTO groups (id, name, created_by) VALUES ($1, $2, $3)',
      [groupId, name, creatorId]
    );

    // Automatically join the creator to the group
    const membershipId = uuidv4();
    await query(
      'INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES ($1, $2, $3, $4)',
      [membershipId, groupId, creatorId, today]
    );

    res.status(201).json({
      message: 'Group created successfully',
      group: { id: groupId, name, created_by: creatorId }
    });
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get Groups for current user
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = $1`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing groups:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get single group details (with members list)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const groupRes = await query('SELECT * FROM groups WHERE id = $1', [id]);
    if (groupRes.rowCount === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const membersRes = await query(
      `SELECT gm.id as membership_id, u.id as user_id, u.name, u.email, gm.joined_at, gm.left_at 
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [id]
    );

    res.json({
      group: groupRes.rows[0],
      members: membersRes.rows
    });
  } catch (err) {
    console.error('Error getting group details:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Add / Join member to group
router.post('/:id/members', async (req, res) => {
  const { id: groupId } = req.params;
  const { email, name, joined_at, left_at } = req.body;

  if (!email || !joined_at) {
    return res.status(400).json({ error: 'Email and joined_at date are required' });
  }

  try {
    // Check if group exists
    const groupRes = await query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupRes.rowCount === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user exists, else create user as guest/placeholder
    let userId;
    const normalizedEmail = email.toLowerCase().trim();
    const userRes = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (userRes.rowCount > 0) {
      userId = userRes.rows[0].id;
    } else {
      userId = uuidv4();
      const placeholderName = name || email.split('@')[0];
      // Generate a random password hash
      const randomPass = Math.random().toString(36).substring(2);
      const passwordHash = await query("SELECT crypt($1, gen_salt('bf'))", [randomPass]);
      
      // Wait, let's just use bcryptjs to hash a random password to keep it simple and DB independent (PG pgcrypto extension may not be installed by default, although it usually is).
      const bcrypt = await import('bcryptjs');
      const passHash = await bcrypt.default.hash(randomPass, 10);

      await query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, placeholderName, normalizedEmail, passHash]
      );
    }

    // Check if this membership timeframe overlaps (or is duplicate)
    // For simplicity, we just allow the insert. The DB UNIQUE constraint handles exact duplicates.
    const membershipId = uuidv4();
    await query(
      `INSERT INTO group_members (id, group_id, user_id, joined_at, left_at) 
       VALUES ($1, $2, $3, $4, $5)`,
      [membershipId, groupId, userId, joined_at, left_at || null]
    );

    res.status(201).json({
      message: 'Member added to group successfully',
      member: {
        membership_id: membershipId,
        user_id: userId,
        email: normalizedEmail,
        joined_at,
        left_at
      }
    });
  } catch (err) {
    console.error('Error adding member to group:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This user is already a member starting on this date' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// Update membership dates (like setting left_at when moving out)
router.put('/:id/members/:membershipId', async (req, res) => {
  const { membershipId } = req.params;
  const { joined_at, left_at } = req.body;

  if (!joined_at) {
    return res.status(400).json({ error: 'joined_at is required' });
  }

  try {
    const result = await query(
      `UPDATE group_members 
       SET joined_at = $1, left_at = $2 
       WHERE id = $3
       RETURNING *`,
      [joined_at, left_at || null, membershipId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membership record not found' });
    }

    res.json({
      message: 'Membership updated successfully',
      membership: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating membership:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Remove a member entirely from a group (delete membership record)
router.delete('/:id/members/:membershipId', async (req, res) => {
  const { membershipId } = req.params;

  try {
    const result = await query(
      'DELETE FROM group_members WHERE id = $1 RETURNING *',
      [membershipId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membership record not found' });
    }

    res.json({
      message: 'Member removed from group successfully',
      membership: result.rows[0]
    });
  } catch (err) {
    console.error('Error deleting membership:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
