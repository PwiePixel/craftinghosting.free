#!/usr/bin/env bash
# =============================================================================
#  CraftingHosting.free – Installer (ohne Docker)
#
#  Für einen frischen Server mit Debian 12/13 oder Ubuntu 22.04/24.04 (als root):
#
#      git clone https://github.com/PwiePixel/craftinghosting.free.git
#      cd craftinghosting.free && sudo bash install.sh
#
#  Abgefragt werden nur: Domain der Website, Adresse des Pterodactyl-Panels,
#  die zwei API-Keys (ptla_… / ptlc_…), Admin-E-Mail und optional SMTP.
#  Alles andere (Node.js, Caddy/HTTPS, Datenbank-Schlüssel, Dienste) richtet
#  das Skript selbst ein.  Hilfe:  bash install.sh --help
# =============================================================================
set -euo pipefail

# ------------------------------------------------------------ Einstellungen ---
INSTALL_DIR="${CHF_INSTALL_DIR:-/opt/craftinghosting-free}"
DATA_DIR="${CHF_DATA_DIR:-/var/lib/chfree}"
BACKUP_DIR="${CHF_BACKUP_DIR:-/var/backups/chfree}"
CACHE_DIR="${CHF_CACHE_DIR:-/var/cache/chfree}"
LOG_FILE="${CHF_LOG_FILE:-/var/log/chfree-install.log}"
SERVICE_USER="${CHF_USER:-chfree}"
REPO_URL="${CHF_REPO_URL:-https://github.com/PwiePixel/craftinghosting.free.git}"
REPO_BRANCH="${CHF_BRANCH:-main}"
PROXY="${CHF_PROXY:-caddy}"            # caddy | none
DRY_RUN="${CHF_DRY_RUN:-0}"
UNIT_DIR="${CHF_UNIT_DIR:-/etc/systemd/system}"
CADDY_DIR="${CHF_CADDY_DIR:-/etc/caddy}"
WRAPPER_PATH="${CHF_WRAPPER_PATH:-/usr/local/bin/chfree}"
BACKUP_KEEP="${CHF_BACKUP_KEEP:-14}"

DEFAULT_INSTALL_DIR="/opt/craftinghosting-free"
DEFAULT_DATA_DIR="/var/lib/chfree"
PACKAGE_NAME="craftinghosting-free"
SERVICES=(chfree-api chfree-worker chfree-web)
API_PORT=4000
WEB_PORT=3000
NODE_MAJOR=22
CADDY_MARKER="# chfree: Seiten von CraftingHosting.free (von install.sh verwaltet)"
CADDY_IMPORT="import ${CADDY_DIR}/sites/*.caddy"

MODE="install"
ASSUME_YES=0
PURGE=0
NO_PULL=0
INTERACTIVE=0
EXTRA_ARGS=()
TMP_DIR=""
ENV_FILE=""
NODE_BIN="/usr/bin/node"
SCRIPT_DIR=""
STEP_NO=0

# Ergebnisse der Fragen
CFG_DOMAIN="" CFG_PANEL_URL="" CFG_APP_KEY="" CFG_CLIENT_KEY="" CFG_PTERO_MODE="mock"
CFG_ADMIN_EMAILS="" CFG_SMTP_HOST="" CFG_SMTP_PORT="587" CFG_SMTP_USER="" CFG_SMTP_PASS=""
CFG_MAIL_FROM="" CFG_ACME_EMAIL="" CFG_WWW="no" CFG_ADMIN_PATH="" CFG_DB_KEY=""

# ------------------------------------------------------------------ Ausgabe ---
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_RED=$'\033[31m' C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m' C_CYAN=$'\033[36m' C_DIM=$'\033[2m'
else
  C_RESET="" C_BOLD="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_CYAN="" C_DIM=""
fi

logf() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE" 2>/dev/null || true; }
step() { STEP_NO=$((STEP_NO + 1)); printf '\n%s==> [%d] %s%s\n' "${C_BOLD}${C_BLUE}" "$STEP_NO" "$*" "$C_RESET"; logf "==> [$STEP_NO] $*"; }
info() { printf '    %s\n' "$*"; logf "    $*"; }
ok()   { printf '    %s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; logf "  ✔ $*"; }
warn() { printf '    %s⚠ %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; logf "  ⚠ $*"; }
err()  { printf '    %s✖ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; logf "  ✖ $*"; }
die()  { err "$*"; exit 1; }
is_dry() { [ "$DRY_RUN" = "1" ]; }

# Befehl ausführen: Ausgabe ins Log, bei Fehler die letzten Zeilen zeigen und abbrechen.
run() {
  if is_dry; then printf '    %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"; logf "[dry-run] $*"; return 0; fi
  logf "\$ $*"
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    err "Befehl fehlgeschlagen: $*"
    printf '%s--- letzte Zeilen aus %s ---%s\n' "$C_DIM" "$LOG_FILE" "$C_RESET" >&2
    tail -n 30 "$LOG_FILE" >&2 2>/dev/null || true
    exit 1
  fi
}
# Wie run, bricht aber nicht ab (Rückgabewert des Befehls).
try() {
  if is_dry; then printf '    %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"; logf "[dry-run] $*"; return 0; fi
  logf "\$ $*"
  "$@" >>"$LOG_FILE" 2>&1
}
# Befehl als Dienst-Benutzer in einem Ordner ausführen (npm, node, git).
as_app_in() {
  local dir=$1; shift
  run runuser -u "$SERVICE_USER" -- env "HOME=$CACHE_DIR" "npm_config_cache=$CACHE_DIR/npm" \
    npm_config_update_notifier=false NEXT_TELEMETRY_DISABLED=1 \
    bash -c 'cd "$1" && shift && exec "$@"' _ "$dir" "$@"
}

on_error() {
  local code=$? line=$1
  err "Abbruch in Zeile ${line} (Exit-Code ${code}). Details: ${LOG_FILE}"
  exit "$code"
}
cleanup() { [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"; return 0; }

usage() {
  cat <<EOF
${C_BOLD}CraftingHosting.free – Installer${C_RESET}

Aufruf:  bash install.sh [MODUS] [OPTIONEN]

Modi:
  install        Installieren (Standard). Kann gefahrlos erneut ausgeführt werden.
  update         Aktualisieren: git pull → npm ci → Build → Migration → Dienste neu starten (.env bleibt)
  reconfigure    Fragen erneut stellen, .env neu schreiben (Secrets bleiben), neu bauen
  status         Zustand der Dienste, Health-Check, Datenbank, letztes Backup
  backup         Datenbank + .env als tar.gz nach ${BACKUP_DIR} sichern
  logs [dienst]  Logs live anzeigen (api | worker | web – ohne Angabe: alle)
  cli <befehl>   API-CLI ausführen, z. B.  cli mail-test du@example.com  ·  cli make-admin du@example.com
  uninstall      Dienste und Caddy-Seite entfernen (Daten und .env bleiben – Löschen nur mit --purge + Bestätigung)

Optionen:
  -y, --yes      Keine Rückfragen – Werte kommen aus CHF_*-Variablen bzw. der vorhandenen .env
  --no-caddy     Caddy nicht installieren/konfigurieren (eigener Reverse Proxy, siehe deploy/nginx.example.conf)
  --no-pull      Bei "update" kein git pull (Dateien wurden von Hand aktualisiert)
  --dry-run      Nur anzeigen, was am System geändert würde (wie CHF_DRY_RUN=1)
  --purge        Nur mit "uninstall": nach zusätzlicher Bestätigung auch Daten, .env und Programmordner löschen
  -h, --help     Diese Hilfe

Variablen für die Installation ohne Rückfragen:
  CHF_DOMAIN            Domain der Website (Standard: craftinghosting.free)
  CHF_PANEL_URL         Adresse des Pterodactyl-Panels, z. B. https://panel.example.com
  CHF_PTERO_APP_KEY     Application-API-Key (ptla_…)
  CHF_PTERO_CLIENT_KEY  Client-API-Key eines Admin-Kontos (ptlc_…)
  CHF_ADMIN_EMAIL       E-Mail-Adresse(n) für den Admin-Bereich (kommagetrennt)
  CHF_SMTP_HOST, CHF_SMTP_PORT, CHF_SMTP_USER, CHF_SMTP_PASS, CHF_MAIL_FROM   Mailversand (optional)
  CHF_ACME_EMAIL        E-Mail für Let's Encrypt (Standard: erste Admin-E-Mail)
  CHF_WWW               yes | no | auto – auch www.<domain> bedienen (auto: nur bei Hauptdomains)
  CHF_PROXY             caddy (Standard) | none
  CHF_SKIP_PANEL_CHECK  1 = Verbindung zum Panel nicht prüfen
  CHF_PTERO_LOCATION_IDS  optionale Fallback-Locations (normalerweise leer – Zuordnung im Admin-Bereich)
  CHF_REPO_URL, CHF_BRANCH   Quelle, falls das Skript nicht aus einem Checkout gestartet wird
  CHF_INSTALL_DIR (${DEFAULT_INSTALL_DIR}), CHF_DATA_DIR (${DEFAULT_DATA_DIR}), CHF_DRY_RUN=1

Ohne beide API-Keys wird der Testmodus eingerichtet (PTERODACTYL_MODE=mock – es entstehen keine echten Server).
EOF
}

# ---------------------------------------------------------------- Argumente ---
parse_args() {
  local mode_set=0
  while [ $# -gt 0 ]; do
    case "$1" in
      install | update | reconfigure | status | uninstall | backup | logs | cli | help)
        if [ "$mode_set" -eq 0 ]; then MODE=$1; mode_set=1; else EXTRA_ARGS+=("$1"); fi ;;
      -y | --yes) ASSUME_YES=1 ;;
      --no-caddy) PROXY="none" ;;
      --no-pull) NO_PULL=1 ;;
      --dry-run) DRY_RUN=1 ;;
      --purge) PURGE=1 ;;
      -h | --help) MODE="help" ;;
      --)
        shift
        EXTRA_ARGS+=("$@")
        break ;;
      -*)
        if [ "$MODE" = "cli" ] || [ "$MODE" = "logs" ]; then EXTRA_ARGS+=("$1"); else
          err "Unbekannte Option: $1"
          usage
          exit 2
        fi ;;
      *)
        if [ "$mode_set" -eq 1 ] && { [ "$MODE" = "cli" ] || [ "$MODE" = "logs" ]; }; then EXTRA_ARGS+=("$1"); else
          err "Unbekannter Modus: $1"
          usage
          exit 2
        fi ;;
    esac
    shift
  done
  case "$PROXY" in caddy | none) ;; *) die "CHF_PROXY muss 'caddy' oder 'none' sein (ist: $PROXY)" ;; esac
}

