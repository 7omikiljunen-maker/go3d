# Go 3D — Weekly Stats Log

Fill in once a week from each dashboard. Copy a blank section template at the bottom for each new week.

---

## Where to find each number

| Number | Where |
|--------|-------|
| Unique visitors | [Cloudflare dashboard](https://dash.cloudflare.com) → go3dgame.com → Analytics → Traffic |
| Active users (7-day / 30-day) | [Firebase Console](https://console.firebase.google.com) → Analytics → Dashboard |
| Signed-up users (total) | Firebase Console → Authentication → Users |
| New sign-ups this week | Firebase Console → Authentication → Users → filter by week |
| Funnel events (create clicks → paid) | Firebase Console → Analytics → Events |
| Top countries | Firebase Console → Analytics → Demographics |
| Mobile vs desktop split | Firebase Console → Analytics → Tech |
| Total revenue | [Stripe dashboard](https://dashboard.stripe.com) → Home → Gross volume |
| Payments this week | Stripe → Payments → filter date range |
| Failed payments | Stripe → Payments → filter status: failed |
| Disputes | Stripe → Disputes (keep close to 0!) |
| Firebase DB usage | Firebase Console → Realtime Database → Usage |
| Cloud Function errors | Firebase Console → Functions → Logs |

---

## Week of YYYY-MM-DD

**Traffic (Cloudflare)**
- Unique visitors:
- Total requests:
- Top traffic source:

**Users (Firebase)**
- Total signed-up users:
- New sign-ups this week:
- 7-day active users:
- Mobile %: ___%   Desktop %: ___%
- Top country:

**Funnel (Firebase Events)**
- `create_game_clicked`:
- `signin_completed`:
- `payment_gate_shown`:
- `payment_initiated`:
- `payment_completed`:
- `room_created`:
- `room_joined`:
- `game_completed`:

**Revenue (Stripe)**
- Payments this week:
- Revenue this week (€):
- Failed payments:
- Disputes (cumulative):
- Net after fees + VAT (€):

**Health (Firebase)**
- DB reads this week:
- DB writes this week:
- DB storage:
- Cloud Function invocations:
- Cloud Function errors:

**Notes / observations**
- 
- 

---

## TEMPLATE — copy this for each new week

```
## Week of YYYY-MM-DD

**Traffic (Cloudflare)**
- Unique visitors:
- Total requests:
- Top traffic source:

**Users (Firebase)**
- Total signed-up users:
- New sign-ups this week:
- 7-day active users:
- Mobile %: ___%   Desktop %: ___%
- Top country:

**Funnel (Firebase Events)**
- create_game_clicked:
- signin_completed:
- payment_gate_shown:
- payment_initiated:
- payment_completed:
- room_created:
- room_joined:
- game_completed:

**Revenue (Stripe)**
- Payments this week:
- Revenue this week (€):
- Failed payments:
- Disputes (cumulative):
- Net after fees + VAT (€):

**Health (Firebase)**
- DB reads this week:
- DB writes this week:
- DB storage:
- Cloud Function invocations:
- Cloud Function errors:

**Notes / observations**
- 
- 
```
