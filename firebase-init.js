/* ============================================================
   Firebase bridge — exposes window.Cloud for app.js
   ------------------------------------------------------------
   - Firestore : transaction records (real-time, cross-device)
   - Storage   : receipt photos
   - Anonymous auth so security rules can require sign-in.

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
    const [appMod, authMod, fs, st] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
      import(base + "firebase-storage.js"),
    ]);

    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    const db = fs.getFirestore(app);
    const storage = st.getStorage(app);
    const col = fs.collection(db, "transactions");
    const ready = authMod.signInAnonymously(auth).catch(err => {
      console.error("[Cloud] Anonymous sign-in failed:", err);
    });

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

      // Save/update a record. Receipt photos still held as data: URIs are
      // uploaded to Storage and replaced with their download URLs.
      async save(record) {
        await ready;
        const receipts = [];
        const list = record.receipts || [];
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (typeof r === "string" && r.startsWith("data:")) {
            const sref = st.ref(storage, `receipts/${record.id}/${i}_${Date.now()}`);
            await st.uploadString(sref, r, "data_url");
            receipts.push(await st.getDownloadURL(sref));
          } else {
            receipts.push(r); // already a URL
          }
        }
        const toSave = { ...record, receipts };
        await fs.setDoc(fs.doc(col, record.id), toSave);
        return toSave;
      },

      async remove(id) {
        await ready;
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
