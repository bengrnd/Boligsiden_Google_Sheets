# Boligsiden Google Sheets Tracker

Google Apps Script automation that imports Boligsiden email alerts into a Google Sheet.

The script reads Boligsiden alert emails from Gmail, parses new property listings, deduplicates them, enriches them with optional Google Maps commute estimates, and appends them to a `Listings` sheet.

## Why this exists

Looking for an apartment can become repetitive and cumbersome. Boligsiden alerts are useful because they already notify you when new listings match a saved search, but the next step is often manual: opening each alert, copying addresses, prices, sizes, links, and then checking whether the location actually works.

This setup turns Boligsiden email alerts into a lightweight data pipeline. The alert email acts as the input feed, and the Google Sheet becomes the apartment-search dashboard. Instead of manually copying data from every email, the script imports listings automatically, avoids duplicates, and adds quality-of-life fields such as clickable map links, commute time, and route distance.

The goal is not to scrape Boligsiden or replace proper due diligence. The goal is to make the first triage easier: see new listings in one place, compare them quickly, and decide which ones are worth reviewing, contacting, or visiting.

## Features

- Imports listings from Boligsiden alert emails in Gmail.
- Works with archived emails because it uses Gmail search, not the inbox only.
- Parses address, postcode, city, price, rooms, size, price per square meter, and listing URL.
- Deduplicates listings before adding new rows.
- Adds clickable rich-text links:
  - the `Address` cell opens Google Maps;
  - the `Listing URL` cell displays `Link` instead of the full URL.
- Optionally calculates commute time and distance for two anonymised destinations:
  - `Commute A` by bike and public transport;
  - `Commute B` by bike and public transport.
- Copies formatting and dropdown validation from the previous row when appending new rows.
- Keeps technical deduplication columns hidden.

## Repository contents

- `Code.gs` — the Google Apps Script source file.
- `README.md` — setup and usage instructions.
- `LICENSE` — MIT license.

## Privacy note

This repository is designed to be public-safe.

Do not commit:

- your real Google Sheet ID;
- your real commute destinations;
- private home or work addresses;
- personal names;
- private Gmail labels;
- raw email content;
- exported Google Sheet data.

Use placeholders in the public repository and add private values only inside your own Google Apps Script project.

## Setup

### 1. Create a Google Sheet

Create or open a Google Sheet. The script will use a tab named:

```text
Listings
```

The script creates the required headers automatically if the sheet is empty.

### 2. Get the spreadsheet ID

From a Google Sheet URL like:

```text
https://docs.google.com/spreadsheets/d/1abcDEFExampleSpreadsheetId/edit
```

The spreadsheet ID is:

```text
1abcDEFExampleSpreadsheetId
```

Paste it into `Code.gs`:

```javascript
const SPREADSHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
```

### 3. Configure commute destinations

In `Code.gs`, replace the placeholders only in your private Apps Script project:

```javascript
const COMMUTE_A_DESTINATION = "PASTE_COMMUTE_A_DESTINATION_HERE";
const COMMUTE_B_DESTINATION = "PASTE_COMMUTE_B_DESTINATION_HERE";
```

Use full addresses for better Maps results. Leave the placeholders unchanged if you do not want commute calculations.

### 4. Create a Gmail filter

Create a Gmail filter for Boligsiden alerts. A typical filter is:

```text
from:noreply@boligsiden.dk
```

You can archive and label the emails if you want. The script still finds archived messages because it uses:

```javascript
const GMAIL_SEARCH_QUERY = 'from:noreply@boligsiden.dk subject:boliger newer_than:30d';
```

You may adjust this query for your own alert emails.

### 5. Add the script to Apps Script

In the Google Sheet:

```text
Extensions → Apps Script
```

Paste the content of `Code.gs` into the Apps Script editor.

### 6. Run once manually

Run:

```javascript
importBoligsidenAlerts
```

The first run will ask for permissions to access Gmail, Google Sheets, and Maps.

### 7. Add a daily trigger

In Apps Script:

```text
Triggers → Add Trigger
```

Recommended trigger:

- function: `importBoligsidenAlerts`
- event source: time-driven
- frequency: daily
- time: evening window

Do not schedule debug or test helper functions.

## Sheet columns

The script creates and uses these columns:

| Column | Description |
|---|---|
| Address | Property address, clickable Google Maps link |
| Postcode | Parsed Danish postcode |
| City | Parsed city |
| Price DKK | Listing price |
| Rooms | Number of rooms |
| Price per m² | Calculated price per square meter |
| Commute A bike | Bike commute time in minutes |
| Commute A public transport | Transit commute time in minutes |
| Commute A distance km | Route distance in kilometers |
| Commute B bike | Bike commute time in minutes |
| Commute B public transport | Transit commute time in minutes |
| Commute B distance km | Route distance in kilometers |
| Listing URL | Clickable `Link` to the listing |
| Date | Email received date |
| Status | Manual triage field |
| Priority | Manual triage field |
| Rejection reason | Manual triage field |
| Notes | Manual notes |
| Unique key | Hidden technical deduplication key |
| Gmail message ID | Hidden technical Gmail ID |

## Deduplication logic

The script deduplicates listings with this key:

```text
normalised address + price + size
```

This means a listing with the same address and size but a changed price will be imported as a new row. That can be useful for tracking price changes. If strict deduplication is preferred, change `buildUniqueKey_()` to exclude price.

## Maps behaviour

Maps lookups happen only after deduplication. Duplicate listings do not trigger route lookups.

For each new listing, the script can perform up to four route lookups:

- Commute A by bike;
- Commute A by public transport;
- Commute B by bike;
- Commute B by public transport.

If commute destinations are still placeholders, commute cells remain blank.

## Useful manual workflow

Suggested values for `Status`:

```text
New
Review
Interested
Contacted
Viewing
Rejected
Archived
```

Suggested values for `Priority`:

```text
A
B
C
```

Suggested values for `Rejection reason`:

```text
Too expensive
Too far
Too small
Bad commute
Bad condition
Other
```

Use Google Sheets dropdowns, filters, and conditional formatting for these manual columns.

## Debug helpers

The script includes optional manual debug functions:

- `debugBoligsidenSearch()` — checks whether Gmail search finds matching alert emails.
- `debugBoligsidenParsing()` — checks whether listings are parsed from matching emails.
- `testAppendDummyListingRow()` — appends a dummy row to test formatting and links.

These functions are not used by the daily trigger unless you explicitly schedule them.

## Limitations

- The parser is tailored to the plain-text structure of Boligsiden alert emails.
- If Boligsiden changes the email format, `parseBoligsidenPlainText_()` may need adjustment.
- Maps route estimates depend on Google's Maps service and Apps Script quotas.
- Transit estimates use the current time as the departure time.
- The script does not scrape Boligsiden directly.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE) for details.
