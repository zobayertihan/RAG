import { notFound } from 'next/navigation'

// Any address that matches no page shows the app's own not-found page.
export default function Missing() {
  notFound()
}
