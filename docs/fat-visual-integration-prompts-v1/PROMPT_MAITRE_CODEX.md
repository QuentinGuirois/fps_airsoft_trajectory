# Prompt maître à donner à Codex

Tu travailles dans le dépôt courant de F.A.T. V3, une PWA statique de balistique airsoft. Intègre entièrement l’identité visuelle jointe avec une palette sombre unique, son logo, son loader et ses maquettes de pages, sans régression fonctionnelle, physique, PWA, SEO ou données.

Le pack de design joint s’appelle `Identité visuelle airsoft balistique.zip`. Commence par le décompresser dans un dossier temporaire hors du code publié, puis lis intégralement :

1. `charte-fat-codex.md` — référence normative ;
2. `Identité F.A.T.dc.html` — référence visuelle, surtout les vues `3a`, `2a` à `2f`, `1a`, `1e`, `1f`, `1h` et `1i` ;
3. le `AGENTS.md`, le `README.md`, `docs/moteur-atp.md` et `docs/strategie-seo.md` du dépôt courant.

La copie `uploads/fps-airsoft-trajectory-v3/` présente dans le pack est une photographie ancienne utile pour comprendre les maquettes. Ne la copie jamais par-dessus le dépôt courant. Le dépôt courant est la seule source de vérité pour le code, le moteur, les pages et les données. N’intègre jamais `.thumbnail`, `support.js`, les liens Google Fonts ou les styles inline de démonstration en production.

## Règles de travail impératives

- Inspecte `git status` et préserve toutes les modifications utilisateur existantes.
- Lance la suite de tests avant toute modification et note le résultat de référence.
- Relève avant modification : nombre de pages indexables, nombre de marques et produits gaz, étendue des températures, fichiers PWA mis en cache et paramètres d’URL acceptés.
- Si le dépôt contient le pack gaz V2 ou plus de 32 produits, conserve exactement cette version. La maquette à 32 produits est illustrative et obsolète.
- `physics-core.js` reste l’unique source physique. Ne modifie aucune équation, constante, unité, convention d’axe, intégrateur ou coefficient pour réaliser l’identité visuelle.
- La 2D et la 3D consomment le même résultat calculé par le Worker. Aucun calcul physique parallèle dans le rendu.
- Pas de framework ajouté. Pas de CDN. Toute dépendance nécessaire à la 3D et toutes les polices sont auto-hébergées avec leurs licences.
- Ne change pas les titles, H1, canoniques, données structurées ou textes SEO sauf nécessité explicite de balisage. Ne fabrique aucun fait, profil de joueur, mesure chrony, citation, produit ou lien social.
- Après modification d’une ressource mise en cache, incrémente `CACHE` dans `service-worker.js`.
- Ne fais pas de commit sauf si je te le demande.

## 1. Fondations graphiques

Remplace l’ancienne palette bleu-noir par les tokens exacts de `charte-fat-codex.md`. Centralise-les au début de `assets/site.css`. Implémente les rôles typographiques :

- Saira 800–900 pour titres et grandes métriques ;
- Inter pour le corps ;
- IBM Plex Mono pour données, unités et labels UI ;
- Saira Stencil One uniquement pour patches, eyebrows et numéros.

Auto-héberge les WOFF2 issus de sources officielles, ajoute les licences OFL dans le dépôt et mets les fichiers utiles en cache PWA. N’utilise aucune requête externe. Limite les variantes aux graisses réellement employées et conserve `font-display: swap`.

Crée les composants CSS réutilisables de la charte : chip mono, tags de confiance, carte champ, métrique héros, patch stencil, bande camo CSS, hachures de limite, bloc d’attribution Mackila, carte opérateur et squelette d’outil. Remplace les couleurs codées en dur dans les composants par des variables sémantiques.

Respecte le principe « l’olive habille, l’acide mesure » : pas de grande surface acide, pas de texte acide pur sur fond clair, pas de bitmap camo, pas d’emoji et pas de stencil en paragraphe.

## 2. Thème sombre unique

Le site utilise exclusivement le thème sombre :

- application avant le premier paint avec le script du `<head>` ;
- `color-scheme: dark` et `meta[name="theme-color"]` cohérents ;
- aucun sélecteur, libellé ou préférence locale de thème ;
- Canvas 2D, scène 3D, graphiques et widgets tiers rendus avec la palette sombre ;
- suppression des règles et variantes de palette alternatives.

## 3. Logo et actifs

