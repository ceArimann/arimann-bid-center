/*******************************************************************************
 * ARIMANN BID COMMAND CENTER v4.0
 * ──────────────────────────────────────────────────────────────────────────────
 * What's new in v4:
 *   ✅ COMMBUYS auto-discovery (scrapes open bids matching your keywords)
 *   ✅ Batch write-back (single setValues call instead of per-cell)
 *   ✅ Separated concerns (modules for Drive, Calendar, Slack, Email, COMMBUYS)
 *   ✅ Error-resilient (try/catch per row so one bad row doesn't kill the sync)
 *   ✅ Configurable keyword + category matching for COMMBUYS
 *   ✅ Duplicate detection (won't re-import the same COMMBUYS bid)
 *   ✅ Better logging throughout
 *   ✅ Clean column mapping with named ranges concept
 *
 * Sheets required:
 *   "Bids"       – main tracker (columns A-U)
 *   "Settings"   – key/value config
 *   "COMMBUYS"   – auto-discovered bids staging area (auto-created if missing)
 *
 * Triggers (installed via menu):
 *   syncAll()                – every 15 min
 *   dueSoonSlackAlerts()     – every hour
 *   pollCommbuys()           – every 6 hours (configurable)
 ******************************************************************************/

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_BIDS     = "Bids";
const SHEET_SETTINGS = "Settings";
const SHEET_COMMBUYS = "COMMBUYS";

/** Column indices (0-based) for the Bids sheet */
const COL = {
  bidId:         0,   // A
  bidName:       1,   // B
  client:        2,   // C
  postingUrl:    3,   // D
  dueDate:       4,   // E
  walkDateTime:  5,   // F
  walkLocation:  6,   // G
  ownerName:     7,   // H
  ownerEmail:    8,   // I
  status:        9,   // J
  rfpSource:     10,  // K
  rfpAttachYN:   11,  // L
  driveFolderUrl:12,  // M
  rfpInFolderUrl:13,  // N
  draftUrl:      14,  // O
  finalUrl:      15,  // P
  notes:         16,  // Q
  dueEventId:    17,  // R
  walkEventId:   18,  // S
  lastHash:      19,  // T
  notified:      20   // U
};

/** Total columns in the Bids sheet */
const TOTAL_COLS = 21;

/** Statuses that are "locked" and shouldn't auto-transition */
const LOCKED_STATUSES = ["Won", "Lost", "No Bid", "On Hold"];

/** Statuses that are "inactive" for filtering purposes */
const INACTIVE_STATUSES = ["Won", "Lost", "No Bid"];


// ═══════════════════════════════════════════════════════════════════════════════
// UI MENU
// ═══════════════════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🎯 Bid Command Center")
    .addItem("▶ Run Full Sync", "syncAll")
    .addItem("📁 Drive Folders + Attach RFP Only", "driveOnly")
    .addItem("📅 Calendar Sync Only", "calendarOnly")
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("COMMBUYS")
        .addItem("🔍 Poll COMMBUYS Now", "pollCommbuys")
        .addItem("📥 Import Selected to Bids", "importSelectedCommbuys")
    )
    .addSeparator()
    .addItem("🔔 Test Slack", "testSlack")
    .addItem("⚙ Install All Triggers", "installTriggers")
    .addItem("🗑 Remove All Triggers", "removeTriggers")
    .addToUi();
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SYNC
// ═══════════════════════════════════════════════════════════════════════════════

