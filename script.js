// PDF.JS WORKER ─────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const { PDFDocument, rgb, StandardFonts } = PDFLib;

// STATE ─────────────────────
let rawBuffer      = null;
let pdfJsDoc       = null;
let pdfLibDoc      = null;
let numPages       = 0;
let pageInfo       = {};   // { n: { scale, origW, origH, rendW, rendH } }
let pageInners     = {};   // { n: innerDiv }
let fields         = [];   // signature fields
let editFields     = [];   // text/date/edit fields
let allTextItems   = [];   // [{page, str, x, y, w, h}] for search
let hasSig         = false;
let placing        = false;
let placingEdit    = false;
let placingType    = 'signature';
let sigDataUrlSaved = null;
let activeEditIdx  = null;

// MODAL SYSTEM ──────────────
function openModal(name) {
  const el = document.getElementById('modal' + cap(name));
  if (el) el.classList.add('open');
}
function closeModal(name) {
  const el = document.getElementById('modal' + cap(name));
  if (el) el.classList.remove('open');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
);
document.querySelectorAll('.modal-overlay').forEach(ov =>
  ov.addEventListener('click', e => {
    if (e.target === ov) {
      const m = ov.querySelector('[data-modal]');
      if (m) closeModal(m.dataset.modal);
    }
  })
);

// ISLAND BUTTONS ────────────
document.getElementById('islUpload').addEventListener('click',   () => openModal('upload'));
document.getElementById('islSign').addEventListener('click',     () => openModal('signature'));
document.getElementById('islEdit').addEventListener('click',     () => { renderEditFieldList(); openModal('edit'); });
document.getElementById('islFields').addEventListener('click',   () => { renderFieldList(); openModal('fields'); });
document.getElementById('islPlace').addEventListener('click',    () => openModal('place'));
document.getElementById('islDownload').addEventListener('click', handleDownload);

// PLACE TYPE SELECTOR ───────
document.querySelectorAll('.place-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.place-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    placingType = btn.dataset.ptype;
  });
});

// SIGNATURE PAD ─────────────
const sigCanvas = document.getElementById('sigCanvas');
const sigCtx    = sigCanvas.getContext('2d');
let drawing = false, lx = 0, ly = 0;

function initPad() {
  const par = sigCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = par.clientWidth, h = 160;
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

let _padInitDone = false;
document.getElementById('modalSignature').addEventListener('transitionend', () => {
  if (!document.getElementById('modalSignature').classList.contains('open')) return;
  const par = sigCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const newW = Math.floor(par.clientWidth * dpr);
  if (!_padInitDone || (!hasSig && sigCanvas.width !== newW)) {
    initPad();
    _padInitDone = true;
  } else if (hasSig && sigCanvas.width !== newW) {
    const snapshot = sigCanvas.toDataURL('image/png');
    initPad();
    const img = new Image();
    img.onload = () => sigCtx.drawImage(img, 0, 0, par.clientWidth, 160);
    img.src = snapshot;
  }
});

function padXY(e) {
  const r = sigCanvas.getBoundingClientRect();
  const s = e.touches ? e.touches[0] : e;
  return [s.clientX - r.left, s.clientY - r.top];
}
function padStart(e) { drawing = true; [lx,ly] = padXY(e); sigCtx.beginPath(); sigCtx.moveTo(lx,ly); }
function padMove(e) {
  if (!drawing) return;
  if (e.cancelable) e.preventDefault();
  const [x,y] = padXY(e);
  sigCtx.lineTo(x,y); sigCtx.stroke();
  lx=x; ly=y; hasSig=true;
}
function padEnd() { drawing = false; }

sigCanvas.addEventListener('mousedown',  padStart);
sigCanvas.addEventListener('mousemove',  padMove);
sigCanvas.addEventListener('mouseup',    padEnd);
sigCanvas.addEventListener('mouseleave', padEnd);
sigCanvas.addEventListener('touchstart', padStart, { passive:false });
sigCanvas.addEventListener('touchmove',  padMove,  { passive:false });
sigCanvas.addEventListener('touchend',   padEnd);

document.getElementById('btnClear').addEventListener('click', () => {
  const dpr = window.devicePixelRatio || 1;
  sigCtx.clearRect(0, 0, sigCanvas.width/dpr, sigCanvas.height/dpr);
  hasSig = false; sigDataUrlSaved = null;
  updateSigBadge();
});

document.getElementById('btnUseSig').addEventListener('click', () => {
  if (!hasSig) { toast('Draw your signature first!'); return; }
  sigDataUrlSaved = sigCanvas.toDataURL('image/png');
  updateSigBadge();
  requestAnimationFrame(() => {
    closeModal('signature');
    toast('Signature saved andtap any field on the document to apply it.');
  });
});

function updateSigBadge() {
  const b = document.getElementById('islSigBadge');
  if (sigDataUrlSaved) { b.style.display=''; b.classList.add('green'); b.textContent='✓'; }
  else b.style.display='none';
}

// FILE UPLOAD ───────────────
const dropOverlay = document.getElementById('dropOverlay');
dropOverlay.addEventListener('dragover',  e => { e.preventDefault(); dropOverlay.classList.add('over'); });
dropOverlay.addEventListener('dragleave', ()=> dropOverlay.classList.remove('over'));
dropOverlay.addEventListener('drop', e => { e.preventDefault(); dropOverlay.classList.remove('over'); tryLoad(e.dataTransfer.files[0]); });
document.getElementById('fileInput').addEventListener('change', e => tryLoad(e.target.files[0]));

const dropzoneModal = document.getElementById('dropzone');
dropzoneModal.addEventListener('dragover',  e => { e.preventDefault(); dropzoneModal.classList.add('over'); });
dropzoneModal.addEventListener('dragleave', ()=> dropzoneModal.classList.remove('over'));
dropzoneModal.addEventListener('drop', e => { e.preventDefault(); dropzoneModal.classList.remove('over'); tryLoad(e.dataTransfer.files[0]); });
document.getElementById('fileInput2').addEventListener('change', e => tryLoad(e.target.files[0]));
document.getElementById('fcChg').addEventListener('click', () => { document.getElementById('fileInput2').value=''; document.getElementById('fileInput2').click(); });

function tryLoad(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { toast('Please upload a PDF file only.'); return; }
  closeModal('upload');
  loadFile(file);
}

async function loadFile(file) {
  setStatus('scanning','Loading…'); prog(10);
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

      document.getElementById('fcName').textContent = file.name;
      document.getElementById('fcMeta').textContent = `${numPages} page${numPages>1?'s':''} · ${(file.size/1024).toFixed(0)} KB`;
      document.getElementById('fileCard').classList.add('show');
      document.getElementById('dropzone').style.display = 'none';

      const fb = document.getElementById('islFileBadge');
      fb.style.display=''; fb.textContent='✓'; fb.classList.add('green');

      dropOverlay.style.display = 'none';
      document.getElementById('pagesContainer').style.display = 'flex';

      fields=[]; editFields=[]; allTextItems=[];
      await renderPages();
      prog(85);
      await scanFields();
      prog(100);
      setTimeout(hideProg, 700);

    } catch(err) {
      console.error('PDF load error:', err);
      toast('Could not parse PDF. Make sure it is a valid, non-password-protected PDF.');
      setStatus('','No document'); hideProg();
    }
  };
  reader.readAsArrayBuffer(file);
}

