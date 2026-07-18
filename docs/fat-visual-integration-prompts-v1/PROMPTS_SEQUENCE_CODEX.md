# Prompts séquencés pour Codex

Utiliser ces prompts dans l’ordre, dans le même fil et sur la même branche. Joindre `Identité visuelle airsoft balistique.zip` au premier prompt. Ne passer au lot suivant que lorsque les tests du lot courant sont verts.

---

## Prompt 1 — Audit, tokens, polices, thèmes, logo et loader

Tu travailles dans le dépôt courant F.A.T. V3. Le pack joint `Identité visuelle airsoft balistique.zip` contient `charte-fat-codex.md`, `Identité F.A.T.dc.html`, `.thumbnail`, `support.js` et une ancienne photographie du projet sous `uploads/`.

Réalise le lot 1 de l’intégration visuelle.

Avant de modifier : lis `AGENTS.md`, `README.md`, `docs/moteur-atp.md`, `docs/strategie-seo.md`, la charte entière et les vues `3a`, `1a`, `1e` de la maquette. Inspecte `git status`, lance `npm test`, relève le nombre de pages, marques/produits gaz, points de température et ressources PWA. Le dépôt courant est la source de vérité. Ne copie pas la photographie `uploads/` par-dessus lui. N’intègre jamais `support.js`, `.thumbnail`, les liens Google Fonts ni les styles inline de la démo.

Implémente uniquement :

1. les tokens exacts de la charte, centralisés dans `assets/site.css` ;
2. Saira, IBM Plex Mono et Saira Stencil One auto-hébergées en WOFF2 depuis des sources officielles, avec licences OFL, sans CDN, plus Inter existante ;
3. les rôles typographiques et composants de base : chips, tags de confiance, carte champ, métrique héros, patch stencil, bande camo CSS, hachures et bloc attribution ;
4. un thème accessible à trois états `Système / Nuit / Jour`, par défaut système avec repli nuit, persistant, appliqué dans le `<head>` avant le premier paint, sans flash ;
5. mise à jour de `color-scheme`, `theme-color`, des SVG inline et des couleurs Canvas déjà utilisées ; le Canvas doit lire les variables via `getComputedStyle` et se redessiner au changement ;
6. le logo `1a` et ses actifs : SVG, favicon, PNG 192/512, maskable avec zone sûre, image sociale distincte ; manifeste et cache mis à jour ;
7. le loader `3a` en vanilla, sans `DCLogic` : courbe, bille, sol, lockup, barre, %, phrases. Il apparaît après 300 ms, suit le `requestId` actif, plafonne à 99 avant la vraie réponse, atteint 100 seulement à la réponse, gère l’erreur et ne ralentit jamais artificiellement. Plein écran au premier calcul, compact pour un recalcul lent. Réduction de mouvement et fallback sans Motion Path obligatoires.

Ne modifie pas le moteur ATP, la structure SEO ni les données gaz. Si le dépôt a plus de 32 produits, leur nombre doit rester identique.

Ajoute des tests pour le thème, le loader, les actifs et l’absence de CDN. Incrémente la version du cache. Lance tous les tests et vérifie en HTTP nuit/jour, clavier et reduced motion.

Arrête-toi après ce lot. Rends : fichiers modifiés, tests, captures nuit/jour du header et du loader, preuve que le moteur et les données sont inchangés, problèmes éventuels. Ne fais pas de commit.

---

## Prompt 2 — Système de composants et pages

Poursuis l’intégration F.A.T. sur l’état laissé par le lot 1. Relis la charte et les maquettes `2a` à `2f`. Vérifie d’abord que tous les tests sont verts et préserve les changements existants.

Implémente la peau complète des pages sans modifier les calculs ni réécrire les contenus SEO :

- accueil `2a` : hero, console, strip camo, structure cockpit, cartes de guides numérotées, CTA et footer ;
- mobile `2b` : navigation, presets scrollables, champs et CTA tactiles ≥44 px ;
- guides `2d` : largeur 65–70 caractères, sommaire/CTA sticky, callouts, patches et rendu correct dans les deux thèmes ; la maquette claire n’autorise pas à forcer le thème du visiteur ;
- outil gaz `2e` : sélecteurs à gauche, résultat/courbe à droite, comparaison, provenance et tags de confiance ; conserve intégralement le jeu gaz courant et ses comportements URL/localStorage ;
- À propos `2f` : photo réelle disponible, patch Keep et bloc Mackila réutilisable ;
- header, navigation, thème, logo et footer cohérents sur toutes les pages, y compris offline ;
- composants de carte opérateur conformes à `2c`, mais aucun profil, chiffre, citation ou lien fictif.

Pour `/tu-joues-avec-quoi/`, publie la page uniquement si le dépôt contient au moins un profil vérifié avec données autorisées. Sinon, ajoute un schéma de données et le composant documenté, ne crée pas de page mince dans le sitemap, et signale le besoin éditorial.

Applique les tags de confiance aux résultats calculés, données externes, valeurs de profils et affirmations chiffrées mises en avant. Les champs saisis par l’utilisateur et graduations ne nécessitent pas un badge individuel. Chaque tag doit être lisible sans couleur.

N’ajoute aucun framework, CDN ou fait non vérifié. Ne change pas titles, H1, canoniques ni JSON-LD sans nécessité. Mets à jour le service worker et ses tests si des ressources changent.

Ajoute des tests de cohérence du header/footer, de présence du sélecteur, des liens internes, du SEO et de conservation exacte des données gaz. Vérifie 360, 390, 768, 1024 et 1440 px dans les deux thèmes, clavier et reduced motion.