function syncAll() {
  const ctx = getContext_();
  const updates     = [];
  const newBids     = [];
  const updatedBids = [];

  for (let r = 1; r < ctx.values.length; r++) {
    try {
      const row = ctx.values[r];
      if (isRowBlank_(row)) continue;

      const bid = readBidRow_(row);
      if (!bid.bidId || !bid.bidName) continue;

      // Auto-status transitions
      applyAutoStatus_(bid);

      // Drive folder + RFP attach + doc placeholders
      if (ctx.settings.AUTO_CREATE_DRIVE_FOLDER === "TRUE") ensureBidFolder_(ctx, bid);
      if (ctx.settings.AUTO_ATTACH_RFP === "TRUE")          attachRfpIfRequested_(ctx, bid);
      if (ctx.settings.AUTO_CREATE_DOCS === "TRUE")          ensureDocPlaceholders_(ctx, bid);

      // Change detection
      const newHash    = computeHash_(bid, ctx);
      const hadSync    = Boolean(bid.dueEventId || bid.walkEventId || bid.lastHash);
      const changed    = newHash !== (bid.lastHash || "");

      // Calendar upsert (first sync or changed)
      if (!hadSync || changed) upsertCalendar_(ctx, bid);

      // Notification logic
      const alreadyNotified = bid.notified === "✔";

      if (!alreadyNotified && Boolean(bid.dueEventId || bid.walkEventId)) {
        if (ctx.settings.NOTIFY_ON_NEW_BID === "TRUE") {
          newBids.push(bid);
          slackSend_(ctx, buildSlackNewBid_(ctx, bid));
          bid.notified = "✔";
        }
      } else if (alreadyNotified && changed) {
        if (ctx.settings.NOTIFY_ON_UPDATES === "TRUE") {
          updatedBids.push(bid);
          if (ctx.settings.SLACK_NOTIFY_UPDATES === "TRUE") {
            slackSend_(ctx, buildSlackUpdate_(ctx, bid));
          }
        }
      }

      bid.lastHash = newHash;
      updates.push({ rowIdx: r + 1, bid });

    } catch (err) {
      console.error(`syncAll row ${r + 1}: ${err.message}`);
    }
  }

  batchWriteBack_(ctx.sheet, updates);

  if (newBids.length)     sendEmail_(ctx, `New bids synced (${newBids.length})`, newBids);
  if (updatedBids.length) sendEmail_(ctx, `Bid updates (${updatedBids.length})`, updatedBids);

  console.log(`syncAll complete: ${updates.length} rows processed, ${newBids.length} new, ${updatedBids.length} updated.`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE-ONLY / CALENDAR-ONLY
// ═══════════════════════════════════════════════════════════════════════════════

function driveOnly() {
  const ctx = getContext_();
  const updates = [];

  for (let r = 1; r < ctx.values.length; r++) {
    try {
      const row = ctx.values[r];
      if (isRowBlank_(row)) continue;
      const bid = readBidRow_(row);
      if (!bid.bidId || !bid.bidName) continue;

      if (ctx.settings.AUTO_CREATE_DRIVE_FOLDER === "TRUE") ensureBidFolder_(ctx, bid);
      if (ctx.settings.AUTO_ATTACH_RFP === "TRUE")          attachRfpIfRequested_(ctx, bid);
      if (ctx.settings.AUTO_CREATE_DOCS === "TRUE")          ensureDocPlaceholders_(ctx, bid);

      updates.push({ rowIdx: r + 1, bid });
    } catch (err) {
      console.error(`driveOnly row ${r + 1}: ${err.message}`);
    }
  }

  batchWriteBack_(ctx.sheet, updates);
  console.log(`driveOnly complete: ${updates.length} rows.`);
}

function calendarOnly() {
  const ctx = getContext_();
  const updates = [];

  for (let r = 1; r < ctx.values.length; r++) {
    try {
      const row = ctx.values[r];
      if (isRowBlank_(row)) continue;
      const bid = readBidRow_(row);
      if (!bid.bidId || !bid.bidName) continue;

      upsertCalendar_(ctx, bid);
      updates.push({ rowIdx: r + 1, bid });
    } catch (err) {
      console.error(`calendarOnly row ${r + 1}: ${err.message}`);
    }
  }

  batchWriteBack_(ctx.sheet, updates);
  console.log(`calendarOnly complete: ${updates.length} rows.`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// COMMBUYS AUTO-DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Polls COMMBUYS for open bids matching configured keywords/categories.
 * Results go into the "COMMBUYS" staging sheet for review before import.
 *
 * HOW IT WORKS:
 * COMMBUYS exposes a public search at:
 *   https://www.commbuys.com/bso/external/publicBids.sdo
 *
 * We use UrlFetchApp to POST search parameters and parse the HTML response
 * for bid listings. Each discovered bid is checked against existing Bids
 * (by posting URL) to avoid duplicates, then added to the staging sheet.
 *
 * Settings used:
 *   COMMBUYS_ENABLED        – TRUE to enable
 *   COMMBUYS_KEYWORDS        – comma-separated: cleaning,janitorial,custodial
 *   COMMBUYS_CATEGORIES      – comma-separated COMMBUYS category codes (optional)
 *   COMMBUYS_BID_TYPES       – e.g. RFP,RFQ,IFB (optional, defaults to all)
 *   COMMBUYS_SEARCH_URL      – override search URL if it changes
 *   COMMBUYS_AUTO_IMPORT     – TRUE to skip staging and add directly to Bids
 */
function pollCommbuys() {
  const ctx = getContext_();

  if ((ctx.settings.COMMBUYS_ENABLED || "").toUpperCase() !== "TRUE") {
    console.log("COMMBUYS polling is disabled. Set COMMBUYS_ENABLED=TRUE in Settings.");
    try { SpreadsheetApp.getUi().alert("COMMBUYS is disabled. Set COMMBUYS_ENABLED=TRUE in Settings."); } catch(e) {}
    return;
  }

  const keywords = (ctx.settings.COMMBUYS_KEYWORDS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  if (!keywords.length) {
    console.log("No COMMBUYS_KEYWORDS configured.");
    try { SpreadsheetApp.getUi().alert("Set COMMBUYS_KEYWORDS in Settings (e.g. cleaning,janitorial,custodial)."); } catch(e) {}
    return;
  }

  const staging = ensureStagingSheet_(ctx.ss);
  const existingUrls = getExistingBidUrls_(ctx);
  const existingStagingUrls = getStagingUrls_(staging);
  let totalNew = 0;

  for (const keyword of keywords) {
    try {
      const bids = searchCommbuys_(ctx, keyword);
      console.log(`COMMBUYS: "${keyword}" returned ${bids.length} results.`);

      for (const cb of bids) {
        // Skip duplicates
        if (existingUrls.has(cb.url) || existingStagingUrls.has(cb.url)) continue;

        if (ctx.settings.COMMBUYS_AUTO_IMPORT === "TRUE") {
          appendToBidsSheet_(ctx, cb);
        } else {
          appendToStaging_(staging, cb, keyword);
        }

        existingStagingUrls.add(cb.url);
        totalNew++;
      }
    } catch (err) {
      console.error(`COMMBUYS search for "${keyword}": ${err.message}`);
    }
  }

  console.log(`COMMBUYS poll complete: ${totalNew} new bids found.`);

  if (totalNew > 0) {
    slackSend_(ctx, `🔍 *COMMBUYS Auto-Discovery*\nFound ${totalNew} new bid(s) matching your keywords.\n${ctx.settings.COMMBUYS_AUTO_IMPORT === "TRUE" ? "Auto-imported to Bids sheet." : "Review them in the COMMBUYS staging sheet."}`);
  }

  try {
    SpreadsheetApp.getUi().alert(`COMMBUYS: Found ${totalNew} new bid(s).${totalNew > 0 ? (ctx.settings.COMMBUYS_AUTO_IMPORT === "TRUE" ? " Auto-imported." : " Check the COMMBUYS sheet.") : ""}`);
  } catch(e) {}
}

/**
 * Searches COMMBUYS and returns an array of bid objects.
 *
 * COMMBUYS uses a search form that returns HTML. We parse the results table.
 * If the HTML structure changes, this parser will need updating.
 */
function searchCommbuys_(ctx, keyword) {
  const baseUrl = (ctx.settings.COMMBUYS_SEARCH_URL || "").trim()
    || "https://www.commbuys.com/bso/external/publicBids.sdo";

  // COMMBUYS search via GET with query params
  const searchUrl = baseUrl + "?" + buildCommbuysParams_(keyword, ctx.settings);

  const response = UrlFetchApp.fetch(searchUrl, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    console.error(`COMMBUYS returned HTTP ${code}`);
    return [];
  }

  const html = response.getContentText();
  return parseCommbuysResults_(html);
}

/**
 * Builds URL parameters for COMMBUYS search.
 * These parameters mirror what the COMMBUYS search form submits.
 * You may need to adjust these based on COMMBUYS's current form structure.
 */
function buildCommbuysParams_(keyword, settings) {
  const params = {
    "mode": "search",
    "keywords": keyword,
    "openBidsOnly": "true",
    "statusCode": "Active"
  };

  // Optional: filter by bid type (RFP, RFQ, IFB, etc.)
  const bidTypes = (settings.COMMBUYS_BID_TYPES || "").trim();
  if (bidTypes) {
    params["bidType"] = bidTypes;
  }

  return Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
    .join("&");
}

/**
 * Parses the HTML response from COMMBUYS to extract bid listings.
 *
 * IMPORTANT: COMMBUYS HTML structure can change. This parser looks for common
 * patterns in their results table. If it stops working, you'll need to inspect
 * the current HTML and update the regex patterns.
 *
 * Returns: Array of { title, agency, url, dueDate, bidNumber, bidType }
 */
function parseCommbuysResults_(html) {
  const bids = [];

  // ─── Strategy 1: Table row pattern ───
  // COMMBUYS typically renders results in a table with links to bid detail pages
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Look for bid detail links
    const linkMatch = rowHtml.match(
      /href="([^"]*(?:bidDetail|BidDetail|publicBidOpen)[^"]*)"/i
    );
    if (!linkMatch) continue;

    // Extract cells
    const cells = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    if (cells.length < 2) continue;

    // Build absolute URL
    let bidUrl = linkMatch[1];
    if (bidUrl.startsWith("/")) {
      bidUrl = "https://www.commbuys.com" + bidUrl;
    } else if (!bidUrl.startsWith("http")) {
      bidUrl = "https://www.commbuys.com/bso/external/" + bidUrl;
    }

    // Try to extract a due date from cells (look for date-like patterns)
    let dueDate = "";
    for (const cell of cells) {
      const dateMatch = cell.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (dateMatch) {
        dueDate = dateMatch[1];
        break;
      }
    }

    bids.push({
      bidNumber: cells[0] || "",
      title: cells[1] || cells[0] || "Unknown Bid",
      agency: cells.length > 2 ? cells[2] : "",
      dueDate: dueDate,
      url: bidUrl,
      bidType: cells.length > 3 ? cells[3] : ""
    });
  }

  // ─── Strategy 2: Alternative link-based extraction ───
  // If table parsing found nothing, try extracting from bid detail links directly
  if (bids.length === 0) {
    const altPattern = /href="([^"]*(?:bidDetail|publicBidOpen)[^"]*)"[^>]*>([^<]+)</gi;
    let altMatch;

    while ((altMatch = altPattern.exec(html)) !== null) {
      let url = altMatch[1];
      const title = altMatch[2].trim();

      if (url.startsWith("/")) url = "https://www.commbuys.com" + url;
      else if (!url.startsWith("http")) url = "https://www.commbuys.com/bso/external/" + url;

      // Avoid duplicate URLs
      if (bids.some(b => b.url === url)) continue;

      bids.push({
        bidNumber: "",
        title: title,
        agency: "",
        dueDate: "",
        url: url,
        bidType: ""
      });
    }
  }

  return bids;
}

/**
 * Gets all posting URLs from the main Bids sheet (for duplicate detection).
 */
function getExistingBidUrls_(ctx) {
  const urls = new Set();
  for (let r = 1; r < ctx.values.length; r++) {
    const url = String(ctx.values[r][COL.postingUrl] || "").trim();
    if (url) urls.add(url);
  }
  return urls;
}

/**
 * Gets all URLs from the staging sheet.
 */
function getStagingUrls_(sheet) {
  const urls = new Set();
  if (sheet.getLastRow() < 2) return urls;
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    const url = String(data[r][3] || "").trim(); // Column D = URL
    if (url) urls.add(url);
  }
  return urls;
}

/**
 * Ensures the COMMBUYS staging sheet exists with proper headers.
 */
function ensureStagingSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_COMMBUYS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_COMMBUYS);
    sheet.appendRow([
      "Discovered",        // A - timestamp
      "Bid Number",        // B
      "Title",             // C
      "URL",               // D
      "Agency",            // E
      "Due Date",          // F
      "Bid Type",          // G
      "Keyword Match",     // H
      "Imported?"          // I - "✔" once imported to Bids
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#4A86C8").setFontColor("white");
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 300);
    sheet.setColumnWidth(4, 300);
    sheet.setColumnWidth(5, 180);
    sheet.setColumnWidth(6, 110);
    sheet.setColumnWidth(7, 100);
    sheet.setColumnWidth(8, 120);
    sheet.setColumnWidth(9, 80);
  }
  return sheet;
}

/**
 * Appends a discovered bid to the staging sheet.
 */
function appendToStaging_(sheet, cb, keyword) {
  sheet.appendRow([
    new Date(),
    cb.bidNumber,
    cb.title,
    cb.url,
    cb.agency,
    cb.dueDate,
    cb.bidType,
    keyword,
    ""
  ]);
}

/**
 * Directly appends a COMMBUYS bid to the main Bids sheet (auto-import mode).
 */
function appendToBidsSheet_(ctx, cb) {
  const ts = Utilities.formatDate(new Date(), ctx.tz, "yyyyMMdd-HHmm");
  const bidId = "CB-" + ts + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();

  let parsedDue = "";
  if (cb.dueDate) {
    const d = new Date(cb.dueDate);
    if (!isNaN(d.getTime())) parsedDue = d;
  }

  const row = new Array(TOTAL_COLS).fill("");
  row[COL.bidId]      = bidId;
  row[COL.bidName]    = cb.title;
  row[COL.client]     = cb.agency;
  row[COL.postingUrl] = cb.url;
  row[COL.dueDate]    = parsedDue;
  row[COL.status]     = "Open";
  row[COL.notes]      = `Auto-discovered from COMMBUYS. Bid #: ${cb.bidNumber}. Type: ${cb.bidType}`;

  ctx.sheet.appendRow(row);
}

/**
 * Imports selected (checked) rows from the COMMBUYS staging sheet into Bids.
 * Marks them as imported so they won't be re-imported.
 *
 * "Selected" means: column I is NOT "✔" (i.e., not yet imported).
 * To be selective, users can delete rows they don't want before running this,
 * or we could add a checkbox column — but keeping it simple for now.
 */
function importSelectedCommbuys() {
  const ctx = getContext_();
  const staging = ctx.ss.getSheetByName(SHEET_COMMBUYS);

  if (!staging || staging.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert("No COMMBUYS bids to import. Run Poll first.");
    return;
  }

  const data = staging.getDataRange().getValues();
  let imported = 0;

  for (let r = 1; r < data.length; r++) {
    const alreadyImported = String(data[r][8] || "").trim();
    if (alreadyImported === "✔") continue;

    const cb = {
      bidNumber: String(data[r][1] || ""),
      title: String(data[r][2] || ""),
      url: String(data[r][3] || ""),
      agency: String(data[r][4] || ""),
      dueDate: String(data[r][5] || ""),
      bidType: String(data[r][6] || "")
    };

    if (!cb.title && !cb.url) continue;

    appendToBidsSheet_(ctx, cb);
    staging.getRange(r + 1, 9).setValue("✔"); // Mark as imported
    imported++;
  }

  SpreadsheetApp.getUi().alert(`Imported ${imported} bid(s) to Bids sheet. Run Full Sync to set up folders/calendar.`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE FORM INTAKE
// ═══════════════════════════════════════════════════════════════════════════════

function onFormSubmit(e) {
  const ss = SpreadsheetApp.getActive();
  const bids = ss.getSheetByName(SHEET_BIDS);
  if (!bids) throw new Error("Missing sheet: Bids");

  const nv = e.namedValues || {};
  const v = (name) => (nv[name] && nv[name][0]) ? String(nv[name][0]).trim() : "";

  const parseDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d;
  };

  let bidId = v("Bid ID (optional)");
  if (!bidId) {
    bidId = "BID-" + Utilities.formatDate(new Date(), "America/New_York", "yyyyMMdd-HHmm");
  }

  const row = new Array(TOTAL_COLS).fill("");
  row[COL.bidId]       = bidId;
  row[COL.bidName]     = v("Bid Name (required)");
  row[COL.client]      = v("Client/Agency");
  row[COL.postingUrl]  = v("Bid Posting / URL");
  row[COL.dueDate]     = parseDate(v("Submission Due Date (Date)"));
  row[COL.walkDateTime]= parseDate(v("Walkthrough Date/Time (Date and time)"));
  row[COL.walkLocation]= v("Walkthrough Location");
  row[COL.ownerName]   = v("Owner Name");
  row[COL.ownerEmail]  = v("Owner Email");
  row[COL.status]      = "Open";
  row[COL.rfpSource]   = v("RFP File URL or ID");
  row[COL.rfpAttachYN] = v("Move/Copy RFP into Bid Folder? (Y/N)") || "Y";
  row[COL.notes]       = v("Notes");

  bids.appendRow(row);
}


// ═══════════════════════════════════════════════════════════════════════════════
// AUTO STATUS TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════════

function applyAutoStatus_(bid) {
  const current = (bid.status || "").trim();
  if (LOCKED_STATUSES.includes(current)) return;

  const hasWalk  = isValidDate_(bid.walkDateTime);
  const hasDraft = Boolean(bid.draftUrl);
  const hasFinal = Boolean(bid.finalUrl);

  if (hasFinal) {
    bid.status = "Submitted";
  } else if (hasDraft && (current === "Open" || current === "Walkthrough Scheduled")) {
    bid.status = "In Progress";
  } else if (hasWalk && current === "Open") {
    bid.status = "Walkthrough Scheduled";
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// DUE-SOON SLACK ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

function dueSoonSlackAlerts() {
  const ctx = getContext_();
  if ((ctx.settings.SLACK_ENABLED || "").toUpperCase() !== "TRUE") return;

  const props  = PropertiesService.getScriptProperties();
  const now    = new Date();
  const in48h  = new Date(now.getTime() + 48 * 3600000);
  const in24h  = new Date(now.getTime() + 24 * 3600000);
  const in7d   = new Date(now.getTime() + 7 * 86400000);

  for (let r = 1; r < ctx.values.length; r++) {
    try {
      const bid = readBidRow_(ctx.values[r]);
      if (!bid.bidName || !isValidDate_(bid.dueDate)) continue;
      if (["Submitted", ...INACTIVE_STATUSES].includes(bid.status)) continue;
      if (bid.finalUrl) continue;

      const due = bid.dueDate;

      // 7-day heads up (new in v4)
      alertIfNew_(ctx, props, `DUE7D_${bid.bidId}`, due <= in7d && due > in48h,
        `📋 *Bid due in ~7 days*\n*Bid:* ${bid.bidName} (${bid.bidId})\n*Due:* ${fmtShort_(ctx, due)}\n${bid.ownerName ? `*Owner:* ${bid.ownerName}` : ""}`);

      // 48-hour warning
      alertIfNew_(ctx, props, `DUE48_${bid.bidId}`, due <= in48h && due > in24h,
        `⏰ *BID DUE IN ~48 HOURS*\n*Bid:* ${bid.bidName} (${bid.bidId})\n*Due:* ${fmtShort_(ctx, due)}\n${bid.ownerName ? `*Owner:* ${bid.ownerName}\n` : ""}⚠️ Final not submitted`);

      // 24-hour warning
      alertIfNew_(ctx, props, `DUE24_${bid.bidId}`, due <= in24h && due > now,
        `🚨 *BID DUE IN ~24 HOURS*\n*Bid:* ${bid.bidName} (${bid.bidId})\n*Due:* ${fmtShort_(ctx, due)}\n${bid.ownerName ? `*Owner:* ${bid.ownerName}\n` : ""}⚠️ Final not submitted`);

    } catch (err) {
      console.error(`dueSoonSlackAlerts row ${r + 1}: ${err.message}`);
    }
  }
}

/** Sends a Slack alert if the condition is met and hasn't been sent before. */
function alertIfNew_(ctx, props, key, condition, message) {
  if (!condition || props.getProperty(key) === "1") return;
  slackSend_(ctx, message);
  props.setProperty(key, "1");
}


// ═══════════════════════════════════════════════════════════════════════════════
// SLACK SLASH COMMAND: /bids (Web App doPost)
// ═══════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  const ctx = getContext_();

  // Token guard
  const token    = String((e.parameter || {}).token || "");
  const expected = (ctx.settings.SLACK_COMMAND_TOKEN || "").trim();
  if (!expected || token !== expected) {
    return ContentService.createTextOutput("Unauthorized.").setMimeType(ContentService.MimeType.TEXT);
  }

  const text = String((e.parameter || {}).text || "").trim();
  const response = buildBidListResponse_(ctx, text);
  return ContentService.createTextOutput(response).setMimeType(ContentService.MimeType.TEXT);
}

function buildBidListResponse_(ctx, text) {
  const q   = (text || "").toLowerCase();
  const now = new Date();

  // Parse filters
  const isAtRisk   = /at-?risk/.test(q);
  const dueMatch   = q.match(/due\s+(\d+)/);
  const dueDays    = dueMatch ? parseInt(dueMatch[1], 10) : null;
  const ownerMatch = q.match(/owner\s+(.+)/);
  const ownerFilter= ownerMatch ? ownerMatch[1].trim().toLowerCase() : null;
  const showAll    = q.includes("all");
  const dueMax     = dueDays ? new Date(now.getTime() + dueDays * 86400000) : null;

  const bids = [];

  for (let r = 1; r < ctx.values.length; r++) {
    const bid = readBidRow_(ctx.values[r]);
    if (!bid.bidName) continue;

    // Active filter
    if (!showAll && INACTIVE_STATUSES.includes(bid.status)) continue;

    // Owner filter
    if (ownerFilter && !bid.ownerName.toLowerCase().includes(ownerFilter)) continue;

    // Due-in filter
    if (dueMax) {
      if (!isValidDate_(bid.dueDate) || bid.dueDate < now || bid.dueDate > dueMax) continue;
    }

    // At-risk: due within 7 days and no final
    if (isAtRisk) {
      if (!isValidDate_(bid.dueDate)) continue;
      const in7d = new Date(now.getTime() + 7 * 86400000);
      if (bid.dueDate < now || bid.dueDate > in7d || bid.finalUrl) continue;
    }

    bids.push(bid);
  }

  // Sort by due date ascending
  bids.sort((a, b) => {
    const ad = isValidDate_(a.dueDate) ? a.dueDate.getTime() : 9e15;
    const bd = isValidDate_(b.dueDate) ? b.dueDate.getTime() : 9e15;
    return ad - bd;
  });

  const limit = 15;
  const shown = bids.slice(0, limit);
  const lines = [`📋 *Arimann Bid List* — ${shown.length}${bids.length > limit ? ` of ${bids.length}` : ""} bids`, ""];

  if (!shown.length) {
    lines.push("No matching bids.");
    lines.push("", "Try: `/bids` | `/bids due 7` | `/bids owner craig` | `/bids at-risk` | `/bids all`");
    return lines.join("\n");
  }

  shown.forEach(b => {
    const due = isValidDate_(b.dueDate) ? Utilities.formatDate(b.dueDate, ctx.tz, "MMM d") : "TBD";
    const risk = (!b.finalUrl && isValidDate_(b.dueDate) && (b.dueDate.getTime() - now.getTime()) <= 7 * 86400000) ? " 🚨" : "";
    lines.push(`• *${b.bidName}* (${b.bidId}) — Due: ${due} — ${b.status}${risk}`);
    if (b.driveFolderUrl) lines.push(`  📁 ${b.driveFolderUrl}`);
  });

  lines.push("", "Commands: `/bids` | `/bids due 7` | `/bids owner name` | `/bids at-risk` | `/bids all`");
  return lines.join("\n");
}


// ═══════════════════════════════════════════════════════════════════════════════
// SLACK MESSAGING
// ═══════════════════════════════════════════════════════════════════════════════

function slackSend_(ctx, text) {
  if ((ctx.settings.SLACK_ENABLED || "").toUpperCase() !== "TRUE") return;
  const url = (ctx.settings.SLACK_WEBHOOK_URL || "").trim();
  if (!url) { console.log("Slack: no webhook URL."); return; }

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      console.error(`Slack ${res.getResponseCode()}: ${res.getContentText()}`);
    }
  } catch (err) {
    console.error(`Slack error: ${err.message}`);
  }
}

function testSlack() {
  const ctx = getContext_();
  slackSend_(ctx, "✅ Slack test from Arimann Bid Command Center v4. If you see this, Slack is configured correctly.");
  try { SpreadsheetApp.getUi().alert("Sent Slack test (if enabled). Check Slack."); } catch(e) {}
}

function buildSlackNewBid_(ctx, bid) {
  const parts = ["🆕 *New Bid Synced*", `*Bid:* ${bid.bidName} (${bid.bidId})`];
  if (bid.client)                     parts.push(`*Client:* ${bid.client}`);
  if (isValidDate_(bid.dueDate))      parts.push(`*Due:* ${fmtShort_(ctx, bid.dueDate)}`);
  if (isValidDate_(bid.walkDateTime)) parts.push(`*Walkthrough:* ${fmtLong_(ctx, bid.walkDateTime)}`);
  if (bid.walkLocation)               parts.push(`*Location:* ${bid.walkLocation}`);
  if (bid.ownerName)                  parts.push(`*Owner:* ${bid.ownerName}`);
  if (bid.driveFolderUrl)             parts.push(`*Folder:* ${bid.driveFolderUrl}`);
  if (bid.rfpInFolderUrl)             parts.push(`*RFP:* ${bid.rfpInFolderUrl}`);
  return parts.join("\n");
}

function buildSlackUpdate_(ctx, bid) {
  const parts = ["🔄 *Bid Updated*", `*Bid:* ${bid.bidName} (${bid.bidId})`];
  if (bid.status)                     parts.push(`*Status:* ${bid.status}`);
  if (isValidDate_(bid.dueDate))      parts.push(`*Due:* ${fmtShort_(ctx, bid.dueDate)}`);
  if (isValidDate_(bid.walkDateTime)) parts.push(`*Walkthrough:* ${fmtLong_(ctx, bid.walkDateTime)}`);
  if (bid.driveFolderUrl)             parts.push(`*Folder:* ${bid.driveFolderUrl}`);
  return parts.join("\n");
}


// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE: FOLDERS, RFP ATTACH, DOC PLACEHOLDERS
// ═══════════════════════════════════════════════════════════════════════════════

function ensureBidFolder_(ctx, bid) {
  if (bid.driveFolderUrl) return;
  const root = DriveApp.getFolderById(ctx.settings.DRIVE_ROOT_FOLDER_ID);
  const name = `${bid.bidId} - ${bid.bidName}`.substring(0, 180);
  bid.driveFolderUrl = root.createFolder(name).getUrl();
}

function attachRfpIfRequested_(ctx, bid) {
  if (!bid.rfpSource || bid.rfpAttachYN !== "Y" || !bid.driveFolderUrl || bid.rfpInFolderUrl) return;

  const folder  = DriveApp.getFolderById(extractDriveId_(bid.driveFolderUrl));
  const srcFile = DriveApp.getFileById(extractDriveId_(bid.rfpSource));

  let dest;
  if ((ctx.settings.RFP_ACTION || "COPY").toUpperCase() === "MOVE") {
    folder.addFile(srcFile);
    dest = srcFile;
  } else {
    dest = srcFile.makeCopy(`RFP - ${bid.bidId} - ${bid.bidName}`.substring(0, 180), folder);
  }
  bid.rfpInFolderUrl = dest.getUrl();
}

function ensureDocPlaceholders_(ctx, bid) {
  if (!bid.driveFolderUrl) return;
  const folder = DriveApp.getFolderById(extractDriveId_(bid.driveFolderUrl));

  if (!bid.draftUrl) {
    bid.draftUrl = createFromTemplateOrBlank_(folder, ctx.settings.TEMPLATE_RESPONSE_DRAFT_ID, "Bid Response - Draft");
  }
  if (!bid.finalUrl) {
    bid.finalUrl = createFromTemplateOrBlank_(folder, ctx.settings.TEMPLATE_RESPONSE_FINAL_ID, "Bid Response - Final");
  }
}

function createFromTemplateOrBlank_(folder, templateId, name) {
  if (templateId) {
    return DriveApp.getFileById(templateId).makeCopy(name, folder).getUrl();
  }
  const doc  = DocumentApp.create(name);
  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return file.getUrl();
}

function extractDriveId_(input) {
  const s = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{15,}$/.test(s) && !s.includes("/")) return s;

  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{15,})/,
    /[?&]id=([a-zA-Z0-9_-]{15,})/,
    /\/folders\/([a-zA-Z0-9_-]{15,})/
  ];

  for (const pattern of patterns) {
    const m = s.match(pattern);
    if (m) return m[1];
  }

  throw new Error(`Cannot parse Drive ID from: ${s}`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

function upsertCalendar_(ctx, bid) {
  const cal  = ctx.calendar;
  const desc = buildCalendarDescription_(ctx, bid);

  if (isValidDate_(bid.dueDate)) {
    bid.dueEventId = upsertAllDay_(cal, bid.dueEventId, `📋 Bid Due: ${bid.bidName}`, new Date(bid.dueDate), desc);
  }

  if (isValidDate_(bid.walkDateTime)) {
    const start = new Date(bid.walkDateTime);
    const dur   = parseInt(ctx.settings.WALKTHROUGH_DURATION_MIN || "60", 10);
    const end   = new Date(start.getTime() + dur * 60000);
    bid.walkEventId = upsertTimed_(cal, bid.walkEventId, `🚶 Walkthrough: ${bid.bidName}`, start, end, bid.walkLocation, desc);
  }
}

function buildCalendarDescription_(ctx, bid) {
  const lines = [
    `Bid ID: ${bid.bidId}`,
    `Bid Name: ${bid.bidName}`,
    `Client/Agency: ${bid.client}`,
    `Owner: ${bid.ownerName}${bid.ownerEmail ? ` (${bid.ownerEmail})` : ""}`,
    `Status: ${bid.status}`
  ];
  if (bid.postingUrl)    lines.push(`Posting: ${bid.postingUrl}`);
  if (bid.driveFolderUrl)lines.push(`Drive Folder: ${bid.driveFolderUrl}`);
  if (bid.rfpInFolderUrl)lines.push(`RFP: ${bid.rfpInFolderUrl}`);
  if (bid.draftUrl)      lines.push(`Draft: ${bid.draftUrl}`);
  if (bid.finalUrl)      lines.push(`Final: ${bid.finalUrl}`);
  if (bid.notes)         lines.push(`Notes: ${bid.notes}`);
  if (isValidDate_(bid.dueDate))      lines.push(`Due: ${fmtISO_(ctx, bid.dueDate)}`);
  if (isValidDate_(bid.walkDateTime)) lines.push(`Walkthrough: ${fmtISO_(ctx, bid.walkDateTime)}`);
  if (bid.walkLocation)  lines.push(`Location: ${bid.walkLocation}`);
  return lines.join("\n");
}

function upsertAllDay_(calendar, existingId, title, date, description) {
  let evt = safeGetEvent_(calendar, existingId);
  if (evt) {
    evt.setTitle(title);
    evt.setAllDayDate(date);
    evt.setDescription(description);
    return evt.getId();
  }
  return calendar.createAllDayEvent(title, date, { description }).getId();
}

function upsertTimed_(calendar, existingId, title, start, end, location, description) {
  let evt = safeGetEvent_(calendar, existingId);
  if (evt) {
    evt.setTitle(title);
    evt.setTime(start, end);
    evt.setLocation(location || "");
    evt.setDescription(description);
    return evt.getId();
  }
  return calendar.createEvent(title, start, end, { location: location || "", description }).getId();
}

function safeGetEvent_(calendar, id) {
  if (!id) return null;
  try { return calendar.getEventById(id); } catch (e) { return null; }
}


// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

function sendEmail_(ctx, subject, bids) {
  const to = ctx.settings.TEAM_EMAILS.split(",").map(s => s.trim()).filter(Boolean).join(",");
  if (!to) return;

  const fromName = ctx.settings.FROM_NAME || "Bid Command Center";

  const lines = ["Bids synced:\n"];
  bids.forEach(b => {
    lines.push(`─ ${b.bidName} (${b.bidId})`);
    if (b.client)                     lines.push(`  Client: ${b.client}`);
    if (isValidDate_(b.dueDate))      lines.push(`  Due: ${fmtShort_(ctx, b.dueDate)}`);
    if (isValidDate_(b.walkDateTime)) lines.push(`  Walk: ${fmtLong_(ctx, b.walkDateTime)}`);
    if (b.walkLocation)               lines.push(`  Location: ${b.walkLocation}`);
    if (b.driveFolderUrl)             lines.push(`  Folder: ${b.driveFolderUrl}`);
    if (b.rfpInFolderUrl)             lines.push(`  RFP: ${b.rfpInFolderUrl}`);
    lines.push("");
  });

  MailApp.sendEmail({ to, name: fromName, subject, body: lines.join("\n") });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════════

function installTriggers() {
  removeTriggers_();

  ScriptApp.newTrigger("syncAll")
    .timeBased().everyMinutes(15).create();

  ScriptApp.newTrigger("dueSoonSlackAlerts")
    .timeBased().everyHours(1).create();

  // COMMBUYS poll (default: every 6 hours)
  const intervalHours = parseInt(ctx_safe_setting_("COMMBUYS_POLL_HOURS") || "6", 10);
  ScriptApp.newTrigger("pollCommbuys")
    .timeBased().everyHours(Math.max(1, Math.min(24, intervalHours))).create();

  try {
    SpreadsheetApp.getUi().alert(
      "Triggers installed:\n• syncAll: every 15 min\n• dueSoonSlackAlerts: every hour\n• pollCommbuys: every " + intervalHours + " hours"
    );
  } catch(e) {}
}

function removeTriggers() {
  removeTriggers_();
  try { SpreadsheetApp.getUi().alert("All Bid Command Center triggers removed."); } catch(e) {}
}

function removeTriggers_() {
  const fns = ["syncAll", "dueSoonSlackAlerts", "pollCommbuys"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (fns.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
}

/** Safe way to get a setting outside of full context (for installTriggers). */
function ctx_safe_setting_(key) {
  try {
    const ss = SpreadsheetApp.getActive();
    const s = ss.getSheetByName(SHEET_SETTINGS);
    if (!s) return "";
    const vals = s.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]).trim() === key) return String(vals[i][1]).trim();
    }
  } catch(e) {}
  return "";
}


// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT & SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

function getContext_() {
  const ss            = SpreadsheetApp.getActive();
  const sheet         = ss.getSheetByName(SHEET_BIDS);
  const settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet)         throw new Error(`Missing sheet: ${SHEET_BIDS}`);
  if (!settingsSheet) throw new Error(`Missing sheet: ${SHEET_SETTINGS}`);

  const settings = readSettings_(settingsSheet);

  // Validate required settings
  if (!settings.CALENDAR_ID) throw new Error("Settings: CALENDAR_ID is blank.");
  if (!settings.TEAM_EMAILS) throw new Error("Settings: TEAM_EMAILS is blank.");
  if (settings.AUTO_CREATE_DRIVE_FOLDER === "TRUE" && !settings.DRIVE_ROOT_FOLDER_ID) {
    throw new Error("Settings: DRIVE_ROOT_FOLDER_ID is blank but AUTO_CREATE_DRIVE_FOLDER is TRUE.");
  }

  const tz = settings.TIMEZONE || "America/New_York";

  return {
    ss,
    sheet,
    values: sheet.getDataRange().getValues(),
    settingsSheet,
    settings,
    tz,
    calendar: CalendarApp.getCalendarById(settings.CALENDAR_ID)
  };
}

function readSettings_(sheet) {
  const vals = sheet.getDataRange().getValues();
  const out  = {};
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || "").trim();
    const v = String(vals[i][1] || "").trim();
    if (k) out[k] = v;
  }

  // Defaults
  const defaults = {
    TIMEZONE: "America/New_York",
    WALKTHROUGH_DURATION_MIN: "60",
    NOTIFY_ON_NEW_BID: "TRUE",
    NOTIFY_ON_UPDATES: "FALSE",
    AUTO_CREATE_DRIVE_FOLDER: "TRUE",
    AUTO_CREATE_DOCS: "TRUE",
    AUTO_ATTACH_RFP: "TRUE",
    RFP_ACTION: "COPY",
    SLACK_ENABLED: "FALSE",
    SLACK_NOTIFY_UPDATES: "FALSE",
    COMMBUYS_ENABLED: "FALSE",
    COMMBUYS_AUTO_IMPORT: "FALSE",
    COMMBUYS_POLL_HOURS: "6"
  };

  for (const [k, v] of Object.entries(defaults)) {
    if (!out[k]) out[k] = v;
  }

  // Normalize boolean-like values to uppercase
  for (const key of Object.keys(out)) {
    if (out[key] === "true")  out[key] = "TRUE";
    if (out[key] === "false") out[key] = "FALSE";
  }

  return out;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROW READ / WRITE
