#!/usr/bin/env bash
# Pilotage du staging depuis le poste d'exploitation (docs/DEPLOY.md §17), par SSH vers le serveur.
# Source de vérité de la configuration : deploy/staging.env (600, gitignoré), copié sur le serveur
# en .env.production à chaque déploiement. Aucune valeur secrète n'est affichée.
#
#   scripts/staging.sh deploy [REF]        env poussé, code à REF (défaut origin/main), migrations,
#                                          redémarrage, attente des healthchecks (make deploy-staging)
#   scripts/staging.sh rollback VERSION    api, worker et proxy sur une version déjà construite
#   scripts/staging.sh env-push            copie deploy/staging.env (clés modifiées listées, sans valeur)
#   scripts/staging.sh prod ARGS…          scripts/prod.sh ARGS… sur le serveur
#   scripts/staging.sh glitchtip-setup     projets GlitchTip ; DSN écrits dans deploy/staging.env
#   scripts/staging.sh backup-remote-setup installe deploy/staging.rclone.conf (Google Drive)
#   scripts/staging.sh tunnel              Mailpit (127.0.0.1:18025) et pilotage E2E (127.0.0.1:18097)
#
# Variables : STAGING_SSH (défaut deploy@45.93.21.86), STAGING_DIR (défaut /srv/gostation).
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

HOST="${STAGING_SSH:-deploy@45.93.21.86}"
DIR="${STAGING_DIR:-/srv/gostation}"
ENV_LOCAL="$ROOT_DIR/deploy/staging.env"
# Connexions SSH regroupées dans une connexion maître gardée 10 min : Wayhost ferme le port 22
# quelques minutes à une IP qui ouvre 4 ou 5 connexions en peu de temps (filtrage en amont du
# serveur, ni ufw ni fail2ban), ce que feraient sinon les E2E (un appel par admin de test).
SSH_OPTS=(-o ConnectionAttempts=3 -o ServerAliveInterval=30 -o ControlMaster=auto
  -o "ControlPath=$HOME/.ssh/cm-gostation-%r@%h:%p" -o ControlPersist=600)

remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

env_push() {
  [[ -f "$ENV_LOCAL" ]] || die "$ENV_LOCAL absent : scripts/gen-prod-secrets.sh deploy/staging.env"
  [[ "$(stat -c '%a' "$ENV_LOCAL")" == 600 ]] || die "$ENV_LOCAL doit être en 600"
  scp -q "${SSH_OPTS[@]}" "$ENV_LOCAL" "$HOST:$DIR/.env.production.new"
  remote bash -s -- "$DIR" <<'EOF'
set -Eeuo pipefail
cd "$1"
chmod 600 .env.production.new
keys() { grep -E '^[A-Z_][A-Z0-9_]*=' "$1" | sort; }
if [[ -f .env.production ]]; then
  changed="$(diff <(keys .env.production) <(keys .env.production.new) | sed -nE 's/^[<>] ([A-Z_][A-Z0-9_]*)=.*/\1/p' | sort -u | tr '\n' ' ' || true)"
  cp -p .env.production .env.production.prev
  echo "env : ${changed:-aucune clé modifiée}"
fi
mv .env.production.new .env.production
EOF
}

deploy() {
  local ref="${1:-origin/main}"
  env_push
  log "code : $ref"
  remote bash -s -- "$DIR" "$ref" <<'EOF'
set -Eeuo pipefail
cd "$1"
git fetch --quiet --prune --tags origin
git checkout --quiet --detach "$2"
git log -1 --format='  %h %s'
scripts/prod.sh deploy
EOF
}

glitchtip_setup() {
  local out
  out="$(remote "cd $DIR && scripts/prod.sh glitchtip-setup")"
  python3 - "$ENV_LOCAL" "$out" <<'EOF'
import re, sys
path, out = sys.argv[1], sys.argv[2]
dsn = dict(re.findall(r'^(SENTRY_DSN|VITE_SENTRY_DSN|MOBILE_SENTRY_DSN)=(\S+)$', out, re.M))
missing = {'SENTRY_DSN', 'VITE_SENTRY_DSN', 'MOBILE_SENTRY_DSN'} - dsn.keys()
if missing:
    sys.exit('DSN absents de la sortie de glitchtip-setup : ' + ' '.join(sorted(missing)))
s = open(path).read()
for k, v in dsn.items():
    if re.search(rf'^{k}=', s, re.M):
        s = re.sub(rf'^{k}=.*$', lambda _: f'{k}={v}', s, flags=re.M)
    else:
        s += f'\n# DSN du projet mobile de GlitchTip (variable EAS EXPO_PUBLIC_SENTRY_DSN)\n{k}={v}\n'
open(path, 'w').write(s)
print('DSN écrits dans ' + path + ' : ' + ' '.join(sorted(dsn)))
EOF
}

cmd="${1:-}"
shift || true
case "$cmd" in
  deploy) deploy "$@" ;;
  rollback)
    [[ $# -eq 1 ]] || die "usage : scripts/staging.sh rollback VERSION (scripts/staging.sh prod versions)"
    remote "cd $DIR && scripts/prod.sh rollback $(printf '%q' "$1")"
    ;;
  env-push) env_push ;;
  prod)
    # -t : commandes interactives (admin-create, restore sans --yes).
    if [[ -t 0 ]]; then ssh -t "${SSH_OPTS[@]}" "$HOST" "cd $DIR && scripts/prod.sh $(printf '%q ' "$@")"
    else remote "cd $DIR && scripts/prod.sh $(printf '%q ' "$@")"; fi
    ;;
  glitchtip-setup) glitchtip_setup ;;
  backup-remote-setup)
    [[ -s "$ROOT_DIR/deploy/staging.rclone.conf" ]] || die "deploy/staging.rclone.conf absent : scripts/gdrive-authorize.sh"
    remote "cd $DIR && scripts/prod.sh backup-remote-setup" < "$ROOT_DIR/deploy/staging.rclone.conf"
    ;;
  tunnel)
    log "Mailpit : http://127.0.0.1:18025 · pilotage E2E : http://127.0.0.1:18097 (Ctrl+C pour fermer)"
    ssh "${SSH_OPTS[@]}" -N -L 18025:127.0.0.1:8025 -L 18097:127.0.0.1:8097 "$HOST"
    ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
