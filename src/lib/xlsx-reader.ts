import { inflateRawSync } from 'node:zlib'

// ============================================================
// TBL Live v3.0.0 — Lecteur de tableurs (.xlsx / .csv)
//
// Lit le fichier Excel des comptes enseignants préparé par
// l'administrateur (une ligne par enseignant : Prénom, Nom,
// Email institutionnel, Mot de passe — dans cet ordre).
//
// Écrit entièrement en JavaScript SANS bibliothèque externe
// (même politique que xlsx-writer.ts) : aucune dépendance à
// installer, aucun avertissement de sécurité de paquet, la
// lecture fonctionne même hors ligne.
//
// Ce que le lecteur gère :
//  - conteneur ZIP : entrées STOCKÉES (méthode 0, notre générateur)
//    et COMPRESSÉES (méthode 8 / deflate — Excel, LibreOffice,
//    Google Sheets exportent toujours en deflate) ;
//  - annuaire central (tailles fiables même avec « data
//    descriptors ») ;
//  - ordre réel des feuilles via xl/workbook.xml + ses relations ;
//  - chaînes partagées (t="s"), chaînes en ligne (t="inlineStr"),
//    résultats de formules (t="str"), nombres et booléens ;
//  - références de cellules A1…ZZ99, lignes/colonnes dispersées ;
//  - CSV : séparateur auto (, ; ou tabulation), guillemets
//    RFC 4180, BOM UTF-8 retiré.
// ============================================================

export type Cell = string | number | null
export type Row = Cell[]

export interface ParsedSheet {
  name: string
  rows: Row[]
}

export class TableReadError extends Error {}

// ---------------- Décodage texte ----------------

const DECODER = new TextDecoder('utf-8')

function decodeUtf8(bytes: Uint8Array): string {
  return DECODER.decode(bytes)
}

/** Décodes les entités XML (&amp; &lt; &#233; …) d'un texte de cellule. */
function xmlText(raw: string): string {
  let s = raw
  if (!s.includes('&')) return s
  s = s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return s
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return ''
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

/** Extrait le texte intérieur d'un élément (le PREMIER trouvé), même
 *  s'il est découpé en fragments <r><t>…</t></r> (rich text). */
function innerText(xml: string, tag: string): string | null {
  // Recherche du premier <tag …> (le tag peut porter des attributs).
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'i').exec(xml)
  if (!open) return null
  const start = open.index + open[0].length
  const close = xml.indexOf(`</${tag}>`, start)
  if (close === -1) return null
  const inner = xml.slice(start, close)
  // Riche texte : <r><t>frag</t></r> concaténés.
  if (/<r(?:\s[^>]*)?>/i.test(inner) && /<t(?:\s[^>]*)?>/i.test(inner)) {
    const fragments: string[] = []
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(inner)) !== null) fragments.push(m[1])
    return xmlText(fragments.join(''))
  }
  return xmlText(inner)
}

// ---------------- Conteneur ZIP ----------------

interface ZipEntry {
  name: string
  method: number
  compSize: number
  uncompSize: number
  localOffset: number
}

/** Analyse l'annuaire central d'un ZIP (PK\x01\x02) : tailles et
 *  positions fiables, indépendantes des « data descriptors ». */
function readZipEntries(buf: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  // Le XML peut lui-même contenir la signature en texte : on ne garde
  // que les en-têtes dont la structure est cohérente (46 octets +
  // longueurs plausibles, nom ASCII/UTF-8 lisible).
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x01 || buf[i + 3] !== 0x02) {
      continue
    }
    const dv = view(buf, i + 4, 42)
    if (!dv) continue
    // Offsets depuis la fin de la signature (i+4) :
    // version(0) version(2) flags(4) MÉTHODE(6) … compSize(16)
    // uncompSize(20) nameLen(24) extraLen(26) commentLen(28)
    // … localOffset(38).
    const method = dv.getUint16(6, true)
    const compSize = dv.getUint32(16, true)
    const uncompSize = dv.getUint32(20, true)
    const nameLen = dv.getUint16(24, true)
    const extraLen = dv.getUint16(26, true)
    const commentLen = dv.getUint16(28, true)
    if (nameLen === 0 || nameLen > 500 || i + 46 + nameLen + extraLen + commentLen > buf.length) {
      continue
    }
    const name = decodeUtf8(buf.subarray(i + 46, i + 46 + nameLen))
    if (!/^[^\\]+(\/[^\\]*)*$/.test(name) || name.includes('\u0000')) continue
    const localOffset = dv.getUint32(42 - 4, true)
    if (localOffset + 30 > buf.length) continue
    entries.push({ name, method, compSize, uncompSize, localOffset })
    // On saute l'entrée complète pour ne pas retomber sur des
    // signatures dans le nom/extra/commentaire.
    i += 45 + nameLen + extraLen + commentLen
  }
  return entries
}

