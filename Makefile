# Node 22.5+ local (utile si le Node système est trop ancien), surchargeable : make dev NODE_BIN=/chemin/bin
NODE_BIN ?= $(firstword $(wildcard $(HOME)/.local/node/bin /home/*/.local/node/bin))
export PATH := $(NODE_BIN):$(PATH)

# Dossier dans lequel Copilot travaille pour exécuter un ticket (racine du projet par défaut, pour éditer server/ et web/)
FACTORY_WORKDIR ?= $(CURDIR)
export FACTORY_WORKDIR

.PHONY: help install check-node seed reset-db server web dev build clean

help:
	@echo "make install  - installe les dépendances et charge le jeu de test (si la base est vide)"
	@echo "make seed     - charge le jeu de test (ignoré si la base contient déjà des données)"
	@echo "make reset-db - supprime la base puis recharge le jeu de test"
	@echo "make dev      - lance l'API (:3001) et l'interface (:5173)"
	@echo "make server   - lance uniquement l'API"
	@echo "make web      - lance uniquement l'interface"
	@echo "make build    - build de production du front"
	@echo "make clean    - supprime node_modules et dist"

install: check-node
	cd server && npm install
	cd web && npm install
	$(MAKE) seed

seed: check-node
	cd server && npm run seed

reset-db: check-node
	rm -f server/si.db
	$(MAKE) seed

check-node:
	@node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)" || \
		(echo "Node 22.5+ requis (node:sqlite), trouvé: $$(node -v)"; exit 1)

server: check-node
	cd server && npm start

web:
	cd web && npm run dev

dev: check-node
	@trap 'kill 0' INT TERM EXIT; \
	(cd server && npm start) & \
	(cd web && npm run dev) & \
	wait

build:
	cd web && npm run build

clean:
	rm -rf server/node_modules web/node_modules web/dist
