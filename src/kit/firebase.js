// Compatibility layer: the ported v1 modules (call.js, notify.js) import Firebase helpers from
// './firebase.js'. This re-exports the npm SDK with the same names so they run unchanged.
import { app, auth, db, TURN_CREDENTIALS_URL, VAPID_KEY } from '../lib/firebase'

// call.js reads these globals for relay servers; notify.js for push.
self.TURN_CREDENTIALS_URL = TURN_CREDENTIALS_URL
self.FIREBASE_VAPID_KEY = VAPID_KEY

export { app, auth, db }
export {
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, deleteField, writeBatch, arrayUnion, arrayRemove,
} from 'firebase/firestore'
