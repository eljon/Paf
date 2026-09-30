/* ============================================================
   Firebase bridge — exposes window.Cloud for app.js
   ------------------------------------------------------------
   - Firestore : everything — transaction records AND receipt/document
                 photos (stored inline as data URIs in the same document).
   - No Firebase Storage is used.
   - No authentication (open access — protect via project rules).

   Everything is stored in Firestore; nothing is kept on the device.
   Without window.FIREBASE_CONFIG (or if Firebase can't load) the app
   fires "cloud-failed" and refuses to save.
   ============================================================ */
const cfg = window.FIREBASE_CONFIG || {};
const configured = !!(cfg.apiKey && cfg.projectId);

window.Cloud = { enabled: false };

if (configured) {
  try {
    const base = "https://www.gstatic.com/firebasejs/10.12.5/";
    const [appMod, fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-firestore.js"),
    ]);

    const app = appMod.initializeApp(cfg);
    const db = fs.getFirestore(app);
    const col = fs.collection(db, "transactions");

    window.Cloud = {
      enabled: true,

      // Real-time subscription to all transactions (newest first).
      subscribe(cb) {
        const q = fs.query(col, fs.orderBy("createdAt", "desc"));
        return fs.onSnapshot(
          q,
          snap => cb(snap.docs.map(d => d.data())),
          err => console.error("[Cloud] subscribe error:", err)
        );
      },

      // One-off fetch of all transactions (for pull-to-refresh).
      async refresh() {
        const q = fs.query(col, fs.orderBy("createdAt", "desc"));
        const snap = await fs.getDocs(q);
        return snap.docs.map(d => d.data());
      },

      // Save/update a record. The whole record — including receipt/document
      // photos as inline data URIs — is written to one Firestore document.
      // (Firestore caps a document at ~1 MB, so photos are compressed small.)
      async save(record) {
        await fs.setDoc(fs.doc(col, record.id), record);
        return record;
      },

      async remove(id) {
        await fs.deleteDoc(fs.doc(col, id));
      },
    };

    window.dispatchEvent(new Event("cloud-ready"));
    console.info("[Cloud] Firebase enabled.");
  } catch (err) {
    console.error("[Cloud] Firebase init failed:", err);
    window.Cloud = { enabled: false };
    window.dispatchEvent(new Event("cloud-failed"));
  }
} else {
  // The app is cloud-only; without a config nothing can be saved.
  window.addEventListener("DOMContentLoaded", () => window.dispatchEvent(new Event("cloud-failed")));
}
