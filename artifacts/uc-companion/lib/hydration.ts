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