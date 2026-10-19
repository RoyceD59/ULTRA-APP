/** Preserve explicit slots; assign legacy unnumbered clips without changing rows. */
export function productVideoSlots<T extends { type: string; position: number; id?: number }>(media: T[]): (T | null)[] {
  const slots: (T | null)[] = [null, null];
  const videos = media.filter(item => item.type === "video").sort((a,b) => a.position - b.position || (a.id ?? 0) - (b.id ?? 0));
  for (const item of videos) {
    if ((item.position === 1 || item.position === 2) && !slots[item.position - 1]) slots[item.position - 1] = item;
  }
  for (const item of videos) {
    if (slots.includes(item)) continue;
    const free = slots.indexOf(null);
    if (free < 0) break;
    slots[free] = item;
  }
  return slots;
}
