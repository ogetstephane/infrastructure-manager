# Feature : Créer, éditer et supprimer un incident

## User stories
- Je déclare un incident dans une colonne, avec un titre et une sévérité.
- J'enrichis sa description en Markdown, je change sa sévérité, son statut ou son application.
- Je supprime un incident.

## Règles
- Création : bouton « ＋ » de la colonne (mode édition) ; titre obligatoire, sévérité par défaut « Mineur ». Avec le filtre application actif, l'incident y est rattaché.
- L'application doit appartenir au périmètre de l'incident (400 sinon). Elle se change dans le détail ; « — Aucune — » la retire.
- Description : Markdown rendu en lecture, textarea brut en édition.
- Changer le statut dans le détail place l'incident en bas de la colonne cible et met à jour `resolved_at`.
- Suppression : bouton ✕ du détail (mode édition), avec confirmation.

## Critères d'acceptation
- [x] Créer un incident avec titre vide est refusé.
- [x] Sévérité inconnue : 400.
- [x] Application d'un autre périmètre : 400.
- [x] Passer en « Résolu » renseigne `resolved_at`, en sortir l'efface.
- [x] Supprimer une application garde ses incidents, sans application.
