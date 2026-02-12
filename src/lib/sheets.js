const API_URL = process.env.NEXT_PUBLIC_SHEETS_API_URL || '';

export async function fetchBids() {
  try {
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
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addBid', ...bidData }),
    });
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
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateStatus', bidId, status }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    console.error('Failed to update status:', err);
    return { error: err.message };
  }
}
