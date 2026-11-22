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