// RENDER PAGES ───────────────
async function renderPages() {
  const container = document.getElementById('pagesContainer');
  container.innerHTML = '';
  pageInners={}; pageInfo={};

  const viewer = document.getElementById('viewer');
  const availW = viewer.clientWidth - 32;

  for (let p=1; p<=numPages; p++) {
    const page = await pdfJsDoc.getPage(p);
    const vp1  = page.getViewport({ scale:1 });
    const scale = Math.min(availW / vp1.width, 1.8);
    const vp   = page.getViewport({ scale });

    pageInfo[p] = { scale, origW:vp1.width, origH:vp1.height, rendW:vp.width, rendH:vp.height };

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = vp.width+'px';

    const inner = document.createElement('div');
    inner.className = 'page-inner';
    inner.style.cssText = `position:relative;width:${vp.width}px;height:${vp.height}px;`;
    inner.dataset.page = p;

    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    inner.appendChild(canvas);
    wrap.appendChild(inner);

    const lbl = document.createElement('div');
    lbl.className = 'page-lbl';
    lbl.textContent = `Page ${p} of ${numPages}`;
    wrap.appendChild(lbl);

    container.appendChild(wrap);
    pageInners[p] = inner;

    inner.addEventListener('click', e => {
      if (!placing && !placingEdit) return;
      const r  = inner.getBoundingClientRect();
      const rx = e.clientX - r.left;
      const ry = e.clientY - r.top;
      const { scale, origH } = pageInfo[p];

      if (placing) {
        addField({
          name:'Signature', page:p,
          x: rx/scale - 90, y: origH - (ry/scale) - 22,
          width:180, height:44,
          isManual:true, signed:false
        });
        exitPlace();
      } else if (placingEdit) {
        const isDate = placingType === 'date';
        addEditField({
          name: isDate ? 'Date' : 'Text Field', page:p,
          x: rx/scale - 70, y: origH - (ry/scale) - 16,
          width:140, height:28,
          fieldType: placingType,
          value:'', isManual:true
        });
        exitPlace();
      }
    });
  }
  setStatus('active', `${numPages} page${numPages>1?'s':''} loaded`);
}

