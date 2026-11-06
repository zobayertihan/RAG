/**
 * Switches for parts of the app.
 *
 * Travel and expense assistant (Phase 8). Exactly one of the two lines below is active:
 *   hidden: the first line is active (as now)
 *   shown:  comment out the first line and uncomment the second
 * Hidden for now because the search service needs about 770 MB with the finance model
 * loaded, and the free Render plan has 512 MB.
 */
const FINANCE_ENABLED = false
// const FINANCE_ENABLED = true

export const financeEnabled = () => FINANCE_ENABLED
