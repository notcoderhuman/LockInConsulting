'use client'

import { useSyncExternalStore } from 'react'

// Saved and recently viewed universities, kept ONLY in this browser's localStorage (owner decision,
// 2 Nov 2026): no account, no server copy. Each item holds public identity fields only. Anything
// unreadable (another version, hand-edited, corrupt) is dropped rather than trusted.

export type DeviceList = 'saved' | 'recent'
export interface DeviceItem {
  destinationIso2: string
  slug: string
  name: string
  /** When it was saved or last viewed (ms since epoch). */
  at: number
}

export const STORAGE_KEYS: Record<DeviceList, string> = { saved: 'lockin:saved-universities:v1', recent: 'lockin:recent-universities:v1' }
export const LIST_LIMIT: Record<DeviceList, number> = { saved: 50, recent: 10 }
const CHANGE = 'lockin:device-lists'

const isItem = (v: unknown): v is DeviceItem => {
  const o = v as DeviceItem
  return (
    !!o && typeof o === 'object' &&
    typeof o.destinationIso2 === 'string' && /^[A-Z]{2}$/.test(o.destinationIso2) &&
    typeof o.slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug) && o.slug.length <= 200 &&
    typeof o.name === 'string' && o.name.length > 0 && o.name.length <= 300 &&
    typeof o.at === 'number' && Number.isFinite(o.at)
  )
}

const sameItem = (a: Pick<DeviceItem, 'destinationIso2' | 'slug'>, b: Pick<DeviceItem, 'destinationIso2' | 'slug'>) =>
  a.destinationIso2 === b.destinationIso2 && a.slug === b.slug

function readRaw(list: DeviceList): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS[list])
  } catch {
    return null
  }
}

export function parseList(raw: string | null, list: DeviceList): DeviceItem[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter(isItem).slice(0, LIST_LIMIT[list]) : []
  } catch {
    return []
  }
}

export const readList = (list: DeviceList) => parseList(readRaw(list), list)

/** false when this browser blocks storage (private mode, disabled site data, quota). */
function writeList(list: DeviceList, items: DeviceItem[]): boolean {
  try {
    if (items.length) window.localStorage.setItem(STORAGE_KEYS[list], JSON.stringify(items.slice(0, LIST_LIMIT[list])))
    else window.localStorage.removeItem(STORAGE_KEYS[list])
    window.dispatchEvent(new Event(CHANGE))
    return true
  } catch {
    return false
  }
}

export function storageAvailable(): boolean {
  try {
    const probe = '__lockin_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/** Newest first; an item already in the list moves to the top. */
export function addItem(list: DeviceList, item: Omit<DeviceItem, 'at'>): boolean {
  return writeList(list, [{ ...item, at: Date.now() }, ...readList(list).filter((i) => !sameItem(i, item))])
}

export function removeItem(list: DeviceList, key: Pick<DeviceItem, 'destinationIso2' | 'slug'>): boolean {
  return writeList(list, readList(list).filter((i) => !sameItem(i, key)))
}

export const clearList = (list: DeviceList) => writeList(list, [])

/** Keeps a stored name in step with the directory (a university can be renamed). */
export function renameItem(list: DeviceList, key: Pick<DeviceItem, 'destinationIso2' | 'slug'>, name: string): void {
  const items = readList(list)
  if (items.some((i) => sameItem(i, key) && i.name !== name)) writeList(list, items.map((i) => (sameItem(i, key) ? { ...i, name } : i)))
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange) // other tabs
  window.addEventListener(CHANGE, onChange) // this tab
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE, onChange)
  }
}

// useSyncExternalStore needs the same array back while the stored string is unchanged.
const cache: Record<DeviceList, { raw: string | null; items: DeviceItem[] }> = { saved: { raw: null, items: [] }, recent: { raw: null, items: [] } }
const EMPTY: DeviceItem[] = []

/** The list, live across tabs. Empty during server rendering and before hydration. */
export function useDeviceList(list: DeviceList): DeviceItem[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      const raw = readRaw(list)
      if (raw !== cache[list].raw) cache[list] = { raw, items: parseList(raw, list) }
      return cache[list].items
    },
    () => EMPTY,
  )
}

export const isSaved = (items: DeviceItem[], key: Pick<DeviceItem, 'destinationIso2' | 'slug'>) => items.some((i) => sameItem(i, key))
