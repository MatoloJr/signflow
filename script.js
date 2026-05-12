// FIX: set CDN worker (prevents "fake worker" warning & CORS error) 
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const { PDFDocument, rgb } = PDFLib;

// STATE 
let rawBuffer = null;   // original ArrayBuffer
let pdfJsDoc = null;   // pdf.js doc (render)
let pdfLibDoc = null;   // pdf-lib doc (write)
let numPages = 0;
let pageInfo = {};     // { n: { scale, origW, origH, rendW, rendH } }
let pageInners = {};     // { n: innerDiv }
let fields = [];     // signature field objects
let hasSig = false;
let placing = false;

// MOBILE SIDEBAR
document.getElementById('sbToggle').addEventListener('click', toggleSidebar);
document.getElementById('overlayBg').addEventListener('click', closeSidebar);
function toggleSidebar() {
    const open = document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlayBg').style.display = open ? 'block' : 'none';
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlayBg').style.display = 'none';
}

// SIGNATURE PAD
const sigCanvas = document.getElementById('sigCanvas');
const sigCtx = sigCanvas.getContext('2d');
let drawing = false, lx = 0, ly = 0;

function initPad() {
    const par = sigCanvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = par.clientWidth, h = 130;
    sigCanvas.width = Math.floor(w * dpr);
    sigCanvas.height = Math.floor(h * dpr);
    sigCanvas.style.width = w + 'px';
    sigCanvas.style.height = h + 'px';
    sigCtx.setTransform(1, 0, 0, 1, 0, 0);
    sigCtx.scale(dpr, dpr);
    sigCtx.strokeStyle = '#1a1916';
    sigCtx.lineWidth = 2.2;
    sigCtx.lineCap = sigCtx.lineJoin = 'round';
}
initPad();
window.addEventListener('resize', initPad);

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
sigCanvas.addEventListener('mousedown', padStart);
sigCanvas.addEventListener('mousemove', padMove);
sigCanvas.addEventListener('mouseup', padEnd);
sigCanvas.addEventListener('mouseleave', padEnd);
sigCanvas.addEventListener('touchstart', padStart, { passive: false });
sigCanvas.addEventListener('touchmove', padMove, { passive: false });
sigCanvas.addEventListener('touchend', padEnd);

document.getElementById('btnClear').addEventListener('click', () => {
    const dpr = window.devicePixelRatio || 1;
    sigCtx.clearRect(0, 0, sigCanvas.width / dpr, sigCanvas.height / dpr);
    hasSig = false;
});

// FILE UPLOAD
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('over');
    tryLoad(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => tryLoad(e.target.files[0]));
document.getElementById('fcChg').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

function tryLoad(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        toast('Please upload a PDF file only.'); return;
    }
    loadFile(file);
}

async function loadFile(file) {
    setStatus('scanning', 'Loading…');
    prog(10);
    const reader = new FileReader();
    reader.onerror = () => toast('Failed to read the file.');
    reader.onload = async ev => {
        try {
            // Store a copy of the original ArrayBuffer
            rawBuffer = ev.target.result.slice(0);

            prog(30);

            // pdf.js needs its own Uint8Array copy
            pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(rawBuffer.slice(0)) }).promise;
            numPages = pdfJsDoc.numPages;

            prog(55);

            // pdf-lib needs its own Uint8Array copy
            pdfLibDoc = await PDFDocument.load(new Uint8Array(rawBuffer.slice(0)));

            prog(70);

            document.getElementById('fcName').textContent = file.name;
            document.getElementById('fcMeta').textContent =
                `${numPages} page${numPages > 1 ? 's' : ''} · ${(file.size / 1024).toFixed(0)} KB`;
            document.getElementById('fileCard').classList.add('show');
            dropzone.style.display = 'none';
            document.getElementById('addWrap').style.display = 'block';

            fields = [];
            await renderPages();
            prog(85);
            await scanFields();
            prog(100);
            setTimeout(hideProg, 700);

        } catch (err) {
            console.error('PDF load error:', err);
            toast('Could not parse PDF. Please ensure the file is a valid, non-password-protected PDF.');
            setStatus('', 'No document');
            hideProg();
        }
    };
    reader.readAsArrayBuffer(file);
}

