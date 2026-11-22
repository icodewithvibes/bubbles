import { useEffect } from 'react'

import { AuthScreen, BootScreen, OnboardScreen } from '@/components/Auth'
import { ChatView } from '@/components/Chat'
import { maybeShowPatchNotes } from '@/components/WhatsNew'
import { FriendsView } from '@/components/Friends'
import { Rail, Sidebar } from '@/components/Shell'
import { ModalHost, PopoverHost, Toasts } from '@/components/ui'
import { useStore } from '@/store'
import { ThemeBackground } from '@/themes'

function Main() {
  const route = useStore((s) => s.route)
  return <main className="main">{route.view === 'chat' ? <ChatView key={route.id} id={route.id} /> : <FriendsView />}</main>
}

function AppShell() {
  const route = useStore((s) => s.route)
  useEffect(() => {
    const t = setTimeout(maybeShowPatchNotes, 600)
    return () => clearTimeout(t)
  }, [])
  return (
    <div id="app" className={route.view !== 'home' ? 'show-main' : ''}>
      <Rail />
      <Sidebar />
      <Main />
    </div>
  )
}

export default function App() {
  const screen = useStore((s) => s.screen)
  return (
    <>
      {screen === 'boot' && <BootScreen />}
      {screen === 'auth' && <AuthScreen />}
      {screen === 'onboard' && <OnboardScreen />}
      <ThemeBackground />
      {screen === 'app' && <AppShell />}
      <div id="callRoot" />
      <PopoverHost />
      <ModalHost />
      <Toasts />
    </>
  )
}
