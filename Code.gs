/***** CONFIG *****/

// Paste the ID from your Google Sheet URL:
// https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
const SPREADSHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
const SHEET_NAME = "Listings";

// Gmail search query used to find Boligsiden alert emails.
// Works even when matching emails are archived / in All Mail.
const GMAIL_SEARCH_QUERY = 'from:noreply@boligsiden.dk subject:boliger newer_than:30d';
const MAX_THREADS_PER_RUN = 50;

// Optional commute destinations. Keep private addresses out of public repos.
const COMMUTE_A_DESTINATION = "PASTE_COMMUTE_A_DESTINATION_HERE";
const COMMUTE_B_DESTINATION = "PASTE_COMMUTE_B_DESTINATION_HERE";

/***** HEADERS *****/

const REQUIRED_HEADERS = [
  "Address",
  "Postcode",
  "City",
  "Price DKK",
  "Rooms",
  "Price per m²",
  "Commute A bike",
  "Commute A public transport",
  "Commute A distance km",
  "Commute B bike",
  "Commute B public transport",
  "Commute B distance km",
  "Listing URL",
  "Date",
  "Status",
  "Priority",
  "Rejection reason",
  "Notes",
  "Unique key",
  "Gmail message ID"
];

/***** MAIN FUNCTION *****/

function importBoligsidenAlerts() {
  const sheet = getOrCreateListingsSheet_();
  ensureHeaderRow_(sheet);

  const existingKeys = getExistingUniqueKeys_(sheet);
  const threads = GmailApp.search(GMAIL_SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);
  Logger.log(`Threads found: ${threads.length}`);

  const rowsToAppend = [];

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const messageId = message.getId();
      const subject = message.getSubject();
      const receivedAt = message.getDate();
      const listings = parseBoligsidenPlainText_(message.getPlainBody());

      Logger.log(`Message: ${subject}`);
      Logger.log(`Listings parsed: ${listings.length}`);

      for (const listing of listings) {
        listing.receivedAt = receivedAt;
        listing.messageId = messageId;
        listing.uniqueKey = buildUniqueKey_(listing);

        // Deduplication happens before route lookups.
        if (!existingKeys.has(listing.uniqueKey)) {
          rowsToAppend.push(toSheetRowObject_(listing));
          existingKeys.add(listing.uniqueKey);
          Logger.log(`Queued: ${listing.address}`);
        } else {
          Logger.log(`Skipped duplicate: ${listing.address}`);
        }
      }
    }
  }

  Logger.log(`Rows to append: ${rowsToAppend.length}`);

  if (rowsToAppend.length > 0) {
    appendRowsWithFormatting_(sheet, rowsToAppend);
    Logger.log(`Rows appended successfully: ${rowsToAppend.length}`);
  }
}

/***** APPEND WITH FORMATTING + RICH LINKS *****/

function appendRowsWithFormatting_(sheet, rowObjects) {
  const startRow = sheet.getLastRow() + 1;
  const numberOfRows = rowObjects.length;
  const lastColumn = sheet.getLastColumn();

  if (startRow > 2) {
    const sourceRange = sheet.getRange(startRow - 1, 1, 1, lastColumn);
    const targetRange = sheet.getRange(startRow, 1, numberOfRows, lastColumn);

    sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }

  const headerMap = getHeaderMap_(sheet);
  const headersToWrite = new Set();

  rowObjects.forEach(rowObject => {
    Object.keys(rowObject).forEach(header => {
      if (!header.startsWith("__")) headersToWrite.add(header);
    });
  });

  headersToWrite.forEach(header => {
    const col = headerMap[header];
    if (!col) {
      Logger.log(`Header not found, skipped: ${header}`);
      return;
    }

    const values = rowObjects.map(rowObject => [rowObject[header] ?? ""]);
    sheet.getRange(startRow, col, numberOfRows, 1).setValues(values);
  });

  applyRichTextLinks_(sheet, rowObjects, startRow);
}

function applyRichTextLinks_(sheet, rowObjects, startRow) {
  const headerMap = getHeaderMap_(sheet);
  const addressCol = headerMap["Address"];
  const listingUrlCol = headerMap["Listing URL"];

  if (addressCol) {
    const values = rowObjects.map(rowObject => {
      const builder = SpreadsheetApp.newRichTextValue().setText(String(rowObject["Address"] || ""));
      if (rowObject["__addressUrl"]) builder.setLinkUrl(rowObject["__addressUrl"]);
      return [builder.build()];
    });

    sheet.getRange(startRow, addressCol, rowObjects.length, 1).setRichTextValues(values);
  }

  if (listingUrlCol) {
    const values = rowObjects.map(rowObject => {
      const builder = SpreadsheetApp.newRichTextValue().setText("Link");
      if (rowObject["__listingUrl"]) builder.setLinkUrl(rowObject["__listingUrl"]);
      return [builder.build()];
    });

    sheet.getRange(startRow, listingUrlCol, rowObjects.length, 1).setRichTextValues(values);
  }
}

