'use client'

import React, { useState } from 'react'

import type { Message } from '@/lib/messages'
import { MessageBox } from '../../MessageBox'
import { Thread } from '../../Thread'

/** The conversation on one of the student's requests, with a box to answer. */
export function StudentThread({ requestId, messages: initial, supervisor, student, canWrite, detailsAsked }: {
  requestId: number; messages: Message[]; supervisor: string; student: string; canWrite: boolean; detailsAsked: boolean
}) {
  const [messages, setMessages] = useState(initial)
  const waitingForMe = detailsAsked && messages[messages.length - 1]?.from !== 'student'
  return (
    <>
      <Thread messages={messages} viewer="student" names={{ student, supervisor }} />
      {waitingForMe && (
        <p className="hint warn-text">
          {messages.some((m) => m.from === 'student') ? `${supervisor} is waiting for your answer.` : `${supervisor} asked for more details. Answer below.`}
        </p>
      )}
      {canWrite && (
        <MessageBox url="/student/reply" requestId={requestId} to={supervisor} startOpen={waitingForMe}
          label={messages.length ? `Reply to ${supervisor}` : `Write to ${supervisor}`}
          onSent={(m) => setMessages((xs) => [...xs, { from: 'student', subject: '', ...m }])} />
      )}
    </>
  )
}
