const DEG = Math.PI / 180

/**
 * Converts latitude/longitude to a point on a sphere using the same
 * equirectangular mapping as three.js SphereGeometry UVs.
 */
export function latLngToVector(lat: number, lng: number, radius = 1): [number, number, number] {
  const phi = (90 - lat) * DEG
  const theta = (lng + 180) * DEG
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

export const MAX_TILT = 0.6

/** Euler (XYZ) rotation that brings lat/lng to face a camera on the +Z axis. */
export function focusRotation(lat: number, lng: number): { x: number; y: number } {
  const [x, , z] = latLngToVector(lat, lng)
  const y = Math.atan2(-x, z)
  const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, lat * DEG))
  return { x: tilt, y }
}

/** Shortest signed angular distance from `from` to `to`, in radians. */
export function shortestAngle(from: number, to: number): number {
  const diff = (to - from) % (Math.PI * 2)
  if (diff > Math.PI) return diff - Math.PI * 2
  if (diff < -Math.PI) return diff + Math.PI * 2
  return diff
}

/** CSS background-position-x for the static equirectangular fallback centred on `lng`. */
export function fallbackBackgroundX(lng: number): string {
  return `${(((lng + 180) / 180 - 0.5) * 100).toFixed(2)}%`
}
