#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test.sh — Qween 3-in-1 test suite
#
# Tests each app independently with its own section.
#
# Usage:
#   ./test.sh                                      # defaults
#   ./test.sh --api http://localhost:8000
#   ./test.sh --app http://localhost:3000
#   ./test.sh --web http://localhost:5000
#   ./test.sh --api https://g4lk22-8000.csb.app \
#             --app https://g4lk22-3000.csb.app \
#             --web https://g4lk22-5000.csb.app
#   ./test.sh --only api
#   ./test.sh --only app
#   ./test.sh --only web
#
# Requires: curl, jq
# ─────────────────────────────────────────────────────────────────────────────

# ── Defaults ──────────────────────────────────────────────────────────────────
API_URL="http://localhost:8000"
APP_URL="http://localhost:3000"
WEB_URL="http://localhost:5000"
ONLY=""

# ── Arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)  API_URL="$2"; shift 2 ;;
    --app)  APP_URL="$2"; shift 2 ;;
    --web)  WEB_URL="$2"; shift 2 ;;
    --only) ONLY="$2";    shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
BLUE='\033[0;34m'; MAGENTA='\033[0;35m'

PASS=0; FAIL=0; SKIP=0

pass()    { echo -e "  ${GREEN}✓${RESET} $*"; PASS=$((PASS+1)); }
fail()    { echo -e "  ${RED}✗${RESET} $*"; FAIL=$((FAIL+1)); }
skip()    { echo -e "  ${DIM}–${RESET} $* ${DIM}(skipped)${RESET}"; SKIP=$((SKIP+1)); }
info()    { echo -e "  ${CYAN}→${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $*"; }
section() { echo -e "\n${BOLD}${BLUE}$*${RESET}"; echo -e "${DIM}$(printf '%.0s─' {1..50})${RESET}"; }
header()  { echo -e "\n${BOLD}${MAGENTA}━━━ $* ━━━${RESET}"; }

require_cmd() { command -v "$1" &>/dev/null || { echo -e "${RED}ERROR: '$1' not found.${RESET}"; exit 1; }; }
jf()          { echo "$1" | jq -r ".$2 // empty" 2>/dev/null; }

