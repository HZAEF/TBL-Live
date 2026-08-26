import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateUniqueCode, randomToken, isValidPin, sanitizeQuestionInput } from '@/lib/tbl'

// POST /api/sessions — création d'une séance TBL
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const pin = body.pin
    if (title.length < 3 || title.length > 120) {
      return NextResponse.json(
        { error: 'Le titre doit contenir entre 3 et 120 caractères.' },
        { status: 400 }
      )
    }
    if (!isValidPin(pin)) {
      return NextResponse.json(
        { error: 'Le code PIN doit contenir exactement 4 chiffres.' },
        { status: 400 }
      )
    }

    let teamCount = Number(body.teamCount)
    if (!Number.isInteger(teamCount) || teamCount < 1 || teamCount > 12) teamCount = 6

    let iratMinutes = Number(body.iratMinutes)
    if (!Number.isInteger(iratMinutes) || iratMinutes < 1 || iratMinutes > 90) iratMinutes = 10

    // Questions (optionnelles à la création, modifiables ensuite)
    const rawQuestions = Array.isArray(body.questions) ? body.questions : []
    const questions = rawQuestions
      .map((q) => sanitizeQuestionInput(q))
      .filter((q): q is NonNullable<ReturnType<typeof sanitizeQuestionInput>> => q !== null)

    // Numérotation par phase : les questions iRAT/tRAT et les exercices
    // d'application sont numérotés indépendamment (0,1,2… dans chaque liste).
    const counters: Record<string, number> = {}
    const questionData = questions.map((q) => {
      const order = counters[q.phase] ?? 0
      counters[q.phase] = order + 1
      return {
        text: q.text,
        choices: JSON.stringify(q.choices),
        correct: q.correct,
        phase: q.phase,
        order,
      }
    })

    const code = await generateUniqueCode()
    const teacherToken = randomToken()

    const session = await db.session.create({
      data: {
        code,
        title,
        teacherPin: pin,
        teacherToken,
        iratMinutes,
        teams: {
          create: Array.from({ length: teamCount }, (_, i) => ({
            name: `Équipe ${i + 1}`,
            number: i + 1,
          })),
        },
        questions: {
          create: questionData,
        },
      },
    })

    return NextResponse.json({ code: session.code, teacherToken })
  } catch (e) {
    console.error('POST /api/sessions', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