// SCAN FIELDS ───────────────
async function scanFields() {
  const badge = document.getElementById('scanBadge');
  badge.className='scan-badge scanning show';
  badge.innerHTML='<b>🔍 Scanning…</b>Detecting signature and edit fields.';

  let foundSig=0, foundEdit=0;

  try {
    const form  = pdfLibDoc.getForm();
    const flds  = form.getFields();
    const pages = pdfLibDoc.getPages();
    for (const fld of flds) {
      const name = fld.getName() || '';
      const type = fld.constructor.name;
      const isSig  = type==='PDFSignature' || /sign|sig|initia|author/i.test(name);
      const isText = type==='PDFTextField';
      if (!isSig && !isText) continue;
      for (const w of fld.acroField.getWidgets()) {
        const rect = w.getRectangle();
        const pref = w.P();
        let pg=1;
        if (pref) for (let i=0;i<pages.length;i++) if (pages[i].ref===pref){pg=i+1;break;}
        if (isSig) {
          addField({ name, page:pg, x:rect.x, y:rect.y, width:Math.max(rect.width,120), height:Math.max(rect.height,30), isAcroForm:true, signed:false });
          foundSig++;
        } else {
          const isDate = /date|dob|born/i.test(name);
          addEditField({ name, page:pg, x:rect.x, y:rect.y, width:Math.max(rect.width,100), height:Math.max(rect.height,20), fieldType:isDate?'date':'text', value:'', isAcroForm:true });
          foundEdit++;
        }
      }
    }
  } catch(_) {}

  const sigLabelPat = [ /^sign(ed|ature)?(\s+by)?[\s:_]*$/i, /^sig[\s:_]+$/i, /^initial(s)?[\s:_]*$/i, /^authorized\s+by[\s:_]*$/i, /^witness[\s:_]*$/i ];
  const sigPhrasePat= [ /sign\s+here/i, /applicant.{0,4}sign/i, /employee.{0,4}sign/i, /customer.{0,4}sign/i, /signature\s+of/i, /your\s+sign/i ];
  const editLabelPat= [
    { re:/^(full\s+)?name[\s:_]*$/i,      type:'text', label:'Name' },
    { re:/^(first|last)\s+name[\s:_]*$/i, type:'text', label:'Name' },
    { re:/^print(ed)?\s+name[\s:_]*$/i,   type:'text', label:'Print Name' },
    { re:/^(date[\s:_]*)$/i,              type:'date', label:'Date' },
    { re:/^date\s+of[\s:_]*/i,            type:'date', label:'Date' },
    { re:/^(email|e-mail)[\s:_]*$/i,      type:'text', label:'Email' },
    { re:/^(phone|tel)[\s:_]*/i,          type:'text', label:'Phone' },
    { re:/^(title|position)[\s:_]*$/i,    type:'text', label:'Title' },
    { re:/^(company|organization)[\s:_]*$/i, type:'text', label:'Company' },
    { re:/^address[\s:_]*/i,              type:'text', label:'Address' },
  ];

  allTextItems = [];

  for (let p=1; p<=numPages; p++) {
    const page    = await pdfJsDoc.getPage(p);
    const content = await page.getTextContent();
    const { origH } = pageInfo[p];
    const items   = content.items;

    for (let idx=0; idx<items.length; idx++) {
      const item = items[idx];
      const raw  = (item.str||'').trim();
      if (!raw) continue;

      allTextItems.push({
        page:p, str:raw,
        x:item.transform[4], y:item.transform[5],
        w:item.width||0, h:item.height||12
      });

      const tx=item.transform[4], ty=item.transform[5];
      const tw=item.width||0,     th=item.height||12;

      const isLabel  = sigLabelPat.some(re => re.test(raw));
      const isPhrase = sigPhrasePat.some(re=> re.test(raw));
      if (isLabel || isPhrase) {
        if (!fields.some(f=>f.page===p&&Math.abs(f.x-tx)<100&&Math.abs(f.y-ty)<50)) {
          let sigX, sigW;
          if (isLabel) {
            sigX = tx+tw+4;
            let lineW=180;
            for (let j=idx+1;j<Math.min(idx+5,items.length);j++) {
              const nxt=items[j], ny=nxt.transform[5];
              if (Math.abs(ny-ty)>4) break;
              const ns=(nxt.str||'').trim();
              if (/^[_\-\s]+$/.test(ns)||ns===''){lineW=Math.max(nxt.width||120,120);break;}
              if (ns.length>2) break;
            }
            sigW=Math.max(lineW,140);
          } else { sigX=tx; sigW=Math.max(tw*1.5,180); }
          addField({ name:raw, page:p, x:sigX, y:ty-4, width:sigW, height:Math.max(th+10,36), isTextDetected:true, signed:false });
          foundSig++;
        }
        continue;
      }

      const editMatch = editLabelPat.find(ep=>ep.re.test(raw));
      if (editMatch) {
        if (!editFields.some(f=>f.page===p&&Math.abs(f.x-tx)<120&&Math.abs(f.y-ty)<50)) {
          let editX = tx+tw+4, editW=140;
          for (let j=idx+1;j<Math.min(idx+5,items.length);j++) {
            const nxt=items[j], ny=nxt.transform[5];
            if (Math.abs(ny-ty)>4) break;
            const ns=(nxt.str||'').trim();
            if (/^[_\-\s]+$/.test(ns)||ns===''){editW=Math.max(nxt.width||120,120);break;}
            if (ns.length>2) break;
          }
          addEditField({ name:editMatch.label, page:p, x:editX, y:ty-4, width:Math.max(editW,120), height:Math.max(th+8,28), fieldType:editMatch.type, value:'', isTextDetected:true });
          foundEdit++;
        }
      }
    }
  }

  const total = foundSig + foundEdit;
  if (total>0) {
    badge.className='scan-badge ok show';
    badge.innerHTML=`<b>✓ ${total} field${total>1?'s':''} detected</b>${foundSig} signature · ${foundEdit} edit field${foundEdit!==1?'s':''}.`;
  } else {
    badge.className='scan-badge warn show';
    badge.innerHTML='<b>⚠ No fields detected</b>Use "Place" in the toolbar to add fields manually.';
  }
  updateFieldsBadge();
  updateEditBadge();
}

// SIGNATURE FIELD MANAGEMENT 
function addField(f) { fields.push(f); renderFieldList(); renderOverlays(); updateFieldsBadge(); }

function updateFieldsBadge() {
  const b = document.getElementById('islFieldsBadge');
  const total=fields.length, signed=fields.filter(f=>f.signed).length;
  if (!total) { b.textContent='0'; b.classList.remove('green'); }
  else if (signed===total) { b.textContent='✓'; b.classList.add('green'); }
  else { b.textContent=total-signed; b.classList.remove('green'); }
}