# --------------------------------------------------------------- Vorprüfung ---
init_runtime() {
  local src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ]; then SCRIPT_DIR="$(cd "$(dirname "$src")" && pwd -P)"; fi

  if ! is_dry && [ "$(id -u)" -ne 0 ]; then
    printf '%s✖ Bitte als root ausführen:  sudo bash install.sh%s\n' "$C_RED" "$C_RESET" >&2
    exit 1
  fi
  if ! { mkdir -p "$(dirname "$LOG_FILE")" && touch "$LOG_FILE" && chmod 600 "$LOG_FILE"; } 2>/dev/null; then
    LOG_FILE="/dev/null"
  fi
  TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT
  trap 'on_error $LINENO' ERR

  # .env: im Dry-Run ohne eigenes CHF_INSTALL_DIR wird nichts unter /opt angefasst
  if is_dry && [ -z "${CHF_INSTALL_DIR:-}" ]; then
    ENV_FILE="${CHF_ENV_FILE:-$TMP_DIR/dry-run.env}"
    if [ -f "$INSTALL_DIR/.env" ] && [ -r "$INSTALL_DIR/.env" ]; then cp "$INSTALL_DIR/.env" "$ENV_FILE"; fi
  else
    ENV_FILE="${CHF_ENV_FILE:-$INSTALL_DIR/.env}"
  fi

  if [ "$ASSUME_YES" -eq 0 ]; then
    if [ -t 0 ]; then
      exec 3<&0
      INTERACTIVE=1
    elif [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then
      exec 3</dev/tty
      INTERACTIVE=1
    fi
  fi
  logf "===== install.sh $MODE (dry-run=$DRY_RUN, interaktiv=$INTERACTIVE) ====="
}

detect_os() {
  step "System prüfen"
  [ -r /etc/os-release ] || die "/etc/os-release fehlt – unterstützt werden Debian 12/13 und Ubuntu 22.04/24.04."
  local id="" like="" version="" pretty=""
  # shellcheck disable=SC1091
  id="$(. /etc/os-release && printf '%s' "${ID:-}")"
  # shellcheck disable=SC1091
  like="$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")"
  # shellcheck disable=SC1091
  version="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  # shellcheck disable=SC1091
  pretty="$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-$id}")"
  if ! command -v apt-get >/dev/null 2>&1; then
    die "Dieses System ($pretty) nutzt kein apt. Unterstützt werden Debian 12/13 und Ubuntu 22.04/24.04 – alternativ Docker (siehe README)."
  fi
  case "$id" in
    debian)
      case "${version%%.*}" in 12 | 13 | "") ;; *) warn "Getestet mit Debian 12/13 – gefunden: $pretty. Es wird trotzdem versucht." ;; esac ;;
    ubuntu)
      case "$version" in 22.04 | 24.04) ;; *) warn "Getestet mit Ubuntu 22.04/24.04 – gefunden: $pretty. Es wird trotzdem versucht." ;; esac ;;
    *)
      case " $like " in
        *" debian "* | *" ubuntu "*) warn "Nicht getestetes Debian-Derivat: $pretty. Es wird trotzdem versucht." ;;
        *) die "Nicht unterstütztes System: $pretty. Unterstützt werden Debian 12/13 und Ubuntu 22.04/24.04." ;;
      esac ;;
  esac
  case "$(uname -m)" in
    x86_64 | aarch64 | arm64) ;;
    *) warn "Architektur $(uname -m) ist nicht getestet (Datenbank-Modul libsql liefert Binärdateien für x86_64 und arm64)." ;;
  esac
  if ! is_dry && ! command -v systemctl >/dev/null 2>&1; then die "systemd fehlt – die Dienste werden als systemd-Units eingerichtet."; fi
  ok "$pretty ($(uname -m))"
}

# ---------------------------------------------------------- .env-Werkzeuge ---
# Wert so schreiben, dass systemd (EnvironmentFile), dotenv und Docker ihn gleich lesen.
env_quote() {
  local v=$1
  case "$v" in *$'\n'* | *$'\r'*) return 1 ;; esac
  if [[ "$v" =~ ^[A-Za-z0-9_@%+=:,./-]*$ ]]; then
    printf '%s' "$v"
  elif [[ "$v" != *"'"* && "$v" != *\\ ]]; then
    printf "'%s'" "$v"
  elif [[ "$v" != *'"'* && "$v" != *\\* && "$v" != *'$'* && "$v" != *'`'* ]]; then
    printf '"%s"' "$v"
  else
    return 1
  fi
}

