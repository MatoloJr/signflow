# SignFlow Digital PDF Signing Tool

> A lightweight, fully client-side PDF signing tool. No server. No uploads. No account required. Just open, sign and download.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [How It Works](#how-it-works)
4. [Getting Started](#getting-started)
5. [Usage Guide](#usage-guide)
6. [Signature Field Detection](#signature-field-detection)
7. [Drag & Reposition](#drag--reposition)
8. [Technical Architecture](#technical-architecture)
9. [Dependencies](#dependencies)
10. [Browser Compatibility](#browser-compatibility)
11. [Limitations & Honest Disclaimers](#limitations--honest-disclaimers)
12. [File Structure](#file-structure)
13. [Customisation](#customisation)
14. [Roadmap / Possible Enhancements](#roadmap--possible-enhancements)

---

## Overview

SignFlow is a single-file HTML application that allows users to sign PDF documents digitally without uploading anything to a server. The user draws their signature on a canvas pad, the document is scanned to detect where a signature should go and the signature image is embedded directly into the PDF all inside the browser.

The output is a standard `.pdf` file with the signature rendered as an image at the correct position, ready to share or store.

---

## Features

### Core
- **PDF-only upload enforcement** accepts `.pdf` files exclusively, validated by MIME type and file extension
- **Drag & drop or click to upload** flexible file input
- **Full document preview** every page of the PDF is rendered inside the app using a canvas renderer so you can see exactly where signatures will land
- **Multi-page support** handles documents of any length; each page renders independently

### Signature Pad
- **Freehand drawing** draw your signature with a mouse or touchscreen stylus
- **Smooth strokes** rounded line caps and joins for a natural pen-like feel
- **Clear button** wipe and redraw as many times as needed before applying
- **High-DPI aware** the canvas scales with `devicePixelRatio` so signatures look crisp on retina displays

### Field Detection (Auto-Scan)
- **AcroForm field detection** reads formal PDF form fields of type `PDFSignature` or with field names matching signature-related patterns (`sign`, `sig`, `initials`, `authorized`)
- **Text keyword scan** scans every page's text content for label-style and phrase-style signature indicators
- **Smart bounding box** for label-style fields (e.g. `Signed: ___`), the overlay is positioned after the label text, right on the blank underline, not on top of the label itself
- **Lookahead underline measurement** the scanner looks at adjacent text items on the same baseline to measure the width of the blank line and sizes the signature field to match
- **Deduplication** AcroForm field positions are registered first; text-detected fields skip any area already covered by a form field

### Field Management
- **Sidebar field list** all detected fields listed with page number and detection type (Form / Auto / Manual)
- **Click to sign** click any field in the list or directly on the document overlay to apply your signature
- **Manual placement** if auto-detection finds nothing (or misses a field), enter placement mode and click anywhere on any page to drop a signature field precisely
- **Remove fields** hover any overlay and click the × button to delete a field before signing

### Drag & Reposition
- **Drag any field** both unsigned and already-signed overlays are draggable
- **Constrained to page** dragging is clamped to the page boundaries so the signature can never be placed outside the document
- **Click vs. drag discrimination** moves under 3px are treated as a click-to-sign; larger moves are treated as a reposition, preventing accidental signing when adjusting position
- **PDF coordinate sync** on drop, the pixel position is converted back to PDF coordinate space so the downloaded file reflects the exact visual position
- **Touch support** drag works on mobile and tablet touchscreens

### Download
- **Clean PDF output** a fresh copy of the original PDF is used as the base; no in-memory corruption from the rendering state
- **AcroForm flattening** existing interactive form fields are flattened before writing, preventing conflicts with PDF viewers
- **Signature underline** a thin rule line is drawn beneath the signature image to match standard document formatting
- **Browser download** the signed PDF is delivered directly to the user's downloads folder via an object URL; no data touches any server

### UI & Responsiveness
- **Responsive layout** two-panel layout on desktop (sidebar + viewer), collapsing to a slide-in drawer on screens narrower than 780px
- **Mobile sidebar toggle** hamburger button in the top bar opens/closes the panel on small screens
- **Progress bar** loading progress is tracked through five stages (read → pdf.js parse → pdf-lib parse → render → scan)
- **Status pill** top-right indicator shows document state: idle, scanning, or active (green dot)
- **Toast notifications** non-intrusive bottom-right messages for all key events (signed, remaining fields, errors, download complete)
- **Smooth animations** page load fade-in, dragging shadow lift, field hover highlights

---

## How It Works

```
User uploads PDF
       │
       ▼
FileReader reads as ArrayBuffer
       │
       ├──► Copy A → pdf.js  (renders page canvases for preview)
       │
       └──► Copy B → pdf-lib (parses form fields; used for writing)
                │
                ▼
          Two-pass field scan
          ├── Pass 1: AcroForm (machine-readable form fields)
          └── Pass 2: Text content (keyword regex matching)
                │
                ▼
          Overlays drawn on rendered pages
                │
          User draws signature on pad
                │
          User clicks field overlay → signature PNG embedded in overlay
                │
          User drags to fine-tune position (optional)
                │
                ▼
          Download triggered:
          Fresh copy loaded from original ArrayBuffer
          AcroForm flattened
          Signature PNG embedded at field coordinates
          Underline drawn
          PDF saved → Blob → object URL → browser download
```

---

## Getting Started

SignFlow is a single self-contained HTML file. There is no build step, no package manager, no server required.

**To run locally:**

1. Download `pdf-signer.html`
2. Open it in any modern browser

> **Important:** Do not open via `file://` protocol in browsers that restrict local worker scripts (some Chromium versions). Instead serve it with any static file server:

```bash
# Python (built-in)
python -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code
# Use the Live Server extension and click "Go Live"
```

Then visit `http://localhost:8080/pdf-signer.html` in your browser.

**To deploy:**

Drop the single HTML file into any static hosting service GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a plain web server. No backend configuration needed.

---

## Usage Guide

### Step 1 Upload your PDF

Drag and drop a PDF onto the upload zone, or click it to open the file picker. Only `.pdf` files are accepted. Once loaded, the document preview renders all pages and the scanner runs automatically.

### Step 2 Draw your signature

Use the signature pad in the left sidebar. Draw with your mouse or finger. If you make a mistake, press **Clear** and draw again. Your signature is captured as a transparent PNG from the canvas.

### Step 3 Review detected fields

The sidebar lists all detected signature fields with their page number and detection type. The document preview shows dashed green overlays on each detected position. If a field is misdetected or missing, see the steps below.

### Step 4 Sign

Click any field overlay on the document, or click a field entry in the sidebar list. Your signature is immediately applied and the overlay updates to show the signature image.

### Step 5 Reposition if needed

If the signature landed in the wrong spot, hover the overlay a ⠿ grip handle appears at the top-left. Drag the overlay to the correct position. The coordinates are updated in real time.

### Step 6 Add fields manually (if needed)

If the scanner missed a signature line, click **Place field manually** in the sidebar, then click anywhere on any page in the preview. A new field is placed at that position, ready to sign.

### Step 7 Download

Once all fields are signed, the **Download Signed PDF** button activates. Click it to download `signed_document.pdf` directly to your device.

---

## Signature Field Detection

The scanner runs two passes in sequence:

### Pass 1 AcroForm Fields

PDF documents created with tools like Adobe Acrobat, DocuSign, or government form builders often embed formal interactive fields. The scanner inspects every field in the PDF's AcroForm dictionary and matches those of type `PDFSignature` or with names containing:

- `sign`, `sig`, `signature`, `signed`
- `initials`, `initial`
- `authorized`, `author`

These fields have exact coordinate rectangles, so placement is precise.

### Pass 2 Text Content Scan

For regular documents (Word exports, typed contracts, scanned templates) that have no form fields, the scanner reads every text item on every page and matches against two pattern categories:

**Label patterns** short labels at the start of a signature line:

| Pattern | Matches |
|---|---|
| `Signed:` | `Signed:`, `Signed by:` |
| `Signature:` | `Signature:`, `Signature` |
| `Sign:` | `Sign:` |
| `Sig:` | `Sig:` |
| `Initials:` | `Initials:`, `Initial:` |
| `Authorized by:` | `Authorized by:` |
| `Witness:` | `Witness:` |

For label matches, the overlay is placed **after** the label text starting at `labelX + labelWidth + 4px` so it sits on the blank underline, not over the label word.

**Phrase patterns** longer descriptive phrases anywhere in the text:

- `Sign here`
- `Applicant Signature`
- `Employee Signature`
- `Customer Signature`
- `Signature of`
- `Your Signature`

For phrase matches, the overlay covers the phrase area itself.

### Lookahead Underline Measurement

When a label-style field is found, the scanner looks ahead at up to 5 subsequent text items on the same baseline (within 4pt vertical tolerance). If it finds a string of underscores (`____`) or dashes (`----`), it measures that item's width and uses it as the signature field width. This ensures the overlay matches the actual blank line length in the document.

---

## Drag & Reposition

Every signature field overlay whether unsigned or already signed supports drag-to-reposition:

- **Hover** the overlay to reveal the ⠿ grip handle (top-left) and × delete button (top-right)
- **Click and drag** from anywhere on the overlay (or the grip handle) to move it
- Movement is **clamped to the page** the overlay cannot be dragged outside the page boundary
- A **3px movement threshold** separates a drag from a click. Below the threshold, a mousedown+mouseup is treated as click-to-sign. Above it, it repositions without signing
- On drag end, the field's `x` and `y` coordinates are converted from screen pixels back to PDF coordinate space (origin bottom-left), so the download reflects the dragged position exactly
- Works with both **mouse** (desktop) and **touch** (mobile/tablet)

---

## Technical Architecture

SignFlow is built entirely on web standards with no framework or build toolchain.

### Dual PDF library strategy

Two separate PDF libraries are used for different purposes, each receiving its own independent copy of the original `ArrayBuffer`:

**pdf.js** (Mozilla) used exclusively for rendering pages to `<canvas>` elements for the document preview. It cannot modify PDFs.

**pdf-lib** used for reading the AcroForm field data during scan and for all write operations during download (embedding the signature image, flattening form fields, drawing the underline). It cannot render page visuals.

Both libraries receive a `.slice(0)` copy of the original `ArrayBuffer` so neither operation corrupts the other's state.

### Coordinate system

PDF coordinate space has its origin at the **bottom-left** of each page, with y increasing upward. Canvas coordinate space has its origin at the **top-left**, with y increasing downward. All conversions between screen pixel positions and PDF coordinates use:

```
pdfY = pageHeightInPoints - (canvasPixelY / scale)
pdfX = canvasPixelX / scale
```

This conversion is applied when placing manual fields, when syncing dragged positions and when embedding signatures into the output PDF.

### Signature capture

The signature pad canvas is scaled by `devicePixelRatio` on initialisation so strokes are physically sized correctly on high-DPI displays. On signing, `canvas.toDataURL('image/png')` captures a transparent PNG of the drawn strokes. The PNG is then base64-decoded to a `Uint8Array` and embedded into the output PDF via `pdfDoc.embedPng()`.

---

## Dependencies

All dependencies are loaded from CDN no local installation required.

| Library | Version | Purpose | CDN |
|---|---|---|---|
| pdf.js | 3.11.174 | PDF page rendering to canvas | cdnjs.cloudflare.com |
| pdf-lib | 1.17.1 | PDF reading and writing | cdnjs.cloudflare.com |
| Google Fonts | | Playfair Display, Outfit typefaces | fonts.googleapis.com |

No npm, no bundler, no build step.

---

## Browser Compatibility

| Browser | Support |
|---|---|
| Chrome / Edge 90+ | ✅ Full support |
| Firefox 90+ | ✅ Full support |
| Safari 15+ | ✅ Full support |
| Mobile Chrome (Android) | ✅ Full support including touch drag |
| Mobile Safari (iOS) | ✅ Full support including touch drag |
| Internet Explorer | ❌ Not supported |

> The app must be served over `http://` or `https://`. Opening directly via `file://` may cause the pdf.js web worker to fail in some browsers due to same-origin restrictions on local files. Use a local server (see Getting Started).

---

## Limitations & Honest Disclaimers

**Legal validity** SignFlow embeds a drawn image into a PDF. This is a visual signature, not a cryptographic one. It does not include a digital certificate, PKI signing, audit trail, signer identity verification, or tamper detection. For informal, personal, or low-stakes documents this is often sufficient. For legally binding contracts, regulated industries, or jurisdictions requiring qualified electronic signatures (e.g. eIDAS Qualified in the EU), you should use a compliant service such as DocuSign, Adobe Sign, or a PKI-based tool.

**Password-protected PDFs** encrypted PDFs will fail to load. The user will see an error toast. Decrypt the PDF first before uploading.

**Scanned image PDFs** PDFs that are photographs of paper documents (no embedded text layer) cannot be scanned for text-based fields. Manual field placement is the only option for these documents.

**Signature field detection accuracy** the text scanner uses pattern matching. Documents with unconventional wording, non-English labels, or unusual layouts may not be auto-detected. Manual placement handles all such cases.

**No persistence** SignFlow holds everything in memory for the duration of the browser session. Closing or refreshing the tab discards all state. There is no autosave.

**Single signer** the current implementation supports one signer per session. Multi-party signing workflows (where multiple people need to sign in sequence) are not supported.

---

## File Structure

```
pdf-signer.html          ← The entire application (HTML + CSS + JS, single file)
README.md                ← This document
```

Everything is in one file by design making it trivially deployable and shareable with no dependencies on a file system structure.

---

## Customisation

Because the project is a single HTML file with clearly separated CSS custom properties and JavaScript modules, customisation is straightforward.

### Changing the colour scheme

All colours are defined as CSS custom properties at the top of the `<style>` block:

```css
:root {
  --accent:     #1f5c42;   /* primary green buttons, overlays, accents */
  --accent2:    #2d8a62;   /* lighter green hover states, field dots */
  --accent-bg:  #eaf4ee;   /* green tint background */
  --gold:       #b8860b;   /* warning/scanning indicator */
  --danger:     #8b2525;   /* delete button, error states */
  --ink:        #1a1916;   /* primary text + top bar */
  --bg:         #f7f5f0;   /* page background */
  --surface:    #ffffff;   /* sidebar and cards */
}
```

Replace these values to re-theme the entire application.

### Changing the signature field size defaults

Manual fields and fallback text-detected fields use these defaults in `scanFields()` and the placement click handler:

```js
width: 180,   // default field width in PDF points
height: 44,   // default field height in PDF points
```

Adjust to match the typical signature line size in your documents.

### Adding more keyword patterns

Extend the `labelPatterns` or `phrasePatterns` arrays in `scanFields()` to catch additional language variants:

```js
const labelPatterns = [
  /^sign(ed|ature)?(\s+by)?[\s:_]*$/i,
  /^your\s+name[\s:_]*$/i,      // ← add new patterns here
  /^signee[\s:_]*$/i,
];
```

---

## Roadmap / Possible Enhancements

These features are not currently implemented but represent natural next steps:

- **Date field insertion** auto-detect and fill date fields adjacent to signature lines
- **Initials support** separate smaller pad for initials, applied to initial fields
- **Multi-signer workflow** email-based signing links with a backend session store
- **Cryptographic signing** embed a self-signed or CA-issued X.509 certificate into the PDF for tamper evidence
- **Audit certificate page** append a final page logging the signer's IP, user agent and timestamp
- **Signature presets** save drawn signatures to `localStorage` for reuse across sessions
- **Typed signature** generate a stylised text-based signature as an alternative to drawing
- **Zoom controls** zoom in/out on the document preview for precision placement
- **Password-protected PDF support** prompt for a password and decrypt before loading
- **Dark mode** honour `prefers-color-scheme: dark`

---

## Licence

This project is released as open source. You are free to use, modify and distribute it for personal or commercial purposes. Attribution is appreciated but not required.

---

*Built with pdf.js, pdf-lib and vanilla JavaScript. No frameworks were harmed in the making of this tool.*
