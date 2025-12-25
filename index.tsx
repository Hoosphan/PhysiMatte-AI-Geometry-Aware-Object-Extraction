import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser environment usage by transformers.js dependencies
// @ts-ignore
window.Buffer = Buffer;
// @ts-ignore
window.process = { env: {} };
// @ts-ignore
window.global = window;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);