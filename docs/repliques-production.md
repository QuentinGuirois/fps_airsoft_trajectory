# Cards de répliques — contrat de passage en production

## État du dépôt

Le pack `replicas-rembg-mvp` est une proposition d’architecture, pas un
backend prêt à publier. La V3 conserve donc ces règles :

- aucune route `/tu-joues-avec-quoi/` tant qu’aucun profil ne respecte
  `data/operator-profile.schema.json` ;
- aucune fiche de démonstration, valeur manquante ou photo « brouillon » dans
  le sitemap ou le cache PWA ;
- aucun enregistrement de soumission dans `localStorage`, qui ne fournit ni
  sécurité, ni partage entre visiteurs, ni modération ;
- aucun original téléversé servi directement depuis un répertoire public.

`replica-utils.js`, `data/replica-submission.schema.json` et
`database/replicas.sql` préparent le futur flux sans l’ouvrir. Ils ne remplacent
jamais les validations serveur.

## Architecture retenue

Le site reste une PWA statique en JavaScript vanilla. Une publication ouverte
nécessite une petite API PHP 8.2/8.3 sous le même domaine, PDO et une base
MariaDB dédiée :

- aucune clé secrète dans le navigateur ou le dépôt ;
- sessions sécurisées et jetons CSRF ;
- requêtes préparées avec un compte MariaDB limité aux tables répliques ;
- métadonnées et état de modération en base ;
- originaux et file de traitement hors de `httpdocs` ;
- seules des dérivées validées peuvent devenir publiques.

Le worker Python de détourage reste facultatif et n’est jamais exécuté dans la
requête PHP. Il ne justifie pas à lui seul un service Node permanent.

## Flux de soumission

1. Le visiteur calcule son setup et copie son lien F.A.T.
2. Le formulaire exige le lien, le pseudo, le nom réel de la réplique, une
   photo latérale et l’acceptation explicite des droits.
3. Le navigateur réduit la copie d’aperçu, normalise son orientation et retire
   ses métadonnées. Il ne présente jamais ce traitement comme une validation.
4. L’API refait tous les contrôles : origine, chemin, paramètres uniques `m` et
   `j`, bornes, CSRF, origine de requête, honeypot et quotas.
5. Le serveur détecte le MIME avec `finfo`, décode réellement l’image, borne ses
   dimensions et sa taille, refuse SVG et noms de fichiers fournis par le client.
6. L’original reçoit un nom aléatoire et reste privé. MariaDB reçoit une ligne
   `pending`. Rien n’est public à cette étape.
7. Le détourage asynchrone crée une dérivée candidate. Une dérivée normale
   reste disponible si le résultat est mauvais ou si le worker est arrêté.
8. Un modérateur publie ou rejette. L’API publique ne retourne que
   `status = 'published'` et jamais un chemin privé.

## Mesures anti-abus minimales

- cookies `Secure`, `HttpOnly`, `SameSite=Lax` et rotation de session ;
- token CSRF lié à la session et contrôle raisonnable de `Origin`/`Referer` ;
- limitation par HMAC de l’adresse IP, sans conserver l’IP brute ;
- quota par session et fenêtre temporelle, avec honeypot ;
- longueurs strictes des textes et allowlist YouTube HTTPS ;
- JPEG, PNG ou WebP décodable, 8 Mo et 36 mégapixels maximum ;
- en-têtes `nosniff`, CSP et interdiction d’exécution dans tout stockage ;
- journalisation sans contenu d’image, secret ni IP brute ;
- suppression, export et durée de conservation documentés pour le RGPD ;
- challenge anti-spam externe uniquement si le spam réel le justifie et avec
  validation côté serveur.

## Détourage local

`server/background-removal/worker.py` traite un fichier à la fois. Le worker du
pack perdait l’extension d’origine après le renommage en `.processing`, ce qui
faisait échouer son propre contrôle de format. La version intégrée transporte
explicitement l’extension originale, calcule le hash en flux et borne aussi le
nombre de pixels.

Le modèle `u2netp` doit être installé dans un environnement virtuel privé. Le
premier lancement peut télécharger le modèle : l’opération doit être contrôlée
pendant la recette, jamais déclenchée par une visite web.

## Déploiement Plesk — ordre obligatoire

1. Confirmer le gestionnaire PHP du domaine et les extensions `pdo_mysql`,
   `fileinfo`, `gd` ou `imagick` dans Plesk.
2. Créer une base et un utilisateur dédiés, puis appliquer
   `database/replicas.sql` avec sauvegarde préalable.
3. Créer les répertoires privés `originals`, `queue`, `public-candidates` et
   `failed` hors de `httpdocs`, avec droits minimaux.
4. Fournir les secrets par configuration privée ou variables d’environnement,
   jamais par un fichier versionné.
5. Déployer et tester l’API en environnement fermé : CSRF, CORS/origine,
   doubles paramètres, MIME trompeur, image défectueuse, quotas et concurrence.
6. Installer le worker seulement si les ressources CPU/RAM et la version Python
   sont compatibles. Limiter à une instance.
7. Tester le parcours modération, la suppression, la restauration et le repli
   sans détourage.
8. Ajouter la page, ses modules et ses dérivées au cache PWA uniquement après
   un premier profil vérifié et autorisé.
9. Ajouter enfin la route au menu, aux liens internes et au sitemap.

La présence d’un accès SSH ou d’une base MariaDB ne suffit pas à ouvrir la
fonction. Tant que l’API, l’interface de modération et les preuves d’autorisation
ne sont pas terminées, aucun changement distant n’est nécessaire.
