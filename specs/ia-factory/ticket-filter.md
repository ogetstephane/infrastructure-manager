# Feature : Filtrer le tableau par application

## User stories
- Dans un périmètre, je ne veux voir que les tickets qui concernent une application.
- Quand je crée un ticket en ayant choisi une application, je ne veux pas avoir à le lier à la main.

## Règle de filtre
Avec une application `a` choisie dans le fil d'Ariane (périmètre `p`), le tableau n'affiche que les tickets de `p` ayant **un lien direct** vers cette application (`ticket_links.entity_type='application'` et `entity_id=a`).
Les tickets liés seulement à une brique, un flux ou une dépendance de l'application ne sont **pas** inclus (périmètre volontairement simple ; extensible plus tard).
Sans application choisie : tous les tickets du périmètre.

## Création avec application choisie
Un ticket créé alors qu'une application est choisie reçoit automatiquement un lien vers elle (dans la même requête, sans second appel). Le lien reste retirable comme les autres ; le ticket disparaît alors de la vue filtrée (le tableau se met à jour).

## Comportement
- Bandeau sous le fil d'Ariane quand le filtre est actif : « Filtré sur 📦 <application> — n tickets sur m » avec bouton « Tout le périmètre » (efface l'application du fil d'Ariane).
- Les compteurs des colonnes reflètent les tickets filtrés.
- Glisser-déposer : l'`index` envoyé à l'API doit rester cohérent avec l'ordre complet de la colonne ; le front calcule la position d'insertion par rapport à la liste filtrée et la convertit en position dans la colonne non filtrée (le ticket est inséré juste avant le ticket suivant visible, ou en fin de colonne).
- Changer d'application ou de périmètre ferme le détail ouvert.

## API
```
GET  /api/tickets?perimeter_id=&application_id=     filtre par lien direct vers l'application
POST /api/tickets   { perimeter_id, title, …, link_application_id? }
```
`link_application_id` : si fourni, l'application doit appartenir au périmètre (400 sinon) ; le ticket et son lien sont créés dans une même transaction.

## Critères d'acceptation
- [ ] Choisir une application n'affiche que les tickets liés directement à elle.
- [ ] Le bandeau indique le filtre et « Tout le périmètre » le supprime.
- [ ] Créer un ticket avec une application choisie crée aussi le lien.
- [ ] Un ticket lié à deux applications apparaît dans les deux filtres.
- [ ] Réordonner dans une vue filtrée ne désordonne pas les tickets masqués de la colonne.
- [ ] `application_id` d'un autre périmètre que `perimeter_id` renvoie une liste vide (ou 400).
