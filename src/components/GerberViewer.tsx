import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  Box,
  Calculator,
  Check,
  Eye,
  FileArchive,
  Layers,
  LayoutGrid,
  Maximize2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  createSampleGerberBoard,
  getStencilCommandsForSide,
  parseGerberInputFiles,
  type DrawCommand,
  type GerberLayerKind,
  type ParsedBoard,
  type ParsedLayer,
} from '../utils/gerberParser';
import {
  calculatePcbEstimate,
  computePanelDimensionsMm,
  DEFAULT_PCB_PRICING,
  type PanelRailMode,
  type PcbPanelConfig,
  type PcbPricingConfig,
} from '../shared/siteData';
import { Gerber3DViewer } from './Gerber3DViewer';

interface GerberViewerProps {
  pricing?: Partial<PcbPricingConfig>;
  onUseForQuote: (summary: string, quantity?: number) => void;
}

type ViewMode = 'both' | 'top' | 'bottom' | 'stencil' | '3d';
type FinishType = 'HASL' | 'ENIG';

interface MaskTheme {
  id: string;
  label: string;
  boardBg: string;
  copperUnderMask: string;
  silkColor: string;
  swatch: string;
}

const MASK_THEMES: MaskTheme[] = [
  {
    id: 'green',
    label: 'أخضر',
    boardBg: '#0D5C31',
    copperUnderMask: '#1B8F4E',
    silkColor: '#F8FAFC',
    swatch: '#15803D',
  },
  {
    id: 'black',
    label: 'أسود',
    boardBg: '#1C2024',
    copperUnderMask: '#333A42',
    silkColor: '#F1F5F9',
    swatch: '#18181B',
  },
  {
    id: 'blue',
    label: 'أزرق',
    boardBg: '#0C4380',
    copperUnderMask: '#1C6AC2',
    silkColor: '#F8FAFC',
    swatch: '#1D4ED8',
  },
  {
    id: 'red',
    label: 'أحمر',
    boardBg: '#8E1919',
    copperUnderMask: '#C62E2E',
    silkColor: '#F8FAFC',
    swatch: '#B91C1C',
  },
  {
    id: 'white',
    label: 'أبيض',
    boardBg: '#E6E9ED',
    copperUnderMask: '#CBD2D9',
    silkColor: '#1E293B',
    swatch: '#F1F5F9',
  },
  {
    id: 'yellow',
    label: 'أصفر',
    boardBg: '#C48A0E',
    copperUnderMask: '#E1A726',
    silkColor: '#1E293B',
    swatch: '#D97706',
  },
];

const LAYER_LABELS: Record<GerberLayerKind, string> = {
  topCopper: 'نحاس علوي (Top Copper)',
  bottomCopper: 'نحاس سفلي (Bottom Copper)',
  topMask: 'قناع علوي (Top Mask)',
  bottomMask: 'قناع سفلي (Bottom Mask)',
  topPaste: 'استنسل علوي (Top Paste)',
  bottomPaste: 'استنسل سفلي (Bottom Paste)',
  topSilk: 'طباعة علوية (Top Silk)',
  bottomSilk: 'طباعة سفلية (Bottom Silk)',
  outline: 'حدود البوردة (Outline)',
  drill: 'ملف الثقوب (Drill)',
  unknown: 'ملف إضافي',
};

