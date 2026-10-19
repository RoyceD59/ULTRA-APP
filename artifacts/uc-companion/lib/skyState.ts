/**
 * Live sky for the Hydrate the Future tree scenes: real sun position for a
 * time and place, plus current weather, turned into a scene palette and
 * effects (clouds, rain, fog, storm, wind).
 *
 * The forest page (forest/forest.html) carries a plain-JS copy of these
 * functions; keep the two in step.
 */

/** Default sky: Nairobi, in the programme region. */
export const DEFAULT_SKY_PLACE = { lat: -1.29, lon: 36.82, label: 'Nairobi', timeZone: 'Africa/Nairobi' } as const;

const rad = Math.PI / 180;

/**
 * Solar elevation and hour angle in degrees (NOAA general solar position
 * approximation, accurate to well under a degree — plenty for a sky).
 * hourAngle < 0 is morning (sun in the east), > 0 afternoon.
 */
export function solarPosition(date: Date, lat: number, lon: number): { elevation: number; hourAngle: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86_400_000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hours * 60 + eqTime + 4 * lon;
  let hourAngle = trueSolarMinutes / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  if (hourAngle > 180) hourAngle -= 360;
  const cosZenith = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle * rad);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
  return { elevation: 90 - zenith, hourAngle };
}

export type WeatherKind = 'clear' | 'partly' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'storm';

export interface Weather {
  kind: WeatherKind;
  /** 0–1 */
  cloudCover: number;
  windKmh: number;
  temperatureC: number | null;
}

export const CLEAR_WEATHER: Weather = { kind: 'clear', cloudCover: 0.1, windKmh: 8, temperatureC: null };

/** WMO weather interpretation codes, as used by Open-Meteo. */
export function weatherFromCode(code: number, cloudCoverPct = 0, windKmh = 8, temperatureC: number | null = null): Weather {
  let kind: WeatherKind;
  if (code >= 95) kind = 'storm';
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || (code >= 71 && code <= 77) || code === 85 || code === 86) kind = 'rain';
  else if (code >= 51 && code <= 57) kind = 'drizzle';
  else if (code === 45 || code === 48) kind = 'fog';
  else if (code === 3) kind = 'overcast';
  else if (code === 1 || code === 2) kind = 'partly';
  else kind = 'clear';
  const cover = Math.min(1, Math.max(0, cloudCoverPct / 100));
  const floor = { clear: 0, partly: 0.3, overcast: 0.85, fog: 0.7, drizzle: 0.75, rain: 0.9, storm: 1 }[kind];
  return { kind, cloudCover: Math.max(cover, floor), windKmh: Math.max(0, windKmh), temperatureC };
}

/** Parse an Open-Meteo `current=` response; null when it is malformed. */
export function parseOpenMeteo(json: unknown): Weather | null {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c || typeof c.weather_code !== 'number') return null;
  return weatherFromCode(
    c.weather_code,
    typeof c.cloud_cover === 'number' ? c.cloud_cover : 0,
    typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 8,
    typeof c.temperature_2m === 'number' ? c.temperature_2m : null,
  );
}

/** Round to ~11 km before a location leaves the device. */
export function coarse(n: number): number {
  return Math.round(n * 10) / 10;
}

