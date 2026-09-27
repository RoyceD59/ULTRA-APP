/**
 * Google Sheets fetch utility.
 *
 * Supports two modes:
 *   1. Public fetch  — "Anyone with the link can view" sheets, no auth required.
 *   2. OAuth fetch   — Private sheets accessed with a Google OAuth 2.0 access token.
 *
 * The caller passes an optional `accessToken`. When present, requests are sent
 * with `Authorization: Bearer <token>` which allows access to private sheets.
 */

export interface RawRow {
  [key: string]: string;
}

/**
 * Convert a Google Sheets share URL to a CSV export URL.
 *
 * Supported input formats:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit#gid={GID}
 *   https://docs.google.com/spreadsheets/d/{ID}/edit?usp=sharing
 *   https://docs.google.com/spreadsheets/d/{ID}/pub?gid={GID}&single=true&output=csv
 *   https://docs.google.com/spreadsheets/d/{ID}/
 *
 * @param shareUrl  The URL pasted by the user.
 * @param gid       Optional sheet GID override (e.g. from tab selector).
 */
export function sheetsShareUrlToCsvUrl(shareUrl: string, gid?: string): string {
  const match = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match?.[1]) {
    throw new Error(
      "Invalid Google Sheets URL — could not extract spreadsheet ID. " +
        "Make sure you copy the full URL from the browser address bar."
    );
  }
  const spreadsheetId = match[1];

  // Try to extract GID from the URL when not explicitly provided
  if (!gid) {
    const gidMatch = shareUrl.match(/[#&?]gid=(\d+)/);
    if (gidMatch?.[1]) gid = gidMatch[1];
  }

  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`
  );
  url.searchParams.set("format", "csv");
  if (gid) url.searchParams.set("gid", gid);
  return url.toString();
}

/**
 * Extract the spreadsheet ID from a share URL (for display/storage).
 */
export function extractSpreadsheetId(shareUrl: string): string | null {
  const match = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}


/**
 * Parse a CSV string into an array of row objects (header row → keys).
 */
export function parseCsv(csv: string): RawRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0] ?? "");
  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const values = splitCsvLine(line);
    const row: RawRow = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Minimal RFC 4180 CSV field splitter (handles quoted fields with embedded commas).
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Fetch a Google Sheet as parsed CSV rows.
 *
 * @param shareUrl   Google Sheets share URL.
 * @param gid        Optional sheet GID override.
 * @param accessToken  If provided, sent as `Authorization: Bearer <token>` to
 *                     allow access to private sheets. When omitted, the request
 *                     is made without credentials (public sheets only).
 *
 * Throws on network errors, non-200 responses, or HTML redirect/login pages
 * (which Google returns when a sheet is private and no valid token is supplied).
 */
export async function fetchSheetRows(
  shareUrl: string,
  gid?: string,
  accessToken?: string | null
): Promise<RawRow[]> {
  const csvUrl = sheetsShareUrlToCsvUrl(shareUrl, gid);

  const headers: Record<string, string> = {
    Accept: "text/csv,text/plain,*/*",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const res = await fetch(csvUrl, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const isPrivateError = res.status === 401 || res.status === 403;
    if (isPrivateError && !accessToken) {
      throw new Error(
        `Could not fetch sheet data (HTTP ${res.status}). ` +
          "The sheet appears to be private. Connect your Google account to access private sheets."
      );
    }
    throw new Error(
      `Could not fetch sheet data (HTTP ${res.status}). ` +
        (accessToken
          ? "Check that the connected Google account has access to this sheet."
          : "Make sure the spreadsheet is shared as 'Anyone with the link can view'.")
    );
  }

  const csv = await res.text();

  // Detect HTML login/error pages returned by Google when the sheet is private
  // or sharing has been revoked (Google returns 200 with HTML in that case).
  const trimmed = csv.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
    if (!accessToken) {
      throw new Error(
        "Google returned a login page instead of CSV data. " +
          "The sheet appears to be private. Connect your Google account to access private sheets, " +
          "or share the sheet as 'Anyone with the link can view'."
      );
    }
    throw new Error(
      "Google returned a login page despite a valid OAuth token. " +
        "Your Google authorization may have expired — please disconnect and reconnect your account."
    );
  }

  return parseCsv(csv);
}
