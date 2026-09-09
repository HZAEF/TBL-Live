import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractToken } from '@/lib/tbl'
import { bumpRevisions } from '@/lib/revision'

// POST /api/alert — v2.5.0 : signalement anti-capture envoyé par la vue
// étudiant (silencieux côté étudiant : jamais d'erreur affichée).
// Corps : { kind: 'screenshot' | 'tab_hidden', phase?: string } ; jeton
// étudiant par l'en-tête « Authorization: Bearer … » (repli ?token=).
// v2.5.1 : « phase » = épreuve en cours au moment du signalement
// (statut de la séance) → l'enseignant voit le détail PAR ÉPREUVE
// (iRAT, tRAT, application…). Une phase absente ou inconnue est
// enregistrée à NULL : elle apparaîtra sous « Autres moments ».
//
// Déduplication : un même étudiant + même type n'est enregistré qu'une
// fois par minute côté serveur (le client limite déjà à 1 envoi / 5 s) —
// une rafale de touches ne crée pas une avalanche de signalements.
const KINDS = new Set(['screenshot', 'tab_hidden'])
const PHASES = new Set([
  'lobby',
  'irat',
  'trat',
  'appeal',
  'feedback',
  'application',
  'peer',
  'finished',
])
const DEDUP_MS = 60_000

export async function POST(req: NextRequest) {
  try {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Jeton manquant.' }, { status: 400 })
    }
    const body = (await req.json().catch(() => null)) as {
      kind?: string
      phase?: string | null
    } | null
    const kind = body?.kind ?? ''
    if (!KINDS.has(kind)) {
      return NextResponse.json({ error: 'Type de signalement inconnu.' }, { status: 400 })
    }
    // Phase inconnue ou absente → NULL (« Autres moments » côté enseignant).
    // On rejette silencieusement plutôt qu'en erreur : le signalement
    // compte plus que la classification.
    const phase = typeof body?.phase === 'string' && PHASES.has(body.phase) ? body.phase : null

    const student = await db.student.findUnique({
      where: { token },
      select: {
        id: true,
        sessionId: true,
        session: { select: { deletedAt: true, reportsEnabled: true } },
      },
    })
    if (!student) {
      return NextResponse.json({ error: 'Connexion perdue.' }, { status: 404 })
    }
    // Séance en corbeille : plus de signalement (l'étudiant est de toute
    // façon bloqué, mais évitons d'écrire dans une séance archivée).
    if (student.session.deletedAt) {
      return NextResponse.json({ error: 'Séance supprimée.' }, { status: 410 })
    }

    // v3.0.0 — Signalements DÉSACTIVÉS pour cette séance (choix de
    // l'administrateur, TBL par TBL — désactivés par défaut) : on ne
    // répond « ok » SANS RIEN ÉCRIRE (l'app étudiante, informée par
    // son état, ne devrait de toute façon plus envoyer de signale-
    // ment : ce contrôle protège les versions antérieures ouvertes
    // et garantit zéro écriture, zéro requête inutile).
    if (student.session.reportsEnabled !== true) {
      return NextResponse.json({ ok: true, disabled: true })
    }

    // Déduplication : dernier signalement du même type il y a moins d'une minute ?
    const last = await db.alertEvent.findFirst({
      where: { studentId: student.id, kind },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (last && Date.now() - last.createdAt.getTime() < DEDUP_MS) {
      return NextResponse.json({ ok: true, deduplicated: true })
    }

    await db.alertEvent.create({ data: { studentId: student.id, kind, phase } })
    // v2.9.0 : le signalement intéresse UNIQUEMENT le tableau de bord
    // enseignant → compteur enseignant + 1 seulement : les 65 étudiants
    // ne rechargent PAS leur état pour un signalement qui ne les
    // concerne pas (c'est la moitié de la fluidité en grande classe).
    await bumpRevisions(student.sessionId, { student: false })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/alert', e)
    // Silence côté étudiant : erreur 500 sans détail.
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
