import type { Connection } from 'mysql2/promise'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepAlive } from './db/heartbeat'

function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeConnection() {
  const query = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [[]])
  const ping = vi.fn<() => Promise<void>>(async () => {})
  const end = vi.fn<() => Promise<void>>(async () => {})
  const conn = keepAlive({ query, ping, end } as unknown as Connection, 10_000)
  return { conn, query, ping, end }
}

describe('keepAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('pings every 10 seconds while the connection is idle, and returns query results untouched', async () => {
    const { conn, query, ping } = fakeConnection()
    query.mockResolvedValueOnce([[{ a: 1 }], []])
    expect(await conn.query('SELECT 1')).toEqual([[{ a: 1 }], []])
    expect(ping).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ping).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(ping).toHaveBeenCalledTimes(3)
    await conn.end()
  })

  it('never pings during an active query', async () => {
    const { conn, query, ping } = fakeConnection()
    const slow = deferred()
    query.mockReturnValueOnce(slow.promise)
    const running = conn.query('SELECT SLEEP(30)')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ping).not.toHaveBeenCalled()
    slow.resolve([[]])
    await running
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ping).toHaveBeenCalledTimes(1)
    await conn.end()
  })

  it('makes a query wait for a ping in flight', async () => {
    const { conn, query, ping } = fakeConnection()
    const pinging = deferred<void>()
    ping.mockReturnValueOnce(pinging.promise)
    await vi.advanceTimersByTimeAsync(10_000)
    const waiting = conn.query('SELECT 1')
    await vi.advanceTimersByTimeAsync(0)
    expect(query).not.toHaveBeenCalled()
    pinging.resolve()
    await waiting
    expect(query).toHaveBeenCalledTimes(1)
    await conn.end()
  })

  it('does not hide a failed ping: it stops, logs, and the next query rejects without retrying', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { conn, query, ping } = fakeConnection()
    ping.mockRejectedValueOnce(new Error('Connection lost'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Connection lost'))
    await expect(conn.query('SELECT 1')).rejects.toThrow('Shared test connection lost: Connection lost')
    expect(query).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ping).toHaveBeenCalledTimes(1)
    await conn.end()
  })

  it('does not hide a failed query', async () => {
    const { conn, query } = fakeConnection()
    query.mockRejectedValueOnce(new Error('Duplicate entry'))
    await expect(conn.query('INSERT')).rejects.toThrow('Duplicate entry')
    expect(query).toHaveBeenCalledTimes(1)
    await conn.end()
  })

  it('stops on teardown, waiting for a ping in flight before closing', async () => {
    const { conn, ping, end } = fakeConnection()
    const pinging = deferred<void>()
    ping.mockReturnValueOnce(pinging.promise)
    await vi.advanceTimersByTimeAsync(10_000)
    const closing = conn.end()
    await vi.advanceTimersByTimeAsync(0)
    expect(end).not.toHaveBeenCalled()
    pinging.resolve()
    await closing
    expect(end).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ping).toHaveBeenCalledTimes(1)
  })
})
