# Cards de répliques — contrat de passage en production

## État du dépôt

Le backend PHP/MariaDB et le pipeline de détourage sont désormais la source de
vérité. La route `/tu-joues-avec-quoi/` expose uniquement les cards dont la
publication et l’image ont été validées côté serveur. La V3 conserve ces
règles :

- aucune fiche de démonstration, valeur manquante, card privée ou photo
  « brouillon » dans la galerie publique ;
- seuls les enregistrements `published` avec une image `ready` sont retournés
  par l’API publique ;
- aucun enregistrement de soumission dans `localStorage`, qui ne fournit ni
  sécurité, ni partage entre visiteurs, ni modération ;
- aucun original téléversé servi directement depuis un répertoire public.

`replica-utils.js` et `data/replica-submission.schema.json` documentent les
bornes côté client. Les migrations `database/migrations/` et les validations
PHP restent la source de vérité côté serveur.

## Architecture retenue

Le site reste une PWA statique en JavaScript vanilla. Une publication ouverte
nécessite une petite API PHP 8.2/8.3 sous le même domaine, PDO et une base
MariaDB dédiée :

- aucune clé secrète dans le navigateur ou le dépôt ;
- sessions sécurisées et jetons CSRF ;
- requêtes préparées avec un compte MariaDB limité aux tables répliques ;
- métadonnées et état de modération en base ;
- upload temporaire et file de traitement hors de `httpdocs` ;
- une seule image persistante par card : un WebP validé de 102 400 octets
  maximum, jamais l'original ni une série de dérivées.

Le worker Python de détourage reste facultatif et n’est jamais exécuté dans la
requête PHP. Il ne justifie pas à lui seul un service Node permanent.

## Flux de soumission

1. Le visiteur calcule son setup et enregistre sa courbe dans son espace privé.
2. Le formulaire exige une courbe enregistrée, le pseudo, le nom réel de la réplique, une
   photo latérale et l’acceptation explicite des droits.
3. Le navigateur réduit la copie d’aperçu, normalise son orientation et retire
   ses métadonnées. Il ne présente jamais ce traitement comme une validation.
4. L’API refait tous les contrôles : origine, chemin, paramètres uniques `m` et
   `j`, bornes, CSRF, origine de requête, honeypot et quotas.
5. Le serveur détecte le MIME avec `finfo`, décode réellement l’image, borne ses
   dimensions et sa taille, refuse SVG et noms de fichiers fournis par le client.
6. L’upload reste temporaire, hors zone publique, uniquement pendant le job.
   MariaDB reçoit une ligne `pending` avec `image_status = 'queued'`.
7. Le worker compare obligatoirement un masque `u2netp` et un second masque de
   qualité, nettoie la géométrie, recadre, puis compresse le résultat. Un seul
   contrôle en échec produit `rejected` ; il n’existe ni meilleur effort, ni
   image normale de repli, ni file `needs_review`.
8. Une sortie `ready` est relue et prouve : WebP réel, canal alpha, dimensions
   positives et taille inférieure ou égale à 102 400 octets. Elle est écrite
   atomiquement, puis l’upload et tous les intermédiaires sont supprimés.
9. Une sortie `rejected` supprime également tout et demande une autre photo.
   La validation du détourage n’exige aucune intervention administrateur. Le
   visiteur doit néanmoins confirmer son propre résultat avant de soumettre sa
   card ; la modération éventuelle du texte et des droits reste un sujet séparé.

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

`server/background-removal/worker.py` traite un fichier à la fois et verrouille
la file contre une seconde instance. Il conserve l’extension logique après le
renommage en `.processing`, reconnaît JPEG/MPO, PNG et WebP, utilise uniquement
la première vue d’un MPO, normalise l’orientation et ne réécrit aucune
métadonnée.

Le masque rapide `u2netp` et le masque de qualité doivent converger sur l’IoU,
les boîtes englobantes et les extrémités. Le nettoyage conserve le composant
horizontal dominant et ses accessoires proches, supprime les composantes
isolées, ne comble que de petits trous et recadre avec 4 à 6 % de marge. Le
worker tourne ensemble l’image et le premier masque lorsqu’une prise smartphone
portrait contient bien une réplique latérale complète. Le second modèle analyse
alors cette orientation normalisée. Le
WebP est essayé aux qualités 82, 76, 70, 64, 58 et 52 ; à défaut, les dimensions
sont réduites par paliers de 90 %. Le job est refusé plutôt que de dépasser
100 Ko ou de descendre sous le plancher prévu.

La base ne contient ni BLOB, ni base64, ni chemin d’original. Elle ne mémorise
que `image_path`, `image_mime = 'image/webp'`, taille, dimensions, SHA-256,
état et date de génération. La miniature de courbe reste vectorielle.
Le quota additionne l'image active, les anciennes images encore dans leur délai
privé de restauration et la nouvelle sortie. Le nettoyage des orphelins ignore
les chemins référencés et tout WebP dont le délai n'est pas expiré.

Le modèle `u2netp` doit être installé dans un environnement virtuel privé. Le
premier lancement peut télécharger le modèle : l’opération doit être contrôlée
pendant la recette, jamais déclenchée par une visite web.

## Déploiement Plesk — ordre obligatoire

1. Confirmer le gestionnaire PHP du domaine et les extensions `pdo_mysql`,
   `fileinfo`, `gd` ou `imagick` dans Plesk.
2. Créer une base et un utilisateur dédiés, puis appliquer
   `database/replicas.sql` avec sauvegarde préalable.
3. Créer un répertoire temporaire d’upload et la file privée hors de
   `httpdocs`, plus le répertoire final WebP avec droits minimaux. Ne créer
   aucun stockage durable `originals`, `normal`, `thumbnail` ou `failed`.
4. Fournir les secrets par configuration privée ou variables d’environnement,
   jamais par un fichier versionné.
5. Déployer et tester l’API en environnement fermé : CSRF, CORS/origine,
   doubles paramètres, MIME trompeur, image défectueuse, quotas et concurrence.
6. Installer le worker seulement si les ressources CPU/RAM et la version Python
   sont compatibles. Limiter à une instance.
7. Tester le rejet automatique, la suppression des temporaires, le remplacement
   atomique, le délai de restauration de l’ancien WebP et les fichiers orphelins.
8. Mettre en cache uniquement le shell statique de la galerie ; les réponses
   API et images authentifiées ne doivent jamais rejoindre le cache PWA.
9. La route publique, le menu et le sitemap peuvent être actifs tant que l’API
   ne renvoie que les cards `published` dont l’image est `ready`.

La présence d’un accès SSH ou d’une base MariaDB ne suffit pas à ouvrir la
fonction. Tant que l’API, l’interface de modération et les preuves d’autorisation
ne sont pas terminées, aucun changement distant n’est nécessaire.