/***** MAPS / COMMUTE *****/

function getCommuteValues_(address) {
  const commuteABike = getRouteInfo_(address, COMMUTE_A_DESTINATION, Maps.DirectionFinder.Mode.BICYCLING, "Commute A bike");
  const commuteATransit = getRouteInfo_(address, COMMUTE_A_DESTINATION, Maps.DirectionFinder.Mode.TRANSIT, "Commute A public transport");
  const commuteBBike = getRouteInfo_(address, COMMUTE_B_DESTINATION, Maps.DirectionFinder.Mode.BICYCLING, "Commute B bike");
  const commuteBTransit = getRouteInfo_(address, COMMUTE_B_DESTINATION, Maps.DirectionFinder.Mode.TRANSIT, "Commute B public transport");

  return {
    "Commute A bike": commuteABike.durationMin,
    "Commute A public transport": commuteATransit.durationMin,
    "Commute A distance km": commuteABike.distanceKm || commuteATransit.distanceKm,
    "Commute B bike": commuteBBike.durationMin,
    "Commute B public transport": commuteBTransit.durationMin,
    "Commute B distance km": commuteBBike.distanceKm || commuteBTransit.distanceKm
  };
}

function getRouteInfo_(origin, destination, mode, label) {
  try {
    if (!destination || destination.includes("PASTE_")) {
      Logger.log(`Destination not configured for ${label}`);
      return { durationMin: "", distanceKm: "" };
    }

    let finder = Maps.newDirectionFinder()
      .setOrigin(formatMapsAddress_(origin))
      .setDestination(formatMapsAddress_(destination))
      .setMode(mode)
      .setRegion("dk")
      .setLanguage("en");

    if (mode === Maps.DirectionFinder.Mode.TRANSIT) {
      finder = finder.setDepart(new Date());
    }

    const directions = finder.getDirections();

    if (!directions || !directions.routes || !directions.routes.length) {
      Logger.log(`No route found for ${label}: ${origin} -> ${destination}`);
      return { durationMin: "", distanceKm: "" };
    }

    const leg = directions.routes[0].legs && directions.routes[0].legs[0];
    if (!leg) return { durationMin: "", distanceKm: "" };

    return {
      durationMin: leg.duration && leg.duration.value ? Math.round(leg.duration.value / 60) : "",
      distanceKm: leg.distance && leg.distance.value ? Math.round((leg.distance.value / 1000) * 10) / 10 : ""
    };
  } catch (error) {
    Logger.log(`Route lookup failed for ${label}: ${error}`);
    return { durationMin: "", distanceKm: "" };
  }
}

function formatMapsAddress_(address) {
  const value = String(address || "").trim();
  if (!value) return "";
  if (/denmark|danmark/i.test(value)) return value;
  return `${value}, Denmark`;
}

function makeGoogleMapsAddressUrl_(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(formatMapsAddress_(address));
}

/***** PARSING *****/

function parseBoligsidenPlainText_(body) {
  const text = body
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const regex = /([^\n]+)\n\s*([\d.]+)\s*kr\.?\s*\n\s*(\d+)\s+v[æa]relser\s*\n\s*([\d.,]+)\s*m2\s*\n\s*Se bolig:\s*(https?:\/\/[^\s]+)/gi;
  const listings = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const address = match[1].trim();
    if (!address || /nye boliger/i.test(address)) continue;

    listings.push({
      address,
      priceDkk: parseDanishNumber_(match[2]),
      rooms: parseInt(match[3], 10),
      sizeM2: parseDanishNumber_(match[4]),
      listingUrl: cleanUrl_(match[5])
    });
  }

  return listings;
}

function parseDanishNumber_(value) {
  if (value === null || value === undefined) return "";

  const cleaned = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const number = Number(cleaned);
  return isNaN(number) ? "" : number;
}

function cleanUrl_(url) {
  return String(url).replace(/\s+/g, "").replace(/=$/, "").trim();
}

/***** DEDUPLICATION *****/

function buildUniqueKey_(listing) {
  const normalizedAddress = normalizeKeyPart_(listing.address);
  const price = listing.priceDkk || "";
  const size = listing.sizeM2 || "";
  return `listing:${normalizedAddress}|${price}|${size}`;
}

