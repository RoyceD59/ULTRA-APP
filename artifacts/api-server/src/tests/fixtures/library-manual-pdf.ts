/** Minimal real PDF with exact offsets, page text, and ignored private metadata/actions. */
export function makeManualPdf(pages: string[], passwordProtected = false): Buffer {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (throw new Error\\(embedded action\\)) >> >>`,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages.length; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const lines = pages[i].match(/.{1,100}/g) ?? [""];
    const text = lines.map(line => `(${line.replace(/[\\()]/g, "\\$&")}) Tj T*`).join("\n");
    const stream = `BT /F1 10 Tf 10 TL 50 750 Td ${text} ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Title (PRIVATE_METADATA) >>");
  const infoObject = objects.length;
  if (passwordProtected) {
    // A locked standard-security dictionary; no valid blank-password key.
    objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> >>`);
  }
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObject} 0 R ${passwordProtected ? `/Encrypt ${objects.length} 0 R /ID [<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}