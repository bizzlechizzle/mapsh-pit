#!/usr/bin/env bash
# sync-depot.sh — Sync standards from repo-depot
#
# Usage:
#   ./scripts/sync-depot.sh           # Sync CLAUDE.md and skills
#   ./scripts/sync-depot.sh --check   # Show current version only
#   ./scripts/sync-depot.sh --force   # Force re-download even if up to date

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_DEPOT_URL="https://github.com/bizzlechizzle/repo-depot"
DEPOT_CACHE="$HOME/.cache/repo-depot"

print_status() {
    echo -e "${BLUE}[depot]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[depot]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[depot]${NC} $1"
}

print_error() {
    echo -e "${RED}[depot]${NC} $1"
}

ensure_depot_cache() {
    if [ ! -d "$DEPOT_CACHE/.git" ]; then
        print_status "Cloning repo-depot..."
        git clone --quiet "$REPO_DEPOT_URL" "$DEPOT_CACHE"
    else
        print_status "Updating repo-depot cache..."
        cd "$DEPOT_CACHE"
        git fetch origin --quiet
        git checkout main --quiet 2>/dev/null || true
        git pull origin main --quiet
        cd "$ROOT_DIR"
    fi
}

get_depot_version() {
    if [ -f "$DEPOT_CACHE/VERSION" ]; then
        local version=$(cat "$DEPOT_CACHE/VERSION")
        local commit_count=$(cd "$DEPOT_CACHE" && git rev-list --count HEAD 2>/dev/null || echo "0")
        echo "${version}.${commit_count}"
    else
        echo "unknown"
    fi
}

show_status() {
    print_status "Checking depot status..."

    local current="none"
    if [ -f ".depot-version" ]; then
        current=$(cat ".depot-version")
    fi

    ensure_depot_cache
    local remote=$(get_depot_version)

    echo ""
    echo "  Current: $current"
    echo "  Remote:  $remote"

    if [ "$current" = "$remote" ]; then
        echo -e "  Status:  ${GREEN}Up to date${NC}"
    else
        echo -e "  Status:  ${YELLOW}Update available${NC}"
    fi
}

sync_standards() {
    local force=${1:-false}

    ensure_depot_cache

    local current="none"
    if [ -f ".depot-version" ]; then
        current=$(cat ".depot-version")
    fi

    local remote=$(get_depot_version)

    if [ "$force" = false ] && [ "$current" = "$remote" ]; then
        print_success "Already up to date (v$current)"
        return 0
    fi

    print_status "Syncing from repo-depot v$remote..."

    # Sync CLAUDE.md
    if [ -f "$DEPOT_CACHE/CLAUDE.md" ]; then
        cp "$DEPOT_CACHE/CLAUDE.md" "CLAUDE.md"
        print_success "CLAUDE.md synced"
    fi

    # Sync skills if they exist
    if [ -d "$DEPOT_CACHE/skills" ]; then
        mkdir -p ".claude/skills"
        local synced=0
        for skill_dir in "$DEPOT_CACHE/skills"/*/; do
            if [ -d "$skill_dir" ]; then
                skill_name=$(basename "$skill_dir")
                if [ "$skill_name" != ".gitkeep" ]; then
                    cp -r "$skill_dir" ".claude/skills/"
                    ((synced++))
                fi
            fi
        done
        if [ $synced -gt 0 ]; then
            print_success "Synced $synced skills"
        fi
    fi

    # Record version
    echo "$remote" > ".depot-version"
    print_success "Updated to v$remote"
}

# Parse arguments
CHECK_ONLY=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --check|-c)
            CHECK_ONLY=true
            shift
            ;;
        --force|-f)
            FORCE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Syncs CLAUDE.md and skills from repo-depot."
            echo ""
            echo "Options:"
            echo "  --check, -c   Show status without syncing"
            echo "  --force, -f   Force sync even if up to date"
            echo "  --help, -h    Show this help"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Execute
if [ "$CHECK_ONLY" = true ]; then
    show_status
else
    sync_standards $FORCE
fi
