PROJECT_NAME := ai-subscriptions
REPO_ROOT := $(abspath $(CURDIR)/../..)
IMAGE := ${PROJECT_NAME}:latest
DEPLOY_DIR := ~/docker/${PROJECT_NAME}
COMPOSE := docker compose --project-directory ${DEPLOY_DIR} -f $(REPO_ROOT)/deploy/docker/docker-compose.yml

.PHONY: image deploy up down restart status logs uninstall help

image: ## Build docker image locally
	docker build -t ${IMAGE} ${REPO_ROOT}

deploy: ## Build image and (re)start the deployment
	@${MAKE} image
	@${MAKE} up

up: ## Start the container (docker compose up -d)
	${COMPOSE} up -d

down: ## Stop and remove the container
	${COMPOSE} down

restart: ## Restart the container
	${COMPOSE} restart

status: ## Show container status
	${COMPOSE} ps

logs: ## Follow container logs
	${COMPOSE} logs -f

uninstall: down ## Remove the container (image and ~/docker data are kept)
	@echo "Container removed. Image '${IMAGE}' and data in ${DEPLOY_DIR} are kept."

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
