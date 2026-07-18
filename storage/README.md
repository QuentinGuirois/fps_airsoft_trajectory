# Stockage local F.A.T.

Ce dossier matérialise seulement la convention locale. Son contenu est ignoré
par Git. En production, `STORAGE_ROOT` pointe vers un répertoire privé situé
hors de `httpdocs`, avec des sous-dossiers `queue`, `images`, `events`, `logs`,
`models` et `locks` appartenant à l’utilisateur système du domaine.

Aucun original, masque ou fichier rejeté ne doit y persister après traitement.
