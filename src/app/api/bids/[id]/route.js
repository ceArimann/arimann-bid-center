import { NextResponse } from 'next/server';
import { getBidById, updateBidById } from '@/lib/google-sheets';

export async function GET(_req, { params }) {
  try {
    const { id } = params;
    const found = await getBidById(id);

    if (!found) {
      return NextResponse.json({ success: false, error: 'Bid not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, bid: found.bid });
  } catch (error) {
    console.error('GET /api/bids/[id] failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load bid' },
      { status: 500 }
    );
  }
}

export async function PUT(req, { params }) {
  try {
    const { id } = params;
    const body = await req.json();

    const updates = {
      status: body?.status,
      notes: body?.notes,
      archived: body?.archived,
    };

    const bid = await updateBidById(id, updates);

    if (!bid) {
      return NextResponse.json({ success: false, error: 'Bid not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, bid });
  } catch (error) {
    console.error('PUT /api/bids/[id] failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update bid' },
      { status: 500 }
    );
  }
}
