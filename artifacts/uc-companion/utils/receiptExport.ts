import { Platform, Linking } from 'react-native';
import { customerReceiptHtml, customerReceiptText, type CustomerReceipt } from '@workspace/api-zod/order-receipt';
import { printGuideInBrowser } from './guideToPdf';

export interface ReceiptExportServices {
  platform: string;
  printBrowser: (html: string) => Promise<void>;
  sharingAvailable: () => Promise<boolean>;
  printToFile: (options: { html: string }) => Promise<{ uri: string }>;
  shareFile: (uri: string, options: { mimeType: string; UTI: string; dialogTitle: string }) => Promise<void>;
  removeFile: (uri: string) => Promise<void>;
}

export async function exportReceiptPdf(receipt: CustomerReceipt, services: ReceiptExportServices): Promise<void> {
  const html = customerReceiptHtml(receipt);
  if (services.platform === 'web') {
    await services.printBrowser(html);
    return;
  }
  if (!await services.sharingAvailable()) throw new Error('Saving and sharing PDF files is not available on this device. You can take a screenshot of the receipt instead.');
  const { uri } = await services.printToFile({ html });
  try {
    await services.shareFile(uri, {
      mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Save or share ${receipt.serial}`,
    });
  } finally {
    // The receipt contains personal details; remove the temporary source after
    // the sharing dialog closes. A saved/shared destination remains untouched.
    await services.removeFile(uri);
  }
}

export async function saveReceiptPdf(receipt: CustomerReceipt): Promise<void> {
  if (Platform.OS === 'web') return printGuideInBrowser(customerReceiptHtml(receipt));
  const [Print, Sharing, FileSystem] = await Promise.all([
    import('expo-print'), import('expo-sharing'), import('expo-file-system'),
  ]);
  return exportReceiptPdf(receipt, {
    platform: Platform.OS, printBrowser: printGuideInBrowser,
    sharingAvailable: Sharing.isAvailableAsync, printToFile: Print.printToFileAsync,
    shareFile: Sharing.shareAsync,
    removeFile: async (uri) => { new FileSystem.File(uri).delete(); },
  });
}

export async function shareReceipt(receipt: CustomerReceipt): Promise<void> {
  if (Platform.OS !== 'web') return saveReceiptPdf(receipt);
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({ title: `Ultra Clear receipt ${receipt.serial}`, text: customerReceiptText(receipt) });
    return;
  }
  throw new Error('Your browser does not support the sharing menu. Use WhatsApp or Save PDF instead.');
}

export function shareReceiptToWhatsApp(receipt: CustomerReceipt): Promise<void> {
  // Only runs on an explicit customer tap. No automatic send or public URL.
  return Linking.openURL(`https://wa.me/?text=${encodeURIComponent(customerReceiptText(receipt))}`);
}