function drawCommands(
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
        const r = Math.min(rx, ry);
        ctx.beginPath();
        ctx.roundRect(cmd.x - rx, cmd.y - ry, width, height, r);
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

interface PcbSideCanvasProps {
  side: 'top' | 'bottom';
  board: ParsedBoard;
  theme: MaskTheme;
  finish: FinishType;
  zoom: number;
  showCopper: boolean;
  showMask: boolean;
  showSilk: boolean;
  showDrill: boolean;
  showStencil?: boolean;
  panel?: PcbPanelConfig;
}

function drawSingleBoardLayers(
  ctx: CanvasRenderingContext2D,
  board: ParsedBoard,
  side: 'top' | 'bottom',
  theme: MaskTheme,
  finish: FinishType,
  showCopper: boolean,
  showMask: boolean,
  showSilk: boolean,
  showDrill: boolean,
  showStencil: boolean,
  outlineLineWidth: number
) {
  const { bounds, widthMm, heightMm, layers } = board;

  ctx.fillStyle = theme.boardBg;
  ctx.fillRect(bounds.minX, bounds.minY, widthMm, heightMm);

  const findLayers = (kind: GerberLayerKind): ParsedLayer[] =>
    layers.filter((l) => l.kind === kind);

  const copperLayers = findLayers(side === 'top' ? 'topCopper' : 'bottomCopper');
  const maskLayers = findLayers(side === 'top' ? 'topMask' : 'bottomMask');
  const silkLayers = findLayers(side === 'top' ? 'topSilk' : 'bottomSilk');
  const outlineLayers = findLayers('outline');
  const drillLayers = findLayers('drill');

  if (showCopper) {
    for (const l of copperLayers) {
      drawCommands(ctx, l.commands, theme.copperUnderMask, theme.boardBg);
    }
  }

  const padColor = finish === 'ENIG' ? '#E3BA59' : '#D5DCE3';
  if (showMask) {
    if (maskLayers.length > 0) {
      for (const l of maskLayers) {
        drawCommands(ctx, l.commands, padColor, theme.boardBg);
      }
    } else if (showCopper) {
      for (const l of copperLayers) {
        const padFlashes = l.commands.filter((c) => c.kind === 'flash');
        drawCommands(ctx, padFlashes, padColor, theme.boardBg);
      }
    }
  }

  if (showSilk) {
    for (const l of silkLayers) {
      drawCommands(ctx, l.commands, theme.silkColor, theme.boardBg);
    }
  }

  if (outlineLayers.length > 0) {
    for (const l of outlineLayers) {
      drawCommands(ctx, l.commands, '#94A3B8', theme.boardBg);
    }
  } else {
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = outlineLineWidth;
    ctx.strokeRect(bounds.minX, bounds.minY, widthMm, heightMm);
  }

  if (showDrill) {
    for (const l of drillLayers) {
      drawCommands(ctx, l.commands, '#0B1120', '#0B1120');
    }
  }

  if (showStencil) {
    const { commands: stencilCmds } = getStencilCommandsForSide(board, side);
    if (stencilCmds.length > 0) {
      drawCommands(ctx, stencilCmds, 'rgba(56, 189, 248, 0.72)', 'rgba(0,0,0,0)');
    }
  }
}

function PcbSideCanvas({
  side,
  board,
  theme,
  finish,
  zoom,
  showCopper,
  showMask,
  showSilk,
  showDrill,
  showStencil = false,
  panel,
}: PcbSideCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const panelDims = useMemo(
    () => computePanelDimensionsMm(board.widthMm, board.heightMm, panel),
    [board.widthMm, board.heightMm, panel]
  );

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [board.archiveName, zoom, panelDims.cols, panelDims.rows, panelDims.isPanel]);

  // Cached single-board tile bitmap for fast panning/zooming on multi-board panels
  const tileCanvas = useMemo(() => {
    if (!panelDims.isPanel) return null;
    const { bounds, widthMm, heightMm } = board;
    const maxTileDim = 640;
    const aspect = Math.max(widthMm, 1) / Math.max(heightMm, 1);
    const tw = aspect >= 1 ? maxTileDim : Math.max(160, Math.round(maxTileDim * aspect));
    const th = aspect >= 1 ? Math.max(160, Math.round(maxTileDim / aspect)) : maxTileDim;
    const off = document.createElement('canvas');
    off.width = tw;
    off.height = th;
    const tCtx = off.getContext('2d');
    if (!tCtx) return null;
    tCtx.translate(0, th);
    tCtx.scale(tw / Math.max(widthMm, 1), -(th / Math.max(heightMm, 1)));
    tCtx.translate(-bounds.minX, -bounds.minY);
    drawSingleBoardLayers(
      tCtx,
      board,
      side,
      theme,
      finish,
      showCopper,
      showMask,
      showSilk,
      showDrill,
      showStencil,
      0.25
    );
    return off;
  }, [
    board,
    finish,
    panelDims.isPanel,
    showCopper,
    showDrill,
    showMask,
    showSilk,
    showStencil,
    side,
    theme,
  ]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(rect.width, 300);
    const cssH = Math.max(rect.height, 260);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Workbench canvas background (JLCPCB-style dark blueprint grid)
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, cssW, cssH);

    // Subtle technical dot/grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const step = 24;
    for (let gx = 0; gx < cssW; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, cssH);
      ctx.stroke();
    }
    for (let gy = 0; gy < cssH; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cssW, gy);
      ctx.stroke();
    }

    const { bounds, widthMm, heightMm } = board;
    const viewW = panelDims.isPanel ? panelDims.panelWidthMm : widthMm;
    const viewH = panelDims.isPanel ? panelDims.panelHeightMm : heightMm;
    const padding = 28;
    const baseScale = Math.min(
      (cssW - padding * 2) / Math.max(viewW, 1),
      (cssH - padding * 2) / Math.max(viewH, 1)
    );
    const scale = baseScale * zoom;

    ctx.translate(cssW / 2 + pan.x, cssH / 2 + pan.y);
    ctx.scale(side === 'bottom' ? -scale : scale, -scale);

    if (!panelDims.isPanel) {
      const midX = (bounds.minX + bounds.maxX) / 2;
      const midY = (bounds.minY + bounds.maxY) / 2;
      ctx.translate(-midX, -midY);
      drawSingleBoardLayers(
        ctx,
        board,
        side,
        theme,
        finish,
        showCopper,
        showMask,
        showSilk,
        showDrill,
        showStencil,
        Math.max(0.25, 1.2 / scale)
      );
      ctx.restore();
      return;
    }

    // Panelized Sheet Rendering
    const pw = panelDims.panelWidthMm;
    const ph = panelDims.panelHeightMm;
    const sheetX = -pw / 2;
    const sheetY = -ph / 2;
    const matrixW = panelDims.cols * widthMm + Math.max(0, panelDims.cols - 1) * panelDims.gapMm;
    const matrixH = panelDims.rows * heightMm + Math.max(0, panelDims.rows - 1) * panelDims.gapMm;

    // 1. Panel substrate / rails
    ctx.fillStyle = theme.boardBg;
    ctx.fillRect(sheetX, sheetY, pw, ph);

    // 2. If Tab-Routed (gapMm > 0), cut dark milled routing channels inside active matrix area & add breakaway tabs
    if (panelDims.gapMm > 0 && (panelDims.cols > 1 || panelDims.rows > 1)) {
      ctx.fillStyle = '#0F172A';
      for (let c = 0; c < panelDims.cols - 1; c++) {
        const gx = -matrixW / 2 + c * (widthMm + panelDims.gapMm) + widthMm;
        ctx.fillRect(gx, -matrixH / 2, panelDims.gapMm, matrixH);
      }
      for (let r = 0; r < panelDims.rows - 1; r++) {
        const gy = -matrixH / 2 + r * (heightMm + panelDims.gapMm) + heightMm;
        ctx.fillRect(-matrixW / 2, gy, matrixW, panelDims.gapMm);
      }

      // Breakaway bridge tabs
      ctx.fillStyle = theme.boardBg;
      const tabLen = Math.min(4.2, heightMm * 0.28);
      for (let r = 0; r < panelDims.rows; r++) {
        const cy = -matrixH / 2 + r * (heightMm + panelDims.gapMm) + heightMm / 2;
        for (let c = 0; c < panelDims.cols - 1; c++) {
          const gx = -matrixW / 2 + c * (widthMm + panelDims.gapMm) + widthMm;
          ctx.fillRect(gx - 0.1, cy - tabLen / 2, panelDims.gapMm + 0.2, tabLen);
        }
      }
      const tabW = Math.min(4.2, widthMm * 0.28);
      for (let r = 0; r < panelDims.rows - 1; r++) {
        const gy = -matrixH / 2 + r * (heightMm + panelDims.gapMm) + heightMm;
        for (let c = 0; c < panelDims.cols; c++) {
          const cx = -matrixW / 2 + c * (widthMm + panelDims.gapMm) + widthMm / 2;
          ctx.fillRect(cx - tabW / 2, gy - 0.1, tabW, panelDims.gapMm + 0.2);
        }
      }
    }

    // 3. Stamp cached PCB tile across cols × rows
    for (let r = 0; r < panelDims.rows; r++) {
      for (let c = 0; c < panelDims.cols; c++) {
        const ox = -matrixW / 2 + c * (widthMm + panelDims.gapMm);
        const oy = -matrixH / 2 + r * (heightMm + panelDims.gapMm);
        if (tileCanvas) {
          ctx.save();
          ctx.translate(ox, oy + heightMm);
          ctx.scale(1, -1);
          ctx.drawImage(tileCanvas, 0, 0, widthMm, heightMm);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = Math.max(0.2, 0.9 / scale);
        ctx.strokeRect(ox, oy, widthMm, heightMm);
      }
    }

    // 4. V-Cut Score Lines (when gapMm === 0)
    if (panelDims.gapMm === 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.lineWidth = Math.max(0.22, 1 / scale);
      ctx.setLineDash([Math.max(1.5, 4 / scale), Math.max(1.0, 3 / scale)]);
      for (let c = 0; c <= panelDims.cols; c++) {
        if ((c === 0 || c === panelDims.cols) && panelDims.railLeftRightMm === 0) continue;
        const x = -matrixW / 2 + c * widthMm;
        ctx.beginPath();
        ctx.moveTo(x, sheetY);
        ctx.lineTo(x, sheetY + ph);
        ctx.stroke();
      }
      for (let r = 0; r <= panelDims.rows; r++) {
        if ((r === 0 || r === panelDims.rows) && panelDims.railTopBottomMm === 0) continue;
        const y = -matrixH / 2 + r * heightMm;
        ctx.beginPath();
        ctx.moveTo(sheetX, y);
        ctx.lineTo(sheetX + pw, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 5. Rail Tooling Holes & Fiducials when Edge Rails are active
    if (panelDims.railLeftRightMm > 0 || panelDims.railTopBottomMm > 0) {
      const insetX =
        panelDims.railLeftRightMm > 0 ? pw / 2 - panelDims.railLeftRightMm / 2 : pw / 2 - 3.5;
      const insetY =
        ph / 2 - (panelDims.railTopBottomMm > 0 ? panelDims.railTopBottomMm / 2 : 4.5);
      const railPts: Array<[number, number]> = [
        [-insetX, -insetY],
        [insetX, -insetY],
        [-insetX, insetY],
        [insetX, insetY],
      ];
      const padColor = finish === 'ENIG' ? '#E3BA59' : '#D5DCE3';
      for (const [rx, ry] of railPts) {
        ctx.fillStyle = padColor;
        ctx.beginPath();
        ctx.arc(rx, ry, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(rx, ry, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. Outer Panel Border
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = Math.max(0.3, 1.4 / scale);
    ctx.strokeRect(sheetX, sheetY, pw, ph);

    ctx.restore();
  }, [
    board,
    finish,
    pan,
    panelDims,
    showCopper,
    showDrill,
    showMask,
    showSilk,
    showStencil,
    side,
    theme,
    tileCanvas,
    zoom,
  ]);

  useEffect(() => {
    renderCanvas();
    const onResize = () => renderCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderCanvas]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between text-xs gap-2">
        <span className="font-semibold text-white">
          {side === 'top' ? 'الوجه العلوي (Top View)' : 'الوجه السفلي (Bottom View · معكوس)'}
          {panelDims.isPanel ? ` · بانل ${panelDims.cols}×${panelDims.rows}` : ''}
        </span>
        <span className="font-mono-tech text-slate-400 tabular-nums">
          {panelDims.isPanel
            ? `Panel ${panelDims.panelWidthMm} × ${panelDims.panelHeightMm} mm`
            : `${board.widthMm} × ${board.heightMm} mm`}
        </span>
      </div>
      <div className="relative w-full h-[270px] sm:h-[320px] select-none cursor-grab active:cursor-grabbing">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
            dragRef.current = {
              active: true,
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
          }}
          onPointerMove={(e) => {
            if (!dragRef.current.active) return;
            setPan({
              x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
              y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
            });
          }}
          onPointerUp={() => {
            dragRef.current.active = false;
          }}
          onPointerCancel={() => {
            dragRef.current.active = false;
          }}
        />
      </div>
    </div>
  );
}

function PcbStencil2DCanvas({
  side,
  board,
  zoom,
  showBoardUnderneath,
  theme,
  panel,
}: {
  side: 'top' | 'bottom';
  board: ParsedBoard;
  zoom: number;
  showBoardUnderneath: boolean;
  theme: MaskTheme;
  panel?: PcbPanelConfig;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const stencilData = useMemo(() => getStencilCommandsForSide(board, side), [board, side]);
  const panelDims = useMemo(
    () => computePanelDimensionsMm(board.widthMm, board.heightMm, panel),
    [board.widthMm, board.heightMm, panel]
  );

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [board.archiveName, zoom, panelDims.cols, panelDims.rows, panelDims.isPanel]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(rect.width, 300);
    const cssH = Math.max(rect.height, 260);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark workshop table background
    ctx.fillStyle = '#090F1C';
    ctx.fillRect(0, 0, cssW, cssH);

    const marginMm = 14;
    const { bounds, widthMm, heightMm, layers } = board;
    const targetW = panelDims.panelWidthMm;
    const targetH = panelDims.panelHeightMm;
    const totalW = targetW + marginMm * 2;
    const totalH = targetH + marginMm * 2;
    const padding = 24;
    const baseScale = Math.min(
      (cssW - padding * 2) / Math.max(totalW, 1),
      (cssH - padding * 2) / Math.max(totalH, 1)
    );
    const scale = baseScale * zoom;

    ctx.translate(cssW / 2 + pan.x, cssH / 2 + pan.y);
    ctx.scale(side === 'bottom' ? -scale : scale, -scale);

    const sheetX = -totalW / 2;
    const sheetY = -totalH / 2;
    const panelLeft = -targetW / 2;
    const panelBottom = -targetH / 2;

    // 1. Stainless Steel Sheet with brushed metallic gradient
    const steelGrad = ctx.createLinearGradient(
      sheetX,
      sheetY,
      sheetX + totalW,
      sheetY + totalH
    );
    steelGrad.addColorStop(0, '#9BA6B2');
    steelGrad.addColorStop(0.45, '#CFD8E0');
    steelGrad.addColorStop(1, '#8F9BA8');
    ctx.fillStyle = steelGrad;
    ctx.fillRect(sheetX, sheetY, totalW, totalH);

    // Outer frame border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = Math.max(0.6, 2 / scale);
    ctx.strokeRect(sheetX, sheetY, totalW, totalH);

    // 2. Corner Fiducial Crosshairs on Stencil margin
    const fidPts = [
      [panelLeft - 6, panelBottom - 6],
      [panelLeft + targetW + 6, panelBottom - 6],
      [panelLeft - 6, panelBottom + targetH + 6],
      [panelLeft + targetW + 6, panelBottom + targetH + 6],
    ];
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = Math.max(0.2, 0.8 / scale);
    for (const [fx, fy] of fidPts) {
      ctx.beginPath();
      ctx.arc(fx, fy, 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx - 2.4, fy);
      ctx.lineTo(fx + 2.4, fy);
      ctx.moveTo(fx, fy - 2.4);
      ctx.lineTo(fx, fy + 2.4);
      ctx.stroke();
    }

    // 3. Outer Panel / PCB Outline Boundary
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = Math.max(0.25, 1.1 / scale);
    ctx.setLineDash([2, 1.5]);
    ctx.strokeRect(panelLeft, panelBottom, targetW, targetH);

    const matrixW = panelDims.cols * widthMm + Math.max(0, panelDims.cols - 1) * panelDims.gapMm;
    const matrixH = panelDims.rows * heightMm + Math.max(0, panelDims.rows - 1) * panelDims.gapMm;

    // 4. Tiled Laser-Cut SMD Apertures across all cols × rows boards
    const apertureFill = showBoardUnderneath ? theme.boardBg : '#090F1C';
    const copperLayers = showBoardUnderneath
      ? layers.filter((l) => l.kind === (side === 'top' ? 'topCopper' : 'bottomCopper'))
      : [];

    for (let r = 0; r < panelDims.rows; r++) {
      for (let c = 0; c < panelDims.cols; c++) {
        const ox = -matrixW / 2 + c * (widthMm + panelDims.gapMm);
        const oy = -matrixH / 2 + r * (heightMm + panelDims.gapMm);

        if (panelDims.isPanel) {
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
          ctx.lineWidth = Math.max(0.2, 0.8 / scale);
          ctx.strokeRect(ox, oy, widthMm, heightMm);
        }

        ctx.save();
        ctx.translate(ox - bounds.minX, oy - bounds.minY);
        drawCommands(ctx, stencilData.commands, apertureFill, '#CFD8E0');

        if (showBoardUnderneath) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          for (const l of copperLayers) {
            const flashes = l.commands.filter((cmd) => cmd.kind === 'flash');
            drawCommands(ctx, flashes, '#E5BC5E', theme.boardBg);
          }
          ctx.restore();
        }

        // Crisp etched rim around each stencil aperture
        ctx.strokeStyle = showBoardUnderneath ? '#38BDF8' : '#1E293B';
        ctx.lineWidth = Math.max(0.12, 0.6 / scale);
        for (const cmd of stencilData.commands) {
          if (cmd.kind !== 'flash' || cmd.polarity === 'clear') continue;
          const { shape, width, height } = cmd.aperture;
          if (shape === 'R') {
            ctx.strokeRect(cmd.x - width / 2, cmd.y - height / 2, width, height);
          } else if (shape === 'O') {
            const rx = width / 2;
            const ry = height / 2;
            ctx.beginPath();
            ctx.roundRect(cmd.x - rx, cmd.y - ry, width, height, Math.min(rx, ry));
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(cmd.x, cmd.y, width / 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    ctx.setLineDash([]);

    ctx.restore();
  }, [board, pan, panelDims, showBoardUnderneath, side, stencilData.commands, theme.boardBg, zoom]);

  useEffect(() => {
    renderCanvas();
    const onResize = () => renderCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderCanvas]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 bg-slate-800/80 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">
            {side === 'top' ? 'استنسل علوي (Top Stencil)' : 'استنسل سفلي (Bottom Stencil)'}
            {panelDims.isPanel ? ` · بانل ${panelDims.cols}×${panelDims.rows}` : ''}
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-mono-tech tabular-nums">
            {stencilData.commands.length * panelDims.boardsPerPanel} فتحة SMD
          </span>
        </div>
        <span className="font-mono-tech text-slate-400 tabular-nums">
          {stencilData.isExplicit ? 'من ملف Paste (.GTP/.GBP)' : 'مستخرج تلقائياً من SMD Pads'}
        </span>
      </div>
      <div className="relative w-full h-[270px] sm:h-[320px] select-none cursor-grab active:cursor-grabbing">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
            dragRef.current = {
              active: true,
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
          }}
          onPointerMove={(e) => {
            if (!dragRef.current.active) return;
            setPan({
              x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
              y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
            });
          }}
          onPointerUp={() => {
            dragRef.current.active = false;
          }}
          onPointerCancel={() => {
            dragRef.current.active = false;
          }}
        />
      </div>
    </div>
  );
}

function FreeNumericInput({
  id,
  value,
  onChangeValue,
  min,
  max,
  placeholder,
  className = '',
}: {
  id?: string;
  value: number | null;
  onChangeValue: (next: number | null) => void;
  min: number;
  max: number;
  placeholder?: string;
  className?: string;
}) {
  const formatVal = (v: number | null) =>
    v !== null && Number.isFinite(v) ? String(v) : '';

  const [text, setText] = useState(() => formatVal(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatVal(value));
    }
  }, [value, focused]);

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      dir="ltr"
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^[0-9]*$/.test(raw)) return;
        setText(raw);
        if (raw === '') {
          onChangeValue(null);
          return;
        }
        const num = Math.round(Number(raw));
        if (Number.isFinite(num) && num >= min && num <= max) {
          onChangeValue(num);
        }
      }}
      onBlur={() => {
        setFocused(false);
        if (text === '') {
          onChangeValue(null);
          return;
        }
        const parsed = Math.round(Number(text));
        const clamped = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
        setText(String(clamped));
        onChangeValue(clamped);
      }}
      className={className}
    />
  );
}

