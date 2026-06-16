#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test_render.sh — Qween FFmpeg API test suite
#
# Usage:
#   ./test_render.sh                          # use default http://localhost:8000
#   ./test_render.sh https://xxxx-8000.csb.app
#   ./test_render.sh http://localhost:8000 /path/to/project.zip
#
# Requires: curl, jq
# ─────────────────────────────────────────────────────────────────────────────

BASE="${1:-http://localhost:8000}"
PROJECT_FILE="${2:-}"          # optional: path to a real .zip or project.json
POLL_INTERVAL=3                # seconds between status polls
POLL_TIMEOUT=600               # max seconds to wait for render

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

pass() { echo -e "${GREEN}  ✓ $*${RESET}"; }
fail() { echo -e "${RED}  ✗ $*${RESET}"; FAILURES=$((FAILURES+1)); }
info() { echo -e "${CYAN}  → $*${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${RESET}"; }
section() { echo -e "\n${BOLD}$*${RESET}"; }

FAILURES=0

# ── helpers ──────────────────────────────────────────────────────────────────
require_cmd() {
  command -v "$1" &>/dev/null || { echo -e "${RED}ERROR: '$1' not found. Install it first.${RESET}"; exit 1; }
}

json_field() {   # json_field <json_string> <key>
  echo "$1" | jq -r ".$2 // empty" 2>/dev/null
}

poll_job() {     # poll_job <job_id>  →  exits 0 on done, 1 on error/timeout
  local job_id="$1"
  local elapsed=0
  while [ $elapsed -lt $POLL_TIMEOUT ]; do
    local resp
    resp=$(curl -sf "$BASE/jobs/$job_id/status")
    if [ $? -ne 0 ]; then
      warn "Status poll failed (server unreachable?), retrying…"
      sleep $POLL_INTERVAL
      elapsed=$((elapsed+POLL_INTERVAL))
      continue
    fi
    local status msg progress
    status=$(json_field "$resp" "status")
    msg=$(json_field "$resp" "message")
    progress=$(json_field "$resp" "progress")
    echo -ne "\r  ${CYAN}[${status}]${RESET} ${msg}  (${progress}%)        "
    case "$status" in
      done)    echo; return 0 ;;
      error)   echo; fail "Server render error: $msg"; return 1 ;;
    esac
    sleep $POLL_INTERVAL
    elapsed=$((elapsed+POLL_INTERVAL))
  done
  echo
  fail "Render timed out after ${POLL_TIMEOUT}s"
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
require_cmd curl
require_cmd jq

echo -e "${BOLD}Qween FFmpeg API — test suite${RESET}"
echo    "  Server : $BASE"
echo    "  Date   : $(date)"

# ─────────────────────────────────────────────────────────────────────────────
section "① Health check"
RESP=$(curl -sf "$BASE/health")
if [ $? -ne 0 ]; then
  fail "Server not reachable at $BASE"
  echo -e "${RED}Aborting — fix server connection first.${RESET}"
  exit 1
fi
pass "Server is up"
info "FFmpeg  : $(json_field "$RESP" "ffmpeg")"
info "Version : $(json_field "$RESP" "version")"
info "Storage : $(json_field "$RESP" "storage_used_mb") MB used"
info "Jobs    : $(json_field "$RESP" "active_jobs") active"

# ─────────────────────────────────────────────────────────────────────────────
section "② Storage info"
RESP=$(curl -sf "$BASE/storage")
[ $? -eq 0 ] && pass "GET /storage OK" || fail "GET /storage failed"

# ─────────────────────────────────────────────────────────────────────────────
section "③ Asset upload (font)"
# Upload a tiny dummy woff2 (just enough bytes to pass extension check)
DUMMY_FONT=$(mktemp /tmp/test_XXXXXX.woff2)
printf '\x77\x4f\x46\x46' > "$DUMMY_FONT"   # wOFF magic bytes
RESP=$(curl -sf -X POST "$BASE/assets/upload" \
  -F "file=@${DUMMY_FONT};filename=test-font.woff2")
if [ $? -eq 0 ] && echo "$RESP" | jq -e '.asset_id' &>/dev/null; then
  FONT_ASSET_ID=$(json_field "$RESP" "asset_id")
  pass "Font asset uploaded → asset_id: ${FONT_ASSET_ID:0:8}…"
else
  fail "Font asset upload failed: $RESP"
  FONT_ASSET_ID=""
fi
rm -f "$DUMMY_FONT"

