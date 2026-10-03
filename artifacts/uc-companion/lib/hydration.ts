export function localCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseLitres(input: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(input.trim())) return null;
  const value = Number(input.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function validReminderTime(input: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(input);
}

export function dailyWaterSummary(signedIn: boolean, state: 'loading' | 'error' | 'ready' | 'empty', litres: number | null | undefined) {
  if (!signedIn) return 'Sign in to log today’s consumption';
  if (state === 'loading') return 'Open water logging';
  if (state === 'error') return 'Total unavailable · open to retry';
  return litres == null ? 'Today: not recorded · log your daily total' : `Today: ${litres} L · tap to edit`;
}