# TBL Live — Application de Team-Based Learning

Application web gratuite qui déroule **toutes les étapes de la méthode TBL** (Team-Based Learning) avec vos étudiants, sur n'importe quel téléphone (Android, iPhone) ou ordinateur.

- ✅ **Test individuel (iRAT)** — chaque étudiant répond seul sur son téléphone
- ✅ **Test en équipe (tRAT)** — feedback immédiat façon « carte à gratter » (4 / 2 / 1 / 0 point)
- ✅ **Réclamations (appels)** — les équipes contestent avec justification ; passage automatique au feedback dès que toutes les équipes ont cliqué « Nous n'avons pas de réclamation »
- ✅ **Feedback** — statistiques en direct pour cibler votre mini-cours
- ✅ **Cas cliniques d'application** — chaque cas (énoncé + 3 à 5 QCU) s'affiche un par un ; les réponses sont enregistrées automatiquement au clic et **révélées automatiquement** dès que toutes les équipes ont répondu
- ✅ **Évaluation par les pairs** — chaque étudiant note ses coéquipiers
- ✅ **Résultats** — tableaux complets + export CSV pour Excel (formats « 10 sur 10 » insensibles à la conversion en date)
- ✅ Installable sur l'écran d'accueil des téléphones (PWA), sans magasin d'applications

---

## 1. Comment animer une séance TBL avec l'application

### Avant la séance (5 minutes)