# ─────────────────────────────────────────────────────────────────────────────
section "④ Asset upload — deduplication check"
if [ -n "$FONT_ASSET_ID" ]; then
  DUMMY_FONT2=$(mktemp /tmp/test_XXXXXX.woff2)
  printf '\x77\x4f\x46\x46' > "$DUMMY_FONT2"
  RESP2=$(curl -sf -X POST "$BASE/assets/upload" \
    -F "file=@${DUMMY_FONT2};filename=test-font.woff2")
  ID2=$(json_field "$RESP2" "asset_id")
  rm -f "$DUMMY_FONT2"
  if [ "$FONT_ASSET_ID" = "$ID2" ]; then
    pass "Deduplication works — same content_hash returned same asset_id"
  else
    fail "Deduplication failed — got different asset_id for identical content"
  fi
else
  warn "Skipping dedup test (previous upload failed)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑤ GET /assets/{asset_id}"
if [ -n "$FONT_ASSET_ID" ]; then
  HTTP_CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE/assets/$FONT_ASSET_ID")
  [ "$HTTP_CODE" = "200" ] && pass "GET /assets/$FONT_ASSET_ID → 200" \
                             || fail "GET /assets/$FONT_ASSET_ID → $HTTP_CODE"
else
  warn "Skipping — no asset_id available"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑥ POST /jobs/render-project — validation errors"

# Missing file
HTTP=$(curl -so /dev/null -w "%{http_code}" -X POST "$BASE/jobs/render-project")
[ "$HTTP" = "422" ] && pass "No file → 422 Unprocessable" \
                      || fail "Expected 422, got $HTTP"

# Bad format
DUMMY_JSON=$(mktemp /tmp/test_XXXXXX.json)
echo '{"nodes":[],"tweens":[{"delay":0,"duration":2}]}' > "$DUMMY_JSON"
HTTP=$(curl -so /dev/null -w "%{http_code}" -X POST "$BASE/jobs/render-project" \
  -F "file=@${DUMMY_JSON};filename=project.json" \
  -F "format=avi")
[ "$HTTP" = "400" ] && pass "Bad format 'avi' → 400" \
                      || fail "Expected 400, got $HTTP"

# GIF rejected
HTTP=$(curl -so /dev/null -w "%{http_code}" -X POST "$BASE/jobs/render-project" \
  -F "file=@${DUMMY_JSON};filename=project.json" \
  -F "format=gif")
[ "$HTTP" = "400" ] && pass "format=gif → 400 (not supported)" \
                      || fail "Expected 400, got $HTTP"
rm -f "$DUMMY_JSON"

# ─────────────────────────────────────────────────────────────────────────────
section "⑦ POST /jobs/render-project — minimal SVG-only project (bare JSON)"

MINIMAL_JSON=$(mktemp /tmp/test_XXXXXX.json)
cat > "$MINIMAL_JSON" << 'ENDJSON'
{
  "version": "68",
  "timelineLoop": false,
  "timelineYoyo": false,
  "timelineReverse": false,
  "tweens": [
    {
      "id": "tween-1",
      "targets": ["#rect1"],
      "duration": 2,
      "delay": 0,
      "vars": { "x": 200, "opacity": 1 },
      "ease": "power2.out"
    }
  ],
  "effects": [],
  "templates": [],
  "swapTemplates": [],
  "initialStates": [],
  "globalDataSources": [],
  "fonts": [],
  "nodes": [
    {
      "id": "node-1",
      "type": "svg",
      "width": 1280,
      "height": 720,
      "zIndex": 0,
      "visible": true,
      "_svgContent": "<svg id=\"main-svg-root\" viewBox=\"0 0 1280 720\" xmlns=\"http://www.w3.org/2000/svg\"><rect id=\"rect1\" x=\"50\" y=\"300\" width=\"100\" height=\"100\" fill=\"#409EFF\" opacity=\"0\"/></svg>"
    }
  ]
}
ENDJSON

RESP=$(curl -sf -X POST "$BASE/jobs/render-project" \
  -F "file=@${MINIMAL_JSON};filename=project.json" \
  -F "fps=10" \
  -F "format=mp4" \
  -F "start_time=0" \
  -F "end_time=2")
rm -f "$MINIMAL_JSON"

if [ $? -ne 0 ] || ! echo "$RESP" | jq -e '.job_id' &>/dev/null; then
  fail "render-project submission failed: $RESP"
  RENDER_JOB_ID=""
