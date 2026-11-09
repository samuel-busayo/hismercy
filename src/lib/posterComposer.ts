export const MASTER_WIDTH = 1489;
export const MASTER_HEIGHT = 2047;

// Lightweight preview resolution (0.5x scale) to prevent mobile browser GPU/memory crashes during touch-dragging
export const PREVIEW_WIDTH = 745;
export const PREVIEW_HEIGHT = 1024;

export interface PhotoAdjustments {
  zoom: number; // 0.4 to 3.0, default 1.0
  offsetX: number; // -100 to 100, default 0
  offsetY: number; // -100 to 100, default 0
  allowOverflow: boolean; // true = Pop-out beyond panel border (like sample), false = clip to cream panel arch
  nameScale: number; // 0.5 to 1.3, default 1.0 (allows user to reduce/adjust name text size)
  locationScale: number; // 0.5 to 1.3, default 1.0 (allows user to reduce/adjust location/parish text size)
}

export const DEFAULT_ADJUSTMENTS: PhotoAdjustments = {
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  allowOverflow: true,
  nameScale: 1.0,
  locationScale: 1.0,
};

// Coordinates in 1489 x 2047 master space
export const PANEL_COORDS = {
  // Pop-out subject anchor zone matching the client's sample artwork:
  // Bottom sits flush at Y = 2047; top extends above the cream panel (Y = 1623) up to Y = 1482
  popOutZone: {
    centerX: 566,
    bottomY: 2047,
    targetWidth: 490,
    targetHeight: 565,
  },
  // Left-hand cream panel arch (used when allowOverflow is false or for placeholder hint)
  panelArch: {
    x: 319,
    y: 1623,
    width: 470,
    height: 424,
    radii: {
      tl: 126.5,
      tr: 36,
      br: 0,
      bl: 0,
    },
  },
  // Clean vertical gradient source slice inside the cream panel (free of text)
  gradientSource: {
    x: 796,
    y: 1836,
    width: 34,
    height: 208,
  },
  // Bounding box to cover the existing "USER NAME" placeholder + white stroke
  placeholderCover: {
    x: 830,
    y: 1836,
    width: 315,
    height: 208,
  },
  // Safe region for rendering the visitor's personalised name and location/parish
  nameBox: {
    centerX: 976,
    minX: 800,
    maxX: 1152,
    maxWidth: 348,
    minY: 1840,
    maxYWithLocation: 1984,
    maxYWithoutLocation: 2030,
  },
  // Bounding box of the cursive "I Will Be There" heading on the master flyer
  headingScriptBox: {
    x: 798,
    y: 1748,
    width: 356,
    height: 88,
  },
} as const;

let cachedHeadingOverlay: HTMLCanvasElement | null = null;

// Cache name measurement results so touch-dragging the photo at 60fps doesn't re-run font measurement loops
let cachedNameLayoutKey = "";
let cachedNameLayoutResult: { lines: string[]; fontSize: number } | null = null;

/**
 * Extracts the dark cursive ink of "I Will Be There" onto a transparent overlay canvas
 * so it always remains crisp and legible above the visitor's photo in Pop-Out mode.
 */
function getHeadingScriptOverlay(
  masterFlyer: HTMLImageElement
): HTMLCanvasElement | null {
  if (cachedHeadingOverlay) return cachedHeadingOverlay;
  if (typeof document === "undefined") return null;

  try {
    const { x, y, width, height } = PANEL_COORDS.headingScriptBox;
    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    const oCtx = off.getContext("2d");
    if (!oCtx) return null;

    oCtx.drawImage(masterFlyer, x, y, width, height, 0, 0, width, height);
    const imgData = oCtx.getImageData(0, 0, width, height);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (lum > 215) {
        d[i + 3] = 0;
      } else {
        const alpha = Math.min(255, Math.max(0, Math.round((220 - lum) * 1.65)));
        d[i + 3] = alpha;
      }
    }

    oCtx.putImageData(imgData, 0, 0);
    cachedHeadingOverlay = off;
    return cachedHeadingOverlay;
  } catch {
    return null;
  }
}

/**
 * Helper to create a rounded arch path with independent corner radii.
 */
function traceRoundedArchPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: { tl: number; tr: number; br: number; bl: number }
) {
  ctx.beginPath();
  ctx.moveTo(x + radii.tl, y);
  ctx.lineTo(x + w - radii.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radii.tr);
  ctx.lineTo(x + w, y + h - radii.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radii.br, y + h);
  ctx.lineTo(x + radii.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radii.bl);
  ctx.lineTo(x, y + radii.tl);
  ctx.quadraticCurveTo(x, y, x + radii.tl, y);
  ctx.closePath();
}

/**
 * Splits a visitor's name into balanced lines (1, 2, or 3 lines) so it mimics
 * the stacked "USER / NAME" hierarchy of the original flyer while adapting to long names.
 */
export function computeBalancedNameLines(rawName: string): string[][] {
  const cleaned = rawName
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

  if (!cleaned) {
    return [["USER", "NAME"]];
  }

  const words = cleaned.split(" ");
  const candidates: string[][] = [];

  if (words.length === 1) {
    const word = words[0];
    candidates.push([word]);
    if (word.length > 14) {
      const mid = Math.ceil(word.length / 2);
      candidates.push([word.slice(0, mid) + "-", word.slice(mid)]);
    }
    return candidates;
  }

  if (words.length === 2) {
    candidates.push([words[0], words[1]]);
    if (cleaned.length <= 10) {
      candidates.push([cleaned]);
    }
    return candidates;
  }

  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    candidates.push([line1, line2]);
  }

  if (words.length >= 3) {
    for (let i = 1; i < words.length - 1; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const line1 = words.slice(0, i).join(" ");
        const line2 = words.slice(i, j).join(" ");
        const line3 = words.slice(j).join(" ");
        candidates.push([line1, line2, line3]);
      }
    }
  }

  return candidates;
}

/**
 * Formats the user's location or parish string wrapped in parentheses like "([Location Or Parish])"
 */
export function formatLocationOrParish(rawLocation: string): string {
  const trimmed = rawLocation.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed;
  }
  return `(${trimmed})`;
}

/**
 * Computes and caches the best line split and base font size for the visitor's name.
 */
function getOptimalNameLayout(
  ctx: CanvasRenderingContext2D,
  trimmedName: string,
  hasLocation: boolean
): { lines: string[]; fontSize: number } {
  const cacheKey = `${trimmedName}__${hasLocation ? "loc" : "noloc"}`;
  if (cachedNameLayoutKey === cacheKey && cachedNameLayoutResult) {
    return cachedNameLayoutResult;
  }

  const { nameBox } = PANEL_COORDS;
  const availableMaxHeight = hasLocation
    ? nameBox.maxYWithLocation - nameBox.minY
    : nameBox.maxYWithoutLocation - nameBox.minY;

  const candidateBreakdowns = computeBalancedNameLines(trimmedName);
  let bestLines = candidateBreakdowns[0];
  let bestFontSize = 34;

  for (const lines of candidateBreakdowns) {
    const startSize =
      lines.length === 1
        ? hasLocation
          ? 86
          : 94
        : lines.length === 2
        ? hasLocation
          ? 82
          : 90
        : hasLocation
        ? 56
        : 62;
    const minSize = 28;
    const lineHeightRatio =
      lines.length === 1 ? 1.0 : lines.length === 2 ? 0.94 : 0.92;

    for (let size = startSize; size >= minSize; size -= 2) {
      ctx.font = `700 ${size}px "PosterCondensed", "Impact", "Bahnschrift Condensed", "Arial Narrow", sans-serif`;

      const strokePad = Math.max(6, Math.round(size * 0.1));
      const allLinesFitWidth = lines.every(
        (line) => ctx.measureText(line).width + strokePad <= nameBox.maxWidth
      );

      const totalHeight =
        size * 0.82 + (lines.length - 1) * (size * lineHeightRatio);

      if (allLinesFitWidth && totalHeight <= availableMaxHeight) {
        const effectiveScore = lines.length <= 2 ? size * 1.08 : size;
        const currentBestScore =
          bestLines.length <= 2 ? bestFontSize * 1.08 : bestFontSize;

        if (effectiveScore > currentBestScore) {
          bestFontSize = size;
          bestLines = lines;
        }
        break;
      }
    }
  }

  cachedNameLayoutKey = cacheKey;
  cachedNameLayoutResult = { lines: bestLines, fontSize: bestFontSize };
  return cachedNameLayoutResult;
}

