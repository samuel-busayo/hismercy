/**
 * Browser-side portrait background removal utility.
 * Uses local MediaPipe Selfie Segmentation (/mediapipe/*) as the primary neural engine,
 * with an automatic canvas flood-matting fallback if WebGL/WASM is unavailable on a device.
 */

// Global singleton so we only initialize the WASM/TFLite model once per session
let segmentationInstancePromise: Promise<any> | null = null;

/**
 * Dynamically loads the MediaPipe SelfieSegmentation script from /mediapipe/selfie_segmentation.js
 * and initializes the local WASM/TFLite model.
 */
async function getSelfieSegmentationInstance(): Promise<any> {
  if (segmentationInstancePromise) {
    return segmentationInstancePromise;
  }

  segmentationInstancePromise = new Promise(async (resolve, reject) => {
    try {
      if (typeof window === "undefined") {
        reject(new Error("Browser environment required"));
        return;
      }

      const win = window as any;

      // Load the local script tag if SelfieSegmentation is not yet on window
      if (!win.SelfieSegmentation) {
        await new Promise<void>((scriptResolve, scriptReject) => {
          const existingScript = document.querySelector(
            'script[src="/mediapipe/selfie_segmentation.js"]'
          );
          if (existingScript) {
            scriptResolve();
            return;
          }
          const script = document.createElement("script");
          script.src = "/mediapipe/selfie_segmentation.js";
          script.async = true;
          script.onload = () => scriptResolve();
          script.onerror = () =>
            scriptReject(new Error("Failed to load local segmentation script"));
          document.head.appendChild(script);
        });
      }

      const SelfieSegmentation = (window as any).SelfieSegmentation;
      if (!SelfieSegmentation) {
        throw new Error("SelfieSegmentation constructor not found");
      }

      const segmenter = new SelfieSegmentation({
        locateFile: (file: string) => `/mediapipe/${file}`,
      });

      segmenter.setOptions({
        modelSelection: 1, // 1 = general/landscape portrait model (high accuracy for head & torso)
      });

      await segmenter.initialize();
      resolve(segmenter);
    } catch (err) {
      segmentationInstancePromise = null;
      reject(err);
    }
  });

  return segmentationInstancePromise;
}

/**
 * Fallback background remover using perimeter color sampling and flood-fill alpha matting
 * in case a mobile browser blocks WebGL/WASM.
 */
function removeBackgroundFallback(sourceImage: HTMLImageElement): HTMLCanvasElement {
  const w = sourceImage.naturalWidth || sourceImage.width;
  const h = sourceImage.naturalHeight || sourceImage.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(sourceImage, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Sample perimeter pixels along top, left, and right edges to estimate background colors
  const samplePoints: Array<[number, number]> = [
    [2, 2],
    [Math.floor(w * 0.25), 2],
    [Math.floor(w * 0.5), 2],
    [Math.floor(w * 0.75), 2],
    [w - 3, 2],
    [2, Math.floor(h * 0.2)],
    [w - 3, Math.floor(h * 0.2)],
    [2, Math.floor(h * 0.45)],
    [w - 3, Math.floor(h * 0.45)],
  ];

  const bgColors: Array<[number, number, number]> = [];
  for (const [sx, sy] of samplePoints) {
    const idx = (Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))) * 4;
    bgColors.push([data[idx], data[idx + 1], data[idx + 2]]);
  }

  const visited = new Uint8Array(w * h);
  const isBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const colorDist = (r: number, g: number, b: number) => {
    let minD = 999999;
    for (let i = 0; i < bgColors.length; i++) {
      const [br, bg, bb] = bgColors[i];
      const dr = r - br;
      const dg = g - bg;
      const db = b - bb;
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < minD) minD = d;
    }
    return minD;
  };

  // Seed flood fill from top, left, and right borders
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    visited[topIdx] = 1;
    queue[tail++] = topIdx;
  }
  for (let y = 1; y < Math.floor(h * 0.85); y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + (w - 1);
    if (!visited[leftIdx]) {
      visited[leftIdx] = 1;
      queue[tail++] = leftIdx;
    }
    if (!visited[rightIdx]) {
      visited[rightIdx] = 1;
      queue[tail++] = rightIdx;
    }
  }

  const threshold = 48;

  while (head < tail) {
    const curr = queue[head++];
    const pIdx = curr * 4;
    const d = colorDist(data[pIdx], data[pIdx + 1], data[pIdx + 2]);

    if (d <= threshold) {
      isBg[curr] = 1;
      const cx = curr % w;
      const cy = Math.floor(curr / w);

      const neighbors = [
        cy > 0 ? curr - w : -1,
        cy < h - 1 ? curr + w : -1,
        cx > 0 ? curr - 1 : -1,
        cx < w - 1 ? curr + 1 : -1,
      ];

      for (const n of neighbors) {
        if (n >= 0 && !visited[n]) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }
  }

  // Apply alpha mask with soft edge transition
  for (let i = 0; i < w * h; i++) {
    if (isBg[i]) {
      data[i * 4 + 3] = 0;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Trims excess transparent padding above the subject's head and on the sides
 * while keeping the bottom edge anchored so the cutout stands naturally at the base of the flyer.
 */
function trimCutoutBounds(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return sourceCanvas;

  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 35) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX >= maxX || minY >= maxY) {
    return sourceCanvas;
  }

  // Add a small breathing margin around head & shoulders, keep bottom flush with maxY
  const padX = Math.round((maxX - minX) * 0.04);
  const padTop = Math.round((maxY - minY) * 0.03);

  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padTop);
  const cropW = Math.min(w - cropX, maxX - minX + padX * 2);
  const cropH = Math.min(h - cropY, maxY - cropY + 2);

  const trimmed = document.createElement("canvas");
  trimmed.width = cropW;
  trimmed.height = cropH;
  const tCtx = trimmed.getContext("2d")!;
  tCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return trimmed;
}

