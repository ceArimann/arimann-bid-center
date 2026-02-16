export const STATUS_OPTIONS = ['New', 'Reviewing', 'Submitted', 'Won', 'Lost', 'Archived'];

const LEGACY_STATUS_MAP = {
  Open: 'New',
  'Walkthrough Scheduled': 'Reviewing',
  'In Progress': 'Reviewing',
  'No Bid': 'Lost',
  'On Hold': 'Reviewing',
};

function normalizeStatus(status) {
  const raw = String(status || '').trim();
  const mapped = LEGACY_STATUS_MAP[raw] || raw || 'New';
  return STATUS_OPTIONS.includes(mapped) ? mapped : 'New';
}

function normalizeBid(b = {}) {
  const status = normalizeStatus(b.status);
  const archived = b.archived === true || b.archived === 'TRUE' || b.archived === 'Y' || status === 'Archived';

  return {
    ...b,
    status: archived ? 'Archived' : status,
    notes: b.notes || '',
    archived,
  };
}

async function parseJsonResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    // ignore json parse errors
  }

  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return data;
}

export async function fetchBids() {
  try {
    const res = await fetch('/api/bids', { cache: 'no-store' });
    const data = await parseJsonResponse(res);
    return (data.bids || []).map(normalizeBid);
  } catch (err) {
    console.error('Failed to fetch bids:', err);
    return [];
  }
}

export async function fetchStats() {
  const bids = await fetchBids();
  const activeStatuses = new Set(['New', 'Reviewing', 'Submitted']);

  const active = bids.filter((b) => activeStatuses.has(b.status));
  const dueIn7 = active.filter((b) => {
    if (!b.dueDate) return false;
    const days = Math.ceil((new Date(b.dueDate) - new Date()) / 864e5);
    return days >= 0 && days <= 7;
  });
  const atRisk = dueIn7.filter((b) => b.status !== 'Submitted');
  const won = bids.filter((b) => b.status === 'Won').length;
  const lost = bids.filter((b) => b.status === 'Lost').length;

  return {
    active: active.length,
    dueIn7: dueIn7.length,
    atRisk: atRisk.length,
    won,
    lost,
    winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
    total: bids.length,
  };
}

export async function addBid(bidData) {
  try {
    const res = await fetch('/api/bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bidData,
        status: normalizeStatus(bidData.status || 'New'),
        notes: bidData.notes || '',
        archived: !!bidData.archived,
      }),
    });

    await parseJsonResponse(res);
    return { success: true };
  } catch (err) {
    console.error('Failed to add bid:', err);
    return { error: err.message };
  }
}

export async function updateBidStatus(bidId, status) {
  return updateBidFields(bidId, { status: normalizeStatus(status) });
}

export async function updateBidFields(bidId, fields = {}) {
  try {
    const payload = {
      status: fields.status ? normalizeStatus(fields.status) : undefined,
      notes: fields.notes,
      archived: typeof fields.archived === 'boolean' ? fields.archived : undefined,
    };

    const res = await fetch(`/api/bids/${encodeURIComponent(bidId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await parseJsonResponse(res);
    return { success: true };
  } catch (err) {
    console.error('Failed to update bid:', err);
    return { error: err.message };
  }
}

export async function setBidArchived(bidId, archived) {
  try {
    const res = await fetch(`/api/bids/${encodeURIComponent(bidId)}/archive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    });

    await parseJsonResponse(res);
    return { success: true };
  } catch (err) {
    console.error('Failed to update archive state:', err);
    return { error: err.message };
  }
}
