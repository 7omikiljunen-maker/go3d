// netlify/functions/stripe-webhook.js
// Receives Stripe payment events and marks the user as paid in Firebase.
//
// Environment variables required (set in Netlify dashboard):
//   STRIPE_SECRET_KEY        — Stripe secret key  (sk_live_...)
//   STRIPE_WEBHOOK_SECRET    — Stripe webhook signing secret (whsec_...)
//   FIREBASE_SERVICE_ACCOUNT — Full JSON content of the Firebase service account key
//   FIREBASE_DATABASE_URL    — e.g. https://go3d-85751-default-rtdb.europe-west1.firebasedatabase.app

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin  = require('firebase-admin');

// Firebase Admin is initialised once per cold start (Netlify reuses the process)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Netlify may base64-encode the body — Stripe needs the raw bytes
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // Verify the request is genuinely from Stripe
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only care about completed checkouts
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const uid     = session.client_reference_id; // set by the game when opening Stripe

    if (!uid) {
      console.warn('checkout.session.completed — no client_reference_id');
      return { statusCode: 200, body: 'OK (no uid)' };
    }

    // Write paid:true — the game's Firebase listener picks this up instantly
    await admin.database().ref(`users/${uid}/paid`).set(true);
    console.log(`Marked user ${uid} as paid`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
