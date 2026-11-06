import { APP_MARK, APP_NAME } from '@/lib/brand'

/** Small mark in the admin header. */
export function Icon() {
  return <span className="sf-mark" aria-label={APP_NAME}>{APP_MARK}</span>
}
