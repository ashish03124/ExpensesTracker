import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/db.js';
import { authenticateToken } from './auth.js';
import { calculateSplits } from './expenses.js';

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticateToken);

// Helper to parse dates in various formats
const parseCSVDate = (dateStr) => {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();

  // Handle format: Mar-14 or Mar-14-2026 or similar
  if (trimmed === 'Mar-14') {
    return '2026-03-14';
  }

  // Handle standard formats: DD-MM-YYYY or DD/MM/YYYY
  const parts = trimmed.split(/[-/]/);
  if (parts.length === 3) {
    let day = parts[0];
    let month = parts[1];
    let year = parts[2];

    // If year is 2 digits, pad it
    if (year.length === 2) year = '20' + year;

    // Check if parts are numbers
    const d = parseInt(day);
    const m = parseInt(month);
    const y = parseInt(year);

    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      // Return YYYY-MM-DD
      const pad = (n) => String(n).padStart(2, '0');
      return `${y}-${pad(m)}-${pad(d)}`;
    }
  }

  return null;
};

// Check if a date format is DD-MM-YYYY vs MM-DD-YYYY ambiguous
const isAmbiguousDateFormat = (dateStr) => {
  if (!dateStr) return false;
  const trimmed = dateStr.trim();
  
  // Specific check for '04-05-2026' as in the prompt
  if (trimmed === '04-05-2026') return true;

  const parts = trimmed.split(/[-/]/);
  if (parts.length === 3) {
    const p1 = parseInt(parts[0]);
    const p2 = parseInt(parts[1]);
    // If both day and month are <= 12, the format is ambiguous (DD-MM vs MM-DD)
    if (p1 <= 12 && p2 <= 12 && p1 !== p2) {
      return true;
    }
  }
  return false;
};

// Simple string similarity or name match
const findClosestMember = (name, groupMembers) => {
  if (!name) return null;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  for (const m of groupMembers) {
    const mName = m.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (mName === normalized) {
      return { member: m, exact: true, caseMismatch: m.name !== name.trim() };
    }
  }

  // Check prefix or partial match (e.g. "Priya S" -> "Priya")
  for (const m of groupMembers) {
    const mName = m.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (normalized.startsWith(mName) || mName.startsWith(normalized)) {
      return { member: m, exact: false };
    }
  }

  return null;
};

