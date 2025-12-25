import React, { useState, useRef } from 'react';
import { GeneratedImage, ToolMode } from './types';
import { generateImage } from './services/geminiService';
import { Button } from './components/Button';
import { ExtractionPanel } from './components/ExtractionPanel';
import { 
  Sparkles, 
  Image as ImageIcon, 
  History, 
  Maximize2,
  AlertTriangle,
  Upload,
  Plus,
  Trash2,
  X
} from 'lucide-react';

const SAMPLE_PROMPTS = [
  "A futuristic cyberpunk city with neon lights",
  "A cute red panda eating a bamboo stick",
  "A vintage typewriter on a wooden desk",
  "A majestic dragon flying over a mountain range"
];

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [mode, setMode] = useState<ToolMode>(ToolMode.GENERATE);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    setMode(ToolMode.GENERATE);

    try {
      const base64Data = await generateImage(prompt);
      
      const newImage: GeneratedImage = {
        id: crypto.randomUUID(),
        data: base64Data,
        prompt: prompt,
        timestamp: Date.now()
      };
      
      setCurrentImage(newImage);
      setHistory(prev => [newImage, ...prev]);
    } catch (err: any) {
      setError(err.message || "Failed to generate image.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data URL prefix to get raw base64
      const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');

      const newImage: GeneratedImage = {
        id: crypto.randomUUID(),
        data: base64Data,
        prompt: "Uploaded Image",
        timestamp: Date.now()
      };
      
      setCurrentImage(newImage);
      setHistory(prev => [newImage, ...prev]);
      setError(null);
    };
    reader.readAsDataURL(file);
    // Reset input
    event.target.value = '';
  };

  const startExtraction = () => {
    if (currentImage) {
      setMode(ToolMode.EXTRACT);
    }
  };

  const loadFromHistory = (img: GeneratedImage) => {
    setCurrentImage(img);
    setMode(ToolMode.GENERATE); // Reset to view mode initially
  };

  const handleDeleteImage = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(img => img.id !== id));
    if (currentImage?.id === id) {
      setCurrentImage(null);
      setMode(ToolMode.GENERATE);
    }
  };
  
  const handleClearCurrent = () => {
      if(currentImage) {
          setHistory(prev => prev.filter(img => img.id !== currentImage.id));
          setCurrentImage(null);
          setMode(ToolMode.GENERATE);
      }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              Gemini Element Extractor
            </h1>
          </div>
          <div className="flex items-center gap-4">
             <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept="image/*"
            />
            <Button 
              variant="secondary" 
              className="text-xs py-1.5 h-8" 
              icon={<Upload className="w-3 h-3" />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload Image
            </Button>
            <a href="https://github.com/google-gemini/generative-ai-js" target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-300 transition-colors hidden sm:block">
              Powered by Gemini 2.5
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Sidebar: History */}
        <div className="hidden lg:block lg:col-span-3 space-y-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 h-[calc(100vh-100px)] flex flex-col">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <History className="w-4 h-4" /> History
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {history.length === 0 ? (
                <div className="text-center text-slate-600 py-8 text-sm">
                  No images yet.
                </div>
              ) : (
                history.map(img => (
                  <div key={img.id} className="relative group">
                    <button
                      onClick={() => loadFromHistory(img)}
                      className={`w-full group relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${currentImage?.id === img.id ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-transparent hover:border-slate-600'}`}
                    >
                      <img src={`data:image/png;base64,${img.data}`} alt={img.prompt} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                        <p className="text-xs text-white truncate w-full text-left">{img.prompt}</p>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteImage(e, img.id)}
                      className="absolute top-2 right-2 p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                      title="Delete image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
              
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[4/1] rounded-lg border border-dashed border-slate-700 hover:border-indigo-500 hover:bg-slate-800/50 transition-all flex items-center justify-center gap-2 text-slate-500 hover:text-indigo-400"
              >
                <Plus className="w-4 h-4" />
                <span className="text-xs font-medium">Upload New</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="col-span-1 lg:col-span-9 flex flex-col space-y-6">
          
          {/* Main Display */}
          <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 p-1 overflow-hidden shadow-2xl min-h-[500px] flex flex-col relative">
            {mode === ToolMode.EXTRACT && currentImage ? (
              <div className="flex-1 p-6">
                <ExtractionPanel 
                  sourceImage={currentImage} 
                  onClose={() => setMode(ToolMode.GENERATE)} 
                />
              </div>
            ) : (
              <div className="relative flex-1 bg-slate-950 rounded-xl m-1 flex items-center justify-center overflow-hidden group">
                {!currentImage && !isGenerating && (
                  <div className="text-center max-w-md p-8">
                    <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-600">
                      <ImageIcon className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-medium text-white mb-2">Create or Upload</h3>
                    <p className="text-slate-400 mb-8">Generate an image with Gemini or upload your own to start extracting elements.</p>
                    
                    <div className="flex flex-col gap-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {SAMPLE_PROMPTS.map(p => (
                          <button 
                            key={p} 
                            onClick={() => setPrompt(p)}
                            className="text-xs text-left p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-800/50 hover:border-slate-700 transition-colors text-slate-300"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-800"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-slate-950 px-2 text-slate-500">Or</span>
                        </div>
                      </div>

                      <Button 
                        variant="secondary" 
                        onClick={() => fileInputRef.current?.click()}
                        icon={<Upload className="w-4 h-4" />}
                        className="w-full py-3"
                      >
                        Upload an Image
                      </Button>
                    </div>
                  </div>
                )}

                {isGenerating && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-sm">
                    <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-indigo-400 font-medium animate-pulse">Generating masterpiece...</p>
                  </div>
                )}

                {currentImage && (
                  <>
                    <img 
                      src={`data:image/png;base64,${currentImage.data}`} 
                      alt={currentImage.prompt} 
                      className="max-w-full max-h-[70vh] object-contain shadow-2xl"
                    />
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-4 opacity-0 group-hover:opacity-100 transition-all transform translate-y-4 group-hover:translate-y-0 z-10">
                      <Button onClick={startExtraction} className="shadow-xl" icon={<Maximize2 className="w-4 h-4"/>}>
                        Extract Element
                      </Button>
                      <Button onClick={handleClearCurrent} variant="danger" icon={<Trash2 className="w-4 h-4"/>}>
                         Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Prompt Bar - Only show when NOT extracting */}
          {mode === ToolMode.GENERATE && (
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the image you want to generate..."
                    className="w-full h-12 bg-slate-950 border border-slate-700 rounded-lg px-4 text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    disabled={isGenerating}
                  />
                  {error && (
                    <div className="absolute -bottom-6 left-0 text-xs text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {error}
                    </div>
                  )}
                </div>
                <Button 
                  onClick={handleGenerate} 
                  disabled={!prompt.trim() || isGenerating}
                  className="h-12 px-8"
                  isLoading={isGenerating}
                  icon={<Sparkles className="w-4 h-4" />}
                >
                  Generate
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
