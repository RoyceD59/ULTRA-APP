/** Move whole photo records, never only their URLs or captions. */
export function moveRecordPhoto<T extends { slot: number }>(images: T[], slot: number, direction: number): T[] {
  const target = slot + direction;
  if (target < 1 || target > 6 || !images.some(photo => photo.slot === slot)) return images;
  return images.map(photo => photo.slot === slot ? { ...photo, slot: target }
    : photo.slot === target ? { ...photo, slot } : photo).sort((a, b) => a.slot - b.slot);
}
