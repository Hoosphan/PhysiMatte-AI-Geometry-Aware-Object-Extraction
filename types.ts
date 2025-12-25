
export interface GeneratedImage {
  id: string;
  data: string; // Base64 string
  prompt: string;
  timestamp: number;
}

export interface ExtractedElement {
  id: string;
  sourceImageId: string;
  data: string; // Base64 string
  elementPrompt: string;
  timestamp: number;
}

export interface DetectedObject {
  label: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
}

export enum AppState {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  EDITING = 'EDITING',
  ERROR = 'ERROR'
}

export enum ToolMode {
  GENERATE = 'GENERATE',
  EXTRACT = 'EXTRACT'
}
