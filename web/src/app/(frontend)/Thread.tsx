import React from 'react'

import type { Message } from '@/lib/messages'

// fixed time zone, so the server and the browser show the same time
const when = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' })

/** The messages on one request, oldest first. The viewer's own messages say "You". */
export function Thread({ messages, viewer, names }: {
  messages: Message[]; viewer: 'student' | 'supervisor'; names: { student: string; supervisor: string }
}) {
  if (!messages.length) return null
  return (
    <div className="thread" aria-label="Messages">
      {messages.map((m) => (
        <div key={m.sentAt + m.from} className={`msg ${m.from === viewer ? 'mine' : 'from'}`}>
          <p className="sub">
            {m.from === viewer ? 'You' : names[m.from]} · {when(m.sentAt)}{m.subject ? ` · ${m.subject}` : ''}
          </p>
          <p className="msg-body">{m.message}</p>
        </div>
      ))}
    </div>
  )
}
