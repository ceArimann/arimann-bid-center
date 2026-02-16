import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CONFIG_PATHS = [
  '/Users/carlitoengerman/.openclaw/workspace/secrets/bid-center-config.json',
  path.resolve(process.cwd(), '../secrets/bid-center-config.json'),
  path.resolve(process.cwd(), 'secrets/bid-center-config.json'),
];

async function getAppsScriptUrl() {
  if (process.env.BID_CENTER_APPS_SCRIPT_URL) return process.env.BID_CENTER_APPS_SCRIPT_URL;

  for (const configPath of CONFIG_PATHS) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.apps_script_url) return parsed.apps_script_url;
    } catch {
      // try next location
    }
  }

  return null;
}

function mapBidToSheetsPayload(bid = {}) {
  return {
    action: 'addBid',
    bidName: bid.description || bid.title || 'CommBuys Bid',
    client: bid.agency || 'CommBuys',
    dueDate: bid.due_date || '',
    walkDateTime: '',
    walkLocation: '',
    ownerName: 'Craig',
    ownerEmail: '',
    notes: `Imported from CommBuys\nBid #: ${bid.bid_number || 'N/A'}\nBuyer: ${bid.buyer || 'N/A'}\nStatus: ${bid.status || 'Open'}\nDetail: ${bid.detail_url || ''}`,
    status: 'Open',
    bidUrl: bid.detail_url || '',
    rfpInFolderUrl: bid.detail_url || '',
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const bid = body?.bid;

    if (!bid) {
      return NextResponse.json({ success: false, error: 'Missing bid payload' }, { status: 400 });
    }

    const appsScriptUrl = await getAppsScriptUrl();
    if (!appsScriptUrl) {
      return NextResponse.json(
        { success: false, error: 'Apps Script URL not configured' },
        { status: 500 }
      );
    }

    const payload = mapBidToSheetsPayload(bid);

    const res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const data = await res.json();

    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Apps Script error (${res.status})`);
    }

    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    console.error('Failed to approve CommBuys bid:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to approve bid' },
      { status: 500 }
    );
  }
}