function renderFieldList() {
  const list = document.getElementById('fieldList');
  if (!fields.length) { list.innerHTML='<div class="field-empty">No signature fields yet.</div>'; checkDone(); return; }
  list.innerHTML='';

  // FEATURE 1: "Sign All" button when sig is committed ──
  if (sigDataUrlSaved && fields.some(f=>!f.signed)) {
    const signAllBtn = document.createElement('button');
    signAllBtn.className = 'btn btn-accent btn-full sign-all-btn';
    signAllBtn.innerHTML = '✍ Apply signature to all fields';
    signAllBtn.addEventListener('click', () => {
      fields.forEach((f,i) => { if (!f.signed) { f.signed=true; f.sigDataUrl=sigDataUrlSaved; } });
      renderFieldList(); renderOverlays(); updateFieldsBadge();
      toast('🎉 Signature applied to all fields!');
    });
    list.appendChild(signAllBtn);
  }

  fields.forEach((f,i) => {
    const el = document.createElement('div');
    el.className='fi'+(f.signed?' signed':'');
    el.innerHTML=`<div class="fi-dot"></div><span class="fi-name" title="${f.name}">${f.name}</span><span class="fi-pg">Pg ${f.page}</span><span class="fi-tag">${f.signed?'✓ Signed':f.isAcroForm?'Form':f.isTextDetected?'Auto':'Manual'}</span>`;
    if (!f.signed) el.addEventListener('click', ()=>{ closeModal('fields'); const inner=pageInners[f.page]; if(inner) inner.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>applyField(i),300); });
    list.appendChild(el);
  });
  checkDone();
}

function renderOverlays() {
  document.querySelectorAll('.sig-ol').forEach(el=>el.remove());
  fields.forEach((f,i) => {
    const inner = pageInners[f.page];
    if (!inner) return;
    const { scale, rendH } = pageInfo[f.page];
    const px=Math.max(f.x*scale,0), py=Math.max(rendH-(f.y+f.height)*scale,0);
    const pw=Math.max(f.width*scale,80), ph=Math.max(f.height*scale,28);

    const el = document.createElement('div');
    el.className='sig-ol'+(f.signed?' signed':'');
    el.style.cssText=`left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;`;

    const wrap=document.createElement('div'); wrap.className='sig-ol-inner';
    if (f.signed&&f.sigDataUrl) { const img=document.createElement('img'); img.src=f.sigDataUrl; wrap.appendChild(img); }
    else { const lbl=document.createElement('div'); lbl.className='sig-ol-lbl'; lbl.textContent='✍ Click to sign'; wrap.appendChild(lbl); }
    el.appendChild(wrap);

    const handle=document.createElement('div'); handle.className='sig-ol-handle'; handle.title='Drag'; handle.textContent='⠿'; el.appendChild(handle);
    const del=document.createElement('button'); del.className='sig-ol-del'; del.textContent='×'; del.title='Remove';
    del.addEventListener('click',e=>{e.stopPropagation();fields.splice(i,1);renderFieldList();renderOverlays();updateFieldsBadge();});
    el.appendChild(del);

    // FEATURE 1: "Re-use" stamp button on unsigned overlays ──
    if (!f.signed && sigDataUrlSaved) {
      const reuseBtn = document.createElement('button');
      reuseBtn.className = 'sig-ol-reuse';
      reuseBtn.title = 'Apply saved signature';
      reuseBtn.textContent = '✍ Apply';
      reuseBtn.addEventListener('mousedown', e => e.stopPropagation()); // prevent drag hijack
      reuseBtn.addEventListener('click', e => { e.stopPropagation(); applyField(i); });
      el.appendChild(reuseBtn);
    }

    // FEATURE 3: Resize handle for signature overlays ──
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ol-resize-handle';
    resizeHandle.title = 'Resize';
    el.appendChild(resizeHandle);
    makeResizable(el, i, inner, 'sig');

    const tip=document.createElement('div'); tip.className='drag-tip'; tip.textContent='Drag to reposition'; el.appendChild(tip);
    makeDraggable(el, i, inner, 'sig');

    if (!f.signed) el.addEventListener('click',e=>{
      if(el.dataset.dragged==='1'){el.dataset.dragged='0';return;}
      if(e.target.classList.contains('sig-ol-reuse')) return; // already handled
      applyField(i);
    });
    inner.appendChild(el);
  });
}

// EDIT FIELD MANAGEMENT ─────
function addEditField(f) { editFields.push(f); renderEditFieldList(); renderEditOverlays(); updateEditBadge(); }

function updateEditBadge() {
  const b=document.getElementById('islEditBadge');
  const total=editFields.length, filled=editFields.filter(f=>f.value).length;
  if (!total) { b.textContent='0'; b.classList.remove('blue','green'); }
  else if (filled===total) { b.textContent='✓'; b.classList.add('green'); b.classList.remove('blue'); }
  else { b.textContent=total-filled; b.classList.add('blue'); b.classList.remove('green'); }
}

