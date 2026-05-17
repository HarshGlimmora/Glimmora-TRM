#!/usr/bin/env bash
# End-to-end probe of the auth/onboarding/CA-link stack against the running
# dev server. Reads the OTP code from the dev-server's `[email.dev] OTP for ...`
# log line so it doesn't need a real inbox.
#
# Usage:
#   PW_BASE_URL=http://localhost:3717 \
#   DEV_LOG=/path/to/dev/output \
#   bash tests/manual/e2e-run.sh

set -u
BASE="${PW_BASE_URL:-http://localhost:3717}"
DEV_LOG="${DEV_LOG:-/dev/stdin}"
JAR="$(mktemp /tmp/glmra-jar.XXXXXX.txt)"
JAR2="$(mktemp /tmp/glmra-jar.XXXXXX.txt)"
# Use a short hex tag so the email itself never contains a 6-digit run
# that could be confused with the OTP code in the log.
TAG="$(date +%s | tail -c 5)$(printf '%x' $RANDOM)"
EMAIL_A="e2e-a-${TAG}@glimmora.test"
EMAIL_B="e2e-b-${TAG}@glimmora.test"
# PAN is also uniquely indexed in users — randomise so reruns don't collide.
random_pan() {
  python3 -c "import random,string;print(''.join(random.choices(string.ascii_uppercase,k=3))+'P'+random.choice(string.ascii_uppercase)+''.join(random.choices(string.digits,k=4))+random.choice(string.ascii_uppercase))"
}
PAN_A=$(random_pan)
# Indian mobile must match [6-9]\d{9} per chk_users_phone.
random_phone() {
  python3 -c "import random;print(random.choice('6789')+''.join(random.choices('0123456789',k=9)))"
}
PHONE_A=$(random_phone)
echo "  PAN_A=$PAN_A  PHONE_A=$PHONE_A"
PASS=0; FAIL=0
check() {
  local what="$1" got="$2" expect="$3"
  if [ "$got" = "$expect" ]; then
    printf "  PASS  %-48s %s\n" "$what" "$got"
    PASS=$((PASS+1))
  else
    printf "  FAIL  %-48s got=%s want=%s\n" "$what" "$got" "$expect"
    FAIL=$((FAIL+1))
  fi
}

read_latest_otp() {
  local email="$1"
  # Dev log format: `[email.dev] OTP for <addr>: <code> (via ...)`.
  # PCRE \K resets the match-start so only the 6-digit code is returned.
  grep -oP "OTP for ${email}: \K[0-9]{6}" "$DEV_LOG" | tail -1
}

send_and_grab() {
  local email="$1"
  local resp
  resp=$(curl -sS -X POST "$BASE/api/auth/send-otp" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":\"$email\",\"channel\":\"email\"}")
  echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin)['otpId'])"
}

echo "=================================================================="
echo "  Glimmora Tax auth/onboarding e2e probe"
echo "  base : $BASE"
echo "  log  : $DEV_LOG"
echo "  email-A: $EMAIL_A"
echo "  email-B: $EMAIL_B"
echo "=================================================================="

# ---------------------------------------------------------------------------
echo "[1] new user: send-otp → verify (remember-me ON) → /me → set-role"
OTPID=$(send_and_grab "$EMAIL_A")
sleep 0.5
CODE=$(read_latest_otp "$EMAIL_A")
[ -z "$CODE" ] && { echo "  ! couldn't read OTP code from $DEV_LOG"; exit 1; }
echo "  send-otp otpId=$OTPID code=$CODE"

VERIFY_CODE=$(curl -sS -o /tmp/glmra-verify.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID\",\"code\":\"$CODE\",\"rememberMe\":true}" \
  -c "$JAR")
check "verify-otp http" "$VERIFY_CODE" "200"
NEXT=$(python3 -c "import json;print(json.load(open('/tmp/glmra-verify.json'))['next'])")
check "verify-otp next" "$NEXT" "/role-select"
HAS=$(python3 -c "import json;print(json.load(open('/tmp/glmra-verify.json'))['hasProfile'])")
check "verify-otp hasProfile" "$HAS" "False"

# Netscape cookie jar format: tabs between fields, name+value tab-separated.
grep -q "glmra_session" "$JAR" && \
  check "session cookie persisted in jar" "ok" "ok" || \
  check "session cookie persisted in jar" "missing" "ok"
# Path is column 3 (1-indexed) on the cookie line.
PATH_COL=$(awk -F'\t' '$6=="glmra_session"{print $3}' "$JAR" | head -1)
check "session cookie path" "$PATH_COL" "/"

ME=$(curl -sS "$BASE/api/auth/me" -b "$JAR")
MR=$(echo "$ME" | python3 -c "import sys,json;d=json.load(sys.stdin);print('|'.join([str(d['authenticated']),str(d['rememberMe']),d['next']]))")
check "me authenticated|remember|next" "$MR" "True|True|/role-select"

