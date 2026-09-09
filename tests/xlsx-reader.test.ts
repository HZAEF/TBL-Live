// v3.0.0 — Tests du lecteur de tableurs (.xlsx / .csv) :
//  - fichier produit par NOTRE générateur (ZIP stocké, chaînes en
//    ligne) ;
//  - fichier « vrai Excel » (ZIP compressé deflate, chaînes
//    partagées, relations workbook) construit dans le test ;
//  - CSV (séparateur ; , et tabulation, guillemets, BOM) ;
//  - détection d'en-tête, lignes vides, erreurs propres.
import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { buildXlsx, type SheetSpec } from '../src/lib/xlsx-writer'
import {
  parseAccountsFile,
  parseCsv,
  parseXlsx,
  TableReadError,
} from '../src/lib/xlsx-reader'

function toBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((b) => new Uint8Array(b))
}

// ----------------------------------------------------------------
// Constructeur d'un .xlsx « façon Excel » : deflate + sharedStrings
// + workbook/rels (ordre des feuilles réel).
// ----------------------------------------------------------------

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let v = n
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
    table[n] = v >>> 0
  }
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipSpec {
  name: string
  data: Uint8Array
}

/** ZIP avec compression deflate (méthode 8) et annuaire central. */
function buildDeflatedZip(files: ZipSpec[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  for (const f of files) {
    const name = enc.encode(f.name)
    const comp = deflateRawSync(f.data)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length + comp.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version
    lv.setUint16(6, 0, true) // flags
    lv.setUint16(8, 8, true) // méthode : deflate
    lv.setUint32(14, crc, true)
    lv.setUint32(18, comp.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(comp, 30 + name.length)
    chunks.push(local)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, 8, true) // méthode : deflate (offset 10 dans l'annuaire)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, comp.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    central.push(cen)
    offset += local.length
  }
  const centralBuf = concat(central)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralBuf.length, true)
  ev.setUint32(16, offset, true)
  return concat([...chunks, centralBuf, eocd])
}

