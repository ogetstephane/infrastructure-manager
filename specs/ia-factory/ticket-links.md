# Feature : Lier un ticket au catalogue

## User stories
- Je relie un ticket aux applications, serveurs, environnements… concernés.
- Depuis une fiche du catalogue, je vois les tickets qui la concernent.

## Entités liables
`perimeter`, `application`, `environment`, `server`, `component`, `tech_brick`, `external_service`, `flow`, `dependency`. Un ticket peut avoir un nombre quelconque de liens, y compris plusieurs vers le même type.

## Règles
- Un même couple (ticket, type, id) ne peut exister qu'une fois (400 sinon).
- L'entité doit exister (400 sinon). Les entités rattachées à un périmètre (application, environnement, brique du périmètre, composant, flux, dépendance via son application source…) doivent appartenir au **périmètre du ticket**. Les entités transversales (serveur, service externe) sont liables sans restriction.
- Suppression d'une entité : des triggers SQLite retirent ses liens, y compris en cascade (suppression d'une application → liens de ses briques et flux).
- Suppression d'un ticket : ses liens disparaissent (cascade).

## UI
- Dans le détail du ticket, section « Liens » : liste des entités liées (icône, nom, type) avec bouton de retrait (mode édition).
- Ajout : sélecteur de type, puis sélecteur d'entité (filtré sur le périmètre du ticket), bouton « Lier ».
- *À venir* : le nom d'une entité liée devient cliquable et navigue vers l'entité en ajustant le fil d'Ariane (`#vue?p=&a=&e=`).
- Sur les fiches application et serveur, un bloc « Tickets » liste les tickets liés non terminés (titre, statut, priorité) ; il n'apparaît que s'il y en a. Un clic sur le titre ouvre le ticket dans la vue IA factory (`#ia-factory?p=<périmètre>&t=<ticket>`), détail affiché. *À venir* : fiche environnement.

## API
```
POST   /api/ticket_links        { ticket_id, entity_type, entity_id } → 201
DELETE /api/ticket_links/:id    → 200 { ok: true }
GET    /api/ticket_links?ticket_id=  |  ?entity_type=&entity_id=
```

## Critères d'acceptation
- [ ] On peut lier un ticket à plusieurs entités de types différents.
- [ ] Lier deux fois la même entité est refusé.
- [ ] Lier une application d'un autre périmètre est refusé.
- [ ] Supprimer une entité liée retire le lien et le ticket reste intact.
- [ ] Le bloc « Tickets » d'une fiche n'affiche pas les tickets terminés.
