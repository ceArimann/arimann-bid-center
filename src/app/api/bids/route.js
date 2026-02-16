import { NextResponse } from 'next/server';
import { createBid, listBids } from '@/lib/google-sheets';

export async function GET() {
  try {
    const bids = await listBids();
    return NextResponse.json({ success: true, bids });
  } catch (error) {
    console.error('GET /api/bids failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load bids' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const bid = await createBid(body || {});
    return NextResponse.json({ success: true, bid });
  } catch (error) {
    console.error('POST /api/bids failed:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create bid' },
      { status: 500 }
    );
  }
}