# set_env KEY VALUE – ersetzt die Zeile oder hängt sie an; alle anderen Zeilen bleiben unverändert.
set_env() {
  local key=$1 value=$2 quoted tmp
  quoted="$(env_quote "$value")" || die "Der Wert für $key enthält eine nicht unterstützte Zeichenkombination (' zusammen mit \" \\ \$ oder \`, oder einen Zeilenumbruch)."
  [ -f "$ENV_FILE" ] || { (umask 077 && : >"$ENV_FILE"); }
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  CHF_K="$key" CHF_L="${key}=${quoted}" awk '
    BEGIN { k = ENVIRON["CHF_K"]; l = ENVIRON["CHF_L"]; done = 0 }
    {
      s = $0; sub(/^[ \t]*(export[ \t]+)?/, "", s)
      i = index(s, "="); name = (i > 0) ? substr(s, 1, i - 1) : ""; gsub(/[ \t]+$/, "", name)
      if (name == k) { if (!done) { print l; done = 1 }; next }
      print
    }
    END { if (!done) print l }
  ' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# unset_env KEY – Zeile entfernen (leere URL-Werte würden die Prüfung der API verletzen).
unset_env() {
  local key=$1 tmp
  [ -f "$ENV_FILE" ] || return 0
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  CHF_K="$key" awk '
    BEGIN { k = ENVIRON["CHF_K"] }
    {
      s = $0; sub(/^[ \t]*(export[ \t]+)?/, "", s)
      i = index(s, "="); name = (i > 0) ? substr(s, 1, i - 1) : ""; gsub(/[ \t]+$/, "", name)
      if (name == k) next
      print
    }
  ' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# get_env KEY [DATEI] – Wert ohne Anführungszeichen (leer, wenn nicht vorhanden).
get_env() {
  local key=$1 file=${2:-$ENV_FILE} val
  [ -f "$file" ] || return 0
  val="$(CHF_K="$key" awk '
    BEGIN { k = ENVIRON["CHF_K"]; v = "" }
    {
      s = $0; sub(/^[ \t]*(export[ \t]+)?/, "", s)
      i = index(s, "="); name = (i > 0) ? substr(s, 1, i - 1) : ""; gsub(/[ \t]+$/, "", name)
      if (name == k) v = substr(s, i + 1)
    }
    END { print v }
  ' "$file")"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  if [ "${#val}" -ge 2 ] && [[ "$val" == \'*\' || "$val" == \"*\" ]]; then
    val="${val:1:${#val}-2}"
  else
    val="${val%%[[:space:]]#*}"
  fi
  printf '%s' "$val"
}

# -------------------------------------------------------------------- Fragen ---
ask() { # ask VARIABLE "Frage" "Standard" [secret]
  local __var=$1 prompt=$2 def=${3:-} secret=${4:-} reply=""
  if [ "$INTERACTIVE" -eq 0 ]; then
    printf -v "$__var" '%s' "$def"
    return 0
  fi
  if [ -n "$secret" ]; then
    if [ -n "$def" ]; then
      printf '  %s%s%s %s[Enter = vorhandenen Wert behalten, - = leeren]%s: ' "$C_CYAN" "$prompt" "$C_RESET" "$C_DIM" "$C_RESET"
    else
      printf '  %s%s%s %s(Eingabe wird nicht angezeigt)%s: ' "$C_CYAN" "$prompt" "$C_RESET" "$C_DIM" "$C_RESET"
    fi
    IFS= read -rs -u 3 reply || true
    printf '\n'
  else
    if [ -n "$def" ]; then
      printf '  %s%s%s [%s]: ' "$C_CYAN" "$prompt" "$C_RESET" "$def"
    else
      printf '  %s%s%s: ' "$C_CYAN" "$prompt" "$C_RESET"
    fi
    IFS= read -r -u 3 reply || true
  fi
  reply="${reply#"${reply%%[![:space:]]*}"}"
  reply="${reply%"${reply##*[![:space:]]}"}"
  if [ "$reply" = "-" ]; then reply=""; elif [ -z "$reply" ]; then reply="$def"; fi
  printf -v "$__var" '%s' "$reply"
}

confirm() { # confirm "Frage" [j|n]  → 0 = ja
  local prompt=$1 def=${2:-j} reply="" hint="[J/n]"
  [ "$def" = "n" ] && hint="[j/N]"
  if [ "$INTERACTIVE" -eq 0 ]; then [ "$def" = "j" ]; return; fi
  printf '  %s%s%s %s ' "$C_CYAN" "$prompt" "$C_RESET" "$hint"
  IFS= read -r -u 3 reply || true
  reply="${reply:-$def}"
  case "$reply" in j | J | ja | Ja | JA | y | Y | yes) return 0 ;; *) return 1 ;; esac
}

# Normalisieren + prüfen. Ergebnis in NORM, Fehlermeldung in NORM_ERR.
NORM="" NORM_ERR=""
norm_domain() {
  local d
  d="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  d="${d#http://}"; d="${d#https://}"; d="${d%%/*}"; d="${d#www.}"
  NORM="$d"
  if [[ "$d" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$ ]]; then return 0; fi
  NORM_ERR="Das ist keine gültige Domain (Beispiel: craftinghosting.free – ohne https:// und ohne Pfad)."
  return 1
}
norm_panel_url() {
  local u=$1
  if [ -z "$u" ]; then NORM=""; return 0; fi
  case "$u" in http://* | https://*) ;; *) u="https://$u" ;; esac
  while [ "${u%/}" != "$u" ]; do u="${u%/}"; done
  NORM="$u"
  if [[ "$u" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$ ]]; then return 0; fi
  NORM_ERR="Das ist keine gültige Adresse (Beispiel: panel.example.com oder https://panel.example.com)."
  return 1
}
norm_app_key() {
  NORM="$1"
  if [ -z "$1" ] || [[ "$1" =~ ^ptla_[A-Za-z0-9]{8,}$ ]]; then return 0; fi
  NORM_ERR="Der Application-API-Key beginnt mit ptla_ (Panel → Admin → Application API)."
  return 1
}
norm_client_key() {
  NORM="$1"
  if [ -z "$1" ] || [[ "$1" =~ ^ptlc_[A-Za-z0-9]{8,}$ ]]; then return 0; fi
  NORM_ERR="Der Client-API-Key beginnt mit ptlc_ (als Admin im Panel: Konto → API Credentials)."
  return 1
}
norm_emails() { # eine oder mehrere Adressen, kommagetrennt; leer erlaubt
  local list part out=""
  list="$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  NORM="$list"
  [ -z "$list" ] && return 0
  local IFS=','
  for part in $list; do
    [ -z "$part" ] && continue
    if ! [[ "$part" =~ ^[^@,]+@[^@,]+\.[^@,.]+$ ]]; then
      NORM_ERR="Keine gültige E-Mail-Adresse: $part"
      return 1
    fi
    out="${out:+$out,}$part"
  done
  NORM="$out"
  return 0
}
norm_host() {
  NORM="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  if [ -z "$NORM" ] || [[ "$NORM" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then return 0; fi
  NORM_ERR="Das ist kein gültiger Hostname (Beispiel: mail.example.com)."
  return 1
}
norm_port() {
  NORM="$1"
  if [[ "$1" =~ ^[0-9]{1,5}$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; then return 0; fi
  NORM_ERR="Der Port muss eine Zahl zwischen 1 und 65535 sein (üblich: 587 oder 465)."
  return 1
}
norm_any() { NORM="$1"; return 0; }

ask_valid() { # ask_valid VARIABLE "Frage" "Standard" prüf_funktion [secret]
  local __v=$1 prompt=$2 def=$3 fn=$4 secret=${5:-} answer=""
  while true; do
    ask answer "$prompt" "$def" "$secret"
    if "$fn" "$answer"; then
      printf -v "$__v" '%s' "$NORM"
      return 0
    fi
    if [ "$INTERACTIVE" -eq 0 ]; then die "$prompt: $NORM_ERR"; fi
    warn "$NORM_ERR"
    # Ungültigen vorhandenen Wert nicht erneut als Standard anbieten
    [ "$answer" = "$def" ] && def=""
  done
}

# ----------------------------------------------------- Pterodactyl-Prüfung ---
HTTP_CODE="000"
panel_get() { # panel_get URL KEY → HTTP_CODE, Antwort in $TMP_DIR/panel-body
  local url=$1 key=$2 hdr="$TMP_DIR/panel-headers"
  (umask 077 && printf 'Authorization: Bearer %s\nAccept: application/json\n' "$key" >"$hdr")
  HTTP_CODE="$(curl -sS -o "$TMP_DIR/panel-body" -w '%{http_code}' --max-time 20 -H "@$hdr" "$url" 2>>"$LOG_FILE")" || HTTP_CODE="000"
  rm -f "$hdr"
}
panel_hint() { # panel_hint HTTP_CODE "welcher Key"
  local code=$1 what=$2
  if [ -s "$TMP_DIR/panel-body" ] && grep -qiE 'cloudflare|just a moment|attention required|cf-ray' "$TMP_DIR/panel-body" 2>/dev/null; then
    info "→ Die Antwort stammt von Cloudflare: Das Panel blockt diesen Server. In Cloudflare die IP dieses Servers"
    info "  erlauben (WAF → Tools/IP Access Rules) oder „Bot Fight Mode“ für das Panel abschalten."
    return 0
  fi
  case "$code" in
    000) info "→ Panel nicht erreichbar: Adresse/DNS prüfen, Firewall des Panels, gültiges HTTPS-Zertifikat. Test: curl -I $CFG_PANEL_URL" ;;
    401) info "→ $what wird abgelehnt: falsch kopiert, gelöscht oder der falsche Typ (ptla_ = Application, ptlc_ = Client)." ;;
    403) info "→ $what hat nicht genug Rechte (Application-Key: Users R/W, Servers R/W, Nests/Nodes/Locations/Allocations R)"
         info "  oder die IP dieses Servers ist beim Key nicht erlaubt („Allowed IPs“)." ;;
    404) info "→ Unter dieser Adresse antwortet keine Pterodactyl-API – ist die Panel-Adresse richtig (ohne /admin)?" ;;
    429) info "→ Zu viele Anfragen – kurz warten und erneut prüfen." ;;
    5*) info "→ Das Panel meldet einen Serverfehler ($code) – Panel-Logs prüfen." ;;
    *) info "→ Unerwartete Antwort ($code) – steht ein Proxy/Login vor dem Panel?" ;;
  esac
}
verify_panel() { # 0 = beide Keys funktionieren
  local good=0 total=""
  info "Prüfe Verbindung zu $CFG_PANEL_URL …"
  panel_get "$CFG_PANEL_URL/api/application/nodes?per_page=1" "$CFG_APP_KEY"
  if [ "$HTTP_CODE" = "200" ]; then
    total="$(grep -o '"total":[[:space:]]*[0-9]*' "$TMP_DIR/panel-body" 2>/dev/null | head -n 1 | tr -cd '0-9' || true)"
    ok "Application-API-Key funktioniert – ${total:-?} Node(s) im Panel gefunden"
    if [ "${total:-1}" = "0" ]; then warn "Im Panel ist noch kein Node angelegt – ohne Node können keine Server erstellt werden."; fi
  else
    good=1
    err "Application-API-Key: HTTP $HTTP_CODE"
    panel_hint "$HTTP_CODE" "Der Application-API-Key"
  fi
  panel_get "$CFG_PANEL_URL/api/client" "$CFG_CLIENT_KEY"
  if [ "$HTTP_CODE" = "200" ]; then
    ok "Client-API-Key funktioniert"
  else
    good=1
    err "Client-API-Key: HTTP $HTTP_CODE"
    panel_hint "$HTTP_CODE" "Der Client-API-Key"
  fi
  rm -f "$TMP_DIR/panel-body"
  return "$good"
}

ask_panel() {
  local def_url def_app def_client choice
  def_url="${CHF_PANEL_URL:-$(get_env PTERODACTYL_URL)}"
  def_app="${CHF_PTERO_APP_KEY:-$(get_env PTERODACTYL_APP_KEY)}"
  def_client="${CHF_PTERO_CLIENT_KEY:-$(get_env PTERODACTYL_CLIENT_KEY)}"
  while true; do
    ask_valid CFG_PANEL_URL "Adresse des Pterodactyl-Panels (z. B. panel.example.com)" "$def_url" norm_panel_url
    info "Application-API-Key: Panel → Admin → Application API → Key mit Users R/W, Servers R/W,"
    info "Nests/Nodes/Locations/Allocations R.  Client-API-Key: als Admin im Panel → Konto → API Credentials."
    ask_valid CFG_APP_KEY "Application-API-Key (ptla_…)" "$def_app" norm_app_key secret
    ask_valid CFG_CLIENT_KEY "Client-API-Key eines Admin-Kontos (ptlc_…)" "$def_client" norm_client_key secret

    if [ -z "$CFG_APP_KEY" ] && [ -z "$CFG_CLIENT_KEY" ]; then
      CFG_PTERO_MODE="mock"
      printf '\n%s    ╔══════════════════════════════════════════════════════════════════════╗\n' "$C_YELLOW"
      printf '    ║  TESTMODUS: Ohne API-Keys wird das Panel nur simuliert               ║\n'
      printf '    ║  (PTERODACTYL_MODE=mock). Es entstehen KEINE echten Server.          ║\n'
      printf '    ║  Später nachholen mit:  chfree reconfigure                           ║\n'
      printf '    ╚══════════════════════════════════════════════════════════════════════╝%s\n\n' "$C_RESET"
      logf "Testmodus (mock) gewählt"
      if confirm "Wirklich im Testmodus fortfahren?" j; then return 0; fi
      continue
    fi
    if [ -z "$CFG_APP_KEY" ] || [ -z "$CFG_CLIENT_KEY" ] || [ -z "$CFG_PANEL_URL" ]; then
      if [ "$INTERACTIVE" -eq 0 ]; then die "Für den Live-Betrieb werden Panel-Adresse UND beide Keys gebraucht (oder beide Keys leer lassen = Testmodus)."; fi
      warn "Für den Live-Betrieb werden Panel-Adresse und beide Keys gebraucht (beide Keys leer = Testmodus)."
      def_url="$CFG_PANEL_URL" def_app="$CFG_APP_KEY" def_client="$CFG_CLIENT_KEY"
      continue
    fi
    CFG_PTERO_MODE="live"
    if [ "${CHF_SKIP_PANEL_CHECK:-0}" = "1" ]; then
      warn "Verbindungsprüfung übersprungen (CHF_SKIP_PANEL_CHECK=1)."
      return 0
    fi
    while true; do
      if verify_panel; then return 0; fi
      if [ "$INTERACTIVE" -eq 0 ]; then
        die "Verbindung zum Panel fehlgeschlagen. Daten prüfen – oder mit CHF_SKIP_PANEL_CHECK=1 trotzdem installieren."
      fi
      printf '\n    %s[1]%s Erneut prüfen   %s[2]%s Daten neu eingeben   %s[3]%s Trotzdem fortfahren   %s[4]%s Abbrechen\n' \
        "$C_BOLD" "$C_RESET" "$C_BOLD" "$C_RESET" "$C_BOLD" "$C_RESET" "$C_BOLD" "$C_RESET"
      ask choice "Auswahl" "1"
      case "$choice" in
        1) continue ;;
        2) def_url="$CFG_PANEL_URL" def_app="$CFG_APP_KEY" def_client="$CFG_CLIENT_KEY"; break ;;
        3) warn "Fortfahren ohne funktionierende Panel-Verbindung – Server können erst erstellt werden, wenn sie steht."; return 0 ;;
        *) die "Abgebrochen. Es wurde noch nichts gestartet – einfach erneut ausführen." ;;
      esac
    done
  done
}

