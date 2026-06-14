#!/bin/bash
# ─────────────────────────────────────────────────────────────
# qween-render.sh  —  Submit → Poll → Download
# Usage:  bash qween-render.sh [output_filename.mp4]
# ─────────────────────────────────────────────────────────────

BASE_URL="https://ktj4c8-8000.csb.app"
OUTPUT_FILE="${1:-output.mp4}"
POLL_INTERVAL=3   # seconds between status checks

PAYLOAD='{
  "projectJson": {
    "version": "68",
    "timelineLoop": false,
    "timelineYoyo": false,
    "timelineReverse": false,
    "tweens": [{
      "id": "tween-dry-run-1",
      "selectedElementIds": ["dot"],
      "targets": ["dot"],
      "position": 0,
      "timingVars": { "duration": 2, "ease": "power2.inOut" },
      "toVars": { "x": 280 },
      "plugins": {}
    }],
    "effects": [], "templates": [], "swapTemplates": [],
    "initialStates": [], "globalDataSources": [], "fonts": [],
    "nodes": [{
      "id": "node-dry-run-1",
      "type": "svg",
      "width": 400, "height": 400,
      "zIndex": 0, "visible": true,
      "_svgContent": "<svg id=\"main-svg-root\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 400\" width=\"400\" height=\"400\"><rect id=\"bg\" width=\"400\" height=\"400\" fill=\"#1a1a2e\"/><circle id=\"dot\" cx=\"60\" cy=\"200\" r=\"40\" fill=\"#6c47ff\"/></svg>"
    }]
  },
  "fps": 10,
  "crf": 18,
  "format": "mp4",
  "startTime": 0,
  "endTime": 2,
  "stageWidth": 400,
  "stageHeight": 400,
  "scaleMultiplier": 1
}'

# ── Step 1: Submit job ────────────────────────────────────────
echo "▶ Submitting render job..."
RESPONSE=$(curl -s -X POST "$BASE_URL/jobs/playwright-render" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "  Response: $RESPONSE"

JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "✗ Failed to get job_id. Check the server is running."
  exit 1
fi

echo "  Job ID: $JOB_ID"

# ── Step 2: Poll until done ───────────────────────────────────
echo ""
echo "⏳ Polling status..."

while true; do
  STATUS_JSON=$(curl -s "$BASE_URL/jobs/$JOB_ID/status")
  STATUS=$(echo "$STATUS_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  MESSAGE=$(echo "$STATUS_JSON" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
  PROGRESS=$(echo "$STATUS_JSON" | grep -o '"progress":[0-9]*' | cut -d':' -f2)

  echo "  [$STATUS] ${PROGRESS}%  —  $MESSAGE"

  if [ "$STATUS" = "done" ]; then
    break
  elif [ "$STATUS" = "error" ]; then
    echo ""
    echo "✗ Render failed: $MESSAGE"
    exit 1
  fi

  sleep "$POLL_INTERVAL"
done

# ── Step 3: Download ──────────────────────────────────────────
echo ""
echo "⬇ Downloading to $OUTPUT_FILE..."
curl -s -o "$OUTPUT_FILE" "$BASE_URL/jobs/$JOB_ID/download"

if [ -f "$OUTPUT_FILE" ] && [ -s "$OUTPUT_FILE" ]; then
  SIZE=$(du -sh "$OUTPUT_FILE" | cut -f1)
  echo ""
  echo "✓ Done! Saved to $OUTPUT_FILE ($SIZE)"
else
  echo "✗ Download failed or file is empty."
  exit 1
fi
