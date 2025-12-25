import { env, SamModel, AutoProcessor, RawImage } from '@xenova/transformers';

// Configure environment for browser usage
env.allowLocalModels = false;
env.useBrowserCache = true;

// Singleton instances
let model: SamModel | null = null;
let processor: AutoProcessor | null = null;
let isModelLoading = false;

// Switching to the standard Base SAM model which is more reliable on the Hub
const MODEL_ID = 'Xenova/sam-vit-b';

export interface Point {
  x: number;
  y: number;
}

/**
 * Initializes the SAM model. Safe to call multiple times.
 */
export const preloadModel = async (): Promise<void> => {
  if (model || isModelLoading) return;
  
  isModelLoading = true;
  try {
    console.log(`Loading SAM model: ${MODEL_ID}...`);
    // Quantized version is smaller (~100MB) and faster for browser
    model = await SamModel.from_pretrained(MODEL_ID, { quantized: true });
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    console.log('SAM model loaded successfully.');
  } catch (error) {
    console.error('Failed to load SAM model:', error);
    isModelLoading = false;
    throw error;
  } finally {
    isModelLoading = false;
  }
};

/**
 * Segments an object within the given bounding box.
 * @param imageUrl The URL (or base64 data URL) of the image.
 * @param box The bounding box [xmin, ymin, xmax, ymax] in pixels.
 * @returns A list of points representing the polygon contour.
 */
export const segmentObject = async (imageUrl: string, box: [number, number, number, number]): Promise<Point[]> => {
  try {
    if (!model || !processor) {
      await preloadModel();
    }
    if (!model || !processor) throw new Error("Model failed to initialize");

    // 1. Prepare Input
    const image = await RawImage.fromURL(imageUrl);
    
    // 2. Run Inference
    // SAM expects input_boxes as [[[x1, y1, x2, y2]]]
    const inputs = await processor(image, { input_boxes: [[box]] });
    const outputs = await model(inputs);

    // 3. Process Mask
    const maskTensor = outputs.pred_masks;
    const maskData = maskTensor.data; 
    
    // Standard SAM output dimensions
    const maskWidth = 256;
    const maskHeight = 256;
    const maskOffset = 0; // Use first mask
    
    // Calculate scaling to map 256x256 back to original WxH
    const origW = image.width;
    const origH = image.height;
    
    // The processor resizes the longest edge of the input image to 1024.
    const longestSide = Math.max(origW, origH);
    const scale = 1024 / longestSide;
    
    // The actual image content within the 1024x1024 buffer:
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);
    
    // In the 256x256 mask, the valid region is proportional
    const validMaskW = Math.floor((newW / 1024) * 256);
    const validMaskH = Math.floor((newH / 1024) * 256);

    // Threshold logits to binary (0 or 1) and Extract Valid Region
    const binaryMask = new Uint8Array(validMaskW * validMaskH);
    
    for (let y = 0; y < validMaskH; y++) {
      for (let x = 0; x < validMaskW; x++) {
        const index = maskOffset * (maskHeight * maskWidth) + y * maskWidth + x;
        if (maskData[index] > 0.0) {
          binaryMask[y * validMaskW + x] = 1;
        }
      }
    }

    // 4. Trace Contour
    const contour = traceContour(binaryMask, validMaskW, validMaskH);
    
    // 5. Scale Contour back to Original Image Space
    const scaleX = origW / validMaskW;
    const scaleY = origH / validMaskH;
    
    const scaledContour = contour.map(p => ({
      x: p.x * scaleX,
      y: p.y * scaleY
    }));

    // 6. Simplify Polygon
    return simplifyPolygon(scaledContour, 3);
  } catch (err) {
    console.warn("Segmentation logic failed, falling back to bounding box.", err);
    // FALLBACK: Return the rectangular box as the "polygon"
    // This allows the app to continue working even if the heavy ML model fails
    const [x1, y1, x2, y2] = box;
    return [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 }
    ];
  }
};

/**
 * Moore-Neighbor Tracing Algorithm (Simplified)
 */
function traceContour(mask: Uint8Array, width: number, height: number): Point[] {
  const points: Point[] = [];
  
  // Find start point
  let startX = -1, startY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) return []; // Empty mask

  let x = startX;
  let y = startY;
  points.push({x, y});
  
  // Directions: N, NE, E, SE, S, SW, W, NW (Clockwise)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  
  const isValid = (tx: number, ty: number) => 
    tx >= 0 && tx < width && ty >= 0 && ty < height && mask[ty * width + tx] === 1;

  let dir = 0; 
  let count = 0;
  const maxIter = width * height * 2;
  
  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8;
      const nx = x + dx[checkDir];
      const ny = y + dy[checkDir];
      
      if (isValid(nx, ny)) {
        x = nx;
        y = ny;
        points.push({x, y});
        dir = checkDir;
        found = true;
        break;
      }
    }
    if (!found) break; 
    count++;
    if (x === startX && y === startY) break;
  } while (count < maxIter);

  return points;
}

/**
 * Ramer-Douglas-Peucker algorithm for polygon simplification
 */
function simplifyPolygon(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance * tolerance;

  let maxSqDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const sqDist = getSqSegDist(points[i], points[0], points[end]);
    if (sqDist > maxSqDist) {
      maxSqDist = sqDist;
      index = i;
    }
  }

  if (maxSqDist > sqTolerance) {
    const left = simplifyPolygon(points.slice(0, index + 1), tolerance);
    const right = simplifyPolygon(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[end]];
}

function getSqSegDist(p: Point, p1: Point, p2: Point): number {
  let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x; y = p2.y;
    } else if (t > 0) {
      x += dx * t; y += dy * t;
    }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}