import express from 'express';
import { query } from '../db/db.js';
import { authenticateToken } from './auth.js';

const router = express.Router({ mergeParams: true });

router.use(authenticateToken);

// Helper to get members with their active periods
const getGroupMembersWithActivePeriods = async (groupId) => {
  const res = await query(
    `SELECT gm.user_id, u.name, u.email, gm.joined_at, gm.left_at 
     FROM group_members gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1`,
    [groupId]
  );
  return res.rows;
};

// Calculate net balances for a group
export const calculateBalances = async (groupId) => {
  const members = await getGroupMembersWithActivePeriods(groupId);
  const balances = {};

  // Initialize
  members.forEach(m => {
    balances[m.user_id] = {
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      joined_at: m.joined_at,
      left_at: m.left_at,
      paid_expenses: 0,
      owed_expenses: 0,
      paid_settlements: 0,
      received_settlements: 0,
      net_balance: 0
    };
  });

  // 1. Calculate paid_expenses
  // For each member, sum expenses they paid during their active membership period
  for (const m of members) {
    const leftDate = m.left_at ? m.left_at : '9999-12-31';
    const res = await query(
      `SELECT COALESCE(SUM(amount_inr), 0) as total
       FROM expenses 
       WHERE group_id = $1 AND paid_by = $2 AND is_settlement = false
         AND expense_date BETWEEN $3 AND $4`,
      [groupId, m.user_id, m.joined_at, leftDate]
    );
    balances[m.user_id].paid_expenses = Number(res.rows[0].total);
  }

  // 2. Calculate owed_expenses
  // For each member, sum splits they owe during their active membership period
  for (const m of members) {
    const leftDate = m.left_at ? m.left_at : '9999-12-31';
    const res = await query(
      `SELECT COALESCE(SUM(es.share_amount_inr), 0) as total
       FROM expense_splits es
       JOIN expenses e ON es.expense_id = e.id
       WHERE e.group_id = $1 AND es.user_id = $2 AND e.is_settlement = false
         AND e.expense_date BETWEEN $3 AND $4`,
      [groupId, m.user_id, m.joined_at, leftDate]
    );
    balances[m.user_id].owed_expenses = Number(res.rows[0].total);
  }

  // 3. Calculate paid_settlements
  // For each member, sum settlements they paid during their active membership period
  for (const m of members) {
    const leftDate = m.left_at ? m.left_at : '9999-12-31';
    const res = await query(
      `SELECT COALESCE(SUM(amount_inr), 0) as total
       FROM settlements 
       WHERE group_id = $1 AND paid_by = $2
         AND settlement_date BETWEEN $3 AND $4`,
      [groupId, m.user_id, m.joined_at, leftDate]
    );
    balances[m.user_id].paid_settlements = Number(res.rows[0].total);
  }

  // 4. Calculate received_settlements
  // For each member, sum settlements they received during their active membership period
  for (const m of members) {
    const leftDate = m.left_at ? m.left_at : '9999-12-31';
    const res = await query(
      `SELECT COALESCE(SUM(amount_inr), 0) as total
       FROM settlements 
       WHERE group_id = $1 AND paid_to = $2
         AND settlement_date BETWEEN $3 AND $4`,
      [groupId, m.user_id, m.joined_at, leftDate]
    );
    balances[m.user_id].received_settlements = Number(res.rows[0].total);
  }

  // 5. Compute Net Balance
  // net_balance = (paid_expenses + paid_settlements) - (owed_expenses + received_settlements)
  Object.values(balances).forEach(b => {
    const rawNet = (b.paid_expenses + b.paid_settlements) - (b.owed_expenses + b.received_settlements);
    b.net_balance = Math.round(rawNet * 100) / 100; // Round to 2 decimal places
  });

  return Object.values(balances);
};

// Simplified debt settlement algorithm
export const simplifyDebts = (balancesList) => {
  // Sort into creditors and debtors
  let creditors = balancesList
    .filter(b => b.net_balance > 0.009)
    .map(b => ({ ...b, balance: b.net_balance }))
    .sort((a, b) => b.balance - a.balance);

  let debtors = balancesList
    .filter(b => b.net_balance < -0.009)
    .map(b => ({ ...b, balance: b.net_balance }))
    .sort((a, b) => a.balance - b.balance); // Most negative first

  const transactions = [];

  let i = 0; // debtor index
  let j = 0; // creditor index

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const debtAmount = -debtor.balance;
    const creditAmount = creditor.balance;

    const payment = Math.round(Math.min(debtAmount, creditAmount) * 100) / 100;

    if (payment > 0.009) {
      transactions.push({
        from_id: debtor.user_id,
        from_name: debtor.name,
        to_id: creditor.user_id,
        to_name: creditor.name,
        amount: payment
      });
    }

    debtor.balance += payment;
    creditor.balance -= payment;

    if (Math.abs(debtor.balance) < 0.009) {
      i++;
    }
    if (Math.abs(creditor.balance) < 0.009) {
      j++;
    }
  }

  return transactions;
};

