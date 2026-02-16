import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

const SPREADSHEET_ID =
  process.env.BID_CENTER_SPREADSHEET_ID ||
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
  '1g1joFbx1C4IgvGE5-N0wAAPyIIUxazrwi8Q1EgSvUGc';

const COLUMNS = [
  'bidId',
  'bidName',
  'client',
  'bidUrl',
  'dueDate',
  'walkDateTime',
  'walkLocation',
  'ownerName',
  'ownerEmail',
  'status',
  'rfpFileUrl',
  'moveRfp',
  'driveFolderUrl',
  'rfpInFolderUrl',
  'draftUrl',
  'finalUrl',
  'notes',
  'dueEventId',
  'walkEventId',
  'lastHash',
  'notified',
];

const COLUMN_INDEX = COLUMNS.reduce((acc, key, idx) => {
  acc[key] = idx;
  return acc;
}, {});

const SERVICE_ACCOUNT_PATHS = [
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
  '/Users/carlitoengerman/.openclaw/workspace/secrets/google-service-account.json',
  path.resolve(process.cwd(), '../secrets/google-service-account.json'),
  path.resolve(process.cwd(), 'secrets/google-service-account.json'),
].filter(Boolean);

let sheetsClientPromise;

async function loadServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  for (const filePath of SERVICE_ACCOUNT_PATHS) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // try next candidate
    }
  }

  throw new Error('Google service account credentials not found');
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const credentials = await loadServiceAccountCredentials();
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      return google.sheets({ version: 'v4', auth });
    })();
  }

  return sheetsClientPromise;
}

function normalizeRow(values = []) {
  const row = {};
  COLUMNS.forEach((key, index) => {
    row[key] = values[index] ?? '';
  });
  return row;
}

function toRowValues(bid = {}) {
  return COLUMNS.map((key) => {
    const val = bid[key];
    if (val === undefined || val === null) return '';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    return String(val);
  });
}

function normalizeStatus(status) {
  const allowed = new Set(['New', 'Reviewing', 'Submitted', 'Won', 'Lost', 'Archived']);
  const raw = String(status || '').trim();
  if (!raw) return 'New';
  return allowed.has(raw) ? raw : 'New';
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'y' || v === 'yes';
}

export function normalizeBid(raw = {}) {
  const status = normalizeStatus(raw.status);
  const archived = status === 'Archived' || toBoolean(raw.archived);
  return {
    ...raw,
    status,
    archived,
    notes: raw.notes || '',
  };
}

async function getAllRows() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Bids!A2:U',
  });

  return res.data.values || [];
}

export async function listBids() {
  const rows = await getAllRows();
  return rows
    .map((row) => normalizeBid(normalizeRow(row)))
    .filter((row) => row.bidId);
}

export async function getBidById(bidId) {
  const rows = await getAllRows();
  const index = rows.findIndex((row) => String(row[COLUMN_INDEX.bidId] || '').trim() === String(bidId).trim());
  if (index === -1) return null;

  return {
    rowIndex: index + 2,
    bid: normalizeBid(normalizeRow(rows[index])),
  };
}

async function writeRow(rowIndex, bid) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Bids!A${rowIndex}:U${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [toRowValues(bid)],
    },
  });
}

export async function updateBidById(bidId, updates = {}) {
  const found = await getBidById(bidId);
  if (!found) return null;

  const merged = {
    ...found.bid,
    ...updates,
  };

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    merged.status = normalizeStatus(updates.status);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'archived')) {
    const archived = toBoolean(updates.archived);
    merged.status = archived ? 'Archived' : normalizeStatus(merged.status === 'Archived' ? 'Reviewing' : merged.status);
  }

  await writeRow(found.rowIndex, merged);

  return normalizeBid(merged);
}

function buildNextBidId(existingBids = []) {
  const year = new Date().getFullYear();
  const prefix = `BID-${year}-`;
  const max = existingBids.reduce((acc, b) => {
    const id = String(b.bidId || '');
    if (!id.startsWith(prefix)) return acc;
    const n = Number(id.slice(prefix.length));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);

  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export async function createBid(input = {}) {
  const bids = await listBids();
  const bidId = input.bidId || buildNextBidId(bids);

  const bid = normalizeBid({
    bidId,
    bidName: input.bidName || 'Untitled Bid',
    client: input.client || '',
    bidUrl: input.bidUrl || '',
    dueDate: input.dueDate || '',
    walkDateTime: input.walkDateTime || '',
    walkLocation: input.walkLocation || '',
    ownerName: input.ownerName || '',
    ownerEmail: input.ownerEmail || '',
    status: input.archived ? 'Archived' : normalizeStatus(input.status || 'New'),
    rfpFileUrl: input.rfpFileUrl || '',
    moveRfp: input.moveRfp || '',
    driveFolderUrl: input.driveFolderUrl || '',
    rfpInFolderUrl: input.rfpInFolderUrl || '',
    draftUrl: input.draftUrl || '',
    finalUrl: input.finalUrl || '',
    notes: input.notes || '',
    dueEventId: input.dueEventId || '',
    walkEventId: input.walkEventId || '',
    lastHash: input.lastHash || '',
    notified: input.notified || '',
  });

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Bids!A:U',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [toRowValues(bid)],
    },
  });

  return bid;
}

export async function updateBidNotes(bidId, notes) {
  return updateBidById(bidId, { notes: notes ?? '' });
}

export async function updateBidArchive(bidId, archived) {
  return updateBidById(bidId, { archived: !!archived });
}
