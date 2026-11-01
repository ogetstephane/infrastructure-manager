# Feature : Tableau kanban des incidents

## User stories
- Je sélectionne un périmètre et je vois ses incidents en trois colonnes : Nouveau, En cours, Résolu.
- Je filtre sur une application pour ne voir que ses incidents.

## Règles
- Vue `#incident-desk` : un périmètre est obligatoire (sinon message « Sélectionne un périmètre… »).
- Le filtre est le niveau application du fil d'Ariane (`?p=&a=`) ; il retient les incidents dont `application_id` est l'application choisie. Les incidents sans application n'apparaissent que sans filtre.
- Bandeau « Filtré sur <application> — n incidents sur m » avec bouton « Tout le périmètre ».
- Carte : titre, sévérité, application (sans filtre). La couleur du bord suit la sévérité.
- Colonne « Résolu » : 5 derniers affichés, « Tout afficher » pour le reste.
- Mode lecture / édition (`ModeToggle`), **lecture par défaut** : en lecture, ni « + », ni glisser-déposer, ni suppression.
- Clic sur une carte : détail sous le tableau (titre, description Markdown, sévérité, statut, application, dates).

## Critères d'acceptation
- [x] Sans périmètre, la vue demande d'en choisir un.
- [x] Trois colonnes avec compteurs.
- [x] Filtre par application et retour à « Tout le périmètre ».
- [x] Résolu limité à 5 cartes avec « Tout afficher ».
