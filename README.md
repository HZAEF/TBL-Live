# TBL Live — Application de Team-Based Learning

Application web gratuite qui déroule **toutes les étapes de la méthode TBL** (Team-Based Learning) avec vos étudiants, sur n'importe quel téléphone (Android, iPhone) ou ordinateur.

- ✅ **Test individuel (iRAT)** — chaque étudiant répond seul sur son téléphone
- ✅ **Test en équipe (tRAT)** — feedback immédiat façon « carte à gratter » (4 / 2 / 1 / 0 point)
- ✅ **Réclamations (appels)** — les équipes contestent avec justification ; passage automatique au feedback dès que toutes les équipes ont cliqué « Nous n'avons pas de réclamation »
- ✅ **Feedback** — statistiques en direct pour cibler votre mini-cours
- ✅ **Cas cliniques d'application** — chaque cas (énoncé + 3 à 5 QCU) s'affiche un par un ; les réponses sont enregistrées automatiquement au clic et **révélées automatiquement** dès que toutes les équipes ont répondu
- ✅ **Évaluation par les pairs** — chaque étudiant note ses coéquipiers
- ✅ **Résultats** — tableaux complets + export CSV pour Excel (formats « 10 sur 10 » insensibles à la conversion en date, cellules neutralisées contre les injections de formules)
- ✅ **Sécurité renforcée** — PIN enseignant à 6 caractères minimum avec verrouillage automatique (5 tentatives → 15 minutes de blocage), code de reprise personnel pour chaque étudiant, jusqu'à **50 équipes** par séance
- ✅ **Gestion des séances** — suppression avec **confirmation** et **corbeille de 48 h** (restauration en un clic), **duplication** d'une séance (questions et cas cliniques copiés, sans les données des étudiants), **purge automatique** des données étudiantes après 4 mois (les QCM et cas cliniques sont conservés)
- ✅ Installable sur l'écran d'accueil des téléphones (PWA), sans magasin d'applications

---

## 1. Comment animer une séance TBL avec l'application

### Avant la séance (5 minutes)

1. Ouvrez l'application → **« Je suis enseignant »** → **« Créer une nouvelle séance »**.
2. Donnez un titre, choisissez un **code PIN** (au moins 6 caractères, chiffres et lettres — le bouton « Générer » 🎲 propose un code robuste ; notez-le : il permet de retrouver votre séance depuis n'importe quel appareil), le **nombre d'équipes (2 à 50)** et la durée du iRAT.
3. Saisissez vos questions. Bouton **« Charger l'exemple »** pour découvrir le fonctionnement avec des questions toutes prêtes.
   - Questions **iRAT / tRAT** : questions de vérification de la préparation (utilisées deux fois : en individuel puis en équipe).
   - **Cas cliniques d'application** : chaque cas a un titre, un énoncé (vignette du patient…) et 3 à 5 QCU. Ils sont affichés **un par un** aux équipes pendant la séance.
4. Cliquez sur **« Créer la séance »** : un **code à 6 caractères** s'affiche en grand.

### Pendant la séance (le déroulé guidé)

L'application vous guide étape par étape. Le bouton vert en bas passe d'une étape à la suivante.

| Étape | Ce que vous faites | Ce que font les étudiants |
|---|---|---|
| 1. Accueil | Affichez le code au tableau | Ils saisissent le code + leur **nom et prénom**, choisissent leur équipe, et reçoivent un **code de reprise personnel** à noter (il sert à retrouver leur séance sur un autre appareil) |
| 2. iRAT | Surveillez la progression en direct | Chacun répond **seul** sur son téléphone |
| 3. tRAT | Surveillez les scores des équipes | **Un téléphone par équipe** : ils discutent puis valident (4 / 2 / 1 / 0 pt) |
| 4. Réclamations | Suivez le compteur « équipes ayant répondu » | Chaque équipe écrit ses contestations puis clique **« Nous n'avons pas de réclamation »** — quand toutes ont répondu, la phase suivante s'ouvre **automatiquement** |
| 5. Feedback | Mini-cours ciblé sur les questions en rouge | Ils voient leurs résultats et les bonnes réponses |
| 6. Application | Suivez la révélation automatique (ou forcez-la) | Les équipes travaillent les **cas cliniques un par un** ; chaque réponse est enregistrée **automatiquement** au clic ; les réponses de chaque question sont **révélées automatiquement** dès que toutes les équipes ont répondu |
| 7. Pairs | Vérifiez que tout le monde a soumis | Chacun note ses coéquipiers (1 à 5) |
| 8. Terminé | Exportez le CSV pour vos notes | Ils voient **leur note finale sur 20**, puis les réponses correctes |

### Après la séance
- Onglet **« Résultats »** → tableau **« Note finale sur 20 »** en haut de la page : chaque étudiant voit sa note globale combinant **iRAT 25 % · tRAT 25 % · application 35 % · évaluation par les pairs 15 %**. Chaque partie est d'abord ramenée sur 20 (iRAT : 1 point par bonne réponse ; tRAT : barème 4/2/1/0 ; application : bonnes réponses de l'équipe ; pairs : moyenne reçue sur 5). Si une partie n'existe pas (aucun exercice d'application, évaluation manquante…), son poids est automatiquement redistribué sur les autres.
- Les étudiants voient **uniquement leur note finale sur 20** sur l'écran de fin (sans détail), suivie des **réponses correctes** de toutes les questions.
- Bouton **« Exporter tous les résultats (CSV) »** : un fichier Excel avec tout (détail question par question, notes /20 de chaque partie, note finale, réclamations, commentaires). Les scores s'écrivent « 10 sur 10 » (et non « 10/10 ») pour éviter qu'Excel les convertisse en dates (10-oct).
- Pour reprendre une séance : **« Reprendre une séance »** avec le code + votre PIN.

