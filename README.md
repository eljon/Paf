# Payment Approval Form (PAF) — Mobile Web App

A mobile-first web app for filling out, signing, and exporting the Church
**Payment Approval Form**. Runs in the browser and can sync transactions to
the cloud with **Firebase** (optional). Without Firebase configured, it works
fully offline with on-device storage (`localStorage`).

## Features

- **Digitizes the full PAF** — transaction type (Swipe / Reimbursement / Cash
  Advance), amount, payee, payment category, purpose, approvals, the
  Fast Offering, Reimbursement, and Cash Advance sections, and the clerk
  reference block. The unit is preset to **Kalayaan Ward**.
- **On-screen signatures** — draw with finger or stylus for the requestor,
  both approvers, the fast-offering recipient, and cash-advance signers. Each
  signature is trimmed and stored with the form.
- **Receipt / photo upload** — snap a receipt with the camera or pick from the
  gallery. Images are auto-compressed to keep storage light and attached to
  the form and its output.
- **Transaction history** — every saved form is listed and searchable. Open to
  edit, duplicate, preview, or delete.
- **Filled-out form output** — your entries are overlaid directly onto the
  **actual Payment Approval Form image** (checkmarks, text, signatures, and the
  clerk boxes land in their real positions), not a re-drawn copy. Export to
  **PDF** (via the browser's Print dialog → *Save as PDF*) or download a **PNG**
  image.
- **Smart sections** — the Fast Offering, Reimbursement, and Cash Advance
  blocks appear only when relevant, and the excess-cash total is calculated
  automatically.
- **Autosave draft** — an in-progress form is kept so you never lose work.

## Cloud sync with Firebase

By default, forms are saved only on the device. To make transactions
**device-independent** — saved in the cloud and visible from any device —
connect a free Firebase project. Records go to **Firestore** and receipt
photos to **Firebase Storage**; the app still keeps a local cache and works
offline, syncing when it can.

**1. Create the project**
- Go to <https://console.firebase.google.com> → **Add project**.
- **Build → Firestore Database → Create database**.
- **Build → Storage → Get started**.
- No authentication is used — access is controlled by the rules below.

**2. Get the web config**
- **Project settings (gear) → General → Your apps →** add a **Web app** (`</>`).
- Copy the `firebaseConfig` values into **`firebase-config.js`** in this repo:

  ```js
  window.FIREBASE_CONFIG = {
    apiKey: "…",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "…",
    appId: "…"
  };
  ```

**3. Security rules (open — no authentication).** One shared `transactions`
collection so any device sees the same data. Paste these:

- Firestore (**Firestore → Rules**):

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /transactions/{id} {
        allow read, write: if true;
      }
    }
  }
  ```

- Storage (**Storage → Rules**):

  ```
  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      match /receipts/{allPaths=**} {
        allow read, write: if true;
      }
    }
  }
  ```

  ⚠️ These rules are **fully open**: anyone who knows the project's config can
  read, write, or delete the transactions. That's fine for a private/internal
  tool while you get going, but before wider use, add authentication and lock
  the rules down (ask and I'll wire it up). For PNG export of cloud-stored
  photos, also set a CORS rule on the Storage bucket allowing your domain.

**4. Commit `firebase-config.js` and deploy.** On load you'll see
`[Cloud] Firebase enabled` in the console, and saves go to the cloud. The web
config is *not a secret* (it only identifies the project) — with open rules,
the rules are all that stand between the data and the public, so treat the
project as internal.

## Running locally

It's a static site — just open `index.html`, or serve the folder:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Publishing to GitHub Pages (deploy from a branch)

The site is served straight from the branch — no build step. To turn it on:

1. Push this branch to GitHub.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Set **Branch** to `claude/mobile-payment-approval-app-l3yucw` (or whichever
   branch holds this code) and the folder to **`/ (root)`**, then **Save**.
5. Wait a minute for the first build. The live URL appears at the top of the
   Pages settings screen, typically `https://<user>.github.io/Paf/`.

The `.nojekyll` file tells Pages to serve the files as-is (no Jekyll
processing). Every push to the selected branch re-publishes the site
automatically.

## Privacy

There is no server. Forms, signatures, and photos are stored only in your
browser via `localStorage` and never leave your device. Clearing browser data
removes saved forms. The only network request is an optional CDN fetch of
`html2canvas` when you export a **PNG**; **Print / PDF** works fully offline.

## Tech

Plain HTML, CSS, and JavaScript — no framework and no build step, so the repo
root is exactly what gets served.

## Notes

This is an unofficial helper tool to make filling out the form easier on a
phone. Follow your unit's actual policies (*General Handbook 34.6.8*): a
Payment Approval Form must be completed and signed by two authorized people,
supporting documents attached, and records retained per the handbook.
