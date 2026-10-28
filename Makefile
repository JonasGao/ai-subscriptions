PROJECT_NAME := ai-subscriptions
PROJECT_DIR := $(shell pwd)
IMAGE := ${PROJECT_NAME}:latest
DEPLOY_DIR := ~/docker/${PROJECT_NAME}
COMPOSE := docker compose --project-directory ${DEPLOY_DIR} -f ${DEPLOY_DIR}/docker-compose.yml

.PHONY: image deploy up down restart status logs uninstall build help

image: ## Build docker image locally
	docker build -t ${IMAGE} ${PROJECT_DIR}

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

build: ## Production build check (npm, local)
	npm run build

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
