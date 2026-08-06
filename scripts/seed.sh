#!/usr/bin/env bash
# MóvilApp seed script — run after the API server has started
# Usage: bash scripts/seed.sh [PORT]

PORT=${1:-$PORT}
if [ -z "$PORT" ]; then
  echo "Usage: bash scripts/seed.sh <PORT>"
  exit 1
fi

BASE="http://localhost:$PORT/api"
echo "Seeding $BASE ..."

register() {
  local NAME=$1 PHONE=$2 PASS=$3 ROLE=$4
  RES=$(curl -s -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"phone\":\"$PHONE\",\"password\":\"$PASS\",\"role\":\"$ROLE\"}")
  echo "$NAME: $(echo "$RES" | grep -o '"id":[0-9]*' | head -1)"
}

# Conductores
register "Carlos Gómez"   "+573110000001" "driver123" "driver"
register "María Torres"   "+573110000002" "driver123" "driver"
register "Luis Herrera"   "+573110000003" "driver123" "driver"

# Pasajeros
register "Juan Martínez"  "+573120000001" "pass123"   "passenger"
register "Sofía Ramírez"  "+573120000002" "pass123"   "passenger"
register "Ana López"      "+573120000003" "pass123"   "passenger"

# Admin (registered as driver, update role via DB)
register "Administrador"  "+573000000000" "admin123"  "driver"

echo ""
echo "Done! Update admin role manually:"
echo "  psql \$DATABASE_URL -c \"UPDATE users SET role='admin' WHERE phone='+573000000000'\""
echo ""
echo "Test credentials:"
echo "  Driver:    +573110000001 / driver123"
echo "  Passenger: +573120000001 / pass123"
echo "  Admin:     +573000000000 / admin123 (after role update)"
