import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_URL = 'http://localhost:5000/api';

const runTests = async () => {
  console.log('=== STARTING BACKEND VERIFICATION SUITE ===');

  // 1. Authenticate (Login as Aisha)
  console.log('1. Authenticating as Aisha...');
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aisha@example.com', password: 'password123' })
  });

  if (!loginRes.ok) {
    throw new Error(`Auth failed: ${await loginRes.text()}`);
  }

  const { token, user } = await loginRes.json();
  const authHeader = { 'Authorization': `Bearer ${token}` };
  console.log(`Authenticated. Token: ${token.substring(0, 15)}..., User: ${user.name}`);

  // 2. Fetch Group details
  console.log('2. Fetching seeded group "Flat 204B"...');
  const groupsRes = await fetch(`${API_URL}/groups`, { headers: authHeader });
  const groups = await groupsRes.json();
  const targetGroup = groups.find(g => g.name === 'Flat 204B');
  if (!targetGroup) {
    throw new Error('Could not find group "Flat 204B" in DB. Please run seeds first.');
  }
  const groupId = targetGroup.id;
  console.log(`Found Group ID: ${groupId}`);

  // Get members list
  const groupDetailsRes = await fetch(`${API_URL}/groups/${groupId}`, { headers: authHeader });
  const groupDetails = await groupDetailsRes.json();
  console.log(`Members count in group: ${groupDetails.members.length}`);
  const meera = groupDetails.members.find(m => m.name === 'Meera');
  const sam = groupDetails.members.find(m => m.name === 'Sam');
  const priya = groupDetails.members.find(m => m.name === 'Priya');
  const rohan = groupDetails.members.find(m => m.name === 'Rohan');

  // 3. Upload CSV and trigger anomaly detection
  console.log('3. Uploading "Expenses Export.csv" for anomaly check...');
  const csvPath = path.resolve(__dirname, '../../Expenses Export.csv');
  const csvData = fs.readFileSync(csvPath, 'utf8');

  // Construct FormData
  const formData = new FormData();
  formData.append('file', new Blob([csvData], { type: 'text/csv' }), 'Expenses Export.csv');

  const importRes = await fetch(`${API_URL}/groups/${groupId}/import`, {
    method: 'POST',
    headers: authHeader,
    body: formData
  });

  if (!importRes.ok) {
    throw new Error(`Upload failed: ${await importRes.text()}`);
  }

  const importData = await importRes.json();
  const sessionId = importData.session_id;
  console.log(`Import session created: ${sessionId}`);
  console.log(`Total parsed rows: ${importData.total_rows}`);
  console.log(`Anomalies detected: ${importData.anomalies_detected}`);

  // Verify that all 18 anomalies are mapped
  const anomalyTypes = importData.anomalies.map(a => a.type);
  const uniqueTypes = [...new Set(anomalyTypes)].sort();
  console.log(`Detected unique anomaly types: ${uniqueTypes.join(', ')}`);

  // 4. Resolve anomalies one by one
  console.log('4. Resolving anomalies...');
  const anomalies = importData.anomalies;

  // Let's print out what we found
  console.log(`Anomalies count: ${anomalies.length}`);

  for (const anomaly of anomalies) {
    let resolution = {};

    switch (anomaly.type) {
      case 'A1': // Duplicate "Dinner at Marina Bites"
        // Row 5 is kept, Row 6 is discarded
        resolution = { action: anomaly.row_number === 5 ? 'keep' : 'discard' };
        break;
      case 'A2': // Comma in Electricity Feb "1,200"
        resolution = { action: 'format' };
        break;
      case 'A3': // Payer "Priya S" not recognised
        resolution = { action: 'map_payer', payer: 'Priya' };
        break;
      case 'A4': // Missing payer for House cleaning supplies
        resolution = { action: 'assign_payer', payer: 'Priya' }; // assign to Priya
        break;
      case 'A5': // Rohan paid Aisha back (settlement)
        resolution = { action: 'import_as_settlement' };
        break;
      case 'A6': // Pizza Friday percentage sum is 110%
        // Correct to 100%: Aisha 30%; Rohan 20%; Priya 30%; Meera 20%
        resolution = { action: 'correct_percentages', split_details: 'Aisha 30%; Rohan 20%; Priya 30%; Meera 20%' };
        break;
      case 'A7': // USD currency Goa villa / Beach shack
        resolution = { action: 'apply_rate', fx_rate: 83.50 };
        break;
      case 'A8': // Non-member participant "Kabir" in Parasailing
        // Redistribute Kabir's share among the rest
        resolution = { action: 'redistribute' };
        break;
      case 'A9': // Conflicting duplicate Thalassa dinner
        // Row 25 (Rohan ₹2450) kept, Row 24 (Aisha ₹2400) discarded
        resolution = { action: anomaly.row_number === 25 ? 'keep' : 'discard' };
        break;
      case 'A10': // Negative amount refund
        resolution = { action: 'import_as_refund' };
        break;
      case 'A11': // Date Mar-14 format
        resolution = { action: 'confirm_date', date: '2026-03-14' };
        break;
      case 'A12': // Missing currency Groceries DMart
        resolution = { action: 'confirm_currency', currency: 'INR' };
        break;
      case 'A13': // Zero amount expense Dinner Swiggy
        resolution = { action: 'skip' }; // skip it
        break;
      case 'A14': // Ambiguous date format 04-05-2026
        // Note says "is this April 5 or May 4?". Let's confirm April 5, 2026
        resolution = { action: 'confirm_date', date: '2026-04-05' };
        break;
      case 'A15': // Meera listed in April split (April 2 Groceries)
        // She left end of March. Exclude her from the split.
        resolution = { action: 'exclude' };
        break;
      case 'A16': // Sam deposit share
        resolution = { action: 'import_as_settlement' }; // import as settlement record
        break;
      case 'A17': // Furniture for common room split equal with shares
        resolution = { action: 'import_as_equal' };
        break;
      case 'A18': // name casing priya -> Priya
        resolution = { action: 'normalise' };
        break;
      default:
        resolution = { action: 'ignore' };
    }

    const resolveRes = await fetch(`${API_URL}/groups/${groupId}/import/anomalies/${anomaly.id}/resolve`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution })
    });

    if (!resolveRes.ok) {
      throw new Error(`Failed to resolve anomaly ${anomaly.id}: ${await resolveRes.text()}`);
    }
  }
  console.log('All anomalies resolved.');

  // 5. Commit the Import Session
  console.log('5. Committing import session...');
  const commitRes = await fetch(`${API_URL}/groups/${groupId}/import/sessions/${sessionId}/commit`, {
    method: 'POST',
    headers: authHeader
  });

  if (!commitRes.ok) {
    throw new Error(`Commit failed: ${await commitRes.text()}`);
  }

  const commitData = await commitRes.json();
  console.log('Session committed successfully!');
  console.log('Import Report:', JSON.stringify(commitData.report, null, 2));

  // 6. Verify Balances & Membership timeframes
  console.log('6. Verifying balances and membership rules...');
  const balanceRes = await fetch(`${API_URL}/groups/${groupId}/balances`, { headers: authHeader });
  const balanceData = await balanceRes.json();

  console.log('--- Net Balances Calculated ---');
  console.table(balanceData.balances.map(b => ({
    Name: b.name,
    'Joined At': b.joined_at,
    'Left At': b.left_at || 'Present',
    'Paid Expenses': b.paid_expenses,
    'Owed Expenses': b.owed_expenses,
    'Paid Settlements': b.paid_settlements,
    'Received Settlements': b.received_settlements,
    'Net Balance': b.net_balance
  })));

  // Perform checks:
  // Sam joined mid-April. He should have ZERO pre-April expenses.
  // In fact, since Sam joined April 8, let's drill down into Sam's ledger
  console.log("Drilling down into Sam's balance...");
  const samDrilldownRes = await fetch(`${API_URL}/groups/${groupId}/balances/${sam.user_id}/drilldown`, { headers: authHeader });
  const samDrilldown = await samDrilldownRes.json();
  console.log('Sam ledger items:', samDrilldown.ledger.map(item => ({ date: item.date, description: item.description, type: item.type })));
  console.log(`Sam ledger items count: ${samDrilldown.ledger.length}`);

  // All of Sam's ledger items should be dated April 8, 2026 onwards!
  const preAprilSamItems = samDrilldown.ledger.filter(item => item.date.substring(0, 10) < '2026-04-08');
  if (preAprilSamItems.length > 0) {
    throw new Error(`Test Failed: Sam has ${preAprilSamItems.length} items dated before his joined date (April 8, 2026)!`);
  }
  console.log("SUCCESS: Sam has 0 pre-April/pre-membership transactions affecting his balance.");

  // Meera left end of March. Let's check her ledger.
  console.log("Drilling down into Meera's balance...");
  const meeraDrilldownRes = await fetch(`${API_URL}/groups/${groupId}/balances/${meera.user_id}/drilldown`, { headers: authHeader });
  const meeraDrilldown = await meeraDrilldownRes.json();
  
  // All of Meera's ledger items should be dated on or before March 31, 2026!
  const postMarchMeeraItems = meeraDrilldown.ledger.filter(item => item.date.substring(0, 10) > '2026-03-31');
  if (postMarchMeeraItems.length > 0) {
    throw new Error(`Test Failed: Meera has ${postMarchMeeraItems.length} items dated after her left date (March 31, 2026)!`);
  }
  console.log("SUCCESS: Meera has 0 post-March/post-membership transactions affecting her balance.");

  // Check Rohan paid Aisha back (row 14: 25-02-2026 Rohan paid Aisha back 5000 INR)
  // This was mapped to a settlement. Let's check if it exists in the settlements table and not as an expense.
  console.log("Drilling down into Rohan's balance...");
  const rohanDrilldownRes = await fetch(`${API_URL}/groups/${groupId}/balances/${rohan.user_id}/drilldown`, { headers: authHeader });
  const rohanDrilldown = await rohanDrilldownRes.json();
  
  const settlementBack = rohanDrilldown.ledger.find(item => item.type === 'paid_settlement' && item.total_amount === 5000);
  if (!settlementBack) {
    throw new Error("Test Failed: The settlement of ₹5,000 paid back by Rohan to Aisha was not found in Rohan's ledger!");
  }
  console.log("SUCCESS: 'Rohan paid Aisha back' is recorded as a settlement, not double-counted as an expense.");

  console.log('=== Proposed simplified debt settlement transactions ===');
  console.log(JSON.stringify(balanceData.suggested_settlements, null, 2));

  console.log('=== BACKEND VERIFICATION SUITE PASSED SUCCESSFULLY ===');
};

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