export function openMeteoUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${coarse(lat)}&longitude=${coarse(lon)}`
    + '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m&timezone=auto';
}

// ── Palette ────────────────────────────────────────────────────────────────

export interface ScenePalette {
  sky: [string, string, string];
  sunGlow: string;
  sunCore: string;
  hills: [string, string, string];
  soil: [string, string, string];
  grass: string;
  bark: [string, string];
  leaf: [string, string, string, string];
  shadow: string;
  shadowOpacity: number;
  mound: string;
  seed: string;
  cloud: string;
  /** Sun or moon disc position in a 320×150 scene; null when hidden. */
  disc: { x: number; y: number; moon: boolean } | null;
  phase: 'night' | 'twilight' | 'golden' | 'day';
}

type Key = Exclude<keyof ScenePalette, 'disc' | 'phase' | 'shadowOpacity'>;
type Base = Record<Key, string | string[]>;

const PHASES: Record<'night' | 'twilight' | 'golden' | 'day', Base & { shadowOpacity: number }> = {
  night: {
    sky: ['#070f1c', '#132236', '#2a2e44'], sunGlow: '#bfcdf0', sunCore: '#e9eefc',
    hills: ['#2c3c50', '#243442', '#1d2c34'], soil: ['#45281c', '#341d14', '#25140d'],
    grass: '#36442a', bark: ['#140e0a', '#2a2018'], leaf: ['#06120b', '#0b1d14', '#14301f', '#27443a'],
    shadow: '#000000', mound: '#25140d', seed: '#4f341f', cloud: '#3a4458', shadowOpacity: 0.12,
  },
  twilight: {
    sky: ['#24345e', '#8a6d8c', '#f0a46a'], sunGlow: '#ffb27a', sunCore: '#ffd9b0',
    hills: ['#6c6f86', '#585f73', '#47525c'], soil: ['#8a4a30', '#6a3420', '#4a2414'],
    grass: '#6b7340', bark: ['#2e2016', '#5a3f2c'], leaf: ['#14301b', '#24472a', '#3f6a36', '#7a8f4c'],
    shadow: '#1a0c06', mound: '#43200f', seed: '#6a4528', cloud: '#c99a9a', shadowOpacity: 0.2,
  },
  golden: {
    sky: ['#6fa6c9', '#b9d6e0', '#f3dcb4'], sunGlow: '#ffe8b4', sunCore: '#fff6dc',
    hills: ['#b7c3bf', '#9aaea4', '#7f9888'], soil: ['#b5673f', '#8e4528', '#6a2f1a'],
    grass: '#8f9a50', bark: ['#3e2a1d', '#7a5640'], leaf: ['#183d22', '#2d5a31', '#4f8340', '#93b45a'],
    shadow: '#2a1408', mound: '#5b2b18', seed: '#7a5230', cloud: '#f4e6d2', shadowOpacity: 0.32,
  },
  day: {
    sky: ['#3f86c4', '#8fc1e2', '#d6e9ef'], sunGlow: '#fff6d8', sunCore: '#ffffff',
    hills: ['#a9bcc4', '#8ea7a3', '#748f80'], soil: ['#b86a42', '#934a2b', '#6d311b'],
    grass: '#96a352', bark: ['#3e2a1d', '#80604a'], leaf: ['#1a4224', '#2f6034', '#548a44', '#9cbd60'],
    shadow: '#2a1408', mound: '#5b2b18', seed: '#7a5230', cloud: '#ffffff', shadowOpacity: 0.3,
  },
};

const GREY = { day: '#a7afb4', night: '#30363e' };

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return '#' + [ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function blend(a: Base & { shadowOpacity: number }, b: Base & { shadowOpacity: number }, t: number) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number') out[k] = va * (1 - t) + (vb as number) * t;
    else if (Array.isArray(va)) out[k] = va.map((c, i) => mixHex(c, (vb as string[])[i]!, t));
    else out[k] = mixHex(va as string, vb as string, t);
  }
  return out as Base & { shadowOpacity: number };
}

/** Pick and blend phase palettes by sun elevation, then apply weather. */
export function scenePalette(elevation: number, hourAngle: number, weather: Weather): ScenePalette {
  let base: Base & { shadowOpacity: number };
  let phase: ScenePalette['phase'];
  if (elevation <= -8) { base = PHASES.night; phase = 'night'; }
  else if (elevation <= -1) { base = blend(PHASES.night, PHASES.twilight, (elevation + 8) / 7); phase = 'twilight'; }
  else if (elevation <= 8) { base = blend(PHASES.twilight, PHASES.golden, (elevation + 1) / 9); phase = 'golden'; }
  else if (elevation <= 25) { base = blend(PHASES.golden, PHASES.day, (elevation - 8) / 17); phase = 'day'; }
  else { base = PHASES.day; phase = 'day'; }

  // Clouds grey the sky and soften shadows; rain and storms darken everything.
  const grey = phase === 'night' ? GREY.night : GREY.day;
  const overcast = weather.kind === 'fog' ? 0.75 : Math.max(0, weather.cloudCover - 0.35) / 0.65;
  const dark = weather.kind === 'storm' ? 0.35 : weather.kind === 'rain' ? 0.2 : weather.kind === 'drizzle' ? 0.1 : 0;
  const sky = (base.sky as string[]).map(c => mixHex(mixHex(c, grey, overcast * 0.85), '#000000', dark)) as ScenePalette['sky'];
  const tone = (c: string) => mixHex(c, '#000000', dark * 0.8);
  const fogHaze = (c: string) => weather.kind === 'fog' ? mixHex(c, grey, 0.45) : c;

  // Disc: mornings rise on the left, afternoons set on the right.
  const sunUp = elevation > -1 && overcast < 0.9;
  const moonUp = elevation < -8 && overcast < 0.9;
  const x = 160 + Math.max(-1, Math.min(1, hourAngle / 90)) * 130;
  const disc = sunUp
    ? { x, y: 78 - Math.min(1, Math.max(0, elevation) / 60) * 62, moon: false }
    : moonUp ? { x: 160 - Math.max(-1, Math.min(1, hourAngle / 180)) * 110, y: 30, moon: true } : null;

  return {
    sky,
    sunGlow: base.sunGlow as string, sunCore: base.sunCore as string,
    hills: (base.hills as string[]).map(c => fogHaze(tone(c))) as ScenePalette['hills'],
    soil: (base.soil as string[]).map(tone) as ScenePalette['soil'],
    grass: tone(base.grass as string),
    bark: (base.bark as string[]).map(tone) as ScenePalette['bark'],
    leaf: (base.leaf as string[]).map(tone) as ScenePalette['leaf'],
    shadow: base.shadow as string,
    shadowOpacity: base.shadowOpacity * (1 - overcast * 0.75),
    mound: tone(base.mound as string), seed: base.seed as string,
    cloud: mixHex(base.cloud as string, grey, overcast * 0.6 + dark),
    disc, phase,
  };
}

/** Human summary, e.g. "Light rain · 18°C". */
export function weatherLabel(w: Weather): string {
  const names: Record<WeatherKind, string> = {
    clear: 'Clear', partly: 'Partly cloudy', overcast: 'Overcast', fog: 'Fog',
    drizzle: 'Drizzle', rain: 'Rain', storm: 'Thunderstorm',
  };
  return w.temperatureC === null ? names[w.kind] : `${names[w.kind]} · ${Math.round(w.temperatureC)}°C`;
}
