# Livraison GitHub Actions vers Plesk

Le workflow `.github/workflows/production.yml` teste chaque pull request et
chaque push vers `main`. Le job de production ne peut démarrer que depuis un
push sur `main` lorsque la variable GitHub `DEPLOY_LIVE_ENABLED` vaut `true`, ou
depuis un lancement manuel explicite. Les commits et tests locaux ne contactent
jamais Plesk.

## État préalable à l’activation

Les informations juridiques ont été confirmées le 18 juillet 2026 : la boîte
`contact@fps-airsoft-trajectory.com` reçoit les messages, l’adresse de l’éditeur
personne physique figure dans les pages légales et les journaux techniques et
d’audit sont conservés 180 jours. Les inscriptions restent ouvertes par défaut
avec `ACCOUNT_REGISTRATION_ENABLED=true`. Ce flag est un coupe-circuit
d’exploitation : le passer à `false` ferme uniquement les nouvelles
inscriptions, sans bloquer les connexions existantes.

Avant chaque activation, les vraies clés Turnstile doivent rester installées
dans le fichier privé, puis un dry-run distant et un rollback supervisé doivent
être réussis.

## IP visiteur derrière Cloudflare

L’application n’accepte jamais directement `CF-Connecting-IP` : elle limite les
requêtes avec `REMOTE_ADDR`. Sur une pile Plesk Nginx + Apache, vérifier d’abord
quel proxy réécrit cette valeur. Cloudflare précise que l’origine voit sinon une
adresse Cloudflare et recommande de restaurer l’IP visiteur uniquement depuis
ses proxys de confiance :

- documentation : https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/ ;
- plages autoritaires : https://www.cloudflare.com/ips/ (IPv4 et IPv6).

Si Apache reçoit directement les connexions Cloudflare, activer `mod_remoteip`,
définir `RemoteIPHeader CF-Connecting-IP` et ajouter une directive
`RemoteIPTrustedProxy` pour **chaque plage officielle actuelle**, jamais pour
`0.0.0.0/0`, `::/0` ou une source quelconque. Si Nginx précède Apache, restaurer
l’IP au niveau Nginx/Plesk conformément à la pile réellement active et ne pas
empiler deux réécritures non contrôlées.

Procédure de preuve sans exposer d’IP dans l’interface publique :

1. sauvegarder la configuration Plesk/vhost et garder une session SSH de secours ;
2. relever temporairement, dans un journal privé, `REMOTE_ADDR` et le Ray ID
   depuis deux connexions distinctes (par exemple réseau fixe et mobile) ;
3. vérifier que les deux `REMOTE_ADDR` diffèrent et ne sont pas des adresses
   Cloudflare, puis supprimer ce journal de diagnostic ;
4. envoyer un faux `CF-Connecting-IP` en accédant directement à l’origine depuis
   une source non autorisée : il ne doit jamais remplacer `REMOTE_ADDR` ;
5. exécuter `apachectl configtest` ou l’équivalent Plesk avant rechargement, puis
   vérifier que les quotas de deux visiteurs ne partagent plus la même empreinte.

## Revue d’infrastructure avant mise en ligne

- appliquer les mises à jour supportées de Plesk, de l’OS, de PHP et de MariaDB
  après sauvegarde et fenêtre de retour arrière ;
- conserver un compte MariaDB applicatif limité à sa seule base et sans droits
  globaux, distinct du compte de sauvegarde/migration ;
- autoriser SSH par clé, désactiver les accès inutiles et préserver une session
  administrateur de secours pendant toute modification ;
- vérifier les jails Fail2Ban Plesk/SSH et tester leur alerte sans verrouiller le
  seul administrateur ;
- produire une sauvegarde externe chiffrée de la base, des images finales et de
  la configuration privée, puis documenter et tester une restauration ;
- confirmer périodiquement que `expose_php=Off`, que `X-Powered-By` est absent
  et que le vhost/Cloudflare ne divulgue pas une bannière détaillée `PleskLin`.