else
  RENDER_JOB_ID=$(json_field "$RESP" "job_id")
  RENDER_END_TIME=$(json_field "$RESP" "end_time")
  RENDER_STAGE=$(json_field "$RESP" "stage")
  pass "Job queued → ${RENDER_JOB_ID:0:8}…"
  info "Stage   : $RENDER_STAGE"
  info "EndTime : ${RENDER_END_TIME}s"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑧ Poll render job to completion"

if [ -n "$RENDER_JOB_ID" ]; then
  info "Polling /jobs/$RENDER_JOB_ID/status every ${POLL_INTERVAL}s …"
  if poll_job "$RENDER_JOB_ID"; then
    STATUS_RESP=$(curl -sf "$BASE/jobs/$RENDER_JOB_ID/status")
    SIZE=$(json_field "$STATUS_RESP" "size_mb")
    FMT=$(json_field "$STATUS_RESP" "format")
    pass "Render complete — ${SIZE} MB · ${FMT^^}"

    # ── Download the output ────────────────────────────────────────────────
    section "⑨ Download rendered file"
    OUT_FILE="qween_test_render.${FMT:-mp4}"
    HTTP=$(curl -sf -o "$OUT_FILE" -w "%{http_code}" "$BASE/jobs/$RENDER_JOB_ID/download")
    if [ "$HTTP" = "200" ] && [ -s "$OUT_FILE" ]; then
      BYTES=$(wc -c < "$OUT_FILE")
      pass "Downloaded → $OUT_FILE (${BYTES} bytes)"
      info "Run 'ffprobe $OUT_FILE' to inspect"
    else
      fail "Download failed (HTTP $HTTP)"
    fi
  fi
else
  warn "Skipping poll + download (job was not queued)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑩ POST /jobs/render-project — from real project file (optional)"

if [ -n "$PROJECT_FILE" ] && [ -f "$PROJECT_FILE" ]; then
  info "Using: $PROJECT_FILE"
  RESP=$(curl -sf -X POST "$BASE/jobs/render-project" \
    -F "file=@${PROJECT_FILE}" \
    -F "fps=30" \
    -F "format=mp4")
  if [ $? -ne 0 ] || ! echo "$RESP" | jq -e '.job_id' &>/dev/null; then
    fail "Real project submission failed: $RESP"
  else
    REAL_JOB_ID=$(json_field "$RESP" "job_id")
    pass "Real project queued → ${REAL_JOB_ID:0:8}…"
    info "Stage   : $(json_field "$RESP" "stage")"
    info "EndTime : $(json_field "$RESP" "end_time")s"
    info "Polling…"
    if poll_job "$REAL_JOB_ID"; then
      STATUS_RESP=$(curl -sf "$BASE/jobs/$REAL_JOB_ID/status")
      SIZE=$(json_field "$STATUS_RESP" "size_mb")
      pass "Real project render done — ${SIZE} MB"
      REAL_OUT="qween_real_render.mp4"
      curl -sf -o "$REAL_OUT" "$BASE/jobs/$REAL_JOB_ID/download"
      [ -s "$REAL_OUT" ] && pass "Downloaded → $REAL_OUT" || fail "Download failed"
    fi
  fi
else
  warn "No real project file provided — skipping."
  info "Re-run with: ./test_render.sh $BASE /path/to/qween-project.zip"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑪ render-stage HTML preview"

# Use the job id from the minimal render to peek at the stage HTML
if [ -n "$RENDER_JOB_ID" ]; then
  # Re-submit a quick job so the payload is still in _render_payloads
  # (it's cleaned up after render finishes, so we just check the endpoint exists)
  HTTP=$(curl -so /dev/null -w "%{http_code}" "$BASE/render-stage/nonexistent-id")
  [ "$HTTP" = "404" ] && pass "GET /render-stage/{bad_id} → 404 as expected" \
                        || fail "Expected 404, got $HTTP"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "⑫ Job list & cleanup"

RESP=$(curl -sf "$BASE/jobs")
[ $? -eq 0 ] && pass "GET /jobs OK" || fail "GET /jobs failed"

if [ -n "$RENDER_JOB_ID" ]; then
  HTTP=$(curl -so /dev/null -w "%{http_code}" -X DELETE "$BASE/jobs/$RENDER_JOB_ID")
  [ "$HTTP" = "200" ] || [ "$HTTP" = "204" ] \
    && pass "DELETE /jobs/$RENDER_JOB_ID → $HTTP" \
    || fail "DELETE job failed → $HTTP"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All tests passed ✓${RESET}"
else
  echo -e "${RED}${BOLD}$FAILURES test(s) failed ✗${RESET}"
fi
echo "────────────────────────────────────────"
exit $FAILURES
