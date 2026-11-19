// Résultats : fin de manche, fin de partie solo, récapitulatif du mot du jour, podium.
import { h, clear, avatarEl, wordTiles, fmtDuration, plural, copyText } from './dom.js';
import { S, serverNow, me, isHost, playerById, render, actions, untilNextDaily } from './core.js';
import { send } from './net.js';
import { stats, saveStats, refreshStats, countOnce, dailyId, dayBefore } from './store.js';
import { PART_LABELS, AWARDS } from './consts.js';
import { openModal, confirmModal } from './modal.js';
import { topbar } from './parts.js';
import { toast, confetti } from './fx.js';
import { play } from './sfx.js';

let modal = null;
let bodyEl = null;
let countdownEl = null;
let dailyClock = null;
let soloNote = null; // nouveau record, etc. (calculé une seule fois par manche)
let recordRun = null; // salon dans lequel le record de survie vient d'être battu

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function definitionLink(word, lang) {
  const site = lang === 'en' ? 'en' : 'fr';
  return h('a.def-link', { href: `https://${site}.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`, target: '_blank', rel: 'noopener noreferrer' }, '📖 Définition');
}

function partsChips(parts) {
  return h(
    'div.chips',
    (parts || []).map(([key, value]) => h('span.chip', { class: value < 0 ? 'neg' : '' }, `${PART_LABELS[key] ?? key} `, h('b', `${value > 0 ? '+' : ''}${value}`))),
  );
}

// ───────────── mot du jour ─────────────

function shareText(record, key, lang) {
  const [, month, day] = key.split('-');
  const grid = record.rows.map((row) => [...row].map((c) => (c === '2' ? '🟩' : c === '1' ? '🟣' : '⬛')).join('')).join('\n');
  const result = record.found ? `Trouvé en ${record.attempts}/${record.max}` : `Raté ${record.max}/${record.max} 😵`;
  const streak = stats.daily.streak > 1 ? ` · série de ${stats.daily.streak} 🔥` : '';
  return `Motcha · mot du jour ${day}/${month}${lang === 'en' ? ' 🇬🇧' : ''}\n${result}${streak}\n\n${grid}\n\n${location.origin}`;
}

async function shareDaily(record, key, lang) {
  const text = shareText(record, key, lang);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      /* partage annulé : on copie à la place */
    }
  }
  const ok = await copyText(text);
  toast(ok ? 'Résultat copié, colle-le où tu veux !' : 'Impossible de copier', { icon: ok ? '📋' : '⚠️' });
}

function dailyRecap(record, key, lang) {
  dailyClock = h('b', untilNextDaily());
  const rows = Array.isArray(record.rows) ? record.rows.filter((row) => typeof row === 'string') : [];
  record = { ...record, rows };
  return [
    h(
      'div.daily-grid',
      { vars: { '--len': record.rows[0]?.length ?? 5 } },
      record.rows.flatMap((row) => [...row].map((c) => h('i', { data: { s: c } }))),
    ),
    h(
      'div.stat-row',
      h('div.stat', h('b', stats.daily.streak), h('small', stats.daily.streak > 1 ? 'jours d’affilée' : 'jour d’affilée')),
      h('div.stat', h('b', stats.daily.maxStreak), h('small', 'record')),
      h('div.stat', dailyClock, h('small', 'avant le prochain mot')),
    ),
    h('button.btn.violet.big.wide', { type: 'button', onclick: () => shareDaily(record, key, lang) }, '📤 Partager mon résultat'),
  ];
}

/** Depuis l'accueil : le mot du jour a déjà été joué, on réaffiche le résultat. */
export function showDailyRecap(record, key, lang) {
  const recap = openModal({
    title: 'Mot du jour',
    className: 'results',
    body: [
      h('div.res-emoji', record.found ? '🎉' : '😵'),
      h('h2.res-title', record.found ? `Trouvé en ${plural(record.attempts, 'essai', 'essais')} !` : 'Raté pour aujourd’hui'),
      h('div.res-word', h('span.eyebrow', 'Le mot était'), wordTiles(record.word, null, 'big'), definitionLink(record.word, lang)),
      dailyRecap(record, key, lang),
    ],
    footer: h('button.btn.ghost.wide', { type: 'button', onclick: () => recap.close() }, 'Fermer'),
    onClose: () => {
      dailyClock = null;
    },
  });
}

