# Contexte incident-desk

Gestion des incidents par périmètre, sur un tableau kanban dédié. Même principe que [ia-factory](../ia-factory/README.md) : vue dédiée `#incident-desk` (🆘), périmètre obligatoire, filtre facultatif par application.

## Modèle

Table `incidents` : `perimeter_id` (obligatoire, cascade), `application_id` (facultatif, `SET NULL` si l'application est supprimée), `title` (200 max), `description` (Markdown), `severity`, `status`, `position`, `opened_at`, `resolved_at`.

- `status` : `new` (Nouveau), `in_progress` (En cours), `resolved` (Résolu).
- `severity` : `low` (Faible), `minor` (Mineur, défaut), `major` (Majeur), `critical` (Critique).
- `opened_at` est posé à la création ; `resolved_at` est posé à l'entrée dans « Résolu » et effacé à la sortie. Ni l'un ni l'autre ne se modifie directement.

## API

`/api/incidents` (CRUD générique, filtres `perimeter_id`, `application_id`, `status`) et `POST /api/incidents/:id/move` `{ status, index }`. Erreurs de validation : 400 ; 404 pour un incident inconnu. Les suppressions renvoient `200 { ok: true }`.

## Specs

| Feature | Fichier |
|---|---|
| Tableau kanban et filtre par application | [board.md](./board.md) |
| Créer, éditer, supprimer un incident | [incident-crud.md](./incident-crud.md) |
| Déplacer un incident | [move-incident.md](./move-incident.md) |
| Assistant de rédaction (Copilot) | [incident-assist.md](./incident-assist.md) |
