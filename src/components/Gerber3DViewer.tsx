import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, RotateCw } from 'lucide-react';
import type { DrawCommand, GerberLayerKind, ParsedBoard, ParsedLayer } from '../utils/gerberParser';
import { getStencilCommandsForSide } from '../utils/gerberParser';
import { computePanelDimensionsMm, type PcbPanelConfig } from '../shared/siteData';

export interface MaskTheme3D {
  id: string;
  label: string;
  boardBg: string;
  copperUnderMask: string;
  silkColor: string;
}

interface Gerber3DViewerProps {
  board: ParsedBoard;
  theme: MaskTheme3D;
  finish: 'HASL' | 'ENIG';
  showCopper: boolean;
  showMask: boolean;
  showSilk: boolean;
  showDrill: boolean;
  showStencil?: boolean;
  onToggleStencil?: () => void;
  panel?: PcbPanelConfig;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

type CameraPreset = 'iso' | 'top' | 'bottom' | 'edge';

// Reusable pre-allocated math objects (zero GC in render loop)
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3(0, 0, 0);
const _dummy = new THREE.Object3D();

function drawLayerCommands(
  ctx: CanvasRenderingContext2D,
  commands: DrawCommand[],
  color: string,
  clearColor: string
) {
  for (const cmd of commands) {
    const strokeOrFill = cmd.polarity === 'clear' ? clearColor : color;
    ctx.strokeStyle = strokeOrFill;
    ctx.fillStyle = strokeOrFill;

    if (cmd.kind === 'line') {
      ctx.lineWidth = cmd.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
    } else if (cmd.kind === 'arc') {
      const r = Math.hypot(cmd.x1 - cmd.cx, cmd.y1 - cmd.cy);
      const startAngle = Math.atan2(cmd.y1 - cmd.cy, cmd.x1 - cmd.cx);
      const endAngle = Math.atan2(cmd.y2 - cmd.cy, cmd.x2 - cmd.cx);
      ctx.lineWidth = cmd.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cmd.cx, cmd.cy, r, startAngle, endAngle, !cmd.ccw);
      ctx.stroke();
    } else if (cmd.kind === 'flash') {
      const { shape, width, height } = cmd.aperture;
      if (shape === 'R') {
        ctx.fillRect(cmd.x - width / 2, cmd.y - height / 2, width, height);
      } else if (shape === 'O') {
        const rx = width / 2;
        const ry = height / 2;
        ctx.beginPath();
        ctx.roundRect(cmd.x - rx, cmd.y - ry, width, height, Math.min(rx, ry));
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cmd.x, cmd.y, width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cmd.kind === 'region' && cmd.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
      for (let i = 1; i < cmd.points.length; i++) {
        ctx.lineTo(cmd.points[i].x, cmd.points[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

interface GeneratedSideMaps {
  colorMap: THREE.CanvasTexture;
  metalMap: THREE.CanvasTexture;
  roughMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

function buildSidePbrMaps(
  side: 'top' | 'bottom',
  board: ParsedBoard,
  theme: MaskTheme3D,
  finish: 'HASL' | 'ENIG',
  showCopper: boolean,
  showMask: boolean,
  showSilk: boolean,
  showDrill: boolean,
  maxAniso: number
): GeneratedSideMaps {
  const { bounds, widthMm, heightMm, layers } = board;
  const maxDim = 1536;
  const aspect = Math.max(widthMm, 1) / Math.max(heightMm, 1);
  const texW = aspect >= 1 ? maxDim : Math.max(256, Math.round(maxDim * aspect));
  const texH = aspect >= 1 ? Math.max(256, Math.round(maxDim / aspect)) : maxDim;

  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = texW;
    c.height = texH;
    return c;
  };

  const colorCanvas = makeCanvas();
  const metalCanvas = makeCanvas();
  const roughCanvas = makeCanvas();
  const bumpCanvas = makeCanvas();

  const cCtx = colorCanvas.getContext('2d')!;
  const mCtx = metalCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;

  const findLayers = (k: GerberLayerKind): ParsedLayer[] => layers.filter((l) => l.kind === k);
  const copperLayers = findLayers(side === 'top' ? 'topCopper' : 'bottomCopper');
  const maskLayers = findLayers(side === 'top' ? 'topMask' : 'bottomMask');
  const silkLayers = findLayers(side === 'top' ? 'topSilk' : 'bottomSilk');
  const drillLayers = findLayers('drill');

  const setupTransform = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    // Map PCB mm coordinates to texture UV pixels
    // For top face (+Y): +X is right, +Y (Gerber) maps to -Z (up on screen), so flip Y in canvas
    // For bottom face (-Y): when looking up from underneath (rotated PI on Z or X), flip X so features align cleanly through the board!
    const sx = texW / Math.max(widthMm, 1);
    const sy = texH / Math.max(heightMm, 1);
    if (side === 'top') {
      ctx.translate(0, texH);
      ctx.scale(sx, -sy);
      ctx.translate(-bounds.minX, -bounds.minY);
    } else {
      ctx.translate(texW, texH);
      ctx.scale(-sx, -sy);
      ctx.translate(-bounds.minX, -bounds.minY);
    }
  };

  // 1. Base Solder Mask
  cCtx.fillStyle = theme.boardBg;
  cCtx.fillRect(0, 0, texW, texH);
  mCtx.fillStyle = '#080808'; // Non-metallic mask
  mCtx.fillRect(0, 0, texW, texH);
  rCtx.fillStyle = '#5c5c5c'; // Satin solder mask (~0.36 roughness)
  rCtx.fillRect(0, 0, texW, texH);
  bCtx.fillStyle = '#303030'; // Base substrate height
  bCtx.fillRect(0, 0, texW, texH);

  // 2. Copper under Solder Mask
  if (showCopper) {
    setupTransform(cCtx);
    setupTransform(rCtx);
    setupTransform(bCtx);
    for (const l of copperLayers) {
      drawLayerCommands(cCtx, l.commands, theme.copperUnderMask, theme.boardBg);
      drawLayerCommands(rCtx, l.commands, '#484848', '#5c5c5c');
      drawLayerCommands(bCtx, l.commands, '#8a8a8a', '#303030');
    }
    cCtx.restore();
    rCtx.restore();
    bCtx.restore();
  }

  // 3. Exposed Metallic Pads (Mask openings)
  const padHex = finish === 'ENIG' ? '#E5BC5E' : '#DCE2E8';
  if (showMask) {
    setupTransform(cCtx);
    setupTransform(mCtx);
    setupTransform(rCtx);
    setupTransform(bCtx);

    const drawPadPass = (cmds: DrawCommand[]) => {
      drawLayerCommands(cCtx, cmds, padHex, theme.boardBg);
      drawLayerCommands(mCtx, cmds, '#f2f2f2', '#080808'); // High metalness on pads
      drawLayerCommands(rCtx, cmds, '#282828', '#5c5c5c'); // Glossy metallic polish (~0.16 roughness)
      drawLayerCommands(bCtx, cmds, '#d8d8d8', '#303030'); // Raised pad height
    };

    if (maskLayers.length > 0) {
      for (const l of maskLayers) drawPadPass(l.commands);
    } else if (showCopper) {
      for (const l of copperLayers) {
        drawPadPass(l.commands.filter((c) => c.kind === 'flash'));
      }
    }

    cCtx.restore();
    mCtx.restore();
    rCtx.restore();
    bCtx.restore();
  }

  // 4. Silkscreen Ink
  if (showSilk) {
    setupTransform(cCtx);
    setupTransform(mCtx);
    setupTransform(rCtx);
    setupTransform(bCtx);
    for (const l of silkLayers) {
      drawLayerCommands(cCtx, l.commands, theme.silkColor, theme.boardBg);
      drawLayerCommands(mCtx, l.commands, '#000000', '#080808');
      drawLayerCommands(rCtx, l.commands, '#c2c2c2', '#5c5c5c'); // Matte ink
      drawLayerCommands(bCtx, l.commands, '#b5b5b5', '#303030');
    }
    cCtx.restore();
    mCtx.restore();
    rCtx.restore();
    bCtx.restore();
  }

  // 5. Drill hole dark rings on top/bottom texture
  if (showDrill) {
    setupTransform(cCtx);
    setupTransform(mCtx);
    setupTransform(rCtx);
    for (const l of drillLayers) {
      drawLayerCommands(cCtx, l.commands, '#0B1120', '#0B1120');
      drawLayerCommands(mCtx, l.commands, '#000000', '#000000');
      drawLayerCommands(rCtx, l.commands, '#e0e0e0', '#e0e0e0');
    }
    cCtx.restore();
    mCtx.restore();
    rCtx.restore();
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAniso;

  const metalMap = new THREE.CanvasTexture(metalCanvas);
  metalMap.anisotropy = maxAniso;

  const roughMap = new THREE.CanvasTexture(roughCanvas);
  roughMap.anisotropy = maxAniso;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAniso;

  return { colorMap, metalMap, roughMap, bumpMap };
}

interface GeneratedStencilMaps {
  colorMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  roughMap: THREE.CanvasTexture;
  apertureCount: number;
}

function buildStencilMaps(
  side: 'top' | 'bottom',
  board: ParsedBoard,
  panel: PcbPanelConfig | undefined,
  marginMm: number,
  maxAniso: number
): GeneratedStencilMaps {
  const { bounds, widthMm, heightMm } = board;
  const pDims = computePanelDimensionsMm(widthMm, heightMm, panel);
  const targetW = pDims.panelWidthMm;
  const targetH = pDims.panelHeightMm;
  const totalW = targetW + marginMm * 2;
  const totalH = targetH + marginMm * 2;
  const maxDim = 1536;
  const aspect = Math.max(totalW, 1) / Math.max(totalH, 1);
  const texW = aspect >= 1 ? maxDim : Math.max(256, Math.round(maxDim * aspect));
  const texH = aspect >= 1 ? Math.max(256, Math.round(maxDim / aspect)) : maxDim;

  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = texW;
    c.height = texH;
    return c;
  };

  const colorCanvas = makeCanvas();
  const alphaCanvas = makeCanvas();
  const roughCanvas = makeCanvas();

  const cCtx = colorCanvas.getContext('2d')!;
  const aCtx = alphaCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  // 1. Brushed stainless steel base
  const baseGrad = cCtx.createLinearGradient(0, 0, texW, texH);
  baseGrad.addColorStop(0, '#CDD5DD');
  baseGrad.addColorStop(0.5, '#DFE5EB');
  baseGrad.addColorStop(1, '#BCC6D0');
  cCtx.fillStyle = baseGrad;
  cCtx.fillRect(0, 0, texW, texH);

  // Subtle horizontal brushed-steel grain lines
  cCtx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  cCtx.lineWidth = 1;
  for (let y = 2; y < texH; y += 5) {
    cCtx.beginPath();
    cCtx.moveTo(0, y);
    cCtx.lineTo(texW, y);
    cCtx.stroke();
  }

  // Opaque white in alphaMap = solid stainless steel
  aCtx.fillStyle = '#FFFFFF';
  aCtx.fillRect(0, 0, texW, texH);

  // Brushed metal roughness map (~0.24 - 0.30)
  rCtx.fillStyle = '#404040';
  rCtx.fillRect(0, 0, texW, texH);
  rCtx.strokeStyle = '#525252';
  rCtx.lineWidth = 1;
  for (let y = 3; y < texH; y += 6) {
    rCtx.beginPath();
    rCtx.moveTo(0, y);
    rCtx.lineTo(texW, y);
    rCtx.stroke();
  }

  const setupPanelTransform = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    const sx = texW / Math.max(totalW, 1);
    const sy = texH / Math.max(totalH, 1);
    if (side === 'top') {
      ctx.translate(0, texH);
      ctx.scale(sx, -sy);
      ctx.translate(marginMm, marginMm);
    } else {
      ctx.translate(texW, texH);
      ctx.scale(-sx, -sy);
      ctx.translate(marginMm, marginMm);
    }
  };

  // 2. Etched Panel / PCB Outline registration rectangle on the stainless foil
  setupPanelTransform(cCtx);
  cCtx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
  cCtx.lineWidth = 0.35;
  cCtx.setLineDash([1.8, 1.2]);
  cCtx.strokeRect(0, 0, targetW, targetH);
  for (let r = 0; r < pDims.rows; r++) {
    for (let c = 0; c < pDims.cols; c++) {
      const ox = pDims.railLeftRightMm + c * (widthMm + pDims.gapMm);
      const oy = pDims.railTopBottomMm + r * (heightMm + pDims.gapMm);
      cCtx.strokeRect(ox, oy, widthMm, heightMm);
    }
  }
  cCtx.setLineDash([]);
  cCtx.restore();

  // 3. Laser-Cut SMD Apertures tiled across all boards in the panel
  const { commands } = getStencilCommandsForSide(board, side);

  setupPanelTransform(aCtx);
  for (let r = 0; r < pDims.rows; r++) {
    for (let c = 0; c < pDims.cols; c++) {
      const ox = pDims.railLeftRightMm + c * (widthMm + pDims.gapMm);
      const oy = pDims.railTopBottomMm + r * (heightMm + pDims.gapMm);
      aCtx.save();
      aCtx.translate(ox - bounds.minX, oy - bounds.minY);
      drawLayerCommands(aCtx, commands, '#000000', '#FFFFFF');
      aCtx.restore();
    }
  }
  aCtx.restore();

  // Subtle laser-cut dark edge shadow around cutouts on colorMap
  setupPanelTransform(cCtx);
  for (let r = 0; r < pDims.rows; r++) {
    for (let c = 0; c < pDims.cols; c++) {
      const ox = pDims.railLeftRightMm + c * (widthMm + pDims.gapMm);
      const oy = pDims.railTopBottomMm + r * (heightMm + pDims.gapMm);
      cCtx.save();
      cCtx.translate(ox - bounds.minX, oy - bounds.minY);
      for (const cmd of commands) {
        if (cmd.kind === 'flash' && cmd.polarity !== 'clear') {
          cCtx.strokeStyle = '#334155';
          cCtx.lineWidth = 0.14;
          const { shape, width, height } = cmd.aperture;
          if (shape === 'R') {
            cCtx.strokeRect(cmd.x - width / 2, cmd.y - height / 2, width, height);
          } else if (shape === 'O') {
            const rx = width / 2;
            const ry = height / 2;
            cCtx.beginPath();
            cCtx.roundRect(cmd.x - rx, cmd.y - ry, width, height, Math.min(rx, ry));
            cCtx.stroke();
          } else {
            cCtx.beginPath();
            cCtx.arc(cmd.x, cmd.y, width / 2, 0, Math.PI * 2);
            cCtx.stroke();
          }
        }
      }
      cCtx.restore();
    }
  }
  cCtx.restore();

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAniso;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.anisotropy = maxAniso;

  const roughMap = new THREE.CanvasTexture(roughCanvas);
  roughMap.anisotropy = maxAniso;

  return { colorMap, alphaMap, roughMap, apertureCount: commands.length * pDims.boardsPerPanel };
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 126);
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.55)');
  grad.addColorStop(0.6, 'rgba(2, 6, 23, 0.22)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Gerber3DViewer({
  board,
  theme,
  finish,
  showCopper,
  showMask,
  showSilk,
  showDrill,
  showStencil = false,
  onToggleStencil,
  panel,
  isFullscreen = false,
  onToggleFullscreen,
}: Gerber3DViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [boardThicknessMm, setBoardThicknessMm] = useState<1.6 | 1.0>(1.6);
  const [stencilSide, setStencilSide] = useState<'top' | 'bottom'>('top');
  const [stencilLifted, setStencilLifted] = useState(true);
  const panelDims = computePanelDimensionsMm(board.widthMm, board.heightMm, panel);

  // Refs for imperative triggers inside WebGL lifecycle
  const presetFnRef = useRef<((p: CameraPreset) => void) | null>(null);
  const kickRenderRef = useRef<(() => void) | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const stencilLiftedRef = useRef(stencilLifted);
  stencilLiftedRef.current = stencilLifted;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect Software WebGL cleanly per skill guidelines
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError(true);
      return;
    }

    const canvas = renderer.domElement;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError(true);
    };
    const onContextRestored = () => {
      setWebglError(false);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(container.clientWidth, 320);
    const initH = Math.max(container.clientHeight, 320);
    renderer.setSize(initW, initH);
    container.innerHTML = '';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B1120');
    scene.fog = new THREE.FogExp2('#0B1120', 0.018);

    // Mandatory studio environment map via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.1, 350);
    const pDims = computePanelDimensionsMm(board.widthMm, board.heightMm, panel);
    const unitScale = 0.1; // 10mm = 1 scene unit
    const bw = board.widthMm * unitScale;
    const bh = board.heightMm * unitScale;
    const pw = pDims.panelWidthMm * unitScale;
    const ph = pDims.panelHeightMm * unitScale;
    const bt = boardThicknessMm * unitScale;
    const gapUnit = pDims.gapMm * unitScale;
    const railLR = pDims.railLeftRightMm * unitScale;
    const railTB = pDims.railTopBottomMm * unitScale;
    const totalTiles = pDims.boardsPerPanel;
    const viewDist = Math.max(pw, ph) * 1.45;

    camera.position.set(viewDist * 0.65, viewDist * 0.78, viewDist * 0.85);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = Math.max(pw, ph) * 0.25;
    controls.maxDistance = Math.max(pw, ph) * 4.5;
    controls.target.set(0, 0, 0);

    // 3-Point Studio Lighting Rig
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.75);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(viewDist * 0.8, viewDist * 1.4, viewDist * 0.7);
    keyLight.castShadow = !isSoftwareGl;
    const shadowBound = Math.max(pw, ph) * 0.85;
    keyLight.shadow.camera.left = -shadowBound;
    keyLight.shadow.camera.right = shadowBound;
    keyLight.shadow.camera.top = shadowBound;
    keyLight.shadow.camera.bottom = -shadowBound;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = viewDist * 4;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.9);
    rimLight.position.set(-viewDist, viewDist * 0.5, -viewDist * 0.9);
    scene.add(rimLight);

