# Feature : Déplacer un incident

## User stories
- Je glisse un incident d'une colonne à l'autre, ou je le réordonne dans sa colonne.

## Règles
- Glisser-déposer en mode édition uniquement ; `POST /api/incidents/:id/move` `{ status, index }`.
- `index` ≤ nombre d'incidents de la colonne cible (400 sinon) ; les colonnes touchées sont renumérotées 0..n-1 ; statut inconnu : 400 ; incident inconnu : 404.
- Avec un filtre actif, la position envoyée se compte dans la colonne complète (incidents masqués compris).
- Entrer dans « Résolu » pose `resolved_at` ; en sortir l'efface.
- Mise à jour optimiste à l'écran, puis relecture.

## Critères d'acceptation
- [x] Déplacer vers une autre colonne change le statut et renumérote les deux colonnes.
- [x] Réordonner dans la colonne fonctionne.
- [x] Index hors bornes : 400.
