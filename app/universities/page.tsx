import { redirect } from 'next/navigation'

// The directory lives on each destination page (/destinations/<country>); there is no all-countries listing.
export default function UniversitiesPage() {
  redirect('/destinations')
}
