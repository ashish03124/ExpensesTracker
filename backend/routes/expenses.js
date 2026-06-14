import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/db.js';
import { authenticateToken } from './auth.js';

const router = express.Router({ mergeParams: true });

router.use(authenticateToken);

// Helper function to calculate splits
export const calculateSplits = (amountInr, splitType, members, splitDetails) => {
  if (members.length === 0) {
    throw new Error('Split list cannot be empty');
  }

  // Work in cents to avoid floating point precision issues
  const totalCents = Math.round(Number(amountInr) * 100);
  const splits = [];
  let sumCents = 0;

  if (splitType === 'equal') {
    const count = members.length;
    const baseCents = Math.floor(totalCents / count);
    const remainder = totalCents - (baseCents * count);

    members.forEach((userId, index) => {
      // Allocate 1 cent remainder to the first members
      const shareCents = baseCents + (index < Math.abs(remainder) ? Math.sign(remainder) : 0);
      splits.push({
        user_id: userId,
        share_amount_inr: shareCents / 100,
        share_raw: `${(100 / count).toFixed(2)}%`
      });
      sumCents += shareCents;
    });

  } else if (splitType === 'unequal') {
    // splitDetails is expected to be a map: { [userId]: amount }
    let detailSum = 0;
    members.forEach(userId => {
      const val = Number(splitDetails[userId] || 0);
      detailSum += val;
      const shareCents = Math.round(val * 100);
      splits.push({
        user_id: userId,
        share_amount_inr: val,
        share_raw: `₹${val.toFixed(2)}`
      });
      sumCents += shareCents;
    });

    if (Math.abs(detailSum - amountInr) > 0.01) {
      throw new Error(`Unequal split amounts sum (₹${detailSum}) must equal the total amount (₹${amountInr})`);
    }
    // Adjust any rounding differences in cents
    const diff = totalCents - sumCents;
    if (diff !== 0 && splits.length > 0) {
      splits[0].share_amount_inr = Math.round((splits[0].share_amount_inr * 100 + diff)) / 100;
    }

  } else if (splitType === 'percentage') {
    // splitDetails is expected to be a map: { [userId]: percentage }
    let pctSum = 0;
    members.forEach(userId => {
      const pct = Number(splitDetails[userId] || 0);
      pctSum += pct;
    });

    if (Math.abs(pctSum - 100) > 0.01) {
      throw new Error(`Percentages must sum to 100% (currently ${pctSum}%)`);
    }

    let allocatedCents = 0;
    members.forEach((userId, index) => {
      const pct = Number(splitDetails[userId] || 0);
      let shareCents = Math.floor(totalCents * (pct / 100));
      splits.push({
        user_id: userId,
        share_amount_inr: shareCents / 100, // tentative
        share_raw: `${pct}%`
      });
      allocatedCents += shareCents;
    });

    // Remainder cents allocated to the person with the largest percentage (or first if equal)
    const diff = totalCents - allocatedCents;
    if (diff !== 0) {
      // Find index of max percentage
      let maxIdx = 0;
      let maxPct = -1;
      members.forEach((userId, index) => {
        const pct = Number(splitDetails[userId] || 0);
        if (pct > maxPct) {
          maxPct = pct;
          maxIdx = index;
        }
      });
      splits[maxIdx].share_amount_inr = Math.round((splits[maxIdx].share_amount_inr * 100 + diff)) / 100;
    }

  } else if (splitType === 'share') {
    // splitDetails is expected to be a map: { [userId]: share_weight }
    let totalShares = 0;
    members.forEach(userId => {
      totalShares += Number(splitDetails[userId] || 0);
    });

    if (totalShares <= 0) {
      throw new Error('Total shares weight must be greater than 0');
    }

    let allocatedCents = 0;
    members.forEach((userId, index) => {
      const weight = Number(splitDetails[userId] || 0);
      const shareCents = Math.floor(totalCents * (weight / totalShares));
      splits.push({
        user_id: userId,
        share_amount_inr: shareCents / 100,
        share_raw: `${weight} share${weight !== 1 ? 's' : ''}`
      });
      allocatedCents += shareCents;
    });

    const diff = totalCents - allocatedCents;
    if (diff !== 0) {
      // Find index of max weight
      let maxIdx = 0;
      let maxWeight = -1;
      members.forEach((userId, index) => {
        const weight = Number(splitDetails[userId] || 0);
        if (weight > maxWeight) {
          maxWeight = weight;
          maxIdx = index;
        }
      });
      splits[maxIdx].share_amount_inr = Math.round((splits[maxIdx].share_amount_inr * 100 + diff)) / 100;
    }
  } else {
    throw new Error(`Unsupported split type: ${splitType}`);
  }

  return splits;
};

