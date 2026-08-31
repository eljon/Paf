# Payment Approval Form (PAF) — Mobile Web App

A mobile-first web app for filling out, signing, and exporting the Church
**Payment Approval Form**. Runs entirely in the browser — no backend, no
accounts. All data stays on the device (`localStorage`).

## Features

- **Digitizes the full PAF** — transaction type (Swipe / Reimbursement / Cash
  Advance), unit, amount, payee, payment category, purpose, approvals, the
  Fast Offering, Reimbursement, and Cash Advance sections, and the clerk
  reference block.
- **On-screen signatures** — draw with finger or stylus for the requestor,
  both approvers, the fast-offering recipient, and cash-advance signers. Each
  signature is trimmed and stored with the form.
- **Receipt / photo upload** — snap a receipt with the camera or pick from the
  gallery. Images are auto-compressed to keep storage light and attached to
  the form and its output.
- **Transaction history** — every saved form is listed and searchable. Open to
  edit, duplicate, preview, or delete.
- **Filled-out form output** — a faithful, print-ready replica of the paper PAF
  is generated from your entries. Export to **PDF** (via the browser's Print
  dialog → *Save as PDF*) or download a **PNG** image.
- **Smart sections** — the Fast Offering, Reimbursement, and Cash Advance
  blocks appear only when relevant, and the excess-cash total is calculated
  automatically.
- **Autosave draft** — an in-progress form is kept so you never lose work.

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