### Gérer le cycle de vie de vos séances

Depuis l'en-tête du tableau de bord, chaque séance dispose de deux nouveaux boutons :

- **« Supprimer »** 🗑️ — après une **confirmation obligatoire** (aucune suppression accidentelle possible), la séance part dans la **corbeille** :
  - vos étudiants n'y ont **plus accès immédiatement** (la séance disparaît aussi pour les nouveaux arrivants) ;
  - vous pouvez la **restaurer pendant 48 heures** (bouton « Restaurer la séance » — toutes les données reviennent intactes, y compris les réponses en cours) ;
  - pendant ce délai, vous gardez l'accès à vos résultats et à l'export CSV ;
  - après 48 h, la séance est **supprimée définitivement** (questions, réponses, notes). Vous pouvez aussi forcer la suppression définitive immédiatement avec une double confirmation.
- **« Dupliquer »** 📄 — crée une **copie prête à l'emploi** de la séance : mêmes questions iRAT/tRAT, mêmes cas cliniques, même nombre d'équipes et même durée — **sans les données des étudiants** (noms, réponses, notes, réclamations). La copie s'ouvre directement avec son **nouveau code** à donner aux étudiants et le **PIN** que vous avez choisi. Idéal pour réutiliser une séance d'une année sur l'autre.

**Nettoyage automatique (rétention de 4 mois)** : 4 mois après sa création, les **données étudiantes** d'une séance (noms, réponses, réclamations, évaluations par les pairs) sont **purgeées automatiquement** dès que vous rouvrez la séance — les QCM, cas cliniques, équipes et réglages sont **conservés** (un bandeau vous l'indique, avec le bouton « Dupliquer » pour réutiliser la séance). Vous n'avez donc rien à faire pour la confidentialité et la base de données reste légère au fil des années.

---

## 2. Comment les étudiants installent l'application sur leur téléphone

Aucun téléchargement, aucun compte :

- **Android (Chrome)** : ouvrez le lien → menu ⋮ → **« Installer l'application »** ou **« Ajouter à l'écran d'accueil »**.
- **iPhone (Safari)** : ouvrez le lien → bouton **Partager** (carré avec flèche) → **« Sur l'écran d'accueil »**.

L'icône apparaît alors comme une vraie application, en plein écran.

---

