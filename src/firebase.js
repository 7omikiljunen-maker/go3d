// ─── firebase.js — Firebase app + Realtime Database + Analytics + Auth ─────────
import { initializeApp } from 'firebase/app';
import { getDatabase }   from 'firebase/database';
import { getAnalytics }  from 'firebase/analytics';
import { getAuth }       from 'firebase/auth';

const firebaseConfig = {
  apiKey:            "AIzaSyCFXuYLIzNdiupgnWRBSmialb1BUJ0RBVU",
  // Auth served from our OWN subdomain (Firebase Hosting) instead of the default
  // *.firebaseapp.com. Same-site as go3dgame.com → mobile signInWithRedirect no
  // longer breaks on browser cross-site storage partitioning. Requires the
  // auth.go3dgame.com custom domain + SSL to be live before deploying this.
  authDomain:        "auth.go3dgame.com",
  projectId:         "go3d-85751",
  storageBucket:     "go3d-85751.firebasestorage.app",
  messagingSenderId: "319322282265",
  appId:             "1:319322282265:web:02d5112758345cef350d88",
  measurementId:     "G-ZB851NFW2Y",
  // ↓ Paste your Realtime Database URL here after creating it in the Firebase console
  databaseURL:       "https://go3d-85751-default-rtdb.europe-west1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
export const db          = getDatabase(app);
export const analytics   = getAnalytics(app);
export const auth        = getAuth(app);
export const databaseURL = firebaseConfig.databaseURL; // used for keepalive REST writes on tab close
