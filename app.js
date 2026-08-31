/* ================================================================
   Payment Approval Form — mobile web app
   Vanilla JS, no build step. State persisted in localStorage.
   ================================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'paf.records.v1';
  const DRAFT_KEY = 'paf.draft.v1';

  /* ---------- Signature field definitions ---------- */
  const SIG_FIELDS = {
    foMember:   'Member receiving assistance',
    requestor:  'Requestor / organization leader',
    approver1:  '1st approver',
    approver2:  '2nd approver',
    reimburse:  'Reimbursement recipient',
    caReceive:  'Person receiving cash advance',
    caReturn:   'Person returning excess cash',
    caBishop:   'Bishop / President',
  };

  /* ---------- App state ---------- */
  const state = {
    signatures: {},   // key -> dataURL
    receipts: [],     // array of dataURL
    editingId: null,  // record id being edited, or null for new
    activeSig: null,  // key currently open in modal
  };

  /* ---------- Element helpers ---------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const form = $('#pafForm');

  /* ================================================================
     Persistence
     ================================================================ */
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }
  function saveRecords(recs) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(recs));
      return true;
    } catch (e) {
      toast('Storage full — remove old forms or photos.');
      return false;
    }
  }

  /* ================================================================
     Collect / apply form data
     ================================================================ */
  function collect() {
    const data = {};
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) data[k] = v;
    return {
      fields: data,
      signatures: { ...state.signatures },
      receipts: [...state.receipts],
    };
  }

  function applyRecord(rec) {
    resetForm(false);
    const f = rec.fields || {};
    // radios
    setRadio('txnType', f.txnType);
    setRadio('category', f.category);
    setRadio('foType', f.foType);
    // text/date/number
    Object.entries(f).forEach(([k, v]) => {
      const el = form.elements[k];
      if (!el) return;
      if (el instanceof RadioNodeList || el.type === 'radio') return;
      el.value = v;
    });
    state.signatures = { ...(rec.signatures || {}) };
    state.receipts = [...(rec.receipts || [])];
    renderSignatures();
    renderReceipts();
    updateConditionals();
    computeExcess();
  }

  function setRadio(name, val) {
    const els = form.elements[name];
    if (!els) return;
    const list = els.length ? Array.from(els) : [els];
    list.forEach(el => { el.checked = (el.value === val); });
  }

  /* ================================================================
     Conditional sections
     ================================================================ */
  function updateConditionals() {
    const type = form.elements['txnType'].value;
    const cat = form.elements['category'].value;
    $('#reimbursementCard').hidden = type !== 'Reimbursement';
    $('#cashAdvanceCard').hidden = type !== 'Cash Advance';
    $('#fastOfferingCard').hidden = cat !== 'Fast Offering';
  }

  function computeExcess() {
    const rec = parseFloat(form.elements['caReceived'].value) || 0;
    const spent = parseFloat(form.elements['caSpent'].value) || 0;
    const excess = Math.max(0, rec - spent);
    form.elements['caExcess'].value = (rec || spent) ? excess.toFixed(2) : '';
  }

  /* ================================================================
     Signature pads
     ================================================================ */
  function initSigPads() {
    $$('.sigpad').forEach(pad => {
      const key = pad.dataset.sig;
      pad.innerHTML = '<button type="button" class="sigpad__clear" aria-label="Clear signature">✕</button>';
      pad.addEventListener('click', (e) => {
        if (e.target.closest('.sigpad__clear')) {
          delete state.signatures[key];
          renderSignatures();
          saveDraft();
          return;
        }
        openSigModal(key);
      });
    });
  }

  function renderSignatures() {
    $$('.sigpad').forEach(pad => {
      const key = pad.dataset.sig;
      const data = state.signatures[key];
      const clearBtn = pad.querySelector('.sigpad__clear');
      pad.querySelectorAll('img').forEach(i => i.remove());
      if (data) {
        pad.classList.add('has-sig');
        const img = new Image();
        img.src = data;
        pad.insertBefore(img, clearBtn);
      } else {
        pad.classList.remove('has-sig');
      }
    });
  }

  /* ----- signature modal / canvas ----- */
  const sigModal = $('#sigModal');
  const sigCanvas = $('#sigCanvas');
  let sigCtx, sigDrawing = false, sigDirty = false, sigLast = null;

  function openSigModal(key) {
    state.activeSig = key;
    $('#sigModalTitle').textContent = SIG_FIELDS[key] || 'Signature';
    sigModal.hidden = false;
    requestAnimationFrame(() => setupCanvas());
  }
  function closeSigModal() {
    sigModal.hidden = true;
    state.activeSig = null;
  }

  function setupCanvas() {
    const rect = sigCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigCanvas.width = rect.width * dpr;
    sigCanvas.height = rect.height * dpr;
    sigCtx = sigCanvas.getContext('2d');
    sigCtx.scale(dpr, dpr);
    sigCtx.lineWidth = 2.4;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = '#12233b';
    sigCtx.clearRect(0, 0, rect.width, rect.height);
    sigDirty = false;
    // preload existing
    const existing = state.signatures[state.activeSig];
    if (existing) {
      const img = new Image();
      img.onload = () => sigCtx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = existing;
    }
  }

  function sigPos(e) {
    const r = sigCanvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function sigStart(e) {
    e.preventDefault();
    sigDrawing = true;
    sigLast = sigPos(e);
  }
  function sigMove(e) {
    if (!sigDrawing) return;
    e.preventDefault();
    const p = sigPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(sigLast.x, sigLast.y);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
    sigLast = p;
    sigDirty = true;
  }
  function sigEnd() { sigDrawing = false; }

  function trimmedSignature() {
    // crop transparent margins for a tighter image
    const w = sigCanvas.width, h = sigCanvas.height;
    const ctx = sigCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h).data;
    let top = h, left = w, right = 0, bottom = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (img[(y * w + x) * 4 + 3] > 10) {
          found = true;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (!found) return null;
    const pad = 6;
    top = Math.max(0, top - pad); left = Math.max(0, left - pad);
    right = Math.min(w, right + pad); bottom = Math.min(h, bottom + pad);
    const cw = right - left, ch = bottom - top;
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(sigCanvas, left, top, cw, ch, 0, 0, cw, ch);
    return out.toDataURL('image/png');
  }

  /* ================================================================
     Receipts / photo upload
     ================================================================ */
  function handleFiles(files) {
    const list = Array.from(files);
    let pending = list.length;
    if (!pending) return;
    list.forEach(file => {
      if (!file.type.startsWith('image/')) { pending--; return; }
      compressImage(file, 1400, 0.72).then(dataURL => {
        state.receipts.push(dataURL);
        renderReceipts();
        saveDraft();
        if (--pending === 0) toast('Receipt added');
      }).catch(() => { pending--; });
    });
  }

  function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            const s = maxSize / Math.max(width, height);
            width = Math.round(width * s);
            height = Math.round(height * s);
          }
          const c = document.createElement('canvas');
          c.width = width; c.height = height;
          const cx = c.getContext('2d');
          cx.fillStyle = '#fff';
          cx.fillRect(0, 0, width, height);
          cx.drawImage(img, 0, 0, width, height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderReceipts() {
    const grid = $('#receiptGrid');
    grid.innerHTML = '';
    state.receipts.forEach((src, i) => {
      const el = document.createElement('div');
      el.className = 'receipt';
      el.innerHTML = `<img src="${src}" alt="Receipt ${i + 1}"><button type="button" class="receipt__del" data-i="${i}" aria-label="Remove">✕</button>`;
      grid.appendChild(el);
    });
  }

  /* ================================================================
     Draft autosave
     ================================================================ */
  let draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          ...collect(), editingId: state.editingId,
        }));
      } catch {}
    }, 400);
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (d && (Object.values(d.fields || {}).some(v => v) ||
                (d.receipts || []).length || Object.keys(d.signatures || {}).length)) {
        applyRecord(d);
        state.editingId = d.editingId || null;
      }
    } catch {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

  /* ================================================================
     Reset / new
     ================================================================ */
  function resetForm(toastMsg = true) {
    form.reset();
    setRadio('txnType', 'Reimbursement');
    setRadio('category', 'Budget');
    state.signatures = {};
    state.receipts = [];
    state.editingId = null;
    renderSignatures();
    renderReceipts();
    updateConditionals();
    computeExcess();
    clearDraft();
    if (toastMsg) toast('New form');
  }

  /* ================================================================
     Save record
     ================================================================ */
  function saveRecord() {
    const payload = collect();
    if (!payload.fields.payee && !payload.fields.amount && !payload.fields.purpose) {
      toast('Add a payee or amount first');
      return;
    }
    const recs = loadRecords();
    const now = new Date().toISOString();
    if (state.editingId) {
      const idx = recs.findIndex(r => r.id === state.editingId);
      if (idx >= 0) {
        recs[idx] = { ...recs[idx], ...payload, updatedAt: now };
      } else {
        recs.unshift({ id: state.editingId, ...payload, createdAt: now, updatedAt: now });
      }
    } else {
      const id = 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      recs.unshift({ id, ...payload, createdAt: now, updatedAt: now });
      state.editingId = id;
    }
    if (saveRecords(recs)) {
      clearDraft();
      toast('Saved to history');
    }
  }

  /* ================================================================
     History view
     ================================================================ */
  function renderHistory(filter = '') {
    const recs = loadRecords();
    const list = $('#historyList');
    const empty = $('#historyEmpty');
    const q = filter.trim().toLowerCase();
    const filtered = q ? recs.filter(r => {
      const f = r.fields || {};
      return [f.payee, f.unit, f.purpose, f.txnType, f.category]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    }) : recs;

    list.innerHTML = '';
    empty.hidden = recs.length !== 0;
    if (recs.length === 0) return;

    if (filtered.length === 0) {
      list.innerHTML = `<p class="empty" style="padding:30px">No matches for “${escapeHtml(filter)}”.</p>`;
      return;
    }

    filtered.forEach(r => {
      const f = r.fields || {};
      const amt = f.amount ? '$' + Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—';
      const date = f.activityDate || (r.createdAt ? r.createdAt.slice(0, 10) : '');
      const card = document.createElement('div');
      card.className = 'hcard';
      card.innerHTML = `
        <div class="hcard__body">
          <div class="hcard__top">
            <span class="hcard__payee">${escapeHtml(f.payee || 'Untitled')}</span>
            <span class="hcard__amount">${amt}</span>
          </div>
          <div class="hcard__meta">${escapeHtml(f.unit || '')}${f.unit && date ? ' · ' : ''}${escapeHtml(date)}${f.purpose ? ' · ' + escapeHtml(f.purpose) : ''}</div>
          <div class="hcard__tags">
            ${f.txnType ? `<span class="tag tag--type">${escapeHtml(f.txnType)}</span>` : ''}
            ${f.category ? `<span class="tag tag--cat">${escapeHtml(f.category)}</span>` : ''}
            ${(r.receipts || []).length ? `<span class="tag">📷 ${r.receipts.length}</span>` : ''}
          </div>
          <div class="hcard__actions">
            <button class="linkbtn" data-act="open" data-id="${r.id}">Open</button>
            <button class="linkbtn" data-act="preview" data-id="${r.id}">Preview</button>
            <button class="linkbtn" data-act="dup" data-id="${r.id}">Duplicate</button>
            <button class="linkbtn linkbtn--danger" data-act="del" data-id="${r.id}">Delete</button>
          </div>
        </div>`;
      list.appendChild(card);
    });
  }

  function historyAction(act, id) {
    const recs = loadRecords();
    const rec = recs.find(r => r.id === id);
    if (!rec && act !== 'del') return;
    switch (act) {
      case 'open':
        applyRecord(rec);
        state.editingId = id;
        switchTab('form');
        toast('Loaded for editing');
        break;
      case 'preview':
        applyRecord(rec);
        state.editingId = id;
        showPreview();
        break;
      case 'dup': {
        applyRecord(rec);
        state.editingId = null;
        switchTab('form');
        toast('Duplicated — save to keep');
        break;
      }
      case 'del':
        if (confirm('Delete this form?')) {
          saveRecords(recs.filter(r => r.id !== id));
          renderHistory($('#historySearch').value);
          toast('Deleted');
        }
        break;
    }
  }

  /* ================================================================
     Views / navigation
     ================================================================ */
  let currentTab = 'form';
  function switchTab(tab) {
    currentTab = tab;
    $('#viewForm').hidden = tab !== 'form';
    $('#viewHistory').hidden = tab !== 'history';
    $('#viewPreview').hidden = true;
    $('#formActions').hidden = tab !== 'form';
    $('#previewActions').hidden = true;
    $('#tabbar').hidden = false;
    $('#btnBack').hidden = true;
    $('#btnNew').hidden = false;
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
    $('#topbarTitle').textContent = tab === 'history' ? 'History' : 'Payment Approval';
    if (tab === 'history') renderHistory($('#historySearch').value);
    window.scrollTo(0, 0);
  }

  function showPreview() {
    $('#previewMount').innerHTML = buildPreviewHTML(collect());
    $('#viewForm').hidden = true;
    $('#viewHistory').hidden = true;
    $('#viewPreview').hidden = false;
    $('#formActions').hidden = true;
    $('#previewActions').hidden = false;
    $('#tabbar').hidden = true;
    $('#btnBack').hidden = false;
    $('#btnNew').hidden = true;
    $('#topbarTitle').textContent = 'Preview';
    window.scrollTo(0, 0);
  }

  function backFromPreview() { switchTab(currentTab === 'history' ? 'form' : currentTab); }

  /* ================================================================
     Preview / printable PAF replica
     ================================================================ */
  function chk(on) { return `<span class="paf-box">${on ? '✕' : ''}</span>`; }
  function sig(key) {
    const d = state.signatures[key];
    return d ? `<img src="${d}" alt="signature">` : '';
  }
  function money(v) { return v ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''; }
  function fmtDate(v) { return v || ''; }

  function buildPreviewHTML(rec) {
    const f = rec.fields;
    const isFO = f.category === 'Fast Offering';
    const receipts = (rec.receipts || []).map(src => `<img src="${src}" alt="receipt">`).join('');

    return `
    <div class="paf" id="pafSheet">
      <div class="paf-head">
        <div class="paf-logo">THE CHURCH OF<b>JESUS CHRIST</b>OF LATTER-DAY SAINTS</div>
        <div class="paf-title">PAYMENT APPROVAL FORM</div>
      </div>

      <div class="paf-types">
        <span class="paf-check">${chk(f.txnType === 'Swipe')} Swipe</span>
        <span class="paf-check">${chk(f.txnType === 'Reimbursement')} Reimbursement</span>
        <span class="paf-check">${chk(f.txnType === 'Cash Advance')} Cash Advance</span>
      </div>

      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Ward/Branch or Stake/District</span>
          <div class="paf-val">${escapeHtml(f.unit)}</div>
        </div>
        <div class="paf-cell">
          <span class="paf-lbl">Activity Date</span>
          <div class="paf-val">${escapeHtml(fmtDate(f.activityDate))}</div>
        </div>
        <div class="paf-cell">
          <span class="paf-lbl">Amount of payment request</span>
          <div class="paf-val">${f.amount ? '$' + money(f.amount) : ''}</div>
        </div>
      </div>

      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Payee: Name of requestor / person / entity</span>
          <div class="paf-val">${escapeHtml(f.payee)}</div>
        </div>
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Payment Category</span>
          <div class="paf-cat">
            <span class="paf-check">${chk(f.category === 'Budget')} Budget</span>
            <span class="paf-check">${chk(f.category === 'Fast Offering')} Fast Offering</span>
            <span class="paf-check">${chk(f.category === 'Other')} Other</span>
          </div>
        </div>
      </div>

      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Payment purpose (Name of activity or description)</span>
          <div class="paf-val" style="min-height:34px">${escapeHtml(f.purpose)}</div>
        </div>
        <div class="paf-cell paf-fo" style="flex:2">
          <span class="paf-lbl" style="font-weight:700;text-align:center;display:block">Fast offering expenditures only</span>
          ${isFO ? `
            <div class="paf-fo-types">
              <span class="paf-check">${chk(f.foType === 'Food')} Food</span>
              <span class="paf-check">${chk(f.foType === 'Medical')} Medical</span>
              <span class="paf-check">${chk(f.foType === 'Short-Term Shelter (Housing)')} Housing</span>
              <span class="paf-check">${chk(f.foType === 'Utilities')} Utilities</span>
              <span class="paf-check">${chk(f.foType === 'Other')} Other</span>
            </div>
            <div style="display:flex;gap:8px">
              <div style="flex:1"><span class="paf-lbl">Name of Recipient</span><div class="paf-val">${escapeHtml(f.foRecipient)}</div></div>
              <div style="flex:1"><span class="paf-lbl">MRN</span><div class="paf-val">${escapeHtml(f.foMRN)}</div></div>
            </div>
            <div class="paf-sig">${sig('foMember')}</div>
            <span class="sub">Signature of member receiving Fast Offering assistance</span>
          ` : `<div style="color:#888;text-align:center;padding:14px 0">— Not applicable —</div>`}
        </div>
      </div>

      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Name &amp; signature of organization leader / Requestor</span>
          <div class="paf-val">${escapeHtml(f.requestorName)}</div>
          <div class="paf-sig">${sig('requestor')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.requestorDate))}</span>
        </div>
      </div>

      <div class="paf-section">APPROVALS (BOTH REQUIRED)</div>
      <div class="paf-approvers">
        <div class="paf-cell">
          <span class="paf-lbl">1st Approver — Bishop/Branch Pres. or Stake/District Pres.</span>
          <div class="paf-val">${escapeHtml(f.approver1Name)}</div>
          <div class="paf-sig">${sig('approver1')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.approver1Date))}</span>
        </div>
        <div class="paf-cell">
          <span class="paf-lbl">2nd Approver — Ward/Branch or Stake/District Counselor</span>
          <div class="paf-val">${escapeHtml(f.approver2Name)}</div>
          <div class="paf-sig">${sig('approver2')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.approver2Date))}</span>
        </div>
      </div>

      ${f.txnType === 'Reimbursement' ? `
      <div class="paf-section">FOR REIMBURSEMENT ONLY</div>
      <div class="paf-row">
        <div class="paf-cell">
          <span class="paf-lbl">Signature of person receiving cash reimbursement</span>
          <div class="paf-sig">${sig('reimburse')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.reimburseDate))}</span>
        </div>
      </div>` : ''}

      ${f.txnType === 'Cash Advance' ? `
      <div class="paf-section">FOR CASH ADVANCE ONLY</div>
      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Signature of person receiving cash advance</span>
          <div class="paf-sig">${sig('caReceive')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.caReceiveDate))}</span>
        </div>
        <div class="paf-cell paf-money">
          <span>Amount of cash received</span><span class="op">+</span>
          <span class="paf-amt">${money(f.caReceived)}</span>
        </div>
      </div>
      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Signature of person returning excess cash</span>
          <div class="paf-sig">${sig('caReturn')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.caReturnDate))}</span>
        </div>
        <div class="paf-cell paf-money">
          <span>Amount spent (supporting docs)</span><span class="op">−</span>
          <span class="paf-amt">${money(f.caSpent)}</span>
        </div>
      </div>
      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Bishop/President signature (upon receipt of excess cash)</span>
          <div class="paf-sig">${sig('caBishop')}</div>
          <span class="sub">Date: ${escapeHtml(fmtDate(f.caBishopDate))}</span>
        </div>
        <div class="paf-cell paf-money">
          <span>Excess cash returned</span><span class="op">=</span>
          <span class="paf-amt">${money(f.caExcess)}</span>
        </div>
      </div>` : ''}

      <div class="paf-section">FOR CLERK USE ONLY</div>
      <div class="paf-row">
        <div class="paf-cell" style="flex:2">
          <span class="paf-lbl">Reference Number (YYYYMMDD-Amount)</span>
          <div class="paf-val">${escapeHtml(f.refNumber)}</div>
        </div>
        <div class="paf-cell">
          <span class="paf-lbl">Seq #</span>
          <div class="paf-val">${escapeHtml(f.seq)}</div>
        </div>
      </div>

      ${receipts ? `
      <div class="paf-receipts">
        <h4>Supporting documents / receipts</h4>
        <div class="paf-receipts-grid">${receipts}</div>
      </div>` : ''}
    </div>`;
  }

  /* ================================================================
     Export: Print + PNG
     ================================================================ */
  function doPrint() { window.print(); }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function doPng() {
    const sheet = $('#pafSheet');
    if (!sheet) return;
    toast('Rendering image…');
    try {
      if (!window.html2canvas) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      }
      const canvas = await window.html2canvas(sheet, { scale: 2, backgroundColor: '#fff', useCORS: true });
      const f = collect().fields;
      const name = ('PAF_' + (f.payee || 'form') + '_' + (f.activityDate || todayISO()))
        .replace(/[^a-z0-9_\-]+/gi, '_');
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('PNG downloaded');
      }, 'image/png');
    } catch (e) {
      toast('Image export needs internet — use Print / PDF');
    }
  }

  /* ================================================================
     Utilities
     ================================================================ */
  function escapeHtml(v) {
    if (v == null) return '';
    return String(v).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function genRef() {
    const d = (form.elements['activityDate'].value || todayISO()).replace(/-/g, '');
    const amt = form.elements['amount'].value ? Math.round(parseFloat(form.elements['amount'].value)) : '';
    form.elements['refNumber'].value = amt ? `${d}-${amt}` : d;
    saveDraft();
  }

  /* ================================================================
     Wire up events
     ================================================================ */
  function bind() {
    // form input -> conditionals, draft, excess
    form.addEventListener('input', (e) => {
      if (e.target.name === 'txnType' || e.target.name === 'category') updateConditionals();
      if (e.target.name === 'caReceived' || e.target.name === 'caSpent') computeExcess();
      saveDraft();
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'txnType' || e.target.name === 'category') updateConditionals();
      saveDraft();
    });

    // signature pads
    initSigPads();

    // signature modal
    ['mousedown', 'touchstart'].forEach(ev => sigCanvas.addEventListener(ev, sigStart, { passive: false }));
    ['mousemove', 'touchmove'].forEach(ev => sigCanvas.addEventListener(ev, sigMove, { passive: false }));
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => sigCanvas.addEventListener(ev, sigEnd));
    $('#sigClear').addEventListener('click', () => { setupCanvas(); sigDirty = false; });
    $('#sigDone').addEventListener('click', () => {
      const key = state.activeSig;
      if (sigDirty) {
        const data = trimmedSignature();
        if (data) state.signatures[key] = data;
      }
      renderSignatures();
      saveDraft();
      closeSigModal();
    });
    $$('#sigModal [data-close]').forEach(el => el.addEventListener('click', closeSigModal));

    // receipts
    $('#receiptInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    $('#receiptGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('.receipt__del');
      if (btn) {
        state.receipts.splice(+btn.dataset.i, 1);
        renderReceipts();
        saveDraft();
      }
    });

    // clerk auto ref
    $('#btnGenRef').addEventListener('click', genRef);

    // action bar
    $('#btnSave').addEventListener('click', saveRecord);
    $('#btnPreview').addEventListener('click', showPreview);
    $('#btnClear').addEventListener('click', () => { if (confirm('Clear the form?')) resetForm(); });
    $('#btnPrint').addEventListener('click', doPrint);
    $('#btnPng').addEventListener('click', doPng);
    $('#btnEditFromPreview').addEventListener('click', backFromPreview);
    $('#btnBack').addEventListener('click', backFromPreview);
    $('#btnNew').addEventListener('click', () => { resetForm(); switchTab('form'); });

    // tabs
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('#btnEmptyNew').addEventListener('click', () => { resetForm(); switchTab('form'); });

    // history
    $('#historySearch').addEventListener('input', (e) => renderHistory(e.target.value));
    $('#historyList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) historyAction(btn.dataset.act, btn.dataset.id);
    });

    // esc closes modal
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sigModal.hidden) closeSigModal(); });
  }

  /* ================================================================
     Init
     ================================================================ */
  function init() {
    bind();
    updateConditionals();
    loadDraft();
    switchTab('form');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