// RENDER PAGES
async function renderPages() {
    const viewer = document.getElementById('viewer');
    document.getElementById('placeholder').style.display = 'none';
    viewer.innerHTML = '';
    pageInners = {};
    pageInfo = {};

    const availW = viewer.clientWidth - 48;

    for (let p = 1; p <= numPages; p++) {
        const page = await pdfJsDoc.getPage(p);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(availW / vp1.width, 1.6);
        const vp = page.getViewport({ scale });

        pageInfo[p] = {
            scale, origW: vp1.width, origH: vp1.height,
            rendW: vp.width, rendH: vp.height
        };

        const wrap = document.createElement('div');
        wrap.className = 'page-wrap';
        wrap.style.width = vp.width + 'px';

        const inner = document.createElement('div');
        inner.style.cssText = `position:relative;width:${vp.width}px;height:${vp.height}px;`;
        inner.dataset.page = p;

        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

        inner.appendChild(canvas);
        wrap.appendChild(inner);

        const lbl = document.createElement('div');
        lbl.className = 'page-lbl';
        lbl.textContent = `Page ${p} of ${numPages}`;
        wrap.appendChild(lbl);

        viewer.appendChild(wrap);
        pageInners[p] = inner;

        // Click handler for manual field placement
        inner.addEventListener('click', e => {
            if (!placing) return;
            const r = inner.getBoundingClientRect();
            const rx = e.clientX - r.left;
            const ry = e.clientY - r.top;
            const { scale, origH } = pageInfo[p];
            addField({
                name: 'Signature', page: p,
                x: rx / scale - 90, y: origH - (ry / scale) - 22,
                width: 180, height: 44,
                isManual: true, signed: false
            });
            exitPlace();
        });
    }

    setStatus('active', `${numPages} page${numPages > 1 ? 's' : ''} loaded`);
}

