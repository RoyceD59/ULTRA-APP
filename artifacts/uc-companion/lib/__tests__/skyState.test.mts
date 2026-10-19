import assert from 'node:assert/strict';
import test from 'node:test';
import {
  solarPosition, weatherFromCode, parseOpenMeteo, scenePalette, coarse, openMeteoUrl,
  CLEAR_WEATHER, DEFAULT_SKY_PLACE, weatherLabel,
} from '../skyState';

const { lat, lon } = DEFAULT_SKY_PLACE;
// Nairobi is UTC+3; solar noon there is about 09:35 UTC.
const nairobi = (isoLocal: string) => new Date(isoLocal + '+03:00');

test('sun is high at Nairobi midday near the equinox and below the horizon at midnight', () => {
  const noon = solarPosition(nairobi('2026-03-20T12:30:00'), lat, lon);
  assert.ok(noon.elevation > 80, `noon ${noon.elevation}`);
  const midnight = solarPosition(nairobi('2026-03-21T00:30:00'), lat, lon);
  assert.ok(midnight.elevation < -60, `midnight ${midnight.elevation}`);
});

test('morning sun is in the east, evening sun in the west, with golden hour near sunset', () => {
  const morning = solarPosition(nairobi('2026-10-02T07:30:00'), lat, lon);
  const evening = solarPosition(nairobi('2026-10-02T18:15:00'), lat, lon);
  assert.ok(morning.hourAngle < 0 && morning.elevation > 0 && morning.elevation < 20);
  assert.ok(evening.hourAngle > 0 && evening.elevation > -6 && evening.elevation < 8, `evening ${evening.elevation}`);
});

test('the sky depends on the viewer location, not just the clock', () => {
  const t = new Date('2026-06-21T12:00:00Z');
  const london = solarPosition(t, 51.5, -0.12), tokyo = solarPosition(t, 35.7, 139.7);
  assert.ok(london.elevation > 55);
  assert.ok(tokyo.elevation < 0);
});

test('WMO codes map to weather kinds with sensible cloud floors', () => {
  assert.equal(weatherFromCode(0).kind, 'clear');
  assert.equal(weatherFromCode(2).kind, 'partly');
  assert.equal(weatherFromCode(3, 10).cloudCover, 0.85);
  assert.equal(weatherFromCode(45).kind, 'fog');
  assert.equal(weatherFromCode(53).kind, 'drizzle');
  assert.equal(weatherFromCode(63).kind, 'rain');
  assert.equal(weatherFromCode(81).kind, 'rain');
  assert.equal(weatherFromCode(95).kind, 'storm');
});

test('Open-Meteo responses parse, and malformed ones are rejected', () => {
  const w = parseOpenMeteo({ current: { weather_code: 61, cloud_cover: 92, wind_speed_10m: 21.5, temperature_2m: 17.6 } });
  assert.deepEqual(w, { kind: 'rain', cloudCover: 0.92, windKmh: 21.5, temperatureC: 17.6 });
  assert.equal(parseOpenMeteo({}), null);
  assert.equal(parseOpenMeteo(null), null);
  assert.equal(weatherLabel(w!), 'Rain · 18°C');
});

test('location is coarsened to ~11 km before leaving the device', () => {
  assert.equal(coarse(-1.28638), -1.3);
  assert.match(openMeteoUrl(-1.28638, 36.81722), /latitude=-1\.3&longitude=36\.8&/);
});

test('palettes follow the sun and the weather', () => {
  const day = scenePalette(50, 0, CLEAR_WEATHER);
  const night = scenePalette(-30, 120, CLEAR_WEATHER);
  const rain = scenePalette(50, 0, weatherFromCode(63, 95));
  assert.equal(day.phase, 'day');
  assert.equal(night.phase, 'night');
  assert.equal(night.disc?.moon, true);
  assert.equal(day.disc?.moon, false);
  assert.equal(rain.disc, null, 'sun hidden behind rain clouds');
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lum(day.sky[0]) > lum(night.sky[0]));
  assert.ok(lum(rain.sky[1]) < lum(day.sky[1]), 'rain darkens the sky');
  assert.ok(rain.shadowOpacity < day.shadowOpacity, 'clouds soften shadows');
  assert.ok(scenePalette(-5, -100, CLEAR_WEATHER).disc === null || scenePalette(-5, -100, CLEAR_WEATHER).phase === 'twilight');
});
