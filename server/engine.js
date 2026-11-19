// Règles pures du jeu : retour lettre par lettre et calcul des points.

/**
 * Compare une proposition au mot secret.
 * Renvoie une chaîne de chiffres, un par lettre : 2 = bien placée, 1 = mal placée, 0 = absente.
 * Les lettres en double sont comptées comme dans le mot secret.
 */
export function feedback(guess, secret) {
  const n = secret.length;
  const out = new Array(n).fill(0);
  const left = {};
  for (let i = 0; i < n; i++) {
    if (guess[i] === secret[i]) out[i] = 2;
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (out[i] === 0 && left[guess[i]] > 0) {
      out[i] = 1;
      left[guess[i]]--;
    }
  }
  return out.join('');
}

export const SCORING = {
  found: 100, // mot trouvé
  perAttemptLeft: 20, // par essai non utilisé
  speedMax: 50, // bonus de rapidité, dégressif
  rank: [30, 15, 5], // 1er, 2e, 3e à trouver (multijoueur)
  hintCost: 30, // par indice utilisé
  closePerLetter: 8, // lot de consolation : par lettre bien placée dans la meilleure tentative
  closeMax: 40,
  masterMax: 120, // maître du mot : mot trouvé au tout dernier essai
  masterFail: 70, // maître du mot : mot introuvable
};

/**
 * Points d'un joueur qui devine.
 * `rank` vaut null hors multijoueur ; `refMs` est la durée de référence du bonus de rapidité.
 */
export function scoreGuesser({ found, attemptsUsed, maxAttempts, elapsedMs, refMs, rank = null, hintsUsed = 0, bestGreens = 0 }) {
  const parts = [];
  if (found) {
    parts.push(['found', SCORING.found]);
    const spare = (maxAttempts - attemptsUsed) * SCORING.perAttemptLeft;
    if (spare > 0) parts.push(['attempts', spare]);
    const speed = Math.round(SCORING.speedMax * Math.max(0, 1 - elapsedMs / refMs));
    if (speed > 0) parts.push(['speed', speed]);
    if (rank !== null && SCORING.rank[rank]) parts.push(['rank', SCORING.rank[rank]]);
  } else {
    const close = Math.min(SCORING.closeMax, bestGreens * SCORING.closePerLetter);
    if (close > 0) parts.push(['close', close]);
  }
  if (hintsUsed > 0) parts.push(['hints', -hintsUsed * SCORING.hintCost]);
  const total = Math.max(0, parts.reduce((sum, [, v]) => sum + v, 0));
  return { total, parts };
}

/**
 * Points du maître du mot : plus les autres ont eu besoin d'essais, plus il gagne,
 * mais un mot introuvable rapporte moins qu'un mot trouvé de justesse.
 * `results` : un élément par joueur ayant proposé au moins un mot.
 */
export function scoreMaster(results, maxAttempts) {
  const played = results.filter((r) => r.attemptsUsed > 0);
  if (!played.length) return { total: 0, parts: [] };
  const sum = played.reduce(
    (acc, r) => acc + (r.found ? Math.round((SCORING.masterMax * r.attemptsUsed) / maxAttempts) : SCORING.masterFail),
    0,
  );
  const total = Math.round(sum / played.length);
  return { total, parts: [['master', total]] };
}