collect_config() {
  step "Konfiguration"
  local had_env=0 existing_domain keep_q=0 saved_interactive=$INTERACTIVE def
  if [ -s "$ENV_FILE" ]; then had_env=1; fi

  # Erneuter Aufruf von "install": vorhandene Angaben behalten, wenn gewünscht
  if [ "$MODE" = "install" ] && [ "$had_env" -eq 1 ] && [ "$INTERACTIVE" -eq 1 ]; then
    info "Es gibt bereits eine Konfiguration ($ENV_FILE)."
    if confirm "Vorhandene Angaben unverändert übernehmen?" j; then keep_q=1; INTERACTIVE=0; fi
  fi
  if [ "$INTERACTIVE" -eq 1 ]; then
    info "Enter übernimmt jeweils den Wert in [eckigen Klammern]."
  fi

  existing_domain="$(get_env SITE_DOMAIN)"
  if [ -z "$existing_domain" ]; then
    existing_domain="$(get_env APP_URL)"
    case "$existing_domain" in https://*) existing_domain="${existing_domain#https://}" ;; *) existing_domain="" ;; esac
  fi
  ask_valid CFG_DOMAIN "Domain der Website" "${CHF_DOMAIN:-${existing_domain:-craftinghosting.free}}" norm_domain

  ask_panel

  ask_valid CFG_ADMIN_EMAILS "Deine E-Mail-Adresse für den Admin-Bereich" "${CHF_ADMIN_EMAIL:-$(get_env ADMIN_EMAILS)}" norm_emails
  if [ -z "$CFG_ADMIN_EMAILS" ]; then
    warn "Keine Admin-E-Mail angegeben – der Admin-Bereich ist erst nach 'chfree reconfigure' oder"
    warn "'chfree cli make-admin du@example.com' erreichbar."
  fi

  # SMTP (optional)
  def="${CHF_SMTP_HOST:-$(get_env SMTP_HOST)}"
  if [ "$INTERACTIVE" -eq 1 ]; then
    info "Mailversand (SMTP) – für Bestätigungs- und Anmeldelinks. Leer lassen = überspringen."
  fi
  ask_valid CFG_SMTP_HOST "SMTP-Server (z. B. mail.example.com)" "$def" norm_host
  if [ -n "$CFG_SMTP_HOST" ]; then
    def="${CHF_SMTP_PORT:-$(get_env SMTP_PORT)}"
    ask_valid CFG_SMTP_PORT "SMTP-Port (587 = STARTTLS, 465 = SSL)" "${def:-587}" norm_port
    ask_valid CFG_SMTP_USER "SMTP-Benutzer (meist die Absender-Adresse)" "${CHF_SMTP_USER:-$(get_env SMTP_USER)}" norm_any
    while true; do
      ask_valid CFG_SMTP_PASS "SMTP-Passwort" "${CHF_SMTP_PASS:-$(get_env SMTP_PASS)}" norm_any secret
      if env_quote "$CFG_SMTP_PASS" >/dev/null; then break; fi
      if [ "$INTERACTIVE" -eq 0 ]; then die "Das SMTP-Passwort enthält eine nicht unterstützte Zeichenkombination (' zusammen mit \" \\ \$ oder \`)."; fi
      warn "Dieses Passwort lässt sich nicht sicher in die .env schreiben (' zusammen mit \" \\ \$ oder \`). Bitte ein anderes Passwort setzen."
    done
    ask_valid CFG_MAIL_FROM "Absender-Adresse (leer = SMTP-Benutzer)" "${CHF_MAIL_FROM:-$(get_env MAIL_FROM)}" norm_any
  else
    CFG_SMTP_PORT="587" CFG_SMTP_USER="" CFG_SMTP_PASS="" CFG_MAIL_FROM=""
    warn "Ohne SMTP werden keine E-Mails verschickt: Anmelde- und Bestätigungslinks stehen dann nur im"
    warn "API-Log (journalctl -u chfree-api). Für den echten Betrieb später nachholen: chfree reconfigure"
  fi

  # HTTPS / www
  CFG_ACME_EMAIL="${CHF_ACME_EMAIL:-${CFG_ADMIN_EMAILS%%,*}}"
  case "${CHF_WWW:-auto}" in
    yes | true | 1) CFG_WWW="yes" ;;
    no | false | 0) CFG_WWW="no" ;;
    *) if [[ "$CFG_DOMAIN" =~ ^[^.]+\.[^.]+$ ]]; then CFG_WWW="yes"; else CFG_WWW="no"; fi ;;
  esac

  # Secrets: vorhandene Werte bleiben IMMER erhalten
  CFG_DB_KEY="$(get_env DATABASE_ENCRYPTION_KEY)"
  if [ "${#CFG_DB_KEY}" -lt 32 ]; then
    if [ -n "$CFG_DB_KEY" ]; then die "DATABASE_ENCRYPTION_KEY in $ENV_FILE ist zu kurz (< 32 Zeichen). Bitte den richtigen Schlüssel eintragen – ein neuer Schlüssel könnte die vorhandene Datenbank nicht öffnen."; fi
    if [ -f "$(db_path)" ] && ! is_dry; then
      die "Es gibt bereits eine Datenbank ($(db_path)), aber keinen DATABASE_ENCRYPTION_KEY in $ENV_FILE. Den Schlüssel aus dem Backup eintragen – ohne ihn lässt sich die Datenbank nicht öffnen."
    fi
    CFG_DB_KEY="$(openssl rand -hex 32)"
    info "Neuer Datenbank-Schlüssel erzeugt."
  fi
  CFG_ADMIN_PATH="$(get_env ADMIN_PATH)"
  if [ -z "$CFG_ADMIN_PATH" ] || [ "$CFG_ADMIN_PATH" = "/admin" ]; then
    CFG_ADMIN_PATH="/team-$(openssl rand -hex 4)"
    info "Geheimer Admin-Pfad erzeugt."
  fi

  INTERACTIVE=$saved_interactive
  if [ "$keep_q" -eq 1 ]; then ok "Vorhandene Angaben übernommen"; else ok "Angaben vollständig"; fi
}

db_path() {
  local p
  p="$(get_env DATABASE_PATH)"
  [ -z "$p" ] && p="$DATA_DIR/chfree.db"
  case "$p" in /*) ;; *) p="$INSTALL_DIR/${p#./}" ;; esac
  printf '%s' "$p"
}

write_env() {
  step ".env schreiben"
  local url="https://$CFG_DOMAIN" v
  if ! is_dry || [ -n "${CHF_INSTALL_DIR:-}" ] || [ -n "${CHF_ENV_FILE:-}" ]; then mkdir -p "$(dirname "$ENV_FILE")"; fi
  if [ -s "$ENV_FILE" ]; then
    cp -p "$ENV_FILE" "${ENV_FILE}.bak"
    chmod 600 "${ENV_FILE}.bak"
    info "Vorherige Fassung gesichert: ${ENV_FILE}.bak"
  else
    (umask 077 && cat >"$ENV_FILE" <<'EOF'
# =============================================================================
#  CraftingHosting.free – Konfiguration (erzeugt von install.sh)
#  Ändern:  chfree reconfigure   (oder von Hand, danach: chfree update --no-pull)
#  Diese Datei enthält Secrets – niemals weitergeben oder committen.
#  DATABASE_ENCRYPTION_KEY getrennt sichern: ohne ihn ist die Datenbank verloren.
#  Weitere optionale Variablen: siehe .env.example
# =============================================================================
EOF
    )
  fi

  set_env NODE_ENV production
  v="$(get_env LOG_LEVEL)"; set_env LOG_LEVEL "${v:-info}"

  # Website
  set_env SITE_DOMAIN "$CFG_DOMAIN"
  set_env APP_URL "$url"
  set_env NEXT_PUBLIC_SITE_URL "$url"
  set_env API_INTERNAL_URL "http://127.0.0.1:$API_PORT"
  set_env WEB_INTERNAL_URL "http://127.0.0.1:$WEB_PORT"
  if [ -n "${CHF_DISCORD_URL:-}" ]; then set_env NEXT_PUBLIC_DISCORD_URL "$CHF_DISCORD_URL"; fi

  # Admin
  set_env ADMIN_EMAILS "$CFG_ADMIN_EMAILS"
  set_env ADMIN_PATH "$CFG_ADMIN_PATH"

  # API
  set_env API_HOST 127.0.0.1
  set_env API_PORT "$API_PORT"
  set_env TRUST_PROXY true

  # Datenbank (verschlüsselte SQLite-Datei)
  v="$(get_env DATABASE_PATH)"
  case "$v" in /*) ;; *) v="$DATA_DIR/chfree.db" ;; esac
  set_env DATABASE_PATH "$v"
  set_env DATABASE_ENCRYPTION_KEY "$CFG_DB_KEY"
  for v in DATABASE_URL DATABASE_POOL_SIZE DB_NAME DB_USER DB_PASSWORD DB_ROOT_PASSWORD; do unset_env "$v"; done

  # Pterodactyl
  set_env PTERODACTYL_MODE "$CFG_PTERO_MODE"
  if [ -n "$CFG_PANEL_URL" ]; then
    set_env PTERODACTYL_URL "$CFG_PANEL_URL"
    set_env PTERODACTYL_PUBLIC_URL "$CFG_PANEL_URL"
    set_env NEXT_PUBLIC_PANEL_URL "$CFG_PANEL_URL"
  else
    unset_env PTERODACTYL_URL
    unset_env PTERODACTYL_PUBLIC_URL
    unset_env NEXT_PUBLIC_PANEL_URL
  fi
  set_env PTERODACTYL_APP_KEY "$CFG_APP_KEY"
  set_env PTERODACTYL_CLIENT_KEY "$CFG_CLIENT_KEY"
  # Nur Fallback – Nodes und Eggs werden im Admin-Bereich zugewiesen
  v="${CHF_PTERO_LOCATION_IDS:-$(get_env PTERODACTYL_LOCATION_IDS)}"
  set_env PTERODACTYL_LOCATION_IDS "$v"
  set_env PTERODACTYL_MOCK_STATE_FILE "$DATA_DIR/pterodactyl-mock.json"

  # Mail
  set_env SMTP_HOST "$CFG_SMTP_HOST"
  set_env SMTP_PORT "$CFG_SMTP_PORT"
  v="$(get_env SMTP_SECURE)"; set_env SMTP_SECURE "${v:-auto}"
  set_env SMTP_USER "$CFG_SMTP_USER"
  set_env SMTP_PASS "$CFG_SMTP_PASS"
  set_env MAIL_FROM "$CFG_MAIL_FROM"

  # Jobs laufen im eigenen Worker-Dienst
  set_env RUN_JOBS_IN_API false

  chmod 600 "$ENV_FILE"
  if ! is_dry && id -u "$SERVICE_USER" >/dev/null 2>&1; then
    chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
    [ -f "${ENV_FILE}.bak" ] && chown "$SERVICE_USER:$SERVICE_USER" "${ENV_FILE}.bak"
  fi
  ok "$ENV_FILE geschrieben (nur für den Dienst-Benutzer lesbar)"
  if is_dry; then
    info "Inhalt (Secrets ausgeblendet):"
    sed -E 's/^((DATABASE_ENCRYPTION_KEY|PTERODACTYL_APP_KEY|PTERODACTYL_CLIENT_KEY|SMTP_PASS|ADMIN_PATH)=).+$/\1********/' "$ENV_FILE" | sed 's/^/      /'
  fi
}

