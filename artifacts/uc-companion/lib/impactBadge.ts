function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

export function buildImpactShareMessage(totalLitres: number, starLevel: number, referralCode: string | null): string {
  const invitation = referralCode
    ? `Join Ultra-Clear Companion and use my referral code ${referralCode}.`
    : 'Join me on Ultra-Clear Companion for cleaner-water living.';
  return `My Ultra-Clear Impact Badge: ${totalLitres.toLocaleString()} L refilled, Level ${starLevel}. ${invitation} ucfilters.com/app`;
}

export function buildImpactBadgeSvg(totalLitres: number, starLevel: number, referralCode: string | null): string {
  const litres = escapeXml(totalLitres.toLocaleString());
  const level = escapeXml(String(starLevel));
  const code = referralCode ? escapeXml(referralCode) : 'JOIN ULTRA-CLEAR';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#005d8f"/>
  <circle cx="1035" cy="115" r="210" fill="#52b6dc" opacity=".45"/>
  <circle cx="1100" cy="570" r="260" fill="#52b6dc" opacity=".18"/>
  <path d="M155 128C105 204 73 249 73 301c0 66 49 116 110 116s110-50 110-116c0-52-32-97-82-173-16-24-40-24-56 0z" fill="#52b6dc"/>
  <path d="M127 306c8 35 30 55 65 61" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
  <text x="360" y="142" fill="#52b6dc" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="5">MY ULTRA-CLEAR</text>
  <text x="360" y="202" fill="#fff" font-family="Arial, sans-serif" font-size="58" font-weight="800">IMPACT BADGE</text>
  <text x="78" y="500" fill="#fff" font-family="Arial, sans-serif" font-size="76" font-weight="800">${litres} L</text>
  <text x="80" y="548" fill="#52b6dc" font-family="Arial, sans-serif" font-size="28" font-weight="700">WATER REFILLED</text>
  <text x="515" y="500" fill="#fff" font-family="Arial, sans-serif" font-size="76" font-weight="800">LEVEL ${level}</text>
  <text x="518" y="548" fill="#52b6dc" font-family="Arial, sans-serif" font-size="28" font-weight="700">GREEN-LIVING IMPACT</text>
  <rect x="360" y="250" width="690" height="108" rx="18" fill="#fff"/>
  <text x="395" y="292" fill="#005d8f" font-family="Arial, sans-serif" font-size="22" font-weight="700">JOIN ULTRA-CLEAR COMPANION</text>
  <text x="395" y="332" fill="#1a1a1a" font-family="Arial, sans-serif" font-size="30" font-weight="800">INVITE CODE: ${code}</text>
  <text x="80" y="604" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="700">ULTRA CLEAR</text>
  <text x="1038" y="604" text-anchor="end" fill="#fff" font-family="Arial, sans-serif" font-size="20">ucfilters.com/app</text>
</svg>`;
}