#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'Jalankan script ini dari dalam repository Git.\n' >&2
  exit 1
}

cd "$repo_root"

if (($# > 0)); then
  commit_message="$*"
else
  read -r -p 'Pesan commit: ' commit_message
fi

if [[ -z "${commit_message//[[:space:]]/}" ]]; then
  printf 'Pesan commit tidak boleh kosong.\n' >&2
  exit 1
fi

git add .

if git diff --cached --quiet; then
  printf 'Tidak ada perubahan untuk di-commit.\n'
  exit 0
fi

git commit -m "$commit_message"
git push
