import { GoogleGenAI } from "@google/genai";

// Initialize the client
// The API key must be provided via the environment variable process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = 'gemini-2.5-flash-image';

export const generateImage = async (prompt: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt }
        ]
      }
    });

    // Check for image parts in the response
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return part.inlineData.data;
        }
      }
    }
    
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
};

export const detectObjects = async (base64Image: string): Promise<{ label: string, box_2d: [number, number, number, number] }[]> => {
  try {
    const prompt = `
      Analyze the image and detect the main distinct objects.
      Return a JSON array of objects.
      Each object must have a "label" (string) and a "box_2d" (array of 4 integers: [ymin, xmin, ymax, xmax]).
      The box_2d coordinates should be normalized to a 0-1000 scale.
      Example: [{"label": "cat", "box_2d": [100, 200, 500, 600]}]
      Return only valid JSON.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Use flash for fast text/vision analysis
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          }
        ],
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) return [];

    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch (error) {
    console.error("Gemini Object Detection Error:", error);
    return [];
  }
};

export const extractElementFromImage = async (
  base64Image: string,
  elementDescription: string
): Promise<string> => {
  try {
    // We ask the model to isolate the object. 
    // Requesting a solid white background often makes it easier to remove programmatically if the model doesn't support alpha transparency directly in output yet.
    // However, we will ask for a white background to ensure high contrast for client-side removal if needed.
    const editPrompt = `Extract the ${elementDescription}. Remove the background and make it pure white (hex #FFFFFF). Keep the object details sharp.`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            text: editPrompt,
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          }
        ],
      },
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return part.inlineData.data;
        }
      }
    }
    
    throw new Error("No extracted image returned.");
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw error;
  }
};

export const removeBackground = async (base64Image: string): Promise<string> => {
  try {
    // Strengthened prompt for precise background removal
    const editPrompt = `
      Expertly isolate the main subject in this image. 
      The input image may contain a rough cutout or a specific object with some surrounding background.
      Your task is to:
      1. Identify the primary object or subject.
      2. Completely remove ALL background elements, context, shadows, and artifacts.
      3. Place the subject on a SOLID PURE WHITE background (hex code #FFFFFF).
      4. Ensure the edges of the subject are clean and precise.
      5. Do not crop parts of the subject itself.
      Return ONLY the image of the isolated subject on white.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            text: editPrompt,
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          }
        ],
      },
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return part.inlineData.data;
        }
      }
    }
    
    throw new Error("No processed image returned.");
  } catch (error) {
    console.error("Gemini Background Removal Error:", error);
    throw error;
  }
};