// SCAN FOR SIGNATURE FIELDS
async function scanFields() {
    const badge = document.getElementById('scanBadge');
    badge.className = 'scan-badge scanning show';
    badge.innerHTML = '<b>🔍 Scanning…</b>Looking for signature fields.';

    let found = 0;

    // A: AcroForm fields
    try {
        const form = pdfLibDoc.getForm();
        const flds = form.getFields();
        const pages = pdfLibDoc.getPages();
        for (const fld of flds) {
            const name = fld.getName() || '';
            const type = fld.constructor.name;
            if (!(type === 'PDFSignature' || /sign|sig|initia|author/i.test(name))) continue;
            for (const w of fld.acroField.getWidgets()) {
                const rect = w.getRectangle();
                const pref = w.P();
                let pg = 1;
                if (pref) for (let i = 0; i < pages.length; i++) if (pages[i].ref === pref) { pg = i + 1; break; }
                addField({
                    name, page: pg, x: rect.x, y: rect.y,
                    width: Math.max(rect.width, 120), height: Math.max(rect.height, 30),
                    isAcroForm: true, signed: false
                });
                found++;
            }
        }
    } catch (_) { }

    // B: Text keyword scan catches "Signed:", "Signature:", "Sign here", etc.
    // Patterns: label-style ("Signed:") and phrase-style ("Sign here")
    const labelPatterns = [
        /^sign(ed|ature)?(\s+by)?[\s:_]*$/i,   // "Signed:", "Signature:", "Sign by:"
        /^sig[\s:_]+$/i,                         // "Sig:"
        /^initial(s)?[\s:_]*$/i,                // "Initials:"
        /^authorized\s+by[\s:_]*$/i,            // "Authorized by:"
        /^witness[\s:_]*$/i,                     // "Witness:"
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
        const page = await pdfJsDoc.getPage(p);
        const content = await page.getTextContent();
        const { origH } = pageInfo[p];
        const items = content.items;

        // Build a flat list of items with their bounding info for proximity checks
        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const raw = (item.str || '').trim();
            if (!raw) continue;

            const isLabel = labelPatterns.some(re => re.test(raw));
            const isPhrase = phrasePatterns.some(re => re.test(raw));
            if (!isLabel && !isPhrase) continue;

            const tx = item.transform[4];  // left edge of text
            const ty = item.transform[5];  // baseline y (PDF coords, origin bottom-left)
            const tw = item.width || 0;    // width of the label text itself
            const th = item.height || 12;  // approximate text height

            // Don't duplicate AcroForm areas
            if (fields.some(f => f.page === p && Math.abs(f.x - tx) < 100 && Math.abs(f.y - ty) < 50)) continue;

            // Determine where the blank/underline starts 
            // For label-style ("Signed: ___"), the signature area begins right after the label text.
            // For phrase-style ("Sign here"), the whole area IS the signature zone.
            let sigX, sigW;
            if (isLabel) {
                // Start right after the label text with a small gap
                sigX = tx + tw + 4;
                // Look ahead: if next item on the same baseline is an underline string or blank, measure it
                let lineW = 180; // default width
                for (let j = idx + 1; j < Math.min(idx + 5, items.length); j++) {
                    const next = items[j];
                    const nextY = next.transform[5];
                    // Must be on roughly the same baseline (within 4pt)
                    if (Math.abs(nextY - ty) > 4) break;
                    const nextStr = (next.str || '').trim();
                    // Underline blank = string of underscores, dashes, or just whitespace
                    if (/^[_\-\s]+$/.test(nextStr) || nextStr === '') {
                        lineW = Math.max(next.width || 120, 120);
                        break;
                    }
                    // If it's real text, stop looking
                    if (nextStr.length > 2) break;
                }
                sigW = Math.max(lineW, 140);
            } else {
                // Phrase style centre the box around the phrase
                sigX = tx;
                sigW = Math.max(tw * 1.5, 180);
            }

            // y: place overlay so it sits ON the baseline (where the underline is)
            // PDF y is baseline; signature image should span from ~descender to ~cap-height above
            const sigY = ty - 4;          // just below baseline (so line shows beneath sig)
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

    if (found > 0) {
        badge.className = 'scan-badge ok show';
        badge.innerHTML = `<b>✓ ${found} field${found > 1 ? 's' : ''} detected</b>Click a field to apply your signature.`;
    } else {
        badge.className = 'scan-badge warn show';
        badge.innerHTML = '<b>⚠ No fields detected</b>Use "Place field manually" to add one.';
    }
}

// FIELD MANAGEMENT
function addField(f) {
    fields.push(f);
    renderFieldList();
    renderOverlays();
}

function renderFieldList() {
    const list = document.getElementById('fieldList');
    if (!fields.length) {
        list.innerHTML = '<div class="field-empty">No fields yet.</div>'; return;
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
        if (!f.signed) el.addEventListener('click', () => applyField(i));
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
        const pw = Math.max(f.width * scale, 80);
        const ph = Math.max(f.height * scale, 28);

        const el = document.createElement('div');
        el.className = 'sig-ol' + (f.signed ? ' signed' : '');
        el.style.cssText = `left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;`;

        // inner content 
        const innerWrap = document.createElement('div');
        innerWrap.className = 'sig-ol-inner';

        if (f.signed && f.sigDataUrl) {
            const img = document.createElement('img');
            img.src = f.sigDataUrl;
            innerWrap.appendChild(img);
        } else {
            const lbl = document.createElement('div');
            lbl.className = 'sig-ol-lbl';
            lbl.textContent = '✍ Click to sign';
            innerWrap.appendChild(lbl);
        }
        el.appendChild(innerWrap);

        // drag handle (grip icon top-left) 
        const handle = document.createElement('div');
        handle.className = 'sig-ol-handle';
        handle.title = 'Drag to reposition';
        handle.textContent = '⠿';
        el.appendChild(handle);

        // delete button (top-right) 
        const del = document.createElement('button');
        del.className = 'sig-ol-del';
        del.textContent = '×';
        del.title = 'Remove field';
        del.addEventListener('click', e => {
            e.stopPropagation();
            fields.splice(i, 1);
            renderFieldList(); renderOverlays();
        });
        el.appendChild(del);

        // drag tip 
        const tip = document.createElement('div');
        tip.className = 'drag-tip';
        tip.textContent = 'Drag to reposition';
        el.appendChild(tip);

        // DRAG LOGIC 
        makeDraggable(el, i, inner);

        // click to sign (only if not dragging) 
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
        // Don't start drag from delete button
        if (e.target.classList.contains('sig-ol-del')) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        el.dataset.dragged = '0';

        const src = e.touches ? e.touches[0] : e;
        startX = src.clientX;
        startY = src.clientY;
        startLeft = parseFloat(el.style.left) || 0;
        startTop = parseFloat(el.style.top) || 0;

        el.classList.add('dragging');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }

    function onMove(e) {
        if (!dragging) return;
        if (e.cancelable) e.preventDefault();
        const src = e.touches ? e.touches[0] : e;
        const dx = src.clientX - startX;
        const dy = src.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) el.dataset.dragged = '1';

        // Constrain within page bounds
        const pageW = pageInner.offsetWidth;
        const pageH = pageInner.offsetHeight;
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        const newLeft = Math.max(0, Math.min(startLeft + dx, pageW - elW));
        const newTop = Math.max(0, Math.min(startTop + dy, pageH - elH));

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
    }

    function onEnd() {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');

        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);

        if (el.dataset.dragged !== '1') return; // was a click, not a drag

        // Convert final pixel position back to PDF coordinates
        const newLeft = parseFloat(el.style.left) || 0;
        const newTop = parseFloat(el.style.top) || 0;
        const { scale, origH, rendH } = pageInfo[fields[fieldIndex].page];
        const elH = el.offsetHeight;

        // canvas top → PDF y (bottom-left origin)
        fields[fieldIndex].x = newLeft / scale;
        fields[fieldIndex].y = (rendH - newTop - elH) / scale;

        // If already signed, re-render so the image moves with it
        if (fields[fieldIndex].signed) renderOverlays();

        toast('Position saved. Download to get the updated PDF.');
    }

    el.addEventListener('mousedown', onStart);
    el.addEventListener('touchstart', onStart, { passive: false });
}

