import { day, type ReqRow } from '@/lib/dashboard'

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'pill' },
  info_requested: { label: 'Details asked', cls: 'pill warn' },
  accepted: { label: 'Accepted', cls: 'pill good' },
  rejected: { label: 'Declined', cls: 'pill bad' },
}

export function RequestTable({ rows }: { rows: ReqRow[] }) {
  return (
    <div className="table-wrap">
      <table className="dt">
        <thead>
          <tr><th>Student</th><th>Supervisor</th><th>Type</th><th>Status</th><th>Sent</th><th className="num">Waiting</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, cls: 'pill' }
            const open = r.status === 'pending' || r.status === 'info_requested'
            return (
              <tr key={r.id} className={r.stuck ? 'stuck' : undefined}>
                <td><a href={`/admin/collections/requests/${r.id}`}>{r.student.name}</a>{r.synthetic && <span className="demo" title="Made up by the demo seed">demo</span>}
                  {r.student.programme && <div className="sub">{r.student.programme}</div>}</td>
                <td>{r.supervisor.name}</td>
                <td>{r.type === 'supervision' ? 'Supervision' : 'Discuss'}</td>
                <td><span className={st.cls}>{st.label}</span>{r.answeredAt && <div className="sub">answered {day(r.answeredAt)}</div>}</td>
                <td>{day(r.createdAt)}</td>
                <td className="num">{open ? `${r.waitingDays} d` : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