function concat(list: Uint8Array[]): Uint8Array {
  const total = list.reduce((n, b) => n + b.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const b of list) {
    out.set(b, p)
    p += b.length
  }
  return out
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function excelLikeXlsx(rows: (string | number | null)[][]): Uint8Array {
  const shared: string[] = []
  const sheetRows = rows
    .map((row, ri) => {
      const cells = row
        .map((c, ci) => {
          if (c === null || c === undefined || c === '') return ''
          const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`
          if (typeof c === 'number') {
            return `<c r="${ref}"><v>${c}</v></c>`
          }
          const idx = shared.push(c) - 1
          return `<c r="${ref}" t="s"><v>${idx}</v></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const sheetXml = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  const sharedXml = `${XML_HEAD}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => `<si><t>${s}</t></si>`)
    .join('')}</sst>`
  const workbookXml = `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Comptes" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const relsXml = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
  const enc = new TextEncoder()
  return buildDeflatedZip([
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(relsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
    { name: 'xl/sharedStrings.xml', data: enc.encode(sharedXml) },
  ])
}

// ----------------------------------------------------------------

describe('parseXlsx — fichier produit par notre générateur (stocké, inlineStr)', () => {
  const sheets: SheetSpec[] = [
    {
      name: 'Comptes',
      rows: [
        ['Prénom', 'Nom', 'Email institutionnel', 'Mot de passe'],
        ['Amélia', 'Ben Salah', 'amelia@famso.u-sousse.tn', 'Apero123'],
        ['Youssef', 'Trabelsi', 'youssef@famso.u-sousse.tn', ''],
      ],
    },
  ]

  it('lit les lignes et les cellules', async () => {
    const bytes = await toBytes(buildXlsx(sheets))
    const sheet = parseXlsx(bytes)
    expect(sheet.name).toBe('Comptes')
    expect(sheet.rows).toHaveLength(3)
    expect(sheet.rows[1][0]).toBe('Amélia')
    expect(sheet.rows[2][2]).toBe('youssef@famso.u-sousse.tn')
    expect(sheet.rows[2][3]).toBeNull()
  })

  it('lit les nombres et gère les cellules vides', async () => {
    const bytes = await toBytes(
      buildXlsx([
        {
          name: 'Notes',
          rows: [
            ['Nom', 'Note'],
            ['Léa', 15.5],
            ['Karim', null],
          ],
        },
      ])
    )
    const sheet = parseXlsx(bytes)
    expect(sheet.rows[1][1]).toBe(15.5)
    expect(sheet.rows[2][1]).toBeNull()
  })
})

describe('parseXlsx — fichier façon Excel (deflate + sharedStrings)', () => {
  it('décompresse et résout les chaînes partagées', () => {
    const bytes = excelLikeXlsx([
      ['Prénom', 'Nom', 'Email institutionnel', 'Mot de passe'],
      ['Amélia', 'Ben Salah', 'amelia@famso.u-sousse.tn', 'Apero123'],
      ['Youssef', 'Trabelsi', 'youssef@famso.u-sousse.tn', ''],
    ])
    const sheet = parseXlsx(bytes)
    expect(sheet.name).toBe('Comptes')
    expect(sheet.rows[1]).toEqual([
      'Amélia',
      'Ben Salah',
      'amelia@famso.u-sousse.tn',
      'Apero123',
    ])
    expect(sheet.rows[2][3]).toBeNull()
  })

  it('gère les colonnes dispersées (cellules manquantes en A)', () => {
    const bytes = excelLikeXlsx([['', 'Nom seul'], ['', 'Deuxième']])
    const sheet = parseXlsx(bytes)
    expect(sheet.rows[0][1]).toBe('Nom seul')
    expect(sheet.rows[0][0]).toBeNull()
  })
})

describe('parseXlsx — erreurs propres', () => {
  it('refuse un fichier qui n’est pas un ZIP', () => {
    expect(() => parseXlsx(new TextEncoder().encode('bonjour, ceci est du texte'))).toThrow(
      TableReadError
    )
  })
  it('refuse un fichier trop court', () => {
    expect(() => parseXlsx(new Uint8Array(20))).toThrow(TableReadError)
  })
})

describe('parseCsv', () => {
  it('lit un CSV point-virgule avec accents', () => {
    const rows = parseCsv('Prénom;Nom;Email;Mot de passe\nAmélia;Ben Salah;a@famso.u-sousse.tn;Sec1234\n')
    expect(rows[0]).toEqual(['Prénom', 'Nom', 'Email', 'Mot de passe'])
    expect(rows[1][0]).toBe('Amélia')
  })
  it('détecte la virgule et la tabulation', () => {
    expect(parseCsv('a,b,c\n1,2,3')[0]).toEqual(['a', 'b', 'c'])
    expect(parseCsv('a\tb\tc\n1\t2\t3')[0]).toEqual(['a', 'b', 'c'])
  })
  it('gère les guillemets et retours à la ligne internes', () => {
    const rows = parseCsv('a,"b\nsuite",c\n"x""y",z,')
    expect(rows[0][1]).toBe('b\nsuite')
    expect(rows[1][0]).toBe('x"y')
  })
  it('retire le BOM UTF-8', () => {
    const rows = parseCsv('\ufeffPrénom;Nom\nAmélia;Ben')
    expect(rows[0][0]).toBe('Prénom')
  })
})

describe('parseAccountsFile', () => {
  it('ignore la ligne d’en-tête et les lignes vides (xlsx générateur)', async () => {
    const bytes = await toBytes(
      buildXlsx([
        {
          name: 'Comptes',
          rows: [
            ['Prénom', 'Nom', 'Email institutionnel', 'Mot de passe'],
            ['Amélia', 'Ben Salah', 'Amelia@famso.u-sousse.tn', 'Apero123'],
            ['', '', '', ''],
            ['Youssef', 'Trabelsi', 'youssef@famso.u-sousse.tn', ''],
          ],
        },
      ])
    )
    const { rows, skippedHeader } = parseAccountsFile(bytes, 'comptes.xlsx')
    expect(skippedHeader).toBe(true)
    expect(rows).toHaveLength(2)
    expect(rows[0].email).toBe('amelia@famso.u-sousse.tn') // minuscules
    expect(rows[1].password).toBe('') // vide → l'admin générera
  })

  it('sans en-tête : toutes les lignes sont des comptes', () => {
    const { rows, skippedHeader } = parseAccountsFile(
      new TextEncoder().encode('Amélia;Ben Salah;amelia@famso.u-sousse.tn;Apero123'),
      'liste.csv'
    )
    expect(skippedHeader).toBe(false)
    expect(rows).toHaveLength(1)
  })

  it('fichier CSV avec en-tête anglais', () => {
    const { rows, skippedHeader } = parseAccountsFile(
      new TextEncoder().encode('First name,Last name,Email,Password\nYoussef,Trabelsi,y@famso.u-sousse.tn,'),
      'list.csv'
    )
    expect(skippedHeader).toBe(true)
    expect(rows[0].firstName).toBe('Youssef')
  })
})
