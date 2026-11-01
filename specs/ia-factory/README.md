# Contexte : IA factory

## Objectif
Suivre le travail à faire sur un périmètre sous forme de tickets organisés en colonnes. L'utilisateur (admin SI, seul utilisateur) y note ce qui doit être fait et le relie aux éléments concernés du catalogue.

## Périmètre
- Une vue dédiée **IA factory** (id `ia-factory`, 🏭) : un tableau par **périmètre** (sélection obligatoire), filtrable par application, via le fil d'Ariane.
- Dans le périmètre : tickets, colonnes fixes, glisser-déposer, liens vers entités du catalogue.
- Hors périmètre : assignation, échéances, étiquettes, types de ticket, commentaires, historique, notifications, colonnes personnalisables, multi-utilisateurs.

## Glossaire
| Terme | Définition |
|---|---|
| Ticket | Unité de travail d'un périmètre : titre, description, priorité, statut. |
| Statut | Colonne du tableau : `backlog`, `todo`, `doing`, `review`, `done`. |
| Priorité | `low`, `normal` (défaut), `high`, `critical`. |
| Sous-ticket | Ticket rattaché à un ticket parent (un seul niveau), de même périmètre ; voir [sub-tickets.md](./sub-tickets.md). |
| Lien | Association d'un ticket à une entité du catalogue. |

## Colonnes
| Statut | Libellé |
|---|---|
| `backlog` | Backlog |
| `todo` | À faire |
| `doing` | En cours |
| `review` | En revue |
| `done` | Terminé |

## Modèle de données
```
tickets       id, perimeter_id → perimeters (ON DELETE CASCADE), title NOT NULL,
              description DEFAULT '', priority DEFAULT 'normal',
              status DEFAULT 'backlog', position INTEGER NOT NULL,
              parent_id → tickets (ON DELETE CASCADE, NULL = ticket de premier niveau)
ticket_links  id, ticket_id → tickets (ON DELETE CASCADE),
              entity_type, entity_id, UNIQUE (ticket_id, entity_type, entity_id)
```
`entity_type` : `perimeter`, `application`, `environment`, `server`, `component`, `tech_brick`, `external_service`, `flow`, `dependency`.
Le lien est polymorphe : pas de clé étrangère sur l'entité. Des triggers SQLite (un par table liable, `db.js`) suppriment les liens orphelins, y compris lors des suppressions en cascade (voir [ticket-links.md](./ticket-links.md)).

## API
Ressources REST via le routeur générique (`server/entities/`) ; les statuts et priorités sont validés (400 sinon) :
```
GET/POST        /api/tickets?perimeter_id=&application_id=   (voir ticket-filter.md)
GET/PUT/DELETE  /api/tickets/:id
GET             /api/perimeters/:id/tickets
POST            /api/tickets/:id/move        { status, index }
GET/POST        /api/ticket_links?ticket_id=  |  ?entity_type=&entity_id=
DELETE          /api/ticket_links/:id
```
Les erreurs de validation (champ vide, valeur inconnue, entité introuvable, lien en double ou hors périmètre) renvoient 400 ; 404 pour un ticket inconnu. Les suppressions renvoient `200 { ok: true }`. Le front lit les tickets via `/api/tickets?perimeter_id=` (ils ne font pas partie du bundle).

## Features
| Feature | Fichier |
|---|---|
| Vue IA factory : tableau, sélection du périmètre | [board.md](./board.md) |
| Filtrer par application | [ticket-filter.md](./ticket-filter.md) |
| Créer, éditer, supprimer un ticket | [ticket-crud.md](./ticket-crud.md) |
| Déplacer un ticket | [move-ticket.md](./move-ticket.md) |
| Lier un ticket au catalogue | [ticket-links.md](./ticket-links.md) |
| Sous-tickets | [sub-tickets.md](./sub-tickets.md) |
| Exécuter un ticket avec Copilot | [ticket-run.md](./ticket-run.md) |
| Diff git d'un ticket en revue | [ticket-diff.md](./ticket-diff.md) |
| Assistant de rédaction (Copilot) | [ticket-assist.md](./ticket-assist.md) |
