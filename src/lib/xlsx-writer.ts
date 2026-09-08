// ============================================================
// TBL Live v2.7.0 — Générateur de classeurs Excel (.xlsx)
//
// Écrit un VRAI fichier .xlsx (format OOXML, ECMA-376) entièrement
// en JavaScript, SANS bibliothèque externe : l'application garde
// ses dépendances verrouillées (aucun npm install côté enseignant,
// aucun avertissement de sécurité de paquet, fonctionnement hors
// ligne garanti).
//
// Structure produite :
//  [Content_Types].xml
//  _rels/.rels
//  xl/workbook.xml            (3 feuilles : Résultats / Docimologie / Questionnaire)
//  xl/_rels/workbook.xml.rels
//  xl/styles.xml              (gras pour les en-têtes)
//  xl/worksheets/sheetN.xml
//
// Le conteneur est un ZIP « stocké » (sans compression) : méthode
// valide lue par Excel, LibreOffice, Google Sheets et Numbers.
// ============================================================

export interface SheetSpec {
  /** Nom de l'onglet (31 caractères max, sans : \ / ? * [ ]) */
  name: string
  /** Matrice : chaque ligne = tableau de cellules (string | number | null) */
  rows: (string | number | null | undefined)[][]
  /** Largeur des colonnes (caractères, index 0 = colonne A) */
  colWidths?: Record<number, number>
  /** Index des lignes d'en-tête (style gras + fond, figées au défilement
   *  pour la première si elle est en tête). */
  boldRows?: number[]
}

// ---------------- Échappement XML ----------------

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Caractères de contrôle interdits en XML (Excel refuse le fichier sinon)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

// ---------------- CRC32 (ZIP) ----------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---------------- Références de cellules ----------------

/** 0 → A, 1 → B, 25 → Z, 26 → AA… */
function colRef(index: number): string {
  let s = ''
  let n = index
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

// ---------------- Contenu d'une feuille ----------------

function sheetXml(spec: SheetSpec): string {
  const rows = spec.rows
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const boldRows = new Set(spec.boldRows ?? (rows.length > 0 ? [0] : []))
  const parts: string[] = []
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  )
  // Ordre imposé par le schéma OOXML : sheetViews AVANT cols AVANT sheetData.
  // Première ligne figée (volet) si elle est un en-tête (boldRows contient 0).
  if (rows.length > 0 && boldRows.has(0)) {
    parts.push(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    )
  } else {
    parts.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
  }
  // Largeurs de colonnes : la largeur par défaut vient d'abord, les
  // personnalisées ensuite (la dernière indication gagne dans Excel).
  const widths = spec.colWidths ?? {}
  const widthEntries: string[] = []
  for (const [idx, w] of Object.entries(widths)) {
    const i = Number(idx)
    if (Number.isInteger(i) && i >= 0 && i < maxCols) {
      widthEntries.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    }
  }
  if (maxCols > 0) {
    parts.push(
      `<cols><col min="1" max="${maxCols}" width="14" customWidth="1"/>${widthEntries.join('')}</cols>`
    )
  }
  parts.push('<sheetData>')
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    parts.push(`<row r="${ri + 1}">`)
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci]
      if (cell === null || cell === undefined || cell === '') continue
      const ref = `${colRef(ci)}${ri + 1}`
      const style = boldRows.has(ri) ? ' s="1"' : ''
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        parts.push(`<c r="${ref}"${style}><v>${cell}</v></c>`)
      } else {
        parts.push(
          `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(cell))}</t></is></c>`
        )
      }
    }
    parts.push('</row>')
  }
  parts.push('</sheetData>')
  parts.push('</worksheet>')
  return parts.join('')
}

// ---------------- styles.xml minimal ----------------

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF1C1917"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F4"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

// ---------------- Assemblage du classeur ----------------

/** Date/heure DOS pour les entrées ZIP (2 secondes de granularité). */
function dosTime(d: Date): { time: number; date: number } {
  const time =
    (Math.floor(d.getHours() / 2) << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function sanitizeSheetName(name: string, index: number): string {
  let n = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)
  if (!n) n = `Feuille ${index + 1}`
  return n
}

/** Construit le fichier .xlsx complet (Blob prêt à télécharger). */
export function buildXlsx(sheets: SheetSpec[]): Blob {
  const names = sheets.map((s, i) => sanitizeSheetName(s.name, i))
  const files: { path: string; content: string }[] = []

  files.push({ path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('\n')}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` })

  files.push({ path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` })

  files.push({ path: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheets
  .map(
    (_, i) =>
      `    <sheet name="${esc(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  )
  .join('\n')}
  </sheets>
</workbook>` })

  files.push({ path: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join('\n')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` })

  files.push({ path: 'xl/styles.xml', content: STYLES_XML })
  for (let i = 0; i < sheets.length; i++) {
    files.push({ path: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(sheets[i]) })
  }

  // ---------------- ZIP (stocké, sans compression) ----------------
  const encoder = new TextEncoder()
  const now = dosTime(new Date())
  const localChunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = encoder.encode(f.path)
    const dataBytes = encoder.encode(f.content)
    const crc = crc32(dataBytes)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version min
    lv.setUint16(6, 0x0800, true) // flags : nom encodé UTF-8
    lv.setUint16(8, 0, true) // méthode : stocké
    lv.setUint16(10, now.time, true)
    lv.setUint16(12, now.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, dataBytes.length, true)
    lv.setUint32(22, dataBytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    const centralEntry = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(centralEntry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version faite par
    cv.setUint16(6, 20, true) // version min
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, now.time, true)
    cv.setUint16(14, now.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, dataBytes.length, true)
    cv.setUint32(24, dataBytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // commentaire
    cv.setUint16(32, 0, true) // disque
    cv.setUint16(34, 0, true) // attributs internes
    cv.setUint32(36, 0, true) // attributs externes
    // Position 42 : décalage de l'en-tête LOCAL de ce fichier (38 = attributs
    // externes — ne pas confondre, erreur classique du format ZIP).
    cv.setUint32(42, offset, true)
    centralEntry.set(nameBytes, 46)

    localChunks.push(local, dataBytes)
    central.push(centralEntry)
    offset += local.length + dataBytes.length
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  const totalLength =
    localChunks.reduce((s, c) => s + c.length, 0) + centralSize + eocd.length
  const out = new Uint8Array(totalLength)
  let pos = 0
  for (const chunk of [...localChunks, ...central, eocd]) {
    out.set(chunk, pos)
    pos += chunk.length
  }

  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Déclenche le téléchargement d'un Blob (même mécanisme que les CSV). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
