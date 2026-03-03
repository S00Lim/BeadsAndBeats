// ==============================
// Beads & Beats: SVG -> p5
// OPTIMIZED:
// - Stripe overlay: cached canvas pattern (FAST, same look)
// - Remove texture modes entirely
// - Keep HSL Group Gradient Color + layer separation boundary
//
// ✅ FIXES INCLUDED (THIS VERSION):
// 1) ✅ Preset03 "one blob" fix: stop duplicate rect collection (nested groups)
//    - Only parse matched <g id="..._inner|mid|outer...">
//    - Collect rects recursively BUT stop descending into child groups that also match
// 2) ✅ Randomize color restored to OLD behavior:
//    - If palette = "Rainbow (SVG)" and random ON -> use SVG_CLASS_COLORS values
//    - Else random ON -> use selected palette array (or Default)
//    - Removed extra random HSL jitter inside group gradient (was making it weird)
//
// ✅ ADDED (THIS VERSION):
// 3) ✅ Randomize PEARL beads feature integrated into your original structure
//    - Pearl rendering toggle
//    - Deterministic per-bead pearl variations (stable)
//    - "Randomize pearl" button: changes pearlSeed (new stable look)
//    - Pearl tint can follow bead color, with subtle iridescence
//
// ✅ Reveal system / AUTO sequence kept
// ✅ Play button kept
// ✅ Draw loop safety kept
// ==============================


let labelBoldEl = null;
let labelDarkEl = null;


// ✅ Cursor must be defined BEFORE any use
const CURSOR_URL = "cursor-mouse.png";
const CURSOR_CSS = `url(${CURSOR_URL}) 0 0, auto`;

// (선택) 확인 로그는 setup() 안에서 찍어
// console.log(CURSOR_URL, CURSOR_CSS);



function applyCustomCursor() {
  // 1) 캔버스
  if (typeof canvas !== "undefined" && canvas) {
    canvas.style.cursor = CURSOR_CSS;
  }

  // 2) UI stage
  if (typeof uiStageEl !== "undefined" && uiStageEl && uiStageEl.elt) {
    uiStageEl.elt.style.cursor = CURSOR_CSS;
  }

  // 3) UI hit div들 (aria-label 있는 애들만)
  document.querySelectorAll("#ui-stage [aria-label]").forEach((el) => {
    el.style.cursor = CURSOR_CSS;
  });
}


// ---------- SVG docs ----------
let svgBaseDoc;
let svgPresetDocs = [];

// ---------- Beads sets ----------
let beadsBase = [];
let beadsPresets = [];
let presetXforms = []; // { s, dx, dy }

// ---------- Current ----------
let beads = [];
let usingPreset = false;
let currentPresetIndex = -1;

// ---------- Fit / bounds ----------
let view = { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
let fit = { s: 1, tx: 0, ty: 0 };
let BASE_BOUNDS_FIXED = null;


let updateUITransform = null;

// ---------- UI ----------

let uiLayerMode = 0; // 0=Bold, 1=Regular, 2=Light 

let groupGradMotionOn = false;


let ui = {};
let uiPanelEl = null;
let uiPanelVisible = false;

// ---------- Settings ----------
const LAYERS = ["inner", "mid", "outer"];
const DEFAULT_COLORS = {
  inner: "#c22bb8",
  mid: "#eda4ff",
  outer: "#9ee4dc",
};

const PALETTES = {
  Default: ["#c22bb8", "#eda4ff", "#9ee4dc"],
  Candy: ["#ffebad", "#ff8c66", "#21d4f5"],
  Ice: ["#bde0fe", "#a2d2ff", "#cdb4db"],
  Mono: ["#111111", "#444444", "#888888"],
  "Rainbow (SVG)": null,
};

const SVG_CLASS_COLORS = {
  "cls-1": "#ff17a7",
  "cls-2": "#ff4200",
  "cls-3": "#eda4ff",
  "cls-4": "#c22bb8",
  "cls-5": "#fc39b3",
  "cls-6": "#39d631",
  "cls-7": "#fdec06",
  "cls-8": "#9ee4dc",
};

// ---------- Word mapping ----------
let wordColorMap = {};
const WORDS = {
  BEADS: ["B1", "E1", "A1", "D1", "S1"],
  AND: ["A2", "N1", "D2"],
  BEATS: ["B2", "E2", "A3", "T1", "S2"],
};

function glyphToWord(glyphKey) {
  for (const w of Object.keys(WORDS)) {
    if (WORDS[w].includes(glyphKey)) return w;
  }
  return "OTHER";
}

// ✅ Global fixed diamond size (derived from base)
let UNIT_SIZE = 40; // overwritten

// ==============================
// ✅ Reveal (stamp-in) animation
// ==============================
let reveal = {
  active: true,
  startFrame: 0,
  orderMap: null,
  endFrame: 0,
  stepFrames: 0.06,
  durFrames: 9,
  instantFrac: 0.0, // 0..1
};

function startRevealWithParams(params = {}) {
  if (ui.revealOn && !ui.revealOn.checked()) {
    reveal.active = false;
    reveal.orderMap = null;
    return;
  }

  reveal.active = true;
  reveal.startFrame = frameCount;
  reveal.orderMap = new Map();

  reveal.stepFrames = isFinite(params.stepFrames)
    ? params.stepFrames
    : reveal.stepFrames;
  reveal.durFrames = isFinite(params.durFrames)
    ? params.durFrames
    : reveal.durFrames;
  reveal.instantFrac = isFinite(params.instantFrac)
    ? clamp01(params.instantFrac)
    : reveal.instantFrac;

  const n = beads.length;
  if (!n) {
    reveal.active = false;
    reveal.orderMap = null;
    return;
  }

  const instantThreshold = Math.floor(reveal.instantFrac * 100);

  const idxs = [];
  for (let i = 0; i < n; i++) idxs.push(i);

  for (let i = idxs.length - 1; i > 0; i--) {
    const j = floor(random(i + 1));
    const tmp = idxs[i];
    idxs[i] = idxs[j];
    idxs[j] = tmp;
  }

  let staggerRank = 0;
  for (let k = 0; k < n; k++) {
    const bi = idxs[k];
    const b = beads[bi];
    if (!b) continue;

    const h = Math.abs(b.hash) % 100;

    if (instantThreshold > 0 && h < instantThreshold) {
      reveal.orderMap.set(b.hash, -1);
    } else {
      reveal.orderMap.set(b.hash, staggerRank);
      staggerRank++;
    }
  }

  const staggerCount = staggerRank;
  reveal.endFrame =
    reveal.startFrame +
    max(0, staggerCount - 1) * reveal.stepFrames +
    reveal.durFrames;
}



function startReveal() {
  startRevealWithParams({ stepFrames: 0.06, durFrames: 9, instantFrac: 0.0 });
}

function isRevealRunning() {
  if (ui.revealOn && !ui.revealOn.checked()) return false;
  return !!(reveal.active && reveal.orderMap);
}

function getAppearForBead(b) {
  if (ui.revealOn && !ui.revealOn.checked()) return { skip: false, s: 1, a: 1 };
  if (!reveal.active || !reveal.orderMap) return { skip: false, s: 1, a: 1 };

  const rank = reveal.orderMap.get(b.hash);

  if (rank === -1) return { skip: false, s: 1, a: 1 };

  const r = isFinite(rank) ? rank : 0;

  const n = hash01FromBead(b); // 0..1
  const jitter = (n - 0.5) * 6; // -3..3 정도
  const delay = r * reveal.stepFrames + jitter;
  const local = (frameCount - reveal.startFrame - delay) / reveal.durFrames;

  if (local < 0) return { skip: true, s: 0, a: 0 };

  const t = constrain(local, 0, 1);
  const s = easeOutBack(t, 1.15);
  const a = t * t; // ease-in (천천히 시작)
  if (frameCount > reveal.endFrame) reveal.active = false;

  return { skip: false, s, a };
}

function centerSvgTextOnX(textEl, centerX) {
  if (!textEl) return;

  // 현재 transform에서 y만 유지
  const tf = textEl.getAttribute("transform") || "";
  const m = tf.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
  const y = m ? parseFloat(m[2]) : 0;

  textEl.setAttribute("text-anchor", "middle"); // 핵심
  textEl.setAttribute("transform", `translate(${centerX} ${y})`);

  // tspan도 x=0으로 고정해주면 더 안정적
  const tspan = textEl.querySelector("tspan");
  if (tspan) tspan.setAttribute("x", "0");
}


function easeOutBack(t, overshoot = 1.6) {
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2);
}

// ==============================
// ✅ AUTO (deterministic sequence)
// ==============================
let AUTO_ANIM = {
  enabled: true,
  phase: "INIT",
  pulseStartFrame: 0,
  pulseFrames: 14,
  holdFrames: 24,
  pulseAmp: 0.035,
  humpPow: 1.0,
  seq: [],
  seqIndex: 0,
  didDisableRandom: false,
  stoppedAtBase: false,
  holdStartFrame: 0,
};

function hump01(t01, p = 2.6) {
  const t = constrain(t01, 0, 1);
  const x = sin(PI * t);
  return pow(max(0, x), p);
}