function renderEditFieldList() {
  const list=document.getElementById('editFieldList');
  if (!editFields.length) { list.innerHTML='<div class="field-empty">No edit fields detected yet.</div>'; return; }
  list.innerHTML='';

  // FEATURE 1: "Fill all" button when any field has a value that can be copied ──
  const filledFields = editFields.filter(f => f.value);
  const hasEmptyText = editFields.some(f => !f.value && f.fieldType==='text');
  const hasEmptyDate = editFields.some(f => !f.value && f.fieldType==='date');
  if (filledFields.length > 0 && (hasEmptyText || hasEmptyDate)) {
    const fillAllBtn = document.createElement('button');
    fillAllBtn.className = 'btn btn-sm btn-ghost fill-all-btn';
    fillAllBtn.innerHTML = '⊕ Copy filled values to matching empty fields';
    fillAllBtn.addEventListener('click', () => {
      let count = 0;
      // For each field type, find the last filled value and propagate to empty ones
      ['text','date'].forEach(type => {
        const lastFilled = [...editFields].reverse().find(f => f.value && f.fieldType===type);
        if (lastFilled) {
          editFields.forEach(f => { if (!f.value && f.fieldType===type) { f.value=lastFilled.value; count++; } });
        }
      });
      renderEditFieldList(); renderEditOverlays(); updateEditBadge();
      toast(count > 0 ? `Filled ${count} empty field${count>1?'s':''}.` : 'No empty fields to fill.');
    });
    list.appendChild(fillAllBtn);
  }

  editFields.forEach((f,i) => {
    const el=document.createElement('div');
    el.className='fi edit-fi'+(f.value?' filled':'');
    const typeIcon = f.fieldType==='date' ? '📅' : 'Aa';
    el.innerHTML=`<div class="fi-dot"></div><span class="fi-name" title="${f.name}">${f.name}</span><span class="fi-pg">Pg ${f.page}</span><span class="fi-tag">${f.value?('✓ '+f.value.slice(0,12)):typeIcon+' Empty'}</span>`;
    if (!f.value) el.addEventListener('click',()=>{ closeModal('edit'); const inner=pageInners[f.page]; if(inner) inner.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>openEditPopover(i),300); });
    list.appendChild(el);
  });
}

function renderEditOverlays() {
  document.querySelectorAll('.edit-ol').forEach(el=>el.remove());
  editFields.forEach((f,i) => {
    const inner=pageInners[f.page]; if (!inner) return;
    const { scale, rendH }=pageInfo[f.page];
    const px=Math.max(f.x*scale,0), py=Math.max(rendH-(f.y+f.height)*scale,0);
    const pw=Math.max(f.width*scale,80), ph=Math.max(f.height*scale,20);

    const el=document.createElement('div');
    el.className='edit-ol'+(f.value?' filled':'');
    el.style.cssText=`left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;`;

    if (f.value) {
      const txt=document.createElement('div'); txt.className='edit-ol-text'; txt.textContent=f.value; el.appendChild(txt);
    } else {
      const ph2=document.createElement('div'); ph2.className='edit-ol-placeholder';
      ph2.textContent=f.fieldType==='date'?'📅 Date':'Aa Text'; el.appendChild(ph2);
    }

    const handle=document.createElement('div'); handle.className='edit-ol-handle'; handle.textContent='⠿'; el.appendChild(handle);
    const del=document.createElement('button'); del.className='edit-ol-del'; del.textContent='×'; del.title='Remove';
    del.addEventListener('mousedown', e => e.stopPropagation());
    del.addEventListener('click',e=>{e.stopPropagation();editFields.splice(i,1);renderEditFieldList();renderEditOverlays();updateEditBadge();});
    el.appendChild(del);

    // FEATURE 1: Copy value to all empty same-type fields ──
    if (f.value) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'edit-ol-copy';
      copyBtn.title = 'Copy value to all empty fields of this type';
      copyBtn.textContent = '⊕ Fill all';
      copyBtn.addEventListener('mousedown', e => e.stopPropagation());
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        const count = editFields.filter((ef,j) => j!==i && ef.fieldType===f.fieldType && !ef.value).length;
        editFields.forEach((ef,j) => { if (j!==i && ef.fieldType===f.fieldType && !ef.value) ef.value = f.value; });
        renderEditFieldList(); renderEditOverlays(); updateEditBadge();
        toast(count > 0 ? `Copied "${f.value.slice(0,20)}" to ${count} empty field${count>1?'s':''}.` : 'No empty fields of this type to fill.');
      });
      el.appendChild(copyBtn);
    }

    // FEATURE 3: Resize handle for edit overlays ──
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ol-resize-handle';
    resizeHandle.title = 'Resize field';
    el.appendChild(resizeHandle);
    makeResizable(el, i, inner, 'edit');

    makeDraggable(el, i, inner, 'edit');
    el.addEventListener('click',e=>{
      if(el.dataset.dragged==='1'){el.dataset.dragged='0';return;}
      if(e.target.classList.contains('edit-ol-copy')) return; // already handled
      openEditPopover(i);
    });
    inner.appendChild(el);
  });
}

// EDIT POPOVER ───────────────
function openEditPopover(idx) {
  activeEditIdx = idx;
  const f = editFields[idx];
  const inner = pageInners[f.page]; if (!inner) return;

  const { scale, rendH } = pageInfo[f.page];
  const px = f.x * scale;
  const py = rendH - (f.y + f.height) * scale;
  const innerRect = inner.getBoundingClientRect();

  const popover = document.getElementById('editPopover');
  const input   = document.getElementById('editPopoverInput');

  const top  = innerRect.top  + py - 80;
  const left = innerRect.left + px;
  popover.style.top  = Math.max(60, top) + 'px';
  popover.style.left = Math.min(left, window.innerWidth - 340) + 'px';
  popover.style.display = 'block';

  // FEATURE 2: No maxlength restriction on the input
  input.removeAttribute('maxlength');

  if (f.fieldType === 'date') {
    input.type = 'date';
    input.placeholder = '';
  } else {
    input.type = 'text';
    input.placeholder = `Enter ${f.name.toLowerCase()}…`;
  }
  input.value = f.value || '';
  input.focus();
}

