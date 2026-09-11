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
    acknowledge:'Received by',
  };

  /* Signature key -> date field it should auto-fill when signed */
  const SIG_DATE = {
    requestor:  'requestorDate',
    approver1:  'approver1Date',
    approver2:  'approver2Date',
    reimburse:  'reimburseDate',
    caReceive:  'caReceiveDate',
    caReturn:   'caReturnDate',
    caBishop:   'caBishopDate',
    acknowledge:'ackDate',
  };

  /* ---------- Workflow statuses ---------- */
  const STATUS_LABEL = {
    withdrawal:      'For Withdrawal',
    acknowledgement: 'For Acknowledgement',
    documents:       'For Document Upload',
    approval:        'For Approval',
    recording:       'For Recording',
    done:            'Recorded',
  };

  /* ---------- Version / changelog ---------- */
  // Newest last. The current version is the last entry; reach any version at
  // /v<number> (e.g. /v3) — see the version-history modal.
  const CHANGELOG = [
    { v: 1, notes: 'Digitized PAF: overlay output on the real form image, on-screen signatures, receipt photos, transaction history, PDF/PNG export.' },
    { v: 2, notes: 'Auto-advancing question wizard; separate requestor and approver signing; inline activity-date calendar.' },
    { v: 3, notes: 'Apple-style redesign; peso amounts; shareable transaction links.' },
    { v: 4, notes: 'Firebase cloud sync and a workflow queue: For Withdrawal → Acknowledgement → Approval → Recording.' },
    { v: 5, notes: 'Proper icons in place of emojis; dark mode removed; Document Upload stage for cash advances; auto-approve after both signatures.' },
    { v: 6, notes: 'Required-field checks before each step; sequential transaction numbers on the form; History shows only recorded transactions; full-screen document viewer; Open PDF and gallery save.' },
    { v: 7, notes: 'Everything stored in Firestore (photos inline, auto-compressed to fit); removed the New tab; icon+text top-bar buttons; tab bar stays put when the keyboard opens.' },
    { v: 8, notes: 'Version numbers with a /v<number> route and the current version shown at the bottom of History.' },
    { v: 9, notes: 'Pull down to refresh the Queue and History; live cloud updates now refresh the Queue too.' },
    { v: 10, notes: 'Action buttons keep their labels on a single line.' },
  ];
  const APP_VERSION = CHANGELOG[CHANGELOG.length - 1].v;

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
    for (const [k, v] of fd.entries()) {
      // foType is multi-select (checkboxes) → join into one comma list
      if (k === 'foType') data.foType = data.foType ? data.foType + ', ' + v : v;
      else data[k] = v;
    }
    return {
      fields: data,
      signatures: { ...state.signatures },
      receipts: [...state.receipts],
    };
  }

  function applyRecord(rec) {
    resetForm(false);
    const f = rec.fields || {};
    // radios / checkboxes
    setRadio('txnType', f.txnType);
    setRadio('category', f.category);
    setFoTypes(f.foType);
    // text/date/number
    Object.entries(f).forEach(([k, v]) => {
      const el = form.elements[k];
      if (!el) return;
      if (el instanceof RadioNodeList || el.type === 'radio') return;
      if (el.type === 'checkbox') { el.checked = (v === 'on' || v === true || v === 'true'); return; }
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

  // Currently-checked foType values
  function foTypeValues() {
    const els = form.elements['foType'];
    if (!els) return [];
    const list = els.length ? Array.from(els) : [els];
    return list.filter(el => el.checked).map(el => el.value);
  }
  function setFoTypes(val) {
    const set = (val || '').split(',').map(s => s.trim()).filter(Boolean);
    const els = form.elements['foType'];
    if (!els) return;
    const list = els.length ? Array.from(els) : [els];
    list.forEach(el => { el.checked = set.includes(el.value); });
  }

  /* ================================================================
     Conditional sections
     ================================================================ */
  function updateConditionals() {
    // Only the request-side Fast Offering card (recipient name/MRN).
    $('#fastOfferingCard').hidden = form.elements['category'].value !== 'Fast Offering';
    syncRequestorSame();
    syncCaExcess();
  }

  // "Same as payee": hide the requestor name field and mirror the payee into it.
  function syncRequestorSame() {
    const chk = $('#requestorSame');
    if (!chk) return;
    const on = chk.checked;
    $('#requestorNameField').hidden = on;
    if (on) form.elements['requestorName'].value = form.elements['payee'].value || '';
  }

  // "With excess cash": reveal the return/excess fields.
  function syncCaExcess() {
    const chk = $('#withExcess');
    if (!chk) return;
    $('#caExcessFields').hidden = !chk.checked;
  }

  // Which acknowledgement card applies to the current transaction.
  function ackKind() {
    const t = radioVal('txnType');
    if (t === 'Reimbursement') return { card: 'reimbursementCard', sig: 'reimburse' };
    if (t === 'Cash Advance') return { card: 'cashAdvanceCard', sig: 'caReceive' };
    if (radioVal('category') === 'Fast Offering') return { card: 'ackFoCard', sig: 'foMember' };
    return { card: 'ackGenericCard', sig: 'acknowledge' };
  }
  function renderAckCards() {
    const which = ackKind().card;
    ['reimbursementCard', 'cashAdvanceCard', 'ackFoCard', 'ackGenericCard']
      .forEach(id => { $('#' + id).hidden = id !== which; });
  }
  function ackSigned() { return !!state.signatures[ackKind().sig]; }
  function bothApproversSigned() { return !!(state.signatures.approver1 && state.signatures.approver2); }

  // Read-only view of uploaded documents shown to approvers.
  function renderApprovalDocs() {
    const card = $('#approvalDocsCard');
    const grid = $('#approvalDocs');
    const docs = state.receipts || [];
    card.hidden = docs.length === 0;
    grid.innerHTML = docs.map((src, i) =>
      `<a class="receipt" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="Document ${i + 1}"></a>`
    ).join('');
  }

  // Cash received equals the amount requested; excess = requested − spent.
  function computeExcess() {
    const rec = parseFloat(form.elements['amount'].value) || 0;
    const spent = parseFloat(form.elements['caSpent'].value) || 0;
    const excess = Math.max(0, rec - spent);
    form.elements['caExcess'].value = (rec || spent) ? excess.toFixed(2) : '';
  }

  /* ================================================================
     Wizard (auto-advancing questions) + Request/Approval tabs
     ================================================================ */
  // formMode: 'wizard' | 'create' | 'withdrawal' | 'acknowledgement' | 'approval' | 'done'
  let formMode = 'wizard';
  let wizIndex = 0;
  let advanceTimer;
  const isStage = () => ['withdrawal', 'acknowledgement', 'documents', 'approval', 'recording', 'done'].includes(formMode);

  /* Approver roster */
  const BISHOP = 'Eljon Serrano';
  const COUNSELORS = ['John Sombrero', 'John Magno'];
  const EXTRA_APPROVER = 'John Carlo Eduria';

  // Bishop is the payee on a reimbursement/cash advance → he can't approve his own.
  function isSelfApprovalCase() {
    const t = radioVal('txnType');
    const payee = (form.elements['payee'].value || '').trim().toLowerCase();
    return (t === 'Reimbursement' || t === 'Cash Advance') && payee === BISHOP.toLowerCase();
  }

  function radioVal(name) {
    const el = form.elements[name];
    return el ? el.value : '';
  }
  function shortFO(v) { return v === 'Short-Term Shelter (Housing)' ? 'Housing' : v; }
  function foTypeLabel() { return foTypeValues().map(shortFO).join(', '); }

  // Is a wizard question answered? (foType is multi-select)
  function answered(q) {
    if (q === 'foType') return foTypeValues().length > 0;
    return radioVal(q) !== '';
  }

  // Ordered list of visible questions (foType only for Fast Offering)
  function wizQuestions() {
    const qs = ['txnType', 'category'];
    if (radioVal('category') === 'Fast Offering') qs.push('foType');
    return qs;
  }

  function renderWizProgress(activeIdx) {
    const total = wizQuestions().length + 1; // + details step
    const prog = $('#wizProgress');
    prog.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = 'wiz-dot' + (i < activeIdx ? ' is-done' : '') + (i === activeIdx ? ' is-active' : '');
      prog.appendChild(d);
    }
  }

  function showWizardStep(idx) {
    const qs = wizQuestions();
    idx = Math.max(0, Math.min(idx, qs.length - 1));
    formMode = 'wizard';
    wizIndex = idx;
    $('#wizard').hidden = false;
    $('#detailsStep').hidden = true;
    $$('.wiz-step').forEach(s => { s.hidden = s.dataset.q !== qs[idx]; });
    $('#wizBack').hidden = idx === 0;
    renderWizProgress(idx);
    $('#formActions').hidden = true;
    $('#btnShare').hidden = true;
    window.scrollTo(0, 0);
  }

  // Show the details step (create request, or a workflow stage).
  function showDetails() {
    if (formMode === 'wizard') formMode = 'create';
    $('#wizard').hidden = true;
    $('#detailsStep').hidden = false;
    clearInvalid();
    const create = formMode === 'create';

    $('#summary').hidden = !create;
    $('#stageSummary').hidden = create;
    $('#requestContent').hidden = !create;
    $('#ackContent').hidden = formMode !== 'acknowledgement';
    $('#approvalsSection').hidden = formMode !== 'approval';
    // Receipts: in the request for non-cash-advance, or in the Document Upload stage.
    const isCA = radioVal('txnType') === 'Cash Advance';
    $('#receiptsCard').hidden = !((create && !isCA) || formMode === 'documents');

    if (create) {
      renderWizProgress(wizQuestions().length);
      renderSummary();
      refreshCalendar();
    } else {
      renderStageSummary();
      if (formMode === 'acknowledgement') renderAckCards();
      if (formMode === 'approval') { updateApproverButtons(); renderApprovalDocs(); }
    }
    renderStageActions();
    $('#btnShare').hidden = currentTab !== 'form';
    window.scrollTo(0, 0);
  }

  // Which action-bar buttons show for the current mode.
  function renderStageActions() {
    ['#btnSubmitRequest', '#btnClear', '#btnPreview', '#btnSubmitDocs',
     '#btnMarkWithdrawn', '#btnConfirmAck', '#btnMarkApproved', '#btnMarkRecorded']
      .forEach(id => { $(id).hidden = true; });
    if (currentTab !== 'form') { $('#formActions').hidden = true; return; }
    $('#formActions').hidden = false;
    switch (formMode) {
      case 'create':
        $('#btnClear').hidden = false;
        $('#btnSubmitRequest').hidden = false;
        break;
      case 'withdrawal':
        $('#btnPreview').hidden = false;
        $('#btnMarkWithdrawn').hidden = false;
        break;
      case 'acknowledgement':
        $('#btnPreview').hidden = false;
        $('#btnConfirmAck').hidden = false;
        break;
      case 'documents':
        $('#btnPreview').hidden = false;
        $('#btnSubmitDocs').hidden = false;
        break;
      case 'approval':
        $('#btnPreview').hidden = false;
        $('#btnMarkApproved').hidden = false;
        break;
      case 'recording':
        $('#btnPreview').hidden = false;
        $('#btnMarkRecorded').hidden = false;
        break;
      default: // done
        $('#btnPreview').hidden = false;
    }
  }

  // Amount stays editable until the recipient signs the acknowledgement.
  function amountEditable() {
    return (formMode === 'withdrawal' || formMode === 'acknowledgement') && !ackSigned();
  }
  function renderStageSummary() {
    const f = collect().fields;
    const el = $('#stageSummary');
    const amt = f.amount ? '₱' + Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '';
    const date = f.activityDate ? fmtLongDate(f.activityDate) : '';
    const meta = [f.txnType, f.category, date].filter(Boolean).join(' · ');
    const amountHtml = amountEditable()
      ? `<div class="stage-amount">
           <label for="stageAmount">Amount</label>
           <div class="money"><span>₱</span>
             <input id="stageAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${escapeHtml(f.amount || '')}">
           </div>
         </div>`
      : (amt ? `<span class="stage-summary__amount">${amt}</span>` : '');
    el.innerHTML =
      `<span class="stage-summary__status">${STATUS_LABEL[form.elements['status'].value] || ''}${f.txnNo ? ' · ' + escapeHtml(f.txnNo) : ''}</span>
       ${amountEditable() ? '' : amountHtml}
       <div class="stage-summary__payee">${escapeHtml(f.payee || 'Untitled')}</div>
       <div class="stage-summary__meta">${escapeHtml(meta)}</div>
       ${f.purpose ? `<div class="stage-summary__purpose">${escapeHtml(f.purpose)}</div>` : ''}
       ${amountEditable() ? amountHtml : ''}`;
  }

  /* ---------- Inline calendar (activity date) ---------- */
  const cal = { y: 0, m: 0 };   // month currently on screen
  let calOpen = true;           // grid shown vs. collapsed date
  function parseISO(s) {
    if (!s) return null;
    const [y, mo, d] = s.split('-').map(Number);
    return y ? { y, m: mo - 1, d } : null;
  }
  function isoOf(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function fmtLongDate(iso) {
    const p = parseISO(iso);
    if (!p) return '';
    return new Date(p.y, p.m, p.d).toLocaleDateString(undefined,
      { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function syncCalToValue() {
    const p = parseISO(form.elements['activityDate'] ? form.elements['activityDate'].value : '');
    const now = new Date();
    cal.y = p ? p.y : now.getFullYear();
    cal.m = p ? p.m : now.getMonth();
  }
  function renderActivity() {
    const mount = $('#activityCal');
    if (!mount) return;
    const val = form.elements['activityDate'].value;
    // Collapsed: a date is chosen and the grid isn't open → show a compact field.
    if (val && !calOpen) {
      mount.classList.add('is-collapsed');
      mount.innerHTML =
        `<button type="button" class="cal-selected" data-cal="edit">
          <span class="cal-selected__date">${fmtLongDate(val)}</span>
          <span class="cal-selected__edit">Change</span>
        </button>`;
      return;
    }
    mount.classList.remove('is-collapsed');
    const sel = parseISO(val);
    const today = new Date();
    const startDow = new Date(cal.y, cal.m, 1).getDay();
    const daysIn = new Date(cal.y, cal.m + 1, 0).getDate();
    const title = new Date(cal.y, cal.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    let h = `<div class="cal-head">
      <button type="button" class="cal-nav" data-cal="prev" aria-label="Previous month">‹</button>
      <span class="cal-title">${title}</span>
      <button type="button" class="cal-nav" data-cal="next" aria-label="Next month">›</button>
    </div><div class="cal-grid">`;
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(w => h += `<div class="cal-wd">${w}</div>`);
    for (let i = 0; i < startDow; i++) h += `<button type="button" class="cal-day is-empty" tabindex="-1"></button>`;
    for (let d = 1; d <= daysIn; d++) {
      const isToday = today.getFullYear() === cal.y && today.getMonth() === cal.m && today.getDate() === d;
      const isSel = sel && sel.y === cal.y && sel.m === cal.m && sel.d === d;
      h += `<button type="button" class="cal-day${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}" data-day="${d}">${d}</button>`;
    }
    mount.innerHTML = h + '</div>';
  }
  // Show collapsed if a date exists, otherwise the open grid.
  function refreshCalendar() {
    syncCalToValue();
    calOpen = !(form.elements['activityDate'] && form.elements['activityDate'].value);
    renderActivity();
  }

  /* ---------- Persist + workflow transitions ---------- */
  function genId() { return 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Next sequential transaction number across all known records.
  function nextTxnSeq() {
    const max = loadRecords().reduce((m, r) => {
      const n = parseInt(r.fields && r.fields.txnSeq, 10);
      return n > m ? n : m;
    }, 0);
    return max + 1;
  }
  function formatTxnNo(seq) { return 'PAF-' + String(seq).padStart(4, '0'); }

  // Assign a transaction number to the form the first time it's submitted.
  function ensureTxnNo() {
    if (form.elements['txnNo'] && !form.elements['txnNo'].value) {
      const seq = nextTxnSeq();
      form.elements['txnSeq'].value = String(seq);
      form.elements['txnNo'].value = formatTxnNo(seq);
    }
  }

  // Build the current record, save to the local cache (+ cloud), return it.
  function persist(status) {
    const payload = collect();
    if (status) payload.fields.status = status;
    const recs = loadRecords();
    const now = new Date().toISOString();
    const existing = state.editingId && recs.find(r => r.id === state.editingId);
    let record;
    if (existing) {
      record = { ...existing, ...payload, updatedAt: now };
    } else {
      const id = state.editingId || genId();
      record = { id, ...payload, createdAt: now, updatedAt: now };
      state.editingId = id;
    }
    if (status) { record.status = status; if (form.elements['status']) form.elements['status'].value = status; }
    saveRecords([record, ...recs.filter(r => r.id !== record.id)]);
    clearDraft();
    if (window.Cloud && window.Cloud.enabled) {
      window.Cloud.save(record).catch(err => {
        console.error('Cloud save failed', err);
        toast('Saved on device — cloud sync failed (photos may be too large)');
      });
    }
    return record;
  }

  /* ---------- Required-field validation ---------- */
  // Required fields for the current stage → [{ label, sel }] for anything missing.
  function missingRequired() {
    const f = collect().fields;
    const miss = [];
    const need = (ok, label, sel) => { if (!ok) miss.push({ label, sel }); };
    const filled = v => !!(v && String(v).trim());
    const positive = v => filled(v) && parseFloat(v) > 0;

    if (formMode === 'create') {
      need(filled(f.txnType), 'Transaction type', '#detailsStep');
      need(filled(f.category), 'Category', '#detailsStep');
      if (radioVal('category') === 'Fast Offering')
        need(filled(f.foRecipient), 'Fast offering recipient', '#foRecipient');
      need(filled(f.activityDate), 'Activity date', '#activityCal');
      need(positive(f.amount), 'Amount', '#amount');
      need(filled(f.payee), 'Payee', '#payee');
      need(filled(f.purpose), 'Payment purpose', '#purpose');
      const same = $('#requestorSame') && $('#requestorSame').checked;
      if (!same) need(filled(f.requestorName), 'Requestor name', '#requestorName');
      need(!!state.signatures.requestor, 'Requestor signature', '.sigpad[data-sig="requestor"]');
    } else if (formMode === 'acknowledgement') {
      const kind = ackKind().sig;
      if (kind === 'reimburse') need(filled(f.reimburseName), 'Recipient name', '#reimburseName');
      else if (kind === 'caReceive') need(filled(f.caReceiveName), 'Recipient name', '#caReceiveName');
      else if (kind === 'acknowledge') need(filled(f.ackName), 'Received by', '#ackName');
      need(!!state.signatures[kind], 'Acknowledgement signature', `.sigpad[data-sig="${kind}"]`);
    } else if (formMode === 'documents') {
      need(state.receipts.length > 0, 'At least one document', '#receiptsCard');
    } else if (formMode === 'approval') {
      need(!!state.signatures.approver1, '1st approver signature', '#btnApprover1');
      need(!!state.signatures.approver2, '2nd approver signature', '#btnApprover2');
    }
    return miss;
  }

  function clearInvalid() { $$('.is-invalid').forEach(el => el.classList.remove('is-invalid')); }

  // Flag any missing required fields; return true when the stage is complete.
  function validateStage() {
    clearInvalid();
    const miss = missingRequired();
    if (!miss.length) return true;
    miss.forEach(m => { const el = $(m.sel); if (el) el.classList.add('is-invalid'); });
    const first = $(miss[0].sel);
    if (first && first.scrollIntoView) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Fill in: ' + miss.map(m => m.label).join(', '));
    return false;
  }

  // Create → submit a new request (enters the "For Withdrawal" queue).
  function submitRequest() {
    if (!validateStage()) return;
    ensureTxnNo();
    persist('withdrawal');
    toast('Sent for withdrawal');
    newForm();
    switchTab('queue');
  }

  function advanceStage(newStatus, msg) {
    persist(newStatus);
    toast(msg);
    switchTab('queue');
  }
  function markWithdrawn() { advanceStage('acknowledgement', 'Marked as withdrawn'); }
  function confirmAck() {
    if (!validateStage()) return;
    // Cash advances (money given out) must upload receipts before approval.
    if (radioVal('txnType') === 'Cash Advance') advanceStage('documents', 'Receipt confirmed — upload documents');
    else advanceStage('approval', 'Receipt confirmed');
  }
  function submitDocs() {
    if (!validateStage()) return;
    advanceStage('approval', 'Documents uploaded');
  }
  function markApproved() {
    if (!validateStage()) return;
    advanceStage('recording', 'Approved — for recording');
  }
  function markRecorded() { advanceStage('done', 'Recorded'); }

  // Open a record at its current workflow stage.
  function openStage(id) {
    const rec = loadRecords().find(r => r.id === id);
    if (!rec) return;
    applyRecord(rec);
    state.editingId = id;
    const st = rec.status || 'withdrawal';
    if (form.elements['status']) form.elements['status'].value = st;
    formMode = st;
    switchTab('form');
  }

  function updateApproverButtons() {
    const special = isSelfApprovalCase();
    const n1 = form.elements['approver1Name'] ? form.elements['approver1Name'].value : '';
    const n2 = form.elements['approver2Name'] ? form.elements['approver2Name'].value : '';
    const s1 = !!state.signatures.approver1;
    const s2 = !!state.signatures.approver2;
    const d1 = form.elements['approver1Date'] ? form.elements['approver1Date'].value : '';
    const d2 = form.elements['approver2Date'] ? form.elements['approver2Date'].value : '';
    $('#ap1Name').textContent = n1 || (special ? 'Choose counselor' : 'Bishop');
    $('#ap2Name').textContent = n2 || 'Choose approver';
    $('#ap1Status').textContent = s1 ? (d1 ? 'Signed · ' + d1 : 'Signed') : 'Tap to sign';
    $('#ap2Status').textContent = s2 ? (d2 ? 'Signed · ' + d2 : 'Signed') : 'Tap to sign';
    $('#btnApprover1').classList.toggle('is-signed', s1);
    $('#btnApprover2').classList.toggle('is-signed', s2);
    if (s1) $('#btnApprover1').classList.remove('is-invalid');
    if (s2) $('#btnApprover2').classList.remove('is-invalid');
  }

  // Approver flow: pick a name (if needed) → capture signature.
  async function startApprover(which) {
    let name;
    if (which === 1) {
      name = isSelfApprovalCase()
        ? await openChoice('Choose 1st approver', COUNSELORS)
        : BISHOP;                                   // Bishop signs directly
    } else {
      let opts;
      if (isSelfApprovalCase()) {
        const a1 = form.elements['approver1Name'].value;
        opts = COUNSELORS.filter(n => n !== a1).concat([EXTRA_APPROVER]);
      } else {
        opts = COUNSELORS;
      }
      name = await openChoice('Choose 2nd approver', opts);
    }
    if (!name) return;                              // cancelled
    const key = which === 1 ? 'approver1' : 'approver2';
    form.elements[key + 'Name'].value = name;
    updateApproverButtons();
    saveDraft();
    openSigModal(key);
  }

  // Promise-based choice modal
  function openChoice(title, options) {
    return new Promise(resolve => {
      const modal = $('#choiceModal');
      const list = $('#choiceList');
      $('#choiceTitle').textContent = title;
      list.innerHTML = '';
      const finish = (val) => { modal.hidden = true; modal._finish = null; resolve(val); };
      options.forEach(opt => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice-opt';
        b.textContent = opt;
        b.addEventListener('click', () => finish(opt));
        list.appendChild(b);
      });
      modal._finish = finish;                       // used by data-close handlers
      modal.hidden = false;
    });
  }

  function renderSummary() {
    const sum = $('#summary');
    if (!sum) return;
    sum.innerHTML = '';
    wizQuestions().forEach(q => {
      const v = q === 'foType' ? foTypeLabel() : radioVal(q);
      if (!v) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sum-chip';
      b.dataset.q = q;
      b.textContent = v;
      sum.appendChild(b);
    });
  }

  // After answering a question, land on the next unanswered one, or details.
  function resumeStage() {
    const qs = wizQuestions();
    const firstUnanswered = qs.findIndex(q => !answered(q));
    if (firstUnanswered === -1) { formMode = 'create'; showDetails(); }
    else showWizardStep(firstUnanswered);
  }

  function applyFormStage() {
    if (formMode === 'wizard') showWizardStep(wizIndex);
    else showDetails();
  }

  function newForm() {
    resetForm(false);
    formMode = 'wizard';
    renderSummary();
    showWizardStep(0);
  }

  /* ================================================================
     Signature pads
     ================================================================ */
  // Delegated so pads shown/hidden across stages all work.
  function initSigPads() {
    document.addEventListener('click', (e) => {
      const pad = e.target.closest('.sigpad');
      if (!pad || !pad.dataset.sig) return;
      const key = pad.dataset.sig;
      if (e.target.closest('.sigpad__clear')) {
        delete state.signatures[key];
        renderSignatures();
        renderStageActions();
        saveDraft();
        return;
      }
      openSigModal(key);
    });
  }

  function renderSignatures() {
    $$('.sigpad').forEach(pad => {
      if (!pad.querySelector('.sigpad__clear')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sigpad__clear';
        b.setAttribute('aria-label', 'Clear signature');
        b.textContent = '✕';
        pad.appendChild(b);
      }
      const key = pad.dataset.sig;
      const data = state.signatures[key];
      const clearBtn = pad.querySelector('.sigpad__clear');
      pad.querySelectorAll('img').forEach(i => i.remove());
      if (data) {
        pad.classList.add('has-sig');
        pad.classList.remove('is-invalid');
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
  // Done turns solid once there's a signature (drawn or already saved).
  function updateSigDone() {
    const ready = sigDirty || !!(state.activeSig && state.signatures[state.activeSig]);
    $('#sigDone').classList.toggle('is-active', ready);
  }

  let sigW = 0, sigH = 0;
  function setupCanvas() {
    const rect = sigCanvas.getBoundingClientRect();
    sigW = rect.width; sigH = rect.height;
    if (!sigW || !sigH) return;
    const dpr = window.devicePixelRatio || 1;
    sigCanvas.width = Math.round(sigW * dpr);
    sigCanvas.height = Math.round(sigH * dpr);
    sigCtx = sigCanvas.getContext('2d');
    sigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sigCtx.lineWidth = 2.6;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = '#12233b';
    sigCtx.clearRect(0, 0, sigW, sigH);
    sigDirty = false;
    updateSigDone();
    const existing = state.signatures[state.activeSig];
    if (existing) {
      const img = new Image();
      img.onload = () => {
        // fit existing signature within the pad, centered
        const r = Math.min(sigW / img.width, sigH / img.height, 1);
        const w = img.width * r, h = img.height * r;
        sigCtx.drawImage(img, (sigW - w) / 2, (sigH - h) / 2, w, h);
      };
      img.src = existing;
    }
  }

  function sigPos(e) {
    const r = sigCanvas.getBoundingClientRect();
    const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function sigStart(e) {
    e.preventDefault();
    if (!sigCtx) setupCanvas();
    sigDrawing = true;
    sigLast = sigPos(e);
    // dot for taps
    sigCtx.beginPath();
    sigCtx.arc(sigLast.x, sigLast.y, 1.3, 0, Math.PI * 2);
    sigCtx.fillStyle = '#12233b';
    sigCtx.fill();
    sigDirty = true;
    updateSigDone();
    if (sigCanvas.setPointerCapture && e.pointerId != null) {
      try { sigCanvas.setPointerCapture(e.pointerId); } catch {}
    }
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
  // Photos live inline in the Firestore document, which is capped at ~1 MB.
  // Keep the whole document (all photos + fields + signatures) under this, and
  // no single photo above the per-photo ceiling, so uploads always fit.
  const DOC_BUDGET = 850 * 1024;    // headroom under Firestore's 1 MB doc limit
  const PHOTO_MAX  = 320 * 1024;    // largest a single stored photo may be
  const PHOTO_FLOOR = 70 * 1024;    // if less room than this remains, stop adding

  // Byte size of a data: URI's payload.
  function dataUrlBytes(u) {
    const i = u.indexOf(',');
    const b64 = i >= 0 ? u.slice(i + 1) : u;
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor(b64.length * 3 / 4) - pad;
  }
  function receiptsBytes() { return state.receipts.reduce((n, r) => n + dataUrlBytes(r), 0); }

  // Compress an image, stepping quality/size down until it fits maxBytes.
  async function compressToLimit(file, maxBytes) {
    const steps = [[1100, 0.6], [1100, 0.5], [1000, 0.48], [900, 0.45],
                   [800, 0.42], [700, 0.4], [600, 0.38], [500, 0.36]];
    let out = await compressImage(file, steps[0][0], steps[0][1]);
    for (let i = 1; i < steps.length && dataUrlBytes(out) > maxBytes; i++) {
      out = await compressImage(file, steps[i][0], steps[i][1]);
    }
    return out;
  }

  async function handleFiles(files) {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!list.length) return;
    let added = 0, blocked = false;
    for (const file of list) {
      const remaining = DOC_BUDGET - receiptsBytes();
      if (remaining < PHOTO_FLOOR) { blocked = true; break; }
      let dataURL;
      try { dataURL = await compressToLimit(file, Math.min(PHOTO_MAX, remaining)); }
      catch { continue; }
      // Only reject for room if there's already at least one photo saved.
      if (dataUrlBytes(dataURL) > remaining && state.receipts.length) { blocked = true; break; }
      state.receipts.push(dataURL);
      $('#receiptsCard').classList.remove('is-invalid');
      renderReceipts();
      saveDraft();
      added++;
    }
    if (added) toast(added === 1 ? 'Receipt added' : added + ' receipts added');
    if (blocked) toast('Storage limit reached for this form — remove a photo to add more');
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
    if (formMode === 'documents') renderStageActions();  // enable/disable Submit documents
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
        const st = (d.fields && d.fields.status) || '';
        if (st && st !== 'create') { formMode = st; if (form.elements['status']) form.elements['status'].value = st; showDetails(); }
        else resumeStage();   // land on the right question / details step
      }
    } catch {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

  /* ================================================================
     Reset / new
     ================================================================ */
  function resetForm(toastMsg = true) {
    form.reset();                 // no radio defaults — the wizard requires a choice
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
     Queue view (workflow buckets)
     ================================================================ */
  function queueCard(r) {
    const f = r.fields || {};
    const amt = f.amount ? '₱' + Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—';
    const date = f.activityDate || (r.createdAt ? r.createdAt.slice(0, 10) : '');
    const card = document.createElement('div');
    card.className = 'hcard';
    card.dataset.act = 'stage';
    card.dataset.id = r.id;
    card.innerHTML = `
      <div class="hcard__body">
        <div class="hcard__top">
          <span class="hcard__payee">${escapeHtml(f.payee || 'Untitled')}</span>
          <span class="hcard__amount">${amt}</span>
        </div>
        <div class="hcard__meta">${escapeHtml([f.txnType, f.category, date].filter(Boolean).join(' · '))}</div>
        ${f.purpose ? `<div class="hcard__meta">${escapeHtml(f.purpose)}</div>` : ''}
      </div>
      <span class="hcard__chev">›</span>`;
    return card;
  }

  function renderQueue() {
    const recs = loadRecords();
    const mount = $('#queueList');
    const groups = ['withdrawal', 'acknowledgement', 'documents', 'approval', 'recording'];
    const total = recs.filter(r => groups.includes(r.status || 'withdrawal')).length;
    $('#queueEmpty').hidden = total !== 0;
    mount.hidden = total === 0;
    mount.innerHTML = '';
    if (total === 0) return;
    groups.forEach(st => {
      const items = recs.filter(r => (r.status || 'withdrawal') === st);
      const sec = document.createElement('div');
      sec.className = 'queue-group';
      let totalHtml = '';
      if (st === 'withdrawal' && items.length) {
        const total = items.reduce((sum, r) => sum + (parseFloat(r.fields && r.fields.amount) || 0), 0);
        totalHtml = `<span class="queue-total">₱${total.toLocaleString(undefined, { minimumFractionDigits: 2 })} to withdraw</span>`;
      }
      sec.innerHTML = `<div class="queue-head">${STATUS_LABEL[st]} <span class="queue-count">${items.length}</span>${totalHtml}</div>`;
      const list = document.createElement('div');
      list.className = 'history-list';
      if (!items.length) list.innerHTML = '<div class="queue-empty">None</div>';
      else items.forEach(r => list.appendChild(queueCard(r)));
      sec.appendChild(list);
      mount.appendChild(sec);
    });
  }

  /* ================================================================
     History view
     ================================================================ */
  function renderHistory(filter = '') {
    // History holds only completed (recorded) transactions.
    const recs = loadRecords().filter(r => (r.status || 'withdrawal') === 'done');
    const list = $('#historyList');
    const empty = $('#historyEmpty');
    const q = filter.trim().toLowerCase();
    const filtered = q ? recs.filter(r => {
      const f = r.fields || {};
      return [f.txnNo, f.payee, f.unit, f.purpose, f.txnType, f.category]
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
      const amt = f.amount ? '₱' + Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—';
      const date = f.activityDate || (r.createdAt ? r.createdAt.slice(0, 10) : '');
      const docs = (r.receipts || []);
      const docThumbs = docs.length
        ? `<div class="hcard__docs">${docs.map((src, i) =>
            `<button type="button" class="hdoc" data-act="doc" data-id="${r.id}" data-i="${i}"><img src="${src}" alt="Document ${i + 1}"></button>`
          ).join('')}</div>`
        : '';
      const card = document.createElement('div');
      card.className = 'hcard';
      card.innerHTML = `
        <div class="hcard__body">
          <div class="hcard__top">
            <span class="hcard__payee">${escapeHtml(f.payee || 'Untitled')}</span>
            <span class="hcard__amount">${amt}</span>
          </div>
          ${f.txnNo ? `<div class="hcard__txnno">${escapeHtml(f.txnNo)}</div>` : ''}
          <div class="hcard__meta">${escapeHtml(f.unit || '')}${f.unit && date ? ' · ' : ''}${escapeHtml(date)}${f.purpose ? ' · ' + escapeHtml(f.purpose) : ''}</div>
          <div class="hcard__tags">
            <span class="tag tag--type">${escapeHtml(STATUS_LABEL[r.status || 'withdrawal'] || '')}</span>
            ${f.txnType ? `<span class="tag">${escapeHtml(f.txnType)}</span>` : ''}
            ${f.category ? `<span class="tag tag--cat">${escapeHtml(f.category)}</span>` : ''}
            ${docs.length ? `<span class="tag"><svg class="tag__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> ${docs.length}</span>` : ''}
          </div>
          ${docThumbs}
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

  function historyAction(act, id, idx) {
    const recs = loadRecords();
    const rec = recs.find(r => r.id === id);
    if (!rec && act !== 'del') return;
    switch (act) {
      case 'open':
      case 'stage':
        openStage(id);
        break;
      case 'doc':
        openDocViewer(rec.receipts || [], parseInt(idx, 10) || 0);
        break;
      case 'preview':
        applyRecord(rec);
        state.editingId = id;
        showPreview();
        break;
      case 'dup': {
        applyRecord(rec);
        state.editingId = null;
        if (form.elements['status']) form.elements['status'].value = '';
        if (form.elements['txnNo']) form.elements['txnNo'].value = '';
        if (form.elements['txnSeq']) form.elements['txnSeq'].value = '';
        formMode = 'create';
        switchTab('form');
        showDetails();
        toast('Duplicated — submit to keep');
        break;
      }
      case 'del':
        if (confirm('Delete this form?')) {
          saveRecords(recs.filter(r => r.id !== id));
          renderHistory($('#historySearch').value);
          if (window.Cloud && window.Cloud.enabled) {
            window.Cloud.remove(id).catch(err => console.error('Cloud delete failed', err));
          }
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
    $('#viewQueue').hidden = tab !== 'queue';
    $('#viewHistory').hidden = tab !== 'history';
    $('#viewPreview').hidden = true;
    $('#previewActions').hidden = true;
    $('#tabbar').hidden = false;
    $('#btnBack').hidden = true;
    $('#btnNew').hidden = false;
    $('#btnShare').hidden = true;   // shown again by the form stage if applicable
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
    $('#topbarTitle').textContent = tab === 'history' ? 'History' : tab === 'queue' ? 'Queue' : 'Payment Approval';
    if (tab === 'form') applyFormStage();
    else $('#formActions').hidden = true;
    if (tab === 'queue') renderQueue();
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
    $('#btnShare').hidden = false;
    $('#topbarTitle').textContent = 'Preview';
    window.scrollTo(0, 0);
  }

  function backFromPreview() { switchTab(currentTab); }

  /* ================================================================
     Preview / printable PAF replica
     ================================================================ */
  function money(v) { return v ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''; }
  function fmtDate(v) { return v || ''; }

  /* Overlay coordinate system — base is the form image: 1260 × 1100 px.
     Positions below are in those pixels; converted to % so the overlay
     scales to any width (screen, print, PNG). */
  const BW = 1260, BH = 1570;
  const px = n => (n / BW * 100);
  const py = n => (n / BH * 100);

  // Absolutely-positioned text (x,y = top-left in base px)
  function T(x, y, text, opt = {}) {
    if (text == null || text === '') return '';
    const cls = 'pf-t' + (opt.bold ? ' pf-b' : '') + (opt.sm ? ' pf-sm' : '');
    const w = opt.w ? `max-width:${px(opt.w)}%;` : '';
    const align = opt.center ? 'text-align:center;transform:translateX(-50%);' : '';
    return `<span class="${cls}" style="left:${px(x)}%;top:${py(y)}%;${w}${align}">${escapeHtml(text)}</span>`;
  }
  // Checkbox ✕ centred on (cx,cy)
  function K(cx, cy, on) {
    return on ? `<span class="pf-x" style="left:${px(cx)}%;top:${py(cy)}%">✕</span>` : '';
  }
  // Signature image resting on a line: box (x,y,w,h) in base px
  function S(key, x, y, w, h) {
    const d = state.signatures[key];
    if (!d) return '';
    return `<span class="pf-sig" style="left:${px(x)}%;top:${py(y)}%;width:${px(w)}%;height:${py(h)}%">
      <img src="${d}" alt="signature"></span>`;
  }

  function buildPreviewHTML(rec) {
    const f = rec.fields;
    const isFO = f.category === 'Fast Offering';
    let o = '';

    // --- transaction type checkboxes ---
    o += K(259, 188, f.txnType === 'Swipe');
    o += K(487, 188, f.txnType === 'Reimbursement');
    o += K(779, 188, f.txnType === 'Cash Advance');

    // --- row 1 ---
    o += T(40, 230, f.unit || 'Kalayaan Ward', { bold: true });
    o += T(610, 238, fmtDate(f.activityDate));
    o += T(905, 236, f.amount ? '₱' + money(f.amount) : '', { bold: true });

    // --- payee + category ---
    o += T(40, 296, f.payee, { bold: true, w: 540 });
    o += K(631, 304, f.category === 'Budget');
    o += K(731, 304, f.category === 'Fast Offering');
    o += K(866, 304, f.category === 'Other');

    // --- purpose ---
    o += T(40, 356, f.purpose, { w: 545, sm: true });

    // --- fast offering ---
    if (isFO) {
      const foSet = (f.foType || '').split(',').map(s => s.trim());
      o += K(620, 398, foSet.includes('Food'));
      o += K(711, 398, foSet.includes('Medical'));
      o += K(799, 398, foSet.includes('Short-Term Shelter (Housing)'));
      o += K(1018, 398, foSet.includes('Utilities'));
      o += K(1101, 398, foSet.includes('Other'));
      o += T(730, 421, f.foRecipient, { w: 300 });
      o += T(1050, 421, f.foMRN, { w: 170 });
      o += S('foMember', 725, 452, 360, 40);
    }

    // --- requestor ---
    o += T(45, 516, f.requestorName, { sm: true, w: 200 });
    o += S('requestor', 250, 508, 170, 44);
    o += T(485, 510, fmtDate(f.requestorDate));

    // --- approvers ---
    o += T(45, 608, f.approver1Name, { sm: true, w: 200 });
    o += S('approver1', 250, 600, 170, 44);
    o += T(485, 624, fmtDate(f.approver1Date));
    o += T(615, 608, f.approver2Name, { sm: true, w: 200 });
    o += S('approver2', 820, 600, 170, 44);
    o += T(1050, 624, fmtDate(f.approver2Date));

    // --- reimbursement / generic acknowledgement (uses the reimbursement line) ---
    if (f.txnType === 'Reimbursement') {
      o += T(48, 706, f.reimburseName, { sm: true, w: 330 });
      o += S('reimburse', 45, 720, 340, 22);
      o += T(615, 695, fmtDate(f.reimburseDate));
    } else if (rec.signatures && rec.signatures.acknowledge) {
      o += T(48, 706, f.ackName, { sm: true, w: 330 });
      o += S('acknowledge', 45, 720, 340, 22);
      o += T(615, 695, fmtDate(f.ackDate));
    }

    // --- cash advance ---
    if (f.txnType === 'Cash Advance') {
      o += T(44, 822, f.caReceiveName, { sm: true, w: 300 });
      o += S('caReceive', 40, 836, 320, 20);
      o += T(470, 806, fmtDate(f.caReceiveDate), { sm: true });
      o += T(1018, 822, money(f.amount), { bold: true });
      // excess-cash rows only when the transaction has excess cash
      if (f.withExcess === 'on') {
        o += T(44, 882, f.caReturnName, { sm: true, w: 300 });
        o += S('caReturn', 40, 896, 320, 20);
        o += T(470, 866, fmtDate(f.caReturnDate), { sm: true });
        o += T(1018, 884, money(f.caSpent), { bold: true });
        o += T(44, 942, f.caBishopName, { sm: true, w: 300 });
        o += S('caBishop', 40, 956, 320, 18);
        o += T(470, 926, fmtDate(f.caBishopDate), { sm: true });
        o += T(1018, 946, money(f.caExcess), { bold: true });
      }
    }

    // (Clerk-use-only boxes are left blank — filled in by the clerk.)

    const receipts = (rec.receipts || []).map((src, i) =>
      `<figure class="pf-receipt"><img src="${src}" alt="receipt ${i + 1}"><figcaption>Receipt ${i + 1}</figcaption></figure>`
    ).join('');

    const txnTag = f.txnNo ? `<span class="pf-txnno">${escapeHtml(f.txnNo)}</span>` : '';

    return `
      <div class="paf-sheet" id="pafSheet">
        <div class="paf-fill">
          <img class="paf-bg" src="assets/paf-form.jpg" alt="Payment Approval Form" crossorigin="anonymous">
          ${txnTag}
          ${o}
        </div>
      </div>
      ${receipts ? `<div class="paf-receipts"><h4>Supporting documents / receipts</h4><div class="paf-receipts-grid">${receipts}</div></div>` : ''}`;
  }

  /* ================================================================
     Export: Print + PNG
     ================================================================ */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Load an image (data: or remote URL) and return its dataURL + pixel size.
  function imgToData(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        let data = src;
        try { data = c.toDataURL('image/jpeg', 0.92); } catch {}
        resolve({ data, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Save a blob to the device. Prefers the share sheet (so phones can save
  // straight to the photo gallery); falls back to a file download.
  async function shareOrDownloadBlob(blob, filename, okMsg) {
    const type = blob.type || 'application/octet-stream';
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user cancelled the sheet
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    if (okMsg) toast(okMsg);
  }

  // Fetch any image src into a blob and save it (to gallery where possible).
  async function saveImageToGallery(src, filename) {
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      await shareOrDownloadBlob(blob, filename, 'Saved');
    } catch (e) {
      toast('Could not save — long-press the image to save it');
    }
  }

  // Open a rendered PDF of the current form (form sheet + one page per receipt).
  async function doPdf() {
    const sheet = $('#pafSheet .paf-fill');
    if (!sheet) return;
    toast('Building PDF…');
    try {
      if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;
      const scale = Math.max(1.5, (BW / (sheet.offsetWidth || BW)) * 1.4);
      const canvas = await window.html2canvas(sheet, { scale, backgroundColor: '#fff', useCORS: true });
      const pdf = new jsPDF({ orientation: canvas.width >= canvas.height ? 'l' : 'p', unit: 'pt', format: [canvas.width, canvas.height] });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, canvas.width, canvas.height);
      // supporting documents — one per page
      const receipts = collect().receipts || [];
      for (const src of receipts) {
        try {
          const im = await imgToData(src);
          pdf.addPage([im.w, im.h], im.w >= im.h ? 'l' : 'p');
          pdf.addImage(im.data, 'JPEG', 0, 0, im.w, im.h);
        } catch {}
      }
      const f = collect().fields;
      const name = ('PAF_' + (f.txnNo || f.payee || 'form')).replace(/[^a-z0-9_\-]+/gi, '_') + '.pdf';
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');            // open the PDF itself
      if (!win) await shareOrDownloadBlob(blob, name, 'PDF ready');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast('PDF needs internet — opening print instead');
      window.print();
    }
  }

  async function doPng() {
    const sheet = $('#pafSheet .paf-fill');
    if (!sheet) return;
    toast('Rendering image…');
    try {
      if (!window.html2canvas) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      }
      // render at the form's native resolution (1260px) regardless of screen size
      const scale = Math.max(1.5, (BW / (sheet.offsetWidth || BW)) * 1.6);
      const canvas = await window.html2canvas(sheet, { scale, backgroundColor: '#fff', useCORS: true });
      const f = collect().fields;
      const name = ('PAF_' + (f.txnNo || f.payee || 'form') + '_' + (f.activityDate || todayISO()))
        .replace(/[^a-z0-9_\-]+/gi, '_');
      canvas.toBlob(blob => { shareOrDownloadBlob(blob, name + '.png', 'Image saved'); }, 'image/png');
    } catch (e) {
      toast('Image export needs internet — use Open PDF');
    }
  }

  /* ================================================================
     Document viewer (History)
     ================================================================ */
  const docState = { list: [], idx: 0 };
  function openDocViewer(list, idx) {
    docState.list = list || [];
    if (!docState.list.length) { toast('No documents attached'); return; }
    docState.idx = Math.max(0, Math.min(idx || 0, docState.list.length - 1));
    $('#docModal').hidden = false;
    renderDocView();
  }
  function closeDocViewer() { $('#docModal').hidden = true; docState.list = []; }
  function renderDocView() {
    const src = docState.list[docState.idx];
    $('#docView').innerHTML = src ? `<img src="${src}" alt="Document ${docState.idx + 1}">` : '';
    $('#docModalTitle').textContent = `Document ${docState.idx + 1} of ${docState.list.length}`;
    const multi = docState.list.length > 1;
    $('#docPrev').hidden = !multi;
    $('#docNext').hidden = !multi;
    $('#docPrev').disabled = docState.idx === 0;
    $('#docNext').disabled = docState.idx === docState.list.length - 1;
  }
  function saveCurrentDoc() {
    const src = docState.list[docState.idx];
    if (src) saveImageToGallery(src, `PAF_document_${docState.idx + 1}.jpg`);
  }

  /* ================================================================
     Share a transaction via a self-contained link
     ================================================================ */
  const SHARE_MAX = 200000;  // links carry signatures; photos are left out

  function b64EncodeUnicode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64DecodeUnicode(s) { return decodeURIComponent(escape(atob(s))); }
  function toUrlSafe(b) { return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function fromUrlSafe(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return s; }

  // Encode the current transaction into a link. Photos (receipts) are never
  // put in the URL — they're too large; signatures are kept.
  function buildShareURL() {
    const rec = collect();
    const hadReceipts = (rec.receipts || []).length > 0;
    const variants = [
      { fields: rec.fields, signatures: rec.signatures },  // fields + signatures
      { fields: rec.fields },                              // fallback: fields only
    ];
    const base = location.origin + location.pathname;
    for (let i = 0; i < variants.length; i++) {
      const enc = toUrlSafe(b64EncodeUnicode(JSON.stringify({ v: 1, ...variants[i] })));
      const url = base + '#t=' + enc;
      if (url.length <= SHARE_MAX || i === variants.length - 1) {
        return { url, hadReceipts, droppedSigs: i > 0 };
      }
    }
  }

  async function shareTransaction() {
    const f = collect().fields;
    if (!f.payee && !f.amount && !f.purpose) { toast('Add transaction details first'); return; }
    const out = buildShareURL();
    const url = out.url;
    const title = 'Payment Approval' + (f.payee ? ' — ' + f.payee : '');
    const amt = f.amount ? ' (₱' + Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) + ')' : '';
    const note = out.droppedSigs ? ' — too large; signatures not included'
      : out.hadReceipts ? ' — photos not included in link' : '';

    if (navigator.share) {
      try {
        await navigator.share({ title, text: title + amt, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;   // user cancelled
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied' + note);
    } catch (e) {
      window.prompt('Copy this link:', url);
    }
  }

  // Load a shared transaction from the URL hash (#t=...). Returns true if imported.
  function importFromHash() {
    const m = (location.hash || '').match(/[#&]t=([^&]+)/);
    if (!m) return false;
    try {
      const data = JSON.parse(b64DecodeUnicode(fromUrlSafe(m[1])));
      if (data && data.fields) {
        applyRecord({ fields: data.fields, signatures: data.signatures || {}, receipts: data.receipts || [] });
        state.editingId = null;
        const st = data.fields.status;
        formMode = (st && st !== 'create') ? st : 'create';
        if (form.elements['status']) form.elements['status'].value = st || '';
        history.replaceState(null, '', location.pathname + location.search);  // don't re-import on refresh
        toast('Shared transaction loaded');
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ================================================================
     Version history  (reachable at /v<number>, e.g. /v3)
     ================================================================ */
  function renderChangelog(highlight) {
    const mount = $('#changelog');
    if (!mount) return;
    mount.innerHTML = CHANGELOG.slice().reverse().map(e => `
      <div class="changelog__item${e.v === highlight ? ' is-current' : ''}">
        <div class="changelog__v">v${e.v}${e.v === APP_VERSION ? ' <span class="changelog__badge">current</span>' : ''}</div>
        <div class="changelog__notes">${escapeHtml(e.notes)}</div>
      </div>`).join('');
  }
  function openVersionModal(focusV) {
    renderChangelog(focusV || APP_VERSION);
    $('#versionModal').hidden = false;
    const target = focusV && CHANGELOG.some(e => e.v === focusV) ? focusV : null;
    if (target) {
      const el = $('#changelog .changelog__item.is-current');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
  }
  function closeVersionModal() {
    $('#versionModal').hidden = true;
    // drop a #/v… route so refreshing doesn't reopen it
    if (/^#\/?v/i.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  // Parse #/v, #/v3, #v3 → version number (0 = no specific version).
  function versionRoute() {
    const m = (location.hash || '').match(/^#\/?v(\d+)?$/i);
    return m ? (m[1] ? parseInt(m[1], 10) : 0) : null;
  }
  function handleVersionRoute() {
    const n = versionRoute();
    if (n === null) return false;
    openVersionModal(n || APP_VERSION);
    return true;
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

  /* ================================================================
     Wire up events
     ================================================================ */
  function bind() {
    const WIZ_NAMES = ['txnType', 'category', 'foType'];
    // form input -> conditionals, draft, excess
    form.addEventListener('input', (e) => {
      if (e.target.classList) e.target.classList.remove('is-invalid');
      if (e.target.name === 'txnType' || e.target.name === 'category') updateConditionals();
      if (e.target.name === 'amount' || e.target.name === 'caSpent') computeExcess();
      if (e.target.name === 'payee') { if (formMode === 'approval') updateApproverButtons(); syncRequestorSame(); }
      saveDraft();
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'requestorSameAsPayee') syncRequestorSame();
      if (e.target.name === 'withExcess') syncCaExcess();
      if (WIZ_NAMES.includes(e.target.name)) {
        updateConditionals();
        renderSummary();
        // auto-advance single-choice questions; foType is multi-select (needs Continue)
        if (formMode === 'wizard' && e.target.name !== 'foType') {
          clearTimeout(advanceTimer);
          advanceTimer = setTimeout(resumeStage, 260);
        }
      }
      saveDraft();
    });

    // foType (multi-select) → Continue advances to details
    $('#foContinue').addEventListener('click', () => {
      if (answered('foType')) showDetails();
      else toast('Select at least one');
    });

    // wizard back + summary chips + request/approval sub-tabs
    $('#wizBack').addEventListener('click', () => {
      if (wizIndex > 0) showWizardStep(wizIndex - 1);
    });
    $('#summary').addEventListener('click', (e) => {
      const chip = e.target.closest('.sum-chip');
      if (chip) {
        const i = wizQuestions().indexOf(chip.dataset.q);
        if (i >= 0) showWizardStep(i);
      }
    });
    // Submit (create) + stage transition buttons
    $('#btnSubmitRequest').addEventListener('click', submitRequest);
    $('#btnMarkWithdrawn').addEventListener('click', markWithdrawn);
    $('#btnConfirmAck').addEventListener('click', confirmAck);
    $('#btnMarkApproved').addEventListener('click', markApproved);
    $('#btnMarkRecorded').addEventListener('click', markRecorded);
    $('#btnSubmitDocs').addEventListener('click', submitDocs);

    // Approver buttons -> choose (if needed) then sign
    $('#btnApprover1').addEventListener('click', () => startApprover(1));
    $('#btnApprover2').addEventListener('click', () => startApprover(2));

    // Choice modal close (backdrop / ✕) -> resolve as cancelled
    $$('#choiceModal [data-close]').forEach(el => el.addEventListener('click', () => {
      const m = $('#choiceModal');
      if (m._finish) m._finish(null);
    }));

    // Other date fields: open the native picker on tap
    $$('input[type="date"]').forEach(el => {
      el.addEventListener('click', () => { try { el.showPicker && el.showPicker(); } catch {} });
    });

    // Inline activity-date calendar
    refreshCalendar();
    $('#activityCal').addEventListener('click', (e) => {
      const nav = e.target.closest('[data-cal]');
      if (nav && nav.dataset.cal === 'edit') {           // reopen from collapsed
        calOpen = true;
        syncCalToValue();
        renderActivity();
        return;
      }
      if (nav) {                                          // month navigation
        if (nav.dataset.cal === 'prev') { if (--cal.m < 0) { cal.m = 11; cal.y--; } }
        else { if (++cal.m > 11) { cal.m = 0; cal.y++; } }
        renderActivity();
        return;
      }
      const day = e.target.closest('.cal-day[data-day]');
      if (day) {                                          // pick a day → collapse
        form.elements['activityDate'].value = isoOf(cal.y, cal.m, +day.dataset.day);
        calOpen = false;
        $('#activityCal').classList.remove('is-invalid');
        renderActivity();
        saveDraft();
      }
    });

    // signature pads
    initSigPads();

    // signature modal — Pointer Events (unified mouse / touch / stylus)
    if (window.PointerEvent) {
      sigCanvas.addEventListener('pointerdown', sigStart, { passive: false });
      sigCanvas.addEventListener('pointermove', sigMove, { passive: false });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => sigCanvas.addEventListener(ev, sigEnd));
    } else {
      ['mousedown', 'touchstart'].forEach(ev => sigCanvas.addEventListener(ev, sigStart, { passive: false }));
      ['mousemove', 'touchmove'].forEach(ev => sigCanvas.addEventListener(ev, sigMove, { passive: false }));
      ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => sigCanvas.addEventListener(ev, sigEnd));
    }
    window.addEventListener('resize', () => { if (!sigModal.hidden) setupCanvas(); });
    $('#sigClear').addEventListener('click', () => { setupCanvas(); sigDirty = false; });
    $('#sigDone').addEventListener('click', () => {
      const key = state.activeSig;
      if (sigDirty) {
        const data = trimmedSignature();
        if (data) {
          state.signatures[key] = data;
          // auto-fill the matching date field once a signature is added
          const dn = SIG_DATE[key];
          if (dn && form.elements[dn] && !form.elements[dn].value) {
            form.elements[dn].value = todayISO();
          }
        }
      }
      renderSignatures();
      updateApproverButtons();
      renderStageActions();
      saveDraft();
      closeSigModal();
      // Both approvers signed → auto-advance to recording.
      if (formMode === 'approval' && bothApproversSigned()) markApproved();
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

    // action bar
    $('#btnPreview').addEventListener('click', showPreview);
    $('#btnClear').addEventListener('click', () => { if (confirm('Start a new request?')) { newForm(); switchTab('form'); } });
    $('#btnPrint').addEventListener('click', doPdf);
    $('#btnPng').addEventListener('click', doPng);

    // document viewer (History)
    $('#docSave').addEventListener('click', saveCurrentDoc);
    $('#docPrev').addEventListener('click', () => { if (docState.idx > 0) { docState.idx--; renderDocView(); } });
    $('#docNext').addEventListener('click', () => { if (docState.idx < docState.list.length - 1) { docState.idx++; renderDocView(); } });
    $$('#docModal [data-close]').forEach(el => el.addEventListener('click', closeDocViewer));
    $('#btnEditFromPreview').addEventListener('click', backFromPreview);
    $('#btnBack').addEventListener('click', backFromPreview);
    $('#btnNew').addEventListener('click', () => { newForm(); switchTab('form'); });
    $('#btnShare').addEventListener('click', shareTransaction);

    // tabs
    $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('#btnEmptyNew').addEventListener('click', () => { newForm(); switchTab('form'); });
    $('#btnQueueNew').addEventListener('click', () => { newForm(); switchTab('form'); });

    // queue
    $('#queueList').addEventListener('click', (e) => {
      const card = e.target.closest('[data-act]');
      if (card) openStage(card.dataset.id);
    });

    // editable amount in a stage (before acknowledgement is signed)
    $('#stageSummary').addEventListener('input', (e) => {
      if (e.target.id === 'stageAmount') form.elements['amount'].value = e.target.value;
    });
    $('#stageSummary').addEventListener('change', (e) => {
      if (e.target.id === 'stageAmount' && state.editingId) {
        persist(form.elements['status'].value || undefined);
        toast('Amount updated');
      }
    });

    // history
    $('#historySearch').addEventListener('input', (e) => renderHistory(e.target.value));
    $('#historyList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) historyAction(btn.dataset.act, btn.dataset.id, btn.dataset.i);
    });

    // Hide the fixed bottom tab bar while a text field is focused, so the
    // keyboard doesn't push it up (it would otherwise float above the keyboard).
    const KBD_SEL = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=date]),textarea';
    document.addEventListener('focusin', (e) => {
      if (e.target.matches && e.target.matches(KBD_SEL)) document.body.classList.add('kbd-open');
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || !(a.matches && a.matches(KBD_SEL))) document.body.classList.remove('kbd-open');
      }, 60);
    });

    // pull-to-refresh (queue / history)
    document.addEventListener('touchstart', ptrOnStart, { passive: true });
    document.addEventListener('touchmove', ptrOnMove, { passive: true });
    document.addEventListener('touchend', ptrOnEnd);
    document.addEventListener('touchcancel', ptrOnEnd);

    // version history (bottom of History) + /v<n> route
    $('#historyVersion').textContent = 'v' + APP_VERSION;
    $('#historyVersion').addEventListener('click', () => openVersionModal(APP_VERSION));
    $$('#versionModal [data-close]').forEach(el => el.addEventListener('click', closeVersionModal));
    window.addEventListener('hashchange', handleVersionRoute);

    // esc closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!sigModal.hidden) closeSigModal();
      if (!$('#docModal').hidden) closeDocViewer();
      if (!$('#versionModal').hidden) closeVersionModal();
      const cm = $('#choiceModal');
      if (!cm.hidden && cm._finish) cm._finish(null);
    });
  }

  /* ================================================================
     Init
     ================================================================ */
  // Subscribe to cloud records and mirror them into the local cache.
  function setupCloud() {
    const start = () => {
      if (!window.Cloud || !window.Cloud.enabled) return;
      window.Cloud.subscribe(recs => {
        saveRecords(recs);                             // mirror to local cache
        refreshCurrentView();                          // live-update queue/history
      });
    };
    if (window.Cloud && window.Cloud.enabled) start();
    else window.addEventListener('cloud-ready', start, { once: true });
  }

  // Re-render whichever list view is showing (queue or history).
  function refreshCurrentView() {
    if (currentTab === 'queue') renderQueue();
    else if (currentTab === 'history') renderHistory($('#historySearch').value);
  }

  /* ---------- Pull to refresh (queue / history) ---------- */
  let ptrStartY = null, ptrPulling = false, ptrReady = false, ptrBusy = false;
  const PTR_TRIGGER = 66;   // px pulled to trigger a refresh

  function ptrEligible() {
    return !ptrBusy
      && (currentTab === 'queue' || currentTab === 'history')
      && window.scrollY <= 0
      && sigModal.hidden && $('#docModal').hidden
      && $('#versionModal').hidden && $('#choiceModal').hidden;
  }
  function ptrReset() {
    const ind = $('#ptr');
    ind.classList.remove('is-ready', 'is-refreshing');
    ind.style.opacity = '';
    ind.style.transform = '';
    ptrReady = false;
  }
  function ptrOnStart(e) {
    if (!ptrEligible()) { ptrStartY = null; return; }
    ptrStartY = e.touches[0].clientY;
    ptrPulling = false;
  }
  function ptrOnMove(e) {
    if (ptrStartY == null || ptrBusy) return;
    const dy = e.touches[0].clientY - ptrStartY;
    if (dy <= 0 || window.scrollY > 0) { if (ptrPulling) ptrReset(); ptrPulling = false; return; }
    ptrPulling = true;
    const pull = Math.min(dy * 0.5, 80);
    const ind = $('#ptr');
    ind.style.opacity = String(Math.min(1, pull / 36));
    ind.style.transform = `translateX(-50%) translateY(${pull}px)`;
    ptrReady = dy >= PTR_TRIGGER;
    ind.classList.toggle('is-ready', ptrReady);
  }
  function ptrOnEnd() {
    if (ptrStartY == null) return;
    const go = ptrPulling && ptrReady;
    ptrStartY = null; ptrPulling = false;
    if (go) doPullRefresh(); else ptrReset();
  }
  async function doPullRefresh() {
    ptrBusy = true;
    const ind = $('#ptr');
    ind.classList.remove('is-ready');
    ind.classList.add('is-refreshing');
    ind.style.opacity = '1';
    ind.style.transform = 'translateX(-50%) translateY(48px)';
    const started = Date.now();
    try {
      if (window.Cloud && window.Cloud.enabled && window.Cloud.refresh) {
        const recs = await window.Cloud.refresh();
        if (Array.isArray(recs)) saveRecords(recs);
      }
    } catch (e) { console.error('Refresh failed', e); }
    refreshCurrentView();
    const wait = Math.max(0, 500 - (Date.now() - started));  // keep the spinner visible briefly
    setTimeout(() => { ptrReset(); ptrBusy = false; toast('Refreshed'); }, wait);
  }

  function init() {
    bind();
    updateConditionals();
    // A shared link takes precedence over any local draft (sets formMode itself)
    if (!importFromHash()) loadDraft();
    switchTab('form');
    setupCloud();
    handleVersionRoute();   // open version history if the URL is /v<number>
  }

  document.addEventListener('DOMContentLoaded', init);
})();