function computeAutoLogoScale() {
  if (!AUTO_ANIM.enabled) return 1;

  if (
    AUTO_ANIM.phase === "START_PULSE1" ||
    AUTO_ANIM.phase === "PULSE_SWITCH"
  ) {
    const t01 =
      (frameCount - AUTO_ANIM.pulseStartFrame) / AUTO_ANIM.pulseFrames;
    const h = hump01(t01, AUTO_ANIM.humpPow);
    return 1 + AUTO_ANIM.pulseAmp * h;
  }
  return 1;
}

function pulseFinished() {
  return frameCount - AUTO_ANIM.pulseStartFrame >= AUTO_ANIM.pulseFrames;
}

function startPulse(phaseName) {
  AUTO_ANIM.phase = phaseName;
  AUTO_ANIM.pulseStartFrame = frameCount;
}

function buildDeterministicSequence() {
  AUTO_ANIM.seq = [];
  for (let i = 0; i <= 6; i++) AUTO_ANIM.seq.push({ type: "preset", idx: i });
  AUTO_ANIM.seq.push({ type: "preset", idx: 8 });
  AUTO_ANIM.seq.push({ type: "base" });
  AUTO_ANIM.seqIndex = 0;
}

const REVEAL_PRESETS = {
  INTRO_SLOW: { stepFrames: 0.075, durFrames: 10, instantFrac: 0.0 },
  SWITCH_FAST_PARTIAL: { stepFrames: 0.03, durFrames: 15, instantFrac: 0.8 },
};

function applyTarget(target) {
  if (!target) return false;

  if (target.type === "base") {
    beads = beadsBase;
    usingPreset = false;
    currentPresetIndex = -1;

    startRevealWithParams(REVEAL_PRESETS.SWITCH_FAST_PARTIAL);

    AUTO_ANIM.enabled = false;
    AUTO_ANIM.stoppedAtBase = true;
    invalidateGroupBoundsCache();
    return true;
  }

  const idx = target.idx;
  const arr = beadsPresets[idx];
  if (!arr || !arr.length) return false;

  beads = arr;
  usingPreset = true;
  currentPresetIndex = idx;
  invalidateGroupBoundsCache();

  startRevealWithParams(REVEAL_PRESETS.SWITCH_FAST_PARTIAL);
  return true;
}

function applyPresetIndex(idx) {
  const arr = beadsPresets[idx];
  if (!arr || !arr.length) return false;

  beads = arr;
  usingPreset = true;
  currentPresetIndex = idx;
  invalidateGroupBoundsCache();
  return true;
}

// ==============================
// ✅ Pearl randomize system (stable per-bead)
// ==============================
let pearlSeed = 1337;

function rand01FromHash(h, salt = 0) {
  // fast deterministic 0..1 from int
  let x = (h ^ (salt | 0)) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  // uint
  const u = x >>> 0;
  return u / 4294967295;
}

function randomizePearlSeed() {
  // new global seed, keeps per-bead stability
  pearlSeed = (Math.random() * 2147483647) | 0;
}



// ==============================
// Preload
// ==============================
function preload() {
  uiSvgLines = loadStrings("UI sketch.txt");
  svgBaseDoc = loadXML("BeadsandBeatsLayers.svg");

  for (let i = 1; i <= 9; i++) {
    const n = String(i).padStart(2, "0");
    const filename = `BeadsandBeatsPreset${n}.svg`;
    const doc = loadXML(
      filename,
      () => console.log("Loaded:", filename),
      () => console.warn("Missing preset:", filename)
    );
    svgPresetDocs.push(doc);
  }
}

function fract(x) {
  return x - Math.floor(x);
}
function hash01FromBead(b) {
  return (Math.abs(b.hash) % 10000) / 10000; // 0..1
}

// ==============================
// Setup
// ==============================
function setup() {
   
  const cnv = createCanvas(windowWidth, windowHeight);

    canvas = cnv.elt;

  cnv.elt.style.cursor = CURSOR_CSS;



  
  
  // p5.dom style 말고 DOM style로
  cnv.elt.style.position = "fixed";
  cnv.elt.style.left = "0";
  cnv.elt.style.top = "0";
  cnv.elt.style.zIndex = "1"; // UI는 이보다 위
  angleMode(RADIANS);
  rectMode(CENTER);

  beadsBase = parseSVGToBeads(svgBaseDoc);

  UNIT_SIZE = medianRawRectSize(beadsBase);
  if (!isFinite(UNIT_SIZE) || UNIT_SIZE <= 0) UNIT_SIZE = 40;

  BASE_BOUNDS_FIXED = computeBoundsFixed(beadsBase, 0, 0);

  beadsPresets = [];
  presetXforms = [];

  for (let i = 0; i < svgPresetDocs.length; i++) {
    const doc = svgPresetDocs[i];
    const arr = doc ? parseSVGToBeads(doc) : [];
    beadsPresets.push(arr);

    if (arr.length) {
      const presetBounds = computeBoundsFixed(arr, 0, 0);
      const dx = BASE_BOUNDS_FIXED.cx - presetBounds.cx;
      const dy = BASE_BOUNDS_FIXED.cy - presetBounds.cy;
      presetXforms.push({ s: 1, dx, dy });
    } else {
      presetXforms.push({ s: 1, dx: 0, dy: 0 });
    }
  }

  beads = beadsBase;
  usingPreset = false;
  currentPresetIndex = -1;

  computeViewBounds();
computeFitToUI();
  
  buildUI();
    applyCustomCursor();

  resetWordColors();
// buildDeterministicSequence(); // 필요 없으면 이것도 꺼도 됨

// ✅ 처음 실행: 무조건 base 로고로 고정
beads = beadsBase;
usingPreset = false;
currentPresetIndex = -1;

AUTO_ANIM.enabled = false;      // ✅ 자동 시퀀스 끔
AUTO_ANIM.stoppedAtBase = true; // (선택) 상태 표시용

// (선택) base 로고에만 reveal 한 번 주고 싶으면 유지
startRevealWithParams(REVEAL_PRESETS.INTRO_SLOW);

invalidateGroupBoundsCache();

  invalidateStripePattern();
  
const style = document.createElement("style");
style.textContent = `
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }
  canvas { display: block; }
  html, body, canvas, #ui-stage, #ui-stage * {
    cursor: ${CURSOR_CSS} !important;
  }
`;
document.head.appendChild(style);
  
  
}

function restartFullIntroAndAuto() {
  beads = beadsBase;
  usingPreset = false;
  currentPresetIndex = -1;

  buildDeterministicSequence();

  const ok = applyPresetIndex(7);
  if (!ok) {
    beads = beadsBase;
    usingPreset = false;
    currentPresetIndex = -1;
  }

  ui.paletteSelect.selected("Rainbow (SVG)");
  ui.randomColorOn.checked(true);
  ui.revealOn.checked(true);

  startRevealWithParams(REVEAL_PRESETS.INTRO_SLOW);

  AUTO_ANIM.phase = "REVEAL_WAIT";
  AUTO_ANIM.didDisableRandom = false;
  AUTO_ANIM.enabled = true;
  AUTO_ANIM.stoppedAtBase = false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeFitToUI();
}

function keyPressed() {
  if (key === "h" || key === "H") togglePanel();
}

// ==============================
// Draw (with safety wrapper)
// ==============================
let _runtimeErrorMsg = "";
function draw() {
  try {
    _runtimeErrorMsg = "";
    drawSafe();
  } catch (e) {
    console.error(e);
    _runtimeErrorMsg = String(e?.message || e);

    background(255);
    push();
    fill(0);
    noStroke();
    textAlign(LEFT, TOP);
    textSize(14);
    text(
      `Runtime error (render stopped):\n${_runtimeErrorMsg}\n\nOpen console for stack trace.`,
      16,
      16
    );
    pop();
  }
}

