# Détourage local F.A.T.

Le détourage est un traitement optionnel et asynchrone. L’API de soumission
dépose une image déjà contrôlée dans une file privée. Une seule instance du
worker produit ensuite une WebP transparente. L’original et la file ne doivent
jamais se trouver sous `httpdocs`.

Le fichier reçu est renommé en `.processing` avant traitement. Le worker garde
séparément son extension d’origine pour refaire le contrôle de format : il ne
faut pas valider l’extension temporaire `.processing`.

Les JPEG multivues produits par certains smartphones sont identifiés `MPO` par
Pillow. Ils restent acceptés uniquement derrière une extension/MIME JPEG ; le
worker décode et traite leur première vue normalisée.

## Installation de recette

```bash
python3 -m venv /chemin/prive/fat-rembg-venv
/chemin/prive/fat-rembg-venv/bin/pip install -r server/background-removal/requirements.txt
mkdir -p /chemin/prive/fat-storage/replicas/{queue,public,failed}
```

Test ponctuel :

```bash
/chemin/prive/fat-rembg-venv/bin/python server/background-removal/worker.py \
  --queue /chemin/prive/fat-storage/replicas/queue \
  --public /chemin/prive/fat-storage/replicas/public \
  --failed /chemin/prive/fat-storage/replicas/failed \
  --drain
```

`--once` traite au plus un fichier. `--drain` traite toute la file présente,
puis rend la main sans attendre de nouveaux jobs.

Le premier lancement de `rembg` peut télécharger le modèle `u2netp`. Cette
installation doit donc être faite explicitement pendant le déploiement, puis
testée avant l’ouverture du formulaire. Une panne du worker ne doit jamais
bloquer une soumission ou forcer la publication d’un détourage imparfait.
