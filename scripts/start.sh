#!/usr/bin/env bash
# Pokrece ceo meteo-stanica lanac: Mosquitto (sistemski servis) + bore tunel + Go server
# (Go server sam servira izgradjenu React stranicu, pa poseban "frontend" korak nije
# potreban dok god je "npm run build" vec odradjen u web/).
#
# Koristi:  ./start.sh
# Zaustavljanje: Ctrl+C (ugasi sve sto je ova skripta pokrenula)

set -euo pipefail

# ---------- Podesavanja (po potrebi izmeni) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"   # start.sh je u scripts/, server/ i web/ su jedan nivo iznad
SERVER_DIR="$PROJECT_DIR/server"
WEB_DIR="$PROJECT_DIR/web"

BORE_PORT=41883          # isti broj kao u ESP kodu (MQTT_PORT) i bore komandi
MQTT_USER="meteo-server"        # promeni ako koristis drugi nalog za server
MQTT_PASS="${MQTT_PASS:-}"   # bolje proslediti kao env var: MQTT_PASS=... ./start.sh

LOG_DIR="$SCRIPT_DIR/logs"   # ostaje u scripts/logs, kao na tvojoj strukturi
mkdir -p "$LOG_DIR"
# ------------------------------------------------------

BORE_PID=""
SERVER_PID=""

cleanup() {
  echo
  echo "Gasim procese..."
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$BORE_PID"   ]] && kill "$BORE_PID"   2>/dev/null || true
  wait 2>/dev/null || true
  echo "Gotovo."
}
trap cleanup EXIT INT TERM

echo "== 1/3: Mosquitto =="
if systemctl is-active --quiet mosquitto; then
  echo "Mosquitto vec radi."
else
  echo "Pokrecem Mosquitto (treba sudo lozinka)..."
  sudo systemctl start mosquitto
  sleep 1
  if systemctl is-active --quiet mosquitto; then
    echo "Mosquitto pokrenut."
  else
    echo "GRESKA: Mosquitto nije uspeo da se pokrene. Proveri: journalctl -u mosquitto -n 20"
    exit 1
  fi
fi

echo
echo "== 2/3: bore tunel (bore.pub:$BORE_PORT -> localhost:1883) =="
if ! command -v bore &> /dev/null; then
  echo "GRESKA: 'bore' nije pronadjen u PATH-u. Instaliraj ga (yay -S bore ili sa github.com/ekzhang/bore/releases)."
  exit 1
fi
bore local 1883 --to bore.pub --port "$BORE_PORT" > "$LOG_DIR/bore.log" 2>&1 &
BORE_PID=$!
sleep 2
if ! kill -0 "$BORE_PID" 2>/dev/null; then
  echo "GRESKA: bore se ugasio odmah. Pogledaj $LOG_DIR/bore.log"
  cat "$LOG_DIR/bore.log"
  exit 1
fi
echo "bore pokrenut (PID $BORE_PID), log: $LOG_DIR/bore.log"

echo
echo "== 3/3: Go server (servira i React stranicu) =="
if [[ ! -d "$WEB_DIR/dist" ]]; then
  echo "Upozorenje: $WEB_DIR/dist ne postoji. Pokreni 'npm install && npm run build' u $WEB_DIR"
fi
if [[ -z "$MQTT_PASS" ]]; then
  echo "Upozorenje: MQTT_PASS nije postavljen. Pokreni npr.: MQTT_PASS=tvoja-lozinka ./start.sh"
fi

cd "$SERVER_DIR"
go run . -user "$MQTT_USER" -pass "$MQTT_PASS" > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
sleep 2
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "GRESKA: Go server se ugasio odmah. Pogledaj $LOG_DIR/server.log"
  cat "$LOG_DIR/server.log"
  exit 1
fi
echo "Go server pokrenut (PID $SERVER_PID), log: $LOG_DIR/server.log"

echo
echo "================================================"
echo "Sve radi. Stranica: http://localhost:8080"
echo "Logovi u: $LOG_DIR/ (bore.log, server.log)"
echo "Pritisni Ctrl+C da zaustavis bore i server (Mosquitto ostaje, jer je sistemski servis)."
echo "================================================"

wait