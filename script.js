// ─── PDF.JS WORKER ───────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const { PDFDocument, rgb } = PDFLib;

// ─── STATE ───────────────────────────────────────────────────────────────────
let rawBuffer = null;
let pdfJsDoc  = null;
let pdfLibDoc = null;
let numPages  = 0;
let pageInfo  = {};   // { n: { scale, origW, origH, rendW, rendH } }
let pageInners = {};  // { n: pageInnerDiv }
let fields    = [];
let hasSig    = false;
let placing   = false;
let sigDataUrlSaved = null; // last drawn signature — reused across fields

// ─── MODAL SYSTEM ────────────────────────────────────────────────────────────
function openModal(name) {
  const el = document.getElementById('modal' + cap(name));
  if (el) { el.classList.add('open'); }
}
function closeModal(name) {
  const el = document.getElementById('modal' + cap(name));
  if (el) { el.classList.remove('open'); }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
// Click backdrop closes
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => {
    if (e.target === ov) {
      const modal = ov.querySelector('[data-modal]');
      if (modal) closeModal(modal.dataset.modal);
    }
  });
});

// ─── DOCK BUTTONS ────────────────────────────────────────────────────────────
document.getElementById('dockUpload').addEventListener('click',   () => openModal('document'));
document.getElementById('dockSign').addEventListener('click',     () => openModal('signature'));
document.getElementById('dockFields').addEventListener('click',   () => { renderFieldList(); openModal('fields'); });
document.getElementById('dockPlace').addEventListener('click',    () => openModal('place'));
document.getElementById('dockDownload').addEventListener('click', handleDownload);