Redessine l’option `1a` : bille + courbe ATP + sol pointillé. Le SVG source doit être propre, sans dépendre d’une police ni de variables CSS indisponibles lorsqu’il est chargé comme image.

Produis et référence :

- le logo SVG principal ;
- le lockup du header avec icône 28–30 px, `F.A.T.` et sous-titre mono ;
- un favicon SVG ;
- des PNG PWA 192×192 et 512×512 ;
- une vraie variante maskable avec zone de sécurité ;
- une image Open Graph cohérente, distincte des icônes PWA.

Mets à jour le manifeste, les raccourcis, les pages et le cache. Vérifie les dimensions réelles des PNG et le rendu du masque.

## 4. Loader de la vue `3a`

Réimplémente le loader en HTML/CSS/JS vanilla. Reprends fidèlement : courbe dessinée, bille qui la parcourt, sol pointillé, lockup F.A.T., barre fine, pourcentage et rotation des phrases geek de la maquette.

Comportement attendu :

- plein écran uniquement pour l’initialisation significative du Worker/premier calcul ;
- overlay compact sur le cockpit pour un recalcul qui dépasse 300 ms ;
- délai d’apparition de 300 ms pour éviter le flash sur les calculs rapides ;
- progression liée au cycle réel de requête, jamais 100 % avant la réponse active ;
- plafond à 99 % pendant l’attente ;
- seul le `requestId` courant peut fermer ou mettre à jour le loader ;
- une erreur affiche un état lisible et libère l’interface ;
- aucune temporisation artificielle pour prolonger le spectacle ;
- `aria-busy`, statut accessible non bavard et gestion correcte du focus ;
- avec `prefers-reduced-motion`, bille fixe à l’apex, pas de clignotement, pas de mouvement de courbe, phrases stables ;
- fallback visuel correct si CSS Motion Path n’est pas disponible.

Les phrases peuvent reprendre celles de la maquette, dont « Réveil du Web Worker… », « Calibrage de l’effet Magnus… » et « Intégration RK4 en cours, pas de panique… ».

## 5. Pages et conversion

Applique les maquettes sans remplacer le contenu utile :

- accueil `2a` : hero, console 1,50 J, strip camo de réassurance, cockpit, cartes guides et footer ;
- mobile `2b` : scène compacte, quatre métriques, presets scrollables, champs tactiles ≥44 px et CTA clair ;
- guides `2d` : lecture 65–70 caractères, rail sommaire/CTA sticky, callouts et tags de confiance ;
- outil gaz `2e` : sélecteurs à gauche, résultat et courbe à droite, comparaison et provenance visibles ;
- À propos `2f` : vraie photo disponible, patch Keep et bloc d’attribution Mackila réutilisable ;
- header et footer cohérents sur toutes les pages, sans lien perdu.

Pour `/tu-joues-avec-quoi/`, ne publie aucun faux opérateur. Si le dépôt contient au moins un profil vérifié et ses autorisations, crée la page et relie les CTA au simulateur via les paramètres existants. Sinon, implémente le composant et un schéma de données documenté, mais ne mets pas une page vide ou fictive dans le sitemap ; signale ce contenu comme dépendance éditoriale.

Les tags de confiance sont obligatoires pour les résultats calculés, valeurs de données externes, valeurs de profils et affirmations chiffrées mises en avant. Ne surcharge pas chaque champ de saisie ou graduation d’un badge. Un tag doit avoir un libellé textuel, pas seulement une couleur.

## 6. Cockpit et graphe 2D

Conserve tous les paramètres, résultats, comparaisons, tables, partages et onglets existants. Réorganise le calculateur en cockpit conforme à `2a`, `1f` et `1i`.

Pour le mode trajectoire 2D :

- format panoramique proche de 4,5:1 sur desktop et 3:1 sur mobile ;
- exagération verticale ×10 uniquement si elle est réellement appliquée, avec chip toujours visible ;
- enveloppe ATP ±15,24 cm autour de la ligne de visée, faible opacité ;
- ligne de visée pointillée, grille et sol distincts ;
- marqueurs départ, portée utile, apex si utile et impact ;
- active 3,5 px acide ; comparaisons 2 px, couleurs `curve-2..4`, pointillées ;
- légende lisible sans dépendre de la couleur ;
- couleurs résolues depuis les propriétés CSS au moment de dessiner, puis redessin au changement de thème ;
- texte alternatif/caption et table numérique conservés pour l’accessibilité.

