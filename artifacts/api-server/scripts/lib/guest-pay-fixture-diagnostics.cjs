'use strict';

// Only fixed categories and documented public error codes may leave this helper.
// Never emit a response message, reference, contact, credential or callback URL.
const codes = new Set(['0', '1', '400.002.01', '400.002.02', '400.002.03',
  '400.003.01', '400.003.02', '401.001.01', '404.001.03', '500.001.1000',
  '500.001.1001', '500.002.1001']);
function summarize(status, body) {
  const object = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const candidate = object.errorCode ?? object.ResponseCode;
  const code = codes.has(candidate) ? candidate : 'unclassified';
  const message = typeof object.errorMessage === 'string' ? object.errorMessage.toLowerCase() : '';
  let issue = 'unclassified';
  if (/merchant.*(?:not exist|not found)/.test(message)) issue = 'merchant_not_found';
  else if (/password|wrong credentials|invalid credentials/.test(message)) issue = 'credential_mismatch';
  else if (/not subscribed|product.*not enabled|not authorised|not authorized/.test(message)) issue = 'product_unavailable';
  else if (/invalid.*parameter|bad request/.test(message)) issue = 'invalid_request';
  return { status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0,
    code, issue, referenceReturned: typeof object.CheckoutRequestID === 'string' && !!object.CheckoutRequestID.trim() };
}

async function inspectResponse(response) {
  let reader, timer;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return summarize(response.status, null);
    const read = async () => {
      const parts = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) return summarize(response.status, null);
        parts.push(Buffer.from(value));
      }
      return summarize(response.status, JSON.parse(Buffer.concat(parts).toString('utf8')));
    };
    return await Promise.race([read(), new Promise(resolve => {
      timer = setTimeout(() => resolve(summarize(response.status, null)), 1000);
    })]);
  } catch {
    return summarize(response.status, null);
  } finally {
    clearTimeout(timer);
    // A tee branch may await consumption of the original response on cancel.
    // Do not block the actual payment handler on diagnostic cleanup.
    if (reader) void reader.cancel().catch(() => {});
  }
}
module.exports = { summarize, inspectResponse };