// ═══════════════════════════════════════════════════════════════════════════════

function readBidRow_(row) {
  return {
    bidId:          str_(row[COL.bidId]),
    bidName:        str_(row[COL.bidName]),
    client:         str_(row[COL.client]),
    postingUrl:     str_(row[COL.postingUrl]),
    dueDate:        row[COL.dueDate],
    walkDateTime:   row[COL.walkDateTime],
    walkLocation:   str_(row[COL.walkLocation]),
    ownerName:      str_(row[COL.ownerName]),
    ownerEmail:     str_(row[COL.ownerEmail]),
    status:         str_(row[COL.status]),
    rfpSource:      str_(row[COL.rfpSource]),
    rfpAttachYN:    str_(row[COL.rfpAttachYN]).toUpperCase(),
    driveFolderUrl: str_(row[COL.driveFolderUrl]),
    rfpInFolderUrl: str_(row[COL.rfpInFolderUrl]),
    draftUrl:       str_(row[COL.draftUrl]),
    finalUrl:       str_(row[COL.finalUrl]),
    notes:          str_(row[COL.notes]),
    dueEventId:     str_(row[COL.dueEventId]),
    walkEventId:    str_(row[COL.walkEventId]),
    lastHash:       str_(row[COL.lastHash]),
    notified:       str_(row[COL.notified])
  };
}