1. Ouvrez l'application → **« Je suis enseignant »** → **« Créer une nouvelle séance »**.
2. Donnez un titre, choisissez un **code PIN à 4 chiffres** (notez-le : il permet de retrouver votre séance depuis n'importe quel appareil), le nombre d'équipes et la durée du iRAT.
3. Saisissez vos questions. Bouton **« Charger l'exemple »** pour découvrir le fonctionnement avec des questions toutes prêtes.
   - Questions **iRAT / tRAT** : questions de vérification de la préparation (utilisées deux fois : en individuel puis en équipe).
   - **Cas cliniques d'application** : chaque cas a un titre, un énoncé (vignette du patient…) et 3 à 5 QCU. Ils sont affichés **un par un** aux équipes pendant la séance.
4. Cliquez sur **« Créer la séance »** : un **code à 6 caractères** s'affiche en grand.

### Pendant la séance (le déroulé guidé)

L'application vous guide étape par étape. Le bouton vert en bas passe d'une étape à la suivante.

| Étape | Ce que vous faites | Ce que font les étudiants |
|---|---|---|
| 1. Accueil | Affichez le code au tableau | Ils saisissent le code + leur nom, choisissent leur équipe |
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

---

## 2. Comment les étudiants installent l'application sur leur téléphone

Aucun téléchargement, aucun compte :

- **Android (Chrome)** : ouvrez le lien → menu ⋮ → **« Installer l'application »** ou **« Ajouter à l'écran d'accueil »**.
- **iPhone (Safari)** : ouvrez le lien → bouton **Partager** (carré avec flèche) → **« Sur l'écran d'accueil »**.

L'icône apparaît alors comme une vraie application, en plein écran.

---

## 3. Héberger l'application GRATUITEMENT et définitivement

L'application fonctionne déjà dans l'aperçu. Pour en disposer **en permanence**, hébergez-la gratuitement sur **Vercel** (avec une base de données **Neon**, gratuite elle aussi). Comptez **30 à 40 minutes**, une seule fois. Aucune connaissance technique n'est nécessaire : suivez simplement les clics.

### Étape A — Créer un compte GitHub (2 min)
1. Allez sur **https://github.com/signup**.
2. Créez votre compte (email + mot de passe).

### Étape B — Déposer le code sur GitHub (5 min)
1. Connectez-vous, cliquez en haut à droite sur **« + »** → **« New repository »**.
2. Nommez-le par exemple `tbl-live`, laissez tout par défaut, cliquez **« Create repository »**.
3. Sur la page suivante, cliquez sur **« uploading an existing file »** (lien au-dessus de la zone vide).
4. Glissez-déposez le **contenu du dossier décompressé** `tbl-live-source.zip` (tous les fichiers et dossiers, mais **pas** le dossier `node_modules` s'il apparaît).
5. Cliquez sur **« Commit changes »**.

### Étape C — Créer la base de données gratuite sur Neon (5 min)
1. Allez sur **https://neon.com** → **« Sign up »** (avec GitHub, c'est le plus simple).
2. Dans votre espace : **« Create project »** → nommez-le `tbl-live` → région au plus près de chez vous → **« Create »**.
3. Sur la page du projet, cherchez la **chaîne de connexion** (bouton **« Connect »** ou « Connection string »). Elle ressemble à :
   `postgresql://neondb_owner:xxxx@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. **Copiez-la** et gardez-la (elle servira à l'étape E).

### Étape D — Modifier UNE ligne pour la base de données (2 min)
1. Sur GitHub, dans votre dépôt, ouvrez le dossier **`prisma`** puis cliquez sur le fichier **`schema.prisma`**.
2. Cliquez sur le crayon ✏️ (modifier). Trouvez la ligne :
   ```
   provider = "sqlite"
   ```
   et remplacez-la par :
   ```
   provider = "postgresql"
   ```
3. Cliquez sur **« Commit changes »** (en bas de page).

### Étape E — Déployer sur Vercel (10 min)
1. Allez sur **https://vercel.com** → **« Sign Up »** → **« Continue with GitHub »**.
2. Cliquez sur **« Add New… »** → **« Project »**.
3. Votre dépôt `tbl-live` apparaît : cliquez **« Import »**.
4. **Avant de déployer**, ouvrez la section **« Environment Variables »** et ajoutez :
   - **Key** (nom) : `DATABASE_URL`
   - **Value** (valeur) : la chaîne de connexion Neon copiée à l'étape C.
   - Cliquez **« Add »**.
5. Cliquez sur **« Deploy »** et attendez 2-3 minutes.
6. 🎉 Votre application est en ligne ! Vercel vous donne une adresse du type
   `https://tbl-live-xxxx.vercel.app` — c'est **cette adresse** que vous donnerez à vos étudiants.

### Étape F — Vérifier (2 min)
1. Ouvrez l'adresse Vercel : l'application doit s'afficher.
2. Créez une séance de test, puis vérifiez dans Neon que les tables sont apparues.

### Coût : 0 €
- **Vercel Hobby** : gratuit pour un usage personnel/éducatif.
- **Neon Free** : gratuit jusqu'à 0,5 Go de stockage (des années de séances TBL).
- Aucune carte bancaire n'est demandée.

### Mettre à jour une installation existante (après une amélioration de l'application)

Quand vous recevez un nouveau fichier ZIP de mise à jour (par ex. `tbl-live-mise-a-jour.zip`) :

1. **Extrayez** le ZIP sur votre ordinateur (clic droit → « Tout extraire »).
2. Ouvrez votre dépôt **GitHub** dans le navigateur → **« Add file » → « Upload files »**.
3. Glissez dans la fenêtre **tous les dossiers et fichiers extraits** (y compris `prisma` et `src` s'ils sont présents, ainsi que `README.md`). Le fichier « LISEZMOI » n'a pas besoin d'être envoyé.
4. Cliquez sur **« Commit changes »**.
5. **C'est tout.** Côté **Vercel** : le redéploiement est automatique (2-3 minutes, onglet « Deployments » → « Ready »). Côté **Neon** : rien à faire — les éventuels changements de base de données sont appliqués automatiquement pendant le déploiement Vercel.
6. Sur les téléphones : fermez puis rouvrez l'application (ou rechargez deux fois) pour voir la nouvelle version.

> ⚠️ N'utilisez que les fichiers du pack de mise à jour reçu — ne remettez pas en ligne l'ancien grand ZIP complet si votre dépôt contient déjà votre configuration Neon.

---

## 4. Questions fréquentes

**Un étudiant a perdu sa connexion ?** Il rouvre l'application, saisit le même code et **le même nom** : il retrouve son équipe et ses réponses.

**J'ai fermé mon navigateur par erreur ?** « Je suis enseignant » → « Reprendre une séance » → code + PIN. Ou rouvrez simplement depuis le même appareil (« Mes séances »).

**Puis-je modifier les questions pendant la séance ?** Oui (onglet « Questions »), mais évitez si des réponses existent déjà — les résultats pourraient devenir incohérents.

**Un étudiant arrive en retard pendant le iRAT ?** Il peut répondre tant que la phase est ouverte. Vous pouvez aussi revenir à une phase précédente (cliquez sur son numéro dans le fil des étapes en haut du tableau de bord).

**Combien d'étudiants ?** L'application est conçue pour des classes de 5 à 150 étudiants. Pour de très grandes classes, le rafraîchissement peut être légèrement moins instantané (toutes les 2,5 s).

**Les données sont-elles privées ?** Les séances ne sont accessibles qu'avec le code à 6 caractères. N'utilisez pas de données sensibles dans les questions. Aucune donnée n'est partagée avec des tiers.

---

## 5. Pour les curieux : la technologie

- **Next.js 16** (React 19, TypeScript) — application web
- **Prisma + PostgreSQL** (Neon) — base de données
- **Tailwind CSS + shadcn/ui** — interface
- **PWA** (manifest + icônes) — installation sur mobile sans magasin d'applications
- Interface 100 % en français, pensée mobile d'abord

Bonne séance TBL ! 🎓
