import React, { useState, useEffect } from 'react';

// API Configuration
const API_BASE = 'http://localhost:5000/api';

// Interfaces
interface User {
  id: string;
  name: string;
  email: string;
}

interface Group {
  id: string;
  name: string;
  created_by: string;
}

interface Member {
  membership_id: string;
  user_id: string;
  name: string;
  email: string;
  joined_at: string;
  left_at: string | null;
}

interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  user_name?: string;
  share_amount_inr: string;
  share_raw: string;
}

interface Expense {
  id: string;
  group_id: string;
  description: string;
  paid_by: string;
  payer_name?: string;
  amount_original: string;
  currency_original: string;
  amount_inr: string;
  fx_rate: string | null;
  split_type: string;
  expense_date: string;
  notes: string | null;
  is_settlement: boolean;
  import_source: string;
  splits?: ExpenseSplit[];
}

interface Settlement {
  id: string;
  group_id: string;
  paid_by: string;
  payer_name?: string;
  paid_to: string;
  payee_name?: string;
  amount_inr: string;
  settlement_date: string;
  notes: string | null;
}

interface MemberBalance {
  user_id: string;
  name: string;
  email: string;
  joined_at: string;
  left_at: string | null;
  paid_expenses: number;
  owed_expenses: number;
  paid_settlements: number;
  received_settlements: number;
  net_balance: number;
}

interface SuggestedSettlement {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
}

interface Anomaly {
  id: string;
  session_id: string;
  row_number: number;
  raw_row: any;
  anomaly_type: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  resolution: string | null;
}

interface LedgerItem {
  type: 'paid_expense' | 'owed_expense' | 'paid_settlement' | 'received_settlement';
  id: string;
  date: string;
  description: string;
  total_amount: number;
  your_share: number;
  net_impact: number;
  notes: string;
}

interface ImportReport {
  import_id: string;
  timestamp: string;
  filename: string;
  total_rows: number;
  imported_successfully: number;
  anomalies_detected: number;
  anomaly_breakdown: Array<{
    row: number;
    type: string;
    description: string;
    resolution: string;
  }>;
}

