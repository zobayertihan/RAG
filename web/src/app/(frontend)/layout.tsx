import { after } from 'next/server'
import React from 'react'

import { APP_NAME, APP_TAGLINE } from '@/lib/brand'
import { wakePython } from '@/lib/python'
import './styles.css'

export const metadata = {
  description: APP_TAGLINE,
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Free hosts put the Python service to sleep. Opening any page (the login page first)
  // starts waking it, so it is usually up by the time someone searches.
  after(wakePython)
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
