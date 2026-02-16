import { NextResponse } from 'next/server';
import { createBid } from '@/lib/google-sheets';

function mapBidToSheetsPayload(bid = {}, defaultStatus = 'New') {
  return {
    bidName: bid.description || bid.title || 'CommBuys Bid',
    client: bid.agency || 'CommBuys',
    dueDate: bid.due_date || '',
    walkDateTime: '',
    walkLocation: '',
    ownerName: 'Craig',
    ownerEmail: '',
    notes: `Imported from CommBuys\nBid #: ${bid.bid_number || 'N/A'}\nBuyer: ${bid.buyer || 'N/A'}\nStatus: ${bid.status || 'Open'}\nDetail: ${bid.detail_url || ''}`,
    status: defaultStatus || 'New',
    bidUrl: bid.detail_url || '',
    rfpInFolderUrl: bid.detail_url || '',
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const bid = body?.bid;
    const status = body?.status || 'New';

    if (!bid) {
      return NextResponse.json({ success: false, error: 'Missing bid payload' }, { status: 400 });
    }

    const payload = mapBidToSheetsPayload(bid, status);
    const created = await createBid(payload);

    return NextResponse.json({ success: true, bid: created });
  } catch (error) {
    console.error('Failed to approve CommBuys bid:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to approve bid' },
      { status: 500 }
    );
  }
}
