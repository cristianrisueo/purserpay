# PurserPay — thin aliases over the package.json scripts (the source of truth).
# Every target wraps an existing `npm run` command; it invents no behavior. Edit the
# script in package.json and the alias follows. `make` with no target prints help.
.DEFAULT_GOAL := help
.PHONY: help up down db-up db-down db-reset db-status test check

help: ## List the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

up: ## Start working: local DB (Docker) then the dev server (Ctrl-C stops the server)
	npm run db:start
	npm run dev

down: ## Stop the local DB/containers (Ctrl-C the dev server first)
	npm run db:stop

db-up: ## Start the local Supabase stack only (Docker)
	npm run db:start

db-down: ## Stop the local Supabase stack only
	npm run db:stop

db-reset: ## Re-apply all migrations to an empty local DB (from-scratch check)
	npm run db:reset

db-status: ## Print the local Supabase URL + keys
	npm run db:status

test: ## Run the test suite
	npm test

check: ## Green-gate before commit: typecheck + lint + test + build
	npm run typecheck
	npm run lint
	npm test
	npm run build