function drawSafe() {
  // background()는 이제 흰색으로만 깔아도 됨 (어차피 UI 배경을 따로 그림)
  
  // ✅ editor 프리뷰 패널 리사이즈에도 반응하게: 매 프레임 실제 표시 크기 sync
  const rect = canvas.getBoundingClientRect();
  const ww = Math.round(rect.width);
  const hh = Math.round(rect.height);

  if (ww > 0 && hh > 0 && (ww !== width || hh !== height)) {
    resizeCanvas(ww, hh);
    computeFitToUI();
    if (updateUITransform) updateUITransform(); // UI도 같이 맞추고 싶으면
  }
  background(255);
  

  // UI 배경판 먼저
  drawUIBackplates();

  // 그 다음 로고(비즈) 렌더링

  if (AUTO_ANIM.enabled) {
    if (AUTO_ANIM.phase === "REVEAL_WAIT") {
      if (!isRevealRunning()) startPulse("START_PULSE1");
    } else if (AUTO_ANIM.phase === "START_PULSE1") {
      if (pulseFinished()) {
        if (!AUTO_ANIM.didDisableRandom) {
          ui.randomColorOn.checked(false);
          AUTO_ANIM.didDisableRandom = true;

          // ✅ 랜더마이즈 OFF로 바뀌는 순간에도 다다닥(리빌) 실행
          startRevealWithParams(REVEAL_PRESETS.SWITCH_FAST_PARTIAL);
        }
        AUTO_ANIM.phase = "HOLD";
        AUTO_ANIM.holdStartFrame = frameCount;
      }
    } else if (AUTO_ANIM.phase === "HOLD") {
      if (frameCount - AUTO_ANIM.holdStartFrame >= AUTO_ANIM.holdFrames) {
        startPulse("PULSE_SWITCH");
      }
    } else if (AUTO_ANIM.phase === "PULSE_SWITCH") {
      if (pulseFinished()) {
        let applied = false;

        while (AUTO_ANIM.seqIndex < AUTO_ANIM.seq.length && !applied) {
          const target = AUTO_ANIM.seq[AUTO_ANIM.seqIndex];
          AUTO_ANIM.seqIndex++;
          applied = applyTarget(target);
        }

        if (!applied) {
          AUTO_ANIM.enabled = false;
        } else if (AUTO_ANIM.enabled) {
          AUTO_ANIM.phase = "HOLD";
          AUTO_ANIM.holdStartFrame = frameCount;
        }
      }
    }
  }

  const autoScale = computeAutoLogoScale();
  const t = frameCount;
  const beat01 = (sin(t * ui.pulseSpeed.value()) + 1) * 0.5;

  let xf = { dx: 0, dy: 0 };
  if (usingPreset && currentPresetIndex >= 0)
    xf = presetXforms[currentPresetIndex] || xf;

  buildGroupBoundsCacheIfNeeded(xf);
  updateStripePatternIfNeeded();

  const { s: uiS, ox, oy } = getUIScaleAndOffset();


  push();
// 1) UI 스케치 좌표계로 진입
translate(ox, oy);
scale(uiS);

// 2) 그 안에서 로고 fit 적용 (1920x1080 기준)
translate(fit.tx, fit.ty);
scale(fit.s);

rotate(radians(ui.globalRotate.value()));

const cx = (view.minX + view.maxX) * 0.5;
const cy = (view.minY + view.maxY) * 0.5;
translate(cx, cy);
scale(autoScale);
translate(-cx, -cy);
  
  // ✅ 실제 비즈 렌더링 (이거 없으면 변환만 하고 아무것도 안 그려짐)
const knobs = {
  pulseAmp: ui.pulseAmp.value(),
  jitterAmp: ui.jitterAmp.value(),
};

for (const bead of beads) {
  if (!layerVisible(bead.layer)) continue;

  const appear = getAppearForBead(bead);
  if (appear.skip) continue;

  const p = computeMotionParams(bead, t, beat01, knobs);

  if (usingPreset && currentPresetIndex >= 0) {
    bead.displayFixedWithTransform(p, xf.dx || 0, xf.dy || 0, appear);
  } else {
    bead.displayFixed(p, appear);
  }
}

  pop();
  drawHUD();
}

// ==============================
// ✅ SVG parsing (Preset03 blob fix)
// ==============================

function parseGroupIdToGlyphLayer(gidRaw) {
  const gid = (gidRaw || "").trim();
  if (!gid) return null;

  const m = gid.match(/^(.+?)[_-](inner|mid|outer)(?:[_-].*)?$/i);
  if (!m) return null;

  const glyphKey = m[1];
  const layer = m[2].toLowerCase();
  return { glyphKey, layer };
}

function collectGroupsRecursive(node, out) {
  if (!node) return;
  const gs = node.getChildren ? node.getChildren("g") : [];
  for (const g of gs) {
    out.push(g);
    collectGroupsRecursive(g, out);
  }
}

function collectRectsStopAtMatchedGroups(node, outRects) {
  if (!node) return;

  const rects = node.getChildren ? node.getChildren("rect") : [];
  for (const r of rects) outRects.push(r);

  const kids = node.getChildren ? node.getChildren("g") : [];
  for (const k of kids) {
    const kidId = (k.getString && k.getString("id")) || "";
    const gl = parseGroupIdToGlyphLayer(kidId);
    if (gl) continue;
    collectRectsStopAtMatchedGroups(k, outRects);
  }
}

function parseSVGToBeads(doc) {
  const out = [];
  if (!doc) return out;

  const groups = [];
  collectGroupsRecursive(doc, groups);

  for (const g of groups) {
    const gid = ((g.getString && g.getString("id")) || "").trim();
    const gl = parseGroupIdToGlyphLayer(gid);
    if (!gl) continue;

    const glyphKey = gl.glyphKey;
    const layer = gl.layer;
    const word = glyphToWord(glyphKey);

    const rects = [];
    collectRectsStopAtMatchedGroups(g, rects);

    for (const r of rects) {
      const x = parseFloatSafe(r.getString("x"));
      const y = parseFloatSafe(r.getString("y"));
      const w = parseFloatSafe(r.getString("width"));
      const h = parseFloatSafe(r.getString("height"));

      const rawSize = isFinite(w) ? w : isFinite(h) ? h : 40;

      const cls = (r.getString("class") || "").trim();
      const svgFill = SVG_CLASS_COLORS[cls] || null;

      const cx = x + (isFinite(w) ? w * 0.5 : rawSize * 0.5);
      const cy = y + (isFinite(h) ? h * 0.5 : rawSize * 0.5);

      out.push(new Bead(cx, cy, layer, glyphKey, word, cls, svgFill, rawSize));
    }
  }

  return out;
}

function parseFloatSafe(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : NaN;
}

