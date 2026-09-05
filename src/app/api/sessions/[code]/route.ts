import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode } from '@/lib/tbl'

// GET /api/sessions/[code] — infos publiques (page de connexion étudiant)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const session = await getSessionByCode(code)
    // Une séance mise à la corbeille n'existe plus pour les étudiants
    // (l'enseignant peut encore la restaurer pendant 48 h).
    if (!session || session.deletedAt) {
      return NextResponse.json({ error: 'Séance introuvable. Vérifiez le code.' }, { status: 404 })
    }
    const teams = await db.team.findMany({
      where: { sessionId: session.id },
      orderBy: { number: 'asc' },
      select: { id: true, name: true },
    })
    const studentCount = await db.student.count({ where: { sessionId: session.id } })
    return NextResponse.json({
      code: session.code,
      title: session.title,
      status: session.status,
      teams,
      studentCount,
    })
  } catch (e) {
    console.error('GET /api/sessions/[code]', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