// ───────────── statistiques solo ─────────────

function recordSolo(room, my) {
  // Un autre onglet a pu jouer entre-temps : on repart de ce qui est enregistré.
  refreshStats();
  if (!countOnce(`${room.code}|${room.roundIndex}|${room.round.startedAt}`)) return;
  soloNote = null;
  const won = my.status === 'won';
  const attempts = my.guesses.length;

  if (room.kind === 'survival') {
    const words = room.roundIndex + (won ? 1 : 0);
    if (my.score > stats.survival.best) {
      if (stats.survival.best > 0) recordRun = room.code;
      stats.survival.best = my.score;
    }
    stats.survival.bestWords = Math.max(stats.survival.bestWords, words);
    if (!won) {
      if (recordRun === room.code) soloNote = 'Nouveau record ! 🏅';
      recordRun = null;
    }
  } else {
    const solo = stats.solo;
    solo.played++;
    if (won) {
      solo.wins++;
      solo.streak++;
      solo.maxStreak = Math.max(solo.maxStreak, solo.streak);
      solo.dist[attempts] = (solo.dist[attempts] || 0) + 1;
    } else {
      solo.streak = 0;
    }
  }

  if (room.kind === 'daily' && room.dailyKey) {
    const daily = stats.daily;
    const id = dailyId(room.settings.lang, room.dailyKey);
    if (!daily.days[id]) {
      daily.days[id] = { found: won, attempts, max: room.round.attempts, rows: my.guesses.map((g) => g.f), word: room.round.word };
      // La série avance d'un jour au premier mot trouvé ce jour-là, quelle que soit la langue.
      // Un jour sans mot trouvé ne la remet pas à zéro ici : elle expire d'elle-même le lendemain.
      if (won && daily.last !== room.dailyKey) {
        daily.streak = daily.last === dayBefore(room.dailyKey) ? daily.streak + 1 : 1;
        daily.maxStreak = Math.max(daily.maxStreak, daily.streak);
        daily.last = room.dailyKey;
      }
      // On ne garde que les deux derniers mois.
      const keys = Object.keys(daily.days).sort((x, y) => String(x.split('|')[1]).localeCompare(String(y.split('|')[1])));
      for (const old of keys.slice(0, Math.max(0, keys.length - 120))) delete daily.days[old];
    }
  }
  saveStats();
}

/**
 * Enregistre le résultat de la manche solo qui vient de se terminer (une seule fois).
 * Appelé dès que le serveur annonce la fin, sans attendre l'ouverture de la fenêtre de résultats.
 */
export function recordSoloResult() {
  const room = S.room;
  const my = me();
  if (room?.solo && room.phase === 'roundEnd' && room.round && my) recordSolo(room, my);
}

// ───────────── contenu de la fenêtre ─────────────