export default function App() {
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState<User | null>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  );
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Group state
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<Member[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'balances' | 'import'>('dashboard');

  // Expenses & Settlements state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [suggestedSettlements, setSuggestedSettlements] = useState<SuggestedSettlement[]>([]);

  // Modals state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showDrilldownModal, setShowDrilldownModal] = useState(false);

  // Drilldown audit state
  const [drilldownUser, setDrilldownUser] = useState<Member | null>(null);
  const [drilldownLedger, setDrilldownLedger] = useState<LedgerItem[]>([]);

  // Add Member Form
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberJoinedAt, setNewMemberJoinedAt] = useState('');
  const [newMemberLeftAt, setNewMemberLeftAt] = useState('');

  // Add Expense Form
  const [expDescription, setExpDescription] = useState('');
  const [expPaidBy, setExpPaidBy] = useState('');
  const [expAmountOriginal, setExpAmountOriginal] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expFxRate, setExpFxRate] = useState('1');
  const [expSplitType, setExpSplitType] = useState('equal');
  const [expSplitWith, setExpSplitWith] = useState<string[]>([]);
  const [expSplitDetails, setExpSplitDetails] = useState<Record<string, string>>({});
  const [expDate, setExpDate] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [expError, setExpError] = useState<string | null>(null);

  // Record Settlement Form
  const [setPaidBy, setSetPaidBy] = useState('');
  const [setPaidTo, setSetPaidTo] = useState('');
  const [setAmountInr, setSetAmountInr] = useState('');
  const [setNotes, setSetNotes] = useState('');
  const [setDate, setSetDate] = useState('');
  const [setErrorMsg, setSetErrorMsg] = useState<string | null>(null);

  // Import state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importSessionId, setImportSessionId] = useState<string | null>(null);
  const [importAnomalies, setImportAnomalies] = useState<Anomaly[]>([]);
  const [currentAnomalyIndex, setCurrentAnomalyIndex] = useState(0);
  const [selectedResolution, setSelectedResolution] = useState<any>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Custom text input for resolution overrides
  const [customResolutionValue, setCustomResolutionValue] = useState('');

  // Filters for Expenses Ledger
  const [filterMember, setFilterMember] = useState<string>('all');
  const [filterSplitType, setFilterSplitType] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  // Global Alert message
  const [globalMessage, setGlobalMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Headers helper
  const getHeaders = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  // Show status banner
  const triggerMessage = (type: 'success' | 'error', text: string) => {
    setGlobalMessage({ type, text });
    setTimeout(() => setGlobalMessage(null), 5000);
  };

  // Auth: Login / Register
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const endpoint = isRegisterMode ? '/auth/register' : '/auth/login';
    const body = isRegisterMode
      ? { name: authName, email: authEmail, password: authPassword }
      : { email: authEmail, password: authPassword };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setCurrentUser(data.user);
      triggerMessage('success', isRegisterMode ? 'Registered and logged in!' : 'Welcome back!');
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    setSelectedGroup(null);
    setGroups([]);
    triggerMessage('success', 'Logged out successfully');
  };

  // Fetch groups
  const fetchGroups = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/groups`, { headers: getHeaders() });
      if (res.status === 401 || res.status === 403) {
        // Token is invalid or expired — force re-login
        handleLogout();
        triggerMessage('error', 'Session expired. Please log in again.');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        if (data.length > 0 && !selectedGroup) {
          setSelectedGroup(data[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [token]);

  // Load group details and datasets
  const loadGroupData = async () => {
    if (!selectedGroup || !token) return;
    const gId = selectedGroup.id;
    try {
      // 1. Members
      const mRes = await fetch(`${API_BASE}/groups/${gId}`, { headers: getHeaders() });
      if (mRes.ok) {
        const mData = await mRes.json();
        setGroupMembers(mData.members);
      }

      // 2. Expenses
      const eRes = await fetch(`${API_BASE}/groups/${gId}/expenses`, { headers: getHeaders() });
      if (eRes.ok) {
        setExpenses(await eRes.json());
      }

      // 3. Settlements
      const sRes = await fetch(`${API_BASE}/groups/${gId}/settlements`, { headers: getHeaders() });
      if (sRes.ok) {
        setSettlements(await sRes.json());
      }

      // 4. Balances
      const bRes = await fetch(`${API_BASE}/groups/${gId}/balances`, { headers: getHeaders() });
      if (bRes.ok) {
        const bData = await bRes.json();
        setBalances(bData.balances);
        setSuggestedSettlements(bData.suggested_settlements);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadGroupData();
  }, [selectedGroup, activeTab]);

  // Handle Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup.id}/members`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          email: newMemberEmail,
          name: newMemberName,
          joined_at: newMemberJoinedAt,
          left_at: newMemberLeftAt || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add member');

      triggerMessage('success', 'Member added successfully!');
      setShowMemberModal(false);
      setNewMemberEmail('');
      setNewMemberName('');
      setNewMemberJoinedAt('');
      setNewMemberLeftAt('');
      loadGroupData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Add Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    setExpError(null);

    const splitDetailsMap: Record<string, number> = {};
    Object.keys(expSplitDetails).forEach(k => {
      splitDetailsMap[k] = parseFloat(expSplitDetails[k] || '0');
    });

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup.id}/expenses`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          description: expDescription,
          paid_by: expPaidBy,
          amount_original: parseFloat(expAmountOriginal),
          currency_original: expCurrency,
          fx_rate: expCurrency !== 'INR' ? parseFloat(expFxRate) : null,
          split_type: expSplitType,
          split_with: expSplitWith,
          split_details: splitDetailsMap,
          expense_date: expDate,
          notes: expNotes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create expense');

      triggerMessage('success', 'Expense logged successfully!');
      setShowExpenseModal(false);
      // Reset form
      setExpDescription('');
      setExpPaidBy('');
      setExpAmountOriginal('');
      setExpCurrency('INR');
      setExpFxRate('1');
      setExpSplitType('equal');
      setExpSplitWith([]);
      setExpSplitDetails({});
      setExpDate('');
      setExpNotes('');
      loadGroupData();
    } catch (err: any) {
      setExpError(err.message);
    }
  };

  // Handle Record Settlement
  const handleRecordSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    setSetErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup.id}/settlements`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          paid_by: setPaidBy,
          paid_to: setPaidTo,
          amount_inr: parseFloat(setAmountInr),
          settlement_date: setDate,
          notes: setNotes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record settlement');

      triggerMessage('success', 'Settlement recorded!');
      setShowSettlementModal(false);
      setSetPaidBy('');
      setSetPaidTo('');
      setSetAmountInr('');
      setSetDate('');
      setSetNotes('');
      loadGroupData();
    } catch (err: any) {
      setSetErrorMsg(err.message);
    }
  };

  // Drill Down Audit
  const handleDrilldown = async (member: Member) => {
    if (!selectedGroup) return;
    setDrilldownUser(member);
    try {
      const res = await fetch(
        `${API_BASE}/groups/${selectedGroup.id}/balances/${member.user_id}/drilldown`,
        { headers: getHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        setDrilldownLedger(data.ledger);
        setShowDrilldownModal(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // CSV Importer: Upload Phase
  const handleCsvUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) {
      setImportError('No group selected. Please select a group from the dropdown above.');
      return;
    }
    if (!csvFile) {
      setImportError('Please select a CSV file first.');
      return;
    }
    setImportError(null);
    setImportReport(null);

    const formData = new FormData();
    formData.append('file', csvFile);

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup.id}/import`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload CSV');

      setImportSessionId(data.session_id);
      // Map backend field names to match the Anomaly interface
      const mapped = data.anomalies.map((a: any) => ({
        id: a.id,
        session_id: data.session_id,
        row_number: a.rowNum ?? a.row_number,
        raw_row: a.rawRow ?? a.raw_row,
        anomaly_type: a.type ?? a.anomaly_type,
        description: a.description,
        severity: a.severity,
        resolution: a.resolution ?? null
      }));
      setImportAnomalies(mapped);
      setCurrentAnomalyIndex(0);
      setSelectedResolution(null);
      setCustomResolutionValue('');
      triggerMessage('success', `CSV parsed! ${mapped.length} anomalies to resolve.`);
    } catch (err: any) {
      setImportError(err.message);
    }
  };

  // CSV Importer: Resolve anomaly index
  const handleResolveAnomaly = async () => {
    if (!importAnomalies || importAnomalies.length === 0 || !importSessionId) return;
    const anomaly = importAnomalies[currentAnomalyIndex];

    let resolution = selectedResolution;
    if (customResolutionValue) {
      resolution = { ...selectedResolution, ...JSON.parse(customResolutionValue) };
    }

    if (!resolution) {
      alert('Please select or specify a resolution option.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup?.id}/import/anomalies/${anomaly.id}/resolve`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ resolution })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve anomaly');

      // Update resolution in state
      const updatedAnomalies = [...importAnomalies];
      updatedAnomalies[currentAnomalyIndex] = data.anomaly;
      setImportAnomalies(updatedAnomalies);

      // Advance wizard
      if (currentAnomalyIndex < importAnomalies.length - 1) {
        setCurrentAnomalyIndex(currentAnomalyIndex + 1);
        setSelectedResolution(null);
        setCustomResolutionValue('');
      } else {
        triggerMessage('success', 'All anomalies resolved. Ready to commit.');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // CSV Importer: Commit import
  const handleCommitImport = async () => {
    if (!importSessionId || !selectedGroup) return;
    setImportError(null);

    try {
      const res = await fetch(`${API_BASE}/groups/${selectedGroup.id}/import/sessions/${importSessionId}/commit`, {
        method: 'POST',
        headers: getHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to commit import session');

      setImportReport(data.report);
      setImportSessionId(null);
      setImportAnomalies([]);
      setCsvFile(null);
      triggerMessage('success', 'Import completed successfully!');
      loadGroupData();
    } catch (err: any) {
      setImportError(err.message);
    }
  };

  // Download Import Report as JSON file
  const handleDownloadReport = () => {
    if (!importReport) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(importReport, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `import_report_${importReport.import_id || 'summary'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Auto-fill default resolutions on anomalies to let the user batch resolve
  const handleBatchDefaultResolutions = async () => {
    if (!importAnomalies || importAnomalies.length === 0) return;
    try {
      for (let idx = 0; idx < importAnomalies.length; idx++) {
        const anomaly = importAnomalies[idx];
        let resolution = {};
        switch (anomaly.anomaly_type) {
          case 'A1': resolution = { action: anomaly.row_number === 5 ? 'keep' : 'discard' }; break;
          case 'A2': resolution = { action: 'format' }; break;
          case 'A3': resolution = { action: 'map_payer', payer: 'Priya' }; break;
          case 'A4': resolution = { action: 'assign_payer', payer: 'Priya' }; break;
          case 'A5': resolution = { action: 'import_as_settlement' }; break;
          case 'A6': resolution = { action: 'correct_percentages', split_details: 'Aisha 30%; Rohan 20%; Priya 30%; Meera 20%' }; break;
          case 'A7': resolution = { action: 'apply_rate', fx_rate: 83.50 }; break;
          case 'A8': resolution = { action: 'redistribute' }; break;
          case 'A9': resolution = { action: anomaly.row_number === 25 ? 'keep' : 'discard' }; break;
          case 'A10': resolution = { action: 'import_as_refund' }; break;
          case 'A11': resolution = { action: 'confirm_date', date: '2026-03-14' }; break;
          case 'A12': resolution = { action: 'confirm_currency', currency: 'INR' }; break;
          case 'A13': resolution = { action: 'skip' }; break;
          case 'A14': resolution = { action: 'confirm_date', date: '2026-04-05' }; break;
          case 'A15': resolution = { action: 'exclude' }; break;
          case 'A16': resolution = { action: 'import_as_settlement' }; break;
          case 'A17': resolution = { action: 'import_as_equal' }; break;
          case 'A18': resolution = { action: 'normalise' }; break;
          default: resolution = { action: 'ignore' };
        }
        await fetch(`${API_BASE}/groups/${selectedGroup?.id}/import/anomalies/${anomaly.id}/resolve`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ resolution })
        });
      }
      // Reload anomalies list
      const res = await fetch(`${API_BASE}/groups/${selectedGroup?.id}/import/sessions/${importSessionId}/anomalies`, { headers: getHeaders() });
      const data = await res.json();
      setImportAnomalies(data.anomalies);
      setCurrentAnomalyIndex(0);
      triggerMessage('success', 'Default resolutions applied to all anomalies!');
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Filter logic for Expenses Ledger
  const filteredExpenses = expenses.filter(exp => {
    if (filterMember !== 'all') {
      const isPayer = exp.paid_by === filterMember;
      const isParticipant = exp.splits?.some(sp => sp.user_id === filterMember);
      if (!isPayer && !isParticipant) return false;
    }
    if (filterSplitType !== 'all') {
      if (exp.split_type !== filterSplitType) return false;
    }
    if (filterStartDate) {
      if (exp.expense_date < filterStartDate) return false;
    }
    if (filterEndDate) {
      if (exp.expense_date > filterEndDate) return false;
    }
    return true;
  });

  const hasActiveFilters = filterMember !== 'all' || filterSplitType !== 'all' || filterStartDate !== '' || filterEndDate !== '';
  const resetFilters = () => {
    setFilterMember('all');
    setFilterSplitType('all');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  // Render Login view if unauthenticated
  if (!token || !currentUser) {
    return (
      <div className="app-container">
        <header className="navbar">
          <div className="logo-container">
            <span className="logo-text">Spreetail Shared Expenses</span>
          </div>
        </header>
        <div className="auth-page">
          <div className="card auth-card">
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>
              {isRegisterMode ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              {isRegisterMode ? 'Sign up to start tracking shared flat expenses.' : 'Log in to access your flat share group.'}
            </p>
            {authError && <div className="alert alert-error">{authError}</div>}
            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {isRegisterMode && (
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="input-field"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  required
                  className="input-field"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                {isRegisterMode ? 'Register' : 'Log In'}
              </button>
            </form>
            <div style={{ textAlign: 'center', fontSize: '0.875rem', marginTop: '1rem', color: 'var(--text-secondary)' }}>
              {isRegisterMode ? 'Already have an account? ' : "Don't have an account? "}
              <button
                type="button"
                style={{ background: 'none', border: 'none', font: 'inherit', color: 'var(--text-primary)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => setIsRegisterMode(!isRegisterMode)}
              >
                {isRegisterMode ? 'Log In' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="logo-container">
          <span className="logo-text">Spreetail Shared Expenses</span>
        </div>
        <div className="user-nav">
          <span className="username">Hi, {currentUser.name}</span>
          <button className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="main-content">
        {/* Status Toast */}
        {globalMessage && (
          <div
            className="global-toast"
            style={{
              background: globalMessage.type === 'success'
                ? 'rgba(10,30,10,0.9)'
                : 'rgba(30,5,5,0.9)',
              borderColor: globalMessage.type === 'success'
                ? 'var(--color-success-border)'
                : 'var(--color-error-border)',
              color: globalMessage.type === 'success'
                ? 'var(--color-success)'
                : 'var(--color-error)',
            }}
          >
            {globalMessage.text}
          </div>
        )}

        {/* Group Selector & Add Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Active Group:</span>
            <select
              className="input-field"
              style={{ width: '220px', padding: '0.5rem' }}
              value={selectedGroup?.id || ''}
              onChange={(e) => {
                const grp = groups.find(g => g.id === e.target.value);
                if (grp) setSelectedGroup(grp);
              }}
            >
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div className="tabs-nav">
            <button
              className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              Expenses & Splits
            </button>
            <button
              className={`tab-btn ${activeTab === 'balances' ? 'active' : ''}`}
              onClick={() => setActiveTab('balances')}
            >
              Debt & Settlements
            </button>
            <button
              className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
              onClick={() => setActiveTab('import')}
            >
              CSV Importer
            </button>
          </div>
        </div>

        {/* Tab 1: Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="grid-2">
            {/* Group Members Card */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Members & Tenancy Dates</h3>
                <button className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem' }} onClick={() => setShowMemberModal(true)}>
                  Add Member
                </button>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Joined Date</th>
                      <th>Left Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupMembers.map(m => (
                      <tr key={m.membership_id}>
                        <td style={{ fontWeight: 500 }}>{m.name}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{m.email}</td>
                        <td>{m.joined_at}</td>
                        <td style={{ color: m.left_at ? 'var(--color-error)' : 'var(--color-success)' }}>
                          {m.left_at || 'Active Member'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Balances Summary Card */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Net Balance Summary</h3>
              </div>
              <div className="balance-list">
                {balances.map(b => {
                  const mClass = b.net_balance > 0.009 ? 'positive' : b.net_balance < -0.009 ? 'negative' : 'zero';
                  return (
                    <div
                      key={b.user_id}
                      className={`balance-item balance-${mClass}`}
                      onClick={() => {
                        const mRecord = groupMembers.find(gm => gm.user_id === b.user_id);
                        if (mRecord) handleDrilldown(mRecord);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{b.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Paid: ₹{b.paid_expenses.toFixed(2)} | Owed: ₹{b.owed_expenses.toFixed(2)}
                        </div>
                      </div>
                      <div className={`badge-amount amount-${mClass}`}>
                        {b.net_balance > 0.009 ? '+' : ''}₹{b.net_balance.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Expenses & Splits */}
        {activeTab === 'expenses' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Expenses Ledger</h3>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-secondary" onClick={() => setShowSettlementModal(true)}>
                  Record Settlement
                </button>
                <button className="btn btn-primary" onClick={() => setShowExpenseModal(true)}>
                  Add Expense
                </button>
              </div>
            </div>

            {/* Filters Bar */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              padding: '1rem',
              background: 'var(--bg-hover)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              marginBottom: '0.5rem'
            }}>
              <div className="form-group" style={{ gap: '0.25rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Filter by Member</label>
                <select
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                  value={filterMember}
                  onChange={(e) => setFilterMember(e.target.value)}
                >
                  <option value="all">All Members</option>
                  {groupMembers.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ gap: '0.25rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Filter by Split Type</label>
                <select
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                  value={filterSplitType}
                  onChange={(e) => setFilterSplitType(e.target.value)}
                >
                  <option value="all">All Split Types</option>
                  <option value="equal">Equal</option>
                  <option value="unequal">Unequal</option>
                  <option value="percentage">Percentage</option>
                  <option value="share">Share</option>
                </select>
              </div>

              <div className="form-group" style={{ gap: '0.25rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Start Date</label>
                <input
                  type="date"
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ gap: '0.25rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>End Date</label>
                <input
                  type="date"
                  className="input-field"
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </div>
            </div>

            {hasActiveFilters && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={resetFilters}>
                  Clear Filters
                </button>
              </div>
            )}

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Payer</th>
                    <th>Total Amount</th>
                    <th>Split Type</th>
                    <th>Splits (Who Owes What)</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map(exp => (
                    <tr key={exp.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{exp.expense_date}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{exp.description}</div>
                        {exp.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{exp.notes}</div>}
                      </td>
                      <td>{exp.payer_name || 'Unknown'}</td>
                      <td style={{ fontWeight: 600 }}>
                        ₹{Number(exp.amount_inr).toFixed(2)}
                        {exp.currency_original !== 'INR' && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                            {exp.amount_original} {exp.currency_original} @ {exp.fx_rate}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'var(--bg-hover)', borderRadius: '4px', textTransform: 'capitalize' }}>
                          {exp.split_type}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem' }}>
                          {exp.splits?.map(sp => (
                            <div key={sp.id} style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', gap: '0.5rem' }}>
                              <span>{sp.user_name || 'User'}</span>
                              <span style={{ fontWeight: 600 }}>₹{Number(sp.share_amount_inr).toFixed(2)} ({sp.share_raw})</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', color: exp.import_source === 'csv' ? '#6366f1' : '#10b981', fontWeight: 600 }}>
                          {exp.import_source === 'csv' ? 'CSV Import' : 'Manual'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Settlement History */}
            <div className="card" style={{ marginTop: '2rem' }}>
              <div className="card-header">
                <h3 className="card-title">Settlement History</h3>
              </div>
              {settlements.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
                  No settlements recorded yet.
                </div>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Sender (Who Paid)</th>
                        <th>Recipient (Who Received)</th>
                        <th>Amount</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map(settle => (
                        <tr key={settle.id}>
                          <td>{settle.settlement_date}</td>
                          <td><strong>{settle.payer_name || 'Unknown'}</strong></td>
                          <td><strong>{settle.payee_name || 'Unknown'}</strong></td>
                          <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                            ₹{Number(settle.amount_inr).toFixed(2)}
                          </td>
                          <td>{settle.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Balances & Settlements */}
        {activeTab === 'balances' && (
          <div className="grid-2">
            {/* Clickable drilldown list */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Member Ledger (Click to Audit)</h3>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Click on any member to see a detailed audit trail of all their payments, split debts, and settlements.
              </p>
              <div className="balance-list">
                {balances.map(b => {
                  const mClass = b.net_balance > 0.009 ? 'positive' : b.net_balance < -0.009 ? 'negative' : 'zero';
                  return (
                    <div
                      key={b.user_id}
                      className={`balance-item balance-${mClass}`}
                      onClick={() => {
                        const mRecord = groupMembers.find(gm => gm.user_id === b.user_id);
                        if (mRecord) handleDrilldown(mRecord);
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{b.name}</div>
                      <div className={`badge-amount amount-${mClass}`}>
                        {b.net_balance > 0.009 ? '+' : ''}₹{b.net_balance.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Suggested Settlements List */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Simplified Debt Settlements</h3>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Minimised transactions to settle all group debts using greedy two-pointer matching.
              </p>
              {suggestedSettlements.length === 0 ? (
                <div className="alert alert-success" style={{ textAlign: 'center', padding: '2rem' }}>
                  <strong>All Settled Up!</strong> No transactions needed.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {suggestedSettlements.map((s, idx) => (
                    <div key={idx} style={{ padding: '1rem', border: '1px solid var(--border-subtle)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{s.from_name}</span>
                        <span style={{ color: 'var(--text-secondary)', margin: '0 0.5rem' }}>pays</span>
                        <span style={{ fontWeight: 600 }}>{s.to_name}</span>
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-error)' }}>
                        ₹{s.amount.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: CSV Importer */}
        {activeTab === 'import' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">CSV Import Session</h3>
            </div>

            {importError && (
              <div className="alert alert-error">
                {importError}
              </div>
            )}

            {/* Upload form */}
            {!importSessionId && !importReport && (
              <form onSubmit={handleCsvUpload} className="importer-container">
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Upload a spreadsheet CSV file (`expenses_export.csv`) to import records. The app will run 18 anomaly checks to detect duplicates, comma issues, lowercase names, foreign currencies, non-members, and left-dates. You will resolve each flagged anomaly before database commit.
                </p>
                <div className="upload-zone" onClick={() => document.getElementById('csv-file-input')?.click()}>
                  <span style={{ fontSize: '2.5rem' }}>📄</span>
                  <span style={{ fontWeight: 500 }}>
                    {csvFile ? csvFile.name : 'Click to select CSV File'}
                  </span>
                  <input
                    id="csv-file-input"
                    type="file"
                    accept=".csv"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setCsvFile(e.target.files[0]);
                      }
                    }}
                  />
                </div>
                {csvFile && (
                  <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-end' }}>
                    Parse & Scan CSV
                  </button>
                )}
              </form>
            )}

            {/* Anomaly resolution Wizard */}
            {importSessionId && importAnomalies.length > 0 && (
              <div className="importer-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="wizard-step active">
                    Resolving Anomaly {currentAnomalyIndex + 1} of {importAnomalies.length}
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '0.375rem 0.75rem' }} onClick={handleBatchDefaultResolutions}>
                    ⚡ Apply Default Resolutions (Batch)
                  </button>
                </div>

                {/* Active Anomaly Detail */}
                {(() => {
                  const anomaly = importAnomalies[currentAnomalyIndex];
                  if (!anomaly) return null;

                  // Custom resolution helper configurations based on anomaly type
                  let options: Array<{ label: string, val: any }> = [];
                  switch (anomaly.anomaly_type) {
                    case 'A1':
                      options = [
                        { label: 'Keep this row', val: { action: 'keep' } },
                        { label: 'Discard this row (Quarantine/Ignore duplicate)', val: { action: 'discard' } }
                      ];
                      break;
                    case 'A2':
                      options = [
                        { label: 'Strip comma and format amount', val: { action: 'format' } }
                      ];
                      break;
                    case 'A3':
                      options = [
                        { label: 'Map payer to Priya', val: { action: 'map_payer', payer: 'Priya' } },
                        { label: 'Enter other name manually', val: { action: 'map_payer', payer: '' } }
                      ];
                      break;
                    case 'A4':
                      options = groupMembers.map(gm => ({
                        label: `Assign payer to ${gm.name}`,
                        val: { action: 'assign_payer', payer: gm.name }
                      }));
                      break;
                    case 'A5':
                    case 'A16':
                      options = [
                        { label: 'Import as a Settlement record (not an expense)', val: { action: 'import_as_settlement' } },
                        { label: 'Skip/Discard row entirely', val: { action: 'skip' } }
                      ];
                      break;
                    case 'A6':
                      options = [
                        { label: 'Correct percentages to sum to 100% (Aisha 30%; Rohan 20%; Priya 30%; Meera 20%)', val: { action: 'correct_percentages', split_details: 'Aisha 30%; Rohan 20%; Priya 30%; Meera 20%' } }
                      ];
                      break;
                    case 'A7':
                      options = [
                        { label: 'Apply rate: 1 USD = ₹83.50 (default)', val: { action: 'apply_rate', fx_rate: 83.50 } }
                      ];
                      break;
                    case 'A8':
                      options = [
                        { label: 'Add Kabir as a guest participant and allocate', val: { action: 'add_guest', guest: 'Kabir' } },
                        { label: 'Exclude Kabir and redistribute his share among other split_with members', val: { action: 'redistribute' } }
                      ];
                      break;
                    case 'A9':
                      options = [
                        { label: 'Keep this entry', val: { action: 'keep' } },
                        { label: 'Discard this conflicting entry', val: { action: 'discard' } }
                      ];
                      break;
                    case 'A10':
                      options = [
                        { label: 'Apply as negative refund split', val: { action: 'import_as_refund' } }
                      ];
                      break;
                    case 'A11':
                      options = [
                        { label: 'Confirm date is 14 March 2026', val: { action: 'confirm_date', date: '2026-03-14' } }
                      ];
                      break;
                    case 'A12':
                      options = [
                        { label: 'Default currency to INR', val: { action: 'confirm_currency', currency: 'INR' } }
                      ];
                      break;
                    case 'A13':
                      options = [
                        { label: 'Skip/Discard row (placeholder/zero amount)', val: { action: 'skip' } }
                      ];
                      break;
                    case 'A14':
                      options = [
                        { label: 'Confirm date is 5 April 2026 (DD-MM)', val: { action: 'confirm_date', date: '2026-04-05' } },
                        { label: 'Confirm date is 4 May 2026 (MM-DD)', val: { action: 'confirm_date', date: '2026-05-04' } }
                      ];
                      break;
                    case 'A15':
                      options = [
                        { label: 'Exclude Meera from this April split', val: { action: 'exclude' } },
                        { label: 'Keep Meera in the split', val: { action: 'include' } }
                      ];
                      break;
                    case 'A17':
                      options = [
                        { label: 'Treat as equal split across members', val: { action: 'import_as_equal' } }
                      ];
                      break;
                    case 'A18':
                      options = [
                        { label: 'Normalise spelling casing', val: { action: 'normalise' } }
                      ];
                      break;
                    default:
                      options = [
                        { label: 'Ignore and import row as is', val: { action: 'ignore' } }
                      ];
                  }

                  return (
                    <div className="anomaly-wizard-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-warning)' }}>
                          Row {anomaly.row_number}: {anomaly.anomaly_type} Flagged
                        </h4>
                        <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: '#ffebee', color: '#b91c1c', borderRadius: '4px', fontWeight: 600 }}>
                          {anomaly.severity.toUpperCase()}
                        </span>
                      </div>
                      <p style={{ fontWeight: 500, fontSize: '0.9375rem' }}>{anomaly.description}</p>

                      <div className="raw-row-dump">
                        <strong>Raw CSV Values:</strong>
                        <div>{JSON.stringify(anomaly.raw_row)}</div>
                      </div>

                      <div className="resolution-options">
                        <label className="form-label">Select Resolution Action:</label>
                        {options.map((opt, oIdx) => (
                          <div
                            key={oIdx}
                            className={`resolution-option-card ${selectedResolution?.action === opt.val.action && JSON.stringify(selectedResolution) === JSON.stringify(opt.val) ? 'selected' : ''}`}
                            onClick={() => setSelectedResolution(opt.val)}
                          >
                            <span>{opt.label}</span>
                          </div>
                        ))}
                      </div>

                      <div className="form-group" style={{ marginTop: '1rem' }}>
                        <label className="form-label">Advanced Custom Resolution JSON (Optional):</label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder='e.g. { "action": "custom_action", "details": "something" }'
                          value={customResolutionValue}
                          onChange={(e) => setCustomResolutionValue(e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', marginTop: '1.5rem' }}>
                        <button
                          className="btn btn-secondary"
                          disabled={currentAnomalyIndex === 0}
                          onClick={() => {
                            setCurrentAnomalyIndex(currentAnomalyIndex - 1);
                            setSelectedResolution(null);
                          }}
                        >
                          Previous Anomaly
                        </button>
                        <button className="btn btn-primary" onClick={handleResolveAnomaly}>
                          {currentAnomalyIndex < importAnomalies.length - 1 ? 'Save & Next' : 'Save Resolution'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Commit phase */}
            {importSessionId && importAnomalies.length > 0 && importAnomalies.every(a => a.resolution !== null && a.resolution !== undefined && String(a.resolution).length > 0) && (
              <div className="importer-container" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-default)', paddingTop: '1.5rem' }}>
                <div className="alert alert-success">
                  <strong>All anomalies resolved!</strong> Ready to apply changes to database.
                </div>
                <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={handleCommitImport}>
                  Confirm & Commit Database Import
                </button>
              </div>
            )}

            {/* Post Import Report */}
            {importReport && (
              <div className="importer-container" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)', padding: '1.5rem', borderRadius: '8px' }}>
                <h3 className="card-title" style={{ color: 'var(--color-success)', marginBottom: '1rem' }}>
                  ✅ Database Import Complete
                </h3>
                <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
                  <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Rows</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{importReport.total_rows}</div>
                  </div>
                  <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Imported Successfully</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{importReport.imported_successfully}</div>
                  </div>
                  <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Anomalies Resolved</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{importReport.anomalies_detected}</div>
                  </div>
                </div>

                <h4 style={{ marginBottom: '0.5rem' }}>Resolution Breakdown Report:</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto', background: 'rgba(0, 0, 0, 0.2)', padding: '1rem', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
                  {importReport.anomaly_breakdown.map((item, idx) => (
                    <div key={idx} style={{ fontSize: '0.8125rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div style={{ fontWeight: 600 }}>Row {item.row} ({item.type})</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{item.description}</div>
                      <div style={{ color: 'var(--color-success)', fontWeight: 500 }}>{item.resolution}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                  <button className="btn btn-primary" onClick={handleDownloadReport}>
                    Download Report (JSON)
                  </button>
                  <button className="btn btn-secondary" onClick={() => setImportReport(null)}>
                    Import Another File
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL 1: Add Member */}
      {showMemberModal && (
        <div className="overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontFamily: 'var(--font-display)' }}>Add Group Member</h3>
              <button style={{ border: 'none', background: 'none', fontSize: '1.25rem', cursor: 'pointer' }} onClick={() => setShowMemberModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddMember}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    required
                    className="input-field"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Joined Date</label>
                  <input
                    type="date"
                    required
                    className="input-field"
                    value={newMemberJoinedAt}
                    onChange={(e) => setNewMemberJoinedAt(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Left Date (Optional)</label>
                  <input
                    type="date"
                    className="input-field"
                    value={newMemberLeftAt}
                    onChange={(e) => setNewMemberLeftAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowMemberModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Member</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add Expense */}
      {showExpenseModal && (
        <div className="overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 style={{ fontFamily: 'var(--font-display)' }}>Log Expense</h3>
              <button style={{ border: 'none', background: 'none', fontSize: '1.25rem', cursor: 'pointer' }} onClick={() => setShowExpenseModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddExpense}>
              <div className="modal-body">
                {expError && <div className="alert alert-error">{expError}</div>}
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. February rent"
                      className="input-field"
                      value={expDescription}
                      onChange={(e) => setExpDescription(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Paid By</label>
                    <select
                      required
                      className="input-field"
                      value={expPaidBy}
                      onChange={(e) => setExpPaidBy(e.target.value)}
                    >
                      <option value="">Select Member</option>
                      {groupMembers.map(m => (
                        <option key={m.user_id} value={m.user_id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-3">
                  <div className="form-group">
                    <label className="form-label">Original Amount</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      className="input-field"
                      value={expAmountOriginal}
                      onChange={(e) => setExpAmountOriginal(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Original Currency</label>
                    <select
                      className="input-field"
                      value={expCurrency}
                      onChange={(e) => setExpCurrency(e.target.value)}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                  {expCurrency !== 'INR' && (
                    <div className="form-group">
                      <label className="form-label">FX Rate (USD→INR)</label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        className="input-field"
                        value={expFxRate}
                        onChange={(e) => setExpFxRate(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Expense Date</label>
                    <input
                      type="date"
                      required
                      className="input-field"
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Split Type</label>
                    <select
                      className="input-field"
                      value={expSplitType}
                      onChange={(e) => setExpSplitType(e.target.value)}
                    >
                      <option value="equal">Equal</option>
                      <option value="unequal">Unequal (Explicit amounts)</option>
                      <option value="percentage">Percentage</option>
                      <option value="share">Shares weight</option>
                    </select>
                  </div>
                </div>

                {/* Split Participants checkboxes */}
                <div className="form-group">
                  <label className="form-label">Split With Members:</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', border: '1px solid var(--border-default)', padding: '0.75rem', borderRadius: '6px' }}>
                    {groupMembers.map(m => (
                      <label key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={expSplitWith.includes(m.user_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setExpSplitWith([...expSplitWith, m.user_id]);
                            } else {
                              setExpSplitWith(expSplitWith.filter(uid => uid !== m.user_id));
                            }
                          }}
                        />
                        <span>{m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Unequal/Percentage/Share Details Inputs */}
                {(expSplitType === 'unequal' || expSplitType === 'percentage' || expSplitType === 'share') && expSplitWith.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">Enter values for each split participant:</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-default)' }}>
                      {expSplitWith.map(uid => {
                        const m = groupMembers.find(gm => gm.user_id === uid);
                        return (
                          <div key={uid} style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.875rem' }}>{m?.name || 'User'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <input
                                type="number"
                                required
                                step="any"
                                className="input-field"
                                style={{ width: '100px', padding: '0.25rem' }}
                                value={expSplitDetails[uid] || ''}
                                onChange={(e) => setExpSplitDetails({ ...expSplitDetails, [uid]: e.target.value })}
                              />
                              <span style={{ fontSize: '0.8125rem' }}>
                                {expSplitType === 'unequal' ? 'INR' : expSplitType === 'percentage' ? '%' : 'shares'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. paid for intl booking"
                    className="input-field"
                    value={expNotes}
                    onChange={(e) => setExpNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowExpenseModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Record Settlement */}
      {showSettlementModal && (
        <div className="overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 style={{ fontFamily: 'var(--font-display)' }}>Record Settlement</h3>
              <button style={{ border: 'none', background: 'none', fontSize: '1.25rem', cursor: 'pointer' }} onClick={() => setShowSettlementModal(false)}>✕</button>
            </div>
            <form onSubmit={handleRecordSettlement}>
              <div className="modal-body">
                {setErrorMsg && <div className="alert alert-error">{setErrorMsg}</div>}
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Payer (Who Paid)</label>
                    <select
                      required
                      className="input-field"
                      value={setPaidBy}
                      onChange={(e) => setSetPaidBy(e.target.value)}
                    >
                      <option value="">Select Member</option>
                      {groupMembers.map(m => (
                        <option key={m.user_id} value={m.user_id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Payee (Received By)</label>
                    <select
                      required
                      className="input-field"
                      value={setPaidTo}
                      onChange={(e) => setSetPaidTo(e.target.value)}
                    >
                      <option value="">Select Member</option>
                      {groupMembers.map(m => (
                        <option key={m.user_id} value={m.user_id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Amount (INR)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      className="input-field"
                      value={setAmountInr}
                      onChange={(e) => setSetAmountInr(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Settlement Date</label>
                    <input
                      type="date"
                      required
                      className="input-field"
                      value={setDate}
                      onChange={(e) => setSetDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Rohan paid Aisha back"
                    className="input-field"
                    value={setNotes}
                    onChange={(e) => setSetNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSettlementModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Record Payment</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Drilldown Audit Ledger */}
      {showDrilldownModal && drilldownUser && (
        <div className="overlay">
          <div className="modal-content" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)' }}>Audit Ledger: {drilldownUser.name}</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Tenancy dates: {drilldownUser.joined_at} to {drilldownUser.left_at || 'Present'}
                </p>
              </div>
              <button style={{ border: 'none', background: 'none', fontSize: '1.25rem', cursor: 'pointer' }} onClick={() => setShowDrilldownModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {drilldownLedger.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                  No transaction ledger entries recorded during membership.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {drilldownLedger.map((item, idx) => {
                    const isPositive = item.net_impact > 0;
                    return (
                      <div key={idx} className="ledger-item" style={{ borderLeft: `4px solid ${isPositive ? 'var(--color-success)' : 'var(--color-error)'}` }}>
                        <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{item.description}</span>
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: isPositive ? 'var(--color-success)' : 'var(--color-error)' }}>
                            {isPositive ? '+' : ''}₹{item.net_impact.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                          <span>Date: {item.date} | Total Expense: ₹{item.total_amount.toFixed(2)}</span>
                          <span>{item.notes}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowDrilldownModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
