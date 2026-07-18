#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root_input=${1:?"Usage: rollback-release.sh DEPLOY_PATH SHA"}
sha=${2:?"SHA manquant"}
[[ "$sha" =~ ^[0-9a-f]{40,64}$ && "$root_input" == /* && "$root_input" != "/" ]] || { echo "Paramètres invalides." >&2; exit 2; }
root=$(cd "$root_input" && pwd -P)
releases="$root/releases"
target="$releases/$sha"
[[ -d "$target" && -f "$target/api/v1/index.php" ]] || { echo "Release de rollback absente." >&2; exit 3; }
[[ -L "$root/current" ]] || { echo "Lien current absent." >&2; exit 3; }
former=$(readlink -f "$root/current")
[[ "$former" == "$releases/"* && -d "$former" ]] || { echo "Release active invalide." >&2; exit 3; }

exec 9>"$root/private/locks/deploy.lock"
flock -n 9 || { echo "Un déploiement est déjà en cours." >&2; exit 9; }
deploy_config="$root/private/config/deploy.env"
health_url=$(awk -F= '$1 == "DEPLOY_HEALTHCHECK_URL" {sub(/^[^=]*=/, ""); print; exit}' "$deploy_config")
[[ "$health_url" =~ ^https://[A-Za-z0-9.-]+/api/v1/health$ ]] || { echo "Health check invalide." >&2; exit 4; }

next="$root/.rollback-$sha"
rm -f -- "$next"
ln -s "$target" "$next"
mv -Tf -- "$next" "$root/current"
response=$(curl --fail --silent --show-error --max-time 10 "$health_url" 2>/dev/null || true)
if ! printf '%s' "$response" | php -r '$v=json_decode(stream_get_contents(STDIN),true);exit(($v["status"]??null)==="ok"?0:1);'; then
  recovery="$root/.rollback-recovery-$sha"
  rm -f -- "$recovery"
  ln -s "$former" "$recovery"
  mv -Tf -- "$recovery" "$root/current"
  echo "Rollback refusé par le health check ; release initiale restaurée." >&2
  exit 5
fi
printf '%s manual-rollback %s -> %s\n' "$(date -u +%FT%TZ)" "$(basename "$former")" "$sha" >> "$root/private/logs/deploy.log"
echo "Rollback validé."
