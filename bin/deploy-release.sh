#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root_input=${1:?"Usage: deploy-release.sh DEPLOY_PATH SHA [--dry-run]"}
sha=${2:?"SHA manquant"}
mode=${3:---deploy}
[[ "$sha" =~ ^[0-9a-f]{40,64}$ ]] || { echo "SHA invalide." >&2; exit 2; }
[[ "$mode" == "--deploy" || "$mode" == "--dry-run" ]] || { echo "Mode invalide." >&2; exit 2; }
[[ "$root_input" == /* && "$root_input" != "/" ]] || { echo "DEPLOY_PATH doit être un chemin absolu dédié." >&2; exit 2; }
mkdir -p -- "$root_input"
root=$(cd "$root_input" && pwd -P)
[[ "$root" != "/" && "$root" != "/var" && "$root" != "/var/www" ]] || { echo "DEPLOY_PATH trop large." >&2; exit 2; }

incoming="$root/incoming"
archive="$incoming/$sha.tar.gz"
private="$root/private"
lock_dir="$private/locks"
state_dir="$private/state"
log_dir="$private/logs"
mkdir -p -- "$incoming" "$lock_dir" "$state_dir" "$log_dir"
exec 9>"$lock_dir/deploy.lock"
flock -n 9 || { echo "Un déploiement est déjà en cours." >&2; exit 9; }
[[ -f "$archive" ]] || { echo "Archive distante absente." >&2; exit 3; }

safe_extract() {
  local destination=$1 entry normalized
  while IFS= read -r entry; do
    normalized=${entry#./}
    [[ -n "$normalized" ]] || continue
    if [[ "$normalized" == /* || "$normalized" =~ (^|/)\.\.(/|$) ]]; then
      echo "Chemin d’archive interdit." >&2
      return 1
    fi
    if [[ "$normalized" =~ (^|/)(\.git|\.github|docs|tests|node_modules|config|storage)(/|$) || "$normalized" =~ (^|/)\.env($|\.) ]]; then
      echo "Ressource non déployable détectée." >&2
      return 1
    fi
  done < <(tar -tzf "$archive")
  mkdir -p -- "$destination"
  tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$destination"
  [[ -f "$destination/index.html" && -f "$destination/api/v1/index.php" && -f "$destination/bin/migrate.php" ]] || {
    echo "Release incomplète." >&2
    return 1
  }
  php -l "$destination/api/v1/index.php" >/dev/null
  php -l "$destination/bin/migrate.php" >/dev/null
  php -l "$destination/bin/promote-admin.php" >/dev/null
}

if [[ "$mode" == "--dry-run" ]]; then
  recipe_root="$root/recette"
  recipe="$recipe_root/$sha"
  mkdir -p -- "$recipe_root"
  if [[ -e "$recipe" ]]; then
    [[ "$recipe" == "$recipe_root/"* && "$(basename "$recipe")" == "$sha" ]] || exit 4
    rm -rf -- "$recipe"
  fi
  safe_extract "$recipe"
  printf '%s\n' "$sha" > "$state_dir/initial-dry-run.ok"
  printf '%s dry-run %s\n' "$(date -u +%FT%TZ)" "$sha" >> "$log_dir/deploy.log"
  rm -f -- "$archive"
  echo "Dry-run validé dans un répertoire non servi."
  exit 0
fi

[[ -s "$state_dir/initial-dry-run.ok" ]] || { echo "Le dry-run initial est obligatoire." >&2; exit 5; }
deploy_config="$private/config/deploy.env"
app_config="$private/config/fat.env"
db_client_config="$private/config/mariadb-client.cnf"
for config_file in "$deploy_config" "$app_config" "$db_client_config"; do
  [[ -f "$config_file" ]] || { echo "Configuration privée manquante." >&2; exit 6; }
  permissions=$(stat -c '%a' "$config_file")
  [[ "${permissions: -1}" == "0" ]] || { echo "Une configuration privée est lisible par tous." >&2; exit 6; }
done

config_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$deploy_config"
}
db_name=$(config_value DEPLOY_DB_NAME)
health_url=$(config_value DEPLOY_HEALTHCHECK_URL)
keep_releases=$(config_value DEPLOY_KEEP_RELEASES)
[[ "$db_name" =~ ^[A-Za-z0-9_]+$ ]] || { echo "DEPLOY_DB_NAME invalide." >&2; exit 6; }
[[ "$health_url" =~ ^https://[A-Za-z0-9.-]+/api/v1/health$ ]] || { echo "DEPLOY_HEALTHCHECK_URL invalide." >&2; exit 6; }
[[ "$keep_releases" =~ ^[5-9]$|^[1-9][0-9]+$ ]] || keep_releases=5

releases="$root/releases"
release="$releases/$sha"
mkdir -p -- "$releases" "$root/storage" "$private/backups"
if [[ ! -e "$releases/private" ]]; then
  ln -s ../private "$releases/private"
fi
[[ -L "$releases/private" && "$(readlink -f "$releases/private")" == "$private" ]] || { echo "Lien de configuration privée invalide." >&2; exit 6; }

if [[ -e "$release" ]]; then
  [[ -d "$release" && -f "$release/api/v1/index.php" ]] || { echo "Release existante incohérente." >&2; exit 7; }
else
  temporary="$releases/.extract-$sha"
  [[ "$temporary" == "$releases/.extract-$sha" ]] || exit 7
  rm -rf -- "$temporary"
  safe_extract "$temporary"
  ln -s "$root/storage" "$temporary/storage"
  mv -- "$temporary" "$release"
fi

[[ -L "$root/current" ]] || { echo "Le lien current doit être initialisé avant le premier déploiement." >&2; exit 8; }
previous=$(readlink -f "$root/current")
[[ "$previous" == "$releases/"* && -d "$previous" ]] || { echo "La release précédente est invalide." >&2; exit 8; }

dump_tool=$(command -v mariadb-dump || command -v mysqldump || true)
[[ -n "$dump_tool" ]] || { echo "Outil de sauvegarde MariaDB absent." >&2; exit 10; }
backup_tmp="$private/backups/.db-$sha.sql.gz.tmp"
backup="$private/backups/db-$sha.sql.gz"
"$dump_tool" --defaults-extra-file="$db_client_config" --single-transaction --quick --skip-lock-tables --hex-blob "$db_name" | gzip -c > "$backup_tmp"
[[ -s "$backup_tmp" ]] || { rm -f -- "$backup_tmp"; echo "Sauvegarde MariaDB vide." >&2; exit 10; }
mv -- "$backup_tmp" "$backup"

FAT_CONFIG_FILE="$app_config" php "$release/bin/migrate.php"
next="$root/.current-$sha"
rm -f -- "$next"
ln -s "$release" "$next"
mv -Tf -- "$next" "$root/current"

health_ok=false
for attempt in 1 2 3 4 5; do
  response=$(curl --fail --silent --show-error --max-time 10 "$health_url" 2>/dev/null || true)
  if printf '%s' "$response" | php -r '$v=json_decode(stream_get_contents(STDIN),true);exit(($v["status"]??null)==="ok"?0:1);'; then
    health_ok=true
    break
  fi
  sleep 2
done
if [[ "$health_ok" != true ]]; then
  rollback_next="$root/.rollback-$sha"
  rm -f -- "$rollback_next"
  ln -s "$previous" "$rollback_next"
  mv -Tf -- "$rollback_next" "$root/current"
  printf '%s rollback %s -> %s\n' "$(date -u +%FT%TZ)" "$sha" "$(basename "$previous")" >> "$log_dir/deploy.log"
  echo "Health check en échec, release précédente restaurée." >&2
  exit 11
fi

printf '%s deploy %s previous=%s\n' "$(date -u +%FT%TZ)" "$sha" "$(basename "$previous")" >> "$log_dir/deploy.log"
rm -f -- "$archive"

current=$(readlink -f "$root/current")
count=0
while IFS=' ' read -r _ candidate; do
  [[ -n "$candidate" ]] || continue
  name=$(basename "$candidate")
  [[ "$candidate" == "$releases/"* && "$name" =~ ^[0-9a-f]{40,64}$ ]] || continue
  count=$((count + 1))
  if (( count > keep_releases )) && [[ "$candidate" != "$current" && "$candidate" != "$previous" ]]; then
    rm -rf -- "$candidate"
  fi
done < <(find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn)

echo "Release activée et health check validé."
