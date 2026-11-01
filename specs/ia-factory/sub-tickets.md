# Feature : Sous-tickets

## User stories
- Je découpe un ticket en sous-tickets pour suivre son avancement.
- Je vois d'un coup d'œil, sur la carte du ticket, combien de sous-tickets sont terminés.
- Un sous-ticket a son propre statut, sa priorité, sa description et ses liens, comme un ticket.

## Règles
- **Un seul niveau** : un sous-ticket ne peut pas avoir de sous-tickets.
- Le parent est un ticket **du même périmètre**.
- Un ticket qui a des sous-tickets ne peut pas devenir sous-ticket.
- Supprimer un sous-ticket n'affecte pas le parent ; supprimer définitivement un parent est **bloqué (409)** tant qu'il a des sous-tickets (la suppression d'un périmètre les supprime toujours en cascade).
- Le statut du parent n'est pas modifié à la main par les sous-tickets, mais suit l'avancement de leur **exécution** : « En cours » pendant la séquence ; « En revue » seulement si tous les sous-tickets sont « En revue » ou « Terminé » (sinon il reste « En cours », y compris après réparation d'un état incohérent).
- **Échec d'un sous-ticket : arrêt** (choix retenu, pas de poursuite). Les sous-tickets suivants ne sont pas lancés, le sous-ticket en échec reste « En cours », l'exécution du parent est `failed` (message « Sous-tickets : … ») et le parent reste « En cours ». Relancer le parent ignore les sous-tickets `done` et reprend la séquence. Détail : [ticket-run.md](./ticket-run.md).

## Affichage
- Le tableau ne montre que les tickets de premier niveau. Un sous-ticket n'a pas de colonne et ne se déplace pas par glisser-déposer.
- Carte d'un parent : mention `☑ n/m` (sous-tickets terminés / total) s'il en a.
- Détail d'un ticket de premier niveau : section « Sous-tickets » listant titre (clic = ouvre son détail), statut et priorité ; en mode édition, le statut est modifiable en ligne et un champ « Nouveau sous-ticket » (Entrée) en crée un (statut `backlog`, priorité `normal`). La section est masquée en lecture s'il n'y en a pas.
- Détail d'un sous-ticket : lien « ↑ Sous-ticket de … » vers le parent ; pas de section Sous-tickets. Supprimer le sous-ticket revient au détail du parent.
- Filtre par application : un parent est affiché s'il est lié à l'application, ou si l'un de ses sous-tickets l'est.

## API
```
POST /api/tickets   { perimeter_id, title, parent_id?, … }
PUT  /api/tickets/:id   { parent_id }   (rattacher, changer de parent ou détacher avec null)
```
- 400 : parent introuvable ou d'un autre périmètre ; parent lui-même sous-ticket ; ticket ayant des sous-tickets rattaché à un parent ; déplacement (`/move`) d'un sous-ticket.
- Les colonnes (`position`, renumérotation du déplacement) ne comptent que les tickets de premier niveau.

## Critères d'acceptation
- [ ] Créer un sous-ticket depuis le détail d'un ticket l'ajoute à sa liste, sans apparaître sur le tableau.
- [ ] La carte du parent affiche `☑ n/m`.
- [ ] Un sous-ticket de sous-ticket est refusé par l'API (400).
- [ ] Supprimer le parent est refusé tant qu'il a des sous-tickets.
- [ ] Le déplacement d'un sous-ticket est refusé (400).
