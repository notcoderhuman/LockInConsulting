import { redirect } from 'next/navigation'

// The old destination explorer is retired: one directory at /universities.
export default function DestinationsPage() {
  redirect('/universities')
}
