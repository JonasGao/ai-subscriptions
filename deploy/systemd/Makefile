PROJECT_NAME := ai-subscriptions
PROJECT_DIR := $(abspath $(CURDIR)/../..)
PREFIX ?= $(HOME)/.local
BIN := $(PREFIX)/bin/$(PROJECT_NAME)
ENV_FILE ?= $(PROJECT_DIR)/.env
PORT := 3000
SERVICE_NAME := $(PROJECT_NAME).service
SERVICE_DIR := $(HOME)/.config/systemd/user
SERVICE_FILE := $(SERVICE_DIR)/$(SERVICE_NAME)
UNIT_TEMPLATE := $(CURDIR)/$(PROJECT_NAME).service.in
BUILT_BIN := $(PROJECT_DIR)/server/bin/$(PROJECT_NAME)

.PHONY: install install-binary unit uninstall start stop restart status logs enable disable build help

install: build install-binary unit ## Build the single binary, install it and the systemd user service
	@systemctl --user daemon-reload
	@systemctl --user enable $(SERVICE_NAME)
	@echo "Service installed and enabled for auto-start on login (data dir: DATA_DIR from $(ENV_FILE), else ~/.local/share/$(PROJECT_NAME))"

install-binary: ## Install the built binary to $(BIN)
	@echo "Installing $(BIN)..."
	@mkdir -p $(PREFIX)/bin
	@install -m 755 $(BUILT_BIN) $(BIN)

unit: ## Render the systemd unit from the template (no systemctl call)
	@mkdir -p $(SERVICE_DIR)
	@sed -e 's|@BIN@|$(BIN)|g' \
	     -e 's|@PROJECT_DIR@|$(PROJECT_DIR)|g' \
	     -e 's|@ENV_FILE@|$(ENV_FILE)|g' \
	     -e 's|@PORT@|$(PORT)|g' \
	     $(UNIT_TEMPLATE) > $(SERVICE_FILE)
	@echo "Wrote $(SERVICE_FILE)"

uninstall: stop disable ## Uninstall the service and the installed binary
	@echo "Uninstalling $(SERVICE_NAME)..."
	@rm -f $(SERVICE_FILE)
	@rm -f $(BIN)
	@systemctl --user daemon-reload
	@echo "Service and $(BIN) removed"

start: ## Start the service
	@echo "Starting $(PROJECT_NAME)..."
	@systemctl --user start $(SERVICE_NAME)

stop: ## Stop the service
	@echo "Stopping $(PROJECT_NAME)..."
	@-systemctl --user stop $(SERVICE_NAME)

restart: ## Restart the service
	@echo "Restarting $(PROJECT_NAME)..."
	@systemctl --user restart $(SERVICE_NAME)

status: ## Show service status
	@systemctl --user status $(SERVICE_NAME)

logs: ## Show service logs
	@journalctl --user -u $(SERVICE_NAME) -f

enable: ## Enable service to start on boot
	@echo "Enabling $(PROJECT_NAME) to start on boot..."
	@systemctl --user enable $(SERVICE_NAME)

disable: ## Disable service from starting on boot
	@echo "Disabling $(PROJECT_NAME) from starting on boot..."
	@-systemctl --user disable $(SERVICE_NAME)

build: ## Build the single binary (Go + embedded SolidJS SPA)
	@$(MAKE) -C $(PROJECT_DIR) build

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
