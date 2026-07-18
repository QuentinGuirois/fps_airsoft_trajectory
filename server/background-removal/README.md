# Détourage local F.A.T.

Le détourage est un traitement asynchrone obligatoire avant qu'une image puisse
passer à l'état `ready`. L’API dépose temporairement une image déjà contrôlée
dans une file privée. Une seule instance du worker produit ensuite l'unique
WebP persistant de la card. L’upload et la file ne doivent jamais se trouver
sous `httpdocs` et sont supprimés après succès comme après rejet.

Le fichier reçu est renommé en `.processing` avant traitement. Le worker garde
séparément son extension d’origine pour refaire le contrôle de format : il ne
faut pas valider l’extension temporaire `.processing`.

Les JPEG multivues produits par certains smartphones sont identifiés `MPO` par
Pillow. Ils restent acceptés uniquement derrière une extension/MIME JPEG ; le
worker décode et traite leur première vue normalisée.

Deux sessions sont réutilisées pendant toute la file : `u2netp` pour la passe
rapide et `isnet-general-use` par défaut pour le consensus qualité. Le second
modèle peut être remplacé après benchmark avec
`FAT_REMBG_QUALITY_MODEL=birefnet-general-lite`. Les modèles doivent être
préinstallés et vérifiés dans `U2NET_HOME`, hors de la racine web.

Les prises portrait sont normalisées après sélection du sujet rapide : image et
masque pivotent ensemble, puis le modèle qualité travaille directement sur cette
orientation horizontale. Le dossier passé à `--public` est le stockage persistant
privé des sorties `ready`, hors `httpdocs`; son nom historique ne signifie pas
qu'une card pending est publiquement accessible.

## Installation de recette

```bash
python3 -m venv /chemin/prive/fat-rembg-venv
/chemin/prive/fat-rembg-venv/bin/pip install -r server/background-removal/requirements.txt
mkdir -p /chemin/prive/fat-storage/replicas/{queue,public}
```

Test ponctuel :

```bash
/chemin/prive/fat-rembg-venv/bin/python server/background-removal/worker.py \
  --queue /chemin/prive/fat-storage/replicas/queue \
  --public /chemin/prive/fat-storage/replicas/public \
  --drain
```

`--once` traite au plus un fichier. `--drain` traite toute la file présente,
puis rend la main sans attendre de nouveaux jobs. `--failed` reste accepté pour
compatibilité CLI mais aucun original rejeté n'y est écrit.

`storage.py` fournit les garde-fous applicatifs pour compter le quota (image
active, restauration différée et nouvelle image) et supprimer uniquement les
WebP orphelins dont le délai de restauration est expiré.

Le premier lancement de `rembg` peut télécharger les modèles. Cette installation
doit donc être faite explicitement pendant le déploiement, puis testée avant
l’ouverture du formulaire. Une panne du worker laisse la card non publiable ;
elle ne doit jamais forcer la conservation de l'original ou la publication d'un
détourage imparfait.

La sortie `ready` est toujours un WebP RGBA de 102 400 octets maximum. Qualité
et dimensions baissent progressivement jusqu'au plafond ; en dessous du
plancher configuré, le job est rejeté. Voir
`docs/EXIGENCE_DETOURAGE_REPLIQUES.md` et
`docs/EXIGENCE_STOCKAGE_IMAGES_REPLIQUES.md`.