# ------------------------------------------------------------- Systempakete ---
apt_install() { run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"; }

install_base_packages() {
  step "Grundpakete installieren"
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  apt_install curl ca-certificates git rsync openssl gnupg build-essential
  ok "curl, git, rsync, openssl, build-essential"
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v 2>/dev/null || true)"; v="${v#v}"
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  [ "$major" -gt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -ge 9 ]; }
}

install_node() {
  step "Node.js"
  if node_ok && command -v npm >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    ok "Node.js $(node -v) ist bereits vorhanden ($NODE_BIN)"
    return 0
  fi
  info "Installiere Node.js $NODE_MAJOR LTS aus dem NodeSource-Repository …"
  if is_dry; then
    info "[dry-run] NodeSource-Schlüssel + Paketquelle node_${NODE_MAJOR}.x einrichten, apt-get install nodejs"
    return 0
  fi
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key 2>>"$LOG_FILE" | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg 2>>"$LOG_FILE" ||
    die "NodeSource-Schlüssel konnte nicht geladen werden (Internetverbindung?). Details: $LOG_FILE"
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODE_MAJOR" >/etc/apt/sources.list.d/nodesource.list
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  apt_install nodejs
  hash -r
  node_ok || die "Node.js ist nach der Installation nicht in Version ≥ 20.9 verfügbar (gefunden: $(node -v 2>/dev/null || echo keine))."
  NODE_BIN="$(command -v node)"
  ok "Node.js $(node -v) installiert"
}

ports_in_use_by_others() { # 0 = Port 80/443 von einem anderen Webserver belegt
  command -v ss >/dev/null 2>&1 || return 1
  ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -vq 'caddy' || return 1
  ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -q . || return 1
  return 0
}

install_caddy() {
  [ "$PROXY" = "caddy" ] || return 0
  step "Caddy (Webserver mit automatischem HTTPS)"
  if ! is_dry && ports_in_use_by_others; then
    warn "Port 80/443 ist bereits von einem anderen Webserver belegt:"
    ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ { print "      " $4 "  " $NF }' >&2 || true
    if [ "$INTERACTIVE" -eq 1 ] && ! confirm "Ohne Caddy fortfahren und den vorhandenen Webserver selbst als Reverse Proxy einrichten?" j; then
      die "Abgebrochen. Anderen Webserver stoppen (z. B. systemctl disable --now apache2 nginx) und erneut ausführen."
    fi
    PROXY="none"
    warn "Caddy wird NICHT eingerichtet – Vorlage für nginx: $INSTALL_DIR/deploy/nginx.example.conf"
    return 0
  fi
  if command -v caddy >/dev/null 2>&1; then
    ok "Caddy ist bereits vorhanden"
    return 0
  fi
  info "Installiere Caddy aus dem offiziellen Repository …"
  if is_dry; then
    info "[dry-run] Caddy-Schlüssel + Paketquelle einrichten, apt-get install caddy"
    return 0
  fi
  apt_install debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' 2>>"$LOG_FILE" | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>>"$LOG_FILE" ||
    die "Caddy-Schlüssel konnte nicht geladen werden. Details: $LOG_FILE"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list 2>>"$LOG_FILE" ||
    die "Caddy-Paketquelle konnte nicht geladen werden. Details: $LOG_FILE"
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  run env DEBIAN_FRONTEND=noninteractive apt-get update
  apt_install caddy
  ok "Caddy installiert"
}

ensure_swap() {
  [ "${CHF_NO_SWAP:-0}" = "1" ] && return 0
  [ -r /proc/meminfo ] || return 0
  local mem swap total
  mem="$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  swap="$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
  total=$((mem + swap))
  [ "$total" -ge 2800 ] && return 0
  warn "Wenig Arbeitsspeicher (${mem} MB RAM + ${swap} MB Swap) – der Build der Website braucht kurzzeitig ca. 2–3 GB."
  [ -e /swapfile-chfree ] && return 0
  if confirm "2 GB Auslagerungsdatei (/swapfile-chfree) anlegen?" j; then
    if is_dry; then info "[dry-run] /swapfile-chfree (2 GB) anlegen und in /etc/fstab eintragen"; return 0; fi
    if try fallocate -l 2G /swapfile-chfree || try dd if=/dev/zero of=/swapfile-chfree bs=1M count=2048; then
      chmod 600 /swapfile-chfree
      if try mkswap /swapfile-chfree && try swapon /swapfile-chfree; then
        grep -q '^/swapfile-chfree ' /etc/fstab || printf '/swapfile-chfree none swap sw 0 0\n' >>/etc/fstab
        ok "Auslagerungsdatei aktiv"
      else
        rm -f /swapfile-chfree
        warn "Auslagerungsdatei konnte nicht aktiviert werden (z. B. in Containern) – es geht ohne weiter."
      fi
    else
      rm -f /swapfile-chfree
      warn "Auslagerungsdatei konnte nicht angelegt werden – es geht ohne weiter."
    fi
  fi
}

# ------------------------------------------------- Benutzer, Ordner, Quelle ---
ensure_user_and_dirs() {
  step "Dienst-Benutzer und Ordner"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    ok "Benutzer $SERVICE_USER vorhanden"
  else
    run useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    ok "Benutzer $SERVICE_USER angelegt (ohne Login)"
  fi
  run install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  run install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CACHE_DIR"
  run install -d -m 0700 -o root -g root "$BACKUP_DIR"
  ok "Daten: $DATA_DIR · Backups: $BACKUP_DIR"
}

is_repo_checkout() { [ -n "$1" ] && [ -f "$1/package.json" ] && grep -q "\"name\": *\"$PACKAGE_NAME\"" "$1/package.json" 2>/dev/null; }

fetch_source() {
  step "Programmdateien nach $INSTALL_DIR"
  local real_install=""
  [ -d "$INSTALL_DIR" ] && real_install="$(cd "$INSTALL_DIR" && pwd -P)"

  if is_repo_checkout "$SCRIPT_DIR" && [ "$SCRIPT_DIR" = "$real_install" ]; then
    if [ "$MODE" = "update" ] && [ -d "$INSTALL_DIR/.git" ] && [ "$NO_PULL" -eq 0 ]; then
      info "git pull …"
      as_app_in "$INSTALL_DIR" git pull --ff-only
      ok "Quelltext aktualisiert"
    elif [ "$MODE" = "update" ] && [ "$NO_PULL" -eq 0 ]; then
      warn "$INSTALL_DIR ist kein Git-Checkout – es wird der vorhandene Stand neu gebaut."
      warn "Neue Version einspielen: Checkout/ZIP woanders entpacken und dort 'bash install.sh update' ausführen."
    else
      ok "Verwende den vorhandenen Stand in $INSTALL_DIR"
    fi
  elif is_repo_checkout "$SCRIPT_DIR"; then
    info "Kopiere $SCRIPT_DIR → $INSTALL_DIR (ohne node_modules, Builds, .env und Daten)"
    run install -d -m 0755 "$INSTALL_DIR"
    run rsync -a --delete \
      --exclude 'node_modules/' --exclude '.next/' --exclude 'dist/' \
      --exclude '/.env' --exclude '/.env.bak' --exclude '/.env.??????' --exclude '/data/' --exclude '*.log' \
      --exclude '.pterodactyl-mock.json' \
      "$SCRIPT_DIR/" "$INSTALL_DIR/"
    ok "Dateien übertragen"
  elif is_repo_checkout "$INSTALL_DIR"; then
    if [ -d "$INSTALL_DIR/.git" ] && [ "$NO_PULL" -eq 0 ]; then
      info "git pull in $INSTALL_DIR …"
      run chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
      as_app_in "$INSTALL_DIR" git pull --ff-only
    fi
    ok "Verwende den vorhandenen Stand in $INSTALL_DIR"
  else
    if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
      die "$INSTALL_DIR existiert und enthält etwas anderes als CraftingHosting.free. Ordner prüfen oder CHF_INSTALL_DIR setzen."
    fi
    info "git clone $REPO_URL (Branch $REPO_BRANCH) …"
    run git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
    ok "Quelltext geladen"
  fi
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
  if ! is_dry && ! is_repo_checkout "$INSTALL_DIR"; then
    die "In $INSTALL_DIR liegt kein CraftingHosting.free-Projekt (package.json fehlt)."
  fi
}