Arrête-toi après ce lot et rends les captures comparatives, les tests et les écarts restants. Ne fais pas de commit.

---

## Prompt 3 — Cockpit et graphe 2D

Poursuis sur les lots 1 et 2 validés. Relis `1f`, `1i`, `2a`, `2b` et la section « graphe » de `charte-fat-codex.md`. Lance d’abord les tests.

Refonds le rendu du calculateur en cockpit et améliore le graphe 2D sans toucher à `physics-core.js`, aux constantes, au Worker ni aux paramètres URL.

Exigences :

- tous les paramètres, préréglages, résultats, comparaisons, tables, partage, stockage et onglets existants restent fonctionnels ;
- format trajectoire proche de 4,5:1 desktop et 3:1 mobile ;
- scène sticky sous le header sur desktop ; 2D compacte et quatre métriques utilisables sur mobile sans bloquer les champs ou le clavier virtuel ;
- si une exagération verticale ×10 est appliquée, la chip `HAUTEUR ×10` est toujours visible ; ne mens pas si le facteur réel diffère ;
- mode trajectoire : enveloppe ATP ±15,24 cm autour de la visée, ligne de visée pointillée, grille, sol, marqueurs portée utile/apex/impact ;
- active 3,5 px acide ; comparaisons 2 px pointillées avec `curve-2`, `curve-3`, `curve-4` ; légende textuelle ;
- autres onglets énergie, dérive, rotation et écart de visée préservés ; pas d’enveloppe ATP hors du mode trajectoire ;
- toutes les couleurs Canvas viennent des variables CSS au moment de dessiner et le changement de thème redessine sans recalculer la physique ;
- caption, table et libellé accessible du Canvas conservés ;
- loader compact du lot 1 raccordé aux recalculs lents et erreurs, sans flash sur les calculs rapides.

Ajoute des tests unitaires sur la préparation des séries, les marqueurs, le thème et les comparaisons. Teste URL anciennes et actuelles, fallback sans Worker, redimensionnement, zoom navigateur, clavier et reduced motion.

Arrête-toi après la 2D. Rends les captures desktop/mobile nuit/jour, les tests et la preuve que les sorties numériques ATP sont inchangées. Ne fais pas de commit.

---

## Prompt 4 — Vue drone 3D progressive

Poursuis sur la 2D validée. Ce lot ajoute seulement la vue `1h` / `VUE DRONE 3D`. Il ne doit modifier aucune formule ou donnée physique.

Implémente un module de rendu 3D séparé et lazy-loadé au premier clic. Auto-héberge une version figée minimale de Three.js et les contrôles nécessaires, avec licence, sans CDN. Vérifie dans le réseau que rien de 3D n’est téléchargé avant activation.

La scène doit consommer exactement les points du dernier résultat du Worker partagé avec la 2D : sol quadrillé, ligne de tir, ruban trajectoire, projection pointillée de la dérive au sol, bille, marqueurs `DÉPART / APEX / IMPACT`, caméras `DRONE / TIREUR / PROFIL`, bouton `REJOUER LE TIR`. `PROFIL` doit cadrer comme la vue 2D.

Gère le cycle de vie : redimensionnement, pause hors écran, annulation de l’animation, destruction des ressources et listeners, changement de thème sans recréer la physique. Avec reduced motion, aucune lecture automatique et caméras instantanées.

Progressive enhancement obligatoire : détecte WebGL avant d’afficher le toggle ; si WebGL manque ou si l’import échoue, masque la 3D et conserve la 2D sans erreur ni rejet non géré.

Mobile : la 3D s’ouvre en plein écran via un contrôle explicite. Tente le verrouillage paysage seulement après l’entrée en plein écran et accepte son refus. Fournis orbite tactile, recadrage, sortie évidente, safe areas et fonctionnement portrait de secours.

Ajoute les modules au cache PWA, incrémente `CACHE`, puis teste la 3D hors ligne après installation. Ajoute des tests pour détection/fallback, partage du même état et non-chargement initial.

Arrête-toi après ce lot. Rends poids des actifs 3D, preuve de lazy-load, captures des trois caméras, tests WebGL/sans WebGL et limites navigateur. Ne fais pas de commit.

---

## Prompt 5 — Recette finale et correction des régressions

Effectue la recette finale de toute l’intégration F.A.T. en suivant `CHECKLIST_RECETTE.md` si elle est jointe. Ne lance aucune refonte supplémentaire : corrige seulement les écarts observés.

Vérifie et corrige :

1. tous les tests automatisés ;
2. invariance du moteur ATP et de ses cas étalons ;
3. invariance exacte du dataset gaz courant ;
4. paramètres URL, comparaison, partage, stockage et reset ;
5. thème `Système/Nuit/Jour`, absence de flash et recoloration Canvas/3D ;
6. loader initial/compact, requêtes concurrentes, erreur et reduced motion ;
7. 2D et 3D sur 360, 390, 768, 1024 et 1440 px ;
8. clavier, focus, lecteur d’écran raisonnable, contrastes, hit targets et zoom 200 % ;
9. PWA installable et hors ligne, assets exacts, cache incrémenté, aucune requête CDN ;
10. title, description, H1, canonique, JSON-LD, sitemap et liens internes ;
11. aucun contenu opérateur ou chiffre inventé ;
12. aucun changement involontaire de `physics-core.js`, du Worker ou des données.

Produis des captures nuit/jour desktop/mobile et un rapport final avec fichiers modifiés, tests exécutés, résultats, poids initial/3D, différences connues et éventuels contenus manquants. Ne masque aucun échec. Ne déclare terminé que lorsque tout est vert. Ne fais pas de commit.

