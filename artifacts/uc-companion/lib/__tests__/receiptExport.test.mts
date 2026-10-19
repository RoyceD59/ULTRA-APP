import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerReceipt } from '@workspace/api-zod/order-receipt';
import { exportReceiptPdf, type ReceiptExportServices } from '../../utils/receiptExport.ts';

const receipt = buildCustomerReceipt({
  id: 181, dateCreated: '2026-10-07T09:00:00Z', currency: 'KES', total: '100',
  lineItems: [{ name: 'Test filter', quantity: 1, total: '100' }], paymentMethod: 'cod',
});

function services(calls: string[]): ReceiptExportServices {
  return {
    platform: 'ios',
    printBrowser: async (html) => { assert.ok(html.includes(receipt.serial)); calls.push('browser'); },
    sharingAvailable: async () => true,
    printToFile: async ({ html }) => {
      assert.ok(html.includes('Test filter'));
      assert.ok(html.includes('not proof of payment'));
      calls.push('print'); return { uri: 'file:///test-receipt.pdf' };
    },
    shareFile: async (uri, options) => {
      assert.equal(uri, 'file:///test-receipt.pdf');
      assert.equal(options.mimeType, 'application/pdf');
      calls.push('share');
    },
    removeFile: async () => { calls.push('remove'); },
  };
}

describe('receipt PDF export', () => {
  it('prints only the complete receipt document on web, not app navigation', async () => {
    const calls: string[] = [];
    await exportReceiptPdf(receipt, { ...services(calls), platform: 'web' });
    assert.deepEqual(calls, ['browser']);
  });
  it('shares a PDF then removes the private temporary source on native', async () => {
    const calls: string[] = [];
    await exportReceiptPdf(receipt, services(calls));
    assert.deepEqual(calls, ['print', 'share', 'remove']);
  });
  it('fails explicitly before printing if file sharing is unavailable', async () => {
    const calls: string[] = [];
    await assert.rejects(exportReceiptPdf(receipt, { ...services(calls), sharingAvailable: async () => false }), /not available/);
    assert.deepEqual(calls, []);
  });
  it('cleans up after a failed or dismissed sharing operation', async () => {
    const calls: string[] = [];
    await assert.rejects(exportReceiptPdf(receipt, {
      ...services(calls), shareFile: async () => { calls.push('share'); throw new Error('cancelled'); },
    }), /cancelled/);
    assert.deepEqual(calls, ['print', 'share', 'remove']);
  });
});
