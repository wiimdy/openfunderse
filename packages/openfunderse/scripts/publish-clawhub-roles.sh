#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_ROOT="${ROOT_DIR}/packs/openfunderse/skills"

VERSION=""
CHANGELOG="Initial release"
TAGS="latest,openfunderse"
ONLY="both"
DRY_RUN="false"

usage() {
  cat <<'EOF'
Publish OpenFunderse role skills to ClawHub.

Usage:
  ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version <semver> [options]

Options:
  --version <x.y.z>     Required. Release version.
  --changelog <text>    Optional. Default: "Initial release"
  --tags <csv>          Optional. Default: "latest,openfunderse"
  --only <target>       Optional. one of: strategy, participant, both (default: both)
  --dry-run             Optional. Print commands only.
  --help                Show this help message.

Examples:
  ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.0
  ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.1 --only strategy
  ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.2 --dry-run
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "error: required command not found: ${cmd}" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        VERSION="${2:-}"
        shift 2
        ;;
      --changelog)
        CHANGELOG="${2:-}"
        shift 2
        ;;
      --tags)
        TAGS="${2:-}"
        shift 2
        ;;
      --only)
        ONLY="${2:-}"
        shift 2
        ;;
      --dry-run)
        DRY_RUN="true"
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "error: unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done
}

validate_inputs() {
  if [[ -z "${VERSION}" ]]; then
    echo "error: --version is required" >&2
    usage
    exit 1
  fi

  if [[ "${ONLY}" != "strategy" && "${ONLY}" != "participant" && "${ONLY}" != "both" ]]; then
    echo "error: --only must be one of: strategy, participant, both" >&2
    exit 1
  fi

  if [[ ! -d "${SKILLS_ROOT}/strategy" ]]; then
    echo "error: missing strategy skill dir: ${SKILLS_ROOT}/strategy" >&2
    exit 1
  fi
  if [[ ! -d "${SKILLS_ROOT}/participant" ]]; then
    echo "error: missing participant skill dir: ${SKILLS_ROOT}/participant" >&2
    exit 1
  fi
}

run_publish() {
  local skill_dir="$1"
  local slug="$2"
  local name="$3"
  local role_tag="$4"
  local all_tags="${TAGS},${role_tag}"

  local cmd=(
    clawhub publish "${skill_dir}"
    --slug "${slug}"
    --name "${name}"
    --version "${VERSION}"
    --tags "${all_tags}"
    --changelog "${CHANGELOG}"
  )

  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] '
    printf '%q ' "${cmd[@]}"
    printf '\n'
    return 0
  fi

  "${cmd[@]}"
}

main() {
  parse_args "$@"
  validate_inputs

  if [[ "${DRY_RUN}" != "true" ]]; then
    require_command clawhub
    clawhub whoami >/dev/null
  fi

  if [[ "${ONLY}" == "strategy" || "${ONLY}" == "both" ]]; then
    run_publish \
      "${SKILLS_ROOT}/strategy" \
      "openfunderse-strategy" \
      "OpenFunderse Strategy" \
      "strategy"
  fi

  if [[ "${ONLY}" == "participant" || "${ONLY}" == "both" ]]; then
    run_publish \
      "${SKILLS_ROOT}/participant" \
      "openfunderse-participant" \
      "OpenFunderse Participant" \
      "participant"
  fi

  echo "done: clawhub publish completed"
}

main "$@"
