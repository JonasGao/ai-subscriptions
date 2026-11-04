PROJECT_NAME := ai-subscriptions

# Single-binary rewrite (ADR-0018): server/ = Go + chi, web/ = Vite + SolidJS.
# The built SPA tree is copied into server/internal/webui/dist and baked into
# the binary via go:embed.
SERVER_DIR := server
WEB_DIR := web
WEB_DIST := $(WEB_DIR)/dist
EMBED_DIST := $(SERVER_DIR)/internal/webui/dist
BIN := $(SERVER_DIR)/bin/$(PROJECT_NAME)

.PHONY: deploy image smoke up down restart status logs uninstall build test run \
        server-build web-build web-install legacy-build clean help

deploy: ## Build image and (re)start the deployment (see deploy/docker)
	@$(MAKE) -C deploy/docker $@

image: ## Build docker image locally
	@$(MAKE) -C deploy/docker $@

smoke: ## Verify the built image contract on a throw-away container
	@$(MAKE) -C deploy/docker $@

up: ## Start the container
	@$(MAKE) -C deploy/docker $@

down: ## Stop and remove the container
	@$(MAKE) -C deploy/docker $@

restart: ## Restart the container
	@$(MAKE) -C deploy/docker $@

status: ## Show container status
	@$(MAKE) -C deploy/docker $@

logs: ## Follow container logs
	@$(MAKE) -C deploy/docker $@

uninstall: ## Remove the container (image and ~/docker data are kept)
	@$(MAKE) -C deploy/docker $@

web-install: $(WEB_DIR)/node_modules ## Install web/ dependencies (npm ci)

$(WEB_DIR)/node_modules: $(WEB_DIR)/package.json $(WEB_DIR)/package-lock.json
	npm --prefix $(WEB_DIR) ci

web-build: web-install ## Build the SolidJS SPA into web/dist and stage it for go:embed
	npm --prefix $(WEB_DIR) run build
	@rm -rf $(EMBED_DIST)
	@mkdir -p $(EMBED_DIST)
	@cp -R $(WEB_DIST)/. $(EMBED_DIST)/
	@touch $(EMBED_DIST)/.gitkeep

server-build: ## Compile the Go server binary (expects staged web assets)
	cd $(SERVER_DIR) && go build -trimpath -o bin/$(PROJECT_NAME) ./cmd/server

build: web-build server-build ## Build the single binary with embedded SPA (new stack)
	@echo "built $(BIN)"

test: web-build ## Run both test suites (Go + vitest)
	cd $(SERVER_DIR) && go test ./...
	npm --prefix $(WEB_DIR) test

run: build ## Build and run the new stack on :3000
	@./$(BIN)

legacy-build: ## Old stack production build (npm run build); retired at cutover
	npm run build

clean: ## Remove build artifacts (keeps the go:embed placeholder)
	@rm -rf $(SERVER_DIR)/bin $(WEB_DIST)
	@rm -rf $(EMBED_DIST)
	@mkdir -p $(EMBED_DIST) && touch $(EMBED_DIST)/.gitkeep

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