/**
 * Renders the personalised Harvest attendance poster onto the target HTMLCanvasElement.
 * Supports rendering at either PREVIEW_WIDTH x PREVIEW_HEIGHT (fast mobile preview)
 * or MASTER_WIDTH x MASTER_HEIGHT (full-resolution PNG export).
 */
export function renderPersonalisedPoster(
  canvas: HTMLCanvasElement,
  masterFlyer: HTMLImageElement,
  visitorPhoto: HTMLImageElement | null,
  visitorName: string,
  adjustments: PhotoAdjustments = DEFAULT_ADJUSTMENTS,
  options?: {
    showPhotoPlaceholderHint?: boolean;
    visitorLocation?: string;
    targetWidth?: number;
    targetHeight?: number;
  }
): void {
  const outW = options?.targetWidth || MASTER_WIDTH;
  const outH = options?.targetHeight || MASTER_HEIGHT;

  if (canvas.width !== outW) canvas.width = outW;
  if (canvas.height !== outH) canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Scale coordinate system so all drawing commands use 1489 x 2047 master coordinates
  const scaleX = outW / MASTER_WIDTH;
  const scaleY = outH / MASTER_HEIGHT;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }

  // 1. Draw the official master flyer
  ctx.drawImage(masterFlyer, 0, 0, MASTER_WIDTH, MASTER_HEIGHT);

  const trimmedName = visitorName.trim();
  const formattedLocation = formatLocationOrParish(options?.visitorLocation || "");
  const shouldReplacePlaceholder =
    trimmedName.length > 0 || formattedLocation.length > 0;

  // 2. Replace the existing "USER NAME" placeholder when name or location is entered
  if (shouldReplacePlaceholder) {
    const { gradientSource, placeholderCover } = PANEL_COORDS;
    ctx.drawImage(
      masterFlyer,
      gradientSource.x,
      gradientSource.y,
      gradientSource.width,
      gradientSource.height,
      placeholderCover.x,
      placeholderCover.y,
      placeholderCover.width,
      placeholderCover.height
    );
  }

  // 3. Draw the visitor's photograph (Pop-Out beyond panel border by default, matching the sample)
  const { popOutZone, panelArch } = PANEL_COORDS;

  if (visitorPhoto) {
    ctx.save();

    const imgW = visitorPhoto.naturalWidth || visitorPhoto.width;
    const imgH = visitorPhoto.naturalHeight || visitorPhoto.height;

    if (!adjustments.allowOverflow) {
      traceRoundedArchPath(
        ctx,
        panelArch.x,
        panelArch.y,
        panelArch.width,
        panelArch.height,
        panelArch.radii
      );
      ctx.clip();
    }

    const scaleToPopOutHeight = popOutZone.targetHeight / imgH;
    const scaleToPopOutWidth = popOutZone.targetWidth / imgW;
    const baseScale = adjustments.allowOverflow
      ? Math.min(scaleToPopOutHeight, scaleToPopOutWidth * 1.18)
      : Math.max(panelArch.width / imgW, panelArch.height / imgH);

    const clampedZoom = Math.max(0.4, Math.min(3.0, adjustments.zoom));
    const finalScale = baseScale * clampedZoom;

    const drawW = imgW * finalScale;
    const drawH = imgH * finalScale;

    const baseX = popOutZone.centerX - drawW * 0.5;
    const baseY = popOutZone.bottomY - drawH;

    const maxPanX = 480;
    const maxPanY = 480;

    const translateX = (adjustments.offsetX / 100) * maxPanX;
    const translateY = (adjustments.offsetY / 100) * maxPanY;

    ctx.drawImage(
      visitorPhoto,
      baseX + translateX,
      baseY + translateY,
      drawW,
      drawH
    );

    ctx.restore();

    // Ensure "I Will Be There" cursive heading stays in the foreground above any photo overflow
    const headingOverlay = getHeadingScriptOverlay(masterFlyer);
    if (headingOverlay) {
      const { headingScriptBox } = PANEL_COORDS;
      ctx.drawImage(
        headingOverlay,
        headingScriptBox.x,
        headingScriptBox.y,
        headingScriptBox.width,
        headingScriptBox.height
      );
    }
  } else if (options?.showPhotoPlaceholderHint) {
    ctx.save();
    traceRoundedArchPath(
      ctx,
      panelArch.x + 18,
      panelArch.y + 18,
      panelArch.width - 36,
      panelArch.height - 36,
      { tl: 108, tr: 32, br: 24, bl: 24 }
    );
    ctx.fillStyle = "rgba(122, 18, 36, 0.05)";
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(122, 18, 36, 0.32)";
    ctx.stroke();

    ctx.fillStyle = "rgba(122, 18, 36, 0.55)";
    ctx.font = '700 24px "PosterCondensed", "Impact", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "YOUR PHOTO HERE",
      panelArch.x + panelArch.width / 2,
      panelArch.y + panelArch.height / 2
    );
    ctx.restore();
  }

  // 4. Render the visitor's Name AND Location/Parish
  if (shouldReplacePlaceholder) {
    const { nameBox } = PANEL_COORDS;
    const displayName = trimmedName || "USER NAME";
    const hasLocation = formattedLocation.length > 0;

    const { lines: bestLines, fontSize: autoFontSize } = getOptimalNameLayout(
      ctx,
      displayName,
      hasLocation
    );

    // Apply user's Name text size multiplier (0.5x to 1.3x, default 1.0x)
    const nameScale = Math.max(0.45, Math.min(1.35, adjustments.nameScale ?? 1.0));
    const finalNameFontSize = Math.max(22, Math.round(autoFontSize * nameScale));

    ctx.save();
    ctx.font = `700 ${finalNameFontSize}px "PosterCondensed", "Impact", "Bahnschrift Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const lineHeightRatio =
      bestLines.length === 1 ? 1.0 : bestLines.length === 2 ? 0.94 : 0.92;
    const lineStep = finalNameFontSize * lineHeightRatio;
    const capHeight = finalNameFontSize * 0.76;
    const nameBlockHeight = capHeight + (bestLines.length - 1) * lineStep;

    const availableNameHeight =
      (hasLocation ? nameBox.maxYWithLocation : nameBox.maxYWithoutLocation) -
      nameBox.minY;

    const blockTopY =
      nameBox.minY + Math.max(0, (availableNameHeight - nameBlockHeight) * 0.45);
    const firstBaselineY = blockTopY + capHeight;

    let lastLineBaselineY = firstBaselineY;

    for (let i = 0; i < bestLines.length; i++) {
      const lineText = bestLines[i];
      const y = firstBaselineY + i * lineStep;
      lastLineBaselineY = y;

      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(4.5, finalNameFontSize * 0.095);
      ctx.strokeStyle = "#FFFFFF";
      ctx.shadowColor = "rgba(0, 0, 0, 0.14)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.strokeText(lineText, nameBox.centerX, y);

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = "#EC3237";
      ctx.fillText(lineText, nameBox.centerX, y);
    }

    // 5. Render Location or Parish directly below the Name (matching sample placement: "([Location Or Parish])")
    if (hasLocation) {
      const locScale = Math.max(
        0.45,
        Math.min(1.35, adjustments.locationScale ?? 1.0)
      );

      // Determine auto-fit base size for location text so long parish/city names fit comfortably
      let baseLocSize = 31;
      for (let s = 31; s >= 16; s -= 1) {
        ctx.font = `700 ${s}px "Segoe UI", Roboto, Arial, sans-serif`;
        if (ctx.measureText(formattedLocation).width <= nameBox.maxWidth + 16) {
          baseLocSize = s;
          break;
        }
      }

      const finalLocSize = Math.max(14, Math.round(baseLocSize * locScale));
      ctx.font = `700 ${finalLocSize}px "Segoe UI", Roboto, Arial, sans-serif`;

      // Position cleanly below the name block, clamped within the bottom of the cream panel
      const idealLocY = lastLineBaselineY + Math.max(26, finalLocSize * 1.18);
      const locBaselineY = Math.min(2034, Math.max(idealLocY, 1998));

      // Subtle light halo stroke so dark text reads clearly over the bottom warm-grey panel gradient
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2.5, finalLocSize * 0.1);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      ctx.strokeText(formattedLocation, nameBox.centerX, locBaselineY);

      ctx.fillStyle = "#161213";
      ctx.fillText(formattedLocation, nameBox.centerX, locBaselineY);
    }

    ctx.restore();
  }

  ctx.restore();
}