// ==============================
// Bounds (fixed by UNIT_SIZE)
// ==============================
function computeBoundsFixed(arr, dx, dy) {
  if (!arr || !arr.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1, cx: 0.5, cy: 0.5 };
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const half = UNIT_SIZE * 0.5;

  for (const b of arr) {
    const x = b.x + dx;
    const y = b.y + dy;
    minX = min(minX, x - half);
    minY = min(minY, y - half);
    maxX = max(maxX, x + half);
    maxY = max(maxY, y + half);
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  return { minX, minY, maxX, maxY, w, h, cx, cy };
}

function computeViewBounds() {
  // Compute bounds from CURRENT beads (base or preset), so fit always works.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // preset transform (if any)
  let xf = { dx: 0, dy: 0 };
  if (usingPreset && currentPresetIndex >= 0 && presetXforms && presetXforms[currentPresetIndex]) {
    xf = presetXforms[currentPresetIndex];
  }

  for (const b of beads) {
    // include all beads; visibility toggles affect draw only
    const x = b.x + (usingPreset ? (xf.dx || 0) : 0);
    const y = b.y + (usingPreset ? (xf.dy || 0) : 0);
    if (!isFinite(x) || !isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!isFinite(minX)) {
    // fallback
    view.minX = 0; view.minY = 0; view.maxX = 1; view.maxY = 1; view.w = 1; view.h = 1;
    return;
  }

  view.minX = minX;
  view.minY = minY;
  view.maxX = maxX;
  view.maxY = maxY;
  view.w = Math.max(1e-6, maxX - minX);
  view.h = Math.max(1e-6, maxY - minY);
}

function computeFitToUI() {
  computeViewBounds();

  const uiW = 1920;
  const uiH = 1080;

  const margin = ui.fitMargin ? ui.fitMargin.value() : 60;
  const userScale = ui.userScale ? ui.userScale.value() : 1;

  // UI 스케치 하단 바 영역을 피하고 싶으면 여기 숫자 조절
  const bottomReserved = 190; // 180~260 사이에서 취향껏
  const availW = Math.max(10, uiW - margin * 2);
  const availH = Math.max(10, uiH - margin * 2 - bottomReserved);

  const sFit = Math.min(availW / view.w, availH / view.h) * userScale;

  const cx = (view.minX + view.maxX) * 0.5;
  const cy = (view.minY + view.maxY) * 0.5;

  fit.s = sFit;
  fit.tx = uiW * 0.5 - cx * sFit;

  const liftUp = 40; // 로고를 더 위로 올리고 싶으면 +값(예: 80~180)
  fit.ty = uiH * 0.5 - cy * sFit - liftUp;

  if (!isFinite(fit.tx) || !isFinite(fit.ty) || !isFinite(fit.s)) {
    fit.s = 1;
    fit.tx = 0;
    fit.ty = 0;
  }
}

// ==============================
// UNIT_SIZE from base median
// ==============================
function medianRawRectSize(arr) {
  const sizes = (arr || [])
    .map((b) => b.rawRectSize)
    .filter((n) => isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (!sizes.length) return 40;
  const mid = floor(sizes.length / 2);
  return sizes.length % 2 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) * 0.5;
}

// ==============================
// Motion
// ==============================
function computeMotionParams(b, t, beat01, knobs) {
  const layerAmp = getLayerAmp(b.layer);

  let dx = 0;
  let dy = 0;
  let sizeAdd = 0;
  let rotAdd = 0;

  if (ui.pulseOn.checked()) {
    const a = knobs.pulseAmp * layerAmp;
    sizeAdd += -beat01 * a;
  }

  if (ui.jitterOn.checked()) {
    const a = knobs.jitterAmp * layerAmp;
    dx += random(-1, 1) * a;
    dy += random(-1, 1) * a;
  }

  if (ui.diamondOn.checked()) rotAdd += QUARTER_PI;

  const clr = getBeadColor(b);
  return { dx, dy, sizeAdd, rot: rotAdd, clr };
}

function getLayerAmp(layer) {
  const midRatio = ui.midRatio.value();
  const outerRatio = ui.outerRatio.value();
  if (layer === "inner") return 1.0;
  if (layer === "mid") return midRatio;
  return outerRatio;
}

// ==============================
// ✅ Color priority (Randomize restored to old behavior)
// ==============================
function getBeadColor(b) {
  const paletteName = ui.paletteSelect.value();
  let base = DEFAULT_COLORS[b.layer];

  if (paletteName === "Rainbow (SVG)") {
    base = b.svgFill || DEFAULT_COLORS[b.layer];
  } else if (ui.paletteOn.checked()) {
    const pal = PALETTES[paletteName] || PALETTES.Default;
    const idx = LAYERS.indexOf(b.layer);
    base = pal[idx % pal.length];
  }

  if (ui.wordColorOn.checked()) {
    const set = wordColorMap[b.word];
    if (set) {
      const idx = LAYERS.indexOf(b.layer);
      base = set[idx] || base;
    }
  }

  // ✅ Randomize는 "base"만 바꾸기 (c를 갈아치우지 말기)
  if (ui.randomColorOn.checked()) {
    const n = Math.abs(b.hash) >>> 0;

    if (paletteName === "Rainbow (SVG)") {
      const keys = Object.keys(SVG_CLASS_COLORS);
      base = SVG_CLASS_COLORS[keys[n % keys.length]];
    } else {
      const pal = PALETTES[paletteName] || PALETTES.Default;
      base = pal[n % pal.length];
    }
  }

  // 여기서 c 생성
  let c = color(base);

  // ✅ 마지막에 Group Gradient가 최종 룩을 결정하게
  if (ui.groupGradOn && ui.groupGradOn.checked()) {
    c = applyGroupGradientColor(b, c);
  }

  return c;
}
// ==============================
// Word colors
// ==============================
function resetWordColors() {
  wordColorMap = {};
  for (const w of Object.keys(WORDS)) {
    wordColorMap[w] = [
      DEFAULT_COLORS.inner,
      DEFAULT_COLORS.mid,
      DEFAULT_COLORS.outer,
    ];
  }
  wordColorMap["OTHER"] = [
    DEFAULT_COLORS.inner,
    DEFAULT_COLORS.mid,
    DEFAULT_COLORS.outer,
  ];
}

function randomizeWordColors() {
  const paletteName = ui.paletteSelect.value();
  const pal =
    paletteName === "Rainbow (SVG)"
      ? Object.values(SVG_CLASS_COLORS)
      : PALETTES[paletteName] || PALETTES.Default;

  const words = new Set(beads.map((b) => b.word));
  for (const w of words) {
    const c1 = pal[floor(random(pal.length))];
    const c2 = pal[floor(random(pal.length))];
    const c3 = pal[floor(random(pal.length))];
    wordColorMap[w] = [c1, c2, c3];
  }
}

// ==============================
// Visibility
// ==============================
function layerVisible(layer) {
  if (layer === "inner") return ui.showInner.checked();
  if (layer === "mid") return ui.showMid.checked();
  return ui.showOuter.checked();
}

// ==============================
// Helpers
// ==============================
function clamp01(x) {
  return max(0, min(1, x));
}
function lerp01(a, b, t) {
  return a + (b - a) * clamp01(t);
}
function colorToRgb(c) {
  return { r: red(c), g: green(c), b: blue(c), a: alpha(c) };
}
function rgbaStr(r, g, b, a01) {
  return `rgba(${r | 0},${g | 0},${b | 0},${clamp01(a01)})`;
}
function mixRgb(a, b, t) {
  return {
    r: lerp01(a.r, b.r, t),
    g: lerp01(a.g, b.g, t),
    b: lerp01(a.b, b.b, t),
  };
}

// ==============================
// HSL tools
// ==============================
function rgbToHsl01(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const maxv = Math.max(r, g, b),
    minv = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (maxv + minv) / 2;
  const d = maxv - minv;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (maxv) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hsl01ToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0,
    gp = 0,
    bp = 0;

  if (0 <= h && h < 60) {
    rp = c;
    gp = x;
    bp = 0;
  } else if (60 <= h && h < 120) {
    rp = x;
    gp = c;
    bp = 0;
  } else if (120 <= h && h < 180) {
    rp = 0;
    gp = c;
    bp = x;
  } else if (180 <= h && h < 240) {
    rp = 0;
    gp = x;
    bp = c;
  } else if (240 <= h && h < 300) {
    rp = x;
    gp = 0;
    bp = c;
  } else {
    rp = c;
    gp = 0;
    bp = x;
  }

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function lerpHue(h1, h2, t) {
  let d = ((h2 - h1 + 540) % 360) - 180;
  return (h1 + d * clamp01(t) + 360) % 360;
}

function lerpColorHSL(c1, c2, t, satBoost = 1.0) {
  const a = colorToRgb(c1);
  const b = colorToRgb(c2);
  const A = rgbToHsl01(a.r, a.g, a.b);
  const B = rgbToHsl01(b.r, b.g, b.b);

  const h = lerpHue(A.h, B.h, t);
  let s = lerp01(A.s, B.s, t) * satBoost;
  let l = lerp01(A.l, B.l, t);
  s = clamp01(s);
  l = clamp01(l);

  const rgb = hsl01ToRgb(h, s, l);
  const out = color(rgb.r, rgb.g, rgb.b);
  out.setAlpha(lerp01(alpha(c1), alpha(c2), t));
  return out;
}

function lerp3HSL(cTop, cMid, cBot, t, satBoost = 1.0) {
  const tt = clamp01(t);
  if (tt < 0.5) return lerpColorHSL(cTop, cMid, tt * 2, satBoost);
  return lerpColorHSL(cMid, cBot, (tt - 0.5) * 2, satBoost);
}

function tweakHSL(col, dh = 0, ds = 1, dl = 0) {
  const A = colorToRgb(col);
  const hsl = rgbToHsl01(A.r, A.g, A.b);
  let h = (hsl.h + dh + 360) % 360;
  let s = clamp01(hsl.s * ds);
  let l = clamp01(hsl.l + dl);
  const rgb = hsl01ToRgb(h, s, l);
  const out = color(rgb.r, rgb.g, rgb.b);
  out.setAlpha(alpha(col));
  return out;
}

// ==============================
// Group Gradient bounds cache
// ==============================
let groupBoundsCache = null;
let groupBoundsCacheKey = "";
let groupBoundsDirty = true;

function invalidateGroupBoundsCache() {
  groupBoundsDirty = true;
  groupBoundsCache = null;
  groupBoundsCacheKey = "";
}

function getGroupKey(b) {
  const mode = ui.groupGradGroupBy ? ui.groupGradGroupBy.value() : "Layer";
  if (mode === "Layer") return `L:${b.layer}`;
  if (mode === "Word") return `W:${b.word}`;
  if (mode === "Glyph") return `G:${b.glyphKey}`;
  return "ALL";
}

function buildGroupBoundsCacheIfNeeded(xf) {
  if (!(ui.groupGradOn && ui.groupGradOn.checked())) return;

  const mode = ui.groupGradGroupBy ? ui.groupGradGroupBy.value() : "Layer";
  const dir = ui.groupGradDir ? ui.groupGradDir.value() : "Vertical";
  const cacheKey = `${mode}|${dir}|${
    usingPreset ? currentPresetIndex : "base"
  }|${xf.dx.toFixed(2)}|${xf.dy.toFixed(2)}`;

  if (!groupBoundsDirty && groupBoundsCache && groupBoundsCacheKey === cacheKey)
    return;

  groupBoundsCacheKey = cacheKey;
  groupBoundsDirty = false;
  groupBoundsCache = new Map();

  const half = UNIT_SIZE * 0.5;

  for (const b of beads) {
    const k = getGroupKey(b);
    let bb = groupBoundsCache.get(k);
    if (!bb) {
      bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      groupBoundsCache.set(k, bb);
    }
    const px = b.x + (usingPreset ? xf.dx : 0);
    const py = b.y + (usingPreset ? xf.dy : 0);
    bb.minX = Math.min(bb.minX, px - half);
    bb.minY = Math.min(bb.minY, py - half);
    bb.maxX = Math.max(bb.maxX, px + half);
    bb.maxY = Math.max(bb.maxY, py + half);
  }

  for (const [k, bb] of groupBoundsCache.entries()) {
    bb.w = Math.max(1e-6, bb.maxX - bb.minX);
    bb.h = Math.max(1e-6, bb.maxY - bb.minY);
    bb.cx = (bb.minX + bb.maxX) * 0.5;
    bb.cy = (bb.minY + bb.maxY) * 0.5;
  }
}

function groupTForBead(b, xf) {
  const k = getGroupKey(b);
  const bb = groupBoundsCache ? groupBoundsCache.get(k) : null;
  if (!bb) return 0.5;

  const px = b.x + (usingPreset ? xf.dx : 0);
  const py = b.y + (usingPreset ? xf.dy : 0);

  const dir = ui.groupGradDir ? ui.groupGradDir.value() : "Vertical";

  let t = 0.5;
  if (dir === "Horizontal") {
    t = (px - bb.minX) / bb.w;
  } else if (dir === "Radial") {
    const dx = (px - bb.cx) / (bb.w * 0.5);
    const dy = (py - bb.cy) / (bb.h * 0.5);
    t = Math.sqrt(dx * dx + dy * dy);
  } else {
    t = (py - bb.minY) / bb.h;
  }

  t = clamp01(t);

  const sep = ui.groupGradLayerSep ? ui.groupGradLayerSep.value() : 0;
  const mode = ui.groupGradGroupBy ? ui.groupGradGroupBy.value() : "Layer";
  if (mode === "Layer" && sep > 0) {
    const li = LAYERS.indexOf(b.layer);
    const center = (li - 1) * 0.18 * sep;
    t = clamp01(t + center);
  }

// ✅ Group Gradient Motion (Animate > Gradient)
if (groupGradMotionOn) {
  const spd = 0.009; // speed
  const amt = 1;   // amount

  // 안전한 fract (음수 방지)
  const wrap01 = (x) => ((x % 1) + 1) % 1;

if (dir === "Radial") {
  // 1) outward flow (t가 계속 앞으로 순환)
  const time = frameCount * spd;

  // 2) optional ripple: t 위치에 따라 파동이 조금 섞임
  const freq = 2.0;      // 링 개수 느낌 (예: 1.5~4.0)
  const rippleAmt = 0.06; // 물결 강도 (0이면 outward만)

  const outward = wrap01(t + time); // ✅ 핵심: 바깥으로 흐름
  const wave = 0.5 + 0.5 * sin(TWO_PI * (t * freq - time)); // 리플

  const mix = 0.25; // ✅ 0.2~0.35 추천 (낮을수록 예전처럼 "흐름" 위주)
  const tAnim = outward * (1 - mix) + wave * mix;

  t = wrap01(lerp(t, tAnim, amt));
} else {
  t = wrap01(t + frameCount * spd * amt);
}
}

  return t;
}

function applyGroupGradientColor(b, baseClr) {
  let topC = ui.groupTopPicker ? ui.groupTopPicker.color() : color("#f3e58a");
  let midC = ui.groupMidPicker ? ui.groupMidPicker.color() : color("#ffffff");
  let botC = ui.groupBottomPicker
    ? ui.groupBottomPicker.color()
    : color("#f3a1bf");

  const groupBy = ui.groupGradGroupBy ? ui.groupGradGroupBy.value() : "Layer";

  if (groupBy === "Layer") {
    if (b.layer === "inner") {
      topC = tweakHSL(topC, -6, 1.15, -0.04);
      midC = tweakHSL(midC, -4, 1.1, -0.02);
      botC = tweakHSL(botC, -8, 1.12, -0.03);
    } else if (b.layer === "outer") {
      topC = tweakHSL(topC, +8, 0.92, +0.05);
      midC = tweakHSL(midC, +6, 0.9, +0.05);
      botC = tweakHSL(botC, +10, 0.92, +0.06);
    }
  }

  let xf = { dx: 0, dy: 0 };
  if (usingPreset && currentPresetIndex >= 0)
    xf = presetXforms[currentPresetIndex] || xf;

  let t = groupTForBead(b, xf);

  // ✅ Group Gradient 유지 + 뒤죽박죽: t를 비즈마다 섞기

  const satBoost = ui.groupGradSatBoost ? ui.groupGradSatBoost.value() : 1.2;
  const gradClr = lerp3HSL(topC, midC, botC, t, satBoost);

  const mixAmt = ui.groupGradMix ? ui.groupGradMix.value() : 1.0;
  if (mixAmt >= 0.999) return gradClr;

  return lerpColorHSL(baseClr, gradClr, mixAmt, satBoost);
}

// ==============================
// Gradient fill (optional, only for None)
// ==============================
function gradientColorsFromBase(baseCol) {
  const cBase = color(baseCol);
  const edge = lerpColor(cBase, color(0), 0.12);
  const mid = lerpColor(cBase, color(255), 0.18);
  const warm = color(245, 240, 190);
  const core = lerpColor(warm, mid, 0.35);
  return { edge, mid, core };
}

function drawGradientDiamond(size, edgeCol, midCol, coreCol, a01 = 1) {
  const ctx = drawingContext;
  if (!ctx) return;

  const e = colorToRgb(edgeCol);
  const m = colorToRgb(midCol);
  const c = colorToRgb(coreCol);

  ctx.save();
  ctx.globalAlpha = clamp01(a01);

  let ox = 0,
    oy = 0;
  if (ui.gradAnimOn && ui.gradAnimOn.checked()) {
    const tt =
      frameCount * (ui.gradAnimSpeed ? ui.gradAnimSpeed.value() : 0.01);
    ox = sin(tt) * size * 0.08;
    oy = cos(tt * 1.13) * size * 0.06;
  }

  const g = ctx.createRadialGradient(ox, oy, size * 0.05, 0, 0, size * 0.85);
  g.addColorStop(0.0, rgbaStr(c.r, c.g, c.b, 1.0));
  g.addColorStop(0.55, rgbaStr(m.r, m.g, m.b, 1.0));
  g.addColorStop(1.0, rgbaStr(e.r, e.g, e.b, 1.0));

  ctx.fillStyle = g;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

// ==============================
// ✅ Stripe overlay (FAST: cached pattern)
// ==============================
let stripePattern = null;
let stripePatternCanvas = null;
let stripePatternKey = "";

function makeStripePatternKey() {
  const on = ui.stripesOn && ui.stripesOn.checked();
  if (!on) return "OFF";
  const w = ui.stripeWidth.value();
  const duty = ui.stripeDuty.value();
  return `w:${w}|d:${duty}`;
}

function invalidateStripePattern() {
  stripePattern = null;
  stripePatternCanvas = null;
  stripePatternKey = "";
}

function updateStripePatternIfNeeded() {
  const key = makeStripePatternKey();
  if (key === stripePatternKey && stripePattern) return;

  stripePatternKey = key;
  stripePattern = null;
  stripePatternCanvas = null;

  if (!(ui.stripesOn && ui.stripesOn.checked())) return;

  const ctx = drawingContext;
  if (!ctx) return;

  const w = Math.max(2, ui.stripeWidth.value());
  const duty = clamp01(ui.stripeDuty.value());
  const onW = Math.max(1, Math.round(w * duty));

  const tileW = Math.max(4, w);
  const tileH = Math.max(4, w);

  stripePatternCanvas = document.createElement("canvas");
  stripePatternCanvas.width = tileW;
  stripePatternCanvas.height = tileH;
  const pctx = stripePatternCanvas.getContext("2d");

  pctx.clearRect(0, 0, tileW, tileH);
  pctx.fillStyle = "rgba(255,255,255,1)";
  pctx.fillRect(0, 0, onW, tileH);

  stripePattern = ctx.createPattern(stripePatternCanvas, "repeat");
}

function drawStripeOverlayFast(size, a01) {
  if (!(ui.stripesOn && ui.stripesOn.checked())) return;
  const ctx = drawingContext;
  if (!ctx || !stripePattern) return;

  const strength = ui.stripeStrength ? ui.stripeStrength.value() : 0.18;
  const tiltDeg = ui.stripeTilt ? ui.stripeTilt.value() : 0;

  const driftOn = ui.stripeDriftOn ? ui.stripeDriftOn.checked() : false;
  const driftSpd = ui.stripeDriftSpeed ? ui.stripeDriftSpeed.value() : 0.25;

  const w = Math.max(2, ui.stripeWidth.value());
  let drift = 0;
  if (driftOn) drift = (frameCount * driftSpd) % (w * 4);

  ctx.save();
  ctx.globalAlpha = clamp01(a01) * clamp01(strength);

  ctx.beginPath();
  ctx.rect(-size / 2, -size / 2, size, size);
  ctx.clip();

  ctx.rotate(radians(tiltDeg));
  ctx.translate(-drift, 0);

  ctx.fillStyle = stripePattern;
  ctx.fillRect(-size, -size, size * 2, size * 2);

  ctx.restore();
}

// ==============================
// ✅ Pearl rendering
// ==============================
function drawPearlDiamond(size, baseCol, a01, bHash) {
  const ctx = drawingContext;
  if (!ctx) return;

  // controls
  const gloss = ui.pearlGloss ? ui.pearlGloss.value() : 0.85; // 0..1
  const irid = ui.pearlIridescence ? ui.pearlIridescence.value() : 0.35; // 0..1
  const contrast = ui.pearlContrast ? ui.pearlContrast.value() : 0.22; // 0..0.6
  const highlight = ui.pearlHighlight ? ui.pearlHighlight.value() : 0.35; // 0..1
  const driftOn = ui.pearlDriftOn ? ui.pearlDriftOn.checked() : false;
  const driftSpd = ui.pearlDriftSpeed ? ui.pearlDriftSpeed.value() : 0.012;

  // deterministic per bead
  const n1 = rand01FromHash(bHash, pearlSeed ^ 0xa13);
  const n2 = rand01FromHash(bHash, pearlSeed ^ 0xb55);
  const n3 = rand01FromHash(bHash, pearlSeed ^ 0xc77);

  // base rgb
  const base = colorToRgb(baseCol);

  // subtle iridescent tint (HSL hue wobble)
  let pearlTint = color(base.r, base.g, base.b);
  const hueAmt = (n1 - 0.5) * 70 * irid;
  const satMul = 1.0 + Math.abs(n2 - 0.5) * 0.35 * irid;
  const litAdd = (n3 - 0.5) * 0.12 * irid;
  pearlTint = tweakHSL(pearlTint, hueAmt, satMul, litAdd);

  // highlight offset
  let ox = lerp(-0.35, 0.35, n2) * size * highlight;
  let oy = lerp(-0.35, 0.35, n3) * size * highlight;

  if (driftOn) {
    const tt = frameCount * driftSpd;
    ox += sin(tt + n2 * 6.0) * size * 0.06;
    oy += cos(tt * 1.17 + n3 * 6.0) * size * 0.05;
  }

  // build gradient
  const pr = colorToRgb(pearlTint);

  const dark = mixRgb(pr, { r: 0, g: 0, b: 0 }, contrast);
  const bright = mixRgb(pr, { r: 255, g: 255, b: 255 }, 0.55 + 0.25 * gloss);
  const core = mixRgb(pr, { r: 255, g: 255, b: 255 }, 0.8 + 0.18 * gloss);

  ctx.save();
  ctx.globalAlpha = clamp01(a01);

  // clip to diamond shape (same as your square but rotated by p.rot already)
  ctx.beginPath();
  ctx.rect(-size / 2, -size / 2, size, size);
  ctx.clip();

  // radial pearl gradient
  const g = ctx.createRadialGradient(ox, oy, size * 0.06, 0, 0, size * 0.9);
  g.addColorStop(0.0, rgbaStr(core.r, core.g, core.b, 1.0));
  g.addColorStop(0.38, rgbaStr(bright.r, bright.g, bright.b, 1.0));
  g.addColorStop(1.0, rgbaStr(dark.r, dark.g, dark.b, 1.0));

  ctx.fillStyle = g;
  ctx.fillRect(-size / 2, -size / 2, size, size);

  // tiny specular streak (deterministic angle)
  const ang = (n1 * 2 - 1) * 0.9;
  const streakA = 0.18 + 0.22 * gloss;
  ctx.globalAlpha = clamp01(a01) * streakA;
  ctx.translate(ox * 0.2, oy * 0.2);
  ctx.rotate(ang);
  const sw = size * 0.1;
  const sh = size * 0.55;
  const sg = ctx.createLinearGradient(0, -sh * 0.5, 0, sh * 0.5);
  sg.addColorStop(0.0, "rgba(255,255,255,0)");
  sg.addColorStop(0.5, "rgba(255,255,255,1)");
  sg.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  ctx.fillRect(-sw * 0.5, -sh * 0.5, sw, sh);

  ctx.restore();
}

// ==============================
// Bead
// ==============================
class Bead {
  constructor(x, y, layer, glyphKey, word, cls, svgFill, rawRectSize) {
    this.x = x;
    this.y = y;
    this.layer = layer;
    this.glyphKey = glyphKey;
    this.word = word;
    this.cls = cls || "";
    this.svgFill = svgFill || null;
    this.rawRectSize = rawRectSize;

    this.hash = hashString(
      `${glyphKey}_${layer}_${x.toFixed(2)}_${y.toFixed(2)}`
    );
  }

  displayFixed(p, appear) {
    this._drawAt(this.x + p.dx, this.y + p.dy, p, appear);
  }

  displayFixedWithTransform(p, dx, dy, appear) {
    this._drawAt(this.x + dx + p.dx, this.y + dy + p.dy, p, appear);
  }

  _drawAt(px, py, p, appear) {
    push();
    translate(px, py);
    rotate(p.rot);

    const a = appear ? appear.a : 1;
    const s = appear ? appear.s : 1;

    const baseSize = max(1, UNIT_SIZE + p.sizeAdd);
    const finalSize = max(1, baseSize * s);

    const cc = color(p.clr);
    cc.setAlpha(255 * clamp01(a));

    const usePearl = ui.pearlOn && ui.pearlOn.checked();
    const useGrad = ui.gradOn && ui.gradOn.checked();

    if (usePearl) {
      // pearl uses bead color as tint base, then creates stable per-bead pearl look
      drawPearlDiamond(finalSize, cc, clamp01(a), this.hash);
    } else if (useGrad) {
      let edgeC, midC, coreC;

      const mode = ui.gradMode ? ui.gradMode.value() : "Fixed";
      if (mode === "From bead color") {
        const g = gradientColorsFromBase(cc);
        edgeC = g.edge;
        midC = g.mid;
        coreC = g.core;
      } else {
        edgeC = ui.gradEdgePicker
          ? ui.gradEdgePicker.color()
          : color(90, 150, 210);
        midC = ui.gradMidPicker
          ? ui.gradMidPicker.color()
          : color(170, 205, 230);
        coreC = ui.gradCorePicker
          ? ui.gradCorePicker.color()
          : color(245, 240, 190);
      }

      drawGradientDiamond(finalSize, edgeC, midC, coreC, clamp01(a));
    } else {
      noStroke();
      fill(cc);
      rect(0, 0, finalSize, finalSize);
    }

    drawStripeOverlayFast(finalSize, clamp01(a));
    pop();
  }
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// ==============================
// UI
// ==============================
function buildUI() {
  // ------------------------------------------------------------
  // UI overlay (SVG) + invisible p5 elements used as state holders
  // ------------------------------------------------------------

  // join svg text (loaded in preload)
  uiSvgRaw = (uiSvgLines || []).join("\n");

  // stage: we transform SVG + hit-areas together so they always align
  uiStageEl = createDiv();
  uiStageEl.id("ui-stage");
  uiStageEl.style("position", "fixed");
  uiStageEl.style("left", "0");
  uiStageEl.style("top", "0");
  uiStageEl.style("width", "100vw");
  uiStageEl.style("height", "100vh");
  uiStageEl.style("pointer-events", "none");
uiStageEl.style("z-index", "9999");  
  
  // wrapper that gets scaled to match SVG viewBox (1920x1080)
  const wrap = createDiv();
  wrap.id("ui-wrap");
  wrap.parent(uiStageEl);
  wrap.style("position", "absolute");
  wrap.style("left", "0");
  wrap.style("top", "0");
  wrap.style("transform-origin", "0 0");
  wrap.style("pointer-events", "none");

  // SVG itself
  const svgHolder = createDiv();
  svgHolder.parent(wrap);
  svgHolder.html(uiSvgRaw);
  // ✅ SVG root 잡기
const svgRoot = uiStageEl.elt.querySelector("svg");

// ✅ 버튼 라벨 노드 참조 (SVG에 id 붙였다는 가정)
labelBoldEl = svgRoot?.querySelector("#label-bold");
labelDarkEl = svgRoot?.querySelector("#label-dark");
  
  const btnVerticalEl = svgRoot?.querySelector("#btn-vertical");
const btnHorizontalEl = svgRoot?.querySelector("#btn-horizontal");
const btnRadialEl = svgRoot?.querySelector("#btn-radial");

const btnBeatEl = svgRoot?.querySelector("#btn-beat");
const btnJitterEl = svgRoot?.querySelector("#btn-jitter");
const btnGradientMotionEl = svgRoot?.querySelector("#btn-gradientMotion");
  
  svgHolder.style("position", "absolute");
  svgHolder.style("left", "0");
  svgHolder.style("top", "0");
  svgHolder.style("width", "1920px");
  svgHolder.style("height", "1080px");
  svgHolder.style("pointer-events", "none");

  // Hide the placeholder logo inside the UI SVG (we draw the real logo on canvas)
const styleEl = createElement("style", `
  #ui-stage svg { width: 1920px; height: 1080px; }
  #ui-stage #Logo { display: none !important; }

  #ui-stage #Mouse { display: none !important; }

  /* ✅ 배경 rect 3개만 좌표로 정확히 숨김 (버튼 스타일은 살림) */
  #ui-stage rect[x="-0.4"][y="-0.2"][width="1920"][height="1080"],
  #ui-stage rect[x="-0.4"][y="996.3"][width="1920"][height="83.5"],
  #ui-stage rect[x="-0.4"][y="1038.1"][width="1920"][height="41.9"] {
    display: none !important;
  }
`);
styleEl.parent(uiStageEl);
styleEl.parent(uiStageEl);

  // ---------- helpers ----------
  const makeHiddenCheckbox = (initial) => {
    const cb = createCheckbox("", initial);
    cb.style("display", "none");
    return cb;
  };
  const makeHiddenSlider = (minv, maxv, initial, step = 1) => {
    const s = createSlider(minv, maxv, initial, step);
    s.style("display", "none");
    return s;
  };
  const makeHiddenSelect = (options, initial) => {
    const s = createSelect();
    for (const opt of options) s.option(opt);
    s.selected(initial);
    s.style("display", "none");
    return s;
  };
  const makeHiddenColor = (initial) => {
    const p = createColorPicker(initial);
    p.style("display", "none");
    return p;
  };

  // ---------- minimal state controls used by renderer ----------
  // Layers (driven by Bold cycle)
  ui.showInner = makeHiddenCheckbox(true);
  ui.showMid = makeHiddenCheckbox(true);
  ui.showOuter = makeHiddenCheckbox(true);

  // Fit / transform (kept as defaults so existing draw logic stays intact)
  ui.fitMargin = makeHiddenSlider(0, 200, 24, 1);
  ui.userScale = makeHiddenSlider(0.2, 2.0, 1, 0.01);
  ui.globalRotate = makeHiddenSlider(-20, 20, 0, 0.1);

  // Motion
  ui.revealOn = makeHiddenCheckbox(true);
  ui.pulseOn = makeHiddenCheckbox(false);
  ui.jitterOn = makeHiddenCheckbox(false);
  ui.diamondOn = makeHiddenCheckbox(true);

  ui.pulseAmp = makeHiddenSlider(0, 40, 12, 0.1);
  ui.pulseSpeed = makeHiddenSlider(0.0, 0.5, 0.15, 0.001);
  ui.jitterAmp = makeHiddenSlider(0, 10, 1, 0.1);

  ui.midRatio = makeHiddenSlider(0, 1, 0.6, 0.01);
  ui.outerRatio = makeHiddenSlider(0, 1, 0.35, 0.01);

  // Color
  ui.paletteOn = makeHiddenCheckbox(true);
  ui.randomColorOn = makeHiddenCheckbox(false);
  ui.wordColorOn = makeHiddenCheckbox(false);

  ui.paletteSelect = makeHiddenSelect(Object.keys(PALETTES), "Rainbow (SVG)");

  // Pearl (kept but hidden - code references these)
  ui.pearlOn = makeHiddenCheckbox(false);
  ui.pearlGloss = makeHiddenSlider(0.0, 1.0, 0.85, 0.01);
  ui.pearlIridescence = makeHiddenSlider(0.0, 1.0, 0.35, 0.01);
  ui.pearlContrast = makeHiddenSlider(0.0, 0.6, 0.22, 0.01);
  ui.pearlHighlight = makeHiddenSlider(0.0, 1.0, 0.35, 0.01);
  ui.pearlDriftOn = makeHiddenCheckbox(false);
  ui.pearlDriftSpeed = makeHiddenSlider(0.0, 0.05, 0.012, 0.001);

  // Gradient fill (optional, "original code same")
  ui.gradOn = makeHiddenCheckbox(false);
  ui.gradMode = makeHiddenSelect(["Fixed", "From bead color"], "Fixed");
  ui.gradEdgePicker = makeHiddenColor("#5a96d2");
  ui.gradMidPicker = makeHiddenColor("#aaccdf");
  ui.gradCorePicker = makeHiddenColor("#f5f0be");
  ui.gradAnimOn = makeHiddenCheckbox(false);
  ui.gradAnimSpeed = makeHiddenSlider(0.0, 0.08, 0.01, 0.001);

  // Group Gradient (HSL)
  ui.groupGradOn = makeHiddenCheckbox(true);
  ui.groupGradGroupBy = makeHiddenSelect(["Layer", "Word", "Glyph", "All"], "Layer");
  ui.groupGradDir = makeHiddenSelect(["Vertical", "Horizontal", "Radial"], "Vertical");
ui.groupTopPicker = makeHiddenColor("#ffffff");
ui.groupMidPicker = makeHiddenColor("#ff0000");
ui.groupBottomPicker = makeHiddenColor("#ffb3b3");
  ui.groupGradSatBoost = makeHiddenSlider(0.5, 3.0, 3.0, 0.01);
  ui.groupGradLayerSep = makeHiddenSlider(0.0, 2.0, 2.0, 0.01);
  ui.groupGradMix = makeHiddenSlider(0.0, 1.0, 1.0, 0.01);

  // Stripes (default OFF, but referenced by renderer)
  ui.stripesOn = makeHiddenCheckbox(false);
  ui.stripeWidth = makeHiddenSlider(2, 120, 14, 1);
  ui.stripeDuty = makeHiddenSlider(0.05, 0.95, 0.55, 0.01);
  ui.stripeStrength = makeHiddenSlider(0.0, 0.8, 0.18, 0.01);
  ui.stripeTilt = makeHiddenSlider(-90, 90, 0, 1);
  ui.stripeDriftOn = makeHiddenCheckbox(false);
  ui.stripeDriftSpeed = makeHiddenSlider(0.0, 1.0, 0.25, 0.01);

  // Background (Light mode default: match UI sketch light bg)
  ui.bgR = makeHiddenSlider(0, 255, 251, 1);
  ui.bgG = makeHiddenSlider(0, 255, 250, 1);
  ui.bgB = makeHiddenSlider(0, 255, 250, 1);

  // ---------- UI behavior ----------
  const applyLayerMode = () => {
    // 0 Bold: inner+mid+outer
    // 1 Regular: inner+mid
    // 2 Light: inner only
    if (uiLayerMode === 0) {
      ui.showInner.checked(true);
      ui.showMid.checked(true);
      ui.showOuter.checked(true);
    } else if (uiLayerMode === 1) {
      ui.showInner.checked(true);
      ui.showMid.checked(true);
      ui.showOuter.checked(false);
    } else {
      ui.showInner.checked(true);
      ui.showMid.checked(false);
      ui.showOuter.checked(false);
    }
  };
  applyLayerMode();

  const applyDarkMode = (on) => {
    uiDarkMode = !!on;
    
      // ✅ dark 클래스 토글
  if (uiStageEl && uiStageEl.elt) {
    uiStageEl.elt.classList.toggle("dark", uiDarkMode);
    
    applySectionLabelColor();
  }


    if (uiDarkMode) {
      // BG black
      ui.bgR.value(0); ui.bgG.value(0); ui.bgB.value(0);

      // Dark-mode group gradient colors
ui.groupTopPicker.value("#850000");
ui.groupMidPicker.value("#ffdbdb");
ui.groupBottomPicker.value("#850000");

      // Group by Word
      ui.groupGradGroupBy.selected("Word");
      invalidateGroupBoundsCache();
    } else {
      // Light-mode BG (from UI sketch feeling)
      ui.bgR.value(243); ui.bgG.value(243); ui.bgB.value(243);

      // Light-mode group gradient colors
ui.groupTopPicker.value("#ffffff");
ui.groupMidPicker.value("#ff0000");
ui.groupBottomPicker.value("#ffb3b3");

      // Group by Layer
      ui.groupGradGroupBy.selected("Layer");
      invalidateGroupBoundsCache();
    }
  };
  applyDarkMode(false);

  const randomPreset = () => {
    const idx = floor(random(0, 9)); // 0..8
    applyPresetIndex(idx);
    usingPreset = true;
    currentPresetIndex = idx;
    // keep the same reveal behavior as your original "switch"
    startRevealWithParams({ ...REVEAL_PRESETS.SWITCH_FAST_PARTIAL, direction: "IN" });
  };

  const doSavePNG = () => {
    // hides UI overlay for a frame to avoid capturing it in some environments
    const prev = uiStageEl.elt.style.display;
    uiStageEl.elt.style.display = "none";
    saveCanvas("beadsandbeats", "png");
    uiStageEl.elt.style.display = prev;
  };

  const doReset = () => {
    // Reset to your "first run" light mode defaults (but keep the logo system)
    uiLayerMode = 0;
    applyLayerMode();

    groupGradMotionOn = false;
    ui.pulseOn.checked(false);
    ui.jitterOn.checked(false);

    applyDarkMode(false);

    ui.groupGradDir.selected("Vertical");
    ui.groupGradOn.checked(true);

    ui.paletteSelect.selected("Rainbow (SVG)");
    ui.paletteOn.checked(true);
    ui.randomColorOn.checked(false);

    // back to base logo
    beads = beadsBase;
    usingPreset = false;
    currentPresetIndex = -1;

    resetWordColors();
    invalidateGroupBoundsCache();
    startRevealWithParams({ ...REVEAL_PRESETS.INTRO_SLOW, direction: "IN" });
  };

  // ---------- clickable hit areas (match SVG rect coords in 1920x1080) ----------
  const addHit = (name, x, y, w, h, onClick) => {
    const hit = createDiv("");
    hit.parent(wrap);
    hit.style("position", "absolute");
    hit.style("left", `${x}px`);
    hit.style("top", `${y}px`);
    hit.style("width", `${w}px`);
    hit.style("height", `${h}px`);
  hit.elt.style.cursor = CURSOR_CSS;
    hit.style("pointer-events", "auto");
    hit.style("background", "rgba(0,0,0,0)"); // invisible
    hit.mousePressed(() => onClick && onClick());
    hit.elt.setAttribute("aria-label", name);
    return hit;
  };

  // Right-panel button rectangles (from UI SVG)
  const BX = 1694.9, BW = 95.5, BH = 34.3;
  const BTN_CENTER_X = BX + BW / 2; // 1742.65
  const r = (yy) => ({ x: BX, y: yy, w: BW, h: BH });

  // LOGO section

  addHit("Random", ...Object.values(r(208.8)), () => { randomPreset(); });

  addHit("Bold", ...Object.values(r(157.9)), () => {
  uiLayerMode = (uiLayerMode + 1) % 3;
  applyLayerMode();
  syncUIButtonLabels();
});

addHit("Dark", ...Object.values(r(259.7)), () => {
  applyDarkMode(!uiDarkMode);
  syncUIButtonLabels();
});

  // GRADIENT section (direction)
  addHit("Vertical",   ...Object.values(r(377.5)), () => { ui.groupGradDir.selected("Vertical"); invalidateGroupBoundsCache();                                                           syncSelectionColors();
});
  addHit("Horizontal", ...Object.values(r(428.4)), () => { ui.groupGradDir.selected("Horizontal"); invalidateGroupBoundsCache();
                                                           syncSelectionColors();
});
  addHit("Radial",     ...Object.values(r(479.3)), () => { ui.groupGradDir.selected("Radial"); invalidateGroupBoundsCache();
                                                           syncSelectionColors();
});

  // ANIMATE section
addHit("Beat", ...Object.values(r(596.7)), () => {
  const next = !ui.pulseOn.checked();
  ui.pulseOn.checked(next);
    syncSelectionColors();


  if (next) {
    // ✅ Beat ON 될 때 적용할 디폴트
    ui.pulseAmp.value(30);      // 크기
    ui.pulseSpeed.value(0.11);
      syncSelectionColors();

    // 속도
  }
}
      );
  
  addHit("Jitter",   ...Object.values(r(647.6)), () => { ui.jitterOn.checked(!ui.jitterOn.checked());   syncSelectionColors();
});
  addHit("GradientMotion", ...Object.values(r(698.5)), () => { groupGradMotionOn = !groupGradMotionOn;
                                                               syncSelectionColors();
});

  // SAVE / RESET
  addHit("Save",  ...Object.values(r(789.2)), () => { doSavePNG(); });
  addHit("Reset", ...Object.values(r(840.1)), () => { doReset(); });
  
  syncUIButtonLabels();

  // ---------- layout update ----------
updateUITransform = () => {
  const ww = window.innerWidth;
  const hh = window.innerHeight;

  // ✅ 캔버스도 같이 맞춰주기 (로고 스케일 재계산 트리거)
  if (width !== ww || height !== hh) {
    resizeCanvas(ww, hh);
computeFitToUI();
  }

  const s = min(ww / 1920, hh / 1080);
  const ox = (ww - 1920 * s) * 0.5;
  const oy = (hh - 1080 * s) * 0.5;
  wrap.style("transform", `translate(${ox}px, ${oy}px) scale(${s})`);
};
  updateUITransform();

  // keep in sync on resize
  window.addEventListener("resize", updateUITransform);
  applySectionLabelColor();

  // no legacy panel
  uiPanelEl = null;
  uiPanelVisible = false;
  
  function applySectionLabelColor() {
  if (!uiStageEl || !uiStageEl.elt) return;
  const svg = uiStageEl.elt.querySelector("svg");
  if (!svg) return;

  const targets = new Set(["LOGO", "GRADIENT", "ANIMATE"]);
  const lightFill = "rgb(243,243,243)";

  svg.querySelectorAll("text, tspan").forEach((node) => {
   const raw = (node.textContent || "").trim();
if (!raw) return;

// ✅ 완전 대문자만 통과 (버튼 Gradient는 탈락)
if (raw !== raw.toUpperCase()) return;

const targets = new Set(["LOGO", "GRADIENT", "ANIMATE"]);
if (!targets.has(raw)) return;

    if (uiDarkMode) {
      node.setAttribute("fill", lightFill);
      node.style.fill = lightFill;
    } else {
      // 라이트 모드로 돌아갈 때 원래 색으로 복구하고 싶으면 여기서 지움
      node.removeAttribute("fill");
      node.style.fill = "";
    }
  });
}
  function syncSelectionColors() {

  const RED = "rgb(255,0,0)";
const NORMAL = "rgb(0,0,0)";

  // ---- GRADIENT ----
  const dir = ui.groupGradDir.value();

  setColor(btnVerticalEl, dir === "Vertical");
  setColor(btnHorizontalEl, dir === "Horizontal");
  setColor(btnRadialEl, dir === "Radial");

  // ---- ANIMATE ----
  setColor(btnBeatEl, ui.pulseOn.checked());
  setColor(btnJitterEl, ui.jitterOn.checked());
  setColor(btnGradientMotionEl, groupGradMotionOn);

  function setColor(el, active) {
    if (!el) return;
    const color = active ? RED : NORMAL;
    el.setAttribute("fill", color);
    el.style.fill = color;
  }
}
  syncSelectionColors();
}

function togglePanel() {
  // Legacy panel removed. Toggle the SVG UI overlay instead.
  uiPanelVisible = !uiPanelVisible;
  if (uiStageEl) uiStageEl.style("display", uiPanelVisible ? "block" : "none");
}

// UI helpers
function hr() {
  const d = createDiv("");
  d.style("height", "1px");
  d.style("background", "rgba(0,0,0,0.08)");
  d.style("margin", "10px 0");
  return d;
}
function labelRow(txt) {
  const d = createDiv(txt);
  d.style("font-weight", "600");
  d.style("margin-bottom", "6px");
  return d;
}
function checkboxRow(parent, label, checked) {
  const wrap = createDiv();
  wrap.style("display", "flex");
  wrap.style("align-items", "center");
  wrap.style("gap", "8px");
  wrap.parent(parent);

  const cb = createCheckbox(label, checked);
  cb.parent(wrap);
  return cb;
}
function sliderRow(parent, label, minV, maxV, val, step) {
  const wrap = createDiv();
  wrap.style("display", "grid");
  wrap.style("grid-template-columns", "140px 1fr 56px");
  wrap.style("gap", "8px");
  wrap.style("align-items", "center");
  wrap.style("margin", "4px 0");
  wrap.parent(parent);

  const lab = createDiv(label);
  lab.parent(wrap);

  const s = createSlider(minV, maxV, val, step);
  s.parent(wrap);

  const v = createDiv(String(val));
  v.style("text-align", "right");
  v.parent(wrap);

  s.input(() => v.html(String(s.value())));
  return s;
}

function getUIScaleAndOffset() {
  const s = Math.min(width / 1920, height / 1080);
  const ox = (width - 1920 * s) * 0.5;
  const oy = (height - 1080 * s) * 0.5;
  return { s, ox, oy };
}

function syncUIButtonLabels() {
  const modeText = ["Bold", "Regular", "Light"][uiLayerMode] || "Bold";

  if (labelBoldEl) {
    const tspan = labelBoldEl.querySelector("tspan");
    if (tspan) tspan.textContent = modeText;
    else labelBoldEl.textContent = modeText;
  }

const darkText = uiDarkMode ? "Dark" : "Light";
  
  if (labelDarkEl) {
    const tspan = labelDarkEl.querySelector("tspan");
    if (tspan) tspan.textContent = darkText;
    else labelDarkEl.textContent = darkText;
  }
  
  const BTN_CENTER_X = 1694.9 + 95.5 / 2;

centerSvgTextOnX(labelBoldEl, BTN_CENTER_X);
centerSvgTextOnX(labelDarkEl, BTN_CENTER_X);
}

function drawUIBackplates() {
  const { s, ox, oy } = getUIScaleAndOffset();

  push();
  rectMode(CORNER);
  noStroke();
  
// 1) 전체 배경 (Light/Dark 반영)
const r = ui.bgR ? ui.bgR.value() : 243;
const g = ui.bgG ? ui.bgG.value() : 243;
const b = ui.bgB ? ui.bgB.value() : 243;
fill(r, g, b);
rect(ox + (-0.4) * s, oy + (-0.2) * s, 1920 * s, 1080 * s);
  // 2) 하단 빨강 바 (st62: red) - rect: x=-0.4 y=996.3 w=1920 h=83.5
  fill("red");
  rect(ox + (-0.4) * s, oy + 996.3 * s, 1920 * s, 83.5 * s);

  // 3) 하단 연핑크 바 (st39: #ffc6c9) - rect: x=-0.4 y=1038.1 w=1920 h=41.9
  fill("#ffc6c9");
  rect(ox + (-0.4) * s, oy + 1038.1 * s, 1920 * s, 41.9 * s);

  pop();
}


// ==============================
// HUD
// ==============================
function drawHUD() {
  let layoutLabel = "Base";
  if (usingPreset && currentPresetIndex >= 0) {
    layoutLabel = `Preset${String(currentPresetIndex + 1).padStart(2, "0")}`;
  }

  const revealLabel = ui.revealOn && ui.revealOn.checked() ? "ON" : "OFF";
  const gradLabel =
    ui.gradOn && ui.gradOn.checked()
      ? `Grad:${ui.gradMode ? ui.gradMode.value() : "Fixed"}`
      : "Grad:OFF";

  const groupGradLabel =
    ui.groupGradOn && ui.groupGradOn.checked()
      ? `GroupGrad:${ui.groupGradGroupBy.value()}/${ui.groupGradDir.value()}`
      : "GroupGrad:OFF";

  const stripesLabel =
    ui.stripesOn && ui.stripesOn.checked() ? "Stripes:ON" : "Stripes:OFF";

  const pearlLabel =
    ui.pearlOn && ui.pearlOn.checked()
      ? `Pearl:ON(seed:${pearlSeed | 0})`
      : "Pearl:OFF";

  const autoLabel = AUTO_ANIM.enabled
    ? AUTO_ANIM.phase
    : AUTO_ANIM.stoppedAtBase
    ? "STOP@BASE"
    : "OFF";

  push();
  noStroke();
  fill(0, 120);
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(
    `UNIT:${nf(
      UNIT_SIZE,
      1,
      2
    )} | Reveal:${revealLabel} | ${gradLabel} | ${groupGradLabel} | ${stripesLabel} | ${pearlLabel} | Layout:${layoutLabel} | AUTO:${autoLabel}`,
    12,
    height - 12
  );

  if (_runtimeErrorMsg) {
    fill(200, 0, 0);
    textAlign(LEFT, TOP);
    text(`ERR: ${_runtimeErrorMsg}`, 12, 12);
  }
  pop();
}
