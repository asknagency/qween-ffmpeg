let _qidCounter = 0;
const _qid = (prefix) => `${prefix}_${++_qidCounter}`;
const GSAP_TARGET_FPS = 60;
const GSAP_AUTO_SLEEP = 60;
const GSAP_DEFAULT_DURATION = 2;
const EXPR_ALLOWED_GLOBALS = new Set([
'Math', 'i', 't', 'ts', 'vw', 'vh',
'data',
'$val', '$max', '$min', '$n',
'str', 'row', 'max', 'min',
'parseInt', 'parseFloat', 'isNaN', 'isFinite',
'Number', 'String', 'Boolean',
'Infinity', 'NaN', 'undefined', 'null', 'true', 'false',
'sortBy', 'rankOf', 'pluck',
]);
const EXPR_BANNED_PATTERNS = [
/\bnew\b/,
/\bthis\b/,
/\b__proto__\b/,
/\bprototype\b/,
/\bconstructor\b/,
/=>/,
/\bfunction\b/,
/\bclass\b/,
/\bimport\b/,
/\brequire\b/,
/\beval\b/,
/\bawait\b/,
/\byield\b/,
/\bdebugger\b/,
/\bdelete\b/,
/\bvoid\b/,
/\binstanceof\b/,
/`/, 
/\[['"`][\s\S]*?['"`]\]/, 
];

