import { NextRequest, NextResponse } from 'next/server'
import { getSessionByCode } from '@/lib/tbl'

// POST /api/sessions/[code]/teacher — connexion enseignant (PIN)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const body = await req.json().catch(() => null)
    const pin = body?.pin
    if (typeof pin !== 'string') {
      return NextResponse.json({ error: 'Code PIN manquant.' }, { status: 400 })
    }
    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable. Vérifiez le code.' }, { status: 404 })
    }
    if (session.teacherPin !== pin) {
      return NextResponse.json({ error: 'Code PIN incorrect.' }, { status: 401 })
    }
    return NextResponse.json({ code: session.code, teacherToken: session.teacherToken })
  } catch (e) {
    console.error('POST /api/sessions/[code]/teacher', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
