// ═══════════════════════════════════════════════════════════════════════
// ARIMANN BID COMMAND CENTER — WEB API ENDPOINT
// Add this code to the BOTTOM of your existing BidCommandCenter_v4.gs
// Then: Deploy → New deployment → Web app
//   Execute as: Me
//   Who has access: Anyone (we handle auth in the app)
// Copy the web app URL — you'll need it for the Next.js app.
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET endpoint — returns all bids as JSON
 * Supports: ?action=bids (default), ?action=settings, ?action=stats
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'bids';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result;

  try {
    if (action === 'bids') {
      result = getBidsJson_(ss);
    } else if (action === 'stats') {
      result = getStatsJson_(ss);
    } else if (action === 'settings') {
      result = getSettingsJson_(ss);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST endpoint — creates a new bid row
 * Expects JSON body with bid fields
 */
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result;

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'addBid';

    if (action === 'addBid') {
      result = addBidFromApi_(ss, data);
    } else if (action === 'updateStatus') {
      result = updateBidStatus_(ss, data.bidId, data.status);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── INTERNAL HELPERS ────────────────────────────────────────────

function getBidsJson_(ss) {
  var ws = ss.getSheetByName('Bids');
  if (!ws) return { error: 'Bids sheet not found' };

  var data = ws.getDataRange().getValues();
  var headers = data[0];
  var bids = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    // Skip empty rows
    if (!row[0] && !row[1]) continue;

    bids.push({
      bidId:            row[0] || '',
      bidName:          row[1] || '',
      client:           row[2] || '',
      bidUrl:           row[3] || '',
      dueDate:          row[4] ? new Date(row[4]).toISOString() : '',
      walkDateTime:     row[5] ? new Date(row[5]).toISOString() : '',
      walkLocation:     row[6] || '',
      ownerName:        row[7] || '',
      ownerEmail:       row[8] || '',
      status:           row[9] || '',
      rfpFileUrl:       row[10] || '',
      moveRfp:          row[11] || '',
      driveFolderUrl:   row[12] || '',
      rfpInFolderUrl:   row[13] || '',
      draftUrl:         row[14] || '',
      finalUrl:         row[15] || '',
      notes:            row[16] || '',
      dueEventId:       row[17] || '',
      walkEventId:      row[18] || '',
      lastHash:         row[19] || '',
      notified:         row[20] || '',
    });
  }

  return { bids: bids, count: bids.length, timestamp: new Date().toISOString() };
}

function getStatsJson_(ss) {
  var bidsResult = getBidsJson_(ss);
  if (bidsResult.error) return bidsResult;

  var bids = bidsResult.bids;
  var now = new Date();
  var active = 0, dueIn7 = 0, atRisk = 0, won = 0, lost = 0, submitted = 0;
  var activeStatuses = ['Open', 'Walkthrough Scheduled', 'In Progress', 'Submitted'];

  for (var i = 0; i < bids.length; i++) {
    var b = bids[i];
    var isActive = activeStatuses.indexOf(b.status) >= 0;
    if (isActive) active++;
    if (b.status === 'Won') won++;
    if (b.status === 'Lost') lost++;
    if (b.status === 'Submitted') submitted++;

    if (isActive && b.dueDate) {
      var daysLeft = Math.ceil((new Date(b.dueDate) - now) / 86400000);
      if (daysLeft >= 0 && daysLeft <= 7) {
        dueIn7++;
        if (b.status !== 'Submitted') atRisk++;
      }
    }
  }

  var winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;

  return {
    active: active,
    dueIn7: dueIn7,
    atRisk: atRisk,
    won: won,
    lost: lost,
    submitted: submitted,
    winRate: winRate,
    total: bids.length,
    timestamp: new Date().toISOString()
  };
}

function getSettingsJson_(ss) {
  var ws = ss.getSheetByName('Settings');
  if (!ws) return { error: 'Settings sheet not found' };

  var data = ws.getDataRange().getValues();
  var settings = {};

  for (var r = 1; r < data.length; r++) {
    var key = data[r][0];
    var val = data[r][1];
    if (key) settings[key] = val;
  }

  return { settings: settings };
}

function addBidFromApi_(ss, data) {
  var ws = ss.getSheetByName('Bids');
  if (!ws) return { error: 'Bids sheet not found' };

  // Generate Bid ID
  var now = new Date();
  var year = now.getFullYear();
  // Find next sequence number
  var allData = ws.getDataRange().getValues();
  var maxSeq = 0;
  for (var r = 1; r < allData.length; r++) {
    var existingId = allData[r][0] || '';
    var match = existingId.match(/BID-\d{4}-(\d{3})/);
    if (match) {
      var seq = parseInt(match[1]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  var bidId = 'BID-' + year + '-' + String(maxSeq + 1).padStart(3, '0');

  // Find next empty row
  var nextRow = ws.getLastRow() + 1;

  // Write bid data
  ws.getRange(nextRow, 1).setValue(bidId);                                    // A: Bid ID
  ws.getRange(nextRow, 2).setValue(data.bidName || '');                       // B: Bid Name
  ws.getRange(nextRow, 3).setValue(data.client || '');                        // C: Client
  ws.getRange(nextRow, 4).setValue(data.bidUrl || '');                        // D: URL
  ws.getRange(nextRow, 5).setValue(data.dueDate ? new Date(data.dueDate) : '');  // E: Due Date
  ws.getRange(nextRow, 6).setValue(data.walkDateTime ? new Date(data.walkDateTime) : ''); // F: Walk
  ws.getRange(nextRow, 7).setValue(data.walkLocation || '');                  // G: Walk Location
  ws.getRange(nextRow, 8).setValue(data.ownerName || '');                     // H: Owner Name
  ws.getRange(nextRow, 9).setValue(data.ownerEmail || '');                    // I: Owner Email
  ws.getRange(nextRow, 10).setValue(data.status || 'Open');                   // J: Status
  ws.getRange(nextRow, 11).setValue(data.rfpFileUrl || '');                   // K: RFP URL
  ws.getRange(nextRow, 12).setValue(data.moveRfp || 'Y');                    // L: Move RFP
  ws.getRange(nextRow, 17).setValue(data.notes || '');                        // Q: Notes

  return { success: true, bidId: bidId, row: nextRow };
}

function updateBidStatus_(ss, bidId, newStatus) {
  var ws = ss.getSheetByName('Bids');
  if (!ws) return { error: 'Bids sheet not found' };

  var data = ws.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === bidId) {
      ws.getRange(r + 1, 10).setValue(newStatus); // Column J = Status
      return { success: true, bidId: bidId, newStatus: newStatus };
    }
  }

  return { error: 'Bid not found: ' + bidId };
}
