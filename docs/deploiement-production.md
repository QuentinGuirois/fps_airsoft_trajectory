# Livraison GitHub Actions vers Plesk

Le workflow `.github/workflows/production.yml` teste chaque pull request et
chaque push vers `main`. Le job de production ne peut démarrer que depuis un
push sur `main` lorsque la variable GitHub `DEPLOY_LIVE_ENABLED` vaut `true`, ou
depuis un lancement manuel explicite. Les commits et tests locaux ne contactent
jamais Plesk.

## Blocages avant activation

Ne pas régler `DEPLOY_LIVE_ENABLED=true` et ne pas exposer le lien Compte tant
que les points suivants ne sont pas tous validés :

- la boîte `contact@fps-airsoft-trajectory.com` reçoit effectivement les
  messages ;
- l'adresse postale de Quentin Guirois, éditeur personne physique, est ajoutée
  aux pages légales ;
- la durée de conservation des journaux techniques et d'audit est décidée ;
- les vraies clés Turnstile sont installées et testées sur le domaine ;
- un dry-run distant et un rollback supervisé sont réussis.

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
