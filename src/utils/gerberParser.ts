import JSZip from 'jszip';

export type GerberLayerKind =
  | 'topCopper'
  | 'bottomCopper'
  | 'topMask'
  | 'bottomMask'
  | 'topPaste'
  | 'bottomPaste'
  | 'topSilk'
  | 'bottomSilk'
  | 'outline'
  | 'drill'
  | 'unknown';

export interface ApertureDef {
  code: number;
  shape: 'C' | 'R' | 'O' | 'P';
  width: number; // mm
  height: number; // mm
  hole?: number; // mm
}

export type DrawCommand =
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      polarity: 'dark' | 'clear';
    }
  | {
      kind: 'arc';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      cx: number;
      cy: number;
      ccw: boolean;
      width: number;
      polarity: 'dark' | 'clear';
    }
  | {
      kind: 'flash';
      x: number;
      y: number;
      aperture: ApertureDef;
      polarity: 'dark' | 'clear';
    }
  | {
      kind: 'region';
      points: Array<{ x: number; y: number }>;
      polarity: 'dark' | 'clear';
    };

export interface BoundsMM {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ParsedLayer {
  filename: string;
  kind: GerberLayerKind;
  commands: DrawCommand[];
  bounds: BoundsMM | null;
}

export interface ParsedBoard {
  archiveName: string;
  layers: ParsedLayer[];
  bounds: BoundsMM;
  widthMm: number;
  heightMm: number;
  layerCount: 1 | 2;
  drillCount: number;
  hasTopPaste: boolean;
  hasBottomPaste: boolean;
  smdPadCount: number;
  detectedFiles: Array<{ filename: string; kind: GerberLayerKind }>;
}

export function classifyGerberFilename(filename: string): GerberLayerKind {
  const base = filename.split('/').pop()?.toLowerCase() || filename.toLowerCase();
  if (!base || base.startsWith('__macosx') || base.startsWith('.')) return 'unknown';

  const ext = base.includes('.') ? base.split('.').pop() || '' : '';

  // Drill files
  if (
    ext === 'drl' ||
    ext === 'xln' ||
    ext === 'exc' ||
    ext === 'drd' ||
    ((ext === 'txt' || ext === 'tap') && (base.includes('drill') || base.includes('pth') || base.includes('npth')))
  ) {
    return 'drill';
  }

  // Board outline
  if (
    ext === 'gko' ||
    ext === 'gm1' ||
    ext === 'gml' ||
    ext === 'dim' ||
    base.includes('edge_cuts') ||
    base.includes('edge.cuts') ||
    base.includes('outline') ||
    base.includes('boardoutline') ||
    base.includes('profile') ||
    base.includes('keepout')
  ) {
    return 'outline';
  }

  // Top Copper
  if (
    ext === 'gtl' ||
    ext === 'cmp' ||
    base.includes('f_cu') ||
    base.includes('f.cu') ||
    base.includes('toplayer') ||
    base.includes('top_copper') ||
    base.includes('copper_top') ||
    base.includes('l1')
  ) {
    return 'topCopper';
  }

  // Bottom Copper
  if (
    ext === 'gbl' ||
    ext === 'sol' ||
    base.includes('b_cu') ||
    base.includes('b.cu') ||
    base.includes('bottomlayer') ||
    base.includes('bottom_copper') ||
    base.includes('copper_bottom') ||
    base.includes('l2')
  ) {
    return 'bottomCopper';
  }

  // Top Solder Mask
  if (
    ext === 'gts' ||
    ext === 'stc' ||
    base.includes('f_mask') ||
    base.includes('f.mask') ||
    base.includes('topsoldermask') ||
    base.includes('top_mask') ||
    base.includes('soldermask_top')
  ) {
    return 'topMask';
  }

  // Bottom Solder Mask
  if (
    ext === 'gbs' ||
    ext === 'sts' ||
    base.includes('b_mask') ||
    base.includes('b.mask') ||
    base.includes('bottomsoldermask') ||
    base.includes('bottom_mask') ||
    base.includes('soldermask_bottom')
  ) {
    return 'bottomMask';
  }

  // Top Solder Paste (SMD Stencil Top)
  if (
    ext === 'gtp' ||
    ext === 'ctp' ||
    ext === 'crc' ||
    base.includes('f_paste') ||
    base.includes('f.paste') ||
    base.includes('toppaste') ||
    base.includes('top_paste') ||
    base.includes('paste_top') ||
    base.includes('solderpaste_top') ||
    base.includes('stencil_top') ||
    base.includes('tcream')
  ) {
    return 'topPaste';
  }

  // Bottom Solder Paste (SMD Stencil Bottom)
  if (
    ext === 'gbp' ||
    ext === 'cbp' ||
    ext === 'crs' ||
    base.includes('b_paste') ||
    base.includes('b.paste') ||
    base.includes('bottompaste') ||
    base.includes('bottom_paste') ||
    base.includes('paste_bottom') ||
    base.includes('solderpaste_bottom') ||
    base.includes('stencil_bottom') ||
    base.includes('bcream')
  ) {
    return 'bottomPaste';
  }

  // Top Silkscreen
  if (
    ext === 'gto' ||
    ext === 'plc' ||
    base.includes('f_silks') ||
    base.includes('f.silks') ||
    base.includes('f_silkscreen') ||
    base.includes('topsilk') ||
    base.includes('silkscreen_top')
  ) {
    return 'topSilk';
  }

  // Bottom Silkscreen
  if (
    ext === 'gbo' ||
    ext === 'pls' ||
    base.includes('b_silks') ||
    base.includes('b.silks') ||
    base.includes('b_silkscreen') ||
    base.includes('bottomsilk') ||
    base.includes('silkscreen_bottom')
  ) {
    return 'bottomSilk';
  }

  // Fallback generic names
  if (base.includes('top') && (base.includes('paste') || base.includes('stencil'))) return 'topPaste';
  if (base.includes('bot') && (base.includes('paste') || base.includes('stencil'))) return 'bottomPaste';
  if (base.includes('top') && base.includes('mask')) return 'topMask';
  if (base.includes('bot') && base.includes('mask')) return 'bottomMask';
  if (base.includes('top') && base.includes('silk')) return 'topSilk';
  if (base.includes('bot') && base.includes('silk')) return 'bottomSilk';
  if (base.includes('top')) return 'topCopper';
  if (base.includes('bot')) return 'bottomCopper';
  if (base.includes('drill')) return 'drill';

  return 'unknown';
}

function parseCoord(
  raw: string,
  intDigits: number,
  decDigits: number,
  zeroMode: 'L' | 'T',
  unitScale: number
): number {
  let sign = 1;
  let str = raw.trim();
  if (str.startsWith('-')) {
    sign = -1;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }
  const total = intDigits + decDigits;
  if (str.includes('.')) {
    return sign * parseFloat(str) * unitScale;
  }
  if (zeroMode === 'T') {
    str = str.padEnd(total, '0');
  } else {
    str = str.padStart(total, '0');
  }
  const val = parseInt(str, 10) / Math.pow(10, decDigits);
  return sign * val * unitScale;
}

function updateBounds(b: BoundsMM | null, x: number, y: number, pad = 0): BoundsMM {
  if (!b) {
    return { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad };
  }
  return {
    minX: Math.min(b.minX, x - pad),
    minY: Math.min(b.minY, y - pad),
    maxX: Math.max(b.maxX, x + pad),
    maxY: Math.max(b.maxY, y + pad),
  };
}

export function parseExcellonDrill(content: string, filename: string): ParsedLayer {
  const lines = content.split(/\r?\n/);
  let unitScale = 25.4; // default inches in Excellon
  let zeroMode: 'L' | 'T' = 'L';
  let intDigits = 2;
  let decDigits = 4;
  let inHeader = false;

  const tools = new Map<number, number>();
  let currentToolSize = 0.8;
  let lastX = 0;
  let lastY = 0;
  const commands: DrawCommand[] = [];
  let bounds: BoundsMM | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    if (line === 'M48') {
      inHeader = true;
      continue;
    }
    if (line === '%' || line === 'M95') {
      inHeader = false;
      continue;
    }
    if (line.includes('METRIC')) {
      unitScale = 1;
      intDigits = 3;
      decDigits = 3;
      if (line.includes('TZ')) zeroMode = 'L';
      if (line.includes('LZ')) zeroMode = 'T';
      continue;
    }
    if (line.includes('INCH')) {
      unitScale = 25.4;
      intDigits = 2;
      decDigits = 4;
      if (line.includes('TZ')) zeroMode = 'L';
      if (line.includes('LZ')) zeroMode = 'T';
      continue;
    }

    const toolDef = line.match(/^T0?(\d+).*C([\d.]+)/i);
    if (toolDef) {
      const code = parseInt(toolDef[1], 10);
      const diam = parseFloat(toolDef[2]) * unitScale;
      tools.set(code, diam);
      if (!inHeader) {
        currentToolSize = diam;
      }
      continue;
    }

    const toolSel = line.match(/^T0?(\d+)$/i);
    if (toolSel) {
      const code = parseInt(toolSel[1], 10);
      if (tools.has(code)) {
        currentToolSize = tools.get(code)!;
      }
      continue;
    }

    if (inHeader) continue;

    const xMatch = line.match(/X([+-]?[\d.]+)/i);
    const yMatch = line.match(/Y([+-]?[\d.]+)/i);
    if (xMatch || yMatch) {
      const x = xMatch
        ? parseCoord(xMatch[1], intDigits, decDigits, zeroMode, unitScale)
        : lastX;
      const y = yMatch
        ? parseCoord(yMatch[1], intDigits, decDigits, zeroMode, unitScale)
        : lastY;
      lastX = x;
      lastY = y;

      const r = currentToolSize / 2;
      commands.push({
        kind: 'flash',
        x,
        y,
        aperture: { code: 0, shape: 'C', width: currentToolSize, height: currentToolSize },
        polarity: 'dark',
      });
      bounds = updateBounds(bounds, x, y, r);
    }
  }