http_code() { curl -so /dev/null -w "%{http_code}" --max-time 10 "$@"; }
get_json()  { curl -sf --max-time 10 "$@"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
assert_http() {
  # assert_http <label> <expected_code> <actual_code>
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label → HTTP $actual"
  else
    fail "$label → expected HTTP $expected, got HTTP $actual"
  fi
}

assert_json_field() {
  # assert_json_field <label> <json> <field> <expected_value>
  local label="$1" json="$2" field="$3" expected="$4"
  local actual; actual=$(jf "$json" "$field")
  if [ "$actual" = "$expected" ]; then
    pass "$label: .$field = \"$actual\""
  else
    fail "$label: .$field expected \"$expected\", got \"$actual\""
  fi
}

assert_json_exists() {
  # assert_json_exists <label> <json> <field>
  local label="$1" json="$2" field="$3"
  local val; val=$(jf "$json" "$field")
  if [ -n "$val" ]; then
    pass "$label: .$field exists (\"${val:0:40}\")"
  else
    fail "$label: .$field missing or null"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
require_cmd curl
require_cmd jq

echo -e "${BOLD}Qween — test suite${RESET}"
echo    "  API : $API_URL"
echo    "  APP : $APP_URL"
echo    "  WEB : $WEB_URL"
[ -n "$ONLY" ] && echo -e "  ${YELLOW}Running only: $ONLY${RESET}"
echo    "  Date: $(date)"

# ═════════════════════════════════════════════════════════════════════════════
# APP — Node.js renderer (port 3000)
# ═════════════════════════════════════════════════════════════════════════════
if [ -z "$ONLY" ] || [ "$ONLY" = "app" ]; then
  header "APP — Node.js Renderer ($APP_URL)"

  section "Health"
  R=$(get_json "$APP_URL/health")
  if [ $? -ne 0 ]; then
    fail "Server unreachable at $APP_URL — is apps/app running?"
  else
    assert_json_field "health" "$R" "status" "ok"
    assert_json_exists "health" "$R" "port"
    info "Projects stored: $(jf "$R" "projects")"
  fi

  section "Static files"
  CODE=$(http_code "$APP_URL/QweenRender.html")
  assert_http "GET /QweenRender.html" "200" "$CODE"

  CODE=$(http_code "$APP_URL/")
  assert_http "GET / (serves QweenRender.html)" "200" "$CODE"

  # Check QweenRender.html has the Playwright hooks injected
  BODY=$(curl -sf --max-time 10 "$APP_URL/QweenRender.html")
  if echo "$BODY" | grep -q "__qween_ready"; then
    pass "QweenRender.html contains __qween_ready hook"
  else
    fail "QweenRender.html missing __qween_ready hook — Playwright won't work"
  fi
  if echo "$BODY" | grep -q "__qween_seek"; then
    pass "QweenRender.html contains __qween_seek hook"
  else
    fail "QweenRender.html missing __qween_seek hook"
  fi
  if echo "$BODY" | grep -q "__qween_frame_ready"; then
    pass "QweenRender.html contains __qween_frame_ready hook"
  else
    fail "QweenRender.html missing __qween_frame_ready hook"
  fi
  if echo "$BODY" | grep -q "AnimationEngine"; then
    pass "QweenRender.html contains AnimationEngine"
  else
    fail "QweenRender.html missing AnimationEngine"
  fi

  section "404 handling"
  CODE=$(http_code "$APP_URL/does-not-exist.html")
  assert_http "GET /nonexistent" "404" "$CODE"

  section "Path traversal protection"
  CODE=$(http_code "$APP_URL/../../../etc/passwd")
  if [ "$CODE" = "403" ] || [ "$CODE" = "404" ]; then
    pass "Path traversal blocked → HTTP $CODE"
  else
    fail "Path traversal NOT blocked → HTTP $CODE"
  fi

  section "CORS headers"
  CORS=$(curl -sf --max-time 10 -I "$APP_URL/health" | grep -i "access-control-allow-origin" | tr -d '\r')
  if echo "$CORS" | grep -q "\*"; then
    pass "CORS: Access-Control-Allow-Origin: *"
  else
    fail "CORS header missing or wrong: '$CORS'"
  fi

  section "Projects endpoint"
  R=$(get_json "$APP_URL/projects")
  if [ $? -eq 0 ] && echo "$R" | jq -e '.projects' &>/dev/null; then
    pass "GET /projects → JSON with .projects array"
    info "Projects count: $(echo "$R" | jq '.projects | length')"
  else
    fail "GET /projects failed: $R"
  fi

  section "OPTIONS preflight"
  CODE=$(curl -so /dev/null -w "%{http_code}" --max-time 10 -X OPTIONS "$APP_URL/health")
  assert_http "OPTIONS /health (CORS preflight)" "204" "$CODE"

fi

# ═════════════════════════════════════════════════════════════════════════════
# API — FastAPI (port 8000)
# ═════════════════════════════════════════════════════════════════════════════
if [ -z "$ONLY" ] || [ "$ONLY" = "api" ]; then
  header "API — FastAPI ($API_URL)"

  section "Health"
  R=$(get_json "$API_URL/health")
  if [ $? -ne 0 ]; then
    fail "Server unreachable at $API_URL — is apps/api running?"
  else
    assert_json_field "health" "$R" "status" "ok"
    assert_json_exists "health" "$R" "ffmpeg"
    assert_json_exists "health" "$R" "version"
    info "FFmpeg  : $(jf "$R" "ffmpeg")"
    info "Version : $(jf "$R" "version")"
    info "Storage : $(jf "$R" "storage_used_mb") MB"
    info "Jobs    : $(jf "$R" "active_jobs") active"
  fi

  section "Storage"
  R=$(get_json "$API_URL/storage")
  if [ $? -eq 0 ]; then
    pass "GET /storage → OK"
    assert_json_exists "storage" "$R" "storage_used_mb"
  else
    fail "GET /storage failed"
  fi

  section "Jobs list"
  CODE=$(http_code "$API_URL/jobs")
  assert_http "GET /jobs" "200" "$CODE"

  section "Asset upload"
  DUMMY=$(mktemp /tmp/test_XXXXXX.woff2)
  printf '\x77\x4f\x46\x46' > "$DUMMY"
  R=$(curl -sf --max-time 10 -X POST "$API_URL/assets/upload" \
    -F "file=@${DUMMY};filename=test.woff2")
  if [ $? -eq 0 ] && echo "$R" | jq -e '.asset_id' &>/dev/null; then
    ASSET_ID=$(jf "$R" "asset_id")
    pass "POST /assets/upload → asset_id: ${ASSET_ID:0:8}…"
  else
    fail "POST /assets/upload failed: $R"
    ASSET_ID=""
  fi
  rm -f "$DUMMY"

  section "Asset deduplication"
  if [ -n "$ASSET_ID" ]; then
    DUMMY2=$(mktemp /tmp/test_XXXXXX.woff2)
    printf '\x77\x4f\x46\x46' > "$DUMMY2"
    R2=$(curl -sf --max-time 10 -X POST "$API_URL/assets/upload" \
      -F "file=@${DUMMY2};filename=test.woff2")
    ID2=$(jf "$R2" "asset_id")
    rm -f "$DUMMY2"
    [ "$ASSET_ID" = "$ID2" ] \
      && pass "Same content returns same asset_id (dedup works)" \
      || fail "Dedup failed — different asset_id for identical bytes"
  else
    skip "Asset dedup (no asset_id from previous step)"
  fi

  section "Asset fetch"
  if [ -n "$ASSET_ID" ]; then
    CODE=$(http_code "$API_URL/assets/$ASSET_ID")
    assert_http "GET /assets/$ASSET_ID" "200" "$CODE"
  else
    skip "Asset fetch (no asset_id)"
  fi

  section "Asset delete"
  if [ -n "$ASSET_ID" ]; then
    CODE=$(http_code -X DELETE "$API_URL/assets/$ASSET_ID")
    if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
      pass "DELETE /assets/$ASSET_ID → HTTP $CODE"
    else
      fail "DELETE /assets/$ASSET_ID → HTTP $CODE"
    fi
  else
    skip "Asset delete (no asset_id)"
  fi

  section "Render-project validation"
  DUMMY_JSON=$(mktemp /tmp/test_XXXXXX.json)
  echo '{"nodes":[],"tweens":[{"delay":0,"duration":2}]}' > "$DUMMY_JSON"

  CODE=$(http_code -X POST "$API_URL/jobs/render-project")
  assert_http "POST /jobs/render-project (no file) → 422" "422" "$CODE"

  CODE=$(http_code -X POST "$API_URL/jobs/render-project" \
    -F "file=@${DUMMY_JSON};filename=project.json" -F "format=avi")
  assert_http "POST /jobs/render-project (bad format) → 400" "400" "$CODE"

  CODE=$(http_code -X POST "$API_URL/jobs/render-project" \
    -F "file=@${DUMMY_JSON};filename=project.json" -F "format=gif")
  assert_http "POST /jobs/render-project (gif) → 400" "400" "$CODE"
  rm -f "$DUMMY_JSON"

  section "Render-project — submit minimal project"
  MINIMAL=$(mktemp /tmp/test_XXXXXX.json)
  cat > "$MINIMAL" << 'ENDJSON'
{
  "version": "68",
  "timelineLoop": false,
  "timelineYoyo": false,
  "timelineReverse": false,
  "tweens": [{"id":"t1","targets":["#box"],"duration":2,"delay":0,"vars":{"x":200,"opacity":1},"ease":"power2.out"}],
  "effects": [], "templates": [], "swapTemplates": [],
  "initialStates": [], "globalDataSources": [], "fonts": [],
  "nodes": [{
    "id": "node-1", "type": "svg", "width": 640, "height": 360,
    "zIndex": 0, "visible": true,
    "_svgContent": "<svg id=\"main-svg-root\" viewBox=\"0 0 640 360\" xmlns=\"http://www.w3.org/2000/svg\"><rect id=\"box\" x=\"50\" y=\"130\" width=\"80\" height=\"80\" fill=\"#7c6dfa\" opacity=\"0\"/></svg>"
  }]
}
ENDJSON

  R=$(curl -sf --max-time 15 -X POST "$API_URL/jobs/render-project" \
    -F "file=@${MINIMAL};filename=project.json" \
    -F "fps=10" -F "format=mp4" -F "end_time=2")
  rm -f "$MINIMAL"

  if [ $? -eq 0 ] && echo "$R" | jq -e '.job_id' &>/dev/null; then
    RENDER_JOB=$(jf "$R" "job_id")
    pass "Job queued → ${RENDER_JOB:0:8}…"
    info "Stage   : $(jf "$R" "stage")"
    info "EndTime : $(jf "$R" "end_time")s"
    info "Format  : $(jf "$R" "format")"
  else
    fail "render-project submit failed: $R"
    RENDER_JOB=""
  fi

  section "Job status poll"
  if [ -n "$RENDER_JOB" ]; then
    info "Polling /jobs/$RENDER_JOB/status …"
    ELAPSED=0; DONE=0
    while [ $ELAPSED -lt 300 ]; do
      SR=$(get_json "$API_URL/jobs/$RENDER_JOB/status")
      STATUS=$(jf "$SR" "status")
      PROG=$(jf "$SR" "progress")
      MSG=$(jf "$SR" "message")
      echo -ne "\r  ${CYAN}[${STATUS}]${RESET} ${MSG} (${PROG}%)       "
      if [ "$STATUS" = "done" ]; then echo; pass "Render completed"; DONE=1; break; fi
      if [ "$STATUS" = "error" ]; then echo; fail "Render error: $MSG"; DONE=1; break; fi
      sleep 3; ELAPSED=$((ELAPSED+3))
    done
    [ $DONE -eq 0 ] && { echo; fail "Render timed out after ${ELAPSED}s"; }
  else
    skip "Job poll (no job queued)"
  fi

  section "Job download"
  if [ -n "$RENDER_JOB" ] && [ "$(jf "$SR" "status" 2>/dev/null)" = "done" ]; then
    OUT="qween_test.mp4"
    CODE=$(curl -sf --max-time 30 -o "$OUT" -w "%{http_code}" \
      "$API_URL/jobs/$RENDER_JOB/download")
    if [ "$CODE" = "200" ] && [ -s "$OUT" ]; then
      BYTES=$(wc -c < "$OUT")
      pass "Downloaded → $OUT (${BYTES} bytes)"
    else
      fail "Download failed → HTTP $CODE"
    fi
  else
    skip "Download (render not done)"
  fi

  section "Job delete"
  if [ -n "$RENDER_JOB" ]; then
    CODE=$(http_code -X DELETE "$API_URL/jobs/$RENDER_JOB")
    if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
      pass "DELETE /jobs/$RENDER_JOB → HTTP $CODE"
    else
      fail "DELETE /jobs/$RENDER_JOB → HTTP $CODE"
    fi
  else
    skip "Job delete (no job)"
  fi

fi

# ═════════════════════════════════════════════════════════════════════════════
# WEB — Next.js (port 5000)
# ═════════════════════════════════════════════════════════════════════════════
if [ -z "$ONLY" ] || [ "$ONLY" = "web" ]; then
  header "WEB — Next.js ($WEB_URL)"

  section "Reachability"
  CODE=$(http_code "$WEB_URL")
  if [ "$CODE" = "200" ] || [ "$CODE" = "308" ] || [ "$CODE" = "307" ]; then
    pass "GET / → HTTP $CODE (Next.js is up)"
  else
    fail "GET / → HTTP $CODE (expected 200 or redirect)"
  fi

  section "Static assets"
  CODE=$(http_code "$WEB_URL/_next/static" 2>/dev/null || echo "000")
  # Next.js serves built assets — just check the page loads
  BODY=$(curl -sf --max-time 10 "$WEB_URL" 2>/dev/null)
  if echo "$BODY" | grep -qi "qween\|next\|react"; then
    pass "Web app HTML contains expected content"
  else
    warn "Web app response doesn't look like QweenFFmpeg — may still be building"
  fi

  section "API proxy (Next.js → FastAPI rewrite)"
  # next.config.js rewrites /api/ffmpeg/* → http://localhost:8000/*
  CODE=$(http_code "$WEB_URL/api/ffmpeg/health")
  if [ "$CODE" = "200" ]; then
    pass "GET /api/ffmpeg/health → 200 (proxy working)"
  elif [ "$CODE" = "502" ] || [ "$CODE" = "503" ]; then
    warn "Proxy returned $CODE — API may not be running or proxy not configured"
  else
    fail "GET /api/ffmpeg/health → $CODE (expected 200)"
  fi

fi

# ═════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════
TOTAL=$((PASS+FAIL+SKIP))
echo ""
echo -e "${BOLD}$(printf '%.0s─' {1..50})${RESET}"
echo -e "  ${GREEN}✓ ${PASS} passed${RESET}   ${RED}✗ ${FAIL} failed${RESET}   ${DIM}– ${SKIP} skipped${RESET}   (${TOTAL} total)"
echo -e "${BOLD}$(printf '%.0s─' {1..50})${RESET}"

[ $FAIL -eq 0 ] \
  && echo -e "\n  ${GREEN}${BOLD}All tests passed ✓${RESET}\n" \
  || echo -e "\n  ${RED}${BOLD}${FAIL} test(s) failed ✗${RESET}\n"

exit $FAIL
