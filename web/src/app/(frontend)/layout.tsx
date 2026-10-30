import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Supervisor Finder for BTECH students, supervisors and admins.',
  title: 'Supervisor Finder',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
