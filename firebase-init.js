/* ============================================================
   Firebase bridge — exposes window.Cloud for app.js
   ------------------------------------------------------------
   - Firestore : everything — transaction records AND receipt/document
                 photos (stored inline as data URIs in the same document).
   - No Firebase Storage is used.
   - No authentication (open access — protect via project rules).

   The Firebase SDK is only fetched when window.FIREBASE_CONFIG is
   filled in. Otherwise the app uses on-device storage and never
   touches the network — window.Cloud.enabled stays false.
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
    console.error("[Cloud] Firebase init failed — using on-device storage:", err);
    window.Cloud = { enabled: false };
  }
}
