# Feature : Mode interactif (validation des questions de l'IA)

## Note de conception
- La Copilot CLI est lancée dans un terminal virtuel en mode interactif (`-i`) et son terminal est relayé dans l'interface. Les réponses aux demandes natives de l'IA restent dans la même session. Le mécanisme **suspension / reprise** avec contexte conservé reste disponible pour les questions métier balisées.
- En mode interactif, le prompt demande à l'IA de poser chaque question sur une ligne `[[QUESTION]] …`, de **commiter** son travail puis de s'arrêter. Le serveur extrait les questions (dédoublonnées, 10 max) : l'exécution passe en `waiting`, le ticket reste « En cours », la branche `ticket/<id>` est conservée.
- **Reprise** : nouvelle exécution sur la même branche (worktree recréé), prompt = ticket + questions/décisions de l'opérateur + fin de la sortie précédente. L'exécution `waiting` devient `resumed`.
- **Bascule d'un ticket en cours** autonome → interactif : l'exécution est suspendue (travail commité, branche conservée, statut `suspended`) puis relancée aussitôt en interactif sur la même branche, sans repartir de zéro. Interactif → autonome : refusé tant que des questions sont en attente ; sur une exécution en cours, pris en compte à la prochaine exécution.
- **Absence de réponse** : aucun timeout, aucun repli en autonome ; le ticket reste `waiting` (même après redémarrage du serveur) jusqu'à la reprise manuelle.
- **Plusieurs questions** : chacune est traitée indépendamment (répondre / valider / rejeter) ; la reprise n'est possible que lorsqu'aucune n'est en attente.

## Règles
- Mode d'un ticket : `tickets.interactive` (NULL = hérite du réglage global, 1 interactif, 0 autonome) ; les sous-tickets suivent le parent. Réglage global (`factory_settings.interactive_default`) dans l'assistant (✨), avec option « y compris tickets en cours » ; il s'applique aux nouveaux tickets. Ticket `done` : mode figé (409).
- Droits : pas de comptes dans l'application. L'opérateur est l'en-tête `X-Operator` (champ « Opérateur » de l'interface, défaut `opérateur`). Si `FACTORY_OPERATORS` (liste séparée par des virgules) est défini, seuls ces noms peuvent changer le mode, répondre et reprendre (403 sinon). À placer derrière l'authentification du reverse proxy qui fixe cet en-tête.
- Notification : à l'arrivée de questions, POST JSON `{text, url, ticket_id, questions}` sur `FACTORY_NOTIFY_WEBHOOK` (chat entrant type Teams/Slack/Mattermost, ou passerelle e-mail) ; sans webhook, trace dans les logs. `url` = `FACTORY_PUBLIC_URL` (défaut `http://localhost:5173`) + `/#ia-factory?p=<périmètre>&t=<ticket>`, qui ouvre le détail du ticket. Un échec d'envoi ne bloque pas l'attente.
- Audit (`ticket_audit`) : changements de mode (qui, quand, ancien/nouveau), mode par défaut, questions posées, réponses/décisions, reprises.

## API
```
GET  /api/factory/settings                      → { interactive_default, operators_restricted }
PUT  /api/factory/settings   { interactive_default, apply_to_doing? }
POST /api/tickets/:id/mode   { interactive: true|false|null }   → { changed, restarted } (409 état incompatible, 403 droits)
GET  /api/ticket_questions?ticket_id=&status=
POST /api/ticket_questions/:id/answer { status: answered|validated|rejected, answer? } (409 déjà traitée)
POST /api/tickets/:id/resume                    → 201 { id } (409 questions restantes / pas en attente)
GET  /api/ticket_audit?ticket_id=
```

## Procédure d'exploitation
1. **Basculer** : détail du ticket → « Passer en interactif » (ou réglage global dans ✨ Assistant). Un ticket en cours est suspendu puis relancé ; le tracé apparaît dans « Historique ».
2. **Traiter les questions** : la carte affiche ❓ ; ouvrir le ticket (lien de la notification) → section « Questions de l'IA » : **Répondre** (texte), **Valider** (choix accepté) ou **Rejeter** (avec commentaire optionnel).
3. **Reprendre** : « ▶ Reprendre l'exécution » devient actif quand plus rien n'est en attente. Un ticket sans réponse reste en attente indéfiniment.
4. **Erreurs courantes** : 409 « questions sans réponse » (traiter les restantes) ; 409 « terminé » (ticket `done`) ; 503 Copilot CLI absente ; 403 opérateur non autorisé (vérifier `FACTORY_OPERATORS`) ; ticket resté `waiting` après redémarrage : normal, reprendre manuellement ; pas de notification : vérifier `FACTORY_NOTIFY_WEBHOOK` dans les logs `[interactif]`.

## Interaction native de Copilot
Les exécutions de tickets et les assistants de rédaction utilisent un terminal virtuel Copilot interactif, sans `--no-ask-user`. Lorsqu'une demande ou un choix apparaît, l'opérateur répond directement dans le terminal intégré. **Terminer la session** envoie `/quit` ; **Arrêter** annule l'exécution. Le terminal est aussi disponible pour les assistants de rédaction de tickets et d'incidents.

Le terminal est gardé ouvert jusqu'à sa fermeture explicite : si aucune réponse n'est fournie, l'exécution reste en cours. Au redémarrage du serveur, les exécutions de tickets `running` sont marquées `failed` ; les sessions d'assistance, conservées en mémoire, ne sont pas restaurées.

Les approbations configurées par `FACTORY_COPILOT_ALLOW` restent disponibles pour les opérations récurrentes et sûres (entrées `tool:`/`url:` séparées par `;`). Éviter toute pré-approbation plus large que nécessaire.

## Critères d'acceptation
- [x] Questions visibles, réponse / validation / rejet possibles.
- [x] Reprise avec contexte conservé (branche + échanges).
- [x] Attente sans timeout, reprise manuelle.
- [x] Notification avec lien vers l'écran de validation (webhook).
- [x] Changements de mode et décisions tracés.
- [x] Procédure documentée (ci-dessus). Tests : `server/interactive.test.js` (CLI simulée).
