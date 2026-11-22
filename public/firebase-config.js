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

// Relay (TURN) server for video calls. School and shared Wi-Fi often block devices from reaching
// each other directly, and calls then only connect through a relay. With a free Metered account
// (metered.ca → TURN Server → your app), paste the "credentials API" link here; it looks like
// https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=…
self.TURN_CREDENTIALS_URL = "https://bubbles-chat.metered.live/api/v1/turn/credentials?apiKey=e1d1d9f7075d3a72729815a564988c2c2b42";
