import { idOf, requireRole } from '@/lib/session'
import { ProfileForm } from './ProfileForm'

export default async function ProfilePage() {
  const { payload, user } = await requireRole('supervisor')
  const id = idOf(user.supervisor)
  if (!id) return <div className="page"><h1>My profile</h1><p className="error">This login isn&apos;t linked to a supervisor record yet.</p></div>
  const sup = await payload.findByID({ collection: 'supervisors', id, depth: 0, overrideAccess: false, user })
  return (
    <div className="page">
      <h1>My profile</h1>
      <p className="muted">
        Students find you through these research areas. Changes are used by the search right away.
        Last updated {new Date(sup.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
      </p>
      <ProfileForm
        id={sup.id}
        name={sup.name}
        position={sup.position}
        interests={(sup.interests || []).map((i) => i.value)}
        requirements={(sup.requirements || []).map((i) => i.value)}
        room={sup.room || ''}
        capacity={typeof sup.capacity === 'number' ? sup.capacity : null}
        slotsUsed={sup.slotsUsed ?? 0}
      />
    </div>
  )
}
