#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:?"Usage: verify-release-archive.sh archive.tar.gz [sha]"}
expected_sha=${2:-}
[[ -f "$archive" ]] || { echo "Archive introuvable." >&2; exit 2; }

entries=$(tar -tzf "$archive")
while IFS= read -r entry; do
  normalized=${entry#./}
  [[ -n "$normalized" ]] || continue
  if [[ "$normalized" == /* || "$normalized" =~ (^|/)\.\.(/|$) ]]; then
    echo "Chemin d’archive interdit : $normalized" >&2
    exit 3
  fi
  if [[ "$normalized" =~ (^|/)(\.git|\.github|docs|tests|node_modules|config|storage)(/|$) || "$normalized" =~ (^|/)\.env($|\.) ]]; then
    echo "Ressource non déployable présente : $normalized" >&2
    exit 4
  fi
done <<< "$entries"

for required in index.html .htaccess service-worker.js api/v1/index.php api/src/Config.php database/migrations/000_schema.sql bin/migrate.php bin/deploy-release.sh; do
  if ! grep -Fqx "$required" <<< "$entries" && ! grep -Fqx "./$required" <<< "$entries"; then
    echo "Ressource requise absente : $required" >&2
    exit 5
  fi
done

if [[ -n "$expected_sha" ]]; then
  [[ "$expected_sha" =~ ^[0-9a-f]{40,64}$ ]] || { echo "SHA attendu invalide." >&2; exit 6; }
  worker_member=service-worker.js
  grep -Fqx "$worker_member" <<< "$entries" || worker_member=./service-worker.js
  tar -xOzf "$archive" "$worker_member" | grep -F "fat-v3-$expected_sha" >/dev/null || {
    echo "Le cache PWA n’est pas lié au SHA." >&2
    exit 7
  }
fi

echo "Archive de release vérifiée."
