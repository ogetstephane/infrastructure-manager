# Feature : Assistant de rédaction d'incidents (Copilot)

## User stories
- Je décris un incident en texte libre (« le batch de nuit a planté, les factures n'ont pas été émises ») et Copilot me propose un titre, une description structurée et une sévérité.
- Je relis, corrige, puis j'enregistre : rien n'est écrit en base avant ma validation.
- Je peux aussi affiner un incident existant.

## Règles
- Même moteur que [l'assistant d'IA factory](../ia-factory/ticket-assist.md) : Copilot CLI lancée par le serveur, **sans outils** (`-s`, sans `--allow-all-tools`), dans un dossier temporaire, délai `ASSIST_TIMEOUT_MS` (120 s).
- `POST /api/incidents/assist` `{ perimeter_id, application_id?, request, incident_id? }` → `{ title, description, severity }`, sans rien enregistrer.
- Le prompt contient le nom du périmètre, celui de l'application si elle est filtrée, et l'incident existant le cas échéant. La description proposée suit le plan : **Symptômes**, **Impact**, **Chronologie**, **Hypothèses**, **Actions**.
- Réponse validée côté serveur : titre non vide (200 max), sévérité parmi `low|minor|major|critical` (sinon `minor`), description texte.
- Erreurs : 400 (demande vide ou > 4000 caractères, périmètre ou incident inconnu, application hors périmètre), 502 (réponse inexploitable, début de la réponse inclus), 503 (CLI absente), 504 (délai).

## UI
- Bouton ✨ par colonne (nouvel incident, dans cette colonne, rattaché à l'application filtrée) et ✨ Assister dans le détail (mode édition).
- Panneau : zone de texte → « Proposer » → titre, sévérité et description (Markdown, aperçu) éditables → « Enregistrer » ou « Reformuler ».
- Incident existant : titre et description sont remplacés (l'actuelle reste consultable) ; la sévérité proposée est appliquée.

## Critères d'acceptation
- [x] Une proposition valide s'affiche sans rien enregistrer.
- [x] Enregistrer crée l'incident dans la colonne d'où le panneau a été ouvert.
- [x] Demande vide : 400.
- [x] Réponse non JSON : 502 avec un extrait.
- [x] Sévérité inconnue ramenée à « Mineur ».
