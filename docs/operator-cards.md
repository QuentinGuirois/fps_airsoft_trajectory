# Cartes opérateur F.A.T.

La page `/tu-joues-avec-quoi/` ne doit être publiée que lorsqu’au moins un profil respecte `data/operator-profile.schema.json` et dispose d’une preuve d’autorisation conservée hors du site public.

## Conditions de publication

- identité d’affichage, photographie et citation explicitement autorisées ;
- setup vérifié par l’équipe éditoriale ;
- distinction visible entre `CHRONY` et `DÉCLARÉ` ;
- date de mesure pour une valeur chrony lorsqu’elle est disponible ;
- paramètres du simulateur construits uniquement à partir des valeurs autorisées ;
- aucun abonné, lien social, chiffre ou citation ajouté sans preuve.

## Composant

Le composant CSS `.operator-card` est disponible dans `assets/site.css`. Sa structure attendue est :

```html
<article class="operator-card">
  <header class="operator-card-header">
    <span class="stencil-patch">OPÉRATEUR / …</span>
    <span class="trust-tag" data-trust="measured">CHRONY</span>
  </header>
  <img class="operator-card-photo" alt="…">
  <div class="operator-card-body">
    <h2>…</h2>
    <dl class="operator-stats">…</dl>
    <blockquote>…</blockquote>
    <a class="button button-primary" href="/#calculateur">Voir sa trajectoire</a>
  </div>
</article>
```

Cette documentation ne constitue pas un profil et ne doit pas déclencher la création de la page ni son ajout au sitemap.