    // Composite Multi-Part PCB / Panel Group
    const pcbGroup = new THREE.Group();
    scene.add(pcbGroup);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const topMaps = buildSidePbrMaps(
      'top',
      board,
      theme,
      finish,
      showCopper,
      showMask,
      showSilk,
      showDrill,
      maxAniso
    );
    const botMaps = buildSidePbrMaps(
      'bottom',
      board,
      theme,
      finish,
      showCopper,
      showMask,
      showSilk,
      showDrill,
      maxAniso
    );

    const tileCenters: Array<[number, number]> = [];
    const matrixW = pDims.cols * bw + Math.max(0, pDims.cols - 1) * gapUnit;
    const matrixH = pDims.rows * bh + Math.max(0, pDims.rows - 1) * gapUnit;
    const startX = -matrixW / 2 + bw / 2;
    const startZ = -matrixH / 2 + bh / 2;
    for (let r = 0; r < pDims.rows; r++) {
      for (let c = 0; c < pDims.cols; c++) {
        tileCenters.push([
          startX + c * (bw + gapUnit),
          startZ + r * (bh + gapUnit),
        ]);
      }
    }

    const disposableGeos: THREE.BufferGeometry[] = [];
    const disposableMats: THREE.Material[] = [];

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xa69363,
      roughness: 0.68,
      metalness: 0.05,
    });
    disposableMats.push(coreMat);

    const railMaskMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.boardBg),
      roughness: 0.38,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposableMats.push(railMaskMat);

    const hasMilledGap = pDims.isPanel && pDims.gapMm > 0 && (pDims.cols > 1 || pDims.rows > 1);

    // 1. FR4 Core Substrate (Unified for single/V-Cut, or Per-Tile + Breakaway Tabs + Rails for Tab-Routing)
    if (!hasMilledGap) {
      const coreGeo = new THREE.BoxGeometry(pw, bt, ph);
      disposableGeos.push(coreGeo);
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.castShadow = true;
      coreMesh.receiveShadow = true;
      pcbGroup.add(coreMesh);
    } else {
      const tileCoreGeo = new THREE.BoxGeometry(bw, bt, bh);
      disposableGeos.push(tileCoreGeo);
      const tileCoreInst = new THREE.InstancedMesh(tileCoreGeo, coreMat, totalTiles);
      tileCoreInst.castShadow = true;
      tileCoreInst.receiveShadow = true;
      tileCenters.forEach(([tx, tz], i) => {
        _dummy.position.set(tx, 0, tz);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        tileCoreInst.setMatrixAt(i, _dummy.matrix);
      });
      tileCoreInst.instanceMatrix.needsUpdate = true;
      tileCoreInst.computeBoundingSphere();
      pcbGroup.add(tileCoreInst);

      // Breakaway Tab bridges across gaps
      const tabGeo = new THREE.BoxGeometry(Math.max(gapUnit + 0.04, 0.25), bt, Math.min(0.42, bh * 0.28));
      disposableGeos.push(tabGeo);
      const tabMatrices: THREE.Matrix4[] = [];
      for (let r = 0; r < pDims.rows; r++) {
        for (let c = 0; c < pDims.cols - 1; c++) {
          const mx = startX + c * (bw + gapUnit) + bw / 2 + gapUnit / 2;
          const mz = startZ + r * (bh + gapUnit);
          _dummy.position.set(mx, 0, mz);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          tabMatrices.push(_dummy.matrix.clone());
        }
      }
      for (let r = 0; r < pDims.rows - 1; r++) {
        for (let c = 0; c < pDims.cols; c++) {
          const mx = startX + c * (bw + gapUnit);
          const mz = startZ + r * (bh + gapUnit) + bh / 2 + gapUnit / 2;
          _dummy.position.set(mx, 0, mz);
          _dummy.rotation.set(0, Math.PI / 2, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          tabMatrices.push(_dummy.matrix.clone());
        }
      }
      if (tabMatrices.length > 0) {
        const tabInst = new THREE.InstancedMesh(tabGeo, coreMat, tabMatrices.length);
        tabMatrices.forEach((m, i) => tabInst.setMatrixAt(i, m));
        tabInst.instanceMatrix.needsUpdate = true;
        tabInst.computeBoundingSphere();
        pcbGroup.add(tabInst);
      }
      _dummy.rotation.set(0, 0, 0);
    }

    // 1b. Panel Edge Rails (Solder-masked structural rails + Tooling Holes + Fiducials)
    if (pDims.isPanel && (railLR > 0 || railTB > 0)) {
      const addRailBlock = (w: number, d: number, x: number, z: number) => {
        if (hasMilledGap) {
          const railBoxGeo = new THREE.BoxGeometry(w, bt, d);
          disposableGeos.push(railBoxGeo);
          const railMesh = new THREE.Mesh(railBoxGeo, coreMat);
          railMesh.position.set(x, 0, z);
          railMesh.castShadow = true;
          railMesh.receiveShadow = true;
          pcbGroup.add(railMesh);
        }
        const capGeo = new THREE.PlaneGeometry(w, d);
        disposableGeos.push(capGeo);
        const topCap = new THREE.Mesh(capGeo, railMaskMat);
        topCap.rotation.x = -Math.PI / 2;
        topCap.position.set(x, bt / 2 + 0.0015, z);
        topCap.receiveShadow = true;
        const botCap = new THREE.Mesh(capGeo, railMaskMat);
        botCap.rotation.x = Math.PI / 2;
        botCap.position.set(x, -bt / 2 - 0.0015, z);
        botCap.receiveShadow = true;
        pcbGroup.add(topCap, botCap);
      };

      if (railLR > 0) {
        addRailBlock(railLR, ph, -pw / 2 + railLR / 2, 0);
        addRailBlock(railLR, ph, pw / 2 - railLR / 2, 0);
      }
      if (railTB > 0) {
        const innerW = pw - railLR * 2;
        addRailBlock(innerW, railTB, 0, -ph / 2 + railTB / 2);
        addRailBlock(innerW, railTB, 0, ph / 2 - railTB / 2);
      }

      // 4 Plated Tooling Rings + Fiducial Dots on Panel Edge Rails
      const holeInsetX = railLR > 0 ? pw / 2 - railLR / 2 : pw / 2 - 0.35;
      const holeInsetZ = ph / 2 - (railTB > 0 ? railTB / 2 : 0.45);
      const railPoints: Array<[number, number]> = [
        [-holeInsetX, -holeInsetZ],
        [holeInsetX, -holeInsetZ],
        [-holeInsetX, holeInsetZ],
        [holeInsetX, holeInsetZ],
      ];
      const toolingRingGeo = new THREE.RingGeometry(0.08, 0.14, 20);
      const toolingMat = new THREE.MeshStandardMaterial({
        color: finish === 'ENIG' ? 0xe5bc5e : 0xdce2e8,
        metalness: 0.9,
        roughness: 0.2,
        side: THREE.DoubleSide,
      });
      disposableGeos.push(toolingRingGeo);
      disposableMats.push(toolingMat);
      for (const [rx, rz] of railPoints) {
        const topRing = new THREE.Mesh(toolingRingGeo, toolingMat);
        topRing.rotation.x = -Math.PI / 2;
        topRing.position.set(rx, bt / 2 + 0.004, rz);
        const botRing = new THREE.Mesh(toolingRingGeo, toolingMat);
        botRing.rotation.x = Math.PI / 2;
        botRing.position.set(rx, -bt / 2 - 0.004, rz);
        pcbGroup.add(topRing, botRing);
      }
    }

    // 1c. V-Cut Score Lines on Panel Seams
    if (pDims.isPanel && pDims.gapMm === 0 && (pDims.cols > 1 || pDims.rows > 1 || railLR > 0 || railTB > 0)) {
      const vCutPts: number[] = [];
      const yTop = bt / 2 + 0.0045;
      const yBot = -bt / 2 - 0.0045;
      for (let c = 0; c <= pDims.cols; c++) {
        if ((c === 0 || c === pDims.cols) && railLR === 0) continue;
        const x = -matrixW / 2 + c * bw;
        vCutPts.push(x, yTop, -ph / 2, x, yTop, ph / 2);
        vCutPts.push(x, yBot, -ph / 2, x, yBot, ph / 2);
      }
      for (let r = 0; r <= pDims.rows; r++) {
        if ((r === 0 || r === pDims.rows) && railTB === 0) continue;
        const z = -matrixH / 2 + r * bh;
        vCutPts.push(-pw / 2, yTop, z, pw / 2, yTop, z);
        vCutPts.push(-pw / 2, yBot, z, pw / 2, yBot, z);
      }
      if (vCutPts.length > 0) {
        const vGeo = new THREE.BufferGeometry();
        vGeo.setAttribute('position', new THREE.Float32BufferAttribute(vCutPts, 3));
        const vMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.72,
        });
        disposableGeos.push(vGeo);
        disposableMats.push(vMat);
        pcbGroup.add(new THREE.LineSegments(vGeo, vMat));
      }
    }

    // 2. Top Copper/Mask/Silk Layer (Instanced across all panel boards in 1 draw call!)
    const faceGeo = new THREE.PlaneGeometry(bw, bh);
    disposableGeos.push(faceGeo);

    const topMat = new THREE.MeshStandardMaterial({
      map: topMaps.colorMap,
      metalnessMap: topMaps.metalMap,
      metalness: 1.0,
      roughnessMap: topMaps.roughMap,
      roughness: 1.0,
      bumpMap: topMaps.bumpMap,
      bumpScale: 0.015,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposableMats.push(topMat);

    const topInst = new THREE.InstancedMesh(faceGeo, topMat, totalTiles);
    topInst.receiveShadow = true;
    tileCenters.forEach(([tx, tz], idx) => {
      _dummy.position.set(tx, bt / 2 + 0.002, tz);
      _dummy.rotation.set(-Math.PI / 2, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      topInst.setMatrixAt(idx, _dummy.matrix);
    });
    topInst.instanceMatrix.needsUpdate = true;
    topInst.computeBoundingSphere();
    pcbGroup.add(topInst);

    // 3. Bottom Copper/Mask/Silk Layer (Instanced across all panel boards in 1 draw call!)
    const botMat = new THREE.MeshStandardMaterial({
      map: botMaps.colorMap,
      metalnessMap: botMaps.metalMap,
      metalness: 1.0,
      roughnessMap: botMaps.roughMap,
      roughness: 1.0,
      bumpMap: botMaps.bumpMap,
      bumpScale: 0.015,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposableMats.push(botMat);

    const botInst = new THREE.InstancedMesh(faceGeo, botMat, totalTiles);
    botInst.receiveShadow = true;
    tileCenters.forEach(([tx, tz], idx) => {
      _dummy.position.set(tx, -bt / 2 - 0.002, tz);
      _dummy.rotation.set(Math.PI / 2, 0, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      botInst.setMatrixAt(idx, _dummy.matrix);
    });
    botInst.instanceMatrix.needsUpdate = true;
    botInst.computeBoundingSphere();
    _dummy.rotation.set(0, 0, 0);
    pcbGroup.add(botInst);

    // 4. Instanced Copper/Plated Through-Hole Barrels from Drill Layer (capped safely for huge panels)
    if (showDrill) {
      const drillCommands = board.layers
        .filter((l) => l.kind === 'drill')
        .flatMap((l) => l.commands)
        .filter((c): c is Extract<DrawCommand, { kind: 'flash' }> => c.kind === 'flash');

      const totalBarrels = drillCommands.length * totalTiles;
      if (drillCommands.length > 0 && totalBarrels <= 4500) {
        const midX = (board.bounds.minX + board.bounds.maxX) / 2;
        const midY = (board.bounds.minY + board.bounds.maxY) / 2;

        const drillGeo = new THREE.CylinderGeometry(1, 1, bt + 0.008, 14, 1, true);
        const drillMat = new THREE.MeshStandardMaterial({
          color: finish === 'ENIG' ? 0xe5bc5e : 0xcbd5e1,
          metalness: 0.92,
          roughness: 0.22,
          side: THREE.DoubleSide,
        });
        disposableGeos.push(drillGeo);
        disposableMats.push(drillMat);

        const drillBarrelMesh = new THREE.InstancedMesh(drillGeo, drillMat, totalBarrels);
        let bIdx = 0;
        for (const [tx, tz] of tileCenters) {
          for (let i = 0; i < drillCommands.length; i++) {
            const d = drillCommands[i];
            const px = tx + (d.x - midX) * unitScale;
            const pz = tz - (d.y - midY) * unitScale;
            const radius = Math.max(0.02, (d.aperture.width / 2) * unitScale);
            _dummy.position.set(px, 0, pz);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(radius, 1, radius);
            _dummy.updateMatrix();
            drillBarrelMesh.setMatrixAt(bIdx++, _dummy.matrix);
          }
        }
        drillBarrelMesh.instanceMatrix.needsUpdate = true;
        drillBarrelMesh.computeBoundingSphere();
        _dummy.scale.set(1, 1, 1);
        pcbGroup.add(drillBarrelMesh);
      }
    }

    // 5. Composite Laser-Cut Stainless Steel SMD Stencil Assembly (Sized & Tiled to Full Panel!)
    let stencilGroup: THREE.Group | null = null;
    let stencilMaps: GeneratedStencilMaps | null = null;
    let guideGeo: THREE.BufferGeometry | null = null;
    let guideLines: THREE.LineSegments | null = null;

    const stencilMarginMm = 12;
    const sw = (pDims.panelWidthMm + stencilMarginMm * 2) * unitScale;
    const sh = (pDims.panelHeightMm + stencilMarginMm * 2) * unitScale;
    const stencilRestY =
      stencilSide === 'top' ? bt / 2 + 0.025 : -bt / 2 - 0.025;
    const stencilLiftDelta = Math.max(1.2, Math.max(pw, ph) * 0.22);
    const getStencilTargetY = () =>
      stencilLiftedRef.current
        ? stencilSide === 'top'
          ? bt / 2 + stencilLiftDelta
          : -bt / 2 - stencilLiftDelta
        : stencilRestY;

    if (showStencil) {
      stencilGroup = new THREE.Group();
      stencilGroup.position.y = getStencilTargetY();
      pcbGroup.add(stencilGroup);

      stencilMaps = buildStencilMaps(stencilSide, board, panel, stencilMarginMm, maxAniso);

      // Part 1: Brushed Stainless Steel Foil with real alphaTest laser cutouts
      const stencilFoilGeo = new THREE.PlaneGeometry(sw, sh);
      const stencilFoilMat = new THREE.MeshStandardMaterial({
        map: stencilMaps.colorMap,
        alphaMap: stencilMaps.alphaMap,
        alphaTest: 0.5,
        roughnessMap: stencilMaps.roughMap,
        roughness: 1.0,
        metalness: 0.9,
        side: THREE.DoubleSide,
      });
      disposableGeos.push(stencilFoilGeo);
      disposableMats.push(stencilFoilMat);
      const stencilFoilMesh = new THREE.Mesh(stencilFoilGeo, stencilFoilMat);
      stencilFoilMesh.rotation.x = stencilSide === 'top' ? -Math.PI / 2 : Math.PI / 2;
      stencilFoilMesh.castShadow = !isSoftwareGl;
      stencilFoilMesh.receiveShadow = true;
      stencilGroup.add(stencilFoilMesh);

      // Parts 2-5: Matte Anodized Aluminum Frame Rails
      const railW = 0.22;
      const railH = 0.14;
      const stencilRailMat = new THREE.MeshStandardMaterial({
        color: 0x223040,
        metalness: 0.62,
        roughness: 0.58,
      });
      const stencilRailHGeo = new THREE.BoxGeometry(sw + railW * 2, railH, railW);
      const stencilRailVGeo = new THREE.BoxGeometry(railW, railH, sh);
      disposableGeos.push(stencilRailHGeo, stencilRailVGeo);
      disposableMats.push(stencilRailMat);

      const topRail = new THREE.Mesh(stencilRailHGeo, stencilRailMat);
      topRail.position.set(0, 0, -(sh / 2 + railW / 2));
      topRail.castShadow = !isSoftwareGl;
      const botRail = new THREE.Mesh(stencilRailHGeo, stencilRailMat);
      botRail.position.set(0, 0, sh / 2 + railW / 2);
      botRail.castShadow = !isSoftwareGl;
      const leftRail = new THREE.Mesh(stencilRailVGeo, stencilRailMat);
      leftRail.position.set(-(sw / 2 + railW / 2), 0, 0);
      leftRail.castShadow = !isSoftwareGl;
      const rightRail = new THREE.Mesh(stencilRailVGeo, stencilRailMat);
      rightRail.position.set(sw / 2 + railW / 2, 0, 0);
      rightRail.castShadow = !isSoftwareGl;

      stencilGroup.add(topRail, botRail, leftRail, rightRail);

      // Parts 6-9: 4 Brass Corner Registration Bushings
      const stencilPinGeo = new THREE.CylinderGeometry(0.11, 0.11, railH + 0.04, 16);
      const stencilPinMat = new THREE.MeshStandardMaterial({
        color: 0xd9ad4e,
        metalness: 0.88,
        roughness: 0.24,
      });
      disposableGeos.push(stencilPinGeo);
      disposableMats.push(stencilPinMat);
      const cornerOffsets: Array<[number, number]> = [
        [-(sw / 2 + railW / 2), -(sh / 2 + railW / 2)],
        [sw / 2 + railW / 2, -(sh / 2 + railW / 2)],
        [-(sw / 2 + railW / 2), sh / 2 + railW / 2],
        [sw / 2 + railW / 2, sh / 2 + railW / 2],
      ];
      for (const [cx, cz] of cornerOffsets) {
        const pin = new THREE.Mesh(stencilPinGeo, stencilPinMat);
        pin.position.set(cx, 0, cz);
        stencilGroup.add(pin);
      }

      // Corner alignment projection lines between Panel/PCB corners and Stencil outline
      const halfPw = pw / 2;
      const halfPh = ph / 2;
      const pcbCornerY = stencilSide === 'top' ? bt / 2 : -bt / 2;
      const guidePositions = new Float32Array(4 * 2 * 3);
      const corners = [
        [-halfPw, -halfPh],
        [halfPw, -halfPh],
        [-halfPw, halfPh],
        [halfPw, halfPh],
      ];
      corners.forEach(([x, z], idx) => {
        const base = idx * 6;
        guidePositions[base] = x;
        guidePositions[base + 1] = pcbCornerY;
        guidePositions[base + 2] = z;
        guidePositions[base + 3] = x;
        guidePositions[base + 4] = stencilGroup!.position.y;
        guidePositions[base + 5] = z;
      });
      guideGeo = new THREE.BufferGeometry();
      guideGeo.setAttribute('position', new THREE.BufferAttribute(guidePositions, 3));
      const guideMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.55,
      });
      disposableGeos.push(guideGeo);
      disposableMats.push(guideMat);
      guideLines = new THREE.LineSegments(guideGeo, guideMat);
      guideLines.visible = stencilLiftedRef.current;
      pcbGroup.add(guideLines);
    }

    // 6. Soft Ground Contact Shadow Plane (prevent floating void look)
    const shadowTex = createContactShadowTexture();
    const shadowPlaneGeo = new THREE.PlaneGeometry(pw * 1.5, ph * 1.5);
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -bt / 2 - 0.18;
    scene.add(shadowPlane);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Camera & Stencil transition state
    let transitionActive = false;
    let stencilAnimating = false;
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        const delta = Math.min(clock.getDelta(), 0.05);

        if (transitionActive) {
          const factor = isSoftwareGl ? 1 : 1 - Math.exp(-8 * delta);
          camera.position.lerp(_targetCamPos, factor);
          controls.target.lerp(_targetLookAt, factor);
          if (camera.position.distanceTo(_targetCamPos) < 0.03) {
            camera.position.copy(_targetCamPos);
            controls.target.copy(_targetLookAt);
            transitionActive = false;
          }
        }

        if (stencilGroup) {
          const targetY = getStencilTargetY();
          if (Math.abs(stencilGroup.position.y - targetY) > 0.005) {
            stencilGroup.position.y = isSoftwareGl
              ? targetY
              : THREE.MathUtils.damp(stencilGroup.position.y, targetY, 9, delta);
            stencilAnimating = Math.abs(stencilGroup.position.y - targetY) > 0.005;
          } else {
            stencilGroup.position.y = targetY;
            stencilAnimating = false;
          }
          if (guideLines && guideGeo) {
            const posAttr = guideGeo.getAttribute('position') as THREE.BufferAttribute;
            for (let k = 0; k < 4; k++) {
              posAttr.setY(k * 2 + 1, stencilGroup.position.y);
            }
            posAttr.needsUpdate = true;
            guideLines.visible = Math.abs(stencilGroup.position.y - stencilRestY) > 0.06;
          }
        } else {
          stencilAnimating = false;
        }

        if (autoRotateRef.current && !isSoftwareGl) {
          pcbGroup.rotation.y += delta * 0.45;
        }

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (
            renderDirty ||
            transitionActive ||
            stencilAnimating ||
            (autoRotateRef.current && !isSoftwareGl)
          ) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    kickRenderRef.current = requestRender;

    const onControlStart = () => {
      transitionActive = false;
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    presetFnRef.current = (preset: CameraPreset) => {
      pcbGroup.rotation.y = 0;
      _targetLookAt.set(0, 0, 0);
      if (preset === 'iso') {
        _targetCamPos.set(viewDist * 0.65, viewDist * 0.78, viewDist * 0.85);
      } else if (preset === 'top') {
        _targetCamPos.set(0, viewDist * 1.15, 0.01);
      } else if (preset === 'bottom') {
        _targetCamPos.set(0, -viewDist * 1.15, 0.01);
      } else {
        _targetCamPos.set(0, viewDist * 0.14, viewDist * 1.1);
      }
      transitionActive = true;
      requestRender();
    };

    const handleResize = () => {
      if (!container) return;
      const w = Math.max(container.clientWidth, 300);
      const h = Math.max(container.clientHeight, 280);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // Initial render
    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);

      disposableGeos.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      topMaps.colorMap.dispose();
      topMaps.metalMap.dispose();
      topMaps.roughMap.dispose();
      topMaps.bumpMap.dispose();
      botMaps.colorMap.dispose();
      botMaps.metalMap.dispose();
      botMaps.roughMap.dispose();
      botMaps.bumpMap.dispose();
      if (stencilMaps) {
        stencilMaps.colorMap.dispose();
        stencilMaps.alphaMap.dispose();
        stencilMaps.roughMap.dispose();
      }
      shadowPlaneGeo.dispose();
      shadowPlaneMat.dispose();
      shadowTex.dispose();
      envTex.dispose();
      renderer.dispose();
      presetFnRef.current = null;
      kickRenderRef.current = null;
    };
  }, [
    board,
    theme,
    finish,
    showCopper,
    showMask,
    showSilk,
    showDrill,
    boardThicknessMm,
    showStencil,
    stencilSide,
    panel?.enabled,
    panel?.cols,
    panel?.rows,
    panel?.railMode,
    panel?.railWidthMm,
    panel?.gapMm,
  ]);

  useEffect(() => {
    kickRenderRef.current?.();
  }, [stencilLifted, autoRotate]);

  if (webglError) {
    return (
      <div className="w-full h-[380px] sm:h-[460px] bg-slate-900 border border-slate-700 rounded-xl flex flex-col items-center justify-center p-6 text-center text-slate-300">
        <p className="text-sm font-semibold mb-2">تعذر تشغيل العارض ثلاثي الأبعاد WebGL على هذا المتصفح</p>
        <p className="text-xs text-slate-400">يمكنك التبديل إلى عرض Top + Bottom ثنائي الأبعاد لمعاينة جميع الطبقات.</p>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full bg-slate-950 border border-slate-700 rounded-xl overflow-hidden ${
        isFullscreen ? 'h-[78vh] min-h-[480px]' : 'h-[400px] sm:h-[490px]'
      }`}
    >
      {/* Isolated WebGL mount container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Minimal Top Spec Readout */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-center justify-between gap-2 z-10">
        <div className="bg-slate-900/90 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2.5">
          <span className="font-semibold text-white">معاينة 3D</span>
          {panelDims.isPanel && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono-tech text-sky-300 font-semibold">
                بانل {panelDims.cols}×{panelDims.rows} ({panelDims.boardsPerPanel} بوردة)
              </span>
            </>
          )}
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="font-mono-tech tabular-nums text-slate-300">
            {panelDims.panelWidthMm} × {panelDims.panelHeightMm} × {boardThicknessMm} mm
          </span>
        </div>

        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'تصغير' : 'فتح ملء الشاشة'}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-white cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? 'إغلاق التكبير' : 'تكبير 3D'}</span>
          </button>
        )}
      </div>

      {/* Collapsible Bottom Control Dock (zero viewport occlusion) */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94%]"
      >
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-3 py-1 rounded-t-lg bg-slate-900/95 border border-b-0 border-slate-700 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'إظهار أدوات 3D' : 'إخفاء الأدوات'}</span>
        </button>

        {!dockCollapsed && (
          <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 flex flex-wrap items-center justify-center gap-2 shadow-lg">
            {/* Camera Presets */}
            <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
              {(
                [
                  { id: 'iso', label: 'منظور 3D' },
                  { id: 'top', label: 'الوجه العلوي' },
                  { id: 'bottom', label: 'الوجه السفلي' },
                  { id: 'edge', label: 'حافة البوردة' },
                ] as const
              ).map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => presetFnRef.current?.(cam.id)}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-md cursor-pointer whitespace-nowrap"
                >
                  {cam.label}
                </button>
              ))}
            </div>

            {/* Thickness Toggle */}
            <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
              <span className="text-[11px] text-slate-400">السُمك:</span>
              {([1.6, 1.0] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBoardThicknessMm(t)}
                  className={`px-2 py-1 text-[11px] font-mono-tech font-semibold rounded cursor-pointer ${
                    boardThicknessMm === t
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {t}mm
                </button>
              ))}
            </div>

            {/* Stencil 3D Controls */}
            {onToggleStencil && (
              <div className="flex items-center gap-1.5 border-l border-slate-700 pl-2">
                <button
                  type="button"
                  onClick={onToggleStencil}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                    showStencil
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {showStencil ? 'إخفاء الاستنسل' : 'عرض الاستنسل 3D'}
                </button>
                {showStencil && (
                  <>
                    <button
                      type="button"
                      onClick={() => setStencilLifted((v) => !v)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded cursor-pointer whitespace-nowrap ${
                        stencilLifted
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {stencilLifted ? 'مرفوع' : 'ملتصق'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStencilSide((s) => (s === 'top' ? 'bottom' : 'top'))}
                      className="px-2 py-1 text-[11px] font-mono-tech font-semibold rounded bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      {stencilSide === 'top' ? 'Top' : 'Bottom'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Auto Rotate */}
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                autoRotate
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>دوران</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