  return { filename, kind: 'drill', commands, bounds };
}

export function parseGerberRS274X(
  content: string,
  filename: string,
  kind: GerberLayerKind
): ParsedLayer {
  let unitScale = 1; // mm default unless MOIN
  let intDigits = 2;
  let decDigits = 4;
  let zeroMode: 'L' | 'T' = 'L'; // omit leading zeros default
  let polarity: 'dark' | 'clear' = 'dark';
  let interp: 'G01' | 'G02' | 'G03' = 'G01';
  let multiQuadrant = true;
  let regionMode = false;
  let regionPoints: Array<{ x: number; y: number }> = [];

  const apertures = new Map<number, ApertureDef>();
  let currentAperture: ApertureDef = { code: 10, shape: 'C', width: 0.25, height: 0.25 };

  let curX = 0;
  let curY = 0;
  const commands: DrawCommand[] = [];
  let bounds: BoundsMM | null = null;

  // Strip newlines and process extended (%) and standard (*) blocks
  const cleaned = content.replace(/\r?\n/g, '');
  let i = 0;
  const len = cleaned.length;

  const processBlock = (block: string) => {
    const cmd = block.trim();
    if (!cmd) return;

    // Extended commands inside % ... %
    if (cmd.startsWith('FS')) {
      const fsMatch = cmd.match(/^FS([LT])?[AI]?X(\d)(\d)Y(\d)(\d)/);
      if (fsMatch) {
        if (fsMatch[1] === 'T') zeroMode = 'T';
        else zeroMode = 'L';
        intDigits = parseInt(fsMatch[2], 10);
        decDigits = parseInt(fsMatch[3], 10);
      }
      return;
    }
    if (cmd === 'MOIN') {
      unitScale = 25.4;
      return;
    }
    if (cmd === 'MOMM') {
      unitScale = 1;
      return;
    }
    if (cmd === 'LPD') {
      polarity = 'dark';
      return;
    }
    if (cmd === 'LPC') {
      polarity = 'clear';
      return;
    }
    if (cmd.startsWith('AD')) {
      const adMatch = cmd.match(/^ADD(\d+)([A-Za-z0-9_]+),?(.*)$/);
      if (adMatch) {
        const code = parseInt(adMatch[1], 10);
        const type = adMatch[2];
        const params = adMatch[3]
          .split('X')
          .map((p) => parseFloat(p))
          .filter((n) => !Number.isNaN(n));

        let shape: ApertureDef['shape'] = 'C';
        let width = (params[0] ?? 0.3) * unitScale;
        let height = (params[1] ?? params[0] ?? 0.3) * unitScale;

        if (type === 'R') shape = 'R';
        else if (type === 'O') shape = 'O';
        else if (type === 'P') shape = 'P';
        else shape = 'C';

        apertures.set(code, { code, shape, width, height });
      }
      return;
    }

    // Standard Gerber G/D/X/Y blocks
    if (cmd.startsWith('G04')) return; // Comment

    let rest = cmd;
    // Extract G codes
    const gMatches = rest.match(/G\d{1,2}/g);
    if (gMatches) {
      for (const g of gMatches) {
        const gNum = parseInt(g.slice(1), 10);
        if (gNum === 1) interp = 'G01';
        else if (gNum === 2) interp = 'G02';
        else if (gNum === 3) interp = 'G03';
        else if (gNum === 74) multiQuadrant = false;
        else if (gNum === 75) multiQuadrant = true;
        else if (gNum === 36) {
          regionMode = true;
          regionPoints = [];
        } else if (gNum === 37) {
          if (regionMode && regionPoints.length >= 3) {
            commands.push({ kind: 'region', points: [...regionPoints], polarity });
          }
          regionMode = false;
          regionPoints = [];
        } else if (gNum === 70) unitScale = 25.4;
        else if (gNum === 71) unitScale = 1;
      }
      rest = rest.replace(/G\d{1,2}/g, '');
    }

    // Aperture select D10+
    const dSelect = rest.match(/D(\d+)/);
    let dCode = 0;
    if (dSelect) {
      dCode = parseInt(dSelect[1], 10);
      if (dCode >= 10) {
        if (apertures.has(dCode)) {
          currentAperture = apertures.get(dCode)!;
        }
        return;
      }
    }

    const xMatch = rest.match(/X([+-]?[\d.]+)/);
    const yMatch = rest.match(/Y([+-]?[\d.]+)/);
    const iMatch = rest.match(/I([+-]?[\d.]+)/);
    const jMatch = rest.match(/J([+-]?[\d.]+)/);

    if (!xMatch && !yMatch && dCode === 0) return;

    const nextX = xMatch
      ? parseCoord(xMatch[1], intDigits, decDigits, zeroMode, unitScale)
      : curX;
    const nextY = yMatch
      ? parseCoord(yMatch[1], intDigits, decDigits, zeroMode, unitScale)
      : curY;
    const offI = iMatch
      ? parseCoord(iMatch[1], intDigits, decDigits, zeroMode, unitScale)
      : 0;
    const offJ = jMatch
      ? parseCoord(jMatch[1], intDigits, decDigits, zeroMode, unitScale)
      : 0;

    if (regionMode) {
      if (dCode === 2) {
        if (regionPoints.length >= 3) {
          commands.push({ kind: 'region', points: [...regionPoints], polarity });
        }
        regionPoints = [{ x: nextX, y: nextY }];
      } else {
        if (regionPoints.length === 0) {
          regionPoints.push({ x: curX, y: curY });
        }
        regionPoints.push({ x: nextX, y: nextY });
      }
      bounds = updateBounds(bounds, nextX, nextY, 0);
      curX = nextX;
      curY = nextY;
      return;
    }

    const effectiveD = dCode || 1;
    if (effectiveD === 2) {
      curX = nextX;
      curY = nextY;
      return;
    }

    if (effectiveD === 3) {
      commands.push({
        kind: 'flash',
        x: nextX,
        y: nextY,
        aperture: currentAperture,
        polarity,
      });
      const pad = Math.max(currentAperture.width, currentAperture.height) / 2;
      bounds = updateBounds(bounds, nextX, nextY, pad);
      curX = nextX;
      curY = nextY;
      return;
    }

    if (effectiveD === 1) {
      const w = Math.max(currentAperture.width, 0.08);
      if (interp === 'G01' || (offI === 0 && offJ === 0)) {
        commands.push({
          kind: 'line',
          x1: curX,
          y1: curY,
          x2: nextX,
          y2: nextY,
          width: w,
          polarity,
        });
      } else {
        const cx = curX + (multiQuadrant ? offI : Math.abs(offI));
        const cy = curY + (multiQuadrant ? offJ : Math.abs(offJ));
        commands.push({
          kind: 'arc',
          x1: curX,
          y1: curY,
          x2: nextX,
          y2: nextY,
          cx,
          cy,
          ccw: interp === 'G03',
          width: w,
          polarity,
        });
      }
      bounds = updateBounds(bounds, curX, curY, w / 2);
      bounds = updateBounds(bounds, nextX, nextY, w / 2);
      curX = nextX;
      curY = nextY;
    }
  };

  while (i < len) {
    if (cleaned[i] === '%') {
      const end = cleaned.indexOf('%', i + 1);
      if (end === -1) break;
      const inner = cleaned.slice(i + 1, end);
      for (const sub of inner.split('*')) {
        processBlock(sub);
      }
      i = end + 1;
    } else {
      const end = cleaned.indexOf('*', i);
      if (end === -1) break;
      processBlock(cleaned.slice(i, end));
      i = end + 1;
    }
  }

  return { filename, kind, commands, bounds };
}