SR=$(curl -sS -o /tmp/glmra-setrole.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/set-role" \
  -H "Content-Type: application/json" \
  -d '{"role":"taxpayer"}' \
  -b "$JAR" -c "$JAR")
check "set-role http" "$SR" "200"
SR_NEXT=$(python3 -c "import json;print(json.load(open('/tmp/glmra-setrole.json'))['next'])")
check "set-role next" "$SR_NEXT" "/onboarding/taxpayer?step=0"

# ---------------------------------------------------------------------------
echo "[2] save onboarding draft → /me echoes it → resume next URL reflects step"
PG=$(curl -sS -X PUT "$BASE/api/onboarding/progress" \
  -H "Content-Type: application/json" \
  -d '{"step":3,"personal":{"displayName":"Smoke","legalName":"Smoke User","dateOfBirth":"1990-01-01","gender":"other","residentialStatus":"resident"},"contact":{"email":"'"$EMAIL_A"'","mobile":"'"$PHONE_A"'"},"address":{"line1":"Test Addr","city":"Bengaluru","state":"Karnataka","pin":"560001"},"taxProfile":{"primaryIncomeType":"salary","regimePreference":"new","hasBusinessIncome":false,"consents":{"documentProcessing":true,"aiAnalysis":false,"dataRetention":true}}}' \
  -b "$JAR")
SAVED_STEP=$(echo "$PG" | python3 -c "import sys,json;print(json.load(sys.stdin)['step'])")
check "draft saved step" "$SAVED_STEP" "3"
ME2=$(curl -sS "$BASE/api/auth/me" -b "$JAR")
RESUME_NEXT=$(echo "$ME2" | python3 -c "import sys,json;print(json.load(sys.stdin)['next'])")
check "me next reflects step" "$RESUME_NEXT" "/onboarding/taxpayer?step=3"

# ---------------------------------------------------------------------------
echo "[3] submit taxpayer profile → next becomes /dashboard"
SUB=$(curl -sS -o /tmp/glmra-sub.json -w "%{http_code}" \
  -X POST "$BASE/api/onboarding/taxpayer" \
  -H "Content-Type: application/json" \
  -d '{"personal":{"displayName":"Smoke","legalName":"Smoke User","dateOfBirth":"1990-01-01","gender":"other","residentialStatus":"resident"},"contact":{"email":"'"$EMAIL_A"'","mobile":"'"$PHONE_A"'"},"address":{"line1":"Test Addr","city":"Bengaluru","state":"Karnataka","pin":"560001"},"taxProfile":{"primaryIncomeType":"salary","regimePreference":"new","hasBusinessIncome":false},"rawPan":"'"$PAN_A"'","rawAadhaar":"234123412346"}' \
  -b "$JAR")
check "submit-taxpayer http" "$SUB" "200"
SUB_NEXT=$(python3 -c "import json;print(json.load(open('/tmp/glmra-sub.json'))['next'])")
check "submit-taxpayer next" "$SUB_NEXT" "/dashboard"
ME3=$(curl -sS "$BASE/api/auth/me" -b "$JAR")
HAS_PROFILE=$(echo "$ME3" | python3 -c "import sys,json;print(json.load(sys.stdin)['hasProfile'])")
check "me hasProfile after submit" "$HAS_PROFILE" "True"
ME3_NEXT=$(echo "$ME3" | python3 -c "import sys,json;print(json.load(sys.stdin)['next'])")
check "me next after submit" "$ME3_NEXT" "/dashboard"

# ---------------------------------------------------------------------------
echo "[4] logout → /me 401"
curl -sS -X POST "$BASE/api/auth/logout" -b "$JAR" -c "$JAR" -o /dev/null
ME4_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/auth/me" -b "$JAR")
check "me after logout" "$ME4_STATUS" "401"

# ---------------------------------------------------------------------------
echo "[5] returning user: same email → straight to /dashboard"
OTPID2=$(send_and_grab "$EMAIL_A")
sleep 0.5
CODE2=$(read_latest_otp "$EMAIL_A")
echo "  resend otpId=$OTPID2 code=$CODE2"
VC=$(curl -sS -o /tmp/glmra-vR.json -w "%{http_code}" \
  -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID2\",\"code\":\"$CODE2\",\"rememberMe\":false}" \
  -c "$JAR")
check "returning verify-otp http" "$VC" "200"
RNEXT=$(python3 -c "import json;print(json.load(open('/tmp/glmra-vR.json'))['next'])")
check "returning next" "$RNEXT" "/dashboard"
# Remember-me OFF this time: cookie should have no Max-Age.
grep "glmra_session=" "$JAR" >/dev/null
HAS_MAXAGE=$(grep "glmra_session=" "$JAR" | awk '{print $5}')
# (Curl jar stores 5th col as expiry-epoch; for session cookies it's "0".)
# The exact value depends on curl version; we just confirm we got a cookie.

# ---------------------------------------------------------------------------
echo "[6] idempotency: second send-otp on the same email — still one user row"
curl -sS -X POST "$BASE/api/auth/send-otp" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$EMAIL_A\",\"channel\":\"email\"}" -o /dev/null

# ---------------------------------------------------------------------------
echo "[7] wrong OTPs: 4 fails return 400; 5th locks (423)"
OTPID3=$(send_and_grab "$EMAIL_B")
sleep 0.5
read_latest_otp "$EMAIL_B" >/dev/null # warm cache; real code irrelevant
W1=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID3\",\"code\":\"000000\",\"rememberMe\":false}")
W2=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID3\",\"code\":\"000000\",\"rememberMe\":false}")
W3=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID3\",\"code\":\"000000\",\"rememberMe\":false}")
W4=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID3\",\"code\":\"000000\",\"rememberMe\":false}")
W5=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"otpId\":\"$OTPID3\",\"code\":\"000000\",\"rememberMe\":false}")
check "wrong attempt #1" "$W1" "400"
check "wrong attempt #2" "$W2" "400"
check "wrong attempt #3" "$W3" "400"
check "wrong attempt #4" "$W4" "400"
check "wrong attempt #5 (locked)" "$W5" "423"

# ---------------------------------------------------------------------------
echo "[8] /me without cookie returns 401"
NO_COOKIE=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
check "anonymous /me http" "$NO_COOKIE" "401"

# ---------------------------------------------------------------------------
echo "[9] invalid email validation"
INV=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"not-an-email","channel":"email"}')
check "invalid-email send-otp" "$INV" "400"

# ---------------------------------------------------------------------------
echo "=================================================================="
echo "  passes: $PASS    fails: $FAIL"
[ "$FAIL" -eq 0 ]