build_app() {
  step "Abhängigkeiten installieren und bauen (dauert einige Minuten)"
  ensure_swap
  info "npm ci …"
  as_app_in "$INSTALL_DIR" npm ci --include=dev --no-audit --no-fund
  info "npm run build (API, Worker, Website) …"
  as_app_in "$INSTALL_DIR" npm run build
  if ! is_dry; then
    [ -f "$INSTALL_DIR/apps/api/dist/index.js" ] || die "Build unvollständig: apps/api/dist/index.js fehlt."
    [ -f "$INSTALL_DIR/apps/web/.next/standalone/apps/web/server.js" ] || die "Build unvollständig: Standalone-Server der Website fehlt."
  fi
  ok "Build fertig"
}

migrate_db() {
  step "Datenbank einrichten/aktualisieren"
  as_app_in "$INSTALL_DIR/apps/api" "$NODE_BIN" dist/migrate.js
  ok "Migrationen angewendet ($(db_path))"
}

# ------------------------------------------------------------------ Dienste ---
install_units() {
  step "systemd-Dienste einrichten"
  local unit src protect_home="true"
  case "$INSTALL_DIR" in /home/* | /root/* | /run/user/*) protect_home="read-only" ;; esac
  for unit in "${SERVICES[@]}"; do
    src="$INSTALL_DIR/deploy/systemd/$unit.service"
    if is_dry; then
      info "[dry-run] $src → $UNIT_DIR/$unit.service (Pfade: $INSTALL_DIR, $DATA_DIR, Benutzer $SERVICE_USER)"
      continue
    fi
    [ -f "$src" ] || die "Unit-Vorlage fehlt: $src"
    sed -e "s#$DEFAULT_INSTALL_DIR#$INSTALL_DIR#g" \
      -e "s#$DEFAULT_DATA_DIR#$DATA_DIR#g" \
      -e "s#^User=.*#User=$SERVICE_USER#" \
      -e "s#^Group=.*#Group=$SERVICE_USER#" \
      -e "s#/usr/bin/node#$NODE_BIN#g" \
      -e "s#^ProtectHome=.*#ProtectHome=$protect_home#" \
      "$src" >"$UNIT_DIR/$unit.service"
    chmod 0644 "$UNIT_DIR/$unit.service"
  done
  run systemctl daemon-reload
  run systemctl enable "${SERVICES[@]}"
  ok "chfree-api, chfree-worker, chfree-web eingerichtet"
}

restart_services() {
  step "Dienste starten"
  run systemctl restart "${SERVICES[@]}"
  ok "Dienste gestartet"
}

install_wrapper() {
  if is_dry; then info "[dry-run] $WRAPPER_PATH schreiben (chfree update|status|logs|backup|reconfigure)"; return 0; fi
  cat >"$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
# CraftingHosting.free – Verwaltung (erzeugt von install.sh)
#   chfree status | update | reconfigure | backup | logs [api|worker|web] | cli <befehl> | uninstall
export CHF_INSTALL_DIR="\${CHF_INSTALL_DIR:-$INSTALL_DIR}"
export CHF_DATA_DIR="\${CHF_DATA_DIR:-$DATA_DIR}"
export CHF_BACKUP_DIR="\${CHF_BACKUP_DIR:-$BACKUP_DIR}"
export CHF_USER="\${CHF_USER:-$SERVICE_USER}"
[ \$# -eq 0 ] && set -- help
case "\$1" in install) echo "Zum Installieren bitte 'bash install.sh' im Projektordner verwenden." >&2; exit 2 ;; esac
exec bash "\$CHF_INSTALL_DIR/install.sh" "\$@"
EOF
  chmod 0755 "$WRAPPER_PATH"
  ok "Befehl 'chfree' installiert ($WRAPPER_PATH)"
}

# -------------------------------------------------------------------- Caddy ---
caddy_site_file() { printf '%s/sites/chfree.caddy' "$CADDY_DIR"; }

write_caddy_site() { # write_caddy_site ZIELDATEI
  local names="$CFG_DOMAIN"
  [ "$CFG_WWW" = "yes" ] && names="$CFG_DOMAIN, www.$CFG_DOMAIN"
  {
    printf '# CraftingHosting.free – von install.sh erzeugt (wird bei reconfigure/update überschrieben)\n'
    printf '# /api/* geht direkt an die API, alles andere an die Next.js-Website. HTTPS automatisch (Let'"'"'s Encrypt).\n\n'
    printf '%s {\n' "$names"
    if [ -n "$CFG_ACME_EMAIL" ]; then printf '\ttls %s\n' "$CFG_ACME_EMAIL"; fi
    printf '\tencode zstd gzip\n\n'
    if [ "$CFG_WWW" = "yes" ]; then
      printf '\t@www host www.%s\n' "$CFG_DOMAIN"
      printf '\tredir @www https://%s{uri} permanent\n\n' "$CFG_DOMAIN"
    fi
    printf '\thandle /api/* {\n\t\treverse_proxy 127.0.0.1:%s\n\t}\n\n' "$API_PORT"
    printf '\thandle {\n\t\treverse_proxy 127.0.0.1:%s\n\t}\n\n' "$WEB_PORT"
    printf '\theader {\n\t\t-Server\n\t}\n\n'
    printf '\t# Bewusst keine Zugriffsprotokolle (Datenschutz) – Caddy schreibt nur Fehler ins Log.\n'
    printf '}\n'
  } >"$1"
}

configure_caddy() {
  [ "$PROXY" = "caddy" ] || return 0
  step "Caddy konfigurieren (HTTPS für $CFG_DOMAIN)"
  local main="$CADDY_DIR/Caddyfile" site backup="" normalized
  site="$(caddy_site_file)"
  if is_dry; then
    info "[dry-run] $site schreiben:"
    write_caddy_site "$TMP_DIR/chfree.caddy"
    sed 's/^/      /' "$TMP_DIR/chfree.caddy"
    info "[dry-run] '$CADDY_IMPORT' in $main sicherstellen, caddy validate, systemctl reload caddy"
    return 0
  fi
  install -d -m 0755 "$CADDY_DIR/sites"
  [ -f "$site" ] && cp -p "$site" "$TMP_DIR/chfree.caddy.prev"
  write_caddy_site "$site"
  chmod 0644 "$site"

  if [ ! -f "$main" ]; then
    printf '%s\n%s\n' "$CADDY_MARKER" "$CADDY_IMPORT" >"$main"
  elif grep -qF "$CADDY_IMPORT" "$main"; then
    :
  else
    backup="$main.chfree-backup-$(date +%Y%m%d-%H%M%S)"
    cp -p "$main" "$backup"
    normalized="$(grep -vE '^[[:space:]]*(#|$)' "$main" | tr -d '[:space:]' || true)"
    if [ "$normalized" = ":80{root*/usr/share/caddyfile_server}" ] || [ -z "$normalized" ]; then
      # Unveränderte Standarddatei des Pakets (Willkommensseite) → ersetzen
      printf '%s\n%s\n' "$CADDY_MARKER" "$CADDY_IMPORT" >"$main"
      info "Standard-Caddyfile ersetzt (Sicherung: $backup)"
    else
      # Vorhandene Seiten bleiben unangetastet – nur die import-Zeile wird angehängt
      printf '\n%s\n%s\n' "$CADDY_MARKER" "$CADDY_IMPORT" >>"$main"
      info "Vorhandenes Caddyfile behalten, import-Zeile ergänzt (Sicherung: $backup)"
    fi
  fi

  if ! try caddy validate --adapter caddyfile --config "$main"; then
    err "Die Caddy-Konfiguration ist ungültig – Änderungen werden zurückgenommen."
    tail -n 15 "$LOG_FILE" >&2 || true
    if [ -n "$backup" ]; then cp -p "$backup" "$main"; fi
    if [ -f "$TMP_DIR/chfree.caddy.prev" ]; then cp -p "$TMP_DIR/chfree.caddy.prev" "$site"; else rm -f "$site"; fi
    die "Häufige Ursache: Die Domain $CFG_DOMAIN ist in $main bereits eingetragen. Eintrag entfernen oder mit --no-caddy installieren."
  fi
  try caddy fmt --overwrite "$site" || true
  run systemctl enable caddy
  if systemctl is-active --quiet caddy; then
    try systemctl reload caddy || run systemctl restart caddy
  else
    run systemctl start caddy
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    try ufw allow 80/tcp || true
    try ufw allow 443/tcp || true
    try ufw allow 443/udp || true
    info "Firewall (ufw): Ports 80 und 443 freigegeben"
  fi
  ok "Caddy leitet $CFG_DOMAIN an die Website weiter"
}

check_dns() {
  [ "$PROXY" = "caddy" ] || return 0
  is_dry && return 0
  local resolved local_ips ip match=0
  resolved="$(getent ahosts "$CFG_DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u || true)"
  if [ -z "$resolved" ]; then
    warn "DNS: $CFG_DOMAIN zeigt noch auf keine IP-Adresse. Ohne A-/AAAA-Record auf diesen Server bekommt Caddy"
    warn "kein HTTPS-Zertifikat – Caddy versucht es automatisch weiter, sobald der Eintrag existiert."
    return 0
  fi
  local_ips="$(hostname -I 2>/dev/null || true)"
  for ip in $resolved; do
    case " $local_ips " in *" $ip "*) match=1 ;; esac
  done
  if [ "$match" -eq 1 ]; then
    ok "DNS: $CFG_DOMAIN zeigt auf diesen Server"
  else
    warn "DNS: $CFG_DOMAIN zeigt auf $(printf '%s' "$resolved" | tr '\n' ' ')– das ist keine Adresse dieses Servers ($local_ips)."
    warn "Hinter NAT/Cloudflare-Proxy ist das in Ordnung, sonst bitte den A-/AAAA-Record korrigieren."
  fi
}