function paintSolo(room, my) {
  const r = room.round;
  const won = my.status === 'won';
  const lang = room.settings.lang;
  const content = [h('div.res-emoji', won ? '🎉' : '😵')];
  const buttons = [];
  const home = h('button.btn.ghost', { type: 'button', onclick: () => actions.leaveRoom() }, 'Accueil');
  const again = (label) => h('button.btn.primary.big', { type: 'button', onclick: () => send({ t: 'start' }) }, label);

  if (room.kind === 'survival') {
    const words = room.roundIndex + (won ? 1 : 0);
    content.push(h('h2.res-title', won ? pick(['Et un de plus !', 'Ça continue !', 'Inarrêtable !']) : 'Fin de la série'));
    content.push(h('div.res-word', h('span.eyebrow', 'Le mot était'), wordTiles(r.word, null, 'big'), definitionLink(r.word, lang)));
    content.push(
      h(
        'div.stat-row',
        h('div.stat', h('b', my.score), h('small', won ? 'points' : 'score final')),
        h('div.stat', h('b', words), h('small', words > 1 ? 'mots trouvés' : 'mot trouvé')),
        h('div.stat', h('b', stats.survival.best), h('small', 'ton record')),
      ),
    );
    if (soloNote) content.push(h('p.res-note', soloNote));
    if (won) content.push(h('div.res-me', h('b.res-pts', `+${my.points}`), partsChips(my.parts)));
    buttons.push(home, again(won ? 'Mot suivant →' : 'Retenter 🔥'));
  } else {
    content.push(h('h2.res-title', won ? pick(['Bravo !', 'Bien joué !', 'Trop fort !', 'Magnifique !']) : 'Raté…'));
    content.push(h('div.res-word', h('span.eyebrow', 'Le mot était'), wordTiles(r.word, null, 'big'), definitionLink(r.word, lang)));
    if (room.kind === 'daily') {
      const record = stats.daily.days[dailyId(lang, room.dailyKey)];
      if (record) content.push(dailyRecap(record, room.dailyKey, lang));
      buttons.push(h('button.btn.ghost.wide', { type: 'button', onclick: () => actions.leaveRoom() }, 'Retour à l’accueil'));
    } else {
      content.push(h('div.res-me', h('b.res-pts', `+${my.points}`), partsChips(my.parts)));
      const solo = stats.solo;
      content.push(
        h(
          'div.stat-row',
          h('div.stat', h('b', solo.played), h('small', solo.played > 1 ? 'parties' : 'partie')),
          h('div.stat', h('b', `${solo.played ? Math.round((solo.wins / solo.played) * 100) : 0} %`), h('small', 'de réussite')),
          h('div.stat', h('b', solo.streak), h('small', 'série en cours')),
        ),
      );
      buttons.push(home, again('Rejouer'));
    }
  }
  clear(bodyEl, content);
  clear(modal.foot, buttons);
}

function howDidItGo(p, r) {
  if (p.status === 'won') return `✅ ${p.guesses.length}/${r.attempts} · ${fmtDuration(p.ms ?? 0)}`;
  if (p.status === 'lost') return p.guesses.length ? `❌ ${p.guesses.length}/${r.attempts}` : '❌ pas joué';
  if (p.status === 'master') return '👑 a choisi le mot';
  return '👀 spectateur';
}

function paintMulti(room, my) {
  const r = room.round;
  const last = room.roundIndex + 1 >= room.totalRounds;
  const master = playerById(r.masterId);
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  const host = isHost();
  countdownEl = h('small.muted');

  clear(
    bodyEl,
    h('div.res-word', h('span.eyebrow', master ? `Le mot de ${master.name}` : 'Le mot était'), wordTiles(r.word, null, 'big'), definitionLink(r.word, room.settings.lang)),
    my.points !== null && h('div.res-me', h('b.res-pts', `+${my.points}`), partsChips(my.parts)),
    h(
      'ol.res-list',
      ranked.map((p) =>
        h(
          'li.res-row',
          { class: `${p.id === my.id ? 'me' : ''} ${p.connected ? '' : 'off'}`, data: { pid: p.id, rank: room.players.filter((q) => q.score > p.score).length + 1 } },
          h('span.res-rank', room.players.filter((q) => q.score > p.score).length + 1),
          avatarEl(p.avatar, 'sm'),
          h('span.res-name', h('b', p.name), h('small', howDidItGo(p, r))),
          h('b.res-plus', p.points !== null ? `+${p.points}` : ''),
          h('span.res-total', p.score),
        ),
      ),
    ),
  );
  clear(
    modal.foot,
    countdownEl,
    host
      ? [
          !last &&
            h(
              'button.btn.ghost',
              {
                type: 'button',
                onclick: () =>
                  confirmModal({
                    title: 'Arrêter la partie ?',
                    text: 'Tout le monde retourne au salon et les scores sont remis à zéro.',
                    yes: 'Arrêter',
                    no: 'Continuer',
                    danger: true,
                    onYes: () => send({ t: 'lobby' }),
                  }),
              },
              'Arrêter',
            ),
          h('button.btn.primary.big', { type: 'button', onclick: () => send({ t: 'next' }) }, last ? 'Voir le podium 🏆' : 'Manche suivante →'),
        ]
      : h('span.waiting', `${playerById(room.hostId)?.name ?? 'L’hôte'} lance la suite`),
  );
  tickResults();
}