/**
 * Removes the background from a visitor's HTMLImageElement and returns a new HTMLImageElement
 * with a transparent background.
 */
export async function removePhotoBackground(
  sourceImage: HTMLImageElement
): Promise<HTMLImageElement> {
  const origW = sourceImage.naturalWidth || sourceImage.width;
  const origH = sourceImage.naturalHeight || sourceImage.height;

  // Cap processing resolution to 1280px max dimension for fast mobile performance
  const maxDim = 1280;
  const scale = origW > maxDim || origH > maxDim ? maxDim / Math.max(origW, origH) : 1;
  const procW = Math.max(1, Math.round(origW * scale));
  const procH = Math.max(1, Math.round(origH * scale));

  let resultCanvas: HTMLCanvasElement;

  try {
    const segmenter = await getSelfieSegmentationInstance();

    resultCanvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Segmentation timed out"));
      }, 12000);

      segmenter.onResults((results: any) => {
        clearTimeout(timeoutId);
        try {
          const outCanvas = document.createElement("canvas");
          outCanvas.width = procW;
          outCanvas.height = procH;
          const ctx = outCanvas.getContext("2d")!;

          ctx.save();
          ctx.clearRect(0, 0, procW, procH);

          // 1. Draw the neural segmentation mask with a slight 1.5px feather for smooth portrait edges
          ctx.filter = "blur(1.5px)";
          ctx.drawImage(results.segmentationMask, 0, 0, procW, procH);
          ctx.filter = "none";

          // 2. Keep only the foreground person where the mask is opaque
          ctx.globalCompositeOperation = "source-in";
          ctx.drawImage(sourceImage, 0, 0, procW, procH);
          ctx.restore();

          resolve(trimCutoutBounds(outCanvas));
        } catch (err) {
          reject(err);
        }
      });

      segmenter.send({ image: sourceImage }).catch(reject);
    });
  } catch {
    // Fallback if WASM/WebGL segmentation fails
    const fallbackCanvas = removeBackgroundFallback(sourceImage);
    resultCanvas = trimCutoutBounds(fallbackCanvas);
  }

  const dataUrl = resultCanvas.toDataURL("image/png");
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const cutoutImg = new Image();
    cutoutImg.onload = () => resolve(cutoutImg);
    cutoutImg.onerror = (err) => reject(err);
    cutoutImg.src = dataUrl;
  });
}