wait_for_health() {
  step "Funktionsprüfung"
  if is_dry; then info "[dry-run] warte auf http://127.0.0.1:$API_PORT/api/v1/health und http://127.0.0.1:$WEB_PORT/"; return 0; fi
  local i body=""
  for i in $(seq 1 45); do
    if body="$(curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/v1/health" 2>/dev/null)"; then break; fi
    body=""
    sleep 2
  done
  if [ -z "$body" ]; then
    err "Die API antwortet nicht (nach ${i} Versuchen). Letzte Meldungen:"
    journalctl -u chfree-api -n 25 --no-pager >&2 2>/dev/null || true
    die "Bitte die Meldungen oben prüfen (häufig: fehlender/falscher Wert in $ENV_FILE). Danach: bash install.sh"
  fi
  ok "API läuft: $body"
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$WEB_PORT/robots.txt" 2>/dev/null; then
      ok "Website läuft (Port $WEB_PORT)"
      break
    fi
    if [ "$i" -eq 30 ]; then
      warn "Die Website antwortet noch nicht – prüfen mit: journalctl -u chfree-web -n 50"
    fi
    sleep 2
  done
  local s
  for s in "${SERVICES[@]}"; do
    if systemctl is-active --quiet "$s"; then ok "$s aktiv"; else warn "$s ist NICHT aktiv – journalctl -u $s -n 50"; fi
  done
}

