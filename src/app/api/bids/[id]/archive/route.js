import { NextResponse } from 'next/server';
import { updateBidArchive } from '@/lib/google-sheets';

export async function PUT(req, { params }) {
  try {
    const { id } = params;
    const body = await req.json();
    const archived = !!body?.archived;

    const bid = await updateBidArchive(id, archived);

    if (!bid) {
      return NextResponse.json({ success: false, error: 'Bid not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, bid });
  } catch (error) {
    console.error('PUT /api/bids/[id]/archive failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update archive state' },
      { status: 500 }
    );
  }
}