## 3. MISE EN SERVICE DANS UN NOUVEAU PROJET GITHUB (première installation)
----------------------------------------------------------------------
Suivez les étapes A à E du README.md inclus (comme pour votre première
installation) :

  Étape A — Compte GitHub (si vous en avez déjà un, passez à B).
  Étape B — Créez un NOUVEAU dépôt (repository) GitHub, par exemple
            « tbl-live-v2 », puis glissez-déposez le CONTENU de ce ZIP
            (tous les fichiers et dossiers extraits) via
            « Add file » → « Upload files » → « Commit changes ».
  Étape C — Créez un NOUVEAU projet sur https://neon.com (Sign up avec
            GitHub, « Create project », région proche de vous) et copiez
            la chaîne de connexion PostgreSQL.
  Étape D — Sur https://vercel.com (« Continue with GitHub ») :
            « Add New… » → « Project » → Importez le dépôt tbl-live-v2.
            AVANT de déployer, ajoutez la variable d'environnement :
              Key   : DATABASE_URL
              Value : la chaîne de connexion Neon copiée à l'étape C
            puis « Deploy » (2-3 minutes).
            ✔ Plus RIEN à modifier dans les fichiers : la base est déjà
            configurée pour Neon (PostgreSQL) et ses tables se créent
            toutes seules pendant le déploiement.
  Étape E — Ouvrez l'adresse https://tbl-live-v2-xxxx.vercel.app :
            c'est la NOUVELLE adresse à donner à vos étudiants.

Important : créez un NOUVEAU projet Neon (base vierge) pour cette
version — ne réutilisez pas la chaîne de connexion de l'ancienne
installation : la structure de la base a évolué et doit partir d'une
base neuve. L'ancienne application peut rester en ligne le temps de
valider la nouvelle ; vous pourrez ensuite la supprimer sur Vercel
(Paramètres du projet → Delete) pour éviter tout risque de confusion
entre les deux adresses.

