import { APP_MARK, APP_NAME } from '@/lib/brand'

/** Logo on the admin login page. */
export function Logo() {
  return (
    <div className="sf-logo">
      <span className="sf-mark" aria-hidden="true">{APP_MARK}</span>
      <span>{APP_NAME}</span>
    </div>
  )
}
