# Motcha

Le jeu de mots à deviner, à jouer seul, en duel ou jusqu'à 8 en direct.
Tu proposes un mot, chaque lettre te répond : **bien placée** (carré vert), **mal placée** (pastille rose) ou **absente** (grise).

## Ce qu'il y a dedans

**Entre amis** (de 2 à 8 joueurs, salon avec code à 4 lettres ou lien d'invitation)

- 🏁 **Course** : tout le monde cherche le même mot en même temps. On voit les couleurs des autres, pas leurs lettres.
- 👑 **Maître du mot** : à tour de rôle, un joueur choisit le mot secret et regarde les autres chercher. Plus ils galèrent, plus il marque… sauf si le mot est introuvable.
- Points selon le nombre d'essais, la rapidité et l'ordre d'arrivée ; classement après chaque manche, podium et récompenses à la fin.
- 💡 Indices payants, 😈 coups bas (brouillard, clavier mélangé, grille à l'envers), ⚡ sprint final, réactions, discussion (un joueur qui connaît déjà le mot ne peut pas l'écrire aux autres).
- Règles au choix de l'hôte : langue (français ou anglais), 4 à 8 lettres, nombre d'essais, de manches, chrono, dictionnaire strict ou libre.
- Reconnexion automatique : on retrouve sa place et sa grille après une coupure ou un rechargement.

**En solo**

- 📅 **Mot du jour** : le même mot pour tout le monde, série de jours, résultat à partager.
- 🎯 **Entraînement** : tes règles, autant de parties que tu veux.
- 🔥 **Survie** : enchaîne les mots, le score se cumule jusqu'au premier raté.

Et aussi : thème nuit ou jour, couleurs contrastées pour les daltoniens, clavier AZERTY ou QWERTY, bruitages, statistiques, mobile et ordinateur.

## Lancer le jeu sur ta machine

Il faut [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

Puis ouvre <http://localhost:3000>.

- **Jouer avec des amis sur le même Wi-Fi** : ils ouvrent `http://<adresse IP de ton ordinateur>:3000`.
- **Tester seul avec plusieurs joueurs** : ouvre d'autres onglets en ajoutant `?profil=2`, `?profil=3`… à l'adresse. Chaque profil est un joueur distinct.

## Mettre en ligne

Motcha est un serveur Node unique qui sert la page **et** garde une connexion WebSocket ouverte avec chaque joueur. Il lui faut donc un hébergeur qui fait tourner un vrai processus Node (Render, Railway, Fly.io, un VPS…).
Les hébergeurs « serverless » comme Vercel ou Netlify ne conviennent pas : ils ne gardent pas de connexion ouverte.

### Render (gratuit, le plus simple)

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur [render.com](https://render.com) : **New → Blueprint**, choisis le dépôt. Le fichier `render.yaml` configure tout.
   (Ou à la main : **New → Web Service**, build `npm ci --omit=dev`, start `npm start`.)
3. Partage l'adresse `https://….onrender.com` à tes amis.

À savoir : avec l'offre gratuite, le serveur s'endort après un quart d'heure sans visite. Le premier chargement prend alors une trentaine de secondes, et les salons ouverts sont perdus.

### Railway, Fly.io, VPS, Docker

Partout ailleurs, la recette est la même : installer avec `npm ci --omit=dev`, démarrer avec `npm start`. Le serveur écoute sur le port donné par la variable `PORT` (3000 par défaut).

```bash
docker build -t motcha .
docker run -p 3000:3000 motcha
```

### Réglages (variables d'environnement)

| Variable   | Rôle                                         | Valeur par défaut |
| ---------- | -------------------------------------------- | ----------------- |
| `PORT`     | Port d'écoute                                | `3000`            |
| `HOST`     | Adresse d'écoute                             | toutes            |
| `DAILY_TZ` | Fuseau horaire qui fait changer le mot du jour | `Europe/Paris`    |

### Limites à connaître

- Les salons vivent en mémoire : un redémarrage du serveur les efface (les statistiques des joueurs, elles, sont dans leur navigateur).
- Une seule instance du serveur à la fois : ne pas activer la mise à l'échelle sur plusieurs machines.

## Organisation du code

```
server/
  index.js    serveur HTTP (fichiers statiques) + WebSocket
  hub.js      registre des salons, aiguillage des messages, anti-spam
  room.js     un salon : joueurs, réglages, déroulé des manches
  engine.js   règles pures : couleurs des lettres, calcul des points
  words.js    dictionnaires, mot du jour
public/       l'interface (HTML, CSS, modules JavaScript, sans étape de build)
data/         dictionnaires prêts à l'emploi
  src/        listes de mots secrets, modifiables à la main
scripts/      génération des dictionnaires
test/         tests du moteur + parties complètes simulées
```

Le serveur fait autorité : le mot secret ne quitte jamais le serveur tant que le joueur n'a pas le droit de le voir.

## Modifier les mots

- **Mots secrets** (ceux à deviner) : `data/src/fr.common.txt` et `data/src/en.common.txt`, un mot par ligne. Ajoute ou retire ce que tu veux.
- **Mots acceptés comme proposition** : tout le dictionnaire (85 000 mots français, 114 000 anglais de 4 à 8 lettres).

Après une modification :

```bash
npm run build:dict
```

Un mot secret absent du dictionnaire complet est signalé et ignoré.

## Tests

```bash
npm test
```

Les tests couvrent le calcul des couleurs et des points, le serveur de fichiers, puis jouent de vraies parties avec de faux joueurs connectés au serveur : solo, course à trois, maître du mot, reconnexion, expulsion. Ils vérifient en particulier qu'un joueur qui cherche encore (ou qui arrive en cours de manche) ne reçoit jamais le mot secret.