## Arborescence serveur

`DEPLOY_PATH` désigne la racine dédiée au domaine, jamais `/`, `/var` ou
`/var/www` :

```text
DEPLOY_PATH/
  current -> releases/<sha>
  releases/<sha>/
  releases/private -> ../private
  incoming/
  recette/                 # non servi
  storage/                 # persistant, hors release
  private/
    config/fat.env
    config/deploy.env
    config/mariadb-client.cnf
    backups/
    locks/
    logs/
    state/
```

Dans Plesk, le document root du domaine doit cibler `current`. Avant ce
changement, copier la version actuellement servie dans une release de bootstrap
privée et créer `current` vers cette release. Cela fournit un retour arrière dès
le premier déploiement. Ne pas remplacer `httpdocs` à l'aveugle et ne jamais y
placer un dump.

Les trois fichiers de configuration privée doivent appartenir à l'utilisateur
du vhost et ne pas être lisibles par les autres utilisateurs. Les exemples
versionnés se trouvent dans `config/`, sans valeur réelle. Le compte MariaDB du
fichier client sert uniquement à la sauvegarde transactionnelle préalable aux
migrations.

## Turnstile sans exposer le secret

1. Dans Cloudflare, créer un widget Turnstile pour
   `fps-airsoft-trajectory.com`.
2. Dans Plesk : **Sites Web & Domaines → fps-airsoft-trajectory.com →
   Gestionnaire de fichiers**.
3. Ouvrir le fichier privé `private/config/fat.env`, situé hors de `current` et
   hors de tout répertoire servi.
4. Y renseigner directement dans l'éditeur Plesk :

```text
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=<clé publique>
TURNSTILE_SECRET_KEY=<secret saisi uniquement ici>
TURNSTILE_EXPECTED_HOSTNAME=fps-airsoft-trajectory.com
```

Le secret ne doit être collé ni dans un terminal partagé, ni dans GitHub, ni
dans un ticket ou une conversation. Après sauvegarde, vérifier uniquement la
présence des quatre variables et les droits du fichier, jamais leurs valeurs.

## Emails transactionnels

Les confirmations d’inscription et demandes de nouveau mot de passe sont
envoyées en `multipart/alternative` : une version texte et une version HTML en
tableaux, sans JavaScript, police distante, pixel de suivi ou pièce jointe. Le
logo public est servi depuis `/assets/img/fat-logo-email.png`; les secrets et
jetons restent uniquement dans les liens à usage limité.

La configuration privée de production doit conserver :

```text
MAIL_MODE=native
MAIL_FROM=noreply@fps-airsoft-trajectory.com
MAIL_REPLY_TO=contact@fps-airsoft-trajectory.com
```

`MAIL_FROM` doit appartenir au domaine aligné SPF/DKIM. `MAIL_REPLY_TO` est une
boîte réellement surveillée. Ces emails sont strictement transactionnels : ils
n’emploient ni en-tête de campagne ni faux lien de désinscription. Tester après
chaque changement dans au moins Gmail, Outlook et Apple Mail, en contrôlant le
contenu texte, le bouton, le lien de secours et l’authentification SPF/DKIM/DMARC
dans les en-têtes reçus.

## GitHub Environment `production`

