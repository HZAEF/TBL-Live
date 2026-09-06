import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { safeEqualStrings } from '@/lib/tbl'

// ============================================================
// TBL Live — PIN enseignant : hachage bcrypt (v2.4.0)
//
// Pourquoi : si la base de données fuit un jour, un PIN stocké
// en clair serait lisible directement. bcrypt résiste au
// décryptage inversé (10 tours ≈ 80 ms côté serveur — invisible
// pour l'enseignant, dissuasif pour un attaquant).
//
// Migration transparente : les séances créées AVANT la v2.4.0
// stockent le PIN en clair. À la première connexion réussie,
// le PIN est automatiquement re-haché — l'enseignant ne change
// rien, ne crée pas de nouvelle séance, ne tape rien de plus.
//
// Le verrouillage anti force-brute (5 tentatives → 15 min,
// compteur en base) reste géré par la route /teacher et
// fonctionne exactement comme avant.
// ============================================================

const BCRYPT_ROUNDS = 10
// Les hachés bcrypt commencent par $2a$, $2b$ ou $2y$.
const BCRYPT_PREFIX = '$2'

/** Hache un PIN déjà normalisé (voir normalizePin). */
export function hashPin(normalizedPin: string): Promise<string> {
  return bcrypt.hash(normalizedPin, BCRYPT_ROUNDS)
}

function isHashed(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(BCRYPT_PREFIX)
}

export interface PinVerdict {
  ok: boolean
  /** true = la séance stocke encore le PIN en clair (créée avant
   *  la v2.4.0) et le PIN soumis est correct → à re-hacher. */
  needsRehash: boolean
}

/** Vérifie un PIN candidat (déjà normalisé) face à la valeur stockée.
 *  Ne modifie PAS la base : la ré-écriture éventuelle se fait via
 *  migratePinToHash par l'appelant (module testable isolément). */
export async function verifyPin(
  stored: string,
  candidate: string
): Promise<PinVerdict> {
  if (isHashed(stored)) {
    return { ok: await bcrypt.compare(candidate, stored), needsRehash: false }
  }
  // Ancienne séance (PIN en clair) : comparaison en temps constant.
  const ok = safeEqualStrings(candidate, stored)
  return { ok, needsRehash: ok }
}

/** Re-hache le PIN d'une ancienne séance (appelé après une connexion
 *  réussie sur un PIN encore stocké en clair). */
export async function migratePinToHash(sessionId: string, candidate: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { teacherPin: await hashPin(candidate) },
  })
}
