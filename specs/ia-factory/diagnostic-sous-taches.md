# Diagnostic : l'exécution d'un ticket n'exécute pas ses sous-tâches (ticket #138 / #139)

## Conclusion
**Ni régression de code, ni défaut du code actuel : manque fonctionnel (jamais implémenté), corrigé après coup, et non pris en compte par le serveur en cours d'exécution.**

- Jusqu'au ticket #156 (« Exécuter les sous-tickets (et non le parent) », 2026-10-24 ~00:38), `startRun` ne connaissait pas les sous-tickets : lancer un parent exécutait **uniquement le parent** (le prompt listait seulement titre/statut/description des sous-tickets, `describe(t, subsOf(t.id))`, à titre de contexte). La spec `sub-tickets.md` ne prévoyait aucune exécution des sous-tickets : c'est un manque, pas un comportement cassé.
- Aucun commit Git n'existe dans le dépôt (branche `master` vide) : pas de bisect possible. L'absence de régression se déduit du code, de la spec d'origine et de l'historique `ticket_runs`.

## Reproduction
Données : base `server/si.db`, tickets parents avec 3 à 6 sous-tickets (#161, #165, #121, #156, #149, #138…).

1. Lancer un parent (bouton Exécuter ou passage en « En cours »).
2. Lire `ticket_runs` : pour les exécutions #36 à #46 (parents à 3-6 sous-tickets, 00:07 → 00:51), la sortie ne contient **aucune** trace `sous-ticket #…` ni `[parent] non exécuté`, et aucune exécution n'existe pour les sous-tickets au même moment. Les sous-tickets restent en `backlog`/`todo`, sans exécution (#139 à #142 avant lancement manuel), et n'ont été lancés qu'à la main, un par un (#37-#39, #47-#49).
3. Test automatisé sur le code actuel : `cd server && node --test subtasks-run.test.js` → 7/7 passent (ordre, imbrication, cycles, échec, statuts, logs). Le défaut n'est donc plus reproductible avec le code actuel lancé à neuf.

## Flux d'exécution
`POST /api/tickets/:id/run` ou transition vers `doing` → `launchTicket` (`server/factory.js`) → `startRun(t, app, { withSubs: true })` → si `withSubs` et sous-tickets : `runSubs` (séquentiel, `position` puis `id`, récursif, anti-cycle), sinon exécution du ticket lui-même.

Avant #156, ce branchement `withSubs`/`runSubs` n'existait pas : `launchTicket` appelait `startRun` qui lançait toujours Copilot sur le ticket lui-même.

## Causes racines
1. **Manque fonctionnel d'origine** : aucune notion d'exécution des sous-tickets dans `startRun` (voir ci-dessus).
2. **Serveur non redémarré** : `make dev` / `npm start` lance `node index.js` sans rechargement à chaud. Les exécutions #44 (#149), #45 (#138) et #46 (#132) ont eu lieu après la livraison de #156 mais ont encore exécuté le parent lui-même : le processus serveur tournait avec l'ancien code. C'est ce qui fait réapparaître le symptôme pour l'utilisateur. **Action : redémarrer le serveur** après toute modification de `server/`.
3. **Chemins résiduels sans `withSubs`** (écarts mineurs, non bloquants pour le scénario du ticket) :
   - `POST /api/tickets/:id/resume` (≈ l. 644) et la relance après suspension interactive (≈ l. 219) appellent `startRun` sans `withSubs` : la reprise d'un parent exécuterait le parent lui-même. Peu probable en pratique, un parent n'étant plus exécuté directement ; à traiter par le ticket #141 (statuts, logs, erreurs) si on veut un comportement cohérent.
   - Si un sous-ticket est suspendu pour passage en interactif, la fin `suspended` fait échouer le parent (« Sous-tickets : … statut suspended »).

## Hors sujet constaté
`server/interactive.test.js` échoue (1/100) : il attend les arguments `-i --allow-all-tools --no-auto-update` alors que le code passe `--allow-all-paths` (spec `ticket-run.md` encore sur `--no-auto-update`). Sans lien avec les sous-tâches.

## Suites
- #140 « Implémenter l'exécution des sous-tâches » : déjà couvert par `runSubs` (#156) ; vérifier seulement après redémarrage du serveur.
- #141 : traiter les chemins résiduels ci-dessus (reprise, suspension).
- #142 : les tests existent (`subtasks-run.test.js`) ; ajouter des cas pour `resume` d'un parent.