Dans **Settings → Environments → New environment**, créer `production`, limiter
les branches de déploiement à `main` et, si le forfait le permet, exiger une
approbation. Ajouter ces secrets d'environnement :

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_HOST_KEY`
- `DEPLOY_PATH`

`DEPLOY_USER` est un utilisateur SSH dédié, borné à cette arborescence. La clé
publique correspondante est la seule ajoutée au serveur. `DEPLOY_HOST_KEY`
contient l'empreinte `known_hosts` contrôlée hors bande ; le workflow interdit
`StrictHostKeyChecking=no`. Ajouter séparément la variable de dépôt
`DEPLOY_LIVE_ENABLED=false`.

Protéger ensuite `main` dans **Settings → Branches / Rulesets** : pull request
requise lorsque plusieurs intervenants travaillent, et checks `JS, navigateur,
PHP et Python` et `API et MariaDB` obligatoires.

## Première activation

### Activation du Radar des parties

Le Radar requiert PHP 8.3, MariaDB, `pdo_mysql`, `mbstring`, `openssl` et
`json`. Avant le premier déploiement qui contient
`database/migrations/005_radar.sql`, ajouter au fichier privé `fat.env` :

```text
RADAR_GEOCODER_URL=https://data.geopf.fr/geocodage/search
RADAR_GEOCODER_TIMEOUT_SECONDS=4
RADAR_GEOCODER_CACHE_TTL_SECONDS=604800
RADAR_DELETED_RETENTION_DAYS=30
RADAR_REPORT_RETENTION_DAYS=365
```

L’URL IGN est verrouillée sur l’endpoint officiel lorsque
`APP_ENV=production`. Ne pas ajouter de clé, token ou URL de proxy au dépôt.
Les actions Turnstile `radar_publish`, `radar_cancel`, `radar_delete` et
`radar_report` utilisent le widget et le secret déjà configurés.

Après migration, programmer sous l’utilisateur du vhost :

```bash
/opt/plesk/php/8.3/bin/php <DEPLOY_PATH>/current/bin/maintenance.php
```

Fréquence recommandée : toutes les dix minutes. Vérifier le chemin exact fourni
par Plesk et l’accès au fichier privé. La tâche expire les parties terminées et
purge les caches/données selon les durées configurées.

La route Apache `/parties-airsoft/<slug>/` doit servir
`parties-airsoft/index.html` avec `X-Robots-Tag: noindex, follow`. Tester aussi
que `/api/` et `/compte/` ne rejoignent jamais le cache PWA. La recette
détaillée, l’attribution IGN et la procédure locale figurent dans
`docs/radar.md`.

1. Laisser `DEPLOY_LIVE_ENABLED=false`.
2. Lancer **Actions → Tests et release production → Run workflow → dry-run**.
   L'archive est extraite sous `recette/<sha>`, sans migration ni activation.
3. Contrôler le manifeste, l'absence de `.env`, tests, fixtures, originaux et
   données privées.
4. Initialiser le lien `current` avec la release de bootstrap et faire pointer
   le document root Plesk dessus pendant une fenêtre supervisée.
5. Lancer manuellement le mode `deploy`. Le script sauvegarde la base, applique
   seulement les migrations additives, remplace atomiquement `current`, puis
   exige `{"status":"ok"}` sur `/api/v1/health`.
6. Tester le rollback vers le SHA de bootstrap :

```bash
bash bin/rollback-release.sh <DEPLOY_PATH> <SHA_CIBLE>
```

7. Après preuve du rollback, activer `DEPLOY_LIVE_ENABLED=true`. Dès lors, un
   push volontaire sur `main` déclenche un unique déploiement. Cinq releases au
   minimum sont conservées ; `storage`, `private` et les sauvegardes restent
   hors release.

## Premier administrateur

Le compte doit d'abord être créé par le formulaire public et son email vérifié.
Depuis un terminal SSH interactif du serveur :

```bash
php current/bin/promote-admin.php --email adresse-du-compte
```

La commande n'affiche que l'identifiant et le pseudo, exige la saisie exacte de
`PROMOUVOIR`, verrouille le compte dans une transaction, révoque ses sessions et
écrit l'événement `admin.promoted`. Aucun compte ni email administrateur n'est
codé par défaut.

## Retour arrière et limites

Un health check en échec restaure automatiquement le lien précédent et met le
job en échec. Les migrations sont additives : le code précédent reste donc
compatible, mais la sauvegarde MariaDB doit être conservée avant toute évolution
non rétrocompatible. Le script ne supprime que des répertoires de release dont
le nom est un SHA contrôlé et n'utilise jamais `rsync --delete` sur le docroot.
