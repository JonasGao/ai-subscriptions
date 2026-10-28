PROJECT_NAME := ai-subscriptions

.PHONY: deploy image up down restart status logs uninstall build help

deploy: ## Build image and (re)start the deployment (see deploy/docker)
	@$(MAKE) -C deploy/docker $@

image: ## Build docker image locally
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

build: ## Production build check (npm, local)
	npm run build

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