function paint() {
  const room = S.room;
  const my = me();
  if (!modal || !room?.round || !my) return;
  if (room.solo) paintSolo(room, my);
  else paintMulti(room, my);
}

const signatureOf = (room) => JSON.stringify([room.hostId, room.nextAt, room.players.map((p) => [p.id, p.score, p.connected])]);

export const roundEndOpen = () => !!modal;

/**
 * Affiche (open = true) ou met à jour (open = false) les résultats de la manche.
 * Fermée par le joueur, la fenêtre ne se rouvre pas toute seule.
 */
export function showRoundEnd(open) {
  const room = S.room;
  const my = me();
  if (!room?.round || !my) return;
  if (!modal) {
    if (!open) return;
    if (room.solo) recordSolo(room, my);
    bodyEl = h('div.res');
    modal = openModal({
      title: room.solo ? '' : room.roundIndex + 1 >= room.totalRounds ? 'Dernière manche terminée' : `Fin de la manche ${room.roundIndex + 1}`,
      className: 'results',
      body: bodyEl,
      footer: h('span'),
      dismissible: !room.solo,
      onClose: () => {
        modal = null;
        dailyClock = null;
        render();
      },
    });
    modal.signature = signatureOf(room);
    paint();
    modal.foot.querySelector('.btn.primary')?.focus({ preventScroll: true });
    return;
  }
  // Mise à jour discrète : on ne reconstruit que si quelque chose a changé.
  const signature = signatureOf(room);
  if (modal.signature !== signature) {
    modal.signature = signature;
    if (!room.solo) paint();
  }
}

export function hideRoundEnd() {
  if (!modal) return;
  const current = modal;
  modal = null;
  dailyClock = null;
  current.close();
}

/** Compte à rebours avant la manche suivante et avant le prochain mot du jour. */
export function tickResults() {
  if (dailyClock?.isConnected) dailyClock.textContent = untilNextDaily();
  if (!modal || !countdownEl?.isConnected) return;
  const room = S.room;
  if (!room?.nextAt) {
    countdownEl.textContent = '';
    return;
  }
  const left = Math.max(0, Math.ceil((room.nextAt - serverNow()) / 1000));
  countdownEl.textContent = `Suite automatique dans ${left} s`;
}

// ───────────── podium ─────────────

let podiumRoot = null;
let podiumBody = null;
let recapOpen = false;

function recordMulti(room, my) {
  refreshStats();
  if (!countOnce(`${room.code}|fin|${room.history?.map((x) => x.word).join(',')}`)) return;
  const top = Math.max(...room.players.map((p) => p.score));
  stats.multi.games++;
  if (room.players.length > 1 && my.score === top && top > 0) stats.multi.wins++;
  saveStats();
}

/** Rang d'un joueur (1 = premier) ; les ex æquo partagent le même rang. */
const rankOf = (player, players) => players.filter((p) => p.score > player.score).length + 1;

