const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { default: Stripe } = require('stripe');

admin.initializeApp();

const stripeSecretKey     = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

exports.stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      const stripeClient = new Stripe(stripeSecretKey.value());
      event = stripeClient.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (uid) {
        await admin.database().ref(`users/${uid}/paid`).set(true);
        console.log(`Marked uid ${uid} as paid`);

        // Reverse-lookup record so we can revoke on refund / lost dispute.
        if (session.payment_intent) {
          await admin.database().ref(`payments/${session.payment_intent}`).set({
            uid,
            sessionId:   session.id,
            amount:      session.amount_total,
            completedAt: Date.now(),
          });
        }
      } else {
        console.warn('No client_reference_id on session', session.id);
      }
    }

    // ── Revoke paid status on refund or lost dispute ──────────────────────────
    else if (event.type === 'charge.refunded' ||
             event.type === 'charge.dispute.closed') {
      // For disputes, only revoke when we lost — otherwise the customer still paid.
      if (event.type === 'charge.dispute.closed' &&
          event.data.object.status !== 'lost') {
        return res.json({ received: true, note: 'dispute not lost — no action' });
      }

      const piId = event.data.object.payment_intent;
      if (!piId) {
        console.warn(`${event.type} with no payment_intent`, event.id);
        return res.json({ received: true });
      }

      const snap = await admin.database().ref(`payments/${piId}`).once('value');
      const payment = snap.val();
      if (payment && payment.uid) {
        await admin.database().ref(`users/${payment.uid}/paid`).set(false);
        await admin.database().ref(`payments/${piId}/revokedAt`).set(Date.now());
        await admin.database().ref(`payments/${piId}/revokeReason`).set(event.type);
        console.log(`Revoked paid status for uid ${payment.uid} (reason: ${event.type})`);
      } else {
        console.warn(`No payments record for payment_intent ${piId} — cannot revoke`);
      }
    }

    res.json({ received: true });
  }
);
