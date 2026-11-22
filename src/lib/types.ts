import type { Timestamp } from 'firebase/firestore'

export type TimeLike = Timestamp | Date | number | null | undefined

export type Status = 'online' | 'idle' | 'dnd' | 'invisible'
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

export interface UserProfile {
  id: string
  uid: string
  username: string
  displayName: string
  photoURL?: string
  bio?: string
  status?: Status
  dndUntil?: TimeLike
  state?: 'active' | 'away' | 'offline'
  lastActive?: TimeLike
  muted?: string[]
}

export interface LastMessage {
  id: string
  senderId: string
  text: string
  createdAt: TimeLike
  system?: boolean
  urgent?: boolean
}

export interface Chat {
  id: string
  type: 'dm' | 'group'
  name?: string
  photoURL?: string
  members: string[]
  createdBy?: string
  updatedAt?: TimeLike
  lastMessage?: LastMessage | null
  lastRead?: Record<string, TimeLike>
  typing?: Record<string, number>
}

export interface ReplyRef {
  id: string
  senderId: string
  text: string
}

export interface Message {
  id: string
  senderId: string
  createdAt: TimeLike
  text: string
  image?: string
  replyTo?: ReplyRef
  system?: boolean
  urgent?: boolean
  edited?: boolean
  deleted?: boolean
  reactions?: Record<string, string>
  /** iMessage-style send effect (bubble or screen). */
  effect?: string
  media?: Media
  /** Sticker image (Tenor URL or a custom sticker data URL). */
  sticker?: string
  /** Whisper transcript of a voice message. */
  transcript?: string
  pending?: boolean
}

export interface Rel {
  id: string
  from: string
  to: string
  participants: string[]
  status: 'pending' | 'accepted'
}

export type Route = { view: 'home' } | { view: 'friends' } | { view: 'chat'; id: string }

/** A file in Firebase Storage attached to a message. */
export interface Media {
  kind: 'image' | 'video' | 'audio'
  url: string
  path: string
  mime: string
  size: number
  w?: number
  h?: number
  /** seconds, for video and audio */
  dur?: number
  /** small blurred preview (data URL) shown while the file loads */
  thumb?: string
  /** audio waveform, 0–1 peaks */
  peaks?: number[]
  /** Whisper transcript, for voice messages */
  transcript?: string
}