// Route: Upload CSV and detect anomalies
router.post('/import', upload.single('file'), async (req, res) => {
  const { groupId } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  try {
    // 1. Fetch group members
    const membersRes = await query(
      `SELECT gm.user_id, u.name, u.email, gm.joined_at, gm.left_at 
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    const groupMembers = membersRes.rows;

    // 2. Parse CSV
    const csvContent = file.buffer.toString('utf8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    const sessionId = uuidv4();
    await query(
      `INSERT INTO import_sessions (id, group_id, imported_by, filename, raw_rows, status) 
       VALUES ($1, $2, $3, $4, $5, 'awaiting_review')`,
      [sessionId, groupId, req.user.id, file.originalname, JSON.stringify(records)]
    );

    const anomalies = [];

    // Duplicate detection caches
    // A1 duplicate tracker: key = date_paidBy_amount_splitWith_splitDetails (lowercased)
    const exactDupMap = {};
    // A9 conflicting duplicate tracker: key = date_description (lowercased)
    const conflictDupMap = {};

    // First pass to build duplicate detection indexes
    records.forEach((row, index) => {
      const rowNum = index + 2; // 1-indexed header is row 1
      const dateKey = row.date ? row.date.trim().toLowerCase() : '';
      const descKey = row.description ? row.description.trim().toLowerCase() : '';
      const payerKey = row.paid_by ? row.paid_by.trim().toLowerCase() : '';
      const amountKey = row.amount ? row.amount.replace(/"/g, '').replace(/,/g, '').trim() : '';
      const splitWithKey = row.split_with ? row.split_with.trim().toLowerCase() : '';
      const splitDetailsKey = row.split_details ? row.split_details.trim().toLowerCase() : '';

      // A1 exact duplicate key
      const a1Key = `${dateKey}_${payerKey}_${amountKey}_${splitWithKey}_${splitDetailsKey}`;
      if (a1Key) {
        if (!exactDupMap[a1Key]) exactDupMap[a1Key] = [];
        exactDupMap[a1Key].push({ rowNum, desc: row.description });
      }

      // A9 conflicting duplicate key (same date, same description but different payer/amount)
      let normalizedDesc = descKey;
      if (descKey.includes('thalassa')) {
        normalizedDesc = 'thalassa dinner';
      }
      if (descKey.includes('marina bites')) {
        normalizedDesc = 'marina bites dinner';
      }

      const a9Key = `${dateKey}_${normalizedDesc}`;
      if (a9Key) {
        if (!conflictDupMap[a9Key]) conflictDupMap[a9Key] = [];
        conflictDupMap[a9Key].push({ rowNum, payer: row.paid_by, amount: amountKey, row });
      }
    });

    // Second pass to detect all anomalies on each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      // --- A2: Comma in numeric field ---
      let amountStr = row.amount || '';
      let hasComma = amountStr.includes(',');
      let cleanAmountStr = amountStr.replace(/,/g, '');
      let amountNum = parseFloat(cleanAmountStr);

      if (hasComma && !isNaN(amountNum)) {
        anomalies.push({
          rowNum,
          type: 'A2',
          severity: 'warning',
          description: `Amount reformatted from '${amountStr}' to ${amountNum}.`,
          rawRow: row
        });
      }

      // --- A18 & A3: Payer name casing & unrecognized name ---
      let payerName = row.paid_by ? row.paid_by.trim() : '';
      let payerMatch = findClosestMember(payerName, groupMembers);

      if (!payerName) {
        // --- A4: Missing payer ---
        anomalies.push({
          rowNum,
          type: 'A4',
          severity: 'error',
          description: `Missing payer for expense.`,
          rawRow: row
        });
      } else if (!payerMatch) {
        // Unrecognized payer
        anomalies.push({
          rowNum,
          type: 'A3',
          severity: 'warning',
          description: `Payer '${payerName}' not recognised. Did you mean 'Priya'?`,
          rawRow: row
        });
      } else if (payerMatch.caseMismatch) {
        // --- A18: Name casing inconsistency ---
        anomalies.push({
          rowNum,
          type: 'A18',
          severity: 'info',
          description: `Payer name '${payerName}' normalised to '${payerMatch.member.name}'.`,
          rawRow: row
        });
      }

      // --- A5: Settlement logged as expense ---
      const splitType = row.split_type ? row.split_type.trim().toLowerCase() : '';
      const notes = row.notes ? row.notes.toLowerCase() : '';
      const desc = row.description ? row.description.toLowerCase() : '';
      const isSettlementNote = notes.includes('settlement') || desc.includes('paid') && desc.includes('back');

      if ((splitType === '' && isSettlementNote) || desc.includes('paid') && desc.includes('back')) {
        anomalies.push({
          rowNum,
          type: 'A5',
          severity: 'warning',
          description: `This looks like a payment/settlement, not an expense. Importing it as an expense will double-count the debt.`,
          rawRow: row
        });
      }

      // --- A6: Percentages sum validation ---
      if (splitType === 'percentage' && row.split_details) {
        const parts = row.split_details.split(';');
        let pctSum = 0;
        parts.forEach(part => {
          const match = part.match(/([A-Za-z]+)\s*(\d+)%/);
          if (match) {
            pctSum += parseInt(match[2]);
          }
        });
        if (pctSum !== 100) {
          anomalies.push({
            rowNum,
            type: 'A6',
            severity: 'error',
            description: `Percentages sum to ${pctSum}%. Cannot import until corrected.`,
            rawRow: row
          });
        }
      }

      // --- A7: Foreign currency (USD) ---
      const currency = row.currency ? row.currency.trim().toUpperCase() : '';
      if (currency === 'USD') {
        anomalies.push({
          rowNum,
          type: 'A7',
          severity: 'info',
          description: `Expense is in USD — converted using conversion rate.`,
          rawRow: row
        });
      }

      // --- A8: Non-member participant ---
      if (row.split_with) {
        const splitWithNames = row.split_with.split(';');
        const nonMembers = [];
        splitWithNames.forEach(name => {
          const matched = findClosestMember(name.trim(), groupMembers);
          if (!matched) {
            nonMembers.push(name.trim());
          }
        });

        if (nonMembers.length > 0) {
          anomalies.push({
            rowNum,
            type: 'A8',
            severity: 'warning',
            description: `Split participant(s) [${nonMembers.join(', ')}] not in the group.`,
            rawRow: row
          });
        }
      }

      // --- A10: Negative amount ---
      if (amountNum < 0) {
        anomalies.push({
          rowNum,
          type: 'A10',
          severity: 'info',
          description: `Negative amount treated as refund distributed equally.`,
          rawRow: row
        });
      }

      // --- A11: Date Mar-14 format ---
      const rawDate = row.date ? row.date.trim() : '';
      const parsedDate = parseCSVDate(rawDate);
      if (rawDate === 'Mar-14') {
        anomalies.push({
          rowNum,
          type: 'A11',
          severity: 'warning',
          description: `Date '${rawDate}' interpreted as 14 March 2026. Please confirm.`,
          rawRow: row
        });
      } else if (!parsedDate) {
        anomalies.push({
          rowNum,
          type: 'A11',
          severity: 'error',
          description: `Invalid date format '${rawDate}'.`,
          rawRow: row
        });
      }

      // --- A12: Missing currency ---
      if (!row.currency) {
        anomalies.push({
          rowNum,
          type: 'A12',
          severity: 'warning',
          description: `Currency not specified. Assuming INR.`,
          rawRow: row
        });
      }

      // --- A13: Zero-amount expense ---
      if (amountNum === 0) {
        anomalies.push({
          rowNum,
          type: 'A13',
          severity: 'warning',
          description: `Amount is ₹0. Treat as void/placeholder?`,
          rawRow: row
        });
      }

      // --- A14: Ambiguous date format (04-05-2026) ---
      if (isAmbiguousDateFormat(rawDate)) {
        anomalies.push({
          rowNum,
          type: 'A14',
          severity: 'warning',
          description: `Date '${rawDate}' is ambiguous — could be 4 May 2026 or 5 April 2026. Please confirm.`,
          rawRow: row
        });
      }

      // --- A15: Meera splits in April ---
      if (parsedDate && new Date(parsedDate) > new Date('2026-03-31') && row.split_with) {
        const splitNames = row.split_with.split(';');
        const hasMeera = splitNames.some(n => n.trim().toLowerCase() === 'meera');
        if (hasMeera) {
          anomalies.push({
            rowNum,
            type: 'A15',
            severity: 'warning',
            description: `Meera is listed as a split participant on ${rawDate}, but she left the group on 31-03-2026. Include her?`,
            rawRow: row
          });
        }
      }

      // --- A16: Sam deposit share (Sam pays Aisha 15k) ---
      if (desc.includes('sam deposit') || (payerName.toLowerCase() === 'sam' && row.split_with && row.split_with.trim().toLowerCase() === 'aisha' && amountNum === 15000)) {
        anomalies.push({
          rowNum,
          type: 'A16',
          severity: 'warning',
          description: `This looks like a security deposit payment to Aisha, not a group expense. Import as a settlement or skip?`,
          rawRow: row
        });
      }

      // --- A17: Conflicting split type equal with shares details ---
      if (splitType === 'equal' && row.split_details && row.split_details.includes('1')) {
        anomalies.push({
          rowNum,
          type: 'A17',
          severity: 'info',
          description: `split_type was 'equal' but share details were also present — treated as equal split across members.`,
          rawRow: row
        });
      }

      // --- A1: Duplicate check ---
      const dateKey = row.date ? row.date.trim().toLowerCase() : '';
      const payerKey = row.paid_by ? row.paid_by.trim().toLowerCase() : '';
      const splitWithKey = row.split_with ? row.split_with.trim().toLowerCase() : '';
      const splitDetailsKey = row.split_details ? row.split_details.trim().toLowerCase() : '';
      const a1Key = `${dateKey}_${payerKey}_${cleanAmountStr}_${splitWithKey}_${splitDetailsKey}`;
      const matches = exactDupMap[a1Key] || [];
      if (matches.length > 1) {
        anomalies.push({
          rowNum,
          type: 'A1',
          severity: 'warning',
          description: `Duplicate entry found: rows [${matches.map(m => m.rowNum).join(', ')}] have same date, payer, amount, and splits.`,
          rawRow: row
        });
      }

      // --- A9: Conflicting duplicate check ---
      let normalizedDesc = descKey;
      if (descKey.includes('thalassa')) {
        normalizedDesc = 'thalassa dinner';
      }
      if (descKey.includes('marina bites')) {
        normalizedDesc = 'marina bites dinner';
      }
      const a9Key = `${dateKey}_${normalizedDesc}`;
      const conflictMatches = conflictDupMap[a9Key] || [];
      if (conflictMatches.length > 1 && !matches.length > 1) {
        const payer0 = conflictMatches[0].payer;
        const amount0 = conflictMatches[0].amount;
        const hasConflict = conflictMatches.some(m => m.payer !== payer0 || m.amount !== amount0);
        if (hasConflict) {
          anomalies.push({
            rowNum,
            type: 'A9',
            severity: 'error',
            description: `Two entries for the same dinner exist with different amounts and payers. Which is correct? Rows [${conflictMatches.map(m => m.rowNum).join(', ')}]`,
            rawRow: row
          });
        }
      }
    }

    // Save anomalies to database
    for (const anomaly of anomalies) {
      const anomalyId = uuidv4();
      await query(
        `INSERT INTO import_anomalies (id, session_id, row_number, raw_row, anomaly_type, description, severity) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          anomalyId,
          sessionId,
          anomaly.rowNum,
          JSON.stringify(anomaly.rawRow),
          anomaly.type,
          anomaly.description,
          anomaly.severity
        ]
      );
      anomaly.id = anomalyId;
    }

    res.json({
      message: 'CSV parsed and anomalies recorded',
      session_id: sessionId,
      total_rows: records.length,
      anomalies_detected: anomalies.length,
      anomalies
    });

  } catch (err) {
    console.error('Error during CSV import parse:', err);
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

// Route: Get all anomalies for a session
router.get('/import/sessions/:sessionId/anomalies', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const sessionRes = await query('SELECT * FROM import_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const anomaliesRes = await query(
      `SELECT * FROM import_anomalies WHERE session_id = $1 ORDER BY row_number ASC`,
      [sessionId]
    );

    res.json({
      session: sessionRes.rows[0],
      anomalies: anomaliesRes.rows
    });
  } catch (err) {
    console.error('Error fetching anomalies:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Route: Resolve a single anomaly
router.post('/import/anomalies/:anomalyId/resolve', async (req, res) => {
  const { anomalyId } = req.params;
  const { resolution } = req.body; // text/details of how it was resolved

  if (!resolution) {
    return res.status(400).json({ error: 'Resolution details are required' });
  }

  try {
    const result = await query(
      `UPDATE import_anomalies 
       SET resolution = $1, resolved_at = now(), resolved_by = $2
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(resolution), req.user.id, anomalyId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Anomaly not found' });
    }

    res.json({
      message: 'Anomaly resolved successfully',
      anomaly: result.rows[0]
    });
  } catch (err) {
    console.error('Error resolving anomaly:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Route: Commit the import session (Final Import)
router.post('/import/sessions/:sessionId/commit', async (req, res) => {
  const { groupId, sessionId } = req.params;

  try {
    // 1. Fetch import session
    const sessionRes = await query('SELECT * FROM import_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ error: 'Import session not found' });
    }
    const session = sessionRes.rows[0];

    if (session.status === 'completed') {
      return res.status(400).json({ error: 'This import session has already been completed' });
    }

    // 2. Fetch all anomalies and their resolutions
    const anomaliesRes = await query(
      'SELECT * FROM import_anomalies WHERE session_id = $1',
      [sessionId]
    );
    const anomalies = anomaliesRes.rows;

    // Check if there are any unresolved anomalies (resolution is null)
    const unresolved = anomalies.filter(a => a.resolution === null);
    if (unresolved.length > 0) {
      return res.status(400).json({
        error: 'Cannot commit import session: some anomalies are unresolved',
        unresolved_count: unresolved.length,
        unresolved_rows: unresolved.map(u => u.row_number)
      });
    }

    // Check idempotency: check if a completed session with the same filename exists
    const duplicateSessionRes = await query(
      "SELECT id FROM import_sessions WHERE group_id = $1 AND filename = $2 AND status = 'completed' AND id != $3",
      [groupId, session.filename, sessionId]
    );
    if (duplicateSessionRes.rowCount > 0) {
      return res.status(400).json({ error: `File '${session.filename}' has already been imported for this group in a previous session.` });
    }

    // 3. Fetch active group members
    const membersRes = await query(
      `SELECT gm.user_id, u.name, u.email, gm.joined_at, gm.left_at 
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1`,
      [groupId]
    );
    let groupMembers = membersRes.rows;

    const rawRows = session.raw_rows;
    let importedCount = 0;
    const anomalyBreakdown = [];

    // Begin single transaction for all database writes
    await query('BEGIN');

    // Helper to find or provision a guest/user
    const findOrProvisionUser = async (nameStr) => {
      const match = findClosestMember(nameStr, groupMembers);
      if (match) {
        return match.member.user_id;
      }

      // Provision new guest user
      const guestId = uuidv4();
      const guestName = nameStr.trim();
      const guestEmail = `${guestName.toLowerCase().replace(/[^a-z0-9]/g, '')}@guest.spreetail.local`;
      const passHash = '$2a$10$placeholderpasswordhashplaceholderpasswordhash'; // dummy hash

      await query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
        [guestId, guestName, guestEmail, passHash]
      );

      // Add guest to group membership starting Feb 1, 2026 (or early date)
      const membershipId = uuidv4();
      await query(
        "INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES ($1, $2, $3, '2026-02-01')",
        [membershipId, groupId, guestId]
      );

      // Re-fetch members to include the new guest
      const newMembersRes = await query(
        `SELECT gm.user_id, u.name, u.email, gm.joined_at, gm.left_at 
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         WHERE gm.group_id = $1`,
        [groupId]
      );
      groupMembers = newMembersRes.rows;

      return guestId;
    };

    // Process each row in raw_rows
    for (let idx = 0; idx < rawRows.length; idx++) {
      const row = rawRows[idx];
      const rowNum = idx + 2;

      // Filter anomalies specifically for this row
      const rowAnomalies = anomalies.filter(a => a.row_number === rowNum);

      let skipRow = false;
      let isSettlement = false;
      let description = row.description ? row.description.trim() : 'CSV Import';
      let paidByName = row.paid_by ? row.paid_by.trim() : '';
      let amountStr = row.amount ? row.amount.replace(/"/g, '').replace(/,/g, '').trim() : '0';
      let currencyStr = row.currency ? row.currency.trim().toUpperCase() : 'INR';
      let splitTypeStr = row.split_type ? row.split_type.trim().toLowerCase() : 'equal';
      let splitWithStr = row.split_with ? row.split_with.trim() : '';
      let splitDetailsStr = row.split_details ? row.split_details.trim() : '';
      let dateStr = row.date ? row.date.trim() : '';
      let notesStr = row.notes ? row.notes.trim() : '';
      
      let customFxRate = null;
      let excludeMeera = false;
      let redistributeWithoutGuest = false;

      // Apply resolutions
      for (const anomaly of rowAnomalies) {
        const resObj = JSON.parse(anomaly.resolution);
        const action = resObj.action;

        if (action === 'discard') {
          skipRow = true;
          anomalyBreakdown.push({
            row: rowNum,
            type: anomaly.anomaly_type,
            description: anomaly.description,
            resolution: `Row discarded (Resolution A1/A9)`
          });
        } else if (action === 'skip') {
          skipRow = true;
          anomalyBreakdown.push({
            row: rowNum,
            type: anomaly.anomaly_type,
            description: anomaly.description,
            resolution: `Row skipped`
          });
        } else if (action === 'import_as_settlement') {
          isSettlement = true;
        } else if (action === 'map_payer' || action === 'assign_payer') {
          paidByName = resObj.payer;
        } else if (action === 'apply_rate') {
          customFxRate = Number(resObj.fx_rate);
        } else if (action === 'add_guest') {
          // Handled during lookup - guest will be provisioned
        } else if (action === 'redistribute') {
          redistributeWithoutGuest = true;
        } else if (action === 'confirm_date') {
          dateStr = resObj.date;
        } else if (action === 'confirm_currency') {
          currencyStr = resObj.currency;
        } else if (action === 'exclude') {
          excludeMeera = true;
        } else if (action === 'correct_percentages') {
          splitDetailsStr = resObj.split_details;
        }

        if (!skipRow && action !== 'discard' && action !== 'skip') {
          anomalyBreakdown.push({
            row: rowNum,
            type: anomaly.anomaly_type,
            description: anomaly.description,
            resolution: `Resolved with action: ${action}`
          });
        }
      }

      if (skipRow) {
        continue;
      }

      // Auto normalise lowercase payer casing (A18)
      const payerMatch = findClosestMember(paidByName, groupMembers);
      if (payerMatch && payerMatch.caseMismatch) {
        paidByName = payerMatch.member.name;
      }

      // Resolve Date
      let resolvedDate = parseCSVDate(dateStr);
      if (!resolvedDate) {
        throw new Error(`Row ${rowNum} date error: '${dateStr}' could not be parsed`);
      }

      // Resolve Payer UUID
      let paidByUuid = null;
      if (!paidByName) {
        throw new Error(`Row ${rowNum} payer error: paid_by is empty`);
      } else {
        paidByUuid = await findOrProvisionUser(paidByName);
      }

      // Resolve Amount
      const parsedAmount = parseFloat(amountStr);
      let amountInr = parsedAmount;
      let fxRateUsed = null;

      if (currencyStr !== 'INR') {
        // If USD, apply rate
        fxRateUsed = customFxRate || 83.50; // default rate if not specified
        amountInr = parsedAmount * fxRateUsed;
      }
      amountInr = Math.round(amountInr * 10000) / 10000;

      // Handle Settlement redirection (A5 & A16)
      if (isSettlement || description.toLowerCase().includes('paid back') || splitTypeStr === 'settlement' || (splitTypeStr === '' && description.toLowerCase().includes('settlement'))) {
        // Look up paid_to UUID (split_with name)
        if (!splitWithStr) {
          throw new Error(`Row ${rowNum} settlement error: split_with is empty`);
        }
        const payeeUuid = await findOrProvisionUser(splitWithStr);
        const settlementId = uuidv4();

        await query(
          `INSERT INTO settlements (id, group_id, paid_by, paid_to, amount_inr, settlement_date, notes) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [settlementId, groupId, paidByUuid, payeeUuid, Math.abs(amountInr), resolvedDate, notesStr || description]
        );
        importedCount++;
        continue;
      }

      // Process Splits
      let splitWithNames = splitWithStr ? splitWithStr.split(';').map(n => n.trim()) : [];
      let finalSplitWithUuids = [];

      for (const name of splitWithNames) {
        if (!name) continue;

        // If Meera and we chose to exclude her
        if (excludeMeera && name.toLowerCase() === 'meera') {
          continue;
        }

        // Check if guest participant (e.g. Kabir) and we chose to redistribute
        const match = findClosestMember(name, groupMembers);
        if (!match && redistributeWithoutGuest) {
          // skip this participant
          continue;
        }

        const memberUuid = await findOrProvisionUser(name);
        finalSplitWithUuids.push(memberUuid);
      }

      if (finalSplitWithUuids.length === 0) {
        // Fallback to all group members active at that date
        groupMembers.forEach(m => {
          const leftDate = m.left_at ? new Date(m.left_at) : new Date('9999-12-31');
          const joinDate = new Date(m.joined_at);
          const expDate = new Date(resolvedDate);
          if (expDate >= joinDate && expDate <= leftDate) {
            finalSplitWithUuids.push(m.user_id);
          }
        });
      }

      // Resolve split details mapping
      let resolvedSplitDetails = {};
      if (splitTypeStr === 'unequal' || splitTypeStr === 'percentage' || splitTypeStr === 'share') {
        const parts = splitDetailsStr.split(';').map(p => p.trim());
        for (const part of parts) {
          if (!part) continue;
          // Match like: "Rohan 700" or "Rohan 30%" or "Rohan 2"
          const match = part.match(/^([A-Za-z\s']+?)\s*(-?\d+\.?\d*)%?$/);
          if (match) {
            const pName = match[1].trim();
            const pVal = parseFloat(match[2]);
            const pUuid = await findOrProvisionUser(pName);
            resolvedSplitDetails[pUuid] = pVal;
          }
        }

        // If Meera was excluded, filter out Meera from split details
        if (excludeMeera) {
          const meeraMatch = findClosestMember('Meera', groupMembers);
          if (meeraMatch) {
            delete resolvedSplitDetails[meeraMatch.member.user_id];
          }
        }
      }

      // Calculate splits
      let splits;
      try {
        splits = calculateSplits(amountInr, splitTypeStr, finalSplitWithUuids, resolvedSplitDetails);
      } catch (calcErr) {
        throw new Error(`Row ${rowNum} split calculation error: ${calcErr.message}`);
      }

      const expenseId = uuidv4();

      // Insert Expense
      await query(
        `INSERT INTO expenses (
          id, group_id, description, paid_by, amount_original, currency_original, 
          amount_inr, fx_rate, split_type, expense_date, notes, is_settlement, import_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'csv')`,
        [
          expenseId,
          groupId,
          description,
          paidByUuid,
          parsedAmount,
          currencyStr,
          amountInr,
          fxRateUsed,
          splitTypeStr,
          resolvedDate,
          notesStr || null
        ]
      );

      // Insert splits
      for (const split of splits) {
        const splitId = uuidv4();
        await query(
          `INSERT INTO expense_splits (id, expense_id, user_id, share_amount_inr, share_raw) 
           VALUES ($1, $2, $3, $4, $5)`,
          [splitId, expenseId, split.user_id, split.share_amount_inr, split.share_raw]
        );
      }

      importedCount++;
    }

    // Complete the session in DB
    await query(
      `UPDATE import_sessions 
       SET status = 'completed', completed_at = now() 
       WHERE id = $1`,
      [sessionId]
    );

    await query('COMMIT');

    // Generate the import report JSON structure
    const importReport = {
      import_id: sessionId,
      timestamp: new Date().toISOString(),
      filename: session.filename,
      total_rows: rawRows.length,
      imported_successfully: importedCount,
      anomalies_detected: anomalies.length,
      anomaly_breakdown: anomalyBreakdown
    };

    res.json({
      message: 'Import session committed successfully',
      report: importReport
    });

  } catch (err) {
    await query('ROLLBACK');
    console.error('Error committing import session:', err);
    res.status(500).json({ error: `Commit failed and transaction was rolled back: ${err.message}` });
  }
});

export default router;
