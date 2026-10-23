#!/usr/bin/env bash
# Cohérence DNS d'un domaine (docs/DEPLOY.md §17) : serveurs délégués par le registre et serveurs
# annoncés par la zone elle-même. Chaque serveur doit répondre, servir le même numéro de série et
# donner l'adresse attendue pour chaque nom. Un serveur périmé suffit à rendre un nom introuvable
# pour les résolveurs qui l'interrogent (2026-10-22 : ns1.netim.net servait une ancienne zone sans
# api, admin ni errors ; le suivi des plantages de l'app ne partait plus).
#
#   scripts/check-dns.sh                        gostation.bj, IP du staging
#   DOMAIN=… EXPECTED_A=… EXPECTED_AAAA=… NAMES="@ api" scripts/check-dns.sh
#
# Sortie 1 au premier écart ; le rapport liste tous les écarts. Nécessite dig.
set -uo pipefail

DOMAIN="${DOMAIN:-gostation.bj}"
EXPECTED_A="${EXPECTED_A:-45.93.21.86}"
EXPECTED_AAAA="${EXPECTED_AAAA:-2a12:a080:1:1::10b2}"
NAMES="${NAMES:-@ www api admin errors}"
problems=()
problem() { problems+=("$*"); }

# Réponses seules (dig écrit ses erreurs de délai sur la sortie standard, préfixées par « ; »).
q() { dig +time=4 +tries=3 +norecurse +short "$@" 2> /dev/null | grep -v '^;' | grep -v '^$' || true; }

tld="${DOMAIN#*.}"
delegated=""
for tld_ns in $(dig +short NS "$tld." | sort -R); do
  delegated="$(dig +time=4 +tries=2 +norecurse NS "$DOMAIN" @"$tld_ns" +noall +authority 2> /dev/null | awk '$4 == "NS" {print tolower($5)}' | sort -u)"
  [[ -n "$delegated" ]] && break
done
[[ -n "$delegated" ]] || { echo "✗ délégation de $DOMAIN introuvable auprès des serveurs du .$tld"; exit 1; }

# Serveurs annoncés par la zone (sur chaque serveur délégué) : un résolveur peut les utiliser aussi.
servers="$delegated"
for ns in $delegated; do
  servers+=$'\n'"$(q NS "$DOMAIN" @"$ns" | grep -E '^[A-Za-z0-9.-]+\.$' | tr 'A-Z' 'a-z')"
done
servers="$(printf '%s\n' "$servers" | grep -v '^$' | sort -u)"
echo "délégation (.$tld) : $(echo "$delegated" | tr '\n' ' ')"
echo "serveurs vérifiés  : $(echo "$servers" | tr '\n' ' ')"

for ns in $servers; do
  [[ -n "$(echo "$delegated" | grep -Fx "$ns")" ]] || problem "$ns annoncé par la zone mais absent de la délégation du .$tld"
done

serials=""
for ns in $servers; do
  serial="$(q SOA "$DOMAIN" @"$ns" | awk 'NF == 7 {print $3}' | head -n1)"
  if [[ -z "$serial" ]]; then
    problem "$ns ne répond pas (SOA)"
    continue
  fi
  serials+="$serial"$'\n'
  for name in $NAMES; do
    fqdn="$DOMAIN"
    [[ "$name" == "@" ]] || fqdn="$name.$DOMAIN"
    a="$(q A "$fqdn" @"$ns" | grep -E '^[0-9.]+$' | sort | tr '\n' ' ' | sed 's/ $//')"
    [[ "$a" == "$EXPECTED_A" ]] || problem "$ns : $fqdn A = « ${a:-aucune réponse} », attendu $EXPECTED_A"
    if [[ -n "$EXPECTED_AAAA" ]]; then
      aaaa="$(q AAAA "$fqdn" @"$ns" | grep -E '^[0-9a-f:]+$' | sort | tr '\n' ' ' | sed 's/ $//')"
      [[ "$aaaa" == "$EXPECTED_AAAA" ]] || problem "$ns : $fqdn AAAA = « ${aaaa:-aucune réponse} », attendu $EXPECTED_AAAA"
    fi
  done
done
# Messagerie : un seul enregistrement SPF à l'apex (deux SPF = « permerror » chez les destinataires,
# les emails de Brevo partiraient en indésirables), qui autorise Brevo (envoi). Si le domaine reçoit
# du courrier par Cloudflare Email Routing (contact@ → boîte personnelle, DEPLOY.md §17), ce même
# SPF autorise aussi Cloudflare et les trois MX sont présents.
for ns in $servers; do
  spf="$(q TXT "$DOMAIN" @"$ns" | tr -d '"' | grep -i 'v=spf1' || true)"
  count="$(printf '%s' "$spf" | grep -ci 'v=spf1' || true)"
  [[ "$count" -eq 1 ]] || problem "$ns : $count enregistrement(s) SPF sur $DOMAIN (un seul attendu, fusionné)"
  [[ "$spf" == *"include:${MAIL_SPF_SENDER:-spf.brevo.com}"* ]] || problem "$ns : le SPF n'autorise pas ${MAIL_SPF_SENDER:-spf.brevo.com} (envoi des emails)"
  mx="$(q MX "$DOMAIN" @"$ns")"
  if grep -qi 'mx.cloudflare.net' <<< "$mx"; then
    [[ "$spf" == *"include:_spf.mx.cloudflare.net"* ]] || problem "$ns : MX Cloudflare mais SPF sans include:_spf.mx.cloudflare.net"
    [[ "$(grep -ciE 'route[123]\.mx\.cloudflare\.net' <<< "$mx")" -eq 3 ]] || problem "$ns : MX Cloudflare incomplets (route1, route2 et route3 attendus)"
  fi
done

distinct="$(printf '%s' "$serials" | sort -u | grep -c . || true)"
[[ "$distinct" -le 1 ]] || problem "numéros de série différents selon les serveurs : $(printf '%s' "$serials" | sort -u | tr '\n' ' ')"

if [[ ${#problems[@]} -gt 0 ]]; then
  printf '✗ %s\n' "${problems[@]}"
  exit 1
fi
echo "✔ $DOMAIN cohérent sur $(echo "$servers" | wc -l) serveurs ($NAMES ; SPF unique)"
