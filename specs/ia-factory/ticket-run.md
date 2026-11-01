# Feature : Exécuter un ticket avec Copilot

## User stories
- Depuis le détail d'un ticket, je lance son exécution : Copilot (CLI) réalise le travail décrit.
- Je suis la sortie de Copilot en direct, je peux l'arrêter.
- Je retrouve l'historique des exécutions d'un ticket (date, durée, résultat, sortie).

## Règles
- L'exécution lance la **Copilot CLI** dans un terminal virtuel : `copilot -i <prompt> --allow-all-tools --no-auto-update`. L'opérateur peut répondre aux demandes de l'IA dans le terminal intégré ; **Terminer la session** envoie `/quit` et valide la fin de l'exécution. Le processus reste ouvert jusqu'à cette action ou jusqu'à son arrêt. Le dossier de travail est le **dossier courant du processus serveur** (`server/`) ; `make dev` définit `FACTORY_WORKDIR` à la racine du projet pour pouvoir éditer `server/` et `web/` (surchargeable : `make dev FACTORY_WORKDIR=/chemin`). `COPILOT_BIN` change l'exécutable (tests).
- Prérequis : `copilot` installé et connecté (`npm i -g @github/copilot`, puis connexion). Absent : 503 « Copilot CLI introuvable », message clair dans l'interface.
- **Une seule exécution à la fois** pour tout le serveur (un seul dossier de travail) : 409 sinon.
- Disponible en **mode édition** uniquement. Un ticket `done` ne peut pas être lancé sans confirmation.
- Le prompt est construit côté serveur : titre, description (Markdown), sous-tickets (titre, statut, description) et libellés des entités liées (type + nom) ; consigne de ne travailler que dans le dossier de travail et de résumer le résultat à la fin.
- Statuts du ticket : au lancement, passe en `doing` (bas de colonne, comme un déplacement). Succès : passe en `review` ; pour un **sous-ticket**, il passe en `done` (Terminé) et le changement est tracé dans `ticket_audit` (acteur `automatique`, action `status`, détail « exécution #n terminée sans erreur »). Échec ou arrêt : reste en `doing`.
- **Sous-tickets** : lancer un ticket qui a des sous-tickets exécute **uniquement** ses sous-tickets, **séquentiellement dans l'ordre du tableau** (`position`, puis `id` ; récursivement en profondeur, protégé contre les cycles) ; le ticket parent n'est **jamais** exécuté (il passe « En revue » si tous ses sous-tickets sont terminés) et sert de contexte en lecture seule. Un ticket sans sous-ticket s'exécute comme avant. Les sous-tickets `done` sont ignorés. Chaque sous-ticket a sa propre exécution (historique, statut `doing`/`review`) ; sa sortie et son statut sont recopiés dans la sortie de l'exécution du parent. **Échec d'un sous-ticket (échec, attente de réponses) : arrêt immédiat**, les suivants ne sont pas exécutés, l'exécution du parent est `failed` (message « Sous-tickets : … »). Arrêter le parent arrête le sous-ticket en cours. Le parent garde la place « sans application » pendant toute la séquence.
- **Lancement automatique** : toute transition vers `doing` (UI, API `PUT`, déplacement) appelle le même service que le bouton Exécuter (`launchTicket`, mêmes droits, audit, historique), comportement global. Idempotent : rien n'est relancé si une exécution est active ou en attente de réponses. Échec (droits, dépôt Git manquant, Copilot absent…) : transition annulée (statut rétabli), erreur 409 visible, trace `run_failed` + log. Les autres statuts ne déclenchent rien. Tests : `server/auto-launch.test.js`.
- **Échecs de lancement** (bouton Exécuter ou passage automatique) : toujours journalisés (`log`) et tracés dans `ticket_audit` (`run_failed`, message clair), erreur affichée à l'utilisateur, statut du ticket inchangé (rétabli en cas de transition automatique). Un refus « déjà en cours / en attente de réponses » est journalisé mais n'est pas un échec tracé.
- La sortie du terminal est capturée dans `output` (plafond 1 Mo, la fin est conservée, troncature signalée) ; les frappes et le redimensionnement du terminal sont relayés par l'API.
- Les assistants de rédaction de tickets et d'incidents utilisent le même terminal interactif. Leur proposition n'est validée qu'après fermeture de la session et extraction du JSON.
- Au redémarrage du serveur, toute exécution `running` devient `failed` (« interrompu »).
- Supprimer un ticket supprime ses exécutions ; une exécution en cours est d'abord arrêtée.

## Modèle de données
```
ticket_runs  id, ticket_id → tickets (ON DELETE CASCADE),
             status ('running' | 'succeeded' | 'failed' | 'cancelled'),
             started_at, ended_at, exit_code, output TEXT DEFAULT ''
```

## API
```
POST /api/tickets/:id/run          → 201 { id }   (409 déjà en cours, 503 CLI absente, 404 ticket inconnu)
GET  /api/ticket_runs?ticket_id=   → liste (sans output), la plus récente d'abord
GET  /api/ticket_runs/:id          → { …, output }   (le terminal récupère les nouveaux caractères par offset)
POST /api/ticket_runs/:id/input    { data }   → transmet les frappes au terminal
POST /api/ticket_runs/:id/resize   { cols, rows }   → redimensionne le terminal
POST /api/ticket_runs/:id/finish   → envoie `/quit`
POST /api/ticket_runs/:id/cancel   → arrêt du processus (SIGTERM puis SIGKILL après 5 s), status = cancelled
POST /api/tickets/assist           → 201 { session_id }
POST /api/incidents/assist         → 201 { session_id }
GET  /api/copilot_sessions/:id     → { status, output, result, error } ; `?offset=` récupère la sortie incrémentale
POST /api/copilot_sessions/:id/input  { data }  → transmet les frappes au terminal
POST /api/copilot_sessions/:id/resize { cols, rows } → redimensionne le terminal
POST /api/copilot_sessions/:id/finish → envoie `/quit`
POST /api/copilot_sessions/:id/cancel → arrête la session
```

## Interface
- Détail du ticket, section « Exécution » : bouton **▶ Exécuter** (désactivé si une exécution est en cours, quel que soit le ticket, avec explication), zone de sortie monospace défilante pendant l'exécution, bouton **■ Arrêter**.
- Liste « Historique » : date, durée, badge de résultat ; clic = affiche la sortie.
- Carte du tableau : pastille ⏳ tant qu'une exécution du ticket est en cours.
- Lecture seule : l'historique reste consultable, aucun bouton de lancement ou d'arrêt.

## Critères d'acceptation
- [ ] Lancer un ticket crée une exécution `running`, passe le ticket en « En cours » et affiche la sortie en direct.
- [ ] En fin de succès, le ticket passe en « En revue » ; en échec, il reste « En cours » avec le statut `failed`.
- [ ] Une seconde exécution simultanée est refusée (409) et le bouton est désactivé.
- [ ] « Arrêter » termine le processus et marque l'exécution `cancelled`.
- [ ] Sans Copilot CLI, l'interface affiche un message explicite et rien n'est créé.
- [ ] Après redémarrage du serveur, aucune exécution ne reste `running`.
- [ ] En mode lecture, aucun contrôle d'exécution n'est visible.

## Dépôt Git et worktree dédié

- L'application porte `git_repo` (URL https/ssh/`git@hôte:chemin` ou chemin local absolu) et `git_branch` (branche de base, résolue depuis le dépôt si vide). L'accessibilité est vérifiée (`git ls-remote`) à l'enregistrement ; un dépôt invalide, inaccessible, une branche inconnue ou une URL contenant des identifiants sont refusés avec un message clair. Aucun identifiant n'est stocké : accès via clé SSH ou credential helper git du serveur ; les URLs sont masquées dans les logs.
- Un ticket lié à une application sans dépôt ne se lance pas (409, message explicite). Un ticket sans application garde l'ancien comportement (`FACTORY_WORKDIR`, une seule exécution à la fois).
- Au lancement : clone (`--no-checkout`) puis `git fetch` sous verrou dans `<FACTORY_WORKSPACE>/app-<id>/repo` (défaut `server/workspace`), puis `git worktree add <FACTORY_WORKSPACE>/app-<id>/worktrees/ticket-<id> -b ticket/<id> origin/<base>`. Copilot s'exécute dans ce worktree ; chemin et branche sont stockés sur le ticket (`worktree_path`, `worktree_branch`). Plusieurs tickets d'une application tournent en parallèle ; une branche `ticket/<id>` existante est réutilisée à la relance.
- Fin d'exécution : succès → modifications restantes commitées, worktree supprimé, branche conservée ; échec/arrêt → worktree et branche supprimés (sauf branche préexistante). Erreurs git (fetch, disque plein, conflit) journalisées `[git]` et ajoutées à la sortie de l'exécution.
- Purge (au démarrage, toutes les heures — `FACTORY_PURGE_INTERVAL_MS` —, à la suppression d'un ticket, ou `POST /api/worktrees/purge`) : worktrees sans exécution active, dossiers d'applications supprimées, branches de tickets supprimés ou terminés et fusionnés.

## Mode interactif
Voir [interactive-mode.md](interactive-mode.md) : questions de l'IA, suspension/reprise, notification, audit.

## Recette : passage automatique en « En cours » vs bouton Exécuter

Tests automatisés : `cd server && node --test auto-launch.test.js` (transition nominale, rejeu/double appel/concurrence, échec de lancement, droits, autres statuts sans déclenchement, équivalence avec Exécuter).

Recette manuelle (deux tickets A et B identiques, en « À faire », même application, même opérateur) :
1. A : glisser la carte (ou changer le statut) vers « En cours ». B : ouvrir le détail et cliquer **▶ Exécuter**.
2. Vérifier pour les deux : une seule exécution `running` créée, sortie en direct, pastille ⏳. Une seule exécution à la fois : lancer B pendant que A tourne doit afficher l'erreur 409 explicite, statut inchangé.
3. À la fin : statut « En revue » en cas de succès ; « En cours » + exécution `failed` en cas d'échec ; mêmes sortie, code de sortie, branche/worktree.
4. Historique : A porte une entrée « lancement automatique, passage en « En cours » », B l'entrée « Exécuter » ; même acteur.
5. Rejeu : remettre A en « À faire » puis « En cours » pendant l'exécution → aucune 2ᵉ exécution.
6. Échec de lancement (application sans dépôt Git, ou opérateur non autorisé) : le ticket revient à son statut d'origine, message d'erreur visible, entrée `run_failed` tracée.
7. Déplacer vers Backlog/À faire/En revue/Terminé : aucune exécution créée.
