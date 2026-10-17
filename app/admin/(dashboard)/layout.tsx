import type { ReactNode } from 'react'
import { AdminShell } from '@/components/admin/admin-shell'
import { requireAdminPage } from '@/lib/admin/access'

// The layout gate is a convenience; every page below calls requireAdminPage itself because
// layouts are not re-run on every client navigation.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminPage()
  return <AdminShell actor={actor}>{children}</AdminShell>
}