// Route: Get Group Balances & Settlement Plan
router.get('/balances', async (req, res) => {
  const { groupId } = req.params;
  try {
    const balances = await calculateBalances(groupId);
    const simplifiedTransactions = simplifyDebts(balances);

    res.json({
      balances,
      suggested_settlements: simplifiedTransactions
    });
  } catch (err) {
    console.error('Error calculating balances:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Route: Get Audit Trail (Drill Down) for a user
router.get('/balances/:userId/drilldown', async (req, res) => {
  const { groupId, userId } = req.params;

  try {
    // 1. Fetch user membership details
    const memberRes = await query(
      `SELECT gm.joined_at, gm.left_at, u.name, u.email
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.user_id = $2`,
      [groupId, userId]
    );

    if (memberRes.rowCount === 0) {
      return res.status(404).json({ error: 'User is not a member of this group' });
    }

    const { joined_at, left_at, name, email } = memberRes.rows[0];
    const leftDate = left_at ? left_at : '9999-12-31';

    // 2. Fetch all expenses paid by this user within membership dates
    const paidExpensesRes = await query(
      `SELECT id, description, amount_inr, expense_date, split_type
       FROM expenses
       WHERE group_id = $1 AND paid_by = $2 AND is_settlement = false
         AND expense_date BETWEEN $3 AND $4
       ORDER BY expense_date DESC`,
      [groupId, userId, joined_at, leftDate]
    );

    // 3. Fetch all expense splits owed by this user within membership dates
    const owedExpensesRes = await query(
      `SELECT e.id as expense_id, e.description, e.expense_date, e.amount_inr as total_expense_inr,
              es.share_amount_inr, es.share_raw, u.name as payer_name
       FROM expense_splits es
       JOIN expenses e ON es.expense_id = e.id
       JOIN users u ON e.paid_by = u.id
       WHERE e.group_id = $1 AND es.user_id = $2 AND e.is_settlement = false
         AND e.expense_date BETWEEN $3 AND $4
       ORDER BY e.expense_date DESC`,
      [groupId, userId, joined_at, leftDate]
    );

    // 4. Fetch all settlements paid by this user
    const paidSettlementsRes = await query(
      `SELECT s.id, s.amount_inr, s.settlement_date, s.notes, u.name as paid_to_name
       FROM settlements s
       JOIN users u ON s.paid_to = u.id
       WHERE s.group_id = $1 AND s.paid_by = $2
         AND s.settlement_date BETWEEN $3 AND $4
       ORDER BY s.settlement_date DESC`,
      [groupId, userId, joined_at, leftDate]
    );

    // 5. Fetch all settlements received by this user
    const receivedSettlementsRes = await query(
      `SELECT s.id, s.amount_inr, s.settlement_date, s.notes, u.name as paid_by_name
       FROM settlements s
       JOIN users u ON s.paid_by = u.id
       WHERE s.group_id = $1 AND s.paid_to = $2
         AND s.settlement_date BETWEEN $3 AND $4
       ORDER BY s.settlement_date DESC`,
      [groupId, userId, joined_at, leftDate]
    );

    // Merge into chronological ledger for drilldown auditing
    const ledger = [];

    // Add paid expenses
    paidExpensesRes.rows.forEach(exp => {
      ledger.push({
        type: 'paid_expense',
        id: exp.id,
        date: exp.expense_date,
        description: exp.description,
        total_amount: Number(exp.amount_inr),
        your_share: 0, // this will be calculated or looked up if they also split
        net_impact: Number(exp.amount_inr), // Positive impact: they paid, so others owe them
        notes: `Paid by you (Split type: ${exp.split_type})`
      });
    });

    // Add owed splits
    owedExpensesRes.rows.forEach(split => {
      // Find if we already have this expense as 'paid_expense'
      const existing = ledger.find(item => item.id === split.expense_id && item.type === 'paid_expense');
      if (existing) {
        existing.your_share = Number(split.share_amount_inr);
        existing.net_impact -= Number(split.share_amount_inr); // Reduce impact by their own share
        existing.notes += ` (Your share: ₹${Number(split.share_amount_inr).toFixed(2)})`;
      } else {
        ledger.push({
          type: 'owed_expense',
          id: split.expense_id,
          date: split.expense_date,
          description: split.description,
          total_amount: Number(split.total_expense_inr),
          your_share: Number(split.share_amount_inr),
          net_impact: -Number(split.share_amount_inr), // Negative impact: they owe money
          notes: `Paid by ${split.payer_name} (${split.share_raw})`
        });
      }
    });

    // Add paid settlements
    paidSettlementsRes.rows.forEach(s => {
      ledger.push({
        type: 'paid_settlement',
        id: s.id,
        date: s.settlement_date,
        description: `Settlement to ${s.paid_to_name}`,
        total_amount: Number(s.amount_inr),
        your_share: 0,
        net_impact: Number(s.amount_inr), // Positive impact: Rohan paid back Aisha, improves his balance
        notes: s.notes || 'No notes'
      });
    });

    // Add received settlements
    receivedSettlementsRes.rows.forEach(s => {
      ledger.push({
        type: 'received_settlement',
        id: s.id,
        date: s.settlement_date,
        description: `Settlement from ${s.paid_by_name}`,
        total_amount: Number(s.amount_inr),
        your_share: 0,
        net_impact: -Number(s.amount_inr), // Negative impact: Aisha received from Rohan, decreases her balance
        notes: s.notes || 'No notes'
      });
    });

    // Sort ledger by date DESC, then type
    ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      user: { id: userId, name, email, joined_at, left_at },
      ledger
    });

  } catch (err) {
    console.error('Error generating drilldown ledger:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
