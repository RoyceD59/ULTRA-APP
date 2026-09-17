/**
 * Ultra Clear lead backup endpoint.
 *
 * Configure Script Properties:
 *   SPREADSHEET_ID - destination spreadsheet ID
 *   SHEET_NAME     - optional tab name (defaults to Leads)
 *
 * Deploy as a web app with POST access for the configured server/browser
 * integration. This endpoint intentionally does not implement JSONP or GET
 * writes: personal data must not travel in URLs.
 */
function doGet() {
  return json_({ status: "error", reason: "POST_REQUIRED" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ status: "error", reason: "TEMPORARY_FAILURE" });
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.schemaVersion !== 1) return json_({ status: "error", reason: "INVALID_SCHEMA" });
    if (Object.prototype.hasOwnProperty.call(body, "assessmentId") ||
        Object.prototype.hasOwnProperty.call(body, "reference") ||
        Object.prototype.hasOwnProperty.call(body, "sourceAttribution")) {
      return json_({ status: "error", reason: "DISALLOWED_FIELDS" });
    }
    var required = ["submissionId", "idempotencyKey", "firstName", "phone", "country", "area", "source", "concern", "setting", "consent"];
    for (var i = 0; i < required.length; i++) {
      if (typeof body[required[i]] !== "string" || !body[required[i]].trim()) {
        return json_({ status: "error", reason: "INVALID_PAYLOAD" });
      }
    }
    var props = PropertiesService.getScriptProperties();
    var spreadsheetId = props.getProperty("SPREADSHEET_ID");
    if (!spreadsheetId) return json_({ status: "error", reason: "UNCONFIGURED" });
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(props.getProperty("SHEET_NAME") || "Leads");
    if (!sheet) return json_({ status: "error", reason: "SHEET_NOT_FOUND" });
    var values = sheet.getDataRange().getValues();
    var headers = values.length ? values[0] : [];
    if (!headers.length) {
      headers = ["receivedAt", "submissionId", "idempotencyKey", "firstName", "phone", "country", "area", "source", "concern", "setting", "consent", "consentVersion"];
      sheet.appendRow(headers);
    }
    var submissionColumn = headers.indexOf("submissionId");
    if (submissionColumn >= 0) {
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][submissionColumn]) === body.submissionId) return json_({ status: "duplicate" });
      }
    }
    sheet.appendRow([
       new Date(), body.submissionId, body.idempotencyKey,
      body.firstName, body.phone, body.country, body.area, body.source, body.concern,
       body.setting, body.consent, body.consentVersion || ""
    ]);
    return json_({ status: "ok" });
  } catch (err) {
    return json_({ status: "error", reason: "TEMPORARY_FAILURE" });
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}