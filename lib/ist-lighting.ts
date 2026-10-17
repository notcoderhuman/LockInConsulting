export type LightingPhase = 'night' | 'dawn' | 'day' | 'afternoon' | 'sunset' | 'dusk'

type RGB = readonly [number, number, number]

export interface LightingState {
  phase: LightingPhase
  /** Key light colour (sun by day, moon at night), linear 0..1 */
  lightColor: RGB
  lightIntensity: number
  ambient: number
  /** 0..1 strength of city lights on the dark side */
  nightLights: number
  atmosphere: RGB
  /** Light elevation above the globe's equatorial plane, radians */
  elevation: number
}

interface Keyframe extends LightingState {
  minute: number
}

const NIGHT: LightingState = {
  phase: 'night',
  lightColor: [0.62, 0.68, 0.86],
  lightIntensity: 0.42,
  ambient: 0.09,
  nightLights: 1,
  atmosphere: [0.36, 0.46, 0.72],
  elevation: 0.35,
}

const DAY: LightingState = {
  phase: 'day',
  lightColor: [1, 0.95, 0.86],
  lightIntensity: 0.95,
  ambient: 0.08,
  nightLights: 0.15,
  atmosphere: [0.55, 0.72, 1],
  elevation: 0.42,
}

const AFTERNOON: LightingState = {
  phase: 'afternoon',
  lightColor: [1, 0.86, 0.66],
  lightIntensity: 0.82,
  ambient: 0.08,
  nightLights: 0.2,
  atmosphere: [0.95, 0.78, 0.56],
  elevation: 0.24,
}

/**
 * Keyframes in IST minutes-of-day. Values interpolate smoothly between frames,
 * so lighting never jumps. Afternoon is deliberately soft (rising-sun warmth),
 * never harsh; sunset is subdued gold; night is moonlit with city lights.
 */
const KEYFRAMES: readonly Keyframe[] = [
  { minute: 0, ...NIGHT },
  { minute: 330, ...NIGHT },
  {
    minute: 390,
    phase: 'dawn',
    lightColor: [1, 0.78, 0.54],
    lightIntensity: 0.7,
    ambient: 0.07,
    nightLights: 0.55,
    atmosphere: [0.95, 0.7, 0.46],
    elevation: 0.12,
  },
  { minute: 510, ...DAY },
  { minute: 780, ...DAY },
  { minute: 900, ...AFTERNOON },
  { minute: 1050, ...AFTERNOON },
  {
    minute: 1110,
    phase: 'sunset',
    lightColor: [0.98, 0.68, 0.38],
    lightIntensity: 0.68,
    ambient: 0.06,
    nightLights: 0.5,
    atmosphere: [0.92, 0.6, 0.32],
    elevation: 0.06,
  },
  {
    minute: 1170,
    phase: 'dusk',
    lightColor: [0.76, 0.62, 0.64],
    lightIntensity: 0.46,
    ambient: 0.05,
    nightLights: 0.8,
    atmosphere: [0.56, 0.46, 0.6],
    elevation: 0.2,
  },
  { minute: 1260, ...NIGHT },
  { minute: 1440, ...NIGHT },
]

const istFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Minutes since midnight in India Standard Time, independent of the visitor's own time zone. */
export function getIstMinutes(date: Date): number {
  const parts = istFormatter.formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (get('hour') % 24) * 60 + get('minute') + get('second') / 60
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]
const smooth = (t: number) => t * t * (3 - 2 * t)

export function getLightingForMinutes(minutes: number): LightingState {
  const m = ((minutes % 1440) + 1440) % 1440
  let i = 0
  while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].minute <= m) i++
  const a = KEYFRAMES[i]
  const b = KEYFRAMES[i + 1]
  const t = smooth((m - a.minute) / (b.minute - a.minute))
  return {
    phase: a.phase,
    lightColor: lerpRgb(a.lightColor, b.lightColor, t),
    lightIntensity: lerp(a.lightIntensity, b.lightIntensity, t),
    ambient: lerp(a.ambient, b.ambient, t),
    nightLights: lerp(a.nightLights, b.nightLights, t),
    atmosphere: lerpRgb(a.atmosphere, b.atmosphere, t),
    elevation: lerp(a.elevation, b.elevation, t),
  }
}

export function getIstLighting(date: Date = new Date()): LightingState {
  return getLightingForMinutes(getIstMinutes(date))
}

/**
 * Returns "now", or a fixed IST time when the page URL has `?ist=HH:MM`.
 * Lets reviewers check every lighting phase without changing their clock.
 */
export function previewDate(): Date {
  if (typeof window === 'undefined') return new Date()
  const match = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(window.location.search).get('ist') ?? '')
  if (!match) return new Date()
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return new Date()
  const utcMinutes = (hours * 60 + minutes - 330 + 1440) % 1440
  const d = new Date()
  d.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0)
  return d
}

export const PHASE_LABEL: Record<LightingPhase, string> = {
  night: 'Night',
  dawn: 'Sunrise',
  day: 'Daylight',
  afternoon: 'Afternoon',
  sunset: 'Sunset',
  dusk: 'Dusk',
}

const istClockFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export function formatIstClock(date: Date): string {
  return istClockFormatter.format(date)
}