function normalizeKeyPart_(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\wæøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getExistingUniqueKeys_(sheet) {
  const lastRow = sheet.getLastRow();
  const keys = new Set();
  if (lastRow < 2) return keys;

  const uniqueKeyCol = getHeaderMap_(sheet)["Unique key"];
  if (!uniqueKeyCol) return keys;

  const values = sheet.getRange(2, uniqueKeyCol, lastRow - 1, 1).getValues();
  values.forEach(row => {
    if (row[0]) keys.add(String(row[0]));
  });

  return keys;
}

/***** SHEET SETUP *****/

function getOrCreateListingsSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaderRow_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const isEmpty = firstRow.every(cell => cell === "");

  if (isEmpty) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
    sheet.setFrozenRows(1);
    hideTechnicalColumns_(sheet);
    return;
  }

  const existingHeaders = getHeaderRow_(sheet);
  const missingHeaders = REQUIRED_HEADERS.filter(header => !existingHeaders.includes(header));

  if (missingHeaders.length > 0) {
    const insertAtColumn = sheet.getLastColumn() + 1;
    sheet.getRange(1, insertAtColumn, 1, missingHeaders.length).setValues([missingHeaders]);
    Logger.log(`Added missing headers: ${missingHeaders.join(", ")}`);
  }

  sheet.setFrozenRows(1);
  hideTechnicalColumns_(sheet);
}

function hideTechnicalColumns_(sheet) {
  const headerMap = getHeaderMap_(sheet);
  if (headerMap["Unique key"]) sheet.hideColumns(headerMap["Unique key"]);
  if (headerMap["Gmail message ID"]) sheet.hideColumns(headerMap["Gmail message ID"]);
}

function getHeaderRow_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || "").trim());
}

function getHeaderMap_(sheet) {
  const headers = getHeaderRow_(sheet);
  const map = {};
  headers.forEach((header, index) => {
    if (header && !map[header]) map[header] = index + 1;
  });
  return map;
}

/***** SHEET ROW OBJECT *****/

function toSheetRowObject_(listing) {
  const addressParts = parsePostcodeAndCity_(listing.address);
  const pricePerM2 = listing.priceDkk && listing.sizeM2 ? Math.round(listing.priceDkk / listing.sizeM2) : "";
  const commuteValues = getCommuteValues_(listing.address);

  return {
    "Address": listing.address,
    "Postcode": addressParts.postcode,
    "City": addressParts.city,
    "Price DKK": listing.priceDkk,
    "Rooms": listing.rooms,
    "Price per m²": pricePerM2,
    "Commute A bike": commuteValues["Commute A bike"],
    "Commute A public transport": commuteValues["Commute A public transport"],
    "Commute A distance km": commuteValues["Commute A distance km"],
    "Commute B bike": commuteValues["Commute B bike"],
    "Commute B public transport": commuteValues["Commute B public transport"],
    "Commute B distance km": commuteValues["Commute B distance km"],
    "Listing URL": "Link",
    "Date": listing.receivedAt,
    "Status": "New",
    "Priority": "",
    "Rejection reason": "",
    "Notes": "",
    "Unique key": listing.uniqueKey,
    "Gmail message ID": listing.messageId,
    "__addressUrl": makeGoogleMapsAddressUrl_(listing.address),
    "__listingUrl": listing.listingUrl
  };
}

function parsePostcodeAndCity_(address) {
  const match = address.match(/,\s*(\d{4})\s+([^,]+)$/);
  if (match) return { postcode: match[1], city: match[2].trim() };

  const fallback = address.match(/\b(\d{4})\s+([^,]+)$/);
  if (fallback) return { postcode: fallback[1], city: fallback[2].trim() };

  return { postcode: "", city: "" };
}

/***** DEBUG / TEST HELPERS *****/

function debugBoligsidenSearch() {
  const threads = GmailApp.search(GMAIL_SEARCH_QUERY, 0, 10);
  Logger.log(`Threads found: ${threads.length}`);

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      Logger.log(message.getDate());
      Logger.log(message.getSubject());
      Logger.log(message.getFrom());
      Logger.log(message.getPlainBody().slice(0, 1000));
    });
  });
}

function debugBoligsidenParsing() {
  const threads = GmailApp.search(GMAIL_SEARCH_QUERY, 0, 5);
  Logger.log(`Threads found: ${threads.length}`);

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const listings = parseBoligsidenPlainText_(message.getPlainBody());
      Logger.log(message.getSubject());
      Logger.log(`Listings parsed: ${listings.length}`);
      Logger.log(JSON.stringify(listings, null, 2));
    });
  });
}

function testAppendDummyListingRow() {
  const sheet = getOrCreateListingsSheet_();
  ensureHeaderRow_(sheet);

  const now = new Date();
  const dummyListing = {
    receivedAt: now,
    address: "Example Street 1, 1000 Copenhagen",
    priceDkk: 5000000,
    sizeM2: 90,
    rooms: 3,
    listingUrl: "https://example.com/test-listing",
    uniqueKey: `test:${now.getTime()}`,
    messageId: `test-message-${now.getTime()}`
  };

  appendRowsWithFormatting_(sheet, [toSheetRowObject_(dummyListing)]);
  Logger.log("Dummy listing row appended successfully.");
}