function PanelBlueprintPreview({
  boardWidthMm,
  boardHeightMm,
  cols,
  rows,
  railMode,
  breakout,
  maskColor,
}: {
  boardWidthMm: number;
  boardHeightMm: number;
  cols: number;
  rows: number;
  railMode: PanelRailMode;
  breakout: 'vcut' | 'tab';
  maskColor: string;
}) {
  const dims = computePanelDimensionsMm(boardWidthMm, boardHeightMm, {
    enabled: true,
    cols,
    rows,
    railMode,
    railWidthMm: 5,
    gapMm: breakout === 'tab' ? 2 : 0,
  });

  const vbW = Math.max(dims.panelWidthMm, 10);
  const vbH = Math.max(dims.panelHeightMm, 10);
  const pad = Math.max(vbW, vbH) * 0.08;
  const viewBox = `${-pad} ${-pad} ${vbW + pad * 2} ${vbH + pad * 2}`;
  const strokeW = Math.max(0.35, Math.max(vbW, vbH) * 0.005);

  return (
    <div className="bg-[#0B1120] border border-slate-700 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center justify-center bg-[#0F172A] border border-slate-800 rounded-md p-2.5 w-full sm:w-44 h-28 shrink-0">
        <svg viewBox={viewBox} className="w-full h-full" aria-label="مخطط البانل">
          {/* Outer Panel Substrate */}
          <rect
            x={0}
            y={0}
            width={dims.panelWidthMm}
            height={dims.panelHeightMm}
            fill={maskColor}
            stroke="#CBD5E1"
            strokeWidth={strokeW}
            rx={strokeW * 0.5}
          />
          {/* Individual Boards */}
          {Array.from({ length: Math.min(dims.rows, 12) }).map((_, r) =>
            Array.from({ length: Math.min(dims.cols, 12) }).map((__, c) => {
              const bx = dims.railLeftRightMm + c * (boardWidthMm + dims.gapMm);
              const by = dims.railTopBottomMm + r * (boardHeightMm + dims.gapMm);
              return (
                <rect
                  key={`${r}-${c}`}
                  x={bx}
                  y={by}
                  width={boardWidthMm}
                  height={boardHeightMm}
                  fill="rgba(255,255,255,0.08)"
                  stroke={breakout === 'vcut' ? '#38BDF8' : '#E2E8F0'}
                  strokeWidth={strokeW * 0.75}
                  strokeDasharray={breakout === 'vcut' ? `${strokeW * 3} ${strokeW * 2}` : undefined}
                />
              );
            })
          )}
          {/* Rail Tooling Holes */}
          {(dims.railLeftRightMm > 0 || dims.railTopBottomMm > 0) &&
            [
              [dims.railLeftRightMm > 0 ? dims.railLeftRightMm / 2 : 3, dims.railTopBottomMm > 0 ? dims.railTopBottomMm / 2 : 4],
              [
                dims.panelWidthMm - (dims.railLeftRightMm > 0 ? dims.railLeftRightMm / 2 : 3),
                dims.railTopBottomMm > 0 ? dims.railTopBottomMm / 2 : 4,
              ],
              [
                dims.railLeftRightMm > 0 ? dims.railLeftRightMm / 2 : 3,
                dims.panelHeightMm - (dims.railTopBottomMm > 0 ? dims.railTopBottomMm / 2 : 4),
              ],
              [
                dims.panelWidthMm - (dims.railLeftRightMm > 0 ? dims.railLeftRightMm / 2 : 3),
                dims.panelHeightMm - (dims.railTopBottomMm > 0 ? dims.railTopBottomMm / 2 : 4),
              ],
            ].map(([cx, cy], idx) => (
              <circle
                key={idx}
                cx={cx}
                cy={cy}
                r={Math.max(1.1, strokeW * 1.6)}
                fill="#0F172A"
                stroke="#E5BC5E"
                strokeWidth={strokeW * 0.65}
              />
            ))}
        </svg>
      </div>
      <div className="flex-1 text-xs text-slate-300 space-y-1.5 tabular-nums">
        <div className="font-semibold text-white">
          مخطط البانل ({dims.cols} × {dims.rows} = {dims.boardsPerPanel} بوردة في البانل)
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
          <span>
            مقاس البانل:{' '}
            <strong className="font-mono-tech text-sky-300">
              {dims.panelWidthMm} × {dims.panelHeightMm} mm
            </strong>
          </span>
          <span>
            البوردة الواحدة:{' '}
            <strong className="font-mono-tech text-white">
              {boardWidthMm} × {boardHeightMm} mm
            </strong>
          </span>
        </div>
        <div className="text-[11px] text-slate-400">
          {breakout === 'vcut' ? 'تقطيع V-Cut (0 mm فاصل)' : 'تبويب Tab-Routing (2 mm فاصل)'} ·{' '}
          {railMode === 'none'
            ? 'بدون حواف تثبيت'
            : railMode === '2sides'
              ? 'حواف تثبيت جانبين (5mm)'
              : 'حواف تثبيت 4 جوانب (5mm)'}
        </div>
      </div>
    </div>
  );
}