// Create Expense
router.post('/expenses', async (req, res) => {
  const { groupId } = req.params;
  const {
    description,
    paid_by,
    amount_original,
    currency_original = 'INR',
    fx_rate,
    split_type,
    split_with, // Array of user IDs
    split_details, // Map of details for unequal/percentage/share
    expense_date,
    notes,
    import_source = 'manual'
  } = req.body;

  if (!description || !paid_by || amount_original === undefined || !split_type || !split_with || !expense_date) {
    return res.status(400).json({ error: 'Missing required expense fields' });
  }

  try {
    // Calculate amount_inr
    const origAmount = Number(amount_original);
    let fxRateUsed = null;
    let amountInr = origAmount;

    if (currency_original.toUpperCase() !== 'INR') {
      if (!fx_rate) {
        return res.status(400).json({ error: 'fx_rate is required for foreign currency expenses' });
      }
      fxRateUsed = Number(fx_rate);
      amountInr = origAmount * fxRateUsed;
    }

    // Round amount_inr to 4 decimal places as per DB type
    amountInr = Math.round(amountInr * 10000) / 10000;

    // Calculate splits
    let splits;
    try {
      splits = calculateSplits(amountInr, split_type, split_with, split_details);
    } catch (calcErr) {
      return res.status(400).json({ error: calcErr.message });
    }

    const expenseId = uuidv4();

    // Start Transaction
    await query('BEGIN');

    await query(
      `INSERT INTO expenses (
        id, group_id, description, paid_by, amount_original, currency_original, 
        amount_inr, fx_rate, split_type, expense_date, notes, is_settlement, import_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)`,
      [
        expenseId,
        groupId,
        description,
        paid_by,
        origAmount,
        currency_original.toUpperCase(),
        amountInr,
        fxRateUsed,
        split_type,
        expense_date,
        notes || null,
        import_source
      ]
    );

    for (const split of splits) {
      const splitId = uuidv4();
      await query(
        `INSERT INTO expense_splits (id, expense_id, user_id, share_amount_inr, share_raw) 
         VALUES ($1, $2, $3, $4, $5)`,
        [splitId, expenseId, split.user_id, split.share_amount_inr, split.share_raw]
      );
    }

    await query('COMMIT');

    res.status(201).json({
      message: 'Expense created successfully',
      expense_id: expenseId,
      amount_inr: amountInr,
      splits
    });

  } catch (err) {
    await query('ROLLBACK');
    console.error('Error creating expense:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// List Expenses for a group
router.get('/expenses', async (req, res) => {
  const { groupId } = req.params;
  try {
    const result = await query(
      `SELECT e.*, u.name as payer_name 
       FROM expenses e
       JOIN users u ON e.paid_by = u.id
       WHERE e.group_id = $1 AND e.is_settlement = false
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [groupId]
    );
    
    // Fetch splits for these expenses
    const expensesWithSplits = [];
    for (const exp of result.rows) {
      const splitsRes = await query(
        `SELECT es.*, u.name as user_name 
         FROM expense_splits es
         JOIN users u ON es.user_id = u.id
         WHERE es.expense_id = $1`,
        [exp.id]
      );
      expensesWithSplits.push({
        ...exp,
        splits: splitsRes.rows
      });
    }

    res.json(expensesWithSplits);
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Record Settlement
router.post('/settlements', async (req, res) => {
  const { groupId } = req.params;
  const { paid_by, paid_to, amount_inr, settlement_date, notes } = req.body;

  if (!paid_by || !paid_to || amount_inr === undefined || !settlement_date) {
    return res.status(400).json({ error: 'Missing required settlement fields' });
  }

  try {
    const settlementId = uuidv4();
    const amountVal = Number(amount_inr);

    await query(
      `INSERT INTO settlements (id, group_id, paid_by, paid_to, amount_inr, settlement_date, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [settlementId, groupId, paid_by, paid_to, amountVal, settlement_date, notes || null]
    );

    res.status(201).json({
      message: 'Settlement recorded successfully',
      settlement_id: settlementId,
      amount_inr: amountVal
    });
  } catch (err) {
    console.error('Error recording settlement:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// List Settlements for a group
router.get('/settlements', async (req, res) => {
  const { groupId } = req.params;
  try {
    const result = await query(
      `SELECT s.*, u1.name as payer_name, u2.name as payee_name 
       FROM settlements s
       JOIN users u1 ON s.paid_by = u1.id
       JOIN users u2 ON s.paid_to = u2.id
       WHERE s.group_id = $1
       ORDER BY s.settlement_date DESC, s.created_at DESC`,
      [groupId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing settlements:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
