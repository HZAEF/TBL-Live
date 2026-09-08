import type { Metadata } from 'next'
import { AdminApp } from '@/components/tbl/admin-app'

export const metadata: Metadata = {
  title: 'TBL Live — Espace administrateur',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  return <AdminApp />
}