function view(buf: Uint8Array, offset: number, length: number): DataView | null {
  if (offset < 0 || length < 0 || offset + length > buf.length) return null
  return new DataView(buf.buffer, buf.byteOffset + offset, length)
}

/** Contenu décompressé d'une entrée ZIP (null si absente/illisible). */
function readZipFile(buf: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const dv = view(buf, entry.localOffset + 26, 4)
  if (!dv) return null
  const nameLen = dv.getUint16(0, true)
  const extraLen = dv.getUint16(2, true)
  const dataStart = entry.localOffset + 30 + nameLen + extraLen
  if (dataStart + entry.compSize > buf.length) return null
  const data = buf.subarray(dataStart, dataStart + entry.compSize)
  try {
    if (entry.method === 0) return data
    if (entry.method === 8) return inflateRawSync(data)
  } catch {
    return null
  }
  return null
}

function findEntry(entries: ZipEntry[], name: string): ZipEntry | null {
  for (const e of entries) if (e.name === name) return e
  // Certains générateurs utilisent des « / » en tête.
  for (const e of entries) if (e.name === name.replace(/^\//, '') || `/${e.name}` === name) return e
  return null
}

// ---------------- Références de cellules ----------------

/** « B7 » → 1 (index de colonne, 0 = A). Retourne null si invalide. */
function colIndex(ref: string): number | null {
  const m = /^\$?([A-Za-z]{1,3})\$?\d+$/.exec(ref.trim())
  if (!m) return null
  let n = 0
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// ---------------- Feuille (sheetData) ----------------

/** Marqueur : indice dans les chaînes partagées (résolu ensuite). */
interface SharedRef {
  shared: number
}
type RawCell = Cell | SharedRef
type RawRow = RawCell[]

function isSharedRef(c: RawCell): c is SharedRef {
  return c !== null && typeof c === 'object' && 'shared' in (c as object)
}

function parseSheetXml(xml: string): RawRow[] {
  // Découpe par lignes <row …>…</row> (les lignes vides sans cellule
  // n'ont pas de <c> et n'importent pas).
  const rows: RawRow[] = []
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells: RawRow = []
    const body = rowMatch[1] ?? ''
    const cellRe = /<c(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(body)) !== null) {
      const whole = cellMatch[0]
      const inner = cellMatch[1] ?? ''
      // Attribut r="A1" : position de la colonne.
      const refMatch = /\sr="([A-Za-z]{1,3}\d+)"/.exec(whole)
      const ci = refMatch ? colIndex(refMatch[1]) : cells.length
      if (ci === null || ci > 4095) continue
      // Type de cellule.
      const typeMatch = /\st="([^"]+)"/.exec(whole)
      const type = typeMatch ? typeMatch[1] : 'n'
      let value: RawCell = null
      if (type === 'inlineStr') {
        const t = innerText(inner, 't')
        value = t === null ? null : t
      } else if (type === 's') {
        // Indice dans les chaînes partagées (résolu après coup).
        const v = innerText(inner, 'v')
        const idx = v === null ? NaN : Number(v)
        value = Number.isInteger(idx) && idx >= 0 ? { shared: idx } : null
      } else if (type === 'str') {
        const v = innerText(inner, 'v')
        value = v === null ? null : xmlText(v)
      } else if (type === 'b') {
        const v = innerText(inner, 'v')
        value = v === '1' ? 1 : 0
      } else {
        const v = innerText(inner, 'v')
        if (v !== null && v.trim() !== '' && Number.isFinite(Number(v))) value = Number(v)
      }
      // Étend la ligne jusqu'à la colonne (cellules dispersées).
      while (cells.length < ci) cells.push(null)
      cells[ci] = value
    }
    if (cells.length > 0) rows.push(cells)
  }
  // Largeur homogène : les cellules vides en fin de ligne n'existent
  // pas dans le XML (Excel ne les écrit pas) — on comble avec null
  // pour que row[3] soit null plutôt qu'undefined chez l'appelant.
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  for (const r of rows) while (r.length < width) r.push(null)
  return rows
}