export async function parseGerberInputFiles(files: File[]): Promise<ParsedBoard> {
  const entries: Array<{ name: string; content: string }> = [];
  let archiveName = files.length === 1 ? files[0].name : `${files.length} ملفات Gerber`;

  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      archiveName = file.name;
      const names = Object.keys(zip.files);
      for (const name of names) {
        const entry = zip.files[name];
        if (!entry.dir) {
          const text = await entry.async('string');
          entries.push({ name, content: text });
        }
      }
    } else {
      const text = await file.text();
      entries.push({ name: file.name, content: text });
    }
  }

  return buildParsedBoard(archiveName, entries);
}

export function buildParsedBoard(
  archiveName: string,
  entries: Array<{ name: string; content: string }>
): ParsedBoard {
  const layers: ParsedLayer[] = [];
  const detectedFiles: Array<{ filename: string; kind: GerberLayerKind }> = [];

  for (const item of entries) {
    const kind = classifyGerberFilename(item.name);
    if (kind === 'unknown') continue;
    detectedFiles.push({ filename: item.name.split('/').pop() || item.name, kind });

    if (kind === 'drill') {
      layers.push(parseExcellonDrill(item.content, item.name));
    } else {
      layers.push(parseGerberRS274X(item.content, item.name, kind));
    }
  }

  const outlineLayer = layers.find((l) => l.kind === 'outline' && l.bounds);
  let overallBounds: BoundsMM | null = outlineLayer?.bounds ?? null;

  if (!overallBounds) {
    for (const l of layers) {
      if (!l.bounds) continue;
      if (!overallBounds) {
        overallBounds = { ...l.bounds };
      } else {
        overallBounds = {
          minX: Math.min(overallBounds.minX, l.bounds.minX),
          minY: Math.min(overallBounds.minY, l.bounds.minY),
          maxX: Math.max(overallBounds.maxX, l.bounds.maxX),
          maxY: Math.max(overallBounds.maxY, l.bounds.maxY),
        };
      }
    }
  }

  const finalBounds: BoundsMM = overallBounds ?? {
    minX: 0,
    minY: 0,
    maxX: 80,
    maxY: 60,
  };

  const widthMm = Math.max(1, Number((finalBounds.maxX - finalBounds.minX).toFixed(1)));
  const heightMm = Math.max(1, Number((finalBounds.maxY - finalBounds.minY).toFixed(1)));

  const hasBottom = layers.some(
    (l) =>
      (l.kind === 'bottomCopper' ||
        l.kind === 'bottomMask' ||
        l.kind === 'bottomPaste' ||
        l.kind === 'bottomSilk') &&
      l.commands.length > 0
  );
  const drillCount = layers
    .filter((l) => l.kind === 'drill')
    .reduce((acc, l) => acc + l.commands.length, 0);

  const hasTopPaste = layers.some((l) => l.kind === 'topPaste' && l.commands.length > 0);
  const hasBottomPaste = layers.some((l) => l.kind === 'bottomPaste' && l.commands.length > 0);

  const partialBoard: ParsedBoard = {
    archiveName,
    layers,
    bounds: finalBounds,
    widthMm,
    heightMm,
    layerCount: hasBottom ? 2 : 1,
    drillCount,
    hasTopPaste,
    hasBottomPaste,
    smdPadCount: 0,
    detectedFiles,
  };

  const topStencil = getStencilCommandsForSide(partialBoard, 'top');
  const botStencil = getStencilCommandsForSide(partialBoard, 'bottom');
  partialBoard.smdPadCount = topStencil.commands.length + botStencil.commands.length;

  return partialBoard;
}

