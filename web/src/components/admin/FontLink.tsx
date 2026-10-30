import React from 'react'

/**
 * Loads the app font on every admin page. React moves a <link precedence> into <head>,
 * which a CSS @import inside custom.scss can't do reliably in a production build.
 */
export function FontLink({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"
        precedence="default"
      />
      {children}
    </>
  )
}
