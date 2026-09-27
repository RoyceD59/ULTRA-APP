import { Linking } from 'react-native';

/** Official Ultra Clear WhatsApp line: +254 717 774049 */
export const UC_WHATSAPP_NUMBER = '254717774049';
export const UC_WHATSAPP_DISPLAY = '+254 717 774049';

/**
 * Open WhatsApp with a pre-filled message addressed to the official
 * Ultra Clear number. Uses the universal wa.me link, which works on
 * iOS, Android, and web (WhatsApp Web).
 */
export function openWhatsApp(message: string): void {
  const url = `https://wa.me/${UC_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  Linking.openURL(url).catch(() => {});
}
