'use client'

import { useEffect } from 'react'
import { addItem, renameItem, type DeviceItem } from '@/lib/device-lists'

/** Adds a profile the reader opened to "Recently viewed" on this device. Renders nothing. */
export function RecordView({ item }: { item: Omit<DeviceItem, 'at'> }) {
  const { destinationIso2, slug, name } = item
  useEffect(() => {
    addItem('recent', { destinationIso2, slug, name })
    renameItem('saved', { destinationIso2, slug }, name)
  }, [destinationIso2, slug, name])
  return null
}
