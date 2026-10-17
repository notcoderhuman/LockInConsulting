export type DestinationRegion =
  | 'North America'
  | 'Europe'
  | 'Oceania'
  | 'Middle East'

export interface SubRegion {
  name: string
  kind: 'city' | 'emirate'
  lat: number
  lng: number
}

export interface Destination {
  /** ISO 3166-1 alpha-2 */
  iso2: string
  /** ISO 3166-1 alpha-3 */
  iso3: string
  /** URL segment for /destinations/[slug]. Also seeded into the `destinations` table. */
  slug: string
  /** ISO 4217 national currency. Fees may still be quoted in another currency. */
  currency: string
  name: string
  shortName: string
  region: DestinationRegion
  /** Globe marker is placed on the capital city — a fixed, verifiable point rather than a polygon. */
  marker: { label: string; lat: number; lng: number }
  subRegions?: SubRegion[]
  note?: string
}

export const DESTINATIONS: readonly Destination[] = [
  {
    iso2: 'US',
    iso3: 'USA',
    slug: 'usa',
    currency: 'USD',
    name: 'United States of America',
    shortName: 'USA',
    region: 'North America',
    marker: { label: 'Washington, D.C.', lat: 38.9072, lng: -77.0369 },
  },
  {
    iso2: 'GB',
    iso3: 'GBR',
    slug: 'uk',
    currency: 'GBP',
    name: 'United Kingdom',
    shortName: 'UK',
    region: 'Europe',
    marker: { label: 'London', lat: 51.5074, lng: -0.1278 },
  },
  {
    iso2: 'CA',
    iso3: 'CAN',
    slug: 'canada',
    currency: 'CAD',
    name: 'Canada',
    shortName: 'Canada',
    region: 'North America',
    marker: { label: 'Ottawa', lat: 45.4215, lng: -75.6972 },
  },
  {
    iso2: 'IT',
    iso3: 'ITA',
    slug: 'italy',
    currency: 'EUR',
    name: 'Italy',
    shortName: 'Italy',
    region: 'Europe',
    marker: { label: 'Rome', lat: 41.9028, lng: 12.4964 },
  },
  {
    iso2: 'DE',
    iso3: 'DEU',
    slug: 'germany',
    currency: 'EUR',
    name: 'Germany',
    shortName: 'Germany',
    region: 'Europe',
    marker: { label: 'Berlin', lat: 52.52, lng: 13.405 },
  },
  {
    iso2: 'AU',
    iso3: 'AUS',
    slug: 'australia',
    currency: 'AUD',
    name: 'Australia',
    shortName: 'Australia',
    region: 'Oceania',
    marker: { label: 'Canberra', lat: -35.2809, lng: 149.13 },
  },
  {
    iso2: 'NZ',
    iso3: 'NZL',
    slug: 'new-zealand',
    currency: 'NZD',
    name: 'New Zealand',
    shortName: 'New Zealand',
    region: 'Oceania',
    marker: { label: 'Wellington', lat: -41.2865, lng: 174.7762 },
  },
  {
    iso2: 'SA',
    iso3: 'SAU',
    slug: 'saudi-arabia',
    currency: 'SAR',
    name: 'Saudi Arabia',
    shortName: 'Saudi Arabia',
    region: 'Middle East',
    marker: { label: 'Riyadh', lat: 24.7136, lng: 46.6753 },
  },
  {
    iso2: 'AE',
    iso3: 'ARE',
    slug: 'uae',
    currency: 'AED',
    name: 'United Arab Emirates',
    shortName: 'UAE',
    region: 'Middle East',
    marker: { label: 'Abu Dhabi', lat: 24.4539, lng: 54.3773 },
    subRegions: [{ name: 'Dubai', kind: 'emirate', lat: 25.2048, lng: 55.2708 }],
    note: 'Dubai is an emirate within the UAE, so it sits under this destination.',
  },
  {
    iso2: 'FI',
    iso3: 'FIN',
    slug: 'finland',
    currency: 'EUR',
    name: 'Finland',
    shortName: 'Finland',
    region: 'Europe',
    marker: { label: 'Helsinki', lat: 60.1699, lng: 24.9384 },
  },
  {
    iso2: 'PL',
    iso3: 'POL',
    slug: 'poland',
    currency: 'PLN',
    name: 'Poland',
    shortName: 'Poland',
    region: 'Europe',
    marker: { label: 'Warsaw', lat: 52.2297, lng: 21.0122 },
  },
] as const

export function getDestination(iso2: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.iso2 === iso2)
}

export function getDestinationBySlug(slug: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.slug === slug)
}

export function destinationHref(destination: Pick<Destination, 'slug'>): string {
  return `/destinations/${destination.slug}`
}

/** Previous and next destinations in list order, wrapping around. */
export function getAdjacentDestinations(iso2: string): { previous: Destination; next: Destination } {
  const index = DESTINATIONS.findIndex((d) => d.iso2 === iso2)
  if (index === -1) throw new Error(`Unknown destination ${iso2}`)
  const count = DESTINATIONS.length
  return {
    previous: DESTINATIONS[(index - 1 + count) % count],
    next: DESTINATIONS[(index + 1) % count],
  }
}