// ─── DOCK HORIZONTAL DRAG ─────────────────────────────────────────────────────
(function initDockDrag() {
  const dock = document.getElementById('dock');
  const handle = document.getElementById('dockHandle');
  let dragging = false, startX = 0, startTX = 0;

  function startDrag(e) {
    dragging = true;
    const src = e.touches ? e.touches[0] : e;
    startX = src.clientX;
    const cur = dock.style.transform || 'translateX(0px)';
    const match = cur.match(/translateX\((-?[\d.]+)px\)/);
    startTX = match ? parseFloat(match[1]) : 0;
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  function moveDrag(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const src = e.touches ? e.touches[0] : e;
    const dx = src.clientX - startX;
    const maxX = (window.innerWidth - dock.offsetWidth) / 2;
    const clamped = Math.max(-maxX, Math.min(maxX, startTX + dx));
    dock.style.transform = `translateX(${clamped}px)`;
  }

  function endDrag() {
    dragging = false;
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', moveDrag);
    document.removeEventListener('touchend', endDrag);
  }

  handle.addEventListener('mousedown', startDrag);
  handle.addEventListener('touchstart', startDrag, { passive: false });
})();

// ─── SIGNATURE PAD ───────────────────────────────────────────────────────────
const sigCanvas = document.getElementById('sigCanvas');
const sigCtx    = sigCanvas.getContext('2d');
let drawing = false, lx = 0, ly = 0;

function initPad() {
  const par = sigCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = par.clientWidth;
  const h = 160;
  sigCanvas.width  = Math.floor(w * dpr);
  sigCanvas.height = Math.floor(h * dpr);
  sigCanvas.style.width  = w + 'px';
  sigCanvas.style.height = h + 'px';
  sigCtx.setTransform(1,0,0,1,0,0);
  sigCtx.scale(dpr, dpr);
  sigCtx.strokeStyle = '#1c1a16';
  sigCtx.lineWidth   = 2.4;
  sigCtx.lineCap = sigCtx.lineJoin = 'round';
}

// Re-init pad whenever signature modal opens (so width is correct)
document.getElementById('modalSignature').addEventListener('transitionend', () => {
  if (document.getElementById('modalSignature').classList.contains('open')) initPad();
});

function padXY(e) {
  const r = sigCanvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return [src.clientX - r.left, src.clientY - r.top];
}
function padStart(e) {
  drawing = true;
  [lx, ly] = padXY(e);
  sigCtx.beginPath(); sigCtx.moveTo(lx, ly);
}
function padMove(e) {
  if (!drawing) return;
  if (e.cancelable) e.preventDefault();
  const [x, y] = padXY(e);
  sigCtx.lineTo(x, y); sigCtx.stroke();
  lx = x; ly = y; hasSig = true;
}
function padEnd() { drawing = false; }

sigCanvas.addEventListener('mousedown',  padStart);
sigCanvas.addEventListener('mousemove',  padMove);
sigCanvas.addEventListener('mouseup',    padEnd);
sigCanvas.addEventListener('mouseleave', padEnd);
sigCanvas.addEventListener('touchstart', padStart, { passive: false });
sigCanvas.addEventListener('touchmove',  padMove,  { passive: false });
sigCanvas.addEventListener('touchend',   padEnd);

document.getElementById('btnClear').addEventListener('click', () => {
  const dpr = window.devicePixelRatio || 1;
  sigCtx.clearRect(0, 0, sigCanvas.width / dpr, sigCanvas.height / dpr);
  hasSig = false;
  sigDataUrlSaved = null;
  updateSigBadge();
});

// "Use this signature" — saves it and closes modal
document.getElementById('btnUseSig').addEventListener('click', () => {
  if (!hasSig) { toast('Draw your signature first!'); return; }
  sigDataUrlSaved = sigCanvas.toDataURL('image/png');
  updateSigBadge();
  closeModal('signature');
  toast('Signature saved — tap any field on the document to sign it.');
});

function updateSigBadge() {
  const badge = document.getElementById('dockSigBadge');
  if (sigDataUrlSaved) {
    badge.style.display = '';
    badge.classList.add('green');
    badge.textContent = '✓';
  } else {
    badge.style.display = 'none';
  }
}

// ─── FILE UPLOAD ─────────────────────────────────────────────────────────────
// Main drop overlay (full-screen when no PDF loaded)
const dropOverlay = document.getElementById('dropOverlay');
const fileInputMain = document.getElementById('fileInput');
dropOverlay.addEventListener('dragover',  e => { e.preventDefault(); dropOverlay.classList.add('over'); });
dropOverlay.addEventListener('dragleave', ()=> dropOverlay.classList.remove('over'));
dropOverlay.addEventListener('drop', e => {
  e.preventDefault(); dropOverlay.classList.remove('over');
  tryLoad(e.dataTransfer.files[0]);
});
fileInputMain.addEventListener('change', e => tryLoad(e.target.files[0]));

// Modal dropzone
const dropzoneModal = document.getElementById('dropzone');
const fileInput2    = document.getElementById('fileInput2');
dropzoneModal.addEventListener('dragover',  e => { e.preventDefault(); dropzoneModal.classList.add('over'); });
dropzoneModal.addEventListener('dragleave', ()=> dropzoneModal.classList.remove('over'));
dropzoneModal.addEventListener('drop', e => {
  e.preventDefault(); dropzoneModal.classList.remove('over');
  tryLoad(e.dataTransfer.files[0]);
});
fileInput2.addEventListener('change', e => tryLoad(e.target.files[0]));

document.getElementById('fcChg').addEventListener('click', () => { fileInput2.value = ''; fileInput2.click(); });

function tryLoad(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('Please upload a PDF file only.'); return;
  }
  closeModal('document');
  loadFile(file);
}

