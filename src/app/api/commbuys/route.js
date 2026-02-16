import { NextResponse } from 'next/server';

// For local dev: use direct file access
// For production (Vercel): use the tunnel URL
const API_BASE_URL = process.env.COMMBUYS_API_URL || 'https://e3ce98e0d0385c62-108-12-206-56.serveousercontent.com';

function normalizeBid(raw = {}) {
  return {
    bid_number: raw.bid_number || raw.bidNumber || raw.id || '',
    description: raw.description || raw.title || raw.name || '',
    agency: raw.agency || raw.department || raw.organization || '',
    due_date: raw.due_date || raw.dueDate || raw.closing_date || '',
    buyer: raw.buyer || raw.contact || '',
    status: raw.status || raw.bid_status || 'Open',
    detail_url: raw.detail_url || raw.url || raw.link || '',
  };
}

export async function GET() {
  try {
    // Call the Mac mini API server via tunnel
    const response = await fetch(`${API_BASE_URL}/api/bids`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Normalize the bids
    const bids = (data.bids || [])
      .map(normalizeBid)
      .filter((b) => b.bid_number || b.description);

    return NextResponse.json({
      bids,
      total: bids.length,
      sourceFile: data.sourceFile || 'via tunnel',
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    console.error('Failed to load CommBuys feed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load CommBuys feed', bids: [] },
      { status: 500 }
    );
  }
}