async function applyField(i) {
    if (!hasSig) { toast('Draw your signature in the pad first.'); return; }
    fields[i].signed = true;
    fields[i].sigDataUrl = sigCanvas.toDataURL('image/png');
    renderFieldList();
    renderOverlays();

    // Scroll to the signed field
    const inner = pageInners[fields[i].page];
    if (inner) inner.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const remaining = fields.filter(f => !f.signed).length;
    toast(remaining === 0 ? '🎉 All fields signed! Ready to download.' : `Signed! ${remaining} remaining.`);
}

function checkDone() {
    const done = fields.length > 0 && fields.every(f => f.signed);
    document.getElementById('btnDownload').disabled = !done;
    document.getElementById('signedBanner').classList.toggle('show', done);
}

// MANUAL PLACEMENT
document.getElementById('btnAddField').addEventListener('click', () => {
    placing = true;
    document.getElementById('viewer').classList.add('placing');
    document.getElementById('manualTip').classList.add('show');
    toast('Click on the document where you want to place the signature.');
});
document.getElementById('btnCancelPlace').addEventListener('click', exitPlace);
function exitPlace() {
    placing = false;
    document.getElementById('viewer').classList.remove('placing');
    document.getElementById('manualTip').classList.remove('show');
}

// DOWNLOAD
document.getElementById('btnDownload').addEventListener('click', async () => {
    const btn = document.getElementById('btnDownload');
    btn.disabled = true; btn.textContent = '⏳ Building PDF…';
    try {
        // Load a fresh copy from raw bytes for a clean output
        const outDoc = await PDFDocument.load(new Uint8Array(rawBuffer.slice(0)));

        // Flatten AcroForm if present
        try { outDoc.getForm().flatten(); } catch (_) { }

        const pages = outDoc.getPages();

        for (const f of fields) {
            if (!f.signed || !f.sigDataUrl) continue;
            const page = pages[f.page - 1];
            if (!page) continue;

            // Decode PNG data URL → bytes
            const b64 = f.sigDataUrl.split(',')[1];
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);

            const img = await outDoc.embedPng(arr);
            const { height: ph } = page.getSize();

            // Draw signature
            page.drawImage(img, { x: f.x, y: f.y, width: f.width, height: f.height });

            // Thin underline
            page.drawLine({
                start: { x: f.x, y: f.y },
                end: { x: f.x + f.width, y: f.y },
                thickness: 0.5, color: rgb(.75, .75, .75)
            });


        }

        const bytes = await outDoc.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: 'signed_document.pdf' });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        toast('✅ Signed PDF downloaded!');

    } catch (err) {
        console.error('Download error:', err);
        toast('Error generating PDF. See console for details.');
    }
    btn.disabled = false; btn.textContent = '⬇ Download Signed PDF';
});

// UTILS
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
    document.getElementById('progFill').style.width = '0%';
}
let _tt;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(_tt);
    _tt = setTimeout(() => el.classList.remove('show'), 3600);
}

// Responsive re-render on window resize
let _rt;
window.addEventListener('resize', () => {
    clearTimeout(_rt);
    _rt = setTimeout(async () => {
        if (pdfJsDoc) { await renderPages(); renderOverlays(); }
    }, 400);
});