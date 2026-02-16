import { NextResponse } from 'next/server';
import { updateBidNotes } from '@/lib/google-sheets';

export async function PUT(req, { params }) {
  try {
    const { id } = params;
    const body = await req.json();

    const bid = await updateBidNotes(id, body?.notes ?? '');

    if (!bid) {
      return NextResponse.json({ success: false, error: 'Bid not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, bid });
  } catch (error) {
    console.error('PUT /api/bids/[id]/notes failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update notes' },
      { status: 500 }
    );
  }
}
