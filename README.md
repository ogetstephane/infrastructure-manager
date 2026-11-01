# Exploit

Catalogue du SI : périmètres → applications ; environnements portés par le périmètre ; serveurs, dépendances.

Prérequis : Node 22.5+ (`node:sqlite`).

```
make install   # dépendances + jeu de test (si la base est vide)
make dev       # API :3001 (SQLite server/si.db) + UI :5173
```

`make seed` recharge le jeu de test (ignoré si la base contient déjà des données), `make reset-db` repart d'une base neuve. `make help` liste les autres cibles. Le périmètre « Brevet » (recette, demo et prod, d'après le wiki Redmine) est ajouté par `make seed` même sur une base déjà alimentée (idempotent).

## Vues

| Vue | Contenu |
|---|---|
| Métier | Périmètres, leurs applications et environnements du périmètre. Lecture seule, avec recherche. |
| Dev | Gestion des périmètres (avec leurs environnements), applications, briques techniques. |
| Système | Serveurs (IP, OS, rôle, lieu, statut), environnements hébergés, impact en cas d'arrêt. |
| Dépendances | Graphe « A dépend de B » ; cliquer une application montre les applications impactées en cas de panne. |
| Ops | Serveurs en anomalie, briques non redondantes ou sans serveur, environnements sans serveur. |
| Responsables | Propriétaire et contact par périmètre et application. |
| Contact | Formulaire (email + description, consentement RGPD) ; `POST /api/contact` valide côté serveur, applique honeypot (`website`) et limite de débit (5 / 10 min / IP) puis enregistre dans `contact_requests`. Tests : `cd server && npm test`. |

## Fonctions transverses

