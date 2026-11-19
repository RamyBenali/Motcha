// Constantes partagées par toute l'interface.

export const AVATARS = [
  '🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐵', '🐧', '🦁', '🐨',
  '🐷', '🐰', '🐻', '🐱', '🐶', '🦉', '🦋', '🐢', '🦖', '🐳',
  '🦈', '🐝', '🦀', '🦩', '🦥', '🦦', '🦔', '🐲', '👻', '🤖',
  '👽', '🎃', '🍄', '🌵', '🍉', '🍩', '🍕', '🌶️', '⚡', '🚀',
];

const AVATAR_COLORS = ['#ff5aa5', '#7b5cff', '#48d2ff', '#ffd33d', '#b8f32b', '#ff8a3d', '#3ddc97', '#c77dff'];
export const avatarColor = (index) => AVATAR_COLORS[index % AVATAR_COLORS.length];

const NAME_A = ['Renard', 'Panda', 'Hibou', 'Loutre', 'Tigre', 'Koala', 'Lama', 'Castor', 'Lynx', 'Poulpe', 'Morse', 'Yéti'];
const NAME_B = ['Rusé', 'Zen', 'Futé', 'Turbo', 'Malin', 'Chill', 'Agile', 'Cosmique', 'Masqué', 'Volant', 'Doré', 'Fou'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const randomName = () => `${pick(NAME_A)} ${pick(NAME_B)}`;

export const LAYOUTS = {
  azerty: ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN'],
  qwerty: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
};

export const EMOTES = ['😂', '🔥', '😱', '👏', '💀', '🧠', '😭', '🥶', '🤡', '❤️', '👀', '🫡'];

export const ATTACK_INFO = {
  fog: { icon: '🌫️', name: 'Brouillard', desc: 'Sa grille devient floue' },
  shuffle: { icon: '🔀', name: 'Clavier fou', desc: 'Ses touches sont mélangées' },
  flip: { icon: '🙃', name: 'Tête en bas', desc: 'Sa grille se retourne' },
};

export const MODES = {
  race: { icon: '🏁', name: 'Course', desc: 'Tout le monde cherche le même mot en même temps. Le plus rapide et le plus malin gagne.' },
  master: { icon: '👑', name: 'Maître du mot', desc: 'À tour de rôle, un joueur choisit le mot secret et les autres doivent le trouver.' },
};

export const LANG_NAMES = { fr: 'Français', en: 'English' };

export const ERRORS = {
  unknown: 'Ce mot n’est pas dans le dictionnaire',
  length: 'Pas le bon nombre de lettres',
  dup: 'Tu as déjà proposé ce mot',
  notHost: 'Seul l’hôte peut faire ça',
  noRoom: 'Ce salon n’existe pas (ou plus)',
  full: 'Ce salon est complet',
  banned: 'Tu as été exclu de ce salon',
  private: 'Cette partie est privée',
  needPlayers: 'Il faut être au moins 2 pour ce mode',
  noHints: 'Plus d’indice disponible',
  noAttack: 'Tu as déjà utilisé ton coup bas',
  badTarget: 'Ce joueur ne peut pas être visé',
  disabled: 'Cette option est désactivée',
  notStarted: 'Attends le départ !',
  notPlaying: 'Tu ne peux pas jouer pour le moment',
  badPhase: 'Action impossible pour le moment',
  busy: 'Le serveur est plein, réessaie plus tard',
  server: 'Oups, une erreur est survenue',
  badRequest: 'Requête invalide',
};

export const PART_LABELS = {
  found: 'Mot trouvé',
  attempts: 'Essais restants',
  speed: 'Rapidité',
  rank: 'Ordre d’arrivée',
  hints: 'Indices',
  close: 'Presque…',
  master: 'Maître du mot',
};

const secs = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export const AWARDS = {
  fastest: { icon: '⚡', name: 'Éclair', text: (v) => `un mot trouvé en ${secs(v)}` },
  brain: { icon: '🧠', name: 'Cerveau', text: (v) => `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')} ${v < 2 ? 'essai' : 'essais'} en moyenne` },
  first: { icon: '🥇', name: 'Flèche', text: (v) => `${plural(v, 'fois', 'fois')} le premier à trouver` },
  genius: { icon: '🎯', name: 'Coup de génie', text: (v) => `${plural(v, 'mot trouvé', 'mots trouvés')} en 2 essais max` },
  saboteur: { icon: '😈', name: 'Saboteur', text: (v) => plural(v, 'coup bas', 'coups bas') },
  unlucky: { icon: '🫠', name: 'Poissard', text: (v) => plural(v, 'mot raté', 'mots ratés') },
};

export const TIMER_CHOICES = [
  [0, 'Sans'],
  [60, '1 min'],
  [90, '1 min 30'],
  [120, '2 min'],
  [180, '3 min'],
  [300, '5 min'],
];
