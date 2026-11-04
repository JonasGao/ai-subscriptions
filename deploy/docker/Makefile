PROJECT_NAME := ai-subscriptions
REPO_ROOT := $(abspath $(CURDIR)/../..)
IMAGE := ${PROJECT_NAME}:latest
DEPLOY_DIR := $(HOME)/docker/${PROJECT_NAME}
COMPOSE := docker compose --project-directory ${DEPLOY_DIR} -f $(REPO_ROOT)/deploy/docker/docker-compose.yml

# Base images and Go module proxy; machine-level override lives in
# $(DEPLOY_DIR)/build.env (e.g. NODE_IMAGE=z.my/node:24-alpine where docker.io
# is unreachable — see README.md).
NODE_IMAGE ?= node:24-alpine
GO_IMAGE ?= golang:1.27-alpine
RUNTIME_IMAGE ?= gcr.io/distroless/static-debian12:nonroot
GOPROXY ?= https://proxy.golang.org,direct
-include $(DEPLOY_DIR)/build.env

.PHONY: image deploy smoke up down restart status logs uninstall help

image: ## Build docker image locally (multi-stage: web -> go -> distroless)
	docker build \
		--build-arg NODE_IMAGE=$(NODE_IMAGE) \
		--build-arg GO_IMAGE=$(GO_IMAGE) \
		--build-arg RUNTIME_IMAGE=$(RUNTIME_IMAGE) \
		--build-arg GOPROXY=$(GOPROXY) \
		-t ${IMAGE} ${REPO_ROOT}

smoke: ## Verify the built image against the deployment contract (throw-away container)
	$(REPO_ROOT)/deploy/docker/smoke.sh ${IMAGE}

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
