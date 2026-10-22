import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, deleteField, writeBatch, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const cfg = self.FIREBASE_CONFIG || {};

// Local testing against the Firebase emulators: open http://localhost:PORT/?emulator
export const useEmulator = new URLSearchParams(location.search).has('emulator')
  && ['localhost', '127.0.0.1'].includes(location.hostname);
export const configured = useEmulator || !!cfg.apiKey;

export let app, auth, db;
if (configured) {
  app = initializeApp(useEmulator
    ? { apiKey: 'demo-key', projectId: 'demo-bubbles', authDomain: 'localhost', appId: 'demo' }
    : cfg);
  auth = getAuth(app);
  db = initializeFirestore(app, useEmulator ? {} : {
    // Offline cache: chats open instantly and messages queue while the Chromebook is offline.
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

// Accounts are username + password only. Firebase Auth needs an email-shaped login, so each
// username maps to an address on a reserved domain that never receives mail.
export const LOGIN_DOMAIN = 'bubbles.example.com';
export const usernameToLogin = (u) => `${u}@${LOGIN_DOMAIN}`;
export const loginToUsername = (email) => String(email || '').split('@')[0];

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut,
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, deleteField, writeBatch, arrayUnion, arrayRemove,
};
