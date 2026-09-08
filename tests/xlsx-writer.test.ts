// v2.7.0 — Tests du générateur Excel (.xlsx) : structure ZIP OOXML,
// noms de feuilles, cellules nombres/chaînes, en-têtes en gras,
// largeurs de colonnes, caractères Unicode.
import { describe, expect, it } from 'vitest'
import { buildXlsx, type SheetSpec } from '../src/lib/xlsx-writer'

function toBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((b) => new Uint8Array(b))
}

const decoder = new TextDecoder()

describe('buildXlsx', () => {
  const sheets: SheetSpec[] = [
    {
      name: 'Résultats',
      rows: [
        ['Étudiant', 'Note', 'Commentaire'],
        ['Léa Martin', 15.5, 'Très bien'],
        ['王芳', 12, null],
      ],
      boldRows: [0],
      colWidths: { 0: 22, 2: 40 },
    },
    {
      name: 'Docimologie',
      rows: [
        ['Section', 'Alpha', 'Interprétation'],
        ['iRAT', 0.71, 'Bonne'],
        ['tRAT', null, '—'],
      ],
      boldRows: [0, 2],
    },
    {
      name: 'Questionnaire',
      rows: [
        ['N°', 'Item', 'Moyenne'],
        [1, 'Je consacre du temps…', 4.25],
      ],
      boldRows: [0],
    },
  ]

  it('produit un Blob non vide', async () => {
    const blob = buildXlsx(sheets)
    expect(blob.size).toBeGreaterThan(2000)
    const bytes = await toBytes(blob)
    // Signature ZIP (PK\x03\x04)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
  })

  it('contient 8 entrées ZIP et se termine par l’EOCD', async () => {
    const bytes = await toBytes(buildXlsx(sheets))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // EOCD = 22 octets à la fin
    const eocd = bytes.length - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    expect(dv.getUint16(eocd + 10, true)).toBe(8) // 8 fichiers
  })

  it('insère les 3 feuilles avec leurs noms (accents inclus)', async () => {
    const bytes = await toBytes(buildXlsx(sheets))
    const text = decoder.decode(bytes)
    expect(text).toContain('Résultats')
    expect(text).toContain('Docimologie')
    expect(text).toContain('Questionnaire')
    // workbook.xml référence bien les 3 feuilles
    expect(text).toContain('<sheet name="Résultats" sheetId="1"')
    expect(text).toContain('<sheet name="Docimologie" sheetId="2"')
    expect(text).toContain('<sheet name="Questionnaire" sheetId="3"')
  })

  it('échappe le XML et conserve l’Unicode', async () => {
    const bytes = await toBytes(
      buildXlsx([
        {
          name: 'Feuille',
          rows: [['a < b & "c"', '中文 العربية', 'Utilisateur & admin']],
        },
      ])
    )
    const text = decoder.decode(bytes)
    expect(text).toContain('a &lt; b &amp; &quot;c&quot;')
    expect(text).toContain('中文 العربية')
    expect(text).toContain('Utilisateur &amp; admin')
  })

  it('écrit les nombres et les chaînes avec les bons types', async () => {
    const bytes = await toBytes(buildXlsx([{ name: 'N', rows: [['Note', 'Nom'], [15.5, 'Léa']] }]))
    const text = decoder.decode(bytes)
    // Nombre : <v>15.5</v> sans type inlineStr
    expect(text).toMatch(/<c r="A2"[^t]*><v>15\.5<\/v><\/c>/)
    // Chaîne : inlineStr
    expect(text).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Léa</t></is></c>')
    // En-tête gras (style s="1")
    expect(text).toContain('<c r="A1" t="inlineStr" s="1">')
  })

  it('saute les cellules vides et pose les largeurs de colonnes', async () => {
    const bytes = await toBytes(
      buildXlsx([
        {
          name: 'X',
          rows: [['A', 'B'], [null, undefined, ''], ['valeur']],
          colWidths: { 0: 30 },
        },
      ])
    )
    const text = decoder.decode(bytes)
    // A2/B2/A3… vides : pas de cellule
    expect(text).not.toContain('r="A2"')
    expect(text).not.toContain('r="B2"')
    // Largeur personnalisée
    expect(text).toContain('<col min="1" max="1" width="30" customWidth="1"/>')
  })

  it('fige la première ligne quand elle est un en-tête', async () => {
    const bytes = await toBytes(buildXlsx([{ name: 'F', rows: [['H'], ['x']] }]))
    const text = decoder.decode(bytes)
    expect(text).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
  })
})
