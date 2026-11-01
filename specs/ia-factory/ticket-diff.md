# Feature : Diff git d'un ticket en revue

## User stories
- Quand un ticket est « En revue », je visualise les sources modifiées par rapport à la branche de base, sans quitter l'outil.
- Je reviens à l'affichage normal à tout moment.

## Règles
- Disponible uniquement si le ticket est au statut `review` ; sinon l'API répond 409 et le bouton **🔀 Diff git** (détail du ticket) n'est pas affiché. Si le ticket quitte `review` (ou si on sélectionne un autre ticket), le mode se ferme automatiquement.
- Le diff correspond à `git diff origin/<base>...ticket/<id>` (merge-base) dans le clone géré (`<FACTORY_WORKSPACE>/app-<id>/repo`), la branche de base étant `git_branch` de l'application liée. Le clone n'est pas rafraîchi par cette fonction.
- **Lecture seule** : seules des commandes `git diff` / `rev-parse` sont exécutées, jamais de modification du dépôt ni des sources.
- Sécurité : git est lancé sans shell (`execFile`), références construites sous `refs/…`, chemins après `--` et limités aux fichiers de la liste des modifications (pas d'injection par nom de branche ou de fichier) ; `--no-ext-diff --no-textconv` ; sortie plafonnée (`DIFF_MAX_BYTES`, 2 Mo), délai (`DIFF_TIMEOUT_MS`, 20 s).
- Liste : statut (ajouté, modifié, supprimé, renommé), ajouts/suppressions par fichier et en total (`DIFF_MAX_FILES`, 500, liste tronquée au-delà). Fichiers binaires signalés sans contenu.
- Patch unifié par fichier, paginé par lignes (`DIFF_PAGE_LINES`, 1000) avec « Charger la suite » ; sortie coupée au plafond signalée. Vue unifiée ou côte à côte, coloration syntaxique légère (commentaires, chaînes, nombres, mots-clés).
- Hors périmètre : commentaires en ligne, édition depuis le diff.

## API
```
GET /api/tickets/:id/diff                       → { base, branch, files: [{ path, old_path?, status, additions, deletions, binary }], total, truncated, additions, deletions }
GET /api/tickets/:id/diff/file?path=&offset=    → { file, binary, patch, offset, next_offset, truncated }
```
Erreurs : 404 (ticket, branche du ticket ou de base, dépôt non cloné, fichier absent du diff), 409 (ticket pas en revue, sans application ou sans dépôt/branche de base), 502 (erreur ou délai git).

## Critères d'acceptation
- [x] Bouton « Diff git » visible uniquement pour un ticket en revue.
- [x] Liste et diffs conformes à `git diff <base>...<branche>`.
- [x] Binaires, gros diffs, branche ou dépôt absent gérés avec messages clairs.
- [x] Tests : `server/diff.test.js` (parcours API de revue : statuts, renommage, binaire, pagination, branche/dépôt absents, 409 hors revue) et `server/diff-limits.test.js` (service : liste tronquée, binaires et noms accentués, sortie plafonnée, branche de base invalide) — `cd server && npm test`.

## Limites configurables (variables d'environnement)
`DIFF_MAX_FILES` (500), `DIFF_PAGE_LINES` (1000), `DIFF_MAX_BYTES` (2 Mo), `DIFF_TIMEOUT_MS` (20 s). Au-delà : liste marquée `truncated`, patch paginé, sortie coupée signalée.