/**
 * Returns laser-cut SMD stencil aperture commands for a given board side.
 * Uses explicit Solder Paste layers (.GTP / .GBP) when present, and falls back
 * to non-drilled SMD pads from Mask/Copper layers so any Gerber archive can
 * preview its SMD stencil.
 */
export function getStencilCommandsForSide(
  board: ParsedBoard,
  side: 'top' | 'bottom'
): { commands: DrawCommand[]; isExplicit: boolean } {
  const pasteKind: GerberLayerKind = side === 'top' ? 'topPaste' : 'bottomPaste';
  const explicitLayers = board.layers.filter((l) => l.kind === pasteKind && l.commands.length > 0);
  if (explicitLayers.length > 0) {
    return {
      commands: explicitLayers.flatMap((l) => l.commands),
      isExplicit: true,
    };
  }

  // Fallback: exclude drilled through-hole pads and extract SMD flashes
  const drillPts = board.layers
    .filter((l) => l.kind === 'drill')
    .flatMap((l) => l.commands)
    .filter((c): c is Extract<DrawCommand, { kind: 'flash' }> => c.kind === 'flash')
    .map((c) => ({ x: c.x, y: c.y }));

  const isNearDrill = (x: number, y: number) => {
    for (let i = 0; i < drillPts.length; i++) {
      const dx = drillPts[i].x - x;
      const dy = drillPts[i].y - y;
      if (dx * dx + dy * dy <= 0.16) return true; // <= 0.4 mm tolerance
    }
    return false;
  };

  const copperKind: GerberLayerKind = side === 'top' ? 'topCopper' : 'bottomCopper';
  const maskKind: GerberLayerKind = side === 'top' ? 'topMask' : 'bottomMask';
  const sourceLayers = board.layers.filter((l) => l.kind === copperKind && l.commands.length > 0);
  const backupLayers =
    sourceLayers.length > 0
      ? sourceLayers
      : board.layers.filter((l) => l.kind === maskKind && l.commands.length > 0);

  const smdCommands: DrawCommand[] = [];
  for (const l of backupLayers) {
    for (const cmd of l.commands) {
      if (cmd.kind !== 'flash' || cmd.polarity === 'clear') continue;
      if (isNearDrill(cmd.x, cmd.y)) continue;
      // Ignore tiny via flashes (< 0.45 mm) when circular
      if (cmd.aperture.shape === 'C' && cmd.aperture.width < 0.45) continue;
      smdCommands.push(cmd);
    }
  }

  return { commands: smdCommands, isExplicit: false };
}

