import { create } from 'zustand'

import type { Chat, Message, Rel, Route, UserProfile } from '@/lib/types'

export type Screen = 'boot' | 'auth' | 'onboard' | 'app'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'banner'
  chatId?: string
  title?: string
  senderId?: string
}

export interface AppState {
  screen: Screen
  uid: string | null
  me: UserProfile | null
  users: Record<string, UserProfile>
  chats: Record<string, Chat>
  chatsLoaded: boolean
  rels: Record<string, Rel>
  route: Route
  friendsTab: 'online' | 'all' | 'pending' | 'add'
  search: string
  // open conversation
  msgChatId: string | null
  msgs: Message[]
  hasMore: boolean
  wall: string | null
  replyTo: { id: string; senderId: string; text: string } | null
  editing: Message | null
  urgentNext: boolean
  detailsOpen: boolean
  // ui
  toasts: Toast[]
  modal: React.ReactNode | null
  tick: number
  appTheme: string
}

export const initialState: AppState = {
  screen: 'boot',
  uid: null,
  me: null,
  users: {},
  chats: {},
  chatsLoaded: false,
  rels: {},
  route: { view: 'home' },
  friendsTab: 'online',
  search: '',
  msgChatId: null,
  msgs: [],
  hasMore: false,
  wall: null,
  replyTo: null,
  editing: null,
  urgentNext: false,
  detailsOpen: false,
  toasts: [],
  modal: null,
  tick: 0,
  appTheme: (() => {
    try {
      return localStorage.getItem('bubbles.appTheme') ?? 'default'
    } catch {
      return 'default'
    }
  })(),
}

export const useStore = create<AppState>(() => initialState)

export const get = useStore.getState
export const set = useStore.setState

let toastN = 0
export function toast(text: string, kind: Toast['kind'] = 'info', ttl = 3200, extra: Partial<Toast> = {}) {
  const id = ++toastN
  set((s) => ({ toasts: [...s.toasts, { id, text, kind, ...extra }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl)
}

export const openModal = (node: React.ReactNode) => set({ modal: node })
export const closeModal = () => set({ modal: null })
