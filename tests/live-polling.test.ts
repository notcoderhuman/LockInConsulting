// The polling helpers both live views share (lib/support/live.ts).
import { describe, expect, it } from 'vitest'
import { lastId, MAX_BACKOFF_MS, mergeNew, nextDelay, POLL_MS } from '@/lib/support/live'

const m = (id: number, body = `m${id}`) => ({ id, body })

describe('mergeNew', () => {
  it('appends only unseen messages, in id order, and returns the same array when nothing is new', () => {
    const shown = [m(1), m(2)]
    expect(mergeNew(shown, [])).toBe(shown)
    expect(mergeNew(shown, [m(2), m(1)])).toBe(shown) // a poll returning what is already on screen changes nothing
    expect(mergeNew(shown, [m(3), m(4)]).map((x) => x.id)).toEqual([1, 2, 3, 4])
    expect(mergeNew(shown, [m(4), m(3), m(2)]).map((x) => x.id)).toEqual([1, 2, 3, 4]) // out of order, one duplicate
  })

  it('never shows a message twice when rapid polls overlap', () => {
    let shown: { id: number }[] = [m(10)]
    for (const batch of [[m(11), m(12)], [m(12), m(13)], [m(11), m(12), m(13)], [m(14)]]) shown = mergeNew(shown, batch)
    expect(shown.map((x) => x.id)).toEqual([10, 11, 12, 13, 14])
  })

  it('finds the polling cursor', () => {
    expect(lastId([])).toBe(0)
    expect(lastId([m(5), m(9), m(7)])).toBe(9)
  })
})

describe('nextDelay', () => {
  it('beats every 3 seconds, doubles after each failure up to 30 s, and resets after a success', () => {
    expect(POLL_MS).toBe(3000)
    let delay = POLL_MS
    const seen: number[] = []
    for (let i = 0; i < 6; i++) seen.push((delay = nextDelay(delay, false)))
    expect(seen).toEqual([6000, 12000, 24000, MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS])
    expect(nextDelay(delay, true)).toBe(POLL_MS)
  })
})
