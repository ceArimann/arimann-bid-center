const API_URL = process.env.NEXT_PUBLIC_SHEETS_API_URL || '';

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

async function post(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function fetchBids() {
  try {
    const res = await fetch(`${API_URL}?action=bids`, { cache: 'no-store' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return (data.bids || []).map(normalizeBid);
  } catch (err) {
    console.error('Failed to fetch bids:', err);
    return [];
  }
}

export async function fetchStats() {
  try {
    const res = await fetch(`${API_URL}?action=stats`, { cache: 'no-store' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    console.error('Failed to fetch stats:', err);
    return { active: 0, dueIn7: 0, atRisk: 0, won: 0, lost: 0, winRate: 0, total: 0 };
  }
}

export async function addBid(bidData) {
  try {
    return await post({
      action: 'addBid',
      ...bidData,
      status: normalizeStatus(bidData.status || 'New'),
      notes: bidData.notes || '',
      archived: !!bidData.archived,
    });
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
      action: 'updateBid',
      bidId,
      status: fields.status ? normalizeStatus(fields.status) : undefined,
      notes: fields.notes,
      archived: typeof fields.archived === 'boolean' ? fields.archived : undefined,
    };

    try {
      return await post(payload);
    } catch {
      // fallback for legacy API endpoints
      if (payload.status) {
        return await post({ action: 'updateStatus', bidId, status: payload.status });
      }
      if (typeof payload.notes === 'string') {
        return await post({ action: 'updateNotes', bidId, notes: payload.notes });
      }
      if (typeof payload.archived === 'boolean') {
        return await post({ action: 'updateArchive', bidId, archived: payload.archived });
      }
      return { success: true };
    }
  } catch (err) {
    console.error('Failed to update bid:', err);
    return { error: err.message };
  }
}

export async function setBidArchived(bidId, archived) {
  return updateBidFields(bidId, { archived, status: archived ? 'Archived' : 'Reviewing' });
}
