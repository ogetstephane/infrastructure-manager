# Feature : Vue « IA factory » (tableau de tickets)

## User stories
- En tant qu'admin, j'ouvre la vue **Tickets** et je choisis un périmètre pour voir son tableau.
- Je peux restreindre le tableau à une application du périmètre (voir [ticket-filter.md](./ticket-filter.md)).
- Les vues Dev et Métier ne sont pas alourdies par les tickets.

## Emplacement
Nouvelle vue `views/IAFactory.jsx`, entrée **🏭 IA factory** dans la navigation (`VIEWS` de `App.jsx`, `depth: 2` : périmètre → application). Le tableau est un composant autonome `components/ia-factory/FactoryBoard.jsx`.
La section « Tickets » de la carte périmètre (vue Dev) est **supprimée** : le tableau n'apparaît que dans cette vue.

## Sélection du périmètre et de l'application
Réutilise le fil d'Ariane commun (`Breadcrumb`, `scope.jsx`) : `#ia-factory?p=<périmètre>&a=<application>`. Le choix est partagé avec les autres vues (changer de vue le conserve) et porté par l'URL.
- **Le périmètre est obligatoire** : dans cette vue, le fil d'Ariane n'offre pas « Tous les périmètres » (on ne peut pas revenir à « Tout »). Le premier niveau est une liste de périmètres sans option vide.
- **Aucun périmètre choisi** (arrivée sur la vue, ou périmètre inconnu) : aucun tableau, seulement le message « Sélectionne un périmètre pour afficher ses tickets » et un sélecteur de périmètre ; rien n'est présélectionné automatiquement.
- **Périmètre choisi** : tableau de ses tickets.
- **Application choisie en plus** (facultatif) : tableau filtré, voir [ticket-filter.md](./ticket-filter.md).

## Affichage
- 5 colonnes dans l'ordre : Backlog, À faire, En cours, En revue, Terminé, avec le nombre de tickets dans l'en-tête.
- Une carte de ticket affiche : titre, badge de priorité, nombre de liens (🔗 n) ; la description n'apparaît pas sur la carte.
- Tri dans une colonne par `position` croissante.
- Colonne « Terminé » : les 5 derniers tickets, lien « Tout afficher ».
- Colonne vide : « Aucun ticket ».
- Le tableau n'est plus repliable : la vue lui est dédiée.
- Mode lecture / édition (`ModeToggle`, `EditModeProvider`) sur la carte du tableau, **lecture par défaut** : en lecture, ni « + », ni glisser-déposer, ni suppression ; en édition, tout est actif.
- Mobile : les colonnes défilent horizontalement.

## Priorités (couleurs)
`low` gris, `normal` bleu, `high` orange, `critical` rouge.

## Critères d'acceptation
- [ ] La navigation contient une entrée « IA factory » ; la section Tickets a disparu de la carte périmètre (vue Dev).
- [ ] Sans périmètre choisi, aucun tableau n'est affiché, seulement l'invite à sélectionner un périmètre.
- [ ] Le fil d'Ariane de cette vue ne propose pas « Tous les périmètres ».
- [ ] Choisir un périmètre dans le fil d'Ariane affiche son tableau, et jamais les tickets d'un autre.
- [ ] Le périmètre et l'application choisis sont conservés en changeant de vue et au rechargement (URL).
- [ ] Les compteurs des colonnes correspondent aux tickets affichés.
- [ ] En lecture, le tableau est consultable mais non modifiable.