- **Thème** clair/sombre (bouton dans l'en-tête, mémorisé), affichage adapté au mobile.
- **Tris** sur les colonnes des tables, **retour visuel** vert/rouge à la sauvegarde d'une cellule.
- **Filtres** de la vue Métier : recherche texte (périmètre, application, tag), criticité, tag cliquable.
- **Données** : criticité, tags (applications, serveurs), lien de documentation et notes par application.
- **Environnements** (`environments`) : ils appartiennent au **périmètre** (recette, demo, prod…) et sont partagés par ses applications ; une application n'a pas d'environnement propre. Un environnement n'a qu'un nom (ni description, ni URL, ni statut). Ils s'affichent en pastilles à droite du titre du périmètre (`EnvironmentPills`, dans `PerimeterCard`) ; au survol de la carte, « Éditer environnements » ouvre une vue dédiée (`PerimeterEnvironments`, CRUD via `/api/environments?perimeter_id=`) qui ne modifie que les environnements.
- **Briques techniques du périmètre** (`tech_bricks`, `tech_brick_nodes`) : catalogue du périmètre (MariaDB, HAProxy…) géré dans la carte du périmètre en mode édition (bloc autonome `PerimeterTechBricks`, comme les briques d'une application) : type, technologie, et serveurs par environnement du périmètre (rôle, port, « derrière » un proxy). API `/api/tech_bricks?perimeter_id=` et `/api/tech_brick_nodes?perimeter_id=`. Une brique d'application peut y faire référence (`components.tech_brick_id`, même périmètre exigé) : elle en reprend alors nom, type et technologie, et les suit ; ses serveurs sont alors hérités (lecture seule dans l'application, modifiables dans le périmètre). Les serveurs des briques du périmètre apparaissent dans Système (fiche serveur et impact), Dépendances (application → brique → serveur) et Ops (briques non redondantes ou sans serveur).
- **Briques techniques** (`components`, `component_nodes`) : une brique (Web, BDD, cache, recherche…) est définie une fois par application. Ses **membres** associent un serveur à un environnement avec un rôle (frontal, nœud, primaire, réplica, arbitre) : une brique a donc des serveurs différents selon l'environnement. La topologie (non déployée / simple / HA) et le statut (dégradé si un serveur est en anomalie) sont déduits. Éditable en vue Dev, visible en Système, Dépendances (filtre par environnement) et Ops. Un membre peut être placé **derrière** un autre membre du même environnement (`parent_node_id`, même d'une autre brique) : proxy → fils, avec arbre dans la vue Dev, flèche dans le graphe et propagation de la panne du proxy à ses fils. L'ancienne table `instances` est migrée automatiquement en briques « Applicatif ».
- **Services externes et flux** : tiers (banque, administration, SaaS, client…) et flux `flows` entre une application et un tiers. Sens `out` : l'application appelle le service ; sens `in` : le service consomme l'application (optionnellement via un serveur). Visibles dans le graphe de dépendances (carrés, pointillés), les fiches application et les fiches serveur.
- **Vue Dépendances en zoom** : périmètres → applications → détail d'une application (briques, environnements, serveurs, services externes, applications liées). Double-clic (ou bouton « Entrer ») pour descendre, fil d'Ariane pour remonter ; l'analyse d'impact fonctionne à chaque niveau.
- **Icônes par entité** (`components/common/Icon.jsx`) : 🏢 périmètre, 📦 application, 🌍 environnement (🚀 prod, 🧪 recette, 🎬 demo, 🛠️ dev), 🖥️ serveur, ⚙️ brique (selon son type : 🗄️ BDD, ⚡ cache, 🕸️ web…), 🌐 service externe, 🔀 flux, 🔗 dépendance. Présentes dans les titres, listes, navigation et nœuds du graphe.
- **Suppression de liens depuis le graphe** : cliquer un lien (dépendance, flux externe, brique↔serveur, proxy→fils) le sélectionne et affiche un panneau avec « Supprimer » (ou « Détacher » pour proxy→fils), après confirmation. Les liens agrégés (niveau périmètres) listent chaque lien sous-jacent.
- **Mode lecture / édition par entité** : chaque carte (périmètre, application, serveur, services externes, responsables) a un bouton « ✏️ Modifier » / « 👁 Lecture ». En lecture : texte, badges et liens, sans champ ni bouton de suppression. Vue Dev : édition par défaut ; Métier, Système et Responsables : lecture par défaut. Implémenté par un contexte (`components/common/EditMode.jsx`) lu par `EditCell`, `DelButton`, `AddForm`, `StatusSelect` et `CriticalitySelect`.
- **Fil d'Ariane hiérarchique** (toutes les vues) : `🏠 Tout › périmètre › application › environnement`, chaque niveau étant une liste déroulante de ses fils. Le choix filtre la vue et est conservé en changeant de vue ; il est porté par l'URL (`#vue?p=&a=&e=`, l'ancien `#metier/<id>` reste accepté). Il remplace les onglets par périmètre.
- **Graphe manipulable** : nœuds déplaçables par glisser-déposer (positions mémorisées dans le navigateur, par niveau et environnement, bouton « ↺ disposition » pour revenir à l'automatique), zoom à la molette ou boutons ＋/－/⤢, panoramique en glissant le fond, nœuds internes regroupés par périmètre, libellés longs tronqués (infobulle).

## Spécifications

Une spec par contexte, une feature par fichier : `specs/<contexte>/<feature>.md`.

| Contexte | Contenu |
|---|---|
| [ia-factory](specs/ia-factory/README.md) | Tickets et sous-tickets par périmètre dans la vue « 🏭 IA factory » : tableau, filtre par application, création/édition, déplacement, liens vers le catalogue, exécution et rédaction assistées par Copilot CLI (`npm i -g @github/copilot`). Un ticket **En revue** propose un mode « 🔀 Diff git » en lecture seule ([détail](specs/ia-factory/ticket-diff.md)) : fichiers modifiés et diff unifié/côte à côte de `git diff <base>...ticket/<id>`. **Suppression définitive** d'un ticket (`DELETE /api/tickets/:id`, réservée à `FACTORY_ADMINS`, 403/404/409 si sous-tickets, audit sans contenu dans `ticket_deletions`) : [détail](specs/ia-factory/ticket-crud.md). **Mode interactif** (questions de l'IA à répondre/valider/rejeter, mise en attente sans timeout, reprise, notification `FACTORY_NOTIFY_WEBHOOK`, audit, procédure d'exploitation) : [détail](specs/ia-factory/interactive-mode.md). |
| [incident-desk](specs/incident-desk/README.md) | Incidents par périmètre dans la vue « 🆘 IncidentDesk » : kanban Nouveau / En cours / Résolu, filtre par application, sévérité, déplacement. |

## Organisation du front (`web/src`)

```
query.js, api.js                    cache de requêtes REST (useQuery), appel API
store.jsx                           écritures (save) et <Slice> : charge un « bundle » pour un bloc autonome
selectors.js                        accès aux relations dans un bundle
components/common/                  primitives : Card, ListCard, Kpi, Badge, EditCell, AddForm, StatusSelect…
components/perimeter/               PerimeterCard (Métier + Dev), EnvironmentPills, PerimeterEnvironments, PerimeterTechBricks, OwnerRow
components/application/             ApplicationBlock (Métier + Dev), AppProfile, ComponentsPanel
components/server/                  ServerCard
components/deps/                    DependencyGraph, DependencyList, useImpact
views/                              une vue = un assemblage de composants
```

`PerimeterCard`, `ApplicationBlock` et `PerimeterEnvironments` prennent une prop `editable` :
sans elle ils servent la vue Métier (lecture seule), avec elle la vue Dev.

## API REST (`server/`)

Une ressource par entité (`server/entities/<entité>.js`, routeur générique dans `lib.js`) :

```
GET    /api/<entité>                 liste, filtrable (?application_id=…)
GET    /api/<entité>/:id             une ressource
GET    /api/<entité>/:id/<enfants>   sous-ressources : /perimeters/:id/{applications,environments,tech_bricks}, /applications/:id/{components,flows,dependencies},
                                     /environments/:id/{nodes,flows,servers}, /servers/:id/{nodes,flows,environments}, /components/:id/nodes…
GET    /api/<entité>/:id/bundle      la ressource et son contexte (pour un bloc autonome) : perimeters, applications, environments, servers, external_services
POST   /api/<entité>   PUT /api/<entité>/:id   DELETE /api/<entité>/:id
GET    /api/bundle?perimeter_id&application_id&environment_id   lecture agrégée d'une portée (vues Ops, Responsables, graphe)
GET    /api/scope  /api/tags
```

Il n'y a plus de chargement global : chaque bloc (`PerimeterCard`, `ApplicationBlock`, `ServerCard`, `ExternalServicesCard`, fil d'Ariane…)
demande ses propres données ; après une écriture, seules les requêtes affichées sont relues. Le graphe de dépendances charge `/api/bundle`
(tout le SI) uniquement tant que la vue est ouverte.
