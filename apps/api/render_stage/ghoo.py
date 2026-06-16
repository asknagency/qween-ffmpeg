"""Builds the self-contained stage HTML served to Playwright by
/render-stage/{job_id}.

The page reconstructs the QweenApp stage from a lean JSON payload
(node SVG content, video <video> elements pointing at /assets/{id},
@font-face rules for custom fonts) and rebuilds the GSAP master
timeline using the same AnimationEngine.buildTimeline logic that
ships in QweenApp. It exposes window.__qween_seek(t) for Playwright
to scrub frame-by-frame.
"""

import json
from pathlib import Path

_ENGINE_JS = (Path(__file__).parent / "engine.js").read_text()

GSAP_VERSION = "3.13.0"
_GSAP_PLUGIN_SCRIPTS = "\n".join(
    f'  <script src="http://localhost:8000/test-gsap/{name}.min.js"></script>'
    for name in [
        "gsap",
        "DrawSVGPlugin",
        "MotionPathPlugin",
        "MorphSVGPlugin",
        "TextPlugin",
        "ScrambleTextPlugin",
        "Physics2DPlugin",
        "EasePack",
    ]
)


def _node_layer_html(node: dict, z: int, asset_base: str) -> str:
    node_id = node.get("id", "")
    visible = node.get("visible", True)
    ntype = node.get("type") or "svg"
    display = "flex" if visible else "none"
    style = (
        f"position:absolute;inset:0;overflow:hidden;display:{display};"
        f"align-items:center;justify-content:center;z-index:{z};"
    )

    if ntype == "video":
        slots = node.get("videoSlots") or []
        inner = []
        for si, slot in enumerate(slots):
            tree_id = slot.get("treeId") or f"{node_id.replace('node-', 'n')}_video-{si+1}"
            asset_id = slot.get("asset_id")
            src = f"{asset_base}/{asset_id}" if asset_id else ""
            vstyle = (
                f"position:absolute;inset:0;width:100%;height:100%;"
                f"object-fit:contain;background:transparent;z-index:{si+1};"
            )
            inner.append(
                f'<video id="{tree_id}" src="{src}" style="{vstyle}" '
                f'preload="auto" muted playsinline></video>'
            )
        body = "".join(inner)
    elif ntype == "text":
        body = f'<div id="{node_id}_text" style="width:100%;height:100%;display:flex;' \
               f'align-items:center;justify-content:center;">{node.get("textHtml", "")}</div>'
    else:  # svg
        body = f'<div style="width:100%;height:100%;overflow:hidden;">{node.get("svgContent", "")}</div>'

    return f'<div id="{node_id}" style="{style}">{body}</div>'


def _font_face_css(font_assets: list, asset_base: str) -> str:
    rules = []
    for f in font_assets or []:
        family = f.get("family", "")
        weight = f.get("weight", 400)
        style = f.get("style", "normal")
        fmt = f.get("format", "woff2")
        asset_id = f.get("asset_id")
        if not (family and asset_id):
            continue
        fmt_name = {"woff2": "woff2", "woff": "woff", "ttf": "truetype", "otf": "opentype"}.get(fmt, fmt)
        rules.append(
            "@font-face { "
            f'font-family: "{family}"; font-weight: {weight}; font-style: {style}; '
            f'src: url("{asset_base}/{asset_id}") format("{fmt_name}"); '
            "font-display: block; }"
        )
    return "\n".join(rules)