async function loadFile(file) {
  setStatus('scanning', 'Loading…');
  prog(10);
  const reader = new FileReader();
  reader.onerror = () => toast('Failed to read the file.');
  reader.onload = async ev => {
    try {
      rawBuffer = ev.target.result.slice(0);
      prog(30);

      pdfJsDoc  = await pdfjsLib.getDocument({ data: new Uint8Array(rawBuffer.slice(0)) }).promise;
      numPages  = pdfJsDoc.numPages;
      prog(55);

      pdfLibDoc = await PDFDocument.load(new Uint8Array(rawBuffer.slice(0)));
      prog(70);

      // Update file card
      document.getElementById('fcName').textContent = file.name;
      document.getElementById('fcMeta').textContent =
        `${numPages} page${numPages>1?'s':''} · ${(file.size/1024).toFixed(0)} KB`;
      document.getElementById('fileCard').classList.add('show');
      document.getElementById('dropzone').style.display = 'none';

      // Update dock badge
      const fb = document.getElementById('dockFileBadge');
      fb.style.display = ''; fb.textContent = '✓'; fb.classList.add('green');

      // Hide full-screen drop overlay
      dropOverlay.style.display = 'none';
      document.getElementById('pagesContainer').style.display = 'flex';

      fields = [];
      await renderPages();
      prog(85);
      await scanFields();
      prog(100);
      setTimeout(hideProg, 700);

    } catch (err) {
      console.error('PDF load error:', err);
      toast('Could not parse PDF. Make sure it is a valid, non-password-protected PDF.');
      setStatus('', 'No document');
      hideProg();
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── RENDER PAGES ─────────────────────────────────────────────────────────────
async function renderPages() {
  const container = document.getElementById('pagesContainer');
  container.innerHTML = '';
  pageInners = {};
  pageInfo   = {};

  const viewer = document.getElementById('viewer');
  const availW = viewer.clientWidth - 32; // 1rem padding each side

  for (let p = 1; p <= numPages; p++) {
    const page = await pdfJsDoc.getPage(p);
    const vp1  = page.getViewport({ scale: 1 });
    const scale = Math.min(availW / vp1.width, 1.8);
    const vp   = page.getViewport({ scale });

    pageInfo[p] = {
      scale,
      origW: vp1.width, origH: vp1.height,
      rendW: vp.width,  rendH: vp.height
    };

    const wrap  = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = vp.width + 'px';

    const inner = document.createElement('div');
    inner.className = 'page-inner';
    inner.style.cssText = `position:relative;width:${vp.width}px;height:${vp.height}px;`;
    inner.dataset.page  = p;

    const canvas = document.createElement('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    inner.appendChild(canvas);
    wrap.appendChild(inner);

    const lbl = document.createElement('div');
    lbl.className   = 'page-lbl';
    lbl.textContent = `Page ${p} of ${numPages}`;
    wrap.appendChild(lbl);

    container.appendChild(wrap);
    pageInners[p] = inner;

    // Click for manual placement
    inner.addEventListener('click', e => {
      if (!placing) return;
      const r  = inner.getBoundingClientRect();
      const rx = e.clientX - r.left;
      const ry = e.clientY - r.top;
      const { scale, origH } = pageInfo[p];
      addField({
        name: 'Signature', page: p,
        x: rx / scale - 90,
        y: origH - (ry / scale) - 22,
        width: 180, height: 44,
        isManual: true, signed: false
      });
      exitPlace();
    });
  }

  setStatus('active', `${numPages} page${numPages>1?'s':''} loaded`);
}

// ─── SCAN FIELDS ─────────────────────────────────────────────────────────────
async function scanFields() {
  const badge = document.getElementById('scanBadge');
  badge.className = 'scan-badge scanning show';
  badge.innerHTML = '<b>🔍 Scanning…</b>Looking for signature fields.';

  let found = 0;

  // Pass A: AcroForm
  try {
    const form  = pdfLibDoc.getForm();
    const flds  = form.getFields();
    const pages = pdfLibDoc.getPages();
    for (const fld of flds) {
      const name = fld.getName() || '';
      const type = fld.constructor.name;
      if (!(type === 'PDFSignature' || /sign|sig|initia|author/i.test(name))) continue;
      for (const w of fld.acroField.getWidgets()) {
        const rect = w.getRectangle();
        const pref = w.P();
        let pg = 1;
        if (pref) for (let i = 0; i < pages.length; i++) if (pages[i].ref === pref) { pg = i+1; break; }
        addField({
          name, page: pg,
          x: rect.x, y: rect.y,
          width: Math.max(rect.width, 120), height: Math.max(rect.height, 30),
          isAcroForm: true, signed: false
        });
        found++;
      }
    }
  } catch(_) {}

  // Pass B: text keyword scan
  const labelPatterns = [
    /^sign(ed|ature)?(\s+by)?[\s:_]*$/i,
    /^sig[\s:_]+$/i,
    /^initial(s)?[\s:_]*$/i,
    /^authorized\s+by[\s:_]*$/i,
    /^witness[\s:_]*$/i,
  ];
  const phrasePatterns = [
    /sign\s+here/i,
    /applicant.{0,4}sign/i,
    /employee.{0,4}sign/i,
    /customer.{0,4}sign/i,
    /signature\s+of/i,
    /your\s+sign/i,
  ];

  for (let p = 1; p <= numPages; p++) {
    const page    = await pdfJsDoc.getPage(p);
    const content = await page.getTextContent();
    const { origH } = pageInfo[p];
    const items   = content.items;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const raw  = (item.str || '').trim();
      if (!raw) continue;

      const isLabel  = labelPatterns.some(re  => re.test(raw));
      const isPhrase = phrasePatterns.some(re => re.test(raw));
      if (!isLabel && !isPhrase) continue;

      const tx = item.transform[4];
      const ty = item.transform[5];
      const tw = item.width  || 0;
      const th = item.height || 12;

      if (fields.some(f => f.page===p && Math.abs(f.x-tx)<100 && Math.abs(f.y-ty)<50)) continue;

      let sigX, sigW;
      if (isLabel) {
        sigX = tx + tw + 4;
        let lineW = 180;
        for (let j = idx+1; j < Math.min(idx+5, items.length); j++) {
          const next  = items[j];
          const nextY = next.transform[5];
          if (Math.abs(nextY - ty) > 4) break;
          const nextStr = (next.str || '').trim();
          if (/^[_\-\s]+$/.test(nextStr) || nextStr === '') {
            lineW = Math.max(next.width || 120, 120); break;
          }
          if (nextStr.length > 2) break;
        }
        sigW = Math.max(lineW, 140);
      } else {
        sigX = tx;
        sigW = Math.max(tw * 1.5, 180);
      }

      const sigY = ty - 4;
      const sigH = Math.max(th + 10, 36);

      addField({
        name: raw, page: p,
        x: sigX, y: sigY,
        width: sigW, height: sigH,
        isTextDetected: true, signed: false
      });
      found++;
    }
  }

  // Update scan badge (in the document modal)
  if (found > 0) {
    badge.className = 'scan-badge ok show';
    badge.innerHTML = `<b>✓ ${found} field${found>1?'s':''} detected</b>Click any field overlay to sign it.`;
  } else {
    badge.className = 'scan-badge warn show';
    badge.innerHTML = '<b>⚠ No fields detected</b>Use "Place" in the dock to add one manually.';
  }

  updateFieldsBadge();
}

// ─── FIELD MANAGEMENT ────────────────────────────────────────────────────────
function addField(f) {
  fields.push(f);
  renderFieldList();
  renderOverlays();
  updateFieldsBadge();
}

function updateFieldsBadge() {
  const badge = document.getElementById('dockFieldsBadge');
  const total  = fields.length;
  const signed = fields.filter(f => f.signed).length;
  if (total === 0) {
    badge.textContent = '0';
    badge.classList.remove('green');
  } else if (signed === total) {
    badge.textContent = '✓';
    badge.classList.add('green');
  } else {
    badge.textContent = total - signed;
    badge.classList.remove('green');
  }
}

function renderFieldList() {
  const list = document.getElementById('fieldList');
  if (!fields.length) {
    list.innerHTML = '<div class="field-empty">No fields yet.<br>Upload a PDF or place one manually.</div>';
    checkDone(); return;
  }
  list.innerHTML = '';
  fields.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'fi' + (f.signed ? ' signed' : '');
    el.innerHTML = `
      <div class="fi-dot"></div>
      <span class="fi-name" title="${f.name}">${f.name}</span>
      <span class="fi-pg">Pg ${f.page}</span>
      <span class="fi-tag">${f.signed ? '✓ Signed' : f.isAcroForm ? 'Form' : f.isTextDetected ? 'Auto' : 'Manual'}</span>
    `;
    if (!f.signed) {
      el.addEventListener('click', () => {
        closeModal('fields');
        // Scroll to that field's page
        const inner = pageInners[f.page];
        if (inner) inner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Apply if signature ready
        setTimeout(() => applyField(i), 300);
      });
    }
    list.appendChild(el);
  });
  checkDone();
}

function renderOverlays() {
  document.querySelectorAll('.sig-ol').forEach(el => el.remove());
  fields.forEach((f, i) => {
    const inner = pageInners[f.page];
    if (!inner) return;
    const { scale, rendH } = pageInfo[f.page];
    const px = Math.max(f.x * scale, 0);
    const py = Math.max(rendH - (f.y + f.height) * scale, 0);
    const pw = Math.max(f.width  * scale, 80);
    const ph = Math.max(f.height * scale, 28);

    const el = document.createElement('div');
    el.className = 'sig-ol' + (f.signed ? ' signed' : '');
    el.style.cssText = `left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;`;

    const innerWrap = document.createElement('div');
    innerWrap.className = 'sig-ol-inner';

    if (f.signed && f.sigDataUrl) {
      const img = document.createElement('img');
      img.src = f.sigDataUrl;
      innerWrap.appendChild(img);
    } else {
      const lbl = document.createElement('div');
      lbl.className   = 'sig-ol-lbl';
      lbl.textContent = '✍ Click to sign';
      innerWrap.appendChild(lbl);
    }
    el.appendChild(innerWrap);

    // Drag handle
    const handle = document.createElement('div');
    handle.className   = 'sig-ol-handle';
    handle.title       = 'Drag to reposition';
    handle.textContent = '⠿';
    el.appendChild(handle);

    // Delete button
    const del = document.createElement('button');
    del.className   = 'sig-ol-del';
    del.textContent = '×';
    del.title       = 'Remove field';
    del.addEventListener('click', e => {
      e.stopPropagation();
      fields.splice(i, 1);
      renderFieldList(); renderOverlays(); updateFieldsBadge();
    });
    el.appendChild(del);

    // Drag tip
    const tip = document.createElement('div');
    tip.className   = 'drag-tip';
    tip.textContent = 'Drag to reposition';
    el.appendChild(tip);

    makeDraggable(el, i, inner);

    // Click to sign
    if (!f.signed) {
      el.addEventListener('click', e => {
        if (el.dataset.dragged === '1') { el.dataset.dragged = '0'; return; }
        applyField(i);
      });
    }

    inner.appendChild(el);
  });
}

function makeDraggable(el, fieldIndex, pageInner) {
  let startX, startY, startLeft, startTop, dragging = false;

  function onStart(e) {
    if (e.target.classList.contains('sig-ol-del')) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    el.dataset.dragged = '0';

    const src = e.touches ? e.touches[0] : e;
    startX    = src.clientX;
    startY    = src.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop  = parseFloat(el.style.top)  || 0;

    el.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onEnd);
  }

  function onMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const src = e.touches ? e.touches[0] : e;
    const dx = src.clientX - startX;
    const dy = src.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) el.dataset.dragged = '1';

    const pageW = pageInner.offsetWidth;
    const pageH = pageInner.offsetHeight;
    const elW   = el.offsetWidth;
    const elH   = el.offsetHeight;

    const newLeft = Math.max(0, Math.min(startLeft + dx, pageW - elW));
    const newTop  = Math.max(0, Math.min(startTop  + dy, pageH - elH));

    el.style.left = newLeft + 'px';
    el.style.top  = newTop  + 'px';
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);

    if (el.dataset.dragged !== '1') return;

    const newLeft = parseFloat(el.style.left) || 0;
    const newTop  = parseFloat(el.style.top)  || 0;
    const { scale, rendH } = pageInfo[fields[fieldIndex].page];
    const elH = el.offsetHeight;

    fields[fieldIndex].x = newLeft / scale;
    fields[fieldIndex].y = (rendH - newTop - elH) / scale;

    if (fields[fieldIndex].signed) renderOverlays();
    toast('Position saved.');
  }

  el.addEventListener('mousedown',  onStart);
  el.addEventListener('touchstart', onStart, { passive: false });
}