N’ajoute pas l’enveloppe ATP aux vues énergie, dérive ou rotation. Sur desktop, rends la scène sticky sans masquer le header. Sur mobile, garde la 2D et quatre métriques visibles sans bloquer le clavier virtuel ni rendre les réglages inaccessibles. Teste les safe areas et les hauteurs dynamiques.

## 7. Vue drone 3D

Ajoute le mode `VUE DRONE 3D` comme amélioration progressive, dans un module séparé chargé uniquement lors de la première activation.

- Auto-héberge une version figée et minimale de Three.js et les contrôles nécessaires, avec licence ; aucun CDN.
- Utilise exactement les points et métriques du dernier résultat du Worker.
- Sol quadrillé, ruban trajectoire, ligne de tir, projection pointillée de la dérive au sol, bille et marqueurs `DÉPART / APEX / IMPACT`.
- Caméras `DRONE / TIREUR / PROFIL`, où `PROFIL` correspond au cadrage 2D.
- Bouton `REJOUER LE TIR` ; aucune lecture automatique avec réduction de mouvement.
- Détruis proprement boucle d’animation, géométries, matériaux, listeners et contexte à la fermeture si nécessaire.
- Si WebGL est absent ou l’import échoue, masque le toggle 3D et garde la 2D pleinement fonctionnelle, sans erreur visible ni rejet de promesse.
- Sur mobile, ouvre la 3D via Fullscreen API. Demande le paysage en best effort après l’entrée en plein écran, mais reste utilisable si le navigateur refuse le verrouillage. Ajoute orbite tactile, bouton de sortie et recadrage.
- Ajoute les modules locaux au cache PWA et vérifie l’ouverture 3D hors ligne après une première installation.

## 8. PWA, SEO, accessibilité et performance

- Préserve les URL partageables `m`, `j`, `h`, `rpm`, `z`, `w`, `wd`, `t`, `p`, `a`, `c`.
- Préserve les paramètres et le stockage de l’outil gaz.
- Préserve tous les titles, H1 uniques, descriptions, canoniques, données structurées et URLs du sitemap.
- Mets à jour uniquement les couleurs et actifs nécessaires dans le manifeste et les metas.
- Aucun chargement externe de script, style, police, modèle ou texture.
- Navigation complète au clavier, focus visible, contrastes AA, noms accessibles, hit targets mobiles, `prefers-reduced-motion` et fallback Canvas/3D.
- Évite les sauts de mise en page : dimensions réservées pour polices, logo, graphe, loader et images.
- La 3D ne doit pas alourdir le chargement initial ; vérifie qu’aucun module 3D n’est téléchargé avant activation.

## 9. Tests obligatoires

Conserve tous les tests existants et ajoute des tests ciblés pour :

- résolution `system/dark/light`, persistance et réaction au changement système ;
- absence d’appel CDN dans HTML/CSS/JS et présence des polices/licences locales ;
- progression du loader, plafond à 99, fin par `requestId` et erreur ;
- redessin du Canvas au changement de thème ;
- conservation du nombre de produits, marques, températures et points gaz ;
- conservation des paramètres URL ;
- présence et dimensions des actifs PWA ;
- masquage/fallback de la 3D sans WebGL ;
- cohérence du header, du logo et du sélecteur de thème sur toutes les pages ;
- ressources du service worker et incrément du cache.

Exécute au minimum `npm test`. Sers le site en HTTP et vérifie manuellement :

- largeurs 360, 390, 768, 1024 et 1440 px ;
- thème nuit, jour et système ;
- réduction de mouvement ;
- clavier seul ;
- premier calcul, calcul rapide, calcul lent simulé, erreur Worker et fallback sans Worker ;
- comparaison, partage URL et restauration ;
- mode sans WebGL ;
- 3D desktop et plein écran mobile ;
- installation PWA, rechargement hors ligne et mise à jour du cache ;
- absence de 404 et de régression des données structurées.

## Livrable attendu

Implémente réellement les changements, puis rends un compte rendu concis contenant :

1. résultat fonctionnel ;
2. fichiers modifiés et actifs ajoutés ;
3. tests automatisés et manuels exécutés avec résultats ;
4. preuve que le moteur ATP et les données gaz n’ont pas changé ;
5. poids initial avant/après et poids du chunk 3D différé ;
6. captures sombres desktop/mobile ;
7. limites restantes ou contenus réels encore nécessaires, sans masquer les échecs.

Ne déclare pas le travail terminé si une étape de recette échoue.
