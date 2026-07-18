# Instructions Codex — F.A.T.

## Objectif

Faire évoluer le calculateur et le site éditorial sans casser la fidélité du moteur ATP, le fonctionnement hors connexion ou l’architecture SEO.

## Avant toute modification

1. Lire `README.md`, `docs/moteur-atp.md` et `docs/strategie-seo.md`.
2. Lancer `npm test`.
3. Démarrer le site avec `npm run serve` ; les modules, le Worker et le service worker ne doivent pas être testés en `file://`.

## Règles moteur

- `physics-core.js` est l’unique source de vérité physique.
- Ne pas dupliquer les calculs dans `app.js` ou dans une page.
- Toute modification de coefficient, d’intégrateur, de convention d’axe ou d’unité exige un test.
- Ne pas ajouter de facteur empirique silencieux. Documenter son origine, sa plage et son effet s’il devient nécessaire.
- Conserver l’attribution visible à Mackila et à l’Airsoft Trajectory Project.
- Distinguer systématiquement estimation théorique, mesure réelle et règle d’organisateur.

## Règles front-end

- Le projet reste sans framework ni dépendance CDN tant qu’un besoin concret ne justifie pas un changement.
- La charte est centralisée au début de `assets/site.css` dans les variables CSS.
- Préserver clavier, contraste, libellés, tableaux accessibles et préférence de réduction des animations.
- Après modification d’un fichier mis en cache, incrémenter la constante `CACHE` dans `service-worker.js`.
- Garder les URL partageables rétrocompatibles : `m`, `j`, `h`, `z`, `w`, `wd`, `t`, `p`, `a`, `c`.

## Règles SEO et éditoriales

- Une page répond à une intention distincte ; ne pas créer une série de pages minces par grammage ou valeur FPS.
- H1 unique, title, meta description, canonique, maillage et données structurées cohérents.
- Ne pas inventer de faits sur Keep, Mackila, une marque, un produit ou une mesure terrain.
- Pour les sujets juridiques, de sécurité ou de produit, vérifier les sources actuelles et afficher la date de révision.
- Le CTA principal des guides renvoie vers une action utile du calculateur.

## Vérifications finales

- `npm test`
- navigation clavier et mobile ;
- calcul par Worker ;
- comparaison et partage d’URL ;
- convertisseur secondaire ;
- installation PWA et rechargement hors connexion ;
- absence de 404 internes ;
- sitemap limité au domaine F.A.T.

