import { describe, expect, it } from 'vitest'
import { DESTINATIONS } from '@/lib/destinations'
import { focusRotation, latLngToVector, shortestAngle } from '@/lib/geo'

describe('DESTINATIONS', () => {
  it('contains exactly the 11 agreed countries', () => {
    expect(DESTINATIONS.map((d) => d.iso2).sort()).toEqual(
      ['AE', 'AU', 'CA', 'DE', 'FI', 'GB', 'IT', 'NZ', 'PL', 'SA', 'US'].sort(),
    )
  })

  it('does not count Dubai as a separate country', () => {
    expect(DESTINATIONS.some((d) => d.name.toLowerCase().includes('dubai'))).toBe(false)
    const uae = DESTINATIONS.find((d) => d.iso2 === 'AE')
    expect(uae?.subRegions?.map((s) => s.name)).toContain('Dubai')
  })

  it('has unique ISO codes and valid coordinates', () => {
    expect(new Set(DESTINATIONS.map((d) => d.iso3)).size).toBe(DESTINATIONS.length)
    for (const d of DESTINATIONS) {
      expect(Math.abs(d.marker.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(d.marker.lng)).toBeLessThanOrEqual(180)
    }
  })
})

describe('geo', () => {
  it('rotates each marker to face the camera (+Z)', () => {
    for (const d of DESTINATIONS) {
      const [x, y, z] = latLngToVector(d.marker.lat, d.marker.lng)
      const r = focusRotation(d.marker.lat, d.marker.lng)
      // Apply Ry then Rx (three.js Euler XYZ order).
      const x1 = x * Math.cos(r.y) + z * Math.sin(r.y)
      const z1 = -x * Math.sin(r.y) + z * Math.cos(r.y)
      const z2 = y * Math.sin(r.x) + z1 * Math.cos(r.x)
      expect(Math.abs(x1)).toBeLessThan(1e-9)
      expect(z2).toBeGreaterThan(0.75)
    }
  })

  it('computes the shortest rotation direction', () => {
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6)
    expect(shortestAngle(0, 1)).toBeCloseTo(1)
  })
})