def build_stage_html(payload: dict, asset_base: str = "/assets") -> str:
    """Returns a complete HTML document for the render stage.

    `payload` is the same JSON body received by /jobs/playwright-render.
    `asset_base` is the URL path prefix the page should use to reach
    uploaded video/font assets (e.g. "/assets").
    """
    stage_w = payload.get("stageWidth", 1920)
    stage_h = payload.get("stageHeight", 1080)
    nodes = payload.get("nodes", [])
    font_assets = payload.get("fontAssets", [])
    gsap_cdn = payload.get("gsapCdn") or f"https://cdnjs.cloudflare.com/ajax/libs/gsap/{GSAP_VERSION}/gsap.min.js"
    root_svg_id = payload.get("rootSvgId", "main-svg-root")

    # Sort nodes by zIndex (matches QweenApp's `ni + 2` stacking order)
    ordered_nodes = sorted(enumerate(nodes), key=lambda pair: pair[1].get("zIndex", pair[0]))
    layers_html = "".join(
        _node_layer_html(n, z=2 + i, asset_base=asset_base) for i, (_, n) in enumerate(ordered_nodes)
    )

    font_css = _font_face_css(font_assets, asset_base)

    # Data passed to the in-page driver script
    driver_data = {
        "tweens": payload.get("tweens", []),
        "timelineLoop": payload.get("timelineLoop", False),
        "timelineYoyo": payload.get("timelineYoyo", False),
        "timelineReverse": payload.get("timelineReverse", False),
        "timelineSpeed": payload.get("timelineSpeed", 1),
        "rootSvgId": root_svg_id,
        "originalViewBox": payload.get("originalViewBox", {"x": 0, "y": 0, "w": stage_w, "h": stage_h}),
        "globalDataSources": payload.get("globalDataSources", []),
        "swapTemplates": payload.get("swapTemplates", []),
        "storedInitialStates": payload.get("storedInitialStates", []),
    }
    driver_json = json.dumps(driver_data)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {{ margin:0; padding:0; background:#000; overflow:hidden; }}
  #qween-stage {{
    position: relative;
    width: {stage_w}px;
    height: {stage_h}px;
    overflow: hidden;
    background: #000;
  }}
  #qween-stage svg {{ width:100%; height:100%; overflow:hidden; }}
  video {{ background: transparent; }}
  {font_css}
</style>
{_GSAP_PLUGIN_SCRIPTS}
</head>
<body>
<div id="qween-stage">
{layers_html}
</div>
<script>
window.__qween_ready = false;
window.__qween_frame_ready = false;
window.ElMessage = {{ warning: console.warn.bind(console), error: console.error.bind(console), success: function(){{}} }};
</script>
<script>
{_ENGINE_JS}
</script>
<script>
(function() {{
  gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin, MorphSVGPlugin, TextPlugin, ScrambleTextPlugin, Physics2DPlugin, EasePack);
  gsap.ticker.lagSmoothing(0);

  const cfg = {driver_json};
  let masterTl = null;

  function init() {{
    if (cfg.storedInitialStates && cfg.storedInitialStates.length) {{
      cfg.storedInitialStates.forEach(state => {{
        if (state.targets && state.targets.length) {{
          gsap.set(state.targets.map(id => '#' + id), Object.assign({{}}, state.vars, {{ immediateRender: true }}));
        }} else if (state.isViewBox) {{
          gsap.set('#' + cfg.rootSvgId, Object.assign({{}}, state.vars, {{ immediateRender: true }}));
        }}
      }});
    }}

    masterTl = window.AnimationEngine.buildTimeline(
      cfg.tweens, cfg.timelineLoop, cfg.timelineYoyo, cfg.rootSvgId,
      {{ onComplete: function(){{}}, onReverseComplete: function(){{}}, onStart: function(){{}}, onRepeat: function(){{}} }},
      cfg.originalViewBox, cfg.timelineReverse, cfg.globalDataSources, cfg.swapTemplates, cfg.storedInitialStates
    );
    masterTl.timeScale(cfg.timelineSpeed || 1);
    masterTl.pause(0);
    window.__qween_ready = true;
  }}

  window.__qween_seek = async function(t) {{
    window.__qween_frame_ready = false;
    if (masterTl) masterTl.pause(t);

    const videos = document.querySelectorAll('video');
    const waits = [];
    videos.forEach(vid => {{
      if (vid.readyState >= 1 && !isNaN(vid.duration)) {{
        const target = Math.min(Math.max(t, 0), vid.duration || t);
        if (Math.abs(vid.currentTime - target) > 0.001) {{
          vid.currentTime = target;
          waits.push(new Promise(r => {{
            const done = () => {{ vid.removeEventListener('seeked', done); r(); }};
            vid.addEventListener('seeked', done, {{ once: true }});
            setTimeout(done, 200); // safety timeout
          }}));
        }}
      }}
    }});
    if (waits.length) await Promise.all(waits);

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__qween_frame_ready = true;
  }};

  function waitForAssetsThenInit() {{
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) {{ init(); return; }}
    let remaining = videos.length;
    const onReady = () => {{ remaining -= 1; if (remaining <= 0) init(); }};
    videos.forEach(vid => {{
      if (vid.readyState >= 1) onReady();
      else {{
        vid.addEventListener('loadedmetadata', onReady, {{ once: true }});
        vid.addEventListener('error', onReady, {{ once: true }});
        setTimeout(onReady, 5000);
      }}
    }});
  }}

  if (document.readyState === 'complete') waitForAssetsThenInit();
  else window.addEventListener('load', waitForAssetsThenInit);
}})();
</script>
</body>
</html>"""
