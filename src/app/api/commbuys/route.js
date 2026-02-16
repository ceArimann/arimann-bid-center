import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_FEED_DIR = '/Users/carlitoengerman/.openclaw/workspace/commbuys-rfps';

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

async function resolveLatestJsonFile(feedDir) {
  const files = await fs.readdir(feedDir);
  const jsonFiles = files
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((name) => path.join(feedDir, name));

  if (!jsonFiles.length) return null;

  const withStats = await Promise.all(
    jsonFiles.map(async (file) => ({
      file,
      stat: await fs.stat(file),
    }))
  );

  withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return withStats[0].file;
}

function extractBidArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const listCandidates = ['bids', 'results', 'items', 'data'];
    for (const key of listCandidates) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

export async function GET() {
  try {
    const feedDir = process.env.COMMBUYS_RFPS_DIR || DEFAULT_FEED_DIR;
    const latestFile = await resolveLatestJsonFile(feedDir);

    if (!latestFile) {
      return NextResponse.json({ bids: [], sourceFile: null, total: 0 });
    }

    const rawText = await fs.readFile(latestFile, 'utf8');
    const json = JSON.parse(rawText);
    const bids = extractBidArray(json)
      .map(normalizeBid)
      .filter((b) => b.bid_number || b.description);

    return NextResponse.json({
      bids,
      total: bids.length,
      sourceFile: path.basename(latestFile),
    });
  } catch (error) {
    console.error('Failed to load CommBuys feed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load CommBuys feed', bids: [] },
      { status: 500 }
    );
  }
}