/**
 * Generates an authentic 2-layer ESP32 Controller Gerber set (85mm x 60mm)
 * with THT + SMD footprints and Top/Bottom Solder Paste (.GTP/.GBP) layers
 * so users can test the 2D, 3D, and Stencil viewers immediately.
 */
export function createSampleGerberBoard(): ParsedBoard {
  const mm = (val: number) => Math.round(val * 10000);
  const header = `%FSLAX34Y34*%\n%MOMM*%\n`;

  const outline = `${header}%ADD10C,0.2000*%\nD10*\nX${mm(0)}Y${mm(0)}D02*\nX${mm(85)}Y${mm(0)}D01*\nX${mm(85)}Y${mm(60)}D01*\nX${mm(0)}Y${mm(60)}D01*\nX${mm(0)}Y${mm(0)}D01*\nM02*\n`;

  // Mounting holes + THT terminal pads + SMD IC/resistor pads
  const mounting = [
    [4, 4],
    [81, 4],
    [4, 56],
    [81, 56],
  ];
  const j1Pins = Array.from({ length: 6 }, (_, i) => [12 + i * 5.08, 7]); // Terminal block
  const j2Pins = Array.from({ length: 4 }, (_, i) => [55 + i * 5.08, 7]); // Power/RS485
  const espLeft = Array.from({ length: 10 }, (_, i) => [30, 22 + i * 2.54]);
  const espRight = Array.from({ length: 10 }, (_, i) => [48, 22 + i * 2.54]);
  const smdPassivePads = [
    [34, 17],
    [36.2, 17],
    [41, 17],
    [43.2, 17],
    [34, 51],
    [36.2, 51],
    [41, 51],
    [43.2, 51],
    [55, 22],
    [55, 24.2],
    [59, 22],
    [59, 24.2],
  ];
  const relayPads = [
    [14, 34],
    [22, 34],
    [14, 44],
    [22, 44],
    [62, 34],
    [72, 34],
    [62, 44],
    [72, 44],
  ];

  const flashList = (pts: number[][], dCode: string) =>
    `${dCode}*\n` + pts.map(([x, y]) => `X${mm(x)}Y${mm(y)}D03*`).join('\n');

  const topCopper = `${header}%ADD10C,0.4500*%\n%ADD11C,1.9000*%\n%ADD12R,1.8000X1.1000*%\n%ADD13C,2.2000*%\n%ADD14C,4.2000*%\n%ADD15C,0.9000*%\n%ADD16R,1.2000X1.3000*%\nG36*\nX${mm(6)}Y${mm(14)}D02*\nX${mm(26)}Y${mm(14)}D01*\nX${mm(26)}Y${mm(26)}D01*\nX${mm(6)}Y${mm(26)}D01*\nX${mm(6)}Y${mm(14)}D01*\nG37*\n${flashList(mounting, 'D14')}\n${flashList(j1Pins, 'D13')}\n${flashList(j2Pins, 'D13')}\n${flashList(espLeft, 'D12')}\n${flashList(espRight, 'D12')}\n${flashList(smdPassivePads, 'D16')}\n${flashList(relayPads, 'D11')}\nD10*\n${espLeft
    .slice(0, 6)
    .map(
      ([x, y], idx) =>
        `X${mm(x)}Y${mm(y)}D02*\nX${mm(x - 6)}Y${mm(y)}D01*\nX${mm(12 + idx * 5.08)}Y${mm(14)}D01*\nX${mm(12 + idx * 5.08)}Y${mm(7)}D01*`
    )
    .join('\n')}\nD15*\n${espRight
    .slice(0, 4)
    .map(
      ([x, y], idx) =>
        `X${mm(x)}Y${mm(y)}D02*\nX${mm(55 + idx * 5.08)}Y${mm(y)}D01*\nX${mm(55 + idx * 5.08)}Y${mm(7)}D01*`
    )
    .join('\n')}\nM02*\n`;

  const bottomCopper = `${header}%ADD10C,0.5500*%\n%ADD11C,1.9000*%\n%ADD12C,1.6000*%\n%ADD13C,2.2000*%\n%ADD14C,4.2000*%\n%ADD16R,1.3000X1.2000*%\nG36*\nX${mm(32)}Y${mm(18)}D02*\nX${mm(78)}Y${mm(18)}D01*\nX${mm(78)}Y${mm(52)}D01*\nX${mm(32)}Y${mm(52)}D01*\nX${mm(32)}Y${mm(18)}D01*\nG37*\n${flashList(mounting, 'D14')}\n${flashList(j1Pins, 'D13')}\n${flashList(j2Pins, 'D13')}\n${flashList(relayPads, 'D11')}\n${flashList(smdPassivePads.slice(0, 4), 'D16')}\nD10*\nX${mm(14)}Y${mm(34)}D02*\nX${mm(14)}Y${mm(44)}D01*\nX${mm(62)}Y${mm(44)}D01*\nX${mm(72)}Y${mm(44)}D01*\nM02*\n`;

  const maskBody = (extra: string) =>
    `${header}%ADD11C,2.1000*%\n%ADD12R,1.9500X1.2500*%\n%ADD13C,2.4000*%\n%ADD14C,4.4000*%\n%ADD16R,1.3500X1.4500*%\n${flashList(mounting, 'D14')}\n${flashList(j1Pins, 'D13')}\n${flashList(j2Pins, 'D13')}\n${flashList(relayPads, 'D11')}\n${extra}M02*\n`;

  const topMask = maskBody(
    `${flashList(espLeft, 'D12')}\n${flashList(espRight, 'D12')}\n${flashList(smdPassivePads, 'D16')}\n`
  );
  const bottomMask = maskBody(`${flashList(smdPassivePads.slice(0, 4), 'D16')}\n`);

  const topPaste = `${header}%ADD12R,1.6500X1.0000*%\n%ADD16R,1.1000X1.2000*%\n${flashList(espLeft, 'D12')}\n${flashList(espRight, 'D12')}\n${flashList(smdPassivePads, 'D16')}\nM02*\n`;
  const bottomPaste = `${header}%ADD16R,1.2000X1.1000*%\n${flashList(smdPassivePads.slice(0, 4), 'D16')}\nM02*\n`;

  const topSilk = `${header}%ADD10C,0.2200*%\nD10*\nX${mm(28)}Y${mm(20)}D02*\nX${mm(50)}Y${mm(20)}D01*\nX${mm(50)}Y${mm(48)}D01*\nX${mm(28)}Y${mm(48)}D01*\nX${mm(28)}Y${mm(20)}D01*\nX${mm(9)}Y${mm(3)}D02*\nX${mm(40)}Y${mm(3)}D01*\nX${mm(40)}Y${mm(11)}D01*\nX${mm(9)}Y${mm(11)}D01*\nX${mm(9)}Y${mm(3)}D01*\nX${mm(10)}Y${mm(30)}D02*\nX${mm(26)}Y${mm(30)}D01*\nX${mm(26)}Y${mm(49)}D01*\nX${mm(10)}Y${mm(49)}D01*\nX${mm(10)}Y${mm(30)}D01*\nX${mm(58)}Y${mm(30)}D02*\nX${mm(76)}Y${mm(30)}D01*\nX${mm(76)}Y${mm(49)}D01*\nX${mm(58)}Y${mm(49)}D01*\nX${mm(58)}Y${mm(30)}D01*\nM02*\n`;

  const bottomSilk = `${header}%ADD10C,0.2200*%\nD10*\nX${mm(34)}Y${mm(24)}D02*\nX${mm(46)}Y${mm(24)}D01*\nX${mm(46)}Y${mm(36)}D01*\nX${mm(34)}Y${mm(36)}D01*\nX${mm(34)}Y${mm(24)}D01*\nM02*\n`;

  const drill = `M48\nMETRIC,TZ\nT1C3.200\nT2C1.000\n%\nT1\n${mounting.map(([x, y]) => `X${x.toFixed(3)}Y${y.toFixed(3)}`).join('\n')}\nT2\n${[...j1Pins, ...j2Pins, ...relayPads]
    .map(([x, y]) => `X${x.toFixed(3)}Y${y.toFixed(3)}`)
    .join('\n')}\nM30\n`;

  return buildParsedBoard('ElectroControl_ESP32_Sample.zip', [
    { name: 'Gerber_BoardOutlineLayer.GKO', content: outline },
    { name: 'Gerber_TopLayer.GTL', content: topCopper },
    { name: 'Gerber_BottomLayer.GBL', content: bottomCopper },
    { name: 'Gerber_TopSolderMaskLayer.GTS', content: topMask },
    { name: 'Gerber_BottomSolderMaskLayer.GBS', content: bottomMask },
    { name: 'Gerber_TopPasteLayer.GTP', content: topPaste },
    { name: 'Gerber_BottomPasteLayer.GBP', content: bottomPaste },
    { name: 'Gerber_TopSilkscreenLayer.GTO', content: topSilk },
    { name: 'Gerber_BottomSilkscreenLayer.GBO', content: bottomSilk },
    { name: 'Drill_PTH_Through.DRL', content: drill },
  ]);
}
