import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeneratedImage } from '../types';
import { Button } from './Button';
import { extractElementFromImage, removeBackground } from '../services/geminiService';
import { segmentObject } from '../services/segmentationService';
import { 
  Download, 
  Eraser, 
  AlertCircle, 
  Type, 
  Loader2,
  PenTool,
  Move,
  CheckCircle2,
  RotateCcw,
  Maximize,
  Wand2,
  BoxSelect,
  MousePointer2,
  ScanLine,
  ZoomIn,
  ZoomOut,
  Maximize as FitIcon,
  Search,
  Undo,
  Redo
} from 'lucide-react';

interface ExtractionPanelProps {
  sourceImage: GeneratedImage;
  onClose: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface Polygon {
  points: Point[];
  isClosed: boolean;
  boundingBox: { x: number, y: number, w: number, h: number };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ExtractionPanel: React.FC<ExtractionPanelProps> = ({ sourceImage, onClose }) => {
  // Modes
  const [inputMode, setInputMode] = useState<'text' | 'draw' | 'smart'>('text');
  const [viewMode, setViewMode] = useState<'source' | 'result'>('source');

  // Viewport State (Zoom/Pan)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  // Text Prompt State
  const [prompt, setPrompt] = useState('');
  
  // Polygon / Pen Tool State
  const [polygon, setPolygon] = useState<Polygon | null>(null);
  
  // History State
  const [history, setHistory] = useState<(Polygon | null)[]>([]);
  const [future, setFuture] = useState<(Polygon | null)[]>([]);

  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  const [isDraggingPolygon, setIsDraggingPolygon] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<Point | null>(null);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [isPolygonHovered, setIsPolygonHovered] = useState(false);

  // Smart Select State
  const [selectionBox, setSelectionBox] = useState<Box | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [dragStartBoxPos, setDragStartBoxPos] = useState<Point | null>(null);
  
  // Settings
  const [keepOriginalSize, setKeepOriginalSize] = useState(true);
  const [useAIBackgroundRemoval, setUseAIBackgroundRemoval] = useState(true);
  const [tolerance, setTolerance] = useState(15);
  const [edgeSoftness, setEdgeSoftness] = useState(2); // New: Anti-aliasing
  const [removeWhite, setRemoveWhite] = useState(false); 

  // Image Processing State
  const [extractedBase64, setExtractedBase64] = useState<string | null>(null);
  const [processedBase64, setProcessedBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgDimensions, setImgDimensions] = useState<{w: number, h: number} | null>(null);
  
  // Refs
  const viewportRef = useRef<HTMLDivElement>(null); // The scrollable/padded area
  const workspaceRef = useRef<HTMLDivElement>(null); // The container that gets transformed
  const canvasRef = useRef<HTMLCanvasElement>(null); // Overlay canvas
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null); 
  const imgRef = useRef<HTMLImageElement>(null); // The actual image element

  // Constants for drawing
  const POINT_RADIUS = 6; // Slightly larger for better hit target
  const HANDLE_COLOR = '#6366f1'; // Indigo 500
  const HOVER_COLOR = '#ef4444'; // Red 500
  const LINE_COLOR = '#818cf8'; // Indigo 400
  const FILL_COLOR = 'rgba(99, 102, 241, 0.2)';

  // Switch to result view automatically when extraction finishes
  useEffect(() => {
    if (processedBase64) {
      setViewMode('result');
    }
  }, [processedBase64]);

  // Reset selections when switching modes
  useEffect(() => {
    // Only clear if switching away from geometric modes to text, or vice versa
    if (inputMode === 'text') {
        setPolygon(null);
        setSelectionBox(null);
        setHistory([]);
        setFuture([]);
    }
    setViewMode('source');
  }, [inputMode]);

  // Keyboard shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (inputMode === 'text') return; // Don't undo while typing

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                handleRedo();
            } else {
                handleUndo();
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
             e.preventDefault();
             handleRedo();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, future, polygon, inputMode]);

  // Initial Fit
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgDimensions({ w: naturalWidth, h: naturalHeight });
    
    // Auto fit
    if (viewportRef.current) {
        const { clientWidth, clientHeight } = viewportRef.current;
        const padding = 40;
        const scaleX = (clientWidth - padding) / naturalWidth;
        const scaleY = (clientHeight - padding) / naturalHeight;
        const fitScale = Math.min(scaleX, scaleY, 1);
        
        setScale(fitScale);
        // Center
        setOffset({
            x: (clientWidth - naturalWidth * fitScale) / 2,
            y: (clientHeight - naturalHeight * fitScale) / 2
        });
    }
  };

  // --- History Helpers ---

  const addToHistory = () => {
    setHistory(prev => [...prev, polygon]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    
    setFuture(prev => [polygon, ...prev]);
    setHistory(newHistory);
    setPolygon(previous);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setHistory(prev => [...prev, polygon]);
    setFuture(newFuture);
    setPolygon(next);
  };

  // --- Zoom / Pan Helpers ---

  const handleZoom = (delta: number, center?: Point) => {
    setScale(prev => {
      const newScale = Math.max(0.1, Math.min(5, prev + delta));
      
      // If centering is provided (e.g. from mouse wheel), adjust offset to zoom towards mouse
      if (center && viewportRef.current) {
        // Calculate mouse position relative to image top-left (in screen pixels)
        const rect = viewportRef.current.getBoundingClientRect();
        const mouseX = center.x - rect.left;
        const mouseY = center.y - rect.top;
        
        // This math keeps the point under the mouse stationary
        // offset_new = mouse - (mouse - offset_old) * (newScale / oldScale)
        setOffset(prevOffset => ({
            x: mouseX - (mouseX - prevOffset.x) * (newScale / prev),
            y: mouseY - (mouseY - prevOffset.y) * (newScale / prev)
        }));
      } else {
        // Center zoom: roughly keep center
        if (viewportRef.current && imgDimensions) {
            const cx = viewportRef.current.clientWidth / 2;
            const cy = viewportRef.current.clientHeight / 2;
             setOffset(prevOffset => ({
                x: cx - (cx - prevOffset.x) * (newScale / prev),
                y: cy - (cy - prevOffset.y) * (newScale / prev)
            }));
        }
      }

      return newScale;
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Ctrl+Wheel or just Wheel for zoom? Let's use Wheel for zoom for convenience in tool
    const delta = -e.deltaY * 0.001 * scale;
    handleZoom(delta, { x: e.clientX, y: e.clientY });
  };

  const resetView = () => {
    if (viewportRef.current && imgDimensions) {
         const { clientWidth, clientHeight } = viewportRef.current;
         const padding = 40;
         const scaleX = (clientWidth - padding) / imgDimensions.w;
         const scaleY = (clientHeight - padding) / imgDimensions.h;
         const fitScale = Math.min(scaleX, scaleY, 1);
         setScale(fitScale);
         setOffset({
             x: (clientWidth - imgDimensions.w * fitScale) / 2,
             y: (clientHeight - imgDimensions.h * fitScale) / 2
         });
    }
  };

  // --- Coordinate Mapping Helpers ---

  // Converts a Mouse Event client coordinate to Image Space coordinate
  const getMousePosInImageSpace = (e: React.MouseEvent | MouseEvent): Point | null => {
    if (!viewportRef.current) return null;
    const rect = viewportRef.current.getBoundingClientRect();
    
    // Mouse relative to viewport
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    
    // Subtract offset and divide by scale
    const ix = (vx - offset.x) / scale;
    const iy = (vy - offset.y) / scale;
    
    return { x: ix, y: iy };
  };

  // --- Canvas Rendering Loop ---
  
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgDimensions || viewMode !== 'source') return;
    
    // The canvas is INSIDE the transformed div, so it matches Image Coordinates 1:1.
    // We just need to ensure resolution matches image.
    if (canvas.width !== imgDimensions.w || canvas.height !== imgDimensions.h) {
        canvas.width = imgDimensions.w;
        canvas.height = imgDimensions.h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // No need to translate/scale context, the CSS transform handles the view.
    // We draw in Image Space coordinates.

    // 1. Draw Selection Box (Smart Mode)
    if (selectionBox) {
        ctx.strokeStyle = '#3b82f6'; // Blue
        ctx.lineWidth = 2 / scale; // Scale stroke width to be constant on screen
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
        ctx.setLineDash([]);
    }

    // 2. Draw Polygon
    if (polygon) {
      // Fill
      if (polygon.isClosed) {
        ctx.beginPath();
        ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
        for (let i = 1; i < polygon.points.length; i++) {
          ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = isPolygonHovered ? 'rgba(99, 102, 241, 0.3)' : FILL_COLOR;
        ctx.fill();

        // Bounding Box hint
        const { x, y, w, h } = polygon.boundingBox;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([4 / scale, 4 / scale]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }

      // Lines
      ctx.beginPath();
      if (polygon.points.length > 0) {
        ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
        for (let i = 1; i < polygon.points.length; i++) {
          ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
        }
        if (polygon.isClosed) {
          ctx.closePath();
        }
      }
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // Vertices (Only show handles in Draw mode or if polygon exists)
      const handleRadius = POINT_RADIUS / scale;
      polygon.points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, handleRadius, 0, Math.PI * 2);
        ctx.fillStyle = hoveredPointIndex === i ? HOVER_COLOR : HANDLE_COLOR;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();
      });
    }

  }, [polygon, selectionBox, inputMode, hoveredPointIndex, isPolygonHovered, viewMode, imgDimensions, scale]);

  useEffect(() => {
    let animationFrameId: number;
    const loop = () => {
        drawCanvas();
        animationFrameId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [drawCanvas]);

  // --- Helpers ---

  const getDistance = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

  const calculateBoundingBox = (points: Point[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const isPointInPolygon = (p: Point, points: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // --- Interaction Logic (Unified) ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (viewMode !== 'source') return;
    
    // Middle Mouse or Spacebar held -> Pan
    if (e.button === 1 || e.shiftKey || inputMode === 'text') { 
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        e.preventDefault();
        return;
    }

    const pos = getMousePosInImageSpace(e);
    if (!pos) return;

    if (inputMode === 'smart') {
        setDragStartBoxPos(pos);
        setSelectionBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
        setPolygon(null); 
        return;
    }

    if (inputMode === 'draw') {
        if (polygon) {
            const hitRadius = (POINT_RADIUS + 4) / scale; 

            for (let i = 0; i < polygon.points.length; i++) {
                if (getDistance(pos, polygon.points[i]) <= hitRadius) {
                    if (i === 0 && !polygon.isClosed && polygon.points.length > 2) {
                        addToHistory();
                        setPolygon(prev => prev ? { 
                            ...prev, 
                            isClosed: true, 
                            boundingBox: calculateBoundingBox(prev.points) 
                        } : null);
                        return;
                    }
                    addToHistory(); 
                    setDraggedPointIndex(i);
                    return;
                }
            }
            if (polygon.isClosed && isPointInPolygon(pos, polygon.points)) {
                addToHistory(); 
                setIsDraggingPolygon(true);
                setDragStartPos(pos);
                return;
            }
        }

        if (!polygon || !polygon.isClosed) {
            addToHistory(); 
            setPolygon(prev => {
                const newPoints = prev ? [...prev.points, pos] : [pos];
                return {
                    points: newPoints,
                    isClosed: false,
                    boundingBox: calculateBoundingBox(newPoints)
                };
            });
        }
    }
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
        if (viewMode !== 'source') return;
        
        if (isPanning && panStart) {
            const dx = e.clientX - panStart.x;
            const dy = e.clientY - panStart.y;
            setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setPanStart({ x: e.clientX, y: e.clientY });
            return;
        }

        const pos = getMousePosInImageSpace(e);
        if (!pos) return;

        if (inputMode === 'smart' && dragStartBoxPos) {
            const x = Math.min(pos.x, dragStartBoxPos.x);
            const y = Math.min(pos.y, dragStartBoxPos.y);
            const w = Math.abs(pos.x - dragStartBoxPos.x);
            const h = Math.abs(pos.y - dragStartBoxPos.y);
            setSelectionBox({ x, y, w, h });
            return;
        }

        if (inputMode === 'draw') {
             if (polygon) {
                const hitRadius = (POINT_RADIUS + 4) / scale;
                let foundPoint = false;
                for (let i = 0; i < polygon.points.length; i++) {
                    if (getDistance(pos, polygon.points[i]) <= hitRadius) {
                        setHoveredPointIndex(i);
                        foundPoint = true;
                        break;
                    }
                }
                if (!foundPoint) setHoveredPointIndex(null);
                
                if (!foundPoint && polygon.isClosed) {
                    setIsPolygonHovered(isPointInPolygon(pos, polygon.points));
                } else {
                    setIsPolygonHovered(false);
                }
            }

            if (draggedPointIndex !== null && polygon) {
                const newPoints = [...polygon.points];
                newPoints[draggedPointIndex] = pos;
                setPolygon({
                    ...polygon,
                    points: newPoints,
                    boundingBox: calculateBoundingBox(newPoints)
                });
            } else if (isDraggingPolygon && dragStartPos && polygon) {
                const dx = pos.x - dragStartPos.x;
                const dy = pos.y - dragStartPos.y;
                const newPoints = polygon.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                setPolygon({
                    ...polygon,
                    points: newPoints,
                    boundingBox: calculateBoundingBox(newPoints)
                });
                setDragStartPos(pos);
            }
        }
    };

    const handleWindowMouseUp = async () => {
        if (isPanning) {
            setIsPanning(false);
            setPanStart(null);
        }

        if (inputMode === 'smart' && dragStartBoxPos && selectionBox) {
            setDragStartBoxPos(null);
            if (selectionBox.w > 5 && selectionBox.h > 5) {
                setIsSegmenting(true);
                try {
                    const imgData = `data:image/png;base64,${sourceImage.data}`;
                    const points = await segmentObject(imgData, [
                        selectionBox.x, selectionBox.y, 
                        selectionBox.x + selectionBox.w, selectionBox.y + selectionBox.h
                    ]);
                    
                    if (points.length > 2) {
                        addToHistory(); 
                        setPolygon({
                            points,
                            isClosed: true,
                            boundingBox: calculateBoundingBox(points)
                        });
                        setInputMode('draw');
                        setSelectionBox(null);
                    }
                } catch (err) {
                    console.error("Segmentation failed", err);
                    setError("Smart selection failed. Try again or use Pen.");
                } finally {
                    setIsSegmenting(false);
                }
            } else {
                setSelectionBox(null); 
            }
        }

        setDraggedPointIndex(null);
        setIsDraggingPolygon(false);
        setDragStartPos(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [inputMode, dragStartBoxPos, selectionBox, draggedPointIndex, isDraggingPolygon, dragStartPos, polygon, sourceImage, viewMode, isPanning, panStart, scale]);


  const handleResetPolygon = () => {
    addToHistory();
    setPolygon(null);
    setSelectionBox(null);
    setExtractedBase64(null);
    setProcessedBase64(null);
    setViewMode('source');
  };

  // --- Extraction Actions ---

  const handleExtract = async () => {
    if (inputMode === 'text' && !prompt.trim()) return;
    if ((inputMode === 'draw' || inputMode === 'smart') && (!polygon || !polygon.isClosed)) {
      setError("Please select an area first.");
      return;
    }
    
    setLoading(true);
    setError(null);
    setExtractedBase64(null);
    setProcessedBase64(null);

    try {
      if (inputMode === 'draw' || inputMode === 'smart') {
        const img = imgRef.current; // FIX: Ensure this is the <img> element, not the div
        if (!img || !polygon) throw new Error("Image source missing");

        const { x, y, w, h } = polygon.boundingBox;
        
        const generateCrop = () => {
             const canvas = document.createElement('canvas');
             canvas.width = w;
             canvas.height = h;
             const ctx = canvas.getContext('2d');
             if(!ctx) return null;
             
             ctx.translate(-x, -y);
             
             ctx.beginPath();
             ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
             for (let i = 1; i < polygon.points.length; i++) {
                 ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
             }
             ctx.closePath();
             ctx.clip();
             
             // Draw original image using intrinsic dimensions
             ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
             return canvas.toDataURL('image/png');
        };

        const cropDataUrl = generateCrop();
        if (!cropDataUrl) throw new Error("Failed to crop image");
        
        const cropBase64 = cropDataUrl.split(',')[1];
        let finalSegmentBase64 = cropBase64;
        let needsWhiteRemoval = false;

        if (useAIBackgroundRemoval) {
             finalSegmentBase64 = await removeBackground(cropBase64);
             needsWhiteRemoval = true;
        }

        if (keepOriginalSize) {
             const fullCanvas = document.createElement('canvas');
             fullCanvas.width = img.naturalWidth;
             fullCanvas.height = img.naturalHeight;
             const ctx = fullCanvas.getContext('2d');
             if(!ctx) throw new Error("Canvas context failed");
             
             const segmentImg = new Image();
             segmentImg.src = `data:image/png;base64,${finalSegmentBase64}`;
             await new Promise((resolve) => { segmentImg.onload = resolve; });
             
             ctx.drawImage(segmentImg, x, y, w, h);
             finalSegmentBase64 = fullCanvas.toDataURL('image/png').split(',')[1];
        }

        setExtractedBase64(finalSegmentBase64);
        setRemoveWhite(needsWhiteRemoval);

      } else {
        const result = await extractElementFromImage(sourceImage.data, prompt);
        setExtractedBase64(result);
        setRemoveWhite(true);
      }
    } catch (err: any) {
      setError(err.message || "Failed to extract element.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!extractedBase64) return;
    
    if (!removeWhite) {
        setProcessedBase64(`data:image/png;base64,${extractedBase64}`);
        return;
    }

    const processImage = () => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = hiddenCanvasRef.current;
        if (!canvas) return;

        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);

        if (removeWhite) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          const tol = tolerance;
          const soft = edgeSoftness;
          
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a === 0) continue;

            const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);

            if (dist < tol) {
              data[i + 3] = 0;
            } else if (dist < tol + soft * 10) { 
              const range = soft * 10;
              const alphaFactor = (dist - tol) / range; 
              data[i + 3] = Math.floor(a * alphaFactor);
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
        
        setProcessedBase64(canvas.toDataURL('image/png'));
      };
      img.src = extractedBase64.startsWith('data:') ? extractedBase64 : `data:image/png;base64,${extractedBase64}`;
    };

    processImage();
  }, [extractedBase64, tolerance, removeWhite, edgeSoftness]);

  const handleDownload = () => {
    if (!processedBase64) return;
    const link = document.createElement('a');
    link.href = processedBase64;
    link.download = `extracted-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Eraser className="w-5 h-5 text-indigo-400" />
          Extract Element
        </h2>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm underline">
          Close & Return
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full min-h-0">
        <div className="space-y-6 flex flex-col overflow-y-auto pr-1">
          <div className="bg-slate-800 p-1 rounded-xl border border-slate-700 flex gap-1">
            <button 
              onClick={() => setInputMode('text')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-1 rounded-lg text-xs md:text-sm font-medium transition-all ${inputMode === 'text' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              title="Describe object"
            >
              <Type className="w-4 h-4" /> Text
            </button>
            <button 
              onClick={() => setInputMode('smart')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-1 rounded-lg text-xs md:text-sm font-medium transition-all ${inputMode === 'smart' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              title="Smart Box Selection"
            >
              <ScanLine className="w-4 h-4" /> Smart
            </button>
            <button 
              onClick={() => setInputMode('draw')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-1 rounded-lg text-xs md:text-sm font-medium transition-all ${inputMode === 'draw' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
              title="Manual Polygon Tool"
            >
              <PenTool className="w-4 h-4" /> Pen
            </button>
          </div>

          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4">
            {inputMode === 'text' && (
              <>
                <label className="block text-sm font-medium text-slate-300">
                  What should be extracted?
                </label>
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., the red car"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </>
            )}

            {(inputMode === 'draw' || inputMode === 'smart') && (
              <div className="text-sm text-slate-300 space-y-3">
                <div className="flex items-start gap-2">
                    {inputMode === 'smart' ? (
                         <><MousePointer2 className="w-4 h-4 text-indigo-400 mt-0.5" /><p>Drag a box around the object to auto-detect. <br/><span className="text-xs text-slate-500">Hold Space or Middle Click to Pan.</span></p></>
                    ) : (
                         <><PenTool className="w-4 h-4 text-indigo-400 mt-0.5" /><p>Click to add points. <br/><span className="text-xs text-slate-500">Hold Space or Middle Click to Pan.</span></p></>
                    )}
                </div>
                
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-900/50 p-2 rounded border border-slate-700 hover:bg-slate-900 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={useAIBackgroundRemoval}
                      onChange={(e) => setUseAIBackgroundRemoval(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex items-center gap-2">
                      <Wand2 className="w-3 h-3 text-indigo-400" />
                      <span className="text-xs font-medium text-slate-200">AI Background Removal</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer bg-slate-900/50 p-2 rounded border border-slate-700 hover:bg-slate-900 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={keepOriginalSize}
                      onChange={(e) => setKeepOriginalSize(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex items-center gap-2">
                      <Maximize className="w-3 h-3 text-slate-400" />
                      <span className="text-xs font-medium text-slate-200">Keep Original Size</span>
                    </div>
                  </label>
                </div>
                
                {(polygon || isSegmenting) && (
                  <div className="bg-slate-900/50 p-2 rounded border border-slate-700 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={isSegmenting ? "text-indigo-400 animate-pulse" : polygon?.isClosed ? "text-green-400 font-medium" : "text-amber-400"}>
                        {isSegmenting ? "Analyzing..." : polygon?.isClosed ? "Shape Closed" : "Drawing..."}
                      </span>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleUndo} disabled={history.length === 0} className="flex-1 text-xs h-8" icon={<Undo className="w-3 h-3"/>} title="Undo (Ctrl+Z)">
                        Undo
                    </Button>
                    <Button variant="secondary" onClick={handleRedo} disabled={future.length === 0} className="flex-1 text-xs h-8" icon={<Redo className="w-3 h-3"/>} title="Redo (Ctrl+Y)">
                        Redo
                    </Button>
                </div>

                {(polygon || selectionBox) && (
                   <Button variant="secondary" onClick={handleResetPolygon} className="w-full text-xs h-8" icon={<RotateCcw className="w-3 h-3"/>}>
                     Reset Shape
                   </Button>
                )}
              </div>
            )}
            
            <Button 
              onClick={handleExtract} 
              isLoading={loading} 
              disabled={
                (inputMode === 'text' && !prompt.trim()) || 
                ((inputMode === 'draw' || inputMode === 'smart') && (!polygon || !polygon.isClosed))
              }
              className="w-full"
            >
              {inputMode === 'text' ? 'Extract Object' : useAIBackgroundRemoval ? 'Extract & Clean (AI)' : 'Crop Selection'}
            </Button>
          </div>

          {processedBase64 && (
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                  <Eraser className="w-4 h-4" />
                  Clean Edges
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={removeWhite}
                    onChange={(e) => setRemoveWhite(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-300">Remove White/BG</span>
                </label>
              </div>
              
              {removeWhite && (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Tolerance</span>
                      <span>{tolerance}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Edge Softness (Anti-alias)</span>
                      <span>{edgeSoftness}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={edgeSoftness}
                      onChange={(e) => setEdgeSoftness(Number(e.target.value))}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-200 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col h-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden relative">
          <div className="flex border-b border-slate-700 bg-slate-900/50 shrink-0">
            <button
              onClick={() => setViewMode('source')}
              className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${viewMode === 'source' ? 'text-white border-b-2 border-indigo-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <div className="flex items-center justify-center gap-2">
                <BoxSelect className="w-3 h-3" /> Workspace
              </div>
            </button>
            <button
              onClick={() => setViewMode('result')}
              disabled={!processedBase64}
              className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${viewMode === 'result' ? 'text-white border-b-2 border-indigo-500 bg-slate-800' : 'text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed'}`}
            >
               <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="w-3 h-3" /> Result
              </div>
            </button>
          </div>

          <div 
             ref={viewportRef}
             className="flex-1 relative checkerboard overflow-hidden outline-none"
             onMouseDown={handleMouseDown}
             onWheel={handleWheel}
             style={{ cursor: isPanning ? 'grabbing' : inputMode === 'smart' ? 'crosshair' : inputMode === 'draw' ? 'default' : 'default' }}
          >
             <canvas ref={hiddenCanvasRef} className="hidden" />

             {viewMode === 'result' ? (
                <div className="w-full h-full flex items-center justify-center overflow-auto p-8">
                    {loading ? (
                    <div className="flex flex-col items-center justify-center text-indigo-400 animate-pulse">
                        <Loader2 className="w-12 h-12 mb-4 animate-spin" />
                        <p className="text-sm font-medium">Extracting element...</p>
                    </div>
                    ) : processedBase64 ? (
                    <img 
                        src={processedBase64} 
                        alt="Extracted" 
                        className="max-w-full max-h-full object-contain shadow-2xl"
                    />
                    ) : (
                    <div className="text-slate-500 text-center text-sm p-8">
                        Use Smart Select or Pen to select an object.
                    </div>
                    )}
                </div>
             ) : (
                <>
                  <div 
                    ref={workspaceRef}
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        transformOrigin: '0 0',
                        width: imgDimensions ? imgDimensions.w : 'auto',
                        height: imgDimensions ? imgDimensions.h : 'auto'
                    }}
                    className="absolute top-0 left-0 transition-transform duration-75 ease-out"
                  >
                     <img 
                        ref={imgRef}
                        src={`data:image/png;base64,${sourceImage.data}`}
                        alt="Source"
                        onLoad={handleImageLoad}
                        className="pointer-events-none select-none max-w-none"
                        draggable={false}
                     />
                     <canvas 
                        ref={canvasRef}
                        className="absolute inset-0 pointer-events-none"
                     />
                  </div>

                  <div className="absolute bottom-4 left-4 flex gap-1 bg-slate-900/80 backdrop-blur rounded-lg border border-slate-700 p-1 shadow-lg">
                    <button onClick={() => handleZoom(-0.1)} className="p-1.5 hover:bg-slate-700 rounded text-slate-300" title="Zoom Out">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono text-slate-300 flex items-center px-1 w-12 justify-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button onClick={() => handleZoom(0.1)} className="p-1.5 hover:bg-slate-700 rounded text-slate-300" title="Zoom In">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                    <div className="w-px bg-slate-700 mx-1"></div>
                    <button onClick={resetView} className="p-1.5 hover:bg-slate-700 rounded text-slate-300" title="Fit to Screen">
                        <FitIcon className="w-4 h-4" />
                    </button>
                  </div>

                  {inputMode === 'draw' && !polygon?.isClosed && (
                     <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-indigo-600/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none z-50">
                        Click to add points. Click start point to close.
                     </div>
                  )}
                   <div className="absolute top-4 right-4 bg-black/60 text-slate-300 text-[10px] px-2 py-1 rounded backdrop-blur pointer-events-none select-none">
                        Space/Shift + Drag to Pan
                   </div>
                </>
             )}
          </div>
          
          {viewMode === 'result' && processedBase64 && (
            <div className="p-4 bg-slate-900 border-t border-slate-700 flex justify-end shrink-0 z-10">
              <Button onClick={handleDownload} icon={<Download className="w-4 h-4" />}>
                Download PNG
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};