document.getElementById('editPopoverApply').addEventListener('click', applyEditPopover);
document.getElementById('editPopoverInput').addEventListener('keydown', e => {
  if (e.key==='Enter') applyEditPopover();
  if (e.key==='Escape') cancelEditPopover();
});
document.getElementById('editPopoverCancel').addEventListener('click', cancelEditPopover);

function applyEditPopover() {
  if (activeEditIdx===null) return;
  const val = document.getElementById('editPopoverInput').value.trim();
  editFields[activeEditIdx].value = val;
  closeEditPopover();
  renderEditFieldList();
  renderEditOverlays();
  updateEditBadge();
  toast(val ? `Saved: "${val.slice(0,40)}${val.length>40?'…':''}"` : 'Field cleared.');
}
function cancelEditPopover() { activeEditIdx=null; closeEditPopover(); }
function closeEditPopover()  { document.getElementById('editPopover').style.display='none'; }

document.addEventListener('click', e => {
  const pop=document.getElementById('editPopover');
  if (pop.style.display!=='none' && !pop.contains(e.target) && !e.target.classList.contains('edit-ol')) {
    cancelEditPopover();
  }
});

// MAKE RESIZABLE (FEATURE 3) 
function makeResizable(el, fieldIndex, pageInner, kind) {
  const handle = el.querySelector('.ol-resize-handle');
  if (!handle) return;

  let startX, startY, startW, startH, resizing = false;

  function onStart(e) {
    e.preventDefault(); e.stopPropagation();
    resizing = true;
    const src = e.touches ? e.touches[0] : e;
    startX = src.clientX; startY = src.clientY;
    startW = el.offsetWidth; startH = el.offsetHeight;
    el.classList.add('resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  function onMove(e) {
    if (!resizing) return;
    if (e.cancelable) e.preventDefault();
    const src = e.touches ? e.touches[0] : e;
    const dx = src.clientX - startX;
    const dy = src.clientY - startY;
    const newW = Math.max(60, startW + dx);
    const newH = Math.max(20, startH + dy);

    // Clamp to page boundary
    const pW = pageInner.offsetWidth, pH = pageInner.offsetHeight;
    const left = parseFloat(el.style.left) || 0;
    const top  = parseFloat(el.style.top) || 0;
    const clampedW = Math.min(newW, pW - left);
    const clampedH = Math.min(newH, pH - top);

    el.style.width  = clampedW + 'px';
    el.style.height = clampedH + 'px';
  }

  function onEnd() {
    if (!resizing) return;
    resizing = false;
    el.classList.remove('resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);

    // Sync back to PDF coordinate space
    const fArr = kind === 'edit' ? editFields : fields;
    const { scale, rendH } = pageInfo[fArr[fieldIndex].page];
    fArr[fieldIndex].width  = el.offsetWidth  / scale;
    fArr[fieldIndex].height = el.offsetHeight / scale;

    toast('Field resized.');
  }

  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
}

// MAKE DRAGGABLE ─────────────
function makeDraggable(el, fieldIndex, pageInner, kind) {
  let startX,startY,startLeft,startTop,dragging=false;

  function onStart(e) {
    // Don't drag if clicking resize handle or delete
    if (e.target.classList.contains('sig-ol-del') || e.target.classList.contains('edit-ol-del') || e.target.classList.contains('ol-resize-handle') || e.target.classList.contains('sig-ol-reuse') || e.target.classList.contains('edit-ol-copy')) return;
    e.preventDefault(); e.stopPropagation();
    dragging=true; el.dataset.dragged='0';
    const src=e.touches?e.touches[0]:e;
    startX=src.clientX; startY=src.clientY;
    startLeft=parseFloat(el.style.left)||0;
    startTop =parseFloat(el.style.top )||0;
    el.classList.add('dragging');
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',  onEnd);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('touchend', onEnd);
  }
  function onMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const src=e.touches?e.touches[0]:e;
    const dx=src.clientX-startX, dy=src.clientY-startY;
    if (Math.abs(dx)>3||Math.abs(dy)>3) el.dataset.dragged='1';
    const pW=pageInner.offsetWidth, pH=pageInner.offsetHeight;
    const eW=el.offsetWidth, eH=el.offsetHeight;
    el.style.left=Math.max(0,Math.min(startLeft+dx,pW-eW))+'px';
    el.style.top =Math.max(0,Math.min(startTop +dy,pH-eH))+'px';
  }
  function onEnd() {
    if (!dragging) return;
    dragging=false; el.classList.remove('dragging');
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',  onEnd);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend', onEnd);
    if (el.dataset.dragged!=='1') return;
    const nL=parseFloat(el.style.left)||0, nT=parseFloat(el.style.top)||0;
    const fArr = kind==='edit'?editFields:fields;
    const { scale, rendH } = pageInfo[fArr[fieldIndex].page];
    fArr[fieldIndex].x = nL/scale;
    fArr[fieldIndex].y = (rendH-nT-el.offsetHeight)/scale;
    if (kind==='sig'&&fArr[fieldIndex].signed) renderOverlays();
    if (kind==='edit'&&fArr[fieldIndex].value) renderEditOverlays();
    toast('Position saved.');
  }
  el.addEventListener('mousedown', onStart);
  el.addEventListener('touchstart',onStart,{passive:false});
}