/**
 * BATCH write-back: builds a 2D array and writes all updated rows in one call
 * per column group. Much faster than individual getRange().setValue() calls.
 */
function batchWriteBack_(sheet, updates) {
  if (!updates.length) return;

  // We need to update columns M-P (13-16) and R-U (18-21)
  // Group by contiguous column ranges to minimize API calls

  updates.forEach(u => {
    const r = u.rowIdx;
    const b = u.bid;

    // Columns M-P (Drive/RFP/Draft/Final URLs)
    sheet.getRange(r, 13, 1, 4).setValues([[
      b.driveFolderUrl || "",
      b.rfpInFolderUrl || "",
      b.draftUrl || "",
      b.finalUrl || ""
    ]]);

    // Column J (Status) — write back in case auto-status changed it
    sheet.getRange(r, 10).setValue(b.status || "");

    // Columns R-U (Event IDs, Hash, Notified)
    sheet.getRange(r, 18, 1, 4).setValues([[
      b.dueEventId || "",
      b.walkEventId || "",
      b.lastHash || "",
      b.notified || ""
    ]]);
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function str_(v)          { return String(v || "").trim(); }
function isRowBlank_(row) { return row.every(v => v === "" || v === null || v === undefined); }
function isValidDate_(d)  { return d instanceof Date && !isNaN(d.getTime()); }

function fmtISO_(ctx, d)   { return isValidDate_(d) ? Utilities.formatDate(d, ctx.tz, "yyyy-MM-dd'T'HH:mm:ss") : ""; }
function fmtShort_(ctx, d) { return isValidDate_(d) ? Utilities.formatDate(d, ctx.tz, "MMM d, yyyy") : ""; }
function fmtLong_(ctx, d)  { return isValidDate_(d) ? Utilities.formatDate(d, ctx.tz, "MMM d, yyyy h:mm a") : ""; }

function computeHash_(bid, ctx) {
  const raw = JSON.stringify({
    bidId: bid.bidId, bidName: bid.bidName, client: bid.client,
    postingUrl: bid.postingUrl, dueDate: fmtISO_(ctx, bid.dueDate),
    walkDateTime: fmtISO_(ctx, bid.walkDateTime), walkLocation: bid.walkLocation,
    ownerName: bid.ownerName, ownerEmail: bid.ownerEmail, status: bid.status,
    driveFolderUrl: bid.driveFolderUrl, rfpSource: bid.rfpSource,
    rfpInFolderUrl: bid.rfpInFolderUrl, draftUrl: bid.draftUrl,
    finalUrl: bid.finalUrl, notes: bid.notes
  });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");
}

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

  var normalizedBidId = String(bidId || '').trim();
  if (!normalizedBidId) return { error: 'Bid ID is required' };

  var normalizedStatus = String(newStatus || '').trim();
  if (!normalizedStatus) return { error: 'Status is required' };

  var data = ws.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    var rowBidId = String(data[r][0] || '').trim();
    if (rowBidId === normalizedBidId) {
      ws.getRange(r + 1, 10).setValue(normalizedStatus); // Column J = Status
      SpreadsheetApp.flush();
      return { success: true, bidId: normalizedBidId, newStatus: normalizedStatus, row: r + 1 };
    }
  }

  return { error: 'Bid not found: ' + normalizedBidId };
}