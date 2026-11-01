# Feature : Créer, éditer et supprimer un ticket

## User stories
- Je crée rapidement un ticket dans une colonne.
- Je modifie son titre, sa description, sa priorité et son statut.
- Je supprime un ticket devenu inutile.

## Champs
| Champ | Règle |
|---|---|
| `title` | Obligatoire, 1 à 200 caractères, espaces de bord supprimés. |
| `description` | Optionnelle, Markdown : éditée en brut en mode édition, rendue en lecture (HTML brut ignoré). |
| `priority` | `low` / `normal` / `high` / `critical`, défaut `normal`. |
| `status` | Un des 5 statuts, défaut = colonne où le ticket est créé (`backlog` sinon). |

## Création
- Bouton « + » dans l'en-tête de chaque colonne (mode édition uniquement) ouvrant un formulaire en ligne : titre + priorité. Si une application est choisie dans le fil d'Ariane, le ticket est automatiquement lié à elle (voir [ticket-filter.md](./ticket-filter.md)).
- Le ticket est ajouté **en bas** de la colonne (`position` = max + 1).
- Entrée valide, Échap annule. Titre vide : refusé, message d'erreur sous le champ.

## Édition
- Clic sur une carte : ouvre le détail (panneau sous la carte ou modale) avec tous les champs éditables ; la sauvegarde se fait à la perte de focus (`EditCell`), avec le retour visuel vert/rouge existant.
- Changer le statut dans le détail déplace le ticket en bas de la colonne cible.

## Suppression définitive
- Bouton « 🗑 Supprimer définitivement » dans le détail (mode édition), visible uniquement pour les profils habilités (`can_delete` de `GET /api/factory/settings`). Une modale rappelle que l'action est irréversible et exige la saisie de l'identifiant ou du titre du ticket ; après succès, retour à la liste (ou au parent pour un sous-ticket).
- **Droits** : en-tête `X-Operator` ; si `FACTORY_ADMINS` (noms séparés par des virgules) est défini, seuls ces noms peuvent supprimer (403 sinon). Sans `FACTORY_ADMINS`, les règles d'opérateur habituelles (`FACTORY_OPERATORS`) s'appliquent. À définir en production.
- **Données supprimées** (transaction unique) : ticket, liens vers le catalogue, exécutions, questions de l'IA, historique (`ticket_audit`). Une exécution en cours est arrêtée, puis worktree et branche git sont purgés. Il n'existe ni commentaire, ni pièce jointe, ni index de recherche, ni notification persistée dans l'application.
- **Tickets liés** : un ticket ayant des sous-tickets ne peut pas être supprimé (409, message explicite) : supprimer d'abord les sous-tickets. Il n'y a pas d'autres dépendances entre tickets ; les liens vers le catalogue partent avec le ticket, sans référence orpheline.
- **Audit** : table `ticket_deletions` (`ticket_id`, `actor`, `deleted_at`), sans contenu ni clé étrangère, consultable via `GET /api/ticket_deletions`. Pas de restauration ni de suppression en masse. Les tickets supprimés ne comptent plus dans les indicateurs. Sauvegardes de la base : conserver selon la politique de rétention/RGPD de l'entreprise (la suppression n'agit pas sur les sauvegardes existantes).

## API
```
POST   /api/tickets            { perimeter_id, title, description?, priority?, status? } → 201
PUT    /api/tickets/:id        champs modifiables : title, description, priority, status
DELETE /api/tickets/:id        → 200 { ok: true }
```
Erreurs : 400 si titre vide (ou trop long), priorité ou statut inconnu, périmètre inexistant ; 404 si le ticket n'existe pas. Le `perimeter_id` n'est pas modifiable. `DELETE` : 403 si l'opérateur n'est pas habilité, 404 si inexistant (y compris après suppression), 409 si le ticket a des sous-tickets.

## Critères d'acceptation
- [ ] Créer un ticket sans titre est impossible.
- [ ] Un ticket créé apparaît en bas de la colonne choisie.
- [ ] Une valeur de priorité ou de statut invalide est rejetée par l'API.
- [ ] Supprimer un ticket supprime ses liens ; supprimer un périmètre supprime ses tickets.
- [ ] Un utilisateur non habilité ne voit pas l'action de suppression et reçoit 403 ; un ticket supprimé renvoie 404 ; une entrée d'audit est enregistrée ; un ticket avec sous-tickets renvoie 409 (tests : `server/ticket-delete.test.js`).
- [ ] En mode lecture, aucun contrôle de création, d'édition ou de suppression n'est visible.
