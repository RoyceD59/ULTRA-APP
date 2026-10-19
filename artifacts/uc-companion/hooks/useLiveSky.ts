/**
 * Live sky for the Impact Card tree scene: the real sun position for the
 * customer's place and time, plus current weather from Open-Meteo (free,
 * no key).
 *
 * Location is used only if the customer has ALREADY granted it (e.g. on the
 * map screen) — this hook never shows a permission prompt. Otherwise the sky
 * is Nairobi's, in the programme region. Coordinates are rounded to ~11 km
 * before they are sent for weather.
 */
import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import {
  CLEAR_WEATHER, DEFAULT_SKY_PLACE, coarse, openMeteoUrl, parseOpenMeteo, scenePalette,
  solarPosition, weatherLabel, type ScenePalette, type Weather,
} from '@/lib/skyState';

export interface LiveSky {
  palette: ScenePalette;
  weather: Weather;
  /** False until real weather has loaded (or if it failed): scene assumes clear. */
  weatherKnown: boolean;
  placeLabel: string;
  summary: string;
}

const CLOCK_TICK_MS = 5 * 60 * 1000;
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

export function useLiveSky(): LiveSky {
  const [place, setPlace] = useState<{ lat: number; lon: number; label: string; timeZone?: string }>(DEFAULT_SKY_PLACE);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await Location.getLastKnownPositionAsync({ maxAge: 6 * 60 * 60 * 1000 })
          ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
        if (!cancelled && pos) {
          setPlace({ lat: coarse(pos.coords.latitude), lon: coarse(pos.coords.longitude), label: 'your location' });
        }
      } catch { /* keep the default sky */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const weatherQ = useQuery({
    queryKey: ['live-sky-weather', place.lat, place.lon],
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let body: { timezone?: unknown };
      try {
        const res = await fetch(openMeteoUrl(place.lat, place.lon), { signal: controller.signal, credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        body = await res.json() as { timezone?: unknown };
      } finally { clearTimeout(timer); }
      const w = parseOpenMeteo(body);
      if (!w) throw new Error('Malformed weather response');
      return { weather: w, timeZone: typeof body.timezone === 'string' ? body.timezone : undefined };
    },
    staleTime: WEATHER_REFRESH_MS,
    refetchInterval: WEATHER_REFRESH_MS,
    retry: 1,
  });

  return useMemo(() => {
    const weather = weatherQ.data?.weather ?? CLEAR_WEATHER;
    const sun = solarPosition(new Date(now), place.lat, place.lon);
    const palette = scenePalette(sun.elevation, sun.hourAngle, weather);
    // Time at the place whose sky is drawn (Nairobi by default), not the phone's zone.
    const timeZone = weatherQ.data?.timeZone ?? place.timeZone;
    let time: string;
    try { time = new Date(now).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone }); }
    catch { time = new Date(now).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }); }
    const weatherText = weatherQ.data ? weatherLabel(weatherQ.data.weather) : 'weather unavailable';
    return {
      palette,
      weather,
      weatherKnown: !!weatherQ.data,
      placeLabel: place.label,
      summary: `Live sky over ${place.label} · ${time} · ${weatherText}`,
    };
  }, [now, place, weatherQ.data]);
}