function paintPodium() {
  const room = S.room;
  const my = me();
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  const host = isHost();
  const medals = ['🥇', '🥈', '🥉'];
  const order = ranked.length >= 3 ? [1, 0, 2] : ranked.length === 2 ? [1, 0] : [0];
  const winner = ranked[0];
  const winners = ranked.filter((p) => p.score === winner.score);

  clear(
    podiumBody,
    h('h1.podium-title', ranked.length < 2 ? 'Partie terminée' : winners.length > 1 ? 'Égalité parfaite !' : `${winner.name} l’emporte !`),
    h(
      'div.podium',
      order.map((i) => {
        const rank = rankOf(ranked[i], ranked);
        return h(
          'div.pod',
          { data: { rank, pid: ranked[i].id }, class: ranked[i].id === my.id ? 'me' : '' },
          rank === 1 && h('span.pod-crown', '👑'),
          avatarEl(ranked[i].avatar, 'xl'),
          h('b.pod-name', ranked[i].name),
          h('span.pod-score', `${ranked[i].score} pts`),
          h('div.pod-block', medals[rank - 1]),
        );
      }),
    ),
    ranked.length > 3 &&
      h(
        'ol.rest',
        { start: 4 },
        ranked.slice(3).map((p) =>
          h('li.res-row', { class: p.id === my.id ? 'me' : '', data: { pid: p.id } }, h('span.res-rank', rankOf(p, ranked)), avatarEl(p.avatar, 'sm'), h('span.res-name', h('b', p.name)), h('span.res-total', `${p.score} pts`)),
        ),
      ),
    room.awards?.length > 0 &&
      h(
        'div.awards',
        room.awards.map((award) => {
          const info = AWARDS[award.key];
          const who = playerById(award.id);
          if (!info || !who) return null;
          return h('div.award', h('span.award-ico', info.icon), h('div', h('b', info.name), h('small', `${who.name} · ${info.text(award.value)}`)));
        }),
      ),
    room.history?.length > 0 &&
      h(
        'details.recap',
        {
          open: recapOpen,
          ontoggle: (e) => {
            recapOpen = e.target.open;
          },
        },
        h('summary', 'Les mots de la partie'),
        h(
          'ul',
          room.history.map((round) => {
            const found = round.results.filter((x) => x.found).length;
            const chooser = playerById(round.masterId);
            return h(
              'li',
              wordTiles(round.word, null, 'tiny'),
              h('small', `${found}/${round.results.length} ${found > 1 ? 'ont trouvé' : 'a trouvé'}${chooser ? ` · choisi par ${chooser.name}` : ''}`),
            );
          }),
        ),
      ),
    h(
      'div.podium-actions',
      host
        ? [
            h('button.btn.primary.big', { type: 'button', onclick: () => send({ t: 'start' }) }, '🔁 Revanche'),
            h('button.btn', { type: 'button', onclick: () => send({ t: 'lobby' }) }, 'Changer les règles'),
          ]
        : h('p.waiting', h('span.dots', h('i'), h('i'), h('i')), `${playerById(room.hostId)?.name ?? 'L’hôte'} décide de la suite`),
      h('button.btn.ghost', { type: 'button', onclick: () => actions.confirmLeave() }, 'Quitter'),
    ),
  );
}

export const podiumScreen = {
  get el() {
    if (!podiumRoot) {
      podiumBody = h('div.podium-body');
      podiumRoot = h('section.screen.podium-screen', topbar({ onBack: () => actions.confirmLeave(), backLabel: 'Quitter le salon' }), podiumBody);
    }
    return podiumRoot;
  },

  enter() {
    recapOpen = false;
    const my = me();
    if (S.room && my) recordMulti(S.room, my);
    play('fanfare');
    confetti({ count: 160 });
    setTimeout(() => podiumRoot?.isConnected && confetti({ count: 120 }), 700);
  },

  update() {
    const room = S.room;
    const signature = JSON.stringify([room.hostId, room.players.map((p) => [p.id, p.score, p.connected])]);
    if (podiumBody.dataset.sig === signature && podiumBody.childElementCount) return;
    podiumBody.dataset.sig = signature;
    paintPodium();
  },

  leave() {
    if (podiumBody) podiumBody.dataset.sig = '';
  },
};

