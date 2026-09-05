import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateUniqueCode,
  randomToken,
  isValidPin,
  normalizePin,
  sanitizeQuestionInput,
  sanitizeCaseInput,
} from '@/lib/tbl'

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
        {
          error: 'Le code PIN doit contenir entre 6 et 12 caractères, lettres et chiffres uniquement (pas d\u2019accents ni de symboles).',
        },
        { status: 400 }
      )
    }
    const safePin = normalizePin(pin)

    // Entre 2 et 50 équipes (modifiable ensuite depuis le tableau de bord)
    let teamCount = Number(body.teamCount)
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 50) teamCount = 6

    let iratMinutes = Number(body.iratMinutes)
    if (!Number.isInteger(iratMinutes) || iratMinutes < 1 || iratMinutes > 90) iratMinutes = 10

    // Questions (optionnelles à la création, modifiables ensuite)
    const rawQuestions = Array.isArray(body.questions) ? body.questions : []
    const questions = rawQuestions
      .map((q) => sanitizeQuestionInput(q))
      .filter((q): q is NonNullable<ReturnType<typeof sanitizeQuestionInput>> => q !== null)

    // Cas cliniques d'application : chacun contient 3 à 5 QCU affichées
    // ensemble, un cas à la fois. Le titre est requis ; à défaut on le fixe
    // côté client (« Application N »).
    const rawCases = Array.isArray(body.cases) ? body.cases : []
    const cases = rawCases
      .map((c, i) => {
        const sane = sanitizeCaseInput(c)
        if (sane) return sane
        // Repli : titre par défaut si seul le titre manque
        const retry = sanitizeCaseInput({ ...c, title: `Application ${i + 1}` })
        return retry
      })
      .filter((c): c is NonNullable<ReturnType<typeof sanitizeCaseInput>> => c !== null)

    // Numérotation par phase : les questions iRAT/tRAT et les exercices
    // d'application sont numérotés indépendamment (0,1,2… dans chaque liste).
    // Les QCU d'un cas sont numérotées dans le cas ; les exercices « libres »
    // (ancien format, sans cas) gardent une numérotation globale d'application.
    const counters: Record<string, number> = { rat: 0, application: 0 }
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
        teacherPin: safePin,
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

    // Cas cliniques : créés après la séance car chaque QCU doit référencer
    // explicitement la séance (l'imbrication Prisma ne propage que le cas,
    // pas la séance « grand-parente »).
    for (let ci = 0; ci < cases.length; ci++) {
      const c = cases[ci]
      await db.case.create({
        data: {
          sessionId: session.id,
          title: c.title,
          intro: c.intro,
          order: ci,
          questions: {
            create: c.questions.map((q, qi) => ({
              sessionId: session.id,
              text: q.text,
              choices: JSON.stringify(q.choices),
              correct: q.correct,
              phase: 'application' as const,
              order: qi,
            })),
          },
        },
      })
    }

    return NextResponse.json({ code: session.code, teacherToken })
  } catch (e) {
    console.error('POST /api/sessions', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
