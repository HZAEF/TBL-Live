// Génère les icônes PWA de TBL Live (192, 512, maskable 512)
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const OUT = path.join(__dirname, '..', 'public', 'icons')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

// Casquette de diplômé sur fond émeraude
const cap = (scale, radius) => {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${radius}" fill="#059669"/>
    <g transform="translate(256,268) scale(${scale}) translate(-256,-268)">
      <path d="M256 118 L452 206 L256 294 L60 206 Z" fill="#ffffff"/>
      <path d="M152 254 V336 C152 336 196 378 256 378 C316 378 360 336 360 336 V254"
            fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="452" y1="206" x2="452" y2="308" stroke="#ffffff" stroke-width="26" stroke-linecap="round"/>
      <circle cx="452" cy="330" r="20" fill="#f59e0b"/>
    </g>
  </svg>`
}

async function main() {
  // Icône standard (coins arrondis, contenu large)
  const svgStandard = cap(0.92, 112)
  await sharp(Buffer.from(svgStandard)).resize(512, 512).png().toFile(path.join(OUT, 'icon-512.png'))
  await sharp(Buffer.from(svgStandard)).resize(192, 192).png().toFile(path.join(OUT, 'icon-192.png'))

  // Icône maskable (contenu réduit dans la zone sûre, plein fond)
  const svgMaskable = cap(0.72, 0)
  await sharp(Buffer.from(svgMaskable)).resize(512, 512).png().toFile(path.join(OUT, 'icon-maskable-512.png'))

  console.log('Icônes générées dans', OUT)
  for (const f of fs.readdirSync(OUT)) console.log(' -', f)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
