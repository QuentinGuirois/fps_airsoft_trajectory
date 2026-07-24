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

php_bin=$(command -v php || true)
if [[ -z "$php_bin" && -x /opt/plesk/php/8.3/bin/php ]]; then
  php_bin=/opt/plesk/php/8.3/bin/php
fi
[[ -n "$php_bin" && -x "$php_bin" ]] || { echo "PHP CLI 8.3 est introuvable." >&2; exit 2; }

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
  # Plesk sert le document root via Apache avant PHP-FPM : les répertoires
  # et fichiers publics doivent donc rester traversables/lisibles. Les secrets,
  # uploads et sauvegardes vivent hors de la release sous private/ (umask 077).
  find "$destination" -type d -exec chmod 755 {} +
  find "$destination" -type f -exec chmod 644 {} +
  [[ -f "$destination/index.html" && -f "$destination/api/v1/index.php" && -f "$destination/bin/migrate.php" \
    && -f "$destination/bin/publish-radar-import-production.php" \
    && -f "$destination/database/seeds/fat-radar-events-enriched-2026-07-24.json.php" ]] || {
    echo "Release incomplète." >&2
    return 1
  }
  "$php_bin" -l "$destination/api/v1/index.php" >/dev/null
  "$php_bin" -l "$destination/bin/migrate.php" >/dev/null
  "$php_bin" -l "$destination/bin/promote-admin.php" >/dev/null
  "$php_bin" -l "$destination/bin/publish-radar-import-production.php" >/dev/null
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

FAT_CONFIG_FILE="$app_config" "$php_bin" "$release/bin/migrate.php"
radar_seed="$release/database/seeds/fat-radar-events-enriched-2026-07-24.json.php"
radar_seed_sha=a1d2d8773e032fca8c3b55506229bcdc9f53484136be44d1bb4951d1e76c52d7
radar_marker="$state_dir/radar-import-$radar_seed_sha.ok"
radar_import_pending=false
radar_owner=
if [[ ! -f "$radar_marker" ]]; then
  FAT_CONFIG_FILE="$app_config" "$php_bin" "$release/bin/publish-radar-import-production.php" \
    "$radar_seed" --preflight "--confirm-sha256=$radar_seed_sha"
  radar_owner=$(
    FAT_CONFIG_FILE="$app_config" "$php_bin" -r '
      require $argv[1] . "/api/src/autoload.php";
      $config = Fat\Api\Config::load($argv[1]);
      if (!$config->isProduction()) {
          fwrite(STDERR, "Import Radar réservé à la production.\n");
          exit(3);
      }
      $db = Fat\Api\Database::connect($config);
      $owner = $db->query(
          "SELECT email FROM users WHERE role=\"admin\" AND email_verified_at IS NOT NULL "
          . "AND deletion_requested_at IS NULL ORDER BY created_at,id LIMIT 1"
      )->fetchColumn();
      if (!is_string($owner) || trim($owner) === "") {
          fwrite(STDERR, "Le lot Radar exige un administrateur actif et vérifié.\n");
          exit(3);
      }
      echo $owner;
    ' "$release"
  )
  [[ -n "$radar_owner" ]] || { echo "Propriétaire Radar introuvable." >&2; exit 12; }
  radar_import_pending=true
fi
next="$root/.current-$sha"
rm -f -- "$next"
ln -s "$release" "$next"
mv -Tf -- "$next" "$root/current"

health_ok=false
for attempt in 1 2 3 4 5; do
  response=$(curl --fail --silent --show-error --max-time 10 "$health_url" 2>/dev/null || true)
  if printf '%s' "$response" | "$php_bin" -r '$v=json_decode(stream_get_contents(STDIN),true);exit(($v["status"]??null)==="ok"?0:1);'; then
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

if [[ "$radar_import_pending" == true ]]; then
  if ! FAT_CONFIG_FILE="$app_config" FAT_RADAR_SEED_OWNER_EMAIL="$radar_owner" \
    "$php_bin" "$release/bin/import-radar-events.php" \
      "$radar_seed" \
      --owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL \
      --preview=admin \
      --geocode; then
    rollback_next="$root/.rollback-radar-$sha"
    rm -f -- "$rollback_next"
    ln -s "$previous" "$rollback_next"
    mv -Tf -- "$rollback_next" "$root/current"
    printf '%s rollback-radar-import %s -> %s\n' "$(date -u +%FT%TZ)" "$sha" "$(basename "$previous")" >> "$log_dir/deploy.log"
    echo "Import Radar en échec, release précédente restaurée et aucune fiche publiée." >&2
    exit 12
  fi
  if ! FAT_CONFIG_FILE="$app_config" "$php_bin" "$release/bin/publish-radar-import-production.php" \
    "$radar_seed" --apply "--confirm-sha256=$radar_seed_sha"; then
    rollback_next="$root/.rollback-radar-$sha"
    rm -f -- "$rollback_next"
    ln -s "$previous" "$rollback_next"
    mv -Tf -- "$rollback_next" "$root/current"
    printf '%s rollback-radar-publish %s -> %s\n' "$(date -u +%FT%TZ)" "$sha" "$(basename "$previous")" >> "$log_dir/deploy.log"
    echo "Publication Radar en échec, release précédente restaurée." >&2
    exit 13
  fi
  marker_tmp="$radar_marker.tmp"
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$sha" "$radar_seed_sha" > "$marker_tmp"
  mv -- "$marker_tmp" "$radar_marker"
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
