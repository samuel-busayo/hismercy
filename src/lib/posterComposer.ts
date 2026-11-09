export const MASTER_WIDTH = 1489;
export const MASTER_HEIGHT = 2047;

export interface PhotoAdjustments {
  zoom: number; // 0.4 to 3.0, default 1.0
  offsetX: number; // -100 to 100, default 0
  offsetY: number; // -100 to 100, default 0
  allowOverflow: boolean; // true = Pop-out beyond panel border (like sample), false = clip to cream panel arch
}

export const DEFAULT_ADJUSTMENTS: PhotoAdjustments = {
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  allowOverflow: true,
};

// Coordinates in 1489 x 2047 master space
export const PANEL_COORDS = {
  // Pop-out subject anchor zone matching the client's sample artwork:
  // Bottom sits flush at Y = 2047; top extends above the cream panel (Y = 1623) up to Y = 1482
  popOutZone: {
    centerX: 566,
    bottomY: 2047,
    targetWidth: 490,
    targetHeight: 565, // Rises ~142px above the cream panel top edge (Y=1623)
  },
  // Left-hand cream panel arch (used when allowOverflow is false or for placeholder hint)
  panelArch: {
    x: 319,
    y: 1623,
    width: 470,
    height: 424,
    radii: {
      tl: 126.5, // Exact top-left arch radius of the cream panel on the master flyer
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
    height: 204,
  },
  // Bounding box to cover the existing "USER NAME" placeholder + white stroke
  placeholderCover: {
    x: 835,
    y: 1836,
    width: 305,
    height: 204,
  },
  // Safe region for rendering the visitor's personalised name
  nameBox: {
    centerX: 976,
    minX: 802,
    maxX: 1150,
    maxWidth: 346,
    minY: 1844,
    maxY: 2030,
    maxHeight: 186,
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

/**
 * Extracts the dark cursive ink of "I Will Be There" onto a transparent overlay canvas
 * so it always remains crisp and legible above the visitor's photo in Pop-Out mode.
 */
function getHeadingScriptOverlay(masterFlyer: HTMLImageElement): HTMLCanvasElement | null {
  if (cachedHeadingOverlay) return cachedHeadingOverlay;
  if (typeof document === "undefined") return null;

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
      // Smoothly map ink darkness to alpha
      const alpha = Math.min(255, Math.max(0, Math.round((220 - lum) * 1.65)));
      d[i + 3] = alpha;
    }
  }

  oCtx.putImageData(imgData, 0, 0);
  cachedHeadingOverlay = off;
  return cachedHeadingOverlay;
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

  // For 3 or more words, generate balanced 2-line partitions
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    candidates.push([line1, line2]);
  }

  // Also generate balanced 3-line partitions for longer multi-word names
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
 * Renders the personalised Harvest attendance poster onto the target HTMLCanvasElement.
 * Supports Pop-Out / Overflow cutout placement (extending above the cream panel border
 * like the official sample) as well as panel-clipped placement.
 */
export function renderPersonalisedPoster(
  canvas: HTMLCanvasElement,
  masterFlyer: HTMLImageElement,
  visitorPhoto: HTMLImageElement | null,
  visitorName: string,
  adjustments: PhotoAdjustments = DEFAULT_ADJUSTMENTS,
  options?: { showPhotoPlaceholderHint?: boolean }
): void {
  if (canvas.width !== MASTER_WIDTH) canvas.width = MASTER_WIDTH;
  if (canvas.height !== MASTER_HEIGHT) canvas.height = MASTER_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // 1. Draw the official master flyer at full 1489 x 2047 resolution
  ctx.drawImage(masterFlyer, 0, 0, MASTER_WIDTH, MASTER_HEIGHT);

  // 2. Replace the existing "USER NAME" placeholder when a visitor name is provided
  const trimmedName = visitorName.trim();
  const shouldReplaceName = trimmedName.length > 0;

  if (shouldReplaceName) {
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
      // Optional clipped mode: restrict photo inside the left cream panel arch
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

    // Scale so the subject fills the pop-out height (~565px, rising above the cream panel top edge Y=1623)
    // while preserving the exact aspect ratio of the visitor's photo
    const scaleToPopOutHeight = popOutZone.targetHeight / imgH;
    const scaleToPopOutWidth = popOutZone.targetWidth / imgW;
    const baseScale = adjustments.allowOverflow
      ? Math.min(scaleToPopOutHeight, scaleToPopOutWidth * 1.18)
      : Math.max(panelArch.width / imgW, panelArch.height / imgH);

    const clampedZoom = Math.max(0.4, Math.min(3.0, adjustments.zoom));
    const finalScale = baseScale * clampedZoom;

    const drawW = imgW * finalScale;
    const drawH = imgH * finalScale;

    // Anchor bottom of photo flush with the bottom of the poster (Y = 2047) and centered at X = 566
    const baseX = popOutZone.centerX - drawW * 0.5;
    const baseY = popOutZone.bottomY - drawH;

    // Generous pan range so the user can freely move their cutout beyond the border in any direction
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
    // Subtle guide in editor preview before a photo is chosen (never shown on final download)
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

  // 4. Render the visitor's name using matching red condensed typography (#EC3237 + white stroke)
  if (shouldReplaceName) {
    const { nameBox } = PANEL_COORDS;
    const candidateBreakdowns = computeBalancedNameLines(trimmedName);

    let bestLines = candidateBreakdowns[0];
    let bestFontSize = 36;

    for (const lines of candidateBreakdowns) {
      const startSize = lines.length === 1 ? 94 : lines.length === 2 ? 90 : 62;
      const minSize = 32;
      const lineHeightRatio = lines.length === 1 ? 1.0 : lines.length === 2 ? 0.96 : 0.94;

      for (let size = startSize; size >= minSize; size -= 1) {
        ctx.font = `700 ${size}px "PosterCondensed", "Impact", "Bahnschrift Condensed", "Arial Narrow", sans-serif`;

        const strokePad = Math.max(6, Math.round(size * 0.1));
        const allLinesFitWidth = lines.every(
          (line) => ctx.measureText(line).width + strokePad <= nameBox.maxWidth
        );

        const totalHeight =
          size * 0.85 + (lines.length - 1) * (size * lineHeightRatio);

        if (allLinesFitWidth && totalHeight <= nameBox.maxHeight) {
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

    ctx.save();
    ctx.font = `700 ${bestFontSize}px "PosterCondensed", "Impact", "Bahnschrift Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const lineHeightRatio =
      bestLines.length === 1 ? 1.0 : bestLines.length === 2 ? 0.96 : 0.94;
    const lineStep = bestFontSize * lineHeightRatio;
    const capHeight = bestFontSize * 0.76;
    const totalBlockHeight = capHeight + (bestLines.length - 1) * lineStep;

    const blockTopY =
      nameBox.minY + (nameBox.maxHeight - totalBlockHeight) * 0.46;
    const firstBaselineY = blockTopY + capHeight;

    for (let i = 0; i < bestLines.length; i++) {
      const lineText = bestLines[i];
      const y = firstBaselineY + i * lineStep;

      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(5, bestFontSize * 0.095);
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

    ctx.restore();
  }

  ctx.restore();
}