print_summary() {
  local url="https://$CFG_DOMAIN" line="════════════════════════════════════════════════════════════════════════"
  printf '\n%s%s%s\n' "$C_GREEN" "$line" "$C_RESET"
  printf '%s  CraftingHosting.free ist eingerichtet%s\n' "$C_BOLD" "$C_RESET"
  printf '%s%s%s\n\n' "$C_GREEN" "$line" "$C_RESET"
  printf '  %sWebsite:%s        %s\n' "$C_BOLD" "$C_RESET" "$url"
  printf '  %sAdmin-Bereich:%s  %s%s   %s(geheim – als Lesezeichen speichern)%s\n' "$C_BOLD" "$C_RESET" "$url" "$CFG_ADMIN_PATH" "$C_DIM" "$C_RESET"
  if [ "$CFG_PTERO_MODE" = "live" ]; then
    printf '  %sPterodactyl:%s    %s (live)\n' "$C_BOLD" "$C_RESET" "$CFG_PANEL_URL"
  else
    printf '  %sPterodactyl:%s    %sTESTMODUS (mock) – es entstehen keine echten Server → chfree reconfigure%s\n' "$C_BOLD" "$C_RESET" "$C_YELLOW" "$C_RESET"
  fi
  cat <<EOF

  ${C_BOLD}So meldest du dich an${C_RESET}
    1. $url/login öffnen und ${CFG_ADMIN_EMAILS:-<Admin-E-Mail>} eintragen
    2. Den Link aus der E-Mail anklicken$([ -z "$CFG_SMTP_HOST" ] && printf '\n       (ohne SMTP steht der Link im Log:  journalctl -u chfree-api -n 50)')
    3. $url$CFG_ADMIN_PATH aufrufen

  ${C_BOLD}Nächste Schritte im Admin-Bereich${C_RESET}
    • Admin → Pterodactyl: Nodes und Eggs zuweisen – Minecraft-Node(s), Discord-Bot-Node,
      Python- und Node.js-Egg (werden automatisch aus dem Panel erkannt)
    • Admin → Einstellungen: Pakete, Kapazität, Standorte/Hardware, Spendenlink (SumUp)
    • Admin → E-Mails: Testmail senden

  ${C_BOLD}Datenbank und Schlüssel – BEIDES sichern${C_RESET}
    • Datenbank (verschlüsselt):  $(db_path)
    • Schlüssel + Konfiguration:  $ENV_FILE  (DATABASE_ENCRYPTION_KEY)
      Ohne den Schlüssel lässt sich die Datenbank nicht mehr öffnen – ohne die Datei nützt der Schlüssel nichts.
    • Backup erstellen:  chfree backup   → $BACKUP_DIR (regelmäßig auf einen anderen Rechner kopieren)

EOF
  if [ "$PROXY" = "caddy" ]; then
    cat <<EOF
  ${C_BOLD}DNS / HTTPS${C_RESET}
    Der A-Record (und ggf. AAAA) von $CFG_DOMAIN$([ "$CFG_WWW" = "yes" ] && printf ' und www.%s' "$CFG_DOMAIN") muss auf diesen Server zeigen und die Ports
    80 + 443 müssen offen sein – erst dann kann Caddy das HTTPS-Zertifikat holen (passiert automatisch).

EOF
  else
    cat <<EOF
  ${C_BOLD}Reverse Proxy${C_RESET}
    Caddy wurde nicht eingerichtet. Eigener Proxy: /api/* → 127.0.0.1:$API_PORT, alles andere → 127.0.0.1:$WEB_PORT
    Vorlage für nginx: $INSTALL_DIR/deploy/nginx.example.conf

EOF
  fi
  cat <<EOF
  ${C_BOLD}Nützliche Befehle${C_RESET}
    chfree status                    Zustand aller Dienste        (systemctl status 'chfree-*')
    chfree logs api                  Logs live                    (journalctl -u chfree-api -f)
    chfree update                    Aktualisieren                (bash install.sh update)
    chfree reconfigure               Domain, Keys, SMTP ändern
    chfree backup                    Datenbank + .env sichern
    chfree cli mail-test du@example.com   Mailversand testen

  Installationsprotokoll: $LOG_FILE
EOF
  if [ "$PROXY" = "caddy" ]; then check_dns; fi
}

# -------------------------------------------------------------------- Backup ---
do_backup() {
  step "Backup"
  local db ts out stage s ext
  local -a stopped=()
  db="$(db_path)"
  if is_dry; then info "[dry-run] API + Worker kurz stoppen, $db (+ -wal/-shm) und $ENV_FILE nach $BACKUP_DIR sichern, Dienste starten"; return 0; fi
  [ -f "$db" ] || die "Keine Datenbank gefunden ($db)."
  ts="$(date +%Y%m%d-%H%M%S)"
  out="$BACKUP_DIR/chfree-$ts.tar.gz"
  install -d -m 0700 "$BACKUP_DIR"
  stage="$(mktemp -d "$BACKUP_DIR/.stage.XXXXXX")"
  # Die Datenbank ist verschlüsselt (kein sqlite3 .backup möglich) → API und Worker kurz anhalten,
  # dann Datei samt -wal/-shm konsistent kopieren. Die Website zeigt währenddessen kurz Ladefehler.
  for s in chfree-api chfree-worker; do
    if systemctl is-active --quiet "$s" 2>/dev/null; then stopped+=("$s"); fi
  done
  if [ "${#stopped[@]}" -gt 0 ]; then
    # shellcheck disable=SC2064
    trap "systemctl start ${stopped[*]} >/dev/null 2>&1 || true; rm -rf '$stage'; cleanup" EXIT
    systemctl stop "${stopped[@]}"
  fi
  cp -p "$db" "$stage/"
  for ext in -wal -shm; do
    if [ -f "$db$ext" ]; then cp -p "$db$ext" "$stage/"; fi
  done
  if [ "${#stopped[@]}" -gt 0 ]; then systemctl start "${stopped[@]}"; fi
  trap cleanup EXIT
  if [ -f "$ENV_FILE" ]; then cp -p "$ENV_FILE" "$stage/env"; fi
  (umask 077 && tar -czf "$out" -C "$stage" .)
  chmod 600 "$out"
  rm -rf "$stage"
  # Alte Backups aufräumen (die neuesten $BACKUP_KEEP bleiben)
  if [[ "$BACKUP_KEEP" =~ ^[0-9]+$ ]] && [ "$BACKUP_KEEP" -gt 0 ]; then
    find "$BACKUP_DIR" -maxdepth 1 -name 'chfree-*.tar.gz' -type f -printf '%T@ %p\n' 2>/dev/null |
      sort -rn | awk -v keep="$BACKUP_KEEP" 'NR > keep { sub(/^[^ ]+ /, ""); print }' |
      while IFS= read -r old; do rm -f "$old"; done
  fi
  ok "Backup: $out ($(du -h "$out" | cut -f1))"
  info "Enthält die Datenbank UND den Schlüssel (.env als 'env') – sicher aufbewahren, am besten auf einem anderen Rechner."
}

# -------------------------------------------------------------------- Status ---
do_status() {
  local s state body db last
  printf '%sCraftingHosting.free – Status%s\n\n' "$C_BOLD" "$C_RESET"
  for s in "${SERVICES[@]}"; do
    state="$(systemctl is-active "$s" 2>/dev/null || true)"
    if [ "$state" = "active" ]; then printf '  %s●%s %-14s aktiv\n' "$C_GREEN" "$C_RESET" "$s"; else printf '  %s●%s %-14s %s\n' "$C_RED" "$C_RESET" "$s" "${state:-unbekannt}"; fi
  done
  if command -v caddy >/dev/null 2>&1; then
    state="$(systemctl is-active caddy 2>/dev/null || true)"
    printf '  %s●%s %-14s %s\n' "$([ "$state" = "active" ] && printf '%s' "$C_GREEN" || printf '%s' "$C_RED")" "$C_RESET" "caddy" "${state:-unbekannt}"
  fi
  printf '\n'
  if body="$(curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/v1/health" 2>/dev/null)"; then
    printf '  API-Health:   %s\n' "$body"
  else
    printf '  API-Health:   %snicht erreichbar%s (journalctl -u chfree-api -n 50)\n' "$C_RED" "$C_RESET"
  fi
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$WEB_PORT/robots.txt" 2>/dev/null; then
    printf '  Website:      erreichbar (127.0.0.1:%s)\n' "$WEB_PORT"
  else
    printf '  Website:      %snicht erreichbar%s (journalctl -u chfree-web -n 50)\n' "$C_RED" "$C_RESET"
  fi
  printf '  Adresse:      %s\n' "$(get_env APP_URL)"
  printf '  Pterodactyl:  %s (%s)\n' "$(get_env PTERODACTYL_URL)" "$(get_env PTERODACTYL_MODE)"
  printf '  SMTP:         %s\n' "$(v="$(get_env SMTP_HOST)"; printf '%s' "${v:-nicht eingerichtet – Links nur im API-Log}")"
  db="$(db_path)"
  if [ -f "$db" ]; then printf '  Datenbank:    %s (%s)\n' "$db" "$(du -h "$db" | cut -f1)"; else printf '  Datenbank:    %s%s fehlt%s\n' "$C_RED" "$db" "$C_RESET"; fi
  if [ "$(get_env DATABASE_ENCRYPTION_KEY | wc -c)" -ge 32 ]; then printf '  DB-Schlüssel: vorhanden (%s)\n' "$ENV_FILE"; else printf '  DB-Schlüssel: %sFEHLT in %s%s\n' "$C_RED" "$ENV_FILE" "$C_RESET"; fi
  last="$(find "$BACKUP_DIR" -maxdepth 1 -name 'chfree-*.tar.gz' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2- || true)"
  printf '  Backup:       %s\n' "${last:-noch keines – chfree backup}"
  printf '  Node.js:      %s\n' "$(node -v 2>/dev/null || echo fehlt)"
  if [ -d "$INSTALL_DIR/.git" ] && command -v git >/dev/null 2>&1; then
    printf '  Version:      %s\n' "$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" log -1 --format='%h %cs %s' 2>/dev/null || echo unbekannt)"
  fi
}

do_logs() {
  local -a units=()
  local a
  if [ "${#EXTRA_ARGS[@]}" -eq 0 ]; then
    for a in "${SERVICES[@]}"; do units+=(-u "$a"); done
  else
    for a in "${EXTRA_ARGS[@]}"; do
      case "$a" in
        api | worker | web) units+=(-u "chfree-$a") ;;
        caddy) units+=(-u caddy) ;;
        *) die "Unbekannter Dienst: $a (möglich: api, worker, web, caddy)" ;;
      esac
    done
  fi
  exec journalctl "${units[@]}" -n 100 -f
}

do_cli() {
  [ -f "$INSTALL_DIR/apps/api/dist/cli.js" ] || die "CLI nicht gefunden – ist die Installation abgeschlossen?"
  cd "$INSTALL_DIR/apps/api"
  exec runuser -u "$SERVICE_USER" -- env "HOME=$CACHE_DIR" "$(command -v node)" dist/cli.js "${EXTRA_ARGS[@]}"
}

# ----------------------------------------------------------------- Uninstall ---
do_uninstall() {
  step "Deinstallation"
  local answer="" site
  info "Entfernt werden: die Dienste chfree-api/-worker/-web, die Caddy-Seite und der Befehl 'chfree'."
  info "Es bleiben: Datenbank ($DATA_DIR), .env und Programmordner ($INSTALL_DIR), Backups ($BACKUP_DIR), Caddy, Node.js."
  if [ "$INTERACTIVE" -eq 1 ]; then
    confirm "Dienste jetzt entfernen?" n || die "Abgebrochen – nichts wurde geändert."
  elif [ "$ASSUME_YES" -ne 1 ]; then
    die "Ohne Terminal bitte ausdrücklich bestätigen: bash install.sh uninstall --yes"
  fi
  try systemctl disable --now "${SERVICES[@]}" || true
  local unit
  for unit in "${SERVICES[@]}"; do run rm -f "$UNIT_DIR/$unit.service"; done
  try systemctl daemon-reload || true
  site="$(caddy_site_file)"
  if [ -f "$site" ]; then
    run rm -f "$site"
    if command -v caddy >/dev/null 2>&1; then try systemctl reload caddy || true; fi
  fi
  run rm -f "$WRAPPER_PATH"
  ok "Dienste, Caddy-Seite und 'chfree' entfernt"

  if [ "$PURGE" -eq 1 ]; then
    if [ "$INTERACTIVE" -ne 1 ]; then
      warn "--purge braucht eine Bestätigung am Terminal – Daten, .env und Programmordner bleiben erhalten."
    else
      printf '\n%s    ACHTUNG: Das löscht die Datenbank mit allen Konten und Servern-Zuordnungen, die .env mit dem\n' "$C_RED"
      printf '    Datenbank-Schlüssel und den Programmordner unwiderruflich. Backups in %s bleiben.%s\n' "$BACKUP_DIR" "$C_RESET"
      ask answer "Zum Bestätigen LÖSCHEN eintippen" ""
      if [ "$answer" = "LÖSCHEN" ] || [ "$answer" = "LOESCHEN" ]; then
        run rm -rf "$DATA_DIR" "$INSTALL_DIR" "$CACHE_DIR"
        if id -u "$SERVICE_USER" >/dev/null 2>&1; then try userdel "$SERVICE_USER" || true; fi
        ok "Daten, .env und Programmordner gelöscht"
      else
        info "Nicht bestätigt – Daten, .env und Programmordner bleiben erhalten."
      fi
    fi
  else
    info "Daten und .env wurden NICHT gelöscht. Vollständig entfernen: bash install.sh uninstall --purge"
  fi
}

# ---------------------------------------------------------------- Abläufe ---
load_cfg_from_env() { # für update: Werte aus der vorhandenen .env
  local app_url
  app_url="$(get_env APP_URL)"
  CFG_DOMAIN="$(get_env SITE_DOMAIN)"
  [ -z "$CFG_DOMAIN" ] && CFG_DOMAIN="${app_url#*://}" && CFG_DOMAIN="${CFG_DOMAIN%%/*}"
  CFG_PANEL_URL="$(get_env PTERODACTYL_URL)"
  CFG_PTERO_MODE="$(get_env PTERODACTYL_MODE)"
  CFG_ADMIN_EMAILS="$(get_env ADMIN_EMAILS)"
  CFG_ADMIN_PATH="$(get_env ADMIN_PATH)"
  CFG_SMTP_HOST="$(get_env SMTP_HOST)"
  CFG_ACME_EMAIL="${CHF_ACME_EMAIL:-${CFG_ADMIN_EMAILS%%,*}}"
  case "${CHF_WWW:-auto}" in
    yes | true | 1) CFG_WWW="yes" ;;
    no | false | 0) CFG_WWW="no" ;;
    *) if [[ "$CFG_DOMAIN" =~ ^[^.]+\.[^.]+$ ]]; then CFG_WWW="yes"; else CFG_WWW="no"; fi ;;
  esac
}

flow_install() { # install + reconfigure
  detect_os
  install_base_packages
  ensure_user_and_dirs
  fetch_source
  collect_config
  write_env
  install_node
  install_caddy
  build_app
  if [ "$MODE" = "reconfigure" ] && ! is_dry && [ -f "$(db_path)" ] && [ "${CHF_SKIP_BACKUP:-0}" != "1" ]; then do_backup; fi
  migrate_db
  install_units
  install_wrapper
  restart_services
  configure_caddy
  wait_for_health
  print_summary
}

flow_update() {
  detect_os
  if ! is_dry; then
    [ -s "$ENV_FILE" ] || die "Keine Installation gefunden ($ENV_FILE fehlt). Zuerst installieren: bash install.sh"
  fi
  if [ "${CHF_UPDATE_STAGE:-1}" = "1" ]; then
    ensure_user_and_dirs
    fetch_source
    # Mit der frisch geladenen Fassung des Skripts weitermachen
    if ! is_dry && [ -f "$INSTALL_DIR/install.sh" ]; then
      local -a flags=()
      [ "$ASSUME_YES" -eq 1 ] && flags+=(--yes)
      [ "$PROXY" = "none" ] && flags+=(--no-caddy)
      export CHF_UPDATE_STAGE=2 CHF_INSTALL_DIR="$INSTALL_DIR" CHF_DATA_DIR="$DATA_DIR" CHF_BACKUP_DIR="$BACKUP_DIR" CHF_USER="$SERVICE_USER"
      exec bash "$INSTALL_DIR/install.sh" update --no-pull "${flags[@]}"
    fi
  fi
  load_cfg_from_env
  # Veraltete MariaDB-Variablen entfernen, neue Pflichtwerte sicherstellen (vorhandene Werte bleiben)
  if ! is_dry; then
    local v
    for v in DATABASE_URL DATABASE_POOL_SIZE DB_NAME DB_USER DB_PASSWORD DB_ROOT_PASSWORD; do unset_env "$v"; done
    if [ "$(get_env DATABASE_ENCRYPTION_KEY | wc -c)" -lt 32 ]; then
      [ -f "$(db_path)" ] && die "DATABASE_ENCRYPTION_KEY fehlt in $ENV_FILE, aber es gibt bereits eine Datenbank. Schlüssel aus dem Backup eintragen."
      set_env DATABASE_ENCRYPTION_KEY "$(openssl rand -hex 32)"
      info "Neuer Datenbank-Schlüssel erzeugt (in $ENV_FILE – bitte sichern)."
    fi
    [ -z "$(get_env DATABASE_PATH)" ] && set_env DATABASE_PATH "$DATA_DIR/chfree.db"
    chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  install_node
  build_app
  if ! is_dry && [ -f "$(db_path)" ] && [ "${CHF_SKIP_BACKUP:-0}" != "1" ]; then do_backup; fi
  migrate_db
  install_units
  install_wrapper
  restart_services
  if [ "$PROXY" = "caddy" ] && [ -f "$(caddy_site_file)" ]; then configure_caddy; fi
  wait_for_health
  printf '\n%s  Aktualisierung abgeschlossen.%s  Status: chfree status\n' "$C_GREEN$C_BOLD" "$C_RESET"
}

main() {
  parse_args "$@"
  if [ "$MODE" = "help" ]; then usage; exit 0; fi
  init_runtime
  case "$MODE" in
    install | reconfigure)
      if [ "$MODE" = "reconfigure" ] && ! is_dry && [ ! -s "$ENV_FILE" ]; then
        die "Keine Installation gefunden ($ENV_FILE fehlt). Zuerst installieren: bash install.sh"
      fi
      printf '%s\n  CraftingHosting.free – %s%s\n' "$C_BOLD" "$([ "$MODE" = "install" ] && echo Installation || echo 'Konfiguration ändern')" "$C_RESET"
      if is_dry; then printf '  %s(Dry-Run: am System wird nichts geändert)%s\n' "$C_YELLOW" "$C_RESET"; fi
      flow_install ;;
    update) flow_update ;;
    status) do_status ;;
    backup) do_backup ;;
    logs) do_logs ;;
    cli) do_cli ;;
    uninstall) do_uninstall ;;
  esac
}

main "$@"
exit 0
