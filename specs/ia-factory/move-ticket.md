# Feature : Déplacer un ticket

## User stories
- Je fais glisser un ticket vers une autre colonne pour changer son statut.
- Je réordonne les tickets dans une colonne pour exprimer leur priorité relative.

## Comportement
- Glisser-déposer natif HTML5 (sans dépendance), uniquement en mode édition.
- Déposer sur une colonne : le ticket prend le statut de la colonne. Déposer entre deux cartes : il prend cette place ; déposer sur l'espace vide de la colonne : il va en bas.
- Indicateur visuel de la cible (colonne surlignée, ligne d'insertion).
- Mise à jour optimiste de l'affichage ; en cas d'erreur API, retour à l'état précédent et message d'erreur.
- Alternative sans souris (accessibilité, mobile) : sélecteur de statut dans le détail du ticket (voir [ticket-crud.md](./ticket-crud.md)).
- Un ticket ne peut pas être déplacé vers un autre périmètre.

## Ordre
`position` est un entier unique par (périmètre, statut). Au dépôt, le serveur renumérote la colonne source et la colonne cible de façon contiguë (0..n-1) dans une transaction.

## API
```
POST /api/tickets/:id/move   { status, index }
```
`index` : position d'insertion 0..n dans la colonne cible (n = fin). Réponse : les tickets du périmètre mis à jour. Erreurs : 400 si statut inconnu ou `index` hors bornes, 404 si ticket inconnu.

## Critères d'acceptation
- [ ] Glisser un ticket dans une autre colonne change son statut et persiste après rechargement.
- [ ] Réordonner dans la même colonne conserve le nouvel ordre après rechargement.
- [ ] Les positions restent contiguës dans les deux colonnes concernées.
- [ ] En lecture, les cartes ne sont pas déplaçables.
- [ ] Une erreur serveur restaure l'affichage initial.
