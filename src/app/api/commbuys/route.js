import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Read from public folder (committed to repo)
// This file is updated by the scraper running on Mac mini
const FEED_FILE = path.join(process.cwd(), 'public', 'commbuys-feed.json');

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
    // Read the JSON file from public folder
    const rawText = await fs.readFile(FEED_FILE, 'utf8');
    const json = JSON.parse(rawText);
    
    // Normalize bids
    const bids = (json.bids || [])
      .map(normalizeBid)
      .filter((b) => b.bid_number || b.description);

    return NextResponse.json({
      bids,
      total: bids.length,
      sourceFile: 'commbuys-feed.json',
      updatedAt: json.updatedAt || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to load CommBuys feed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load CommBuys feed', bids: [] },
      { status: 500 }
    );
  }
}