const EXPR_BANNED_PROPERTY_NAMES = new Set([
'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
'__lookupGetter__', '__lookupSetter__', 'apply', 'bind', 'call',
'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'getOwnPropertyDescriptor',
]);
const EXPR_MAX_LENGTH = 200;
const isSafeExpression = (str) => {
if (!str || typeof str !== 'string' || str.trim() === '') return false;
if (str.length > EXPR_MAX_LENGTH) return false;
if (EXPR_BANNED_PATTERNS.some(rx => rx.test(str))) return false;

const strippedStr = str.replace(/'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"/g, '""');
const identRe = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
let m;
while ((m = identRe.exec(strippedStr)) !== null) {
const token = m[0];
const isPropAccess = m.index > 0 && strippedStr[m.index - 1] === '.';

const isSciNotation = m.index > 0 && /\d/.test(strippedStr[m.index - 1]) && /^[eE]\d+$/.test(token);
if (isSciNotation) continue;

if (isPropAccess) {
if (EXPR_BANNED_PROPERTY_NAMES.has(token)) return false;
continue;
}
if (!EXPR_ALLOWED_GLOBALS.has(token)) return false;
}
return true;
};

const sortBy = (arr, key) => {
if (!Array.isArray(arr)) return [];
return arr.slice().sort((a, b) => {
const av = key !== undefined ? parseFloat(a[key]) : parseFloat(a);
const bv = key !== undefined ? parseFloat(b[key]) : parseFloat(b);
return (isNaN(bv) ? 0 : bv) - (isNaN(av) ? 0 : av);
});
};
const rankOf = (arr, val, key) => {
if (!Array.isArray(arr)) return 0;
const numVal = parseFloat(val);
if (isNaN(numVal)) return 0;
return arr.filter(x => {
const v = parseFloat(key !== undefined ? x[key] : x);
return !isNaN(v) && v > numVal;
}).length;
};
const pluck = (arr, key) => {
if (!Array.isArray(arr)) return [];
return arr.map(x => (key !== undefined ? x[key] : x));
};

const _exprFnCache = new Map();
const evalSandboxed = (expr, vars) => {
let fn = _exprFnCache.get(expr);
if (!fn) {
fn = new Function('__sb__', `with (__sb__) { return (${expr}); }`);
_exprFnCache.set(expr, fn);
}
const sandbox = Object.freeze(Object.assign(Object.create(null), vars));
const proxy = new Proxy(sandbox, {
has() { return true; }, 
get(target, key) {
if (key === Symbol.unscopables) return undefined;

if (typeof key === 'string' && EXPR_BANNED_PROPERTY_NAMES.has(key)) return undefined;
if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
return undefined;
},
set() { return false; },
});
return fn(proxy);
};
const formatTime = (seconds, format) => {
const sVal = Math.floor(seconds); const h = Math.floor(sVal / 3600); const m = Math.floor((sVal % 3600) / 60); const s = sVal % 60;
const pad = (n) => n < 10 ? '0' + n : n; return format === 'hh:mm:ss' ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
const formatNumber = (value, mode) => {
if (mode === 'currency') { if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M'; if (value >= 1000) return (value / 1000).toFixed(1) + 'k'; }
else if (mode === 'filesize') { if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB'; if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB'; if (value >= 1024) return (value / 1024).toFixed(0) + ' KB'; }
return value;
};
const AnimationEngine = {
createProxy: (el) => {
let b = { x: 0, y: 0, width: 0, height: 0 }; try { b = el.getBBox(); } catch (e) { }
return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, dom: el };
},
generateGsapVars: (currentTween, activeProps, expressionFlags, plugins, activeAttrs, attrValues, useGSAPColors, localFonts) => {
const vars = {}; const simpleProps = ['transformOrigin', 'svgOrigin', 'transformPerspective']; const transProps = ['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotation', 'rotationX', 'rotationY', 'skewX', 'skewY', 'opacity', 'autoAlpha', 'fill', 'stroke', 'strokeWidth', 'strokeDasharray', 'strokeDashoffset'];
const _blockedExprs = [];
simpleProps.forEach(k => { if (activeProps[k] && currentTween.vars[k] !== null) vars[k] = currentTween.vars[k]; });
if (activeProps.backfaceVisibility) vars.backfaceVisibility = 'hidden';
transProps.forEach(k => {
if (activeProps[k] && currentTween.vars[k] !== null) {
if (expressionFlags[k]) { const expr = currentTween.vars[k]; if (isSafeExpression(expr)) vars[k] = { _isExpr: true, val: expr }; else { vars[k] = 0; _blockedExprs.push(k); } }
else { vars[k] = currentTween.vars[k]; }
}
});
const textProps = ['fontSize', 'letterSpacing', 'lineHeight', 'wordSpacing'];
textProps.forEach(k => {
if (activeProps[k] && currentTween.vars[k] !== null && currentTween.vars[k] !== "") {
if (expressionFlags[k]) { const expr = currentTween.vars[k]; if (isSafeExpression(expr)) vars[k] = { _isExpr: true, val: expr }; else { vars[k] = 0; _blockedExprs.push(k); } }
else { vars[k] = currentTween.vars[k]; }
}
});

const htmlColorProps = ['color', 'backgroundColor'];
htmlColorProps.forEach(k => {
if (activeProps[k] && currentTween.vars[k] !== null) {
  if (expressionFlags[k]) { const expr = currentTween.vars[k]; if (isSafeExpression(expr)) vars[k] = { _isExpr: true, val: expr }; else { vars[k] = 'transparent'; _blockedExprs.push(k); } }
  else { vars[k] = currentTween.vars[k]; }
}
});
const htmlStringProps = ['fontWeight', 'textAlign', 'textDecoration'];
htmlStringProps.forEach(k => { if (activeProps[k] && currentTween.vars[k] !== null && currentTween.vars[k] !== '') vars[k] = currentTween.vars[k]; });
const htmlPosProps = ['top', 'left', 'right', 'bottom'];
htmlPosProps.forEach(k => { if (activeProps[k] && currentTween.vars[k] !== null && currentTween.vars[k] !== '') vars[k] = currentTween.vars[k]; });
if (plugins.typography && plugins.typography.fontFamily) {
vars.fontFamily = plugins.typography.fontFamily;
if (activeProps.fontVariationSettings) {
const matchedFont = localFonts.find(f => f.family === plugins.typography.fontFamily);
if (matchedFont && matchedFont.axes && matchedFont.axes.length > 0) {
vars._fvs = { target: {}, defaults: {} };
matchedFont.axes.forEach(a => { vars._fvs.target[a.tag] = plugins.typography.axes[a.tag]; vars._fvs.defaults[a.tag] = a.default || 400; });
}
}
}
const attrObj = {};
Object.keys(activeAttrs).forEach(key => {
if (activeAttrs[key] && attrValues[key] !== undefined) {
if (expressionFlags['attr_' + key]) { const expr = attrValues[key]; if (isSafeExpression(expr)) attrObj[key] = { _isExpr: true, val: expr }; else { attrObj[key] = 0; _blockedExprs.push('attr:' + key); } }
else { attrObj[key] = attrValues[key]; }
}
});
if (Object.keys(attrObj).length > 0) vars.attr = attrObj;
if (plugins.motionPathEnabled && plugins.motionPath.path) {
let alignVal = undefined; if (plugins.motionPath.alignMode === 'path') alignVal = plugins.motionPath.path; else if (plugins.motionPath.alignMode === 'self') alignVal = "self";
const autoRotateVal = plugins.motionPath.autoRotate
  ? (plugins.motionPath.autoRotateOffset !== 0 ? plugins.motionPath.autoRotateOffset : true)
  : false;
vars.motionPath = { path: plugins.motionPath.path, align: alignVal, autoRotate: autoRotateVal, start: plugins.motionPath.start, end: plugins.motionPath.end, alignOrigin: [plugins.motionPath.alignOrigin.x, plugins.motionPath.alignOrigin.y], offsetX: plugins.motionPath.offsetX, offsetY: plugins.motionPath.offsetY };
if (plugins.motionPath.cameraFollow) vars._cameraConfig = { follow: true, zoom: plugins.motionPath.cameraZoom, damping: plugins.motionPath.cameraDamping || 0 };
}
if (plugins.morphEnabled && plugins.morph.shape) {
  const shapeIdx = plugins.morph.shapeIndex !== undefined && plugins.morph.shapeIndex !== '' && plugins.morph.shapeIndex !== 'auto'
    ? parseInt(plugins.morph.shapeIndex, 10)
    : 'auto';
  vars.morphSVG = { shape: plugins.morph.shape, type: plugins.morph.type, origin: plugins.morph.origin, precision: plugins.morph.precision, shapeIndex: shapeIdx };
}
if (plugins.drawEnabled) {
  const drawVal = plugins.drawSVG.start && plugins.drawSVG.start !== "0%"
    ? `${plugins.drawSVG.start} ${plugins.drawSVG.end}`
    : (plugins.drawSVG.end || "100%");
  vars.drawSVG = plugins.drawSVG.initiallyHidden ? { value: drawVal, initiallyHidden: true } : drawVal;
}
if (plugins.snapEnabled) vars._snap = { prop: plugins.snap.prop, value: plugins.snap.value };
if (plugins.textEffect.mode === 'text') {
const textVal = plugins.textEffect.text.value || '';
const delim = plugins.textEffect.text.delimiter;
if (plugins.textEffect.exprEnabled && isSafeExpression(textVal)) {
vars._textExpr = { _isExpr: true, val: textVal, delimiter: delim };
} else if (textVal.includes('{original}') || textVal.includes('{text}')) {

vars._textOriginal = { template: textVal, delimiter: delim };
} else {
vars.text = { value: textVal, delimiter: delim };
}
}
else if (plugins.textEffect.mode === 'scramble') {
const scramVal = plugins.textEffect.scramble.text || '';
vars.scrambleText = { ...plugins.textEffect.scramble };
if (plugins.textEffect.exprEnabled && isSafeExpression(scramVal)) {
vars.scrambleText._isExpr = true; vars.scrambleText._exprVal = scramVal;
} else if (scramVal.includes('{original}') || scramVal.includes('{text}')) {

vars.scrambleText._originalTemplate = scramVal;
}

}
else if (plugins.textEffect.mode === 'counter') {
const ctr = { ...plugins.textEffect.counter };
if (plugins.textEffect.exprEnabled && isSafeExpression(ctr.exprValue)) {
ctr._valueExpr = { _isExpr: true, val: ctr.exprValue };
}
vars._counter = ctr;
}
else if (plugins.textEffect.mode === 'timer') vars._timer = { ...plugins.textEffect.timer };
if (plugins.physicsEnabled) {
vars.physics2D = { velocity: plugins.physics.velocity, angle: plugins.physics.angle, gravity: plugins.physics.gravity, friction: plugins.physics.friction };
}
if (_blockedExprs.length > 0) vars._blockedExprs = _blockedExprs;
return vars;
},
buildTimeline: (tweens, timelineLoop, timelineYoyo, rootSvgId, callbacks, originalViewBox, timelineReverse, globalDataSources, swapTemplates, storedInitialStates) => {
const masterTl = gsap.timeline({
  repeat: timelineLoop ? -1 : 0,
  yoyo: timelineLoop && timelineYoyo ? true : false,
  smoothChildTiming: true,
  autoRemoveChildren: false,
  onComplete: callbacks.onComplete,
  onReverseComplete: callbacks.onReverseComplete || callbacks.onComplete,
  onStart: callbacks.onStart,
  onRepeat: callbacks.onRepeat,
});
const rootSvg = document.getElementById(rootSvgId);
const combineOnUpdate = (f1, f2) => function() { if(f1) f1.apply(this); if(f2) f2.apply(this); };

const captureSnapState = (binding) => {
  
  let el = null;
  if (binding.hostNodeId) {
    const hostDiv = document.getElementById(binding.hostNodeId);
    el = hostDiv ? hostDiv.querySelector(`[id="${CSS.escape(binding.nodeId)}"]`) : null;
  }
  if (!el) el = document.getElementById(binding.nodeId);
  if (!el) return null;
  const tv = binding.tweenVars;
  const rawTv = tv && (typeof Vue !== 'undefined' && Vue.toRaw) ? Vue.toRaw(tv) : tv;
  if (!rawTv) return null;
  const varsObj = rawTv.toVars || rawTv.fromVars || {};
  const prop = binding.property;
  const snapVars = {};

  const readLive = (p) => {
    if (p === 'textContent') return el.textContent;
    if (p && p.startsWith('attr:')) return el.getAttribute(p.slice(5));
    const gs = gsap.getProperty(el, p);
    if (gs !== '' && gs !== null && gs !== undefined) return gs;
    return window.getComputedStyle(el).getPropertyValue(p) || '';
  };

  const SNAP_SKIP = new Set(['_cameraConfig','_fvs','_snap','_counter','scrambleText','_timer','_isExpr','_textExpr','text','_textOriginal']);
  Object.keys(varsObj).forEach(k => {
    if (SNAP_SKIP.has(k)) return;
    if (k === 'attr' && typeof varsObj.attr === 'object') {
      snapVars.attr = snapVars.attr || {};
      Object.keys(varsObj.attr).forEach(a => { snapVars.attr[a] = el.getAttribute(a) ?? ''; });
    } else {
      snapVars[k] = readLive(k);
    }
  });

  if (prop && prop !== 'textContent' && !prop.startsWith('attr:') && !(prop in snapVars)) {
    snapVars[prop] = readLive(prop);
  }
  if (prop && prop.startsWith('attr:')) {
    const a = prop.slice(5);
    snapVars.attr = snapVars.attr || {};
    if (!(a in snapVars.attr)) snapVars.attr[a] = el.getAttribute(a) ?? '';
  }
  if (prop === 'textContent') snapVars._textContentReset = el.textContent;
  return { el, snapVars, prop };
};

const addSnapBackReset = (animTl, { el, snapVars, prop }) => {
  const elId = '#' + el.id;
  animTl.call(function() {

    let tl = animTl;
    let isReversing = false;
    while (tl) {
      if (typeof tl._ts === 'number' && tl._ts < 0) { isReversing = true; break; }
      tl = tl.parent;
    }
    if (isReversing) return;

    if (snapVars.attr && typeof snapVars.attr === 'object') {
      Object.entries(snapVars.attr).forEach(([a, v]) => el.setAttribute(a, v ?? ''));
    }
    if (prop === 'textContent' && snapVars._textContentReset !== undefined) {
      el.textContent = snapVars._textContentReset;
    }
    const resetVars = {};
    Object.entries(snapVars).forEach(([k, v]) => {
      if (k === 'attr' || k === '_textContentReset') return;
      resetVars[k] = v;
    });

    if (Object.keys(resetVars).length) gsap.set(elId, resetVars);
  }, [], 0);
};

const resolveBindingExpressions = (vars, el, entryIdx, entries, dataVarCtx) => {
  let hasValExpr = false;
  const resolveObj = (vObj) => {
    Object.keys(vObj).forEach(k => {
      if (!vObj[k] || typeof vObj[k] !== 'object' || !vObj[k]._isExpr) return;
      const expr = vObj[k].val;
      if (typeof expr === 'string' &&
          (expr.includes('$val') || expr.includes('str') || expr.includes('row') ||
           /\bmax\b/.test(expr) || /\bmin\b/.test(expr))) hasValExpr = true;
      try {
        
        const svg = el.ownerSVGElement || el.closest('svg') || document.getElementById(rootSvgId);
        let vw = 100, vh = 100;
        if (svg && svg.viewBox && svg.viewBox.baseVal) {
          vw = svg.viewBox.baseVal.width; vh = svg.viewBox.baseVal.height;
        }
        const tProxy = AnimationEngine.createProxy(el);
        const dataLookup = {};
        if (globalDataSources) globalDataSources.forEach(s => { dataLookup[s.name] = s.entries; });
        vObj[k] = evalSandboxed(expr, { i: entryIdx, t: tProxy, ts: [tProxy], vw, vh, Math, data: dataLookup, sortBy, rankOf, pluck, ...dataVarCtx });
      } catch (e) { vObj[k] = isNaN(parseFloat(dataVarCtx.$val)) ? 0 : parseFloat(dataVarCtx.$val); }
    });
  };
  resolveObj(vars);
  if (vars.attr && typeof vars.attr === 'object') resolveObj(vars.attr);
  return hasValExpr;
};

const addTextEffectTween = (animTl, nodeId, vars, { val, rawVal, dur, ease, timing, tweenMethod, hasValExpr }, scopedEl) => {
  
  const gsapTarget = scopedEl || ('#' + nodeId);
  const textMode = timing.textMode;
  if (textMode === 'counter') {
    const c = vars._counter || {};
    const counterTarget = (hasValExpr && typeof vars.textContent === 'number') ? vars.textContent : (isNaN(parseFloat(val)) ? 0 : parseFloat(val));
    const formatCounter = (n) => {
      let num = parseFloat(n); if (isNaN(num)) num = 0;
      let formatted = Number(num).toFixed(c.decimals || 0);
      if (c.separatorChar) {
        const pts = formatted.split(c.decimalChar || '.');
        pts[0] = pts[0].replace(/\B(?=(\d{3})+(?!\d))/g, c.separatorChar);
        formatted = pts.join(c.decimalChar || '.');
      }
      return (c.prefix || '') + formatted + (c.suffix || '');
    };
    delete vars._counter;
    animTl.fromTo(gsapTarget,
      { textContent: typeof c.fromValue === 'number' ? c.fromValue : 0 },
      { ...vars, textContent: counterTarget, duration: dur || 1, ease, snap: { textContent: 1 }, modifiers: { textContent: formatCounter } },
      0);
  } else if (textMode === 'scramble') {
    const s = (vars.scrambleText && typeof vars.scrambleText === 'object') ? vars.scrambleText : {};
    const charTransform = s.charTransform || 'none';
    delete vars.scrambleText;
    const applyCharTransform = (str, mode) => {
      if (mode === 'reverse') return str.split('').reverse().join('');
      if (mode === 'invertCase') return str.split('').map(ch => ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()).join('');
      if (mode === 'upper') return str.toUpperCase();
      if (mode === 'lower') return str.toLowerCase();
      return str;
    };
    const rawText = (hasValExpr && vars.textContent !== undefined) ? String(vars.textContent) : String(val);
    const scrambleText = applyCharTransform(rawText, charTransform);
    const scrambleVars = { ...vars, duration: dur || 1, ease, scrambleText: { text: scrambleText, chars: s.chars || 'upperCase', speed: s.speed || 0.3, revealDelay: s.revealDelay || 0, tweenLength: s.tweenLength || false }, immediateRender: false };
    if (tweenMethod === 'set') animTl.set(gsapTarget, scrambleVars, 0);
    else if (tweenMethod === 'from') animTl.from(gsapTarget, scrambleVars, 0);
    else animTl.to(gsapTarget, scrambleVars, 0);
  } else {
    delete vars._counter; delete vars.scrambleText; delete vars._timer;
    const resolvedTextExpr = (vars._textExpr !== undefined && vars._textExpr !== null && typeof vars._textExpr !== 'object') ? vars._textExpr : undefined;
    const textResult = (vars.textContent !== undefined && vars.textContent !== null)
      ? String(vars.textContent)
      : resolvedTextExpr !== undefined
        ? String(resolvedTextExpr)
        : String(val);
    delete vars.textContent; delete vars._textExpr;
    vars.text = { value: textResult };
    const textVars = { ...vars, duration: dur, ease, immediateRender: false };
    if (tweenMethod === 'set') animTl.set(gsapTarget, textVars, 0);
    else if (tweenMethod === 'from') animTl.from(gsapTarget, textVars, 0);
    else animTl.to(gsapTarget, textVars, 0);
  }
};

const buildDataIterationTl = (t) => {

const masterDataTl = gsap.timeline({ defaults: { ease: 'none', immediateRender: false } });
let entries = [];
if (t.dataSourceRef && globalDataSources) {
const src = globalDataSources.find(s => s.name === t.dataSourceRef);
if (src) entries = src.entries;
}

const keyStats = {};
if (t.dataBindings) {
t.dataBindings.forEach(({ key }) => {
if (!key || keyStats[key]) return;
const vals = entries.map(e => parseFloat(e[key])).filter(v => !isNaN(v));
keyStats[key] = { max: vals.length ? Math.max(...vals) : 1, min: vals.length ? Math.min(...vals) : 0 };
});
}
const evalFormula = (formula, v, key, i, binding) => {
if (!formula || !formula.trim()) return v;
try {
const stats = keyStats[key] || { max: 1, min: 0 };

const result = (new Function('v','str','$val','row','max','min','i','n', `return (${formula});`))(
parseFloat(v), String(v), parseFloat(v), entries[i] || {}, stats.max, stats.min, i, entries.length
);
if (binding && binding._lastError) binding._lastError = null;
return result;
} catch (e) {
if (binding) binding._lastError = e.message;
return v;
}
};

const _bindingInitialStates = new Map();
if (t.dataBindings) {
  t.dataBindings.forEach((binding, _bIdx) => {
    if (binding.snapBack === false) return;
    const state = captureSnapState(binding);
    if (state) _bindingInitialStates.set(_bIdx, state);
  });
}

const _dgStart = (typeof t.dgStartIndex === 'number' && t.dgStartIndex > 0)
  ? Math.min(t.dgStartIndex, entries.length - 1) : 0;
const _entriesToPlay = _dgStart > 0 ? entries.slice(_dgStart) : entries;

const _dur = typeof t.bindingDuration === 'number' ? t.bindingDuration : 1.0;
const _hold = typeof t.holdDuration === 'number' ? t.holdDuration : 0;
const _slotSize = _dur + _hold;
_entriesToPlay.forEach((entry, _loopIdx) => {
const entryIdx = _dgStart + _loopIdx;
const entryTl = gsap.timeline({ defaults: { ease: 'none' } });

const animTl = gsap.timeline({ defaults: { immediateRender: false } });

_bindingInitialStates.forEach((state) => {
  if (!state.el) return;
  addSnapBackReset(animTl, state);
});
if (t.dataBindings) {
t.dataBindings.forEach((binding) => {
const { nodeId, hostNodeId, property, key, formula, tweenVars } = binding;

let el = null;
if (hostNodeId) {
  const hostDiv = document.getElementById(hostNodeId);
  el = hostDiv ? hostDiv.querySelector(`[id="${CSS.escape(nodeId)}"]`) : null;
}
if (!el) el = document.getElementById(nodeId);
if (!el || entry[key] === undefined) return;
const rawVal = entry[key];
const val = evalFormula(formula, rawVal, key, entryIdx, binding);
if (tweenVars) {
const rawTv = (typeof Vue !== 'undefined' && Vue.toRaw) ? Vue.toRaw(tweenVars) : tweenVars;
const tweenMethod = rawTv.type || rawTv.timingVars?.method || 'to';
const vars = structuredClone(tweenMethod === 'from' ? (rawTv.fromVars || {}) : (rawTv.toVars || {}));
const timing = rawTv.timingVars || {};

const dur = typeof t.bindingDuration === 'number' ? t.bindingDuration : (timing.duration || 0);
const ease = timing.ease || 'none';

delete vars._cameraConfig; delete vars._fvs; delete vars._snap;

const numVal = parseFloat(val);
const stats = keyStats[key] || { max: 1, min: 0 };
const dataVarCtx = { $val: isNaN(numVal) ? val : numVal, $max: stats.max, $min: stats.min, $n: entries.length, str: String(rawVal), row: entry, max: stats.max, min: stats.min, i: entryIdx };

const hasValExpr = resolveBindingExpressions(vars, el, entryIdx, entries, dataVarCtx);

if (property === 'textContent') {
addTextEffectTween(animTl, nodeId, vars, { val, rawVal, dur, ease, timing, tweenMethod, hasValExpr }, el);
} else if (property.startsWith('attr:')) {
const attrName = property.slice(5);
delete vars.text; delete vars._counter; delete vars.scrambleText; delete vars._timer;

const _swapTplId = tweenVars ? tweenVars._swapTemplateId : null;
if (_swapTplId && (attrName === 'href' || attrName === 'xlink:href')) {
  const tplData = swapTemplates && swapTemplates.find ? swapTemplates.find(s => s.id === _swapTplId) : null;
  if (!tplData) { console.warn(`[QweenApp] Image Transition: template id "${_swapTplId}" not found — was it deleted? Falling back to plain attr tween.`); }
  if (tplData) {
    const targetUrl = String(hasValExpr && vars.attr && vars.attr[attrName] !== undefined ? vars.attr[attrName] : val);
    const clone = JSON.parse(JSON.stringify(tplData.data));
    const injectUrl = (obj) => { if (!obj || typeof obj !== 'object') return; for (const k of ['href', 'xlink:href']) { if (k in obj) obj[k] = targetUrl; } if (obj.attr) injectUrl(obj.attr); };
    const retarget = (t) => { t.selectedElementIds = [nodeId]; t.targets = [nodeId]; if (t.toVars) injectUrl(t.toVars); if (t.fromVars) injectUrl(t.fromVars); if (t.snapBackVars) injectUrl(t.snapBackVars); t.id = _qid('tween'); };
    if (clone.isGroup) {
      (clone.children || []).forEach(child => retarget(child));
      const swapTl = gsap.timeline({ onInterrupt: () => {   } });
      clone.children.forEach(child => processTweenNode(child, swapTl));
      animTl.add(swapTl, 0);
    } else {
      retarget(clone);
      processTweenNode(clone, animTl);
    }
    return;
  }
}
const attrAlreadySet = hasValExpr && vars.attr && vars.attr[attrName] !== undefined;
const attrVal = attrAlreadySet ? vars.attr[attrName] : val;
const attrVars = { ...vars, attr: { ...(vars.attr || {}), [attrName]: attrVal }, duration: dur, ease, repeat: timing.repeat || 0, repeatDelay: timing.repeatDelay || 0, yoyo: timing.yoyo || false, immediateRender: false };

if (tweenMethod === 'set') animTl.set(el, attrVars, 0);
else if (tweenMethod === 'from') animTl.from(el, { ...attrVars, immediateRender: false, lazy: false }, 0);
else animTl.to(el, attrVars, 0);
} else {
delete vars.text; delete vars._counter; delete vars.scrambleText; delete vars._timer;

const skipDataInject = hasValExpr;
const propVars = skipDataInject
  ? { ...vars, duration: dur, ease, repeat: timing.repeat || 0, repeatDelay: timing.repeatDelay || 0, yoyo: timing.yoyo || false }
  : { ...vars, [property]: val, duration: dur, ease, repeat: timing.repeat || 0, repeatDelay: timing.repeatDelay || 0, yoyo: timing.yoyo || false };
if (tweenMethod === 'set') animTl.set(el, propVars, 0);
else if (tweenMethod === 'from') animTl.from(el, { ...propVars, immediateRender: false, lazy: false }, 0);
else animTl.to(el, { ...propVars, immediateRender: false }, 0);
}
} else {

if (property === 'textContent') animTl.call(() => { el.textContent = String(val); }, [], 0);
else if (property.startsWith('attr:')) animTl.set(el, { attr: { [property.slice(5)]: val } }, 0);
else animTl.set(el, { [property]: val }, 0);
}
});
}
entryTl.add(animTl, 0);

const animTlEmpty = animTl.duration() === 0;
if (animTlEmpty) {

  entryTl.to({}, { duration: _slotSize }, 0);
} else if (_hold > 0) {

  entryTl.to({}, { duration: _hold }, '>');
}

masterDataTl.add(entryTl, entryIdx * _slotSize);
});
return masterDataTl;
};
const processTweenNode = (t, currentTl) => {

const hasDataEntries = t.isDataGroup &&
(t.dataSourceRef && globalDataSources && globalDataSources.find(s => s.name === t.dataSourceRef)) &&
(t.dataBindings && t.dataBindings.length);
if (hasDataEntries) {
currentTl.add(buildDataIterationTl(t), t.position || '>');
return;
}
if (t.isGroup) {
const groupTl = gsap.timeline({ repeat: t.repeat || 0, yoyo: t.yoyo || false, onInterrupt: () => {   } });
if (t.children && t.children.length) t.children.forEach(child => processTweenNode(child, groupTl));
currentTl.add(groupTl, t.position || '>');
return;
}

const _resolveVideoEl = (id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.tagName.toLowerCase() === 'video') return el;
  if (el.tagName.toLowerCase() === 'div' && /^node-\d+$/.test(id)) {
    const videoChild = el.querySelector('video');
    if (videoChild) return videoChild;
  }
  return null;
};
const targets = t.selectedElementIds.flatMap(id => {
const el = document.getElementById(id); if(!el) return [];

const videoEl = _resolveVideoEl(id);
if (videoEl && videoEl !== el) return '#' + videoEl.id;
const hasStagger = t.timingVars && t.timingVars.stagger && t.timingVars.stagger.amount > 0;
if (el.hasAttribute('data-split-mode') && hasStagger) {
if (el.tagName.toLowerCase() === 'text') return Array.from(el.querySelectorAll('tspan'));
if (el.tagName.toLowerCase() === 'g') return Array.from(el.querySelectorAll('path'));
}
return '#' + id;
});

const _hasNodeWrappers = t.selectedElementIds.some(id => {
  const el = document.getElementById(id);
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'div' && /^node-\d+$/.test(id)) {
    
    if (el.querySelector('video')) return true;
    return true;
  }
  
  if (['h1','h2','h3','p','span','video'].includes(tag)) return true;
  return false;
});
if(targets.length === 0 && !t.viewBoxConfig && !t._videoPlayConfig) return;

if (t._captionReset && t._captionNodeId && storedInitialStates) {
  const nodeId = t._captionNodeId.replace(/^#/, '');
  const stored = storedInitialStates.find(s => s.targets && s.targets.includes(nodeId));
  if (stored && stored.vars) {
    
    t.toVars = { ...stored.vars, ...t.toVars };
  }
}
const baseConfig = { duration: t.timingVars ? t.timingVars.duration : t.duration, ease: t.timingVars ? t.timingVars.ease : t.ease, repeat: t.timingVars ? t.timingVars.repeat : t.repeat, repeatDelay: t.timingVars ? t.timingVars.repeatDelay : t.repeatDelay, yoyo: t.timingVars ? t.timingVars.yoyo : t.yoyo, repeatRefresh: t.timingVars ? t.timingVars.repeatRefresh : t.repeatRefresh };
const timingYoyoEaseEnabled = t.timingVars ? t.timingVars.yoyoEaseEnabled : false;
if (baseConfig.yoyo && timingYoyoEaseEnabled && t.timingVars.yoyoEase) { baseConfig.yoyoEase = t.timingVars.yoyoEase === 'true' ? true : t.timingVars.yoyoEase; }
let actualPos = t.position || '>';
let elementsAnimated = false;
if (targets.length > 0) {
const baseVars = (t.type === 'from' || t.type === 'set') ? { ...t.fromVars, ...t.toVars } : { ...t.toVars };

const vars = { ...baseVars };
if (baseVars.attr) vars.attr = { ...baseVars.attr };
if (baseVars.motionPath) vars.motionPath = { ...baseVars.motionPath };
if (baseVars.stagger) vars.stagger = { ...baseVars.stagger };

if (_hasNodeWrappers) { delete vars.attr; delete vars.motionPath; delete vars._cameraConfig; }
if (Object.keys(vars).length > 0) {
elementsAnimated = true;
if (vars._cameraConfig && vars._cameraConfig.follow) {
const camConfig = vars._cameraConfig; delete vars._cameraConfig;
const targetEl = targets.length > 0 ? (typeof targets[0] === 'string' ? document.querySelector(targets[0]) : targets[0]) : null;
let localPt = { x: 0, y: 0 };
if (targetEl) { try { const b = targetEl.getBBox(); localPt = { x: b.x + b.width/2, y: b.y + b.height/2 }; } catch(e){} }

const dampedVB = { x: null, y: null };
vars.onUpdate = combineOnUpdate(vars.onUpdate, function () {
if (!rootSvg || !originalViewBox.w || !targetEl) return;
try {
const svgCtm = rootSvg.getCTM();
const elCtm = targetEl.getCTM();
if (svgCtm && elCtm) {
const relativeMatrix = svgCtm.inverse().multiply(elCtm);
const pt = rootSvg.createSVGPoint();
pt.x = localPt.x;
pt.y = localPt.y;
const globalPt = pt.matrixTransform(relativeMatrix);
const cx = globalPt.x; const cy = globalPt.y;
const zoomVal = camConfig.zoom || 100; const zoomFactor = 100 / zoomVal;
const vbw = originalViewBox.w * zoomFactor; const vbh = originalViewBox.h * zoomFactor;
const targetX = cx - (vbw / 2); const targetY = cy - (vbh / 2);
const d = Math.max(0, Math.min(0.99, camConfig.damping || 0));
if (d === 0 || dampedVB.x === null) {
  
  dampedVB.x = targetX; dampedVB.y = targetY;
} else {
  
  dampedVB.x = dampedVB.x + (targetX - dampedVB.x) * (1 - d);
  dampedVB.y = dampedVB.y + (targetY - dampedVB.y) * (1 - d);
}
rootSvg.setAttribute("viewBox", `${dampedVB.x} ${dampedVB.y} ${vbw} ${vbh}`);
}
} catch (e) { }
});
} else if (vars._cameraConfig) { delete vars._cameraConfig; }
if (vars._fvs) {
const targetAxes = vars._fvs.target; const defaultAxes = vars._fvs.defaults; delete vars._fvs;
const resolvedTargets = targets.map(el => typeof el === 'string' ? document.querySelector(el) : el).filter(Boolean);
resolvedTargets.forEach(el => {
Object.keys(defaultAxes).forEach(tag => {
if (!el.style.getPropertyValue(`--${tag}`)) {
let existingVal = defaultAxes[tag]; let currentFVS = el.style.fontVariationSettings || el.getAttribute('font-variation-settings') || "";
let match = currentFVS.match(new RegExp(`"${tag}"\\s*([\\d.]+)`)); if (match) existingVal = parseFloat(match[1]);
el.style.setProperty(`--${tag}`, existingVal);
}
});
});
Object.keys(targetAxes).forEach(tag => { vars[`--${tag}`] = targetAxes[tag]; });
vars.onUpdate = combineOnUpdate(vars.onUpdate, function() {
this.targets().forEach(el => {
let fvsArr = [];
Object.keys(targetAxes).forEach(tag => { let val = el.style.getPropertyValue(`--${tag}`); if(val) fvsArr.push(`"${tag}" ${parseFloat(val).toFixed(2)}`); });
if (fvsArr.length) el.style.fontVariationSettings = fvsArr.join(", ");
});
});
}
if (vars._timer) {
const tm = vars._timer; delete vars._timer;
vars.textContent = tm.endSeconds; if (t.type === 'from') vars.textContent = tm.startSeconds;
if(t.type === 'to') currentTl.set(targets, { textContent: tm.startSeconds }, actualPos);
vars.modifiers = { ...vars.modifiers, textContent: value => formatTime(parseFloat(value), tm.format) };
}
if (vars._counter) {
const c = vars._counter; delete vars._counter; vars.textContent = c.value;
vars.modifiers = {
...vars.modifiers,
textContent: value => {
let num = parseFloat(value); if (isNaN(num)) num = 0;
if (c.increment && c.increment > 0) num = gsap.utils.snap(c.increment, num);
if (c.formatMode === 'currency' || c.formatMode === 'filesize') { const fVal = formatNumber(num, c.formatMode); if(fVal !== num) return `${c.prefix}${fVal}${c.suffix}`; }
let formatted = Number(num || 0).toFixed(c.decimals || 0);
if (c.decimalChar !== '.') formatted = formatted.replace('.', c.decimalChar);
if (c.separatorChar) { const parts = formatted.split(c.decimalChar); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, c.separatorChar); formatted = parts.join(c.decimalChar); }
return `${c.prefix}${formatted}${c.suffix}`;
}
};
}
Object.keys(vars).forEach(k => {
if (vars[k] && vars[k]._isExpr) {
const expr = vars[k].val;
vars[k] = (index, target, targetsArr) => {

const svg = target.ownerSVGElement || target.closest('svg') || document.getElementById(rootSvgId);
let initialBBox = {x:0, y:0}; try { initialBBox = target.getBBox(); } catch(e){}
let vw = 100, vh = 100; if (svg && svg.viewBox && svg.viewBox.baseVal) { vw = svg.viewBox.baseVal.width; vh = svg.viewBox.baseVal.height; }
const tProxy = AnimationEngine.createProxy(target); const tsProxy = targetsArr.map(el => AnimationEngine.createProxy(el));
const dataLookup = {}; if (globalDataSources) globalDataSources.forEach(src => { dataLookup[src.name] = src.entries; });
try {
const result = evalSandboxed(expr, { i: index, t: tProxy, ts: tsProxy, vw, vh, Math, data: dataLookup, sortBy, rankOf, pluck });
if (typeof result !== 'number' || isNaN(result)) return result;
if (k === 'x') return result - initialBBox.x; if (k === 'y') return result - initialBBox.y; return result;
} catch (e) { return 0; }
};
}
});
if (vars.attr) {
Object.keys(vars.attr).forEach(k => {
if (vars.attr[k] && vars.attr[k]._isExpr) {
const expr = vars.attr[k].val;
vars.attr[k] = (index, target, targetsArr) => {

const svg = target.ownerSVGElement || target.closest('svg') || document.getElementById(rootSvgId);
let vw = 100, vh = 100; if (svg && svg.viewBox && svg.viewBox.baseVal) { vw = svg.viewBox.baseVal.width; vh = svg.viewBox.baseVal.height; }
const tProxy = AnimationEngine.createProxy(target); const tsProxy = targetsArr.map(el => AnimationEngine.createProxy(el));
const dataLookup = {}; if (globalDataSources) globalDataSources.forEach(src => { dataLookup[src.name] = src.entries; });
try { return evalSandboxed(expr, { i: index, t: tProxy, ts: tsProxy, vw, vh, Math, data: dataLookup, sortBy, rankOf, pluck }); } catch (e) { return 0; }
};
}
});
}
if (vars._snap) { vars.modifiers = vars.modifiers || {}; vars.modifiers[vars._snap.prop] = gsap.utils.snap(vars._snap.value); delete vars._snap; }

if (vars._textExpr && vars._textExpr._isExpr) {
const exprSrc = vars._textExpr.val; const delimSrc = vars._textExpr.delimiter; delete vars._textExpr;
vars.text = { delimiter: delimSrc, value: (index, target) => {
const dataLookup = {}; if (globalDataSources) globalDataSources.forEach(src => { dataLookup[src.name] = src.entries; });
const tProxy = AnimationEngine.createProxy(target);
try { const r = evalSandboxed(exprSrc, { i: index, t: tProxy, ts: [], Math, data: dataLookup, sortBy, rankOf, pluck }); return String(r); } catch(e) { return ''; }
}};
}

if (vars._textOriginal) {
const tmpl = vars._textOriginal.template; const delimSrc = vars._textOriginal.delimiter; delete vars._textOriginal;
vars.text = { delimiter: delimSrc, value: (i, target) => tmpl.replace(/\{original\}|\{text\}/g, target.getAttribute('data-original-text') || target.textContent.trim()) };
}

if (vars.scrambleText && vars.scrambleText._isExpr) {
const exprSrc = vars.scrambleText._exprVal; const charTransform = vars.scrambleText.charTransform || 'none'; delete vars.scrambleText._isExpr; delete vars.scrambleText._exprVal; delete vars.scrambleText.charTransform;
const applyCharTransform = (str, mode) => {
if (mode === 'reverse') return str.split('').reverse().join('');
if (mode === 'invertCase') return str.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
if (mode === 'upper') return str.toUpperCase();
if (mode === 'lower') return str.toLowerCase();
return str;
};
vars.scrambleText.text = (index, target) => {
const dataLookup = {}; if (globalDataSources) globalDataSources.forEach(src => { dataLookup[src.name] = src.entries; });
const tProxy = AnimationEngine.createProxy(target);
try { const r = evalSandboxed(exprSrc, { i: index, t: tProxy, ts: [], Math, data: dataLookup, sortBy, rankOf, pluck }); return applyCharTransform(String(r), charTransform); } catch(e) { return ''; }
};
}

if (vars.scrambleText && vars.scrambleText._originalTemplate) {
const tmpl = vars.scrambleText._originalTemplate; delete vars.scrambleText._originalTemplate;
vars.scrambleText.text = (i, target) => tmpl.replace(/\{original\}|\{text\}/g, target.getAttribute('data-original-text') || target.textContent.trim());
}

if (vars._counter && vars._counter._valueExpr && vars._counter._valueExpr._isExpr) {
const exprSrc = vars._counter._valueExpr.val; delete vars._counter._valueExpr;
const resolveCounterVal = (index, target) => {
const dataLookup = {}; if (globalDataSources) globalDataSources.forEach(src => { dataLookup[src.name] = src.entries; });
const tProxy = AnimationEngine.createProxy(target);
try { return parseFloat(evalSandboxed(exprSrc, { i: index, t: tProxy, ts: [], Math, data: dataLookup, sortBy, rankOf, pluck })) || 0; } catch(e) { return 0; }
};

const c = vars._counter; delete vars._counter;
vars.textContent = resolveCounterVal;
vars.modifiers = { ...vars.modifiers, textContent: value => {
let num = parseFloat(value); if (isNaN(num)) num = 0;
if (c.increment && c.increment > 0) num = gsap.utils.snap(c.increment, num);
let formatted = Number(num).toFixed(c.decimals || 0);
if (c.decimalChar !== '.') formatted = formatted.replace('.', c.decimalChar);
if (c.separatorChar) { const pts = formatted.split(c.decimalChar); pts[0] = pts[0].replace(/\B(?=(\d{3})+(?!\d))/g, c.separatorChar); formatted = pts.join(c.decimalChar); }
return (c.prefix || '') + formatted + (c.suffix || '');
}};
}
let staggerConfig = t.stagger ? t.stagger.amount : 0;

if (t.stagger && t.stagger.amount !== 0 && (t.stagger.advanced || t.stagger.mode === 'amount')) {
staggerConfig = { [t.stagger.mode]: t.stagger.amount };
if (t.stagger.advanced) {
staggerConfig.from = t.stagger.from;
if (t.stagger.axis) staggerConfig.axis = t.stagger.axis;
if (t.stagger.grid && t.stagger.grid !== 'auto') {
const gInput = String(t.stagger.grid).trim(); const parsed = gInput.replace(/[\[\]]/g, '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)); staggerConfig.grid = parsed.length > 0 ? parsed : 'auto';
} else { staggerConfig.grid = 'auto'; } 
}
if (t.stagger.ease && t.stagger.ease !== 'none') staggerConfig.ease = t.stagger.ease;
}
if (t.type === 'set') { currentTl.set(targets, { ...vars, stagger: staggerConfig }, actualPos); }
else { const finalVars = { id: t.id, ...baseConfig, stagger: staggerConfig, overwrite: 'auto', ...vars }; if (t.type === 'from') finalVars.immediateRender = false; currentTl[t.type](targets, finalVars, actualPos); }
}
}
if (t.viewBoxConfig) {
const cameraPos = elementsAnimated ? "<" : actualPos;
const vbTargetId = (t.viewBoxConfig._vbNodeId) ? t.viewBoxConfig._vbNodeId : rootSvgId;
const vbConfig = Object.assign({}, t.viewBoxConfig); delete vbConfig._vbNodeId;
const vbVars = { ...baseConfig, ...vbConfig };
if (t.type === 'set') { currentTl.set(`#${vbTargetId}`, vbConfig, cameraPos); }
else { if (t.type === 'from') vbVars.immediateRender = false; if (t.type === 'from') vbVars.lazy = false; currentTl[t.type](`#${vbTargetId}`, vbVars, cameraPos); }
}

// ── Video Play Parallel Tween ──────────────────────────────────────────────
// GSAP owns start/stop only. Browser plays the video natively — no seeking,
// no rate changes, no per-frame callbacks during playback.
if (t._videoPlayConfig) {
  const vpc = t._videoPlayConfig;
  const _vEl = document.getElementById(vpc.slotId);
  if (!_vEl || _vEl.tagName.toLowerCase() !== 'video') {
    // The slot this tween references no longer exists in the DOM — most likely
    // the video was replaced or the node was deleted after the tween was saved.
    console.warn(`[QweenApp] Video tween references slot "${vpc.slotId}" which is not in the DOM. Playback skipped.`);
    ElMessage.warning(`Video tween: slot "${vpc.slotId}" not found — re-select the video and re-save the tween.`);
  } else {
    const _vPos = elementsAnimated ? '<' : actualPos;
    // Clamp toTime to the video's actual duration so we never seek past end
    const _actualMax = (_vEl.duration && isFinite(_vEl.duration)) ? _vEl.duration : Infinity;
    const _safeFrom = parseFloat(Math.max(0, vpc.fromTime).toFixed(3));
    const _safeTo   = parseFloat(Math.min(vpc.toTime, _actualMax).toFixed(3));
    // Round _vDur to 3dp to avoid floating-point subtraction drift
    const _vDur = parseFloat((_safeTo - _safeFrom).toFixed(3)) || baseConfig.duration || 1;
    // GSAP-native approach (per GSAP docs): tween currentTime directly on the
    // video element from fromTime → toTime over _vDur seconds with ease:'none'.
    // Because GSAP owns the currentTime interpolation, timeScale(2) naturally
    // makes it advance twice as fast — no play(), no playbackRate needed.
    // Guard: only seek if the element has loaded enough data (readyState ≥ 1).
    // The warmUpVideo pass in playTimeline() already ensures readyState ≥ 3
    // for canplaythrough videos; this is a belt-and-suspenders safety net.
    _vEl.pause();
    if (_vEl.readyState >= 1) {
      _vEl.currentTime = _safeFrom;
    }
    currentTl.to(_vEl, {
      currentTime: _safeTo,
      duration: _vDur,
      ease: 'none',
    }, _vPos);
  }
}

};
tweens.forEach(t => processTweenNode(t, masterTl));

return masterTl;
}
};
window.AnimationEngine = AnimationEngine;
