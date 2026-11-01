# Feature : Assistant de rédaction de tickets (Copilot)

## User stories
- Je décris mon besoin en quelques phrases ; Copilot me propose un titre, une description Markdown structurée et des sous-tickets.
- Je relis, j'ajuste, puis je valide : rien n'est enregistré avant ma validation.
- Je peux aussi affiner un ticket existant (« découpe-le », « précise les critères d'acceptation »).

## Règles
- Utilise la Copilot CLI comme l'exécution (voir [ticket-run.md](./ticket-run.md)), mais **sans autoriser d'outil** (pas de `--allow-all-tools` : en mode non interactif les outils sont refusés), depuis le dossier temporaire du système et avec `-s` (réponse seule) ; il ne fait que rédiger. Délai maximum 120 s (504 au-delà).
- Le contexte envoyé : nom du périmètre, application filtrée éventuelle, et pour un ticket existant son titre, sa description et ses sous-tickets.
- Copilot doit répondre en JSON : `{ title, description, priority?, subtickets: [{ title, description }] }`. Le serveur valide la forme (titres non vides ≤ 200 caractères, priorité connue, au plus 20 sous-tickets) ; réponse inexploitable : 502 avec la sortie brute pour diagnostic.
- Disponible en mode édition uniquement. Mêmes erreurs que l'exécution si la CLI est absente (503).
- Un seul appel d'assistant à la fois par ticket ; il n'est pas bloqué par une exécution en cours.

## Interface
- Bouton **✨ Assister** :
  - dans l'en-tête de chaque colonne (à côté de « + ») pour un nouveau ticket ;
  - dans le détail d'un ticket pour l'affiner.
- Panneau : zone de saisie « Décris ce que tu veux », bouton **Proposer**, indicateur d'attente.
- Proposition éditable : titre, description (textarea Markdown avec aperçu), priorité, liste de sous-tickets (suppression, renommage). Boutons **Enregistrer** et **Annuler**.
- Nouveau ticket : Enregistrer crée le ticket (dans la colonne d'où le panneau a été ouvert, lié à l'application filtrée) puis ses sous-tickets. Ticket existant : titre et description sont remplacés (la valeur actuelle est montrée à côté) et les sous-tickets proposés sont **ajoutés** aux existants (jamais supprimés).

## API
```
POST /api/tickets/assist   { perimeter_id, request, ticket_id? }  → 200 { title, description, priority, subtickets }
```
Ne modifie rien : l'enregistrement passe par les routes de [ticket-crud.md](./ticket-crud.md) et [sub-tickets.md](./sub-tickets.md).
400 : demande vide (> 4000 caractères) ou périmètre/ticket inconnu ; 502 : réponse de Copilot inexploitable ; 503 : CLI absente ; 504 : délai dépassé.

## Critères d'acceptation
- [ ] Une demande produit une proposition éditable sans rien enregistrer.
- [ ] Annuler ne crée ni ne modifie aucun ticket.
- [ ] Valider crée le ticket et tous les sous-tickets retenus, rattachés à lui.
- [ ] Sur un ticket existant, les sous-tickets existants sont conservés.
- [ ] Une réponse non JSON affiche une erreur lisible, sans effet de bord.
- [ ] Sans Copilot CLI ou en lecture seule, le comportement est celui décrit ci-dessus (message / bouton absent).