// ─── APPLY SIGNATURE TO FIELD ─────────────────────────────────────────────────
// Uses sigDataUrlSaved (committed via "Use this signature") OR live canvas
function applyField(i) {
  // Prefer committed signature; fall back to live canvas
  const dataUrl = sigDataUrlSaved || (hasSig ? sigCanvas.toDataURL('image/png') : null);

  if (!dataUrl) {
    toast('Draw your signature first — tap ✍ in the dock.');
    openModal('signature');
    return;
  }

  fields[i].signed    = true;
  fields[i].sigDataUrl = dataUrl;

  // Auto-save if not already saved (so further fields reuse it)
  if (!sigDataUrlSaved && hasSig) {
    sigDataUrlSaved = dataUrl;
    updateSigBadge();
  }

  renderFieldList();
  renderOverlays();
  updateFieldsBadge();

  const inner = pageInners[fields[i].page];
  if (inner) inner.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const remaining = fields.filter(f => !f.signed).length;
  toast(remaining === 0
    ? '🎉 All fields signed! Tap ⬇ to download.'
    : `Signed ✓  ${remaining} field${remaining>1?'s':''} remaining.`
  );
}

function checkDone() {
  const done = fields.length > 0 && fields.every(f => f.signed);
  document.getElementById('dockDownload').disabled = !done;
  document.getElementById('signedBanner').classList.toggle('show', done);
  if (done) {
    const db = document.getElementById('dockDownload');
    db.querySelector('.dock-icon').textContent = '🎉';
  }
}