export function GerberViewer({ pricing, onUseForQuote }: GerberViewerProps) {
  const minQty = Math.max(1, pricing?.minQuantity ?? DEFAULT_PCB_PRICING.minQuantity);
  const currency = pricing?.currency || DEFAULT_PCB_PRICING.currency;

  const [board, setBoard] = useState<ParsedBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [maskTheme, setMaskTheme] = useState<MaskTheme>(MASK_THEMES[0]);
  const [finish, setFinish] = useState<FinishType>('HASL');
  const [zoom, setZoom] = useState(1);

  // Quantity & Manual Calculator Parameters (empty by default until user enters values or uploads Gerber)
  const [quantity, setQuantity] = useState<number | null>(null);
  const [manualWidthMm, setManualWidthMm] = useState<number | null>(null);
  const [manualHeightMm, setManualHeightMm] = useState<number | null>(null);
  const [manualLayers, setManualLayers] = useState<1 | 2 | 4>(2);
  const [thicknessMm, setThicknessMm] = useState<1.0 | 1.6 | 2.0>(1.6);

  // Panelization (JLCPCB-style Delivery Format: Single PCB vs Panel cols x rows)
  const [deliveryFormat, setDeliveryFormat] = useState<'single' | 'panel'>('single');
  const [panelCols, setPanelCols] = useState<number | null>(null);
  const [panelRows, setPanelRows] = useState<number | null>(null);
  const [panelRailMode, setPanelRailMode] = useState<PanelRailMode>('2sides');
  const [panelBreakout, setPanelBreakout] = useState<'vcut' | 'tab'>('vcut');

  const [showCopper, setShowCopper] = useState(true);
  const [showMask, setShowMask] = useState(true);
  const [showSilk, setShowSilk] = useState(true);
  const [showDrill, setShowDrill] = useState(true);
  const [showStencil, setShowStencil] = useState(false);
  const [stencilBoardUnderlay, setStencilBoardUnderlay] = useState(true);
  const [includeStencil, setIncludeStencil] = useState(false);
  const [showFilesList, setShowFilesList] = useState(false);
  const [fullscreen3D, setFullscreen3D] = useState(false);

  const activeWidthMm = board ? board.widthMm : manualWidthMm;
  const activeHeightMm = board ? board.heightMm : manualHeightMm;
  const activeLayers = board ? board.layerCount : manualLayers;
  const effectiveQty = quantity !== null && quantity >= minQty ? quantity : null;
  const hasPanelLayout = Boolean(panelCols && panelCols >= 1 && panelRows && panelRows >= 1);

  const activePanelConfig: PcbPanelConfig | undefined = useMemo(() => {
    if (deliveryFormat !== 'panel' || !panelCols || panelCols < 1 || !panelRows || panelRows < 1) {
      return undefined;
    }
    return {
      enabled: true,
      cols: panelCols,
      rows: panelRows,
      railMode: panelRailMode,
      railWidthMm: 5,
      gapMm: panelBreakout === 'tab' ? 2 : 0,
    };
  }, [deliveryFormat, panelBreakout, panelCols, panelRailMode, panelRows]);

  const hasCompleteSpec = Boolean(
    activeWidthMm &&
      activeWidthMm > 0 &&
      activeHeightMm &&
      activeHeightMm > 0 &&
      effectiveQty !== null &&
      (deliveryFormat === 'single' || hasPanelLayout)
  );

  const estimate = useMemo(() => {
    if (!hasCompleteSpec || activeWidthMm === null || activeHeightMm === null || effectiveQty === null) {
      return null;
    }
    return calculatePcbEstimate(
      {
        widthMm: activeWidthMm,
        heightMm: activeHeightMm,
        layers: activeLayers,
        quantity: effectiveQty,
        finish,
        maskColorId: maskTheme.id,
        thicknessMm,
        includeStencil,
        panel: activePanelConfig,
      },
      pricing
    );
  }, [
    hasCompleteSpec,
    activeWidthMm,
    activeHeightMm,
    activeLayers,
    effectiveQty,
    finish,
    maskTheme.id,
    thicknessMm,
    includeStencil,
    activePanelConfig,
    pricing,
  ]);

  const presetQuantities = useMemo(() => {
    const base = [minQty, 10, 20, 50, 100];
    return Array.from(new Set(base.filter((n) => n >= minQty))).sort((a, b) => a - b);
  }, [minQty]);

  useEffect(() => {
    if (!fullscreen3D) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen3D(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen3D]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError('');
    setLoading(true);
    try {
      const files = Array.from(fileList);
      const parsed = await parseGerberInputFiles(files);
      if (parsed.layers.length === 0) {
        setError(
          'لم يتم التعرف على طبقات Gerber صالحة داخل الملف. تأكد أن الملف مضغوط بصيغة ZIP ويحتوي على ملفات (.GTL, .GBL, .GTS, .GBS, .GTP, .GTO, .GKO, .DRL).'
        );
        return;
      }
      setBoard(parsed);
      setQuantity((q) => (q !== null && q >= minQty ? q : minQty));
      setZoom(1);
      setShowFilesList(false);
    } catch {
      setError('تعذر قراءة ملف الـ Gerber. تأكد أنه ملف ZIP سليم أو ملفات Gerber قياسية.');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const stencilFeeAmount = pricing?.stencilFee ?? DEFAULT_PCB_PRICING.stencilFee;

  const handleQuoteFromBoard = () => {
    if (!estimate || activeWidthMm === null || activeHeightMm === null || effectiveQty === null) {
      return;
    }

    const railLabel =
      panelRailMode === 'none'
        ? 'بدون حواف'
        : panelRailMode === '2sides'
          ? 'حواف جانبين 5mm'
          : 'حواف 4 جوانب 5mm';
    const breakoutLabel = panelBreakout === 'tab' ? 'Tab-Routing (2mm)' : 'V-Cut (0mm)';

    const panelLines = estimate.isPanel
      ? [
          `- طريقة التسليم: بانل (Panel ${estimate.panelCols}×${estimate.panelRows} = ${estimate.boardsPerPanel} بوردة/بانل)`,
          `- مواصفات البانل: ${breakoutLabel} · ${railLabel}`,
          `- مقاس البانل الواحد: ${estimate.panelWidthMm} × ${estimate.panelHeightMm} mm (${estimate.areaCm2} cm²)`,
          `- العدد المطلوب: ${effectiveQty} بانل (إجمالي ${estimate.totalBoardsCount} بوردة منفردة)`,
          `- التكلفة التقديرية بالحاسبة: ${estimate.totalPrice.toLocaleString('en-US')} ${estimate.currency} (${estimate.unitPrice.toLocaleString('en-US')} ${estimate.currency}/بانل · ${estimate.singleBoardPrice.toLocaleString('en-US')} ${estimate.currency}/بوردة)`,
        ]
      : [
          `- طريقة التسليم: بوردة منفردة (Single PCB)`,
          `- العدد المطلوب: ${effectiveQty} بوردة`,
          `- التكلفة التقديرية بالحاسبة: ${estimate.totalPrice.toLocaleString('en-US')} ${estimate.currency} (${estimate.unitPrice.toLocaleString('en-US')} ${estimate.currency}/بوردة)`,
        ];

    if (board) {
      const lines = [
        `طلب تصنيع PCB من ملفات Gerber:`,
        `- اسم الملف: ${board.archiveName}`,
        `- مقاس البوردة المكتشف: ${board.widthMm} × ${board.heightMm} mm`,
        `- عدد الطبقات: ${board.layerCount} Layer`,
        `- السُمك: ${thicknessMm} mm`,
        `- لون الـ Solder Mask: ${maskTheme.label}`,
        `- نوع التشطيب: ${finish}`,
        `- عدد الثقوب (Drill): ${board.drillCount}`,
        `- استنسل لحام (SMD Stencil): ${includeStencil ? 'نعم (مطلوب)' : 'لا'}`,
        ...panelLines,
      ];
      onUseForQuote(lines.join('\n'), effectiveQty);
      return;
    }

    const lines = [
      `طلب تصنيع PCB (من حاسبة الأسعار):`,
      `- مقاس البوردة المفردة: ${activeWidthMm} × ${activeHeightMm} mm`,
      `- عدد الطبقات: ${activeLayers} Layer`,
      `- السُمك: ${thicknessMm} mm`,
      `- لون الـ Solder Mask: ${maskTheme.label}`,
      `- نوع التشطيب: ${finish}`,
      `- استنسل لحام (SMD Stencil): ${includeStencil ? 'نعم (مطلوب)' : 'لا'}`,
      ...panelLines,
    ];
    onUseForQuote(lines.join('\n'), effectiveQty);
  };

  return (
    <div className="bg-white border border-[#E5E3DC] rounded-xl overflow-hidden shadow-xs">
      {/* Header & Upload Trigger */}
      <div className="p-6 sm:p-8 border-b border-[#E5E3DC] flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-[#071A2B] mb-1.5">
            معاينة ملفات Gerber وحاسبة تكلفة تصنيع اللوحات
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
            ارفع ملف الـ Gerber المضغوط (.zip) لمعاينة البوردة 2D و 3D، أو استخدم الحاسبة لتحديد المقاس وعدد البوردات وحساب السعر التقديري فوراً.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <label className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] rounded-lg cursor-pointer transition-colors whitespace-nowrap">
            <Upload className="w-4 h-4" />
            <span>{loading ? 'جاري التحليل...' : board ? 'رفع ملف Gerber آخر' : 'رفع ملف Gerber (.zip)'}</span>
            <input
              type="file"
              multiple
              accept=".zip,.gbr,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gko,.gm1,.gml,.drl,.xln,.txt"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {board && (
            <>
              <button
                type="button"
                onClick={() => setFullscreen3D(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
              >
                <Box className="w-4 h-4 text-sky-700" />
                <span>فتح التصميم 3D</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBoard(null);
                  setQuantity(null);
                  setManualWidthMm(null);
                  setManualHeightMm(null);
                  setDeliveryFormat('single');
                  setPanelCols(null);
                  setPanelRows(null);
                  setIncludeStencil(false);
                  setShowStencil(false);
                  setFullscreen3D(false);
                  setShowFilesList(false);
                  setError('');
                  setZoom(1);
                }}
                aria-label="مسح الملف الحالي"
                title="مسح الملف الحالي"
                className="inline-flex items-center gap-1 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-red-600 bg-slate-50 hover:bg-red-50 border border-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
              >
                <X className="w-4 h-4" />
                <span>مسح</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mx-5 sm:mx-7 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Empty State: Gerber Drop Zone + Direct PCB Price Calculator */}
      {!board ? (
        <div>
          <div className="p-5 sm:p-7">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors ${
                dragActive
                  ? 'border-[#1D5F8A] bg-sky-50/70'
                  : 'border-[#D9D5CA] bg-[#FAF9F5]/70 hover:border-slate-400'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-white border border-[#E5E3DC] flex items-center justify-center mx-auto mb-3 shadow-xs">
                <FileArchive className="w-6 h-6 text-[#1D5F8A]" />
              </div>
              <div className="text-sm sm:text-base font-bold text-[#071A2B] mb-1">
                اسحب ملف الـ Gerber (.zip) هنا أو اضغط للرفع
              </div>
              <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto mb-4 leading-relaxed">
                يدعم ملفات ZIP الكاملة أو ملفات الطبقات القياسية (GTL, GBL, GTS, GBS, GTO, GKO, DRL) لقراءة المقاس تلقائياً ومعاينة 2D و 3D.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <label className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] rounded-lg cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  <span>{loading ? 'جاري قراءة الملف...' : 'اختيار ملف Gerber من جهازك'}</span>
                  <input
                    type="file"
                    multiple
                    accept=".zip,.gbr,.gtl,.gbl,.gts,.gbs,.gtp,.gbp,.gto,.gbo,.gko,.gm1,.gml,.drl,.xln,.txt"
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      handleFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setBoard(createSampleGerberBoard());
                    setShowStencil(true);
                    setQuantity((q) => (q !== null && q >= minQty ? q : minQty));
                    setZoom(1);
                    setError('');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#071A2B] bg-white hover:bg-[#F4EFE1] border border-[#D9D5CA] rounded-lg cursor-pointer transition-colors"
                >
                  <Box className="w-4 h-4 text-[#1D5F8A]" />
                  <span>معاينة نموذج PCB + استنسل (2D / 3D)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Instant PCB Price Calculator (Available even without Gerber file) */}
          <div className="border-t border-[#E5E3DC] bg-[#FAF9F5] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#071A2B] text-[#F4EFE1] flex items-center justify-center shrink-0">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-[#071A2B]">
                    حاسبة سعر تصنيع اللوحات (مبدئية)
                  </h4>
                  <p className="text-xs text-slate-500">
                    أدخل مقاس البوردة وعدد البوردات المطلوب لمعرفة التكلفة التقديرية فوراً
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Calculator Controls */}
              <div className="lg:col-span-8 bg-white border border-[#E5E3DC] rounded-xl p-5 space-y-5">
                {/* Delivery Format Toggle (JLCPCB-style Single PCB vs Panel) */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EFECE3]">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-[#1D5F8A]" />
                    <span className="text-xs sm:text-sm font-bold text-[#071A2B]">
                      طريقة التسليم (Delivery Format):
                    </span>
                  </div>
                  <div className="inline-flex p-1 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg">
                    <button
                      type="button"
                      onClick={() => setDeliveryFormat('single')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                        deliveryFormat === 'single'
                          ? 'bg-white text-[#071A2B] shadow-xs'
                          : 'text-slate-600 hover:text-[#071A2B]'
                      }`}
                    >
                      بوردة منفردة (Single PCB)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryFormat('panel')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                        deliveryFormat === 'panel'
                          ? 'bg-[#071A2B] text-[#F4EFE1] shadow-xs'
                          : 'text-slate-600 hover:text-[#071A2B]'
                      }`}
                    >
                      بانل مصفوفة (Panel · مثل 2×4)
                    </button>
                  </div>
                </div>

                {/* Panelization Matrix Controls (when Delivery Format = Panel) */}
                {deliveryFormat === 'panel' && (
                  <div className="bg-[#FAF9F5] border border-[#E5E3DC] rounded-xl p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                      <div>
                        <div className="text-xs font-semibold text-[#071A2B] mb-1.5">
                          توزيع البانل (أعمدة × صفوف)
                        </div>
                        <div className="flex items-center gap-2">
                          <FreeNumericInput
                            id="panel-cols-manual"
                            min={1}
                            max={20}
                            placeholder="مثال: 2"
                            value={panelCols}
                            onChangeValue={setPanelCols}
                            className="w-24 px-3 py-2 text-sm text-center font-mono-tech font-bold tabular-nums placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 bg-white border border-[#D9D5CA] rounded-lg focus:outline-none focus:border-[#1D5F8A]"
                          />
                          <span className="font-mono-tech font-bold text-slate-500">×</span>
                          <FreeNumericInput
                            id="panel-rows-manual"
                            min={1}
                            max={20}
                            placeholder="مثال: 4"
                            value={panelRows}
                            onChangeValue={setPanelRows}
                            className="w-24 px-3 py-2 text-sm text-center font-mono-tech font-bold tabular-nums placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 bg-white border border-[#D9D5CA] rounded-lg focus:outline-none focus:border-[#1D5F8A]"
                          />
                          {hasPanelLayout && (
                            <span className="text-xs font-semibold text-[#1D5F8A] whitespace-nowrap">
                              = {panelCols! * panelRows!} بوردة / بانل
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-600 mb-1.5">
                          اختيار سريع لتوزيع البانل:
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(
                            [
                              [2, 2],
                              [2, 4],
                              [3, 3],
                              [4, 5],
                            ] as const
                          ).map(([c, r]) => (
                            <button
                              key={`${c}x${r}`}
                              type="button"
                              onClick={() => {
                                setPanelCols(c);
                                setPanelRows(r);
                              }}
                              className={`px-2.5 py-1.5 text-xs font-mono-tech font-semibold rounded-md border cursor-pointer transition-colors ${
                                panelCols === c && panelRows === r
                                  ? 'bg-[#071A2B] text-[#F4EFE1] border-[#071A2B]'
                                  : 'bg-white text-slate-700 border-[#D9D5CA] hover:border-[#1D5F8A]'
                              }`}
                            >
                              {c}×{r}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[#E5E3DC]">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">طريقة الفصل</div>
                        <div className="inline-flex p-0.5 bg-white border border-[#D9D5CA] rounded-lg">
                          <button
                            type="button"
                            onClick={() => setPanelBreakout('vcut')}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                              panelBreakout === 'vcut'
                                ? 'bg-[#1D5F8A] text-white'
                                : 'text-slate-600 hover:text-[#071A2B]'
                            }`}
                          >
                            V-Cut (0mm)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPanelBreakout('tab')}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                              panelBreakout === 'tab'
                                ? 'bg-[#1D5F8A] text-white'
                                : 'text-slate-600 hover:text-[#071A2B]'
                            }`}
                          >
                            Tab-Route (2mm)
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">حواف التثبيت (Edge Rails)</div>
                        <div className="inline-flex p-0.5 bg-white border border-[#D9D5CA] rounded-lg">
                          {(
                            [
                              { id: 'none', label: 'بدون' },
                              { id: '2sides', label: 'جانبين 5mm' },
                              { id: '4sides', label: '4 جوانب 5mm' },
                            ] as const
                          ).map((rm) => (
                            <button
                              key={rm.id}
                              type="button"
                              onClick={() => setPanelRailMode(rm.id)}
                              className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                                panelRailMode === rm.id
                                  ? 'bg-[#1D5F8A] text-white'
                                  : 'text-slate-600 hover:text-[#071A2B]'
                              }`}
                            >
                              {rm.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {activeWidthMm && activeHeightMm && hasPanelLayout && (
                      <PanelBlueprintPreview
                        boardWidthMm={activeWidthMm}
                        boardHeightMm={activeHeightMm}
                        cols={panelCols!}
                        rows={panelRows!}
                        railMode={panelRailMode}
                        breakout={panelBreakout}
                        maskColor={maskTheme.boardBg}
                      />
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="pcb-w"
                      className="block text-xs font-semibold text-[#071A2B] mb-1.5"
                    >
                      عرض البوردة الواحدة (mm)
                    </label>
                    <FreeNumericInput
                      id="pcb-w"
                      min={10}
                      max={600}
                      placeholder="أدخل العرض"
                      value={manualWidthMm}
                      onChangeValue={setManualWidthMm}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums placeholder:font-sans placeholder:text-slate-400 bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="pcb-h"
                      className="block text-xs font-semibold text-[#071A2B] mb-1.5"
                    >
                      طول البوردة الواحدة (mm)
                    </label>
                    <FreeNumericInput
                      id="pcb-h"
                      min={10}
                      max={600}
                      placeholder="أدخل الطول"
                      value={manualHeightMm}
                      onChangeValue={setManualHeightMm}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums placeholder:font-sans placeholder:text-slate-400 bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="pcb-qty-manual"
                      className="block text-xs font-semibold text-[#071A2B] mb-1.5"
                    >
                      {deliveryFormat === 'panel'
                        ? `عدد البانلات (أقل كمية ${minQty})`
                        : `عدد البوردات (أقل كمية ${minQty})`}
                    </label>
                    <FreeNumericInput
                      id="pcb-qty-manual"
                      min={minQty}
                      max={10000}
                      placeholder="أدخل العدد"
                      value={quantity}
                      onChangeValue={setQuantity}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech font-bold tabular-nums placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                    />
                  </div>
                </div>

                {/* Quick Quantity Chips */}
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-2">
                    {deliveryFormat === 'panel'
                      ? 'اختيار سريع لعدد البانلات:'
                      : 'اختيار سريع لعدد البوردات:'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {presetQuantities.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuantity(q)}
                        className={`px-3 py-1.5 text-xs font-mono-tech font-semibold rounded-lg border transition-colors cursor-pointer ${
                          quantity === q
                            ? 'bg-[#071A2B] text-[#F4EFE1] border-[#071A2B]'
                            : 'bg-[#FAF9F5] text-slate-700 border-[#D9D5CA] hover:border-[#1D5F8A]'
                        }`}
                      >
                        {q} {deliveryFormat === 'panel' ? 'بانل' : 'بوردة'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layers, Thickness, Finish, Color */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-[#EFECE3]">
                  <div>
                    <div className="text-xs font-semibold text-[#071A2B] mb-1.5">عدد الطبقات</div>
                    <div className="inline-flex p-1 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg">
                      {([1, 2, 4] as const).map((ly) => (
                        <button
                          key={ly}
                          type="button"
                          onClick={() => setManualLayers(ly)}
                          className={`px-2.5 py-1 text-xs font-mono-tech font-semibold rounded-md cursor-pointer ${
                            manualLayers === ly
                              ? 'bg-white text-[#071A2B] shadow-xs'
                              : 'text-slate-600 hover:text-[#071A2B]'
                          }`}
                        >
                          {ly}L
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-[#071A2B] mb-1.5">سُمك البوردة</div>
                    <div className="inline-flex p-1 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg">
                      {([1.0, 1.6, 2.0] as const).map((th) => (
                        <button
                          key={th}
                          type="button"
                          onClick={() => setThicknessMm(th)}
                          className={`px-2 py-1 text-xs font-mono-tech font-semibold rounded-md cursor-pointer ${
                            thicknessMm === th
                              ? 'bg-white text-[#071A2B] shadow-xs'
                              : 'text-slate-600 hover:text-[#071A2B]'
                          }`}
                        >
                          {th}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-[#071A2B] mb-1.5">التشطيب</div>
                    <div className="inline-flex p-1 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg">
                      {(['HASL', 'ENIG'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFinish(f)}
                          className={`px-2.5 py-1 text-xs font-mono-tech font-semibold rounded-md cursor-pointer ${
                            finish === f
                              ? 'bg-white text-[#071A2B] shadow-xs'
                              : 'text-slate-600 hover:text-[#071A2B]'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-[#071A2B] mb-1.5">
                      لون الماسك ({maskTheme.label})
                    </div>
                    <div className="flex items-center gap-1.5 pt-1">
                      {MASK_THEMES.map((theme) => {
                        const active = maskTheme.id === theme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            title={theme.label}
                            aria-label={theme.label}
                            onClick={() => setMaskTheme(theme)}
                            style={{ backgroundColor: theme.swatch }}
                            className={`w-6 h-6 rounded-full border flex items-center justify-center cursor-pointer transition-transform ${
                              active
                                ? 'ring-2 ring-[#1D5F8A] ring-offset-1 scale-110 border-[#071A2B]'
                                : 'border-slate-300'
                            }`}
                          >
                            {active && (
                              <Check
                                className={`w-3.5 h-3.5 ${
                                  theme.id === 'white' ? 'text-slate-900' : 'text-white'
                                }`}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* SMD Stencil Option in Manual Calculator */}
                <div className="pt-2 border-t border-[#EFECE3] flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-[#071A2B] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStencil}
                      onChange={(e) => setIncludeStencil(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#1D5F8A]"
                    />
                    <span>إضافة استنسل لحام SMD (Laser Stainless Stencil)</span>
                    <span className="font-mono-tech text-xs text-[#1D5F8A]">
                      +{stencilFeeAmount.toLocaleString('en-US')} {currency}
                    </span>
                  </label>
                  {estimate?.isSmallBoardPromo && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                      مطبق عرض اللوحات الصغيرة (≤ 10×10 سم)
                    </span>
                  )}
                </div>
              </div>

              {/* Price Summary Output Card */}
              <div className="lg:col-span-4 bg-[#071A2B] text-[#F4EFE1] rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5">
                <div>
                  <div className="text-xs text-[#E7D8B9] font-semibold mb-1">
                    {estimate
                      ? estimate.isPanel
                        ? `التكلفة التقديرية لتصنيع ${effectiveQty} بانل (${estimate.totalBoardsCount} بوردة)`
                        : `التكلفة التقديرية لتصنيع ${effectiveQty} بوردة`
                      : 'التكلفة التقديرية للتصنيع'}
                  </div>
                  <div className="flex items-baseline gap-2 my-2">
                    <span className="font-mono-tech text-3xl sm:text-4xl font-bold text-white tabular-nums">
                      {estimate ? estimate.totalPrice.toLocaleString('en-US') : '—'}
                    </span>
                    {estimate && (
                      <span className="text-sm font-semibold text-[#E7D8B9]">
                        {estimate.currency}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-300 tabular-nums space-y-1.5 pt-3 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        {estimate?.isPanel ? 'سعر البانل الواحد:' : 'سعر البوردة الواحدة:'}
                      </span>
                      <span className="font-mono-tech font-semibold text-white">
                        {estimate ? `${estimate.unitPrice.toLocaleString('en-US')} ${estimate.currency}` : '—'}
                      </span>
                    </div>
                    {estimate?.isPanel && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">سعر البوردة داخل البانل:</span>
                        <span className="font-mono-tech font-semibold text-sky-300">
                          {estimate.singleBoardPrice.toLocaleString('en-US')} {estimate.currency}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">
                        {estimate?.isPanel
                          ? `مقاس البانل (${estimate.panelCols}×${estimate.panelRows}):`
                          : 'المقاس المحسوب:'}
                      </span>
                      <span className="font-mono-tech">
                        {estimate
                          ? `${estimate.panelWidthMm}×${estimate.panelHeightMm} mm (${estimate.areaCm2} cm²)`
                          : activeWidthMm && activeHeightMm && deliveryFormat === 'single'
                            ? `${activeWidthMm}×${activeHeightMm} mm (${((activeWidthMm * activeHeightMm) / 100).toFixed(2)} cm²)`
                            : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">مدة التنفيذ المتوقعة:</span>
                      <span>{estimate ? estimate.leadTime : '—'}</span>
                    </div>
                    {estimate && estimate.stencilCost > 0 && (
                      <div className="flex items-center justify-between text-sky-300">
                        <span>يشمل استنسل SMD:</span>
                        <span className="font-mono-tech font-semibold">
                          +{estimate.stencilCost.toLocaleString('en-US')} {estimate.currency}
                        </span>
                      </div>
                    )}
                    {estimate && estimate.discountPercent > 0 && (
                      <div className="flex items-center justify-between text-emerald-300">
                        <span>الخصم المطبق:</span>
                        <span className="font-mono-tech font-semibold">
                          -{estimate.discountPercent}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={!estimate}
                    onClick={handleQuoteFromBoard}
                    className="w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#2573A6] disabled:opacity-45 disabled:hover:bg-[#1D5F8A] disabled:cursor-not-allowed rounded-lg cursor-pointer transition-colors"
                  >
                    اعتماد المقاس والكمية وطلب تسعير
                  </button>
                  <p className="text-[11px] text-slate-400 leading-relaxed text-center">
                    {estimate
                      ? 'السعر استرشادي ويتم تأكيد السعر النهائي بعد مراجعة ملفات Gerber.'
                      : deliveryFormat === 'panel'
                        ? 'أدخل مقاس البوردة وتوزيع البانل (مثل 2×4) وعدد البانلات لتظهر القيم والتكلفة فوراً.'
                        : 'أدخل العرض والطول وعدد البوردات، أو ارفع ملف Gerber لتظهر القيم والتكلفة فوراً.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* File Metadata Strip (Drag & Drop still works) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`px-5 sm:px-7 py-3 border-b border-slate-200 transition-colors flex flex-wrap items-center justify-between gap-3 text-xs ${
              dragActive ? 'bg-sky-50 border-sky-300' : 'bg-slate-50/80'
            }`}
          >
            <div className="flex items-center gap-2 text-slate-600">
              <FileArchive className="w-4 h-4 text-sky-700 shrink-0" />
              <span>
                الملف الحالي:{' '}
                <strong className="font-mono-tech text-slate-900" dir="ltr">
                  {board.archiveName}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-slate-700 tabular-nums">
              <span>
                المقاس:{' '}
                <strong className="font-mono-tech text-slate-900">
                  {activePanelConfig
                    ? (() => {
                        const pd = computePanelDimensionsMm(
                          board.widthMm,
                          board.heightMm,
                          activePanelConfig
                        );
                        return `بانل ${activePanelConfig.cols}×${activePanelConfig.rows}: ${pd.panelWidthMm} × ${pd.panelHeightMm} mm (البوردة ${board.widthMm}×${board.heightMm})`;
                      })()
                    : `${board.widthMm} × ${board.heightMm} mm`}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                الطبقات:{' '}
                <strong className="font-mono-tech text-slate-900">{board.layerCount} Layer</strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                الثقوب: <strong className="font-mono-tech text-slate-900">{board.drillCount}</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowFilesList((v) => !v)}
                className="text-sky-700 hover:text-sky-800 font-semibold cursor-pointer"
              >
                {showFilesList ? 'إخفاء الطبقات' : `الطبقات المكتشفة (${board.detectedFiles.length})`}
              </button>
            </div>
          </div>

          {showFilesList && (
            <div className="px-5 sm:px-7 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              {board.detectedFiles.map((f, i) => (
                <div
                  key={`${f.filename}-${i}`}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-col"
                >
                  <span className="font-mono-tech text-slate-900 truncate" dir="ltr">
                    {f.filename}
                  </span>
                  <span className="text-slate-500 mt-0.5">{LAYER_LABELS[f.kind]}</span>
                </div>
              ))}
            </div>
          )}

      {/* Toolbar: View Mode + Colors + Finish + Layer Toggles + Zoom */}
      <div className="p-4 sm:px-7 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-white">
        {/* View Mode Segmented Switch */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap items-center p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'both', label: 'Top + Bottom' },
                { id: 'top', label: 'Top فقط' },
                { id: 'bottom', label: 'Bottom فقط' },
                { id: 'stencil', label: 'الاستنسل 2D' },
                { id: '3d', label: 'عرض 3D + استنسل' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setViewMode(opt.id);
                  if (opt.id === 'stencil') {
                    setShowStencil(true);
                  }
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Solder Mask Color Swatches */}
          <div className="flex items-center gap-1.5" role="group" aria-label="لون السولدر ماسك">
            <span className="text-xs text-slate-500 ml-1">اللون:</span>
            {MASK_THEMES.map((theme) => {
              const active = maskTheme.id === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  title={theme.label}
                  aria-label={theme.label}
                  onClick={() => setMaskTheme(theme)}
                  style={{ backgroundColor: theme.swatch }}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center cursor-pointer transition-transform ${
                    active ? 'ring-2 ring-sky-600 ring-offset-1 scale-110 border-slate-900' : 'border-slate-300'
                  }`}
                >
                  {active && (
                    <Check
                      className={`w-3.5 h-3.5 ${
                        theme.id === 'white' ? 'text-slate-900' : 'text-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Surface Finish */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
            {(['HASL', 'ENIG'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFinish(f)}
                className={`px-2.5 py-1 text-xs font-mono-tech font-semibold rounded-md cursor-pointer ${
                  finish === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Layer Toggles & Zoom */}
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === 'stencil' ? (
            <button
              type="button"
              onClick={() => setStencilBoardUnderlay((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                stencilBoardUnderlay
                  ? 'bg-sky-50 border-sky-200 text-sky-800'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{stencilBoardUnderlay ? 'إخفاء البوردة أسفل الاستنسل' : 'إظهار البوردة أسفل الاستنسل'}</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {[
                { label: 'النحاس', active: showCopper, toggle: () => setShowCopper((v) => !v) },
                { label: 'البادات', active: showMask, toggle: () => setShowMask((v) => !v) },
                { label: 'الطباعة', active: showSilk, toggle: () => setShowSilk((v) => !v) },
                { label: 'الثقوب', active: showDrill, toggle: () => setShowDrill((v) => !v) },
                { label: 'الاستنسل', active: showStencil, toggle: () => setShowStencil((v) => !v) },
              ].map((layer) => (
                <button
                  key={layer.label}
                  type="button"
                  onClick={layer.toggle}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-semibold cursor-pointer transition-colors ${
                    layer.active
                      ? 'bg-sky-50 border-sky-200 text-sky-800'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{layer.label}</span>
                </button>
              ))}
            </div>
          )}

          {viewMode !== '3d' && (
            <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
              <button
                type="button"
                aria-label="تصغير"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className="p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="px-2 text-xs font-mono-tech text-slate-700 tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                aria-label="تكبير"
                onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                className="p-1.5 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="إعادة ضبط التكبير"
                onClick={() => setZoom(1)}
                className="p-1.5 text-slate-600 hover:bg-slate-100 border-r border-slate-200 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Top & Bottom / Stencil / 3D Preview Viewport */}
      <div className="p-4 sm:p-6 bg-slate-100/70">
        {viewMode === '3d' ? (
          <Gerber3DViewer
            board={board}
            theme={maskTheme}
            finish={finish}
            showCopper={showCopper}
            showMask={showMask}
            showSilk={showSilk}
            showDrill={showDrill}
            showStencil={showStencil}
            onToggleStencil={() => setShowStencil((v) => !v)}
            panel={activePanelConfig}
            onToggleFullscreen={() => setFullscreen3D(true)}
          />
        ) : viewMode === 'stencil' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PcbStencil2DCanvas
              side="top"
              board={board}
              zoom={zoom}
              showBoardUnderneath={stencilBoardUnderlay}
              theme={maskTheme}
              panel={activePanelConfig}
            />
            <PcbStencil2DCanvas
              side="bottom"
              board={board}
              zoom={zoom}
              showBoardUnderneath={stencilBoardUnderlay}
              theme={maskTheme}
              panel={activePanelConfig}
            />
          </div>
        ) : (
          <div
            className={`grid gap-4 ${
              viewMode === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {(viewMode === 'both' || viewMode === 'top') && (
              <PcbSideCanvas
                side="top"
                board={board}
                theme={maskTheme}
                finish={finish}
                zoom={zoom}
                showCopper={showCopper}
                showMask={showMask}
                showSilk={showSilk}
                showDrill={showDrill}
                showStencil={showStencil}
                panel={activePanelConfig}
              />
            )}
            {(viewMode === 'both' || viewMode === 'bottom') && (
              <PcbSideCanvas
                side="bottom"
                board={board}
                theme={maskTheme}
                finish={finish}
                zoom={zoom}
                showCopper={showCopper}
                showMask={showMask}
                showSilk={showSilk}
                showDrill={showDrill}
                showStencil={showStencil}
                panel={activePanelConfig}
              />
            )}
          </div>
        )}

        {/* Delivery Format (Panelization) + Quantity + Live Price Estimator Bar for Uploaded Gerber */}
        <div className="mt-4 bg-white border border-[#E5E3DC] rounded-xl p-4 sm:p-5 space-y-4">
          {/* Row 1: Delivery Format & Panel Matrix (JLCPCB-style) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EFECE3]">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#071A2B]">
                <LayoutGrid className="w-4 h-4 text-[#1D5F8A]" />
                <span>طريقة التسليم:</span>
              </div>
              <div className="inline-flex p-0.5 bg-[#FAF9F5] border border-[#E5E3DC] rounded-lg">
                <button
                  type="button"
                  onClick={() => setDeliveryFormat('single')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                    deliveryFormat === 'single'
                      ? 'bg-white text-[#071A2B] shadow-xs'
                      : 'text-slate-600 hover:text-[#071A2B]'
                  }`}
                >
                  بوردة منفردة
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryFormat('panel')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                    deliveryFormat === 'panel'
                      ? 'bg-[#071A2B] text-[#F4EFE1]'
                      : 'text-slate-600 hover:text-[#071A2B]'
                  }`}
                >
                  بانل (Panel)
                </button>
              </div>
            </div>

            {deliveryFormat === 'panel' && (
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600">توزيع البانل:</span>
                  <FreeNumericInput
                    id="panel-cols-board"
                    min={1}
                    max={20}
                    placeholder="2"
                    value={panelCols}
                    onChangeValue={setPanelCols}
                    className="w-14 px-2 py-1 text-xs text-center font-mono-tech font-bold tabular-nums bg-[#FAF9F5] border border-[#D9D5CA] rounded-md focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                  />
                  <span className="font-mono-tech text-xs font-bold text-slate-500">×</span>
                  <FreeNumericInput
                    id="panel-rows-board"
                    min={1}
                    max={20}
                    placeholder="4"
                    value={panelRows}
                    onChangeValue={setPanelRows}
                    className="w-14 px-2 py-1 text-xs text-center font-mono-tech font-bold tabular-nums bg-[#FAF9F5] border border-[#D9D5CA] rounded-md focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                  />
                </div>

                <div className="flex items-center gap-1">
                  {(
                    [
                      [2, 2],
                      [2, 4],
                      [3, 3],
                      [4, 5],
                    ] as const
                  ).map(([c, r]) => (
                    <button
                      key={`${c}x${r}`}
                      type="button"
                      onClick={() => {
                        setPanelCols(c);
                        setPanelRows(r);
                      }}
                      className={`px-2 py-1 text-[11px] font-mono-tech font-semibold rounded border cursor-pointer ${
                        panelCols === c && panelRows === r
                          ? 'bg-[#071A2B] text-[#F4EFE1] border-[#071A2B]'
                          : 'bg-[#FAF9F5] text-slate-600 border-[#E5E3DC] hover:border-[#1D5F8A]'
                      }`}
                    >
                      {c}×{r}
                    </button>
                  ))}
                </div>

                <div className="inline-flex p-0.5 bg-[#FAF9F5] border border-[#E5E3DC] rounded-md">
                  <button
                    type="button"
                    onClick={() => setPanelBreakout('vcut')}
                    className={`px-2 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                      panelBreakout === 'vcut' ? 'bg-[#1D5F8A] text-white' : 'text-slate-600'
                    }`}
                  >
                    V-Cut
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelBreakout('tab')}
                    className={`px-2 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                      panelBreakout === 'tab' ? 'bg-[#1D5F8A] text-white' : 'text-slate-600'
                    }`}
                  >
                    Tab-Route
                  </button>
                </div>

                <div className="inline-flex p-0.5 bg-[#FAF9F5] border border-[#E5E3DC] rounded-md">
                  {(
                    [
                      { id: 'none', label: 'بدون حواف' },
                      { id: '2sides', label: 'جانبين' },
                      { id: '4sides', label: '4 جوانب' },
                    ] as const
                  ).map((rm) => (
                    <button
                      key={rm.id}
                      type="button"
                      onClick={() => setPanelRailMode(rm.id)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                        panelRailMode === rm.id ? 'bg-[#1D5F8A] text-white' : 'text-slate-600'
                      }`}
                    >
                      {rm.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Quantity, Thickness, Stencil, Live Total */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-[#1D5F8A] shrink-0" />
                <label htmlFor="pcb-qty-board" className="text-xs sm:text-sm font-bold text-[#071A2B]">
                  {deliveryFormat === 'panel' ? 'عدد البانلات:' : 'عدد البوردات:'}
                </label>
                <FreeNumericInput
                  id="pcb-qty-board"
                  min={minQty}
                  max={10000}
                  placeholder={String(minQty)}
                  value={quantity}
                  onChangeValue={setQuantity}
                  className="w-20 px-2.5 py-1.5 text-sm text-right font-mono-tech font-bold tabular-nums placeholder:text-slate-400 bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {presetQuantities.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuantity(q)}
                    className={`px-2.5 py-1 text-xs font-mono-tech font-semibold rounded-md border cursor-pointer transition-colors ${
                      quantity === q
                        ? 'bg-[#071A2B] text-[#F4EFE1] border-[#071A2B]'
                        : 'bg-[#FAF9F5] text-slate-600 border-[#E5E3DC] hover:border-[#1D5F8A]'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 border-r border-[#E5E3DC] pr-3">
                <span className="text-xs text-slate-500">السُمك:</span>
                {([1.0, 1.6, 2.0] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => setThicknessMm(th)}
                    className={`px-2 py-1 text-xs font-mono-tech font-semibold rounded cursor-pointer ${
                      thicknessMm === th
                        ? 'bg-[#1D5F8A] text-white'
                        : 'bg-[#FAF9F5] text-slate-600 hover:text-[#071A2B]'
                    }`}
                  >
                    {th}mm
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#071A2B] border-r border-[#E5E3DC] pr-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeStencil}
                  onChange={(e) => setIncludeStencil(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#1D5F8A]"
                />
                <span>إضافة استنسل (+{stencilFeeAmount} {currency})</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 lg:border-r lg:border-[#E5E3DC] lg:pr-5">
              <div>
                <div className="text-[11px] text-slate-500">
                  {estimate
                    ? estimate.isPanel
                      ? `السعر التقديري (${effectiveQty} بانل · ${estimate.totalBoardsCount} بوردة)`
                      : `السعر التقديري (${effectiveQty} بوردة)`
                    : 'السعر التقديري'}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono-tech text-xl font-bold text-[#071A2B] tabular-nums">
                    {estimate ? estimate.totalPrice.toLocaleString('en-US') : '—'}
                  </span>
                  {estimate && (
                    <>
                      <span className="text-xs font-semibold text-slate-700">{estimate.currency}</span>
                      <span className="text-[11px] text-slate-500 font-mono-tech tabular-nums">
                        {estimate.isPanel
                          ? `(${estimate.unitPrice.toLocaleString('en-US')}/بانل · ${estimate.singleBoardPrice.toLocaleString('en-US')}/بوردة)`
                          : `(${estimate.unitPrice.toLocaleString('en-US')} ${estimate.currency}/قطعة)`}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-xs text-slate-600">
                {estimate ? (
                  <>
                    <div>مدة التنفيذ: <strong className="text-[#071A2B]">{estimate.leadTime}</strong></div>
                    {estimate.isPanel && (
                      <div className="font-mono-tech text-sky-800 font-semibold">
                        بانل {estimate.panelWidthMm}×{estimate.panelHeightMm} mm
                      </div>
                    )}
                    {estimate.isSmallBoardPromo && (
                      <div className="text-sky-700 font-semibold">عرض اللوحات ≤ 10×10 سم</div>
                    )}
                    {estimate.discountPercent > 0 && (
                      <div className="text-emerald-700 font-semibold">
                        يشمل خصم {estimate.discountPercent}%
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-500">
                    {deliveryFormat === 'panel' && !hasPanelLayout
                      ? 'أدخل توزيع البانل (مثل 2×4) لحساب التكلفة'
                      : `أدخل العدد (${minQty}+) لحساب التكلفة`}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Layers className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              {viewMode === '3d'
                ? 'اسحب للتدوير 360° أو مرر عجلة الماوس، واستخدم "عرض الاستنسل 3D" من شريط الأدوات بالأسفل.'
                : viewMode === 'stencil'
                  ? 'معاينة فتحات الاستنسل الليزر (SMD Paste) للوجه العلوي والسفلي مع إمكانية مطابقة البوردة أسفله.'
                  : 'يمكنك تحريك اللوحة بالسحب أو التكبير لفحص المسارات والبادات قبل إرسال طلب التصنيع.'}
            </span>
          </div>
          <button
            type="button"
            disabled={!estimate}
            onClick={handleQuoteFromBoard}
            className="px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] disabled:opacity-45 disabled:hover:bg-[#1D5F8A] disabled:cursor-not-allowed rounded-lg cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            {estimate?.isPanel
              ? 'اعتماد البانل والكمية وطلب تسعير'
              : 'اعتماد المقاس والكمية وطلب تسعير لهذه البوردة'}
          </button>
        </div>
      </div>

          {/* Fullscreen 3D PCB Modal */}
          {fullscreen3D && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="معاينة التصميم 3D"
              onClick={() => setFullscreen3D(false)}
              className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3 sm:p-6"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-6xl bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl flex flex-col"
              >
                <div className="px-4 sm:px-6 py-3 border-b border-slate-800 flex items-center justify-between gap-4 text-white">
                  <div className="min-w-0">
                    <div className="text-sm sm:text-base font-bold truncate">
                      عارض البوردة والاستنسل ثلاثي الأبعاد (3D PCB + Stencil)
                    </div>
                    <div className="font-mono-tech text-xs text-slate-400 truncate" dir="ltr">
                      {board.archiveName} ·{' '}
                      {activePanelConfig
                        ? (() => {
                            const pd = computePanelDimensionsMm(
                              board.widthMm,
                              board.heightMm,
                              activePanelConfig
                            );
                            return `Panel ${activePanelConfig.cols}×${activePanelConfig.rows} (${pd.panelWidthMm} × ${pd.panelHeightMm} mm)`;
                          })()
                        : `${board.widthMm} × ${board.heightMm} mm`}{' '}
                      · {maskTheme.label} · {finish}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="إغلاق المعاينة ثلاثية الأبعاد"
                    onClick={() => setFullscreen3D(false)}
                    className="w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-3 sm:p-4 bg-slate-950">
                  <Gerber3DViewer
                    board={board}
                    theme={maskTheme}
                    finish={finish}
                    showCopper={showCopper}
                    showMask={showMask}
                    showSilk={showSilk}
                    showDrill={showDrill}
                    showStencil={showStencil}
                    onToggleStencil={() => setShowStencil((v) => !v)}
                    panel={activePanelConfig}
                    isFullscreen
                    onToggleFullscreen={() => setFullscreen3D(false)}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
