PROJECT_NAME := ai-subscriptions
PROJECT_DIR := $(shell pwd)
SERVICE_FILE := ~/.config/systemd/user/${PROJECT_NAME}.service
NODE_PATH := $(shell which node || echo ~/.nvm/versions/node/v24.13.0/bin/node)
PORT := 3000

.PHONY: install uninstall start stop restart status logs enable disable build

install: ## Install systemd user service
	@echo "Installing ${PROJECT_NAME} service..."
	@mkdir -p ~/.config/systemd/user
	@echo "[Unit]" > ${SERVICE_FILE}
	@echo "Description=AI Subscriptions Management Tool" >> ${SERVICE_FILE}
	@echo "After=network.target" >> ${SERVICE_FILE}
	@echo "" >> ${SERVICE_FILE}
	@echo "[Service]" >> ${SERVICE_FILE}
	@echo "Type=simple" >> ${SERVICE_FILE}
	@echo "WorkingDirectory=${PROJECT_DIR}" >> ${SERVICE_FILE}
	@echo "Environment=\"PATH=${PROJECT_DIR}/node_modules/.bin:${HOME}/.nvm/versions/node/v24.13.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"" >> ${SERVICE_FILE}
	@echo "ExecStart=${NODE_PATH} ${PROJECT_DIR}/node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}" >> ${SERVICE_FILE}
	@echo "Restart=on-failure" >> ${SERVICE_FILE}
	@echo "RestartSec=10" >> ${SERVICE_FILE}
	@echo "" >> ${SERVICE_FILE}
	@echo "[Install]" >> ${SERVICE_FILE}
	@echo "WantedBy=default.target" >> ${SERVICE_FILE}
	@systemctl --user daemon-reload
	@echo "Service installed successfully"

uninstall: stop disable ## Uninstall systemd user service
	@echo "Uninstalling ${PROJECT_NAME} service..."
	@rm -f ${SERVICE_FILE}
	@systemctl --user daemon-reload
	@echo "Service uninstalled successfully"

start: ## Start the service
	@echo "Starting ${PROJECT_NAME}..."
	@systemctl --user start ${PROJECT_NAME}.service

stop: ## Stop the service
	@echo "Stopping ${PROJECT_NAME}..."
	@systemctl --user stop ${PROJECT_NAME}.service

restart: ## Restart the service
	@echo "Restarting ${PROJECT_NAME}..."
	@systemctl --user restart ${PROJECT_NAME}.service

status: ## Show service status
	@systemctl --user status ${PROJECT_NAME}.service

logs: ## Show service logs
	@journalctl --user -u ${PROJECT_NAME}.service -f

enable: ## Enable service to start on boot
	@echo "Enabling ${PROJECT_NAME} to start on boot..."
	@systemctl --user enable ${PROJECT_NAME}.service

disable: ## Disable service from starting on boot
	@echo "Disabling ${PROJECT_NAME} from starting on boot..."
	@systemctl --user disable ${PROJECT_NAME}.service

build: ## Build for production
	npm run build

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help