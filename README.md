# SignFlow Digital PDF Signing Tool

> A lightweight, fully client-side PDF signing and editing tool. No server. No uploads. No account required. Just open, sign, edit and download.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [How It Works](#how-it-works)
4. [Getting Started](#getting-started)
5. [Usage Guide](#usage-guide)
6. [Signature Field Detection](#signature-field-detection)
7. [Edit Field Detection](#edit-field-detection)
8. [Drag & Reposition](#drag--reposition)
9. [Search](#search)
10. [Technical Architecture](#technical-architecture)
11. [Dependencies](#dependencies)
12. [Browser Compatibility](#browser-compatibility)
13. [Limitations & Honest Disclaimers](#limitations--honest-disclaimers)
14. [File Structure](#file-structure)
15. [Customisation](#customisation)
16. [Roadmap / Possible Enhancements](#roadmap--possible-enhancements)

---

## Overview

SignFlow is a three-file web application (`index.html`, `styles.css`, `script.js`) that lets users sign and fill PDF documents entirely inside the browser. Draw your signature once, apply it to as many signature fields as needed, type into detected text and date fields, then download a clean PDF all without sending a single byte to a server.

The interface is built around a **full-bleed document viewer** and a **dynamic island bar** pinned to the bottom of the screen, keeping the document always fully visible and unobstructed.

---

## Features

### Core
- **PDF-only upload enforcement** accepts `.pdf` files exclusively, validated by MIME type and file extension
- **Drag & drop or click to upload** flexible file input via full-screen drop overlay or the Upload modal
- **Full document preview** every page rendered to canvas via pdf.js so you see exactly where fields land
- **Multi-page support** handles documents of any length; each page renders independently

### Dynamic Island Bar
- **Full-width, fixed to the bottom** spans 100% of the device width, flush to the bottom edge with safe-area inset support for notched phones
- **Not movable** stationary by design for predictable interaction
- **Adapts to screen width** buttons fill available space evenly using `justify-content: space-around`; on wider screens the inner content caps at 860px
- **Glassmorphism** backdrop blur + semi-transparent surface that lets the document show through
- **Five actions**: Upload · Signature · Edit · Fields · Place · Download
- **Live badges** each button shows a count of unsigned/unfilled fields; turns green with a checkmark when all are done

### Signature Pad
- **Freehand drawing** draw with mouse or touch stylus
- **Smooth strokes** rounded line caps and joins for a natural pen feel
- **High-DPI aware** canvas scales with `devicePixelRatio` for crisp rendering on retina displays
- **Draw-once, apply everywhere** tap "Use this signature" to commit it; it is then reused across all signature fields without redrawing
- **Safe canvas resize** reopening the signature modal never wipes a drawn signature; dimensions are only reset if nothing has been drawn, or the drawing is preserved via snapshot if the viewport changed
- **Clear button** wipe and redraw at any time

### Edit Fields (Text & Date)
- **Auto-detection** scans every page for label-style field indicators: Name, Date, Email, Phone, Title, Company, Address, Print Name and more
- **AcroForm text fields** reads existing interactive `PDFTextField` fields from the document
- **Inline popover editor** clicking any edit overlay opens a small popover positioned near the field with a context-appropriate input (`text` or `date`)
- **Date formatting** date inputs are formatted as "15 Jan 2025" in the downloaded PDF
- **Distinct visual style** edit overlays use blue dashed borders to distinguish them from green signature overlays
- **Manual placement** add a text or date field anywhere by selecting the type in the Place modal and clicking on the document
- **Embedded as real text** values are written into the PDF using `pdf-lib`'s `drawText` with Helvetica, not as images

### Signature Field Detection
- **AcroForm field detection** reads formal `PDFSignature` fields and fields whose names match signature patterns
- **Text keyword scan** two-pass scan across all pages for label-style and phrase-style signature indicators
- **Smart bounding box** overlay is positioned after the label text, right on the blank underline
- **Lookahead underline measurement** scans ahead up to 5 text items on the same baseline to measure the actual blank line width
- **Deduplication** AcroForm positions are registered first; text-detected fields skip any area already covered

### Field Management
- **Fields modal** all detected signature fields listed with page number and status (Form / Auto / Manual / ✓ Signed)
- **Edit modal** all detected text/date fields listed with current value and type
- **Click to sign** click any field overlay on the document or any entry in the Fields list
- **Click to edit** click any edit overlay or entry in the Edit list to open the inline popover
- **Manual placement** select field type (Signature / Text / Date) then click anywhere on any page
- **Remove fields** hover any overlay and click the × button to delete it

### Drag & Reposition
- **Drag any field** both signature and edit overlays are draggable
- **Constrained to page** clamped to page boundaries so fields can never be placed outside the document
- **Click vs. drag discrimination** moves under 3px are treated as a click; larger moves reposition without triggering sign/edit
- **PDF coordinate sync** on drop, pixel position is converted back to PDF coordinate space (origin bottom-left)
- **Touch support** works on mobile and tablet touchscreens

### Search
- **Center search bar** always centered in the top bar between the logo and status pill, at any screen width
- **Searches three categories** simultaneously: signature field names, edit field names and values and all raw text items extracted from every page
- **Grouped results** results appear in a dropdown grouped as "Signature Fields", "Edit Fields" and "In Document"
- **Match highlighting** matched characters are highlighted in yellow within in-document text results
- **Click to navigate** clicking any result scrolls the document to that field or text item and flashes a temporary amber highlight

### Download
- **Clean PDF output** a fresh copy of the original PDF is loaded from the original `ArrayBuffer`; no in-memory corruption from the rendering state
- **AcroForm flattening** existing interactive form fields are flattened before writing, preventing conflicts with PDF viewers
- **Signature as image** drawn signature PNG is embedded at the exact field coordinates
- **Text as real text** typed values are embedded using `pdf-lib` `drawText` with Helvetica
- **No decoration lines** no underlines or rules are added beneath signatures, dates, or text entries
- **Browser download** signed PDF delivered directly to the downloads folder via an object URL; no data touches any server

### UI & Responsiveness
- **Full-bleed viewer** document always occupies the entire screen; no sidebar competing for space
- **Fully responsive** adapts from 320px mobile to 4K desktop; island bar and modals reflow naturally
- **Bottom-sheet modals** slide up from the bottom on mobile; center-positioned on larger screens; tap the backdrop to dismiss
- **Placing hint bar** floats just above the island bar when placement mode is active, confirming the active mode with a Cancel option
- **Progress bar** tracks loading through five stages
- **Status pill** top-right indicator: idle / scanning (animated gold dot) / active (green dot)
- **Toast notifications** non-intrusive bottom-right messages for all key events
- **Edit popover** inline text input positioned near the field being edited

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
       └──► Copy B → pdf-lib (parses AcroForm fields; used for writing)
                │
                ▼
          Two-pass field scan
          ├── Pass 1: AcroForm (PDFSignature + PDFTextField)
          └── Pass 2: Text content (keyword regex matching)
                │
          Signature overlays (green dashed) + Edit overlays (blue dashed)
          drawn on rendered pages
                │
          User draws signature on pad → commits with "Use this signature"
          User clicks signature field overlay → signature PNG applied
          User clicks edit field overlay → inline popover → types value
                │
          User drags to fine-tune position (optional)
                │
                ▼
          Download triggered:
          Fresh copy loaded from original ArrayBuffer
          AcroForm flattened
          Signature PNGs embedded at field coordinates
          Text values embedded as Helvetica drawText
          PDF saved → Blob → object URL → browser download
```

---

## Getting Started

SignFlow is three files: `index.html`, `styles.css` and `script.js`. There is no build step, no package manager, no server required.

**To run locally:**

1. Download all three files into the same folder
2. Serve with any static file server:

```bash
# Python (built-in)
python -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code
# Use the Live Server extension and click "Go Live"
```

Then visit `http://localhost:8080` in your browser.

> **Important:** Do not open via `file://` protocol some Chromium versions block the pdf.js web worker under that protocol due to same-origin restrictions on local files. Always use a local server.

**To deploy:**

Drop all three files into any static hosting service GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a plain web server. No backend configuration needed.

---

## Usage Guide

### Step 1 Upload your PDF

Drag and drop a PDF onto the full-screen upload zone, or click it to browse. Alternatively, tap the **📄 Upload** button in the island bar at any time to change the document. Once loaded, all pages render and the scanner runs automatically.

### Step 2 Draw your signature

Tap **✍ Signature** in the island bar. Draw with your mouse or finger in the signature pad. If you make a mistake, press **Clear** and redraw. When happy, press **Use this signature ✓** this commits the signature for reuse across all fields without needing to redraw.

### Step 3 Review detected fields

The document preview shows:
- **Green dashed overlays** signature fields
- **Blue dashed overlays** text / date edit fields

The **📋 Fields** and **✏️ Edit** buttons in the island bar show a badge count of unsigned / unfilled fields.

### Step 4 Sign signature fields

Click any green field overlay on the document, or tap **📋 Fields** and click an entry in the list. Your committed signature is immediately applied.

### Step 5 Fill edit fields

Click any blue field overlay on the document, or tap **✏️ Edit** and click an entry in the list. A small popover appears near the field type a name, select a date, or enter any text, then press **Apply ✓**.

### Step 6 Reposition if needed

Hover any overlay to reveal a ⠿ grip handle (top-left) and × delete button (top-right). Drag the overlay to adjust its position. The PDF coordinates update in real time.

### Step 7 Add fields manually

Tap **📍 Place** in the island bar. Select the field type: **Signature**, **Text**, or **Date**. Press **Start placing →**, then click anywhere on any page to drop the field. A placing hint bar floats above the island bar while the mode is active tap **Cancel** to exit without placing.

### Step 8 Search

Use the search bar centered in the top header to find any field or text across the document. Results are grouped by type and clicking one scrolls directly to it with a flash highlight.

### Step 9 Download

Once all signature fields are signed, the **⬇ Download** button activates (turns green with 🎉). Click it to download `signed_document.pdf` to your device.

---

## Signature Field Detection

The scanner runs two passes in sequence:

### Pass 1 AcroForm Fields

PDF documents created with tools like Adobe Acrobat, DocuSign, or government form builders often embed formal interactive fields. The scanner matches fields of type `PDFSignature` or with names containing:

- `sign`, `sig`, `signature`, `signed`
- `initials`, `initial`
- `authorized`, `author`

### Pass 2 Text Content Scan

For regular documents (Word exports, typed contracts, scanned templates) with no form fields, the scanner reads every text item on every page against two pattern categories:

**Label patterns** (short labels at the start of a signature line):

| Pattern | Example matches |
|---|---|
| `Signed:` | `Signed:`, `Signed by:` |
| `Signature:` | `Signature:`, `Signature` |
| `Sig:` | `Sig:` |
| `Initials:` | `Initials:`, `Initial:` |
| `Authorized by:` | `Authorized by:` |
| `Witness:` | `Witness:` |

**Phrase patterns** (longer descriptive phrases anywhere in the text):

- `Sign here` · `Applicant Signature` · `Employee Signature`
- `Customer Signature` · `Signature of` · `Your Signature`

For label matches, the overlay is placed **after** the label text, on the blank underline. A lookahead scan of up to 5 subsequent text items on the same baseline measures the actual underline width.

---

## Edit Field Detection

### AcroForm Text Fields

`PDFTextField` fields are read from the document's AcroForm dictionary. Fields whose names contain `date`, `dob`, or `born` are treated as date fields; all others as text fields.

### Text Label Scan

The same text content scan that detects signature fields also detects edit field labels:

| Label pattern | Field type |
|---|---|
| `Name`, `Full name`, `First/Last name`, `Printed name` | Text |
| `Date`, `Date of…` | Date |
| `Email`, `E-mail` | Text |
| `Phone`, `Tel` | Text |
| `Title`, `Position` | Text |
| `Company`, `Organization` | Text |
| `Address` | Text |

The overlay is positioned after the label on the blank underline, with width measured by lookahead identical to signature detection.

---

## Drag & Reposition

Every overlay unsigned or signed, empty or filled supports drag-to-reposition:

- **Hover** to reveal the ⠿ grip handle (top-left) and × delete button (top-right)
- **Drag** from anywhere on the overlay to reposition; movement is clamped to the page boundary
- A **3px movement threshold** separates a drag from a click; below the threshold a mousedown+mouseup is a click-to-sign/edit
- On drag end, `x` and `y` are converted from screen pixels back to PDF coordinate space (origin bottom-left)
- Works with **mouse** (desktop) and **touch** (mobile / tablet)

---

## Search

The search bar lives in the center of the top header and is always visible once a document is loaded.

- **Minimum 2 characters** to trigger a search
- **Three result groups:**
  - *Signature Fields* matches field names; clicking scrolls to the overlay and flashes it amber
  - *Edit Fields* matches field names and current values; same scroll behaviour
  - *In Document* matches raw text extracted from pages; clicking scrolls to the text and overlays a temporary amber highlight rectangle
- **Match highlighting** the exact matched substring is highlighted in yellow within in-document results
- **Clear button** × appears when there is input; clears and closes results
- **Click outside** dismisses the results dropdown

---

## Technical Architecture

SignFlow is built on web standards with no framework or build toolchain.

### Dual PDF library strategy

Two separate PDF libraries operate on independent copies of the original `ArrayBuffer`:

**pdf.js** (Mozilla) used exclusively for rendering pages to `<canvas>` elements. It cannot modify PDFs.

**pdf-lib** used for reading AcroForm field data during scan and for all write operations during download (embedding signature images, embedding text, flattening form fields). It cannot render page visuals.

Both receive a `.slice(0)` copy of the original buffer so neither operation corrupts the other's state.

### Coordinate system

PDF coordinate space has its origin at the **bottom-left** of each page, with y increasing upward. Canvas coordinate space has its origin at the **top-left**, with y increasing downward. All conversions use:

```
pdfY = pageHeightInPoints - (canvasPixelY / scale)
pdfX = canvasPixelX / scale
```

This conversion is applied when placing manual fields, when syncing dragged positions and when embedding content into the output PDF.

### Signature capture

The signature pad canvas is scaled by `devicePixelRatio` so strokes are physically correct on high-DPI displays. On commit, `canvas.toDataURL('image/png')` captures a transparent PNG. The PNG is base64-decoded to a `Uint8Array` and embedded via `pdfDoc.embedPng()`.

The pad is never blindly reinitialized canvas dimensions are only reset when nothing has been drawn, or the prior drawing is snapshotted and redrawn after resize to prevent data loss.

### Text embedding

Edit field values are written into the PDF using `pdfDoc.embedFont(StandardFonts.Helvetica)` and `page.drawText()` with `maxWidth` clamping. Date values from `<input type="date">` (YYYY-MM-DD) are reformatted to "D Mon YYYY" before embedding.

---

## Dependencies

All dependencies loaded from CDN no local installation required.

| Library | Version | Purpose | CDN |
|---|---|---|---|
| pdf.js | 3.11.174 | PDF page rendering to canvas | cdnjs.cloudflare.com |
| pdf-lib | 1.17.1 | PDF reading and writing | cdnjs.cloudflare.com |
| Google Fonts | | Instrument Serif, DM Sans | fonts.googleapis.com |

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

> Must be served over `http://` or `https://`. Opening via `file://` may cause the pdf.js worker to fail in some browsers due to same-origin restrictions.

---

## Limitations & Honest Disclaimers

**Legal validity** SignFlow embeds a drawn image into a PDF. This is a visual signature, not a cryptographic one. It does not include a digital certificate, PKI signing, audit trail, signer identity verification, or tamper detection. For legally binding contracts, regulated industries, or jurisdictions requiring qualified electronic signatures (e.g. eIDAS Qualified in the EU), use a compliant service such as DocuSign, Adobe Sign, or a PKI-based tool.

**Password-protected PDFs** encrypted PDFs will fail to load. Decrypt the PDF first before uploading.

**Scanned image PDFs** PDFs that are photographs of paper with no embedded text layer cannot be scanned for text-based fields. Manual field placement handles these documents.

**Field detection accuracy** the text scanner uses pattern matching. Documents with unconventional wording, non-English labels, or unusual layouts may not be auto-detected. Manual placement covers all such cases.

**No persistence** SignFlow holds everything in memory for the duration of the browser session. Closing or refreshing the tab discards all state. There is no autosave.

**Single signer** one signer per session. Multi-party signing workflows are not supported.

---

## File Structure

```
index.html    ← Application shell: HTML structure, modals, island bar, search bar
styles.css    ← All styling: layout, island bar, overlays, modals, search, responsive rules
script.js     ← All logic: PDF loading, field scanning, signature pad, edit popover,
                            drag/reposition, search, download
README.md     ← This document
```

The application is intentionally kept as three plain files trivially deployable, no build step, no dependencies to install.

---

## Customisation

### Changing the colour scheme

All colours are CSS custom properties at the top of `styles.css`:

```css
:root {
  --accent:    #1a5c3e;   /* primary green signature overlays, buttons */
  --accent2:   #27865a;   /* lighter green hover states */
  --accent-bg: #e8f4ed;   /* green tint background */
  --edit-col:  #1e4d8c;   /* blue edit field overlays */
  --edit-bg:   #eaf0fb;   /* blue tint background */
  --gold:      #a07010;   /* gold scanning indicator, tips */
  --danger:    #8b2020;   /* red delete buttons, errors */
  --ink:       #1c1a16;   /* primary text + top bar */
  --bg:        #f0ede6;   /* page background */
  --surface:   #faf9f6;   /* modals and cards */
}
```

### Changing default field sizes

Manual fields and fallback text-detected fields use these defaults in `scanFields()` and the placement click handler:

```js
// Signature fields
width: 180, height: 44    // PDF points

// Edit fields  
width: 140, height: 28    // PDF points
```

### Adding more keyword patterns

Extend `sigLabelPat`, `sigPhrasePat`, or `editLabelPat` arrays in `scanFields()`:

```js
const editLabelPat = [
  { re: /^(full\s+)?name[\s:_]*$/i, type: 'text', label: 'Name' },
  { re: /^your\s+title[\s:_]*$/i,   type: 'text', label: 'Title' }, // ← add here
];
```

---

## Roadmap / Possible Enhancements

- **Initials support** separate smaller pad for initials fields
- **Multi-signer workflow** email-based signing links with a backend session store
- **Cryptographic signing** embed a self-signed or CA-issued X.509 certificate for tamper evidence
- **Audit certificate page** append a final page logging signer IP, user agent and timestamp
- **Signature presets** save drawn signatures to `localStorage` for reuse across sessions
- **Typed signature** generate a stylised text-based signature as an alternative to drawing
- **Zoom controls** zoom in/out on the document preview for precision placement
- **Password-protected PDF support** prompt for a password and decrypt before loading
- **Dark mode** honour `prefers-color-scheme: dark`
- **Non-English label detection** extend pattern matching for French, German, Spanish and other common document languages

---

## Licence

This project is released as open source. You are free to use, modify and distribute it for personal or commercial purposes. Attribution is appreciated but not required.

---

*Built with pdf.js, pdf-lib and vanilla JavaScript. No frameworks were harmed in the making of this tool.*