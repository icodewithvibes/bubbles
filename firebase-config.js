// Paste your Firebase web app config here.
// Firebase console → Project settings → General → "Your apps" → Web app → SDK setup and configuration → Config.
// These values are not secrets: access is controlled by firestore.rules.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBX1X9AeclgvAU3647ZH4ypcYfw-VyvI5A",
  authDomain: "bubbles-a2d52.firebaseapp.com",
  projectId: "bubbles-a2d52",
  storageBucket: "bubbles-a2d52.firebasestorage.app",
  messagingSenderId: "553184234012",
  appId: "1:553184234012:web:9b771089ccd04a713d2dd9",
};

// Web Push certificate key, for notifications while the app is closed.
// Firebase console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
// Leave it empty to only notify while the app is open (including minimized or in the background).
self.FIREBASE_VAPID_KEY = "";
