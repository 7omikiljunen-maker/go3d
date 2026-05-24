// ─── firebase.js — Firebase app + Realtime Database + Analytics ───────────────
import { initializeApp } from 'firebase/app';
import { getDatabase }   from 'firebase/database';
import { getAnalytics }  from 'firebase/analytics';

const firebaseConfig = {
  apiKey:            "AIzaSyCFXuYLIzNdiupgnWRBSmialb1BUJ0RBVU",
  authDomain:        "go3d-85751.firebaseapp.com",
  projectId:         "go3d-85751",
  storageBucket:     "go3d-85751.firebasestorage.app",
  messagingSenderId: "319322282265",
  appId:             "1:319322282265:web:02d5112758345cef350d88",
  measurementId:     "G-ZB851NFW2Y",
  // ↓ Paste your Realtime Database URL here after creating it in the Firebase console
  databaseURL:       "https://go3d-85751-default-rtdb.europe-west1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
export const db        = getDatabase(app);
export const analytics = getAnalytics(app);