/** Remplace les marqueurs d'indice par les chaînes partagées. */
function resolveShared(rows: RawRow[], shared: string[]): Row[] {
  return rows.map((row) =>
    row.map((c) => {
      if (isSharedRef(c)) {
        return c.shared < shared.length ? shared[c.shared] : null
      }
      return c as Cell
    })
  )
}

// ---------------- Chaînes partagées ----------------

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/gi
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    const body = m[1] ?? ''
    const t = innerText(body, 't')
    out.push(t ?? '')
  }
  return out
}

// ---------------- Classeur ----------------

/** Nom de la PREMIÈRE feuille du classeur (ordre déclaré dans
 *  xl/workbook.xml, résolu via xl/_rels/workbook.xml.rels). */
function firstSheetPath(
  entries: ZipEntry[],
  buf: Uint8Array
): { path: string; name: string } | null {
  const wbEntry = findEntry(entries, 'xl/workbook.xml')
  const relsEntry = findEntry(entries, 'xl/_rels/workbook.xml.rels')
  if (!wbEntry) return null
  const wbXml = decodeUtf8(readZipFile(buf, wbEntry) ?? new Uint8Array())
  // Premier <sheet name="…" r:id="rIdN"/>
  const sheetMatch = /<sheet(?:\s[^>]*)\/>/.exec(wbXml)
  const nameMatch = /\sname="([^"]*)"/.exec(sheetMatch?.[0] ?? '')
  const ridMatch = /\sr:id="([^"]+)"/.exec(sheetMatch?.[0] ?? '')
  const sheetName = nameMatch ? xmlText(nameMatch[1]) : 'Feuille 1'
  if (relsEntry && ridMatch) {
    const relsXml = decodeUtf8(readZipFile(buf, relsEntry) ?? new Uint8Array())
    const rid = xmlText(ridMatch[1])
    // Id= peut être dans l'attribut Id, rId ou Target selon les
    // générateurs — on cherche la relation dont l'identifiant
    // correspond, puis sa cible.
    const relRe = /<Relationship(?:\s[^>]*)\/>/g
    let rel: RegExpExecArray | null
    while ((rel = relRe.exec(relsXml)) !== null) {
      const id = /\sId="([^"]*)"/.exec(rel[0])
      if (id && xmlText(id[1]) === rid) {
        const target = /\sTarget="([^"]*)"/.exec(rel[0])
        if (target) {
          let t = xmlText(target[1])
          t = t.replace(/\\/g, '/')
          const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`
          if (findEntry(entries, path)) return { path, name: sheetName }
        }
      }
    }
  }
  // Repli : première feuille au chemin standard.
  for (const cand of ['xl/worksheets/sheet1.xml', 'xl/worksheets/1.xml']) {
    if (findEntry(entries, cand)) return { path: cand, name: sheetName }
  }
  return null
}

/** Parse un fichier .xlsx : retourne la PREMIÈRE feuille (nom + lignes). */
export function parseXlsx(buffer: Uint8Array): ParsedSheet {
  if (buffer.length < 100) throw new TableReadError('Fichier trop court pour être un classeur Excel.')
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new TableReadError(
      'Ce fichier n’est pas un classeur Excel (.xlsx). Utilisez « Enregistrer sous » → format Excel, ou un fichier CSV.'
    )
  }
  const entries = readZipEntries(buffer)
  if (entries.length === 0) {
    throw new TableReadError('Classeur Excel illisible (annuaire ZIP introuvable).')
  }
  const sheet = firstSheetPath(entries, buffer)
  if (!sheet) {
    throw new TableReadError('Aucune feuille trouvée dans le classeur Excel.')
  }
  const sheetEntry = findEntry(entries, sheet.path)!
  const sheetXml = decodeUtf8(readZipFile(buffer, sheetEntry) ?? new Uint8Array())
  if (!/<row/i.test(sheetXml)) {
    throw new TableReadError('La première feuille du classeur est vide.')
  }
  const rawRows = parseSheetXml(sheetXml)
  const sharedEntry = findEntry(entries, 'xl/sharedStrings.xml')
  let rows: Row[]
  if (sharedEntry) {
    const sharedXml = decodeUtf8(readZipFile(buffer, sharedEntry) ?? new Uint8Array())
    rows = resolveShared(rawRows, parseSharedStrings(sharedXml))
  } else {
    rows = resolveShared(rawRows, [])
  }
  if (rows.length === 0) {
    throw new TableReadError('La première feuille du classeur est vide.')
  }
  return { name: sheet.name, rows }
}

// ---------------- CSV ----------------

/** Détecte le séparateur (, ; ou tabulation) sur la première ligne. */
function detectDelimiter(line: string): string {
  const counts: [string, number][] = [
    [';', countOutsideQuotes(line, ';')],
    [',', countOutsideQuotes(line, ',')],
    ['\t', countOutsideQuotes(line, '\t')],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ';'
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuotes = !inQuotes
    else if (c === ch && !inQuotes) n++
  }
  return n
}

/** Parse un CSV (RFC 4180 approximatif : guillemets, retours à la
 *  ligne dans les guillemets). */
export function parseCsv(text: string): Row[] {
  let s = text
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // BOM UTF-8
  const rows: Row[] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const delimiter = detectDelimiter(s.split(/\r\n|\n|\r/, 1)[0] ?? '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      cell = ''
    } else {
      cell += c
    }
  }
  row.push(cell)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows.map((r) => r.map((v) => (v === '' ? null : v)))
}

// ---------------- API unifiée (comptes enseignants) ----------------

export interface AccountRow {
  firstName: string
  lastName: string
  email: string
  password: string
}

const HEADER_HINTS = ['email', 'e-mail', 'mail', 'courriel', 'prénom', 'prenom', 'nom']

/** Une ligne est-elle une ligne d'en-tête ? (détection tolérante :
 *  « Prénom », « Email institutionnel », en-têtes anglais…) */
function isHeaderRow(row: Row): boolean {
  const joined = row
    .map((c) => (typeof c === 'string' ? c.toLowerCase() : ''))
    .join(' ')
  return HEADER_HINTS.some((h) => joined.includes(h))
}

function cellText(c: Cell): string {
  if (c === null || c === undefined) return ''
  return String(c).trim()
}

/**
 * Lit un fichier de comptes (.xlsx ou .csv) et retourne les lignes
 * d'enseignants : Prénom, Nom, Email institutionnel, Mot de passe
 * (le mot de passe peut être vide : l'administrateur laisse le
 * champ vide et l'application en génère un). La première ligne est
 * ignorée si elle ressemble à un en-tête.
 */
export function parseAccountsFile(
  buffer: Uint8Array,
  filename: string
): { rows: AccountRow[]; skippedHeader: boolean; sheetName: string } {
  const isCsv = /\.csv$/i.test(filename) || (filename.length > 0 && !/\.xlsx$/i.test(filename) && buffer[0] !== 0x50)
  let raw: Row[]
  let sheetName = 'Comptes'
  if (isCsv) {
    raw = parseCsv(decodeUtf8(buffer))
  } else {
    const sheet = parseXlsx(buffer)
    raw = sheet.rows
    sheetName = sheet.name
  }
  if (raw.length === 0) {
    throw new TableReadError('Le fichier ne contient aucune ligne.')
  }
  if (raw.length > 1000) {
    throw new TableReadError('Le fichier contient plus de 1000 lignes (maximum : 1000 comptes par import).')
  }
  let skippedHeader = false
  if (isHeaderRow(raw[0])) {
    raw = raw.slice(1)
    skippedHeader = true
  }
  const rows: AccountRow[] = []
  for (const r of raw) {
    const firstName = cellText(r[0])
    const lastName = cellText(r[1])
    const email = cellText(r[2]).toLowerCase()
    const password = cellText(r[3])
    // Ligne entièrement vide : ignorée silencieusement.
    if (!firstName && !lastName && !email && !password) continue
    rows.push({ firstName, lastName, email, password })
  }
  return { rows, skippedHeader, sheetName }
}
