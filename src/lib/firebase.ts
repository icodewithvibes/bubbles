import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

// Public web config: not a secret, access is enforced by firestore.rules / storage.rules.
const config = {
  apiKey: 'AIzaSyBX1X9AeclgvAU3647ZH4ypcYfw-VyvI5A',
  authDomain: 'bubbles-a2d52.firebaseapp.com',
  projectId: 'bubbles-a2d52',
  storageBucket: 'bubbles-a2d52.firebasestorage.app',
  messagingSenderId: '553184234012',
  appId: '1:553184234012:web:9b771089ccd04a713d2dd9',
}

export const TURN_CREDENTIALS_URL =
  'https://bubbles-chat.metered.live/api/v1/turn/credentials?apiKey=e1d1d9f7075d3a72729815a564988c2c2b42'
export const VAPID_KEY = ''

export const useEmulator =
  new URLSearchParams(location.search).has('emulator') && ['localhost', '127.0.0.1'].includes(location.hostname)

export const app = initializeApp(
  useEmulator ? { apiKey: 'demo-key', projectId: 'demo-bubbles', authDomain: 'localhost', appId: 'demo' } : config,
)
export const auth = getAuth(app)
export const storage = getStorage(app)

// ---------------------------------------------------------------------------
// Firestore cache: the "messages disappear until you clear site data" fix.
//
// v1 kept an unbounded IndexedDB cache full of inline base64 photos. When that
// cache hit the browser quota or got corrupted (two tabs, a crash mid-write),
// listeners stalled silently and only wiping site data recovered.
// v2: media lives in Storage (docs stay tiny), the cache has a size cap, and if
// the persistent cache ever fails we wipe it ourselves and fall back to memory.
// ---------------------------------------------------------------------------
const CACHE_BYTES = 40 * 1024 * 1024
const BROKEN_FLAG = 'bubbles.cacheBroken'

function makeDb(): Firestore {
  if (useEmulator) return initializeFirestore(app, {})
  const broken = sessionStorage.getItem(BROKEN_FLAG) === '1'
  return initializeFirestore(app, {
    localCache: broken
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_BYTES }),
  })
}

export let db = makeDb()

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

/** Errors that mean the local cache itself is unusable rather than the network or rules. */
export function isCacheFailure(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? ''
  const msg = String((e as Error)?.message ?? e)
  return (
    code === 'failed-precondition' ||
    code === 'internal' ||
    /IndexedDB|indexeddb|QuotaExceeded|primary lease|persistence/i.test(msg)
  )
}

/** Wipe the broken offline cache and reload on the memory cache; never loops. */
export async function recoverCache(): Promise<void> {
  if (sessionStorage.getItem(BROKEN_FLAG) === '1') return
  sessionStorage.setItem(BROKEN_FLAG, '1')
  try {
    await terminate(db)
    await clearIndexedDbPersistence(db)
  } catch {
    /* another tab may hold it; the memory cache on reload still recovers */
  }
  location.reload()
}

export const usernameToLogin = (u: string) => `${u}@bubbles.example.com`
export const loginToUsername = (email: string | null | undefined) => String(email ?? '').split('@')[0]
