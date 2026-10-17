import { describe, expect, it } from 'vitest'
import { getIstLighting, getIstMinutes, getLightingForMinutes } from '@/lib/ist-lighting'

describe('getIstMinutes', () => {
  it('converts UTC to IST (+05:30) regardless of host time zone', () => {
    expect(getIstMinutes(new Date('2026-10-15T00:00:00Z'))).toBe(330)
    expect(getIstMinutes(new Date('2026-10-15T18:30:00Z'))).toBe(0)
    expect(getIstMinutes(new Date('2026-10-15T12:45:30Z'))).toBeCloseTo(18 * 60 + 15.5)
  })
})

describe('getLightingForMinutes', () => {
  const at = (h: number, m = 0) => getLightingForMinutes(h * 60 + m)

  it('maps key times to the expected phases', () => {
    expect(at(2).phase).toBe('night')
    expect(at(6, 30).phase).toBe('dawn')
    expect(at(11).phase).toBe('day')
    expect(at(15, 30).phase).toBe('afternoon')
    expect(at(18, 45).phase).toBe('sunset')
    expect(at(19, 45).phase).toBe('dusk')
    expect(at(22).phase).toBe('night')
  })

  it('keeps afternoon softer than midday', () => {
    expect(at(15, 30).lightIntensity).toBeLessThan(at(12).lightIntensity)
  })

  it('never exceeds a gentle intensity ceiling', () => {
    for (let m = 0; m < 1440; m += 5) {
      expect(getLightingForMinutes(m).lightIntensity).toBeLessThanOrEqual(1)
    }
  })

  it('changes smoothly — no jump larger than 0.05 per minute', () => {
    for (let m = 0; m < 1440; m++) {
      const a = getLightingForMinutes(m)
      const b = getLightingForMinutes(m + 1)
      expect(Math.abs(a.lightIntensity - b.lightIntensity)).toBeLessThan(0.05)
      expect(Math.abs(a.nightLights - b.nightLights)).toBeLessThan(0.05)
    }
  })

  it('wraps around midnight continuously', () => {
    const before = getLightingForMinutes(1439.9)
    const after = getLightingForMinutes(0)
    expect(before.lightIntensity).toBeCloseTo(after.lightIntensity, 3)
  })

  it('uses IST for a visitor whose clock is in another zone', () => {
    // 13:30 UTC is 19:00 IST (sunset → dusk window) even though it's 09:30 in New York.
    const state = getIstLighting(new Date('2026-10-15T13:30:00Z'))
    expect(['sunset', 'dusk']).toContain(state.phase)
  })
})