// APPLY SIGNATURE ───────────
function applyField(i) {
  if (!sigDataUrlSaved && hasSig) {
    sigDataUrlSaved = sigCanvas.toDataURL('image/png');
    updateSigBadge();
  }
  const dataUrl = sigDataUrlSaved;
  if (!dataUrl) { toast('Draw your signature first andtap ✍ in the toolbar.'); openModal('signature'); return; }
  fields[i].signed=true; fields[i].sigDataUrl=dataUrl;
  renderFieldList(); renderOverlays(); updateFieldsBadge();
  const inner=pageInners[fields[i].page]; if(inner) inner.scrollIntoView({behavior:'smooth',block:'center'});
  const rem=fields.filter(f=>!f.signed).length;
  toast(rem===0?'🎉 All fields signed! Tap ⬇ to download.':`Signed ✓  ${rem} field${rem>1?'s':''} remaining.`);
}

function checkDone() {
  const done=fields.length>0&&fields.every(f=>f.signed);
  document.getElementById('islDownload').disabled=!done;
  document.getElementById('signedBanner').classList.toggle('show',done);
  if (done) document.getElementById('islDownload').querySelector('.isl-icon').textContent='🎉';
}

// MANUAL PLACEMENT ──────────
document.getElementById('btnStartPlace').addEventListener('click', () => {
  const type = document.querySelector('.place-type-btn.active')?.dataset.ptype || 'signature';
  placingType = type;
  if (type==='signature') { placing=true; placingEdit=false; }
  else { placingEdit=true; placing=false; }
  document.getElementById('viewer').classList.add(type==='signature'?'placing':'placing-edit');
  document.getElementById('manualTip').classList.add('show');
  document.getElementById('btnStartPlace').style.display='none';
  const hint=document.getElementById('placingHint');
  const typeLabel = type==='date'?'date field':type==='text'?'text field':'signature field';
  document.getElementById('placingHintTxt').textContent=`📍 Click to place ${typeLabel}`;
  hint.classList.add('show');
  closeModal('place');
});

document.getElementById('btnPlaceEdit').addEventListener('click', () => {
  closeModal('edit');
  document.querySelectorAll('.place-type-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.place-type-btn[data-ptype="text"]').classList.add('active');
  openModal('place');
});

document.getElementById('btnCancelPlace').addEventListener('click', exitPlace);
document.getElementById('cancelPlaceTxt').addEventListener('click', exitPlace);

function exitPlace() {
  placing=false; placingEdit=false;
  document.getElementById('viewer').classList.remove('placing','placing-edit');
  document.getElementById('manualTip').classList.remove('show');
  document.getElementById('btnStartPlace').style.display='';
  document.getElementById('placingHint').classList.remove('show');
}

// DOWNLOAD ──────────────────
async function handleDownload() {
  const btn=document.getElementById('islDownload');
  btn.disabled=true; btn.querySelector('.isl-label').textContent='Building…';
  try {
    const outDoc=await PDFDocument.load(new Uint8Array(rawBuffer.slice(0)));
    try { outDoc.getForm().flatten(); } catch(_){}
    const pages=outDoc.getPages();

    const font = await outDoc.embedFont(StandardFonts.Helvetica);

    for (const f of fields) {
      if (!f.signed||!f.sigDataUrl) continue;
      const page=pages[f.page-1]; if(!page) continue;
      const b64=f.sigDataUrl.split(',')[1], bin=atob(b64);
      const arr=new Uint8Array(bin.length);
      for (let j=0;j<bin.length;j++) arr[j]=bin.charCodeAt(j);
      const img=await outDoc.embedPng(arr);
      page.drawImage(img,{x:f.x,y:f.y,width:f.width,height:f.height});
    }

    // FEATURE 2: No maxWidth restriction andtext flows freely
    for (const f of editFields) {
      if (!f.value) continue;
      const page=pages[f.page-1]; if(!page) continue;
      const fontSize = Math.min(f.height*0.62, 13);
      const displayVal = f.fieldType==='date' ? formatDateDisplay(f.value) : f.value;
      // Removed maxWidth so text has no character/width limit
      page.drawText(displayVal, {
        x: f.x+3, y: f.y+4,
        size: fontSize, font,
        color: rgb(0.1,0.1,0.1)
      });
    }

    const bytes=await outDoc.save();
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:'signed_document.pdf'});
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),8000);
    toast('✅ Signed PDF downloaded!');
  } catch(err) {
    console.error('Download error:',err);
    toast('Error generating PDF. See console for details.');
  }
  btn.disabled=false;
  btn.querySelector('.isl-label').textContent='Download';
}

function formatDateDisplay(val) {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y,m,d]=val.split('-');
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
  }
  return val;
}

// SEARCH ────────────────────
const searchInput   = document.getElementById('searchInput');
const searchClear   = document.getElementById('searchClear');
const searchResults = document.getElementById('searchResults');

searchInput.addEventListener('input', onSearchInput);
searchInput.addEventListener('focus', onSearchInput);
searchClear.addEventListener('click', () => { searchInput.value=''; searchClear.style.display='none'; searchResults.classList.remove('open'); searchInput.focus(); });