// ─── MANUAL PLACEMENT ────────────────────────────────────────────────────────
document.getElementById('btnStartPlace').addEventListener('click', () => {
  placing = true;
  document.getElementById('viewer').classList.add('placing');
  document.getElementById('manualTip').classList.add('show');
  document.getElementById('btnStartPlace').style.display = 'none';
  const hint = document.getElementById('placingHint');
  hint.classList.add('show');
  closeModal('place');
  toast('Click anywhere on the document to place a field.');
});

document.getElementById('btnCancelPlace').addEventListener('click', exitPlace);
document.getElementById('cancelPlaceTxt').addEventListener('click', exitPlace);

function exitPlace() {
  placing = false;
  document.getElementById('viewer').classList.remove('placing');
  document.getElementById('manualTip').classList.remove('show');
  document.getElementById('btnStartPlace').style.display = '';
  document.getElementById('placingHint').classList.remove('show');
}

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────
async function handleDownload() {
  const btn = document.getElementById('dockDownload');
  btn.disabled = true;
  btn.querySelector('.dock-label').textContent = 'Building…';

  try {
    const outDoc = await PDFDocument.load(new Uint8Array(rawBuffer.slice(0)));
    try { outDoc.getForm().flatten(); } catch(_) {}

    const pages = outDoc.getPages();

    for (const f of fields) {
      if (!f.signed || !f.sigDataUrl) continue;
      const page = pages[f.page - 1];
      if (!page) continue;

      const b64 = f.sigDataUrl.split(',')[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);

      const img = await outDoc.embedPng(arr);
      page.drawImage(img, { x: f.x, y: f.y, width: f.width, height: f.height });
      page.drawLine({
        start: { x: f.x, y: f.y },
        end:   { x: f.x + f.width, y: f.y },
        thickness: 0.5,
        color: rgb(.75, .75, .75)
      });
    }

    const bytes = await outDoc.save();
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const url   = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'signed_document.pdf' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast('✅ Signed PDF downloaded!');

  } catch(err) {
    console.error('Download error:', err);
    toast('Error generating PDF. See console for details.');
  }

  btn.disabled = false;
  btn.querySelector('.dock-label').textContent = 'Download';
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function setStatus(cls, txt) {
  document.getElementById('statusPill').className = 'status-pill ' + cls;
  document.getElementById('statusTxt').textContent = txt;
}
function prog(pct) {
  document.getElementById('progBar').classList.add('show');
  document.getElementById('progFill').style.width = pct + '%';
}
function hideProg() {
  document.getElementById('progBar').classList.remove('show');
  document.getElementById('progFill').style.width = '0';
}
let _tt;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 3800);
}

// Responsive re-render on resize
let _rt;
window.addEventListener('resize', () => {
  clearTimeout(_rt);
  _rt = setTimeout(async () => {
    if (pdfJsDoc) { await renderPages(); renderOverlays(); }
  }, 350);
});

// Init pad on load
initPad();