SI LE DÉPLOIEMENT ÉCHOUE (« Error: Command "npm run build" exited with 1 »)
---------------------------------------------------------------------------
1. Erreur au DÉBUT du build (par ex. « Validation Error », « error: Env
   var not found: DATABASE_URL », « P1001 ») : vérifiez DATABASE_URL dans
   Vercel — votre projet → onglet « Settings » → « Environment Variables »
   → il doit y avoir DATABASE_URL avec la chaîne du NOUVEAU projet Neon
   (elle commence par postgresql:// et se termine par ?sslmode=require).
   Après l'avoir ajoutée ou corrigée : onglet « Deployments » → menu « … »
   du déploiement → « Redeploy ». Vérifiez aussi sur GitHub que
   prisma/schema.prisma contient bien : provider = "postgresql"
   (automatique avec ce ZIP v2.2.0).
2. Erreur à la FIN du build (« ENOENT … .next/next-server.js.nft.json ») :
   corrigée par la v2.1.2 — assurez-vous que le dossier « scripts/ » et le
   fichier « package-lock.json » ont bien été téléversés sur GitHub
   (présents dans ce ZIP), puis « Redeploy ».
3. N'utilisez pas la chaîne de l'ANCIEN projet Neon : créez un projet
   Neon neuf comme indiqué à l'étape C.
4. Si l'échec persiste : onglet « Deployments » → cliquez sur le
   déploiement en erreur → « Building » → repérez les dernières lignes
   rouges du journal et transmettez-les : elles permettent un diagnostic
   exact.

CÔTÉ VERCEL ET NEON, ENSUITE ?
------------------------------
- Rien à faire manuellement : à chaque « Commit changes » sur GitHub,
  Vercel redéploie automatiquement (2-3 min) et applique les éventuelles
  évolutions de la base de données à Neon tout seul.
- La purge des données étudiantes et le vidage de la corbeille se font
  tout seuls quand vous ouvrez vos séances : aucun réglage à faire.
- Sur les téléphones : fermer puis rouvrir l'application installée pour
  voir la nouvelle version (ou recharger deux fois).

POUR ESSAYER LOCALEMENT SUR VOTRE ORDINATEUR (optionnel, sans Internet)
------------------------------------------------------------------------
1. Installez Node.js (version LTS) depuis https://nodejs.org.
2. Décompressez ce ZIP dans un dossier, ouvrez un terminal dans ce dossier.
3. Dans prisma/schema.prisma, remplacez « postgresql » par « sqlite »
   (une seule ligne, le temps du test local — ce dossier ne servira qu'en
   local, il ne touche ni GitHub ni Neon).
4. Créez le fichier .env contenant la ligne :  DATABASE_URL="file:./dev.db"
   (sous PowerShell : Set-Content -Path .env -Value 'DATABASE_URL="file:./dev.db"')
5. Tapez :  npm install   puis :  npm run build
   (fonctionne désormais aussi sous Windows, les copies de fichiers sont
   faites par un petit programme multiplateforme)
6. Lancez :  node .next/standalone/server.js
   puis ouvrez http://localhost:3000 dans votre navigateur.

---

## 4. Questions fréquentes

**Un étudiant a perdu sa connexion ou change de téléphone ?** Il rouvre l'application, saisit le même code, **le même nom** et son **code de reprise personnel** (affiché à sa première connexion, disponible dans la séance via la puce « code », ou redonné par l'enseignant dans l'onglet Équipes) : il retrouve son équipe et toutes ses réponses. Sans ce code, personne ne peut prendre sa place — même en connaissant son nom.

**Un étudiant a oublié son code de reprise ?** Ouvrez l'onglet **Équipes** du tableau de bord : le code de chaque étudiant apparaît en petit à côté de son nom.

**J'ai oublié mon PIN et je suis bloqué par le verrouillage ?** Le verrouillage dure 15 minutes maximum — patientez puis réessayez. Après 5 tentatives fausses, la connexion est temporairement bloquée : c'est une protection contre les essais répétés par des étudiants malins.

**J'ai fermé mon navigateur par erreur ?** « Je suis enseignant » → « Reprendre une séance » → code + PIN. Ou rouvrez simplement depuis le même appareil (« Mes séances »).

**J'ai supprimé une séance par erreur ?** Rien n'est perdu pendant 48 heures : rouvrez la séance (« Reprendre une séance » ou « Mes séances ») et cliquez sur **« Restaurer la séance »** dans le bandeau rouge — tout revient, y compris les réponses déjà données par les étudiants.

**Je veux refaire la même séance avec un autre groupe ?** Ouvrez la séance modèle → bouton **« Dupliquer »** → vous obtenez une copie identique (questions + cas cliniques) prête à l'inscription, sans les données des étudiants.

**Que deviennent les vieilles séances ?** Après 4 mois, les données étudiantes (noms, réponses, évaluations) sont purgées automatiquement à l'ouverture de la séance ; les QCM et cas cliniques restent disponibles et dupliquables. Les séances mises à la corbeille depuis plus de 48 h disparaissent définitivement, sans action de votre part.

**Puis-je modifier les questions pendant la séance ?** Oui (onglet « Questions »), mais évitez si des réponses existent déjà — les résultats pourraient devenir incohérents.

**Un étudiant arrive en retard pendant le iRAT ?** Il peut répondre tant que la phase est ouverte. Vous pouvez aussi revenir à une phase précédente (cliquez sur son numéro dans le fil des étapes en haut du tableau de bord).

**Combien d'étudiants ?** L'application est conçue pour des classes de 5 à 150 étudiants. Pour de très grandes classes, le rafraîchissement peut être légèrement moins instantané (toutes les 2,5 s).

**Les données sont-elles privées ?** Les séances ne sont accessibles qu'avec le code à 6 caractères, et le tableau de bord enseignant est protégé par votre PIN (verrouillage automatique après 5 tentatives incorrectes). Deux élèves homonymes ne peuvent pas « s'éjecter » : chacun garde son compte grâce à son code de reprise. N'utilisez pas de données sensibles dans les questions. Aucune donnée n'est partagée avec des tiers.

---
Bonne séance TBL ! 🎓