document.addEventListener('click', e => {
  if (!document.getElementById('searchWrap').contains(e.target)) searchResults.classList.remove('open');
});

function onSearchInput() {
  const q = searchInput.value.trim().toLowerCase();
  searchClear.style.display = q ? '' : 'none';
  if (!q || q.length<2) { searchResults.classList.remove('open'); return; }
  runSearch(q);
}

function runSearch(q) {
  const results = [];

  fields.forEach((f,i) => {
    if (f.name.toLowerCase().includes(q)) {
      results.push({ kind:'sig', label:f.name, sub:`Page ${f.page} · ${f.signed?'Signed':'Unsigned'}`, icon:'✍', idx:i, page:f.page });
    }
  });

  editFields.forEach((f,i) => {
    const haystack = (f.name+' '+f.value).toLowerCase();
    if (haystack.includes(q)) {
      results.push({ kind:'edit', label:f.name, sub:`Page ${f.page}${f.value?' · "'+f.value+'"':''}`, icon:f.fieldType==='date'?'📅':'Aa', idx:i, page:f.page });
    }
  });

  const textHits = [];
  allTextItems.forEach((item,i) => {
    if (item.str.toLowerCase().includes(q)) {
      const lo=item.str.toLowerCase(), pos=lo.indexOf(q);
      const before=item.str.slice(0,pos);
      const match =item.str.slice(pos,pos+q.length);
      const after =item.str.slice(pos+q.length);
      textHits.push({ kind:'text', label:item.str, before, match, after, icon:'📄', page:item.page, x:item.x, y:item.y, w:item.w, h:item.h });
    }
  });
  textHits.slice(0,6).forEach(h=>results.push(h));

  renderSearchResults(results, q);
}

function renderSearchResults(results, q) {
  searchResults.innerHTML='';
  if (!results.length) {
    searchResults.innerHTML='<div class="sr-empty">No results found.</div>';
    searchResults.classList.add('open'); return;
  }

  const sigItems  = results.filter(r=>r.kind==='sig');
  const editItems = results.filter(r=>r.kind==='edit');
  const textItems = results.filter(r=>r.kind==='text');

  function group(label, items) {
    if (!items.length) return;
    const gl=document.createElement('div'); gl.className='sr-group-label'; gl.textContent=label;
    searchResults.appendChild(gl);
    items.forEach(r => {
      const el=document.createElement('div'); el.className='sr-item';
      if (r.kind==='text') {
        el.innerHTML=`<span class="sr-item-icon">${r.icon}</span>
          <div style="flex:1;min-width:0;">
            <span class="sr-item-name">${esc(r.before)}<span class="sr-match-hl">${esc(r.match)}</span>${esc(r.after)}</span>
            <span class="sr-item-match">Page ${r.page}</span>
          </div>`;
      } else {
        el.innerHTML=`<span class="sr-item-icon">${r.icon}</span><span class="sr-item-name">${esc(r.label)}</span><span class="sr-item-meta">${esc(r.sub)}</span>`;
      }
      el.addEventListener('click', () => {
        searchResults.classList.remove('open');
        searchInput.blur();
        scrollToResult(r);
      });
      searchResults.appendChild(el);
    });
  }

  group('Signature Fields', sigItems);
  group('Edit Fields', editItems);
  group('In Document', textItems);

  searchResults.classList.add('open');
}

function scrollToResult(r) {
  if (r.kind==='sig'||r.kind==='edit') {
    const fArr = r.kind==='sig'?fields:editFields;
    const inner = pageInners[fArr[r.idx].page];
    if (inner) {
      inner.scrollIntoView({behavior:'smooth',block:'center'});
      const ols = inner.querySelectorAll(r.kind==='sig'?'.sig-ol':'.edit-ol');
      ols.forEach(ol => {
        ol.style.outline='2.5px solid #f59e0b';
        setTimeout(()=>ol.style.outline='',1500);
      });
    }
  } else if (r.kind==='text') {
    const inner = pageInners[r.page];
    if (inner) {
      const { scale, rendH } = pageInfo[r.page];
      const py = rendH - (r.y + r.h) * scale;
      const hl=document.createElement('div');
      hl.style.cssText=`position:absolute;left:${r.x*scale}px;top:${py}px;width:${Math.max(r.w*scale,60)}px;height:${r.h*scale+4}px;background:rgba(245,158,11,.3);border-radius:3px;pointer-events:none;z-index:50;transition:opacity .5s;`;
      inner.appendChild(hl);
      inner.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>{ hl.style.opacity='0'; setTimeout(()=>hl.remove(),500); },1800);
    }
  }
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// UTILS ─────────────────────
function setStatus(cls,txt) {
  document.getElementById('statusPill').className='status-pill '+cls;
  document.getElementById('statusTxt').textContent=txt;
}
function prog(pct) { document.getElementById('progBar').classList.add('show'); document.getElementById('progFill').style.width=pct+'%'; }
function hideProg() { document.getElementById('progBar').classList.remove('show'); document.getElementById('progFill').style.width='0'; }
let _tt;
function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>el.classList.remove('show'),3800);
}

let _rt;
window.addEventListener('resize', () => {
  clearTimeout(_rt);
  _rt=setTimeout(async()=>{ if(pdfJsDoc){ await renderPages(); renderOverlays(); renderEditOverlays(); } },360);
});

initPad();