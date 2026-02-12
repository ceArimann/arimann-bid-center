const API_URL = process.env.NEXT_PUBLIC_SHEETS_API_URL || '';

function ensureApiUrl() {
  if (!API_URL) {
    throw new Error('Missing NEXT_PUBLIC_SHEETS_API_URL. Add your deployed Apps Script Web App URL to environment variables and restart the app.');
  }
}

function postJson(payload) {
  // Use text/plain request body to avoid CORS preflight issues with Apps Script web apps.
  return fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchBids() {
  try {
    ensureApiUrl();
    const res = await fetch(`${API_URL}?action=bids`, { cache: 'no-store' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.bids || [];
  } catch (err) {
    console.error('Failed to fetch bids:', err);
    return [];
  }
}

export async function fetchStats() {
  try {
    ensureApiUrl();
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
    ensureApiUrl();
    const res = await postJson({ action: 'addBid', ...bidData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    console.error('Failed to add bid:', err);
    return { error: err.message };
  }
}

export async function updateBidStatus(bidId, status) {
  try {
    ensureApiUrl();
    const res = await postJson({ action: 'updateStatus', bidId, status });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    console.error('Failed to update status:', err);
    return { error: err.message };
  }
}
