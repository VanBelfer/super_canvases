/**
 * Gemini Canvas Library v2.0
 * * A high-level abstraction layer for building GenAI apps in Gemini Canvas.
 * Handles Firebase Auth, Firestore Chunking, Asset Caching, and Gemini API calls.
 REMEMBER - CANVAS is single file only so this cannot be imported per se
 * * Usage:
 * import { initCanvas } from './canvas-library.js';
 * const { app, db, assets, gemini, ui } = await initCanvas();
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ============================================
// 1. CONSTANTS & CONFIG
// ============================================
const CONFIG = {
    MODELS: {
        TEXT: "gemini-2.5-flash-preview-09-2025",
        IMAGE_GEN: "imagen-4.0-generate-001",
        IMAGE_EDIT: "gemini-2.5-flash-image-preview",
        TTS: "gemini-2.5-flash-preview-tts"
    },
    FIRESTORE: {
        CHUNK_SIZE: 800 * 1024, // 800KB safety limit (max doc is 1MB)
        ROOT_COLLECTION: "artifacts"
    }
};

// ============================================
// 2. CORE APP & AUTH
// ============================================
class CanvasApp {
    constructor(appId) {
        this.appId = appId || (typeof __app_id !== 'undefined' ? __app_id : 'default-canvas-app');
        this.app = null;
        this.db = null;
        this.auth = null;
        this.userId = null;
        this.ready = this._initialize(); // Promise that resolves when Auth is done
    }

    async _initialize() {
        try {
            // 1. Viewport Fix
            if (!document.querySelector('meta[name="viewport"]')) {
                document.head.insertAdjacentHTML('beforeend', '<meta name="viewport" content="width=device-width, initial-scale=1.0">');
            }

            // 2. Firebase Init
            const firebaseConfig = typeof __firebase_config !== 'undefined' 
                ? JSON.parse(__firebase_config) 
                : { apiKey: "mock-key", authDomain: "mock-domain", projectId: "mock-project" }; // Fallback for pure local dev

            this.app = initializeApp(firebaseConfig);
            this.db = getFirestore(this.app);
            this.auth = getAuth(this.app);

            // 3. Authentication Strategy
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(this.auth, __initial_auth_token);
            } else {
                await signInAnonymously(this.auth);
            }

            // 4. Wait for User ID
            await new Promise((resolve) => {
                const unsubscribe = onAuthStateChanged(this.auth, (user) => {
                    if (user) {
                        this.userId = user.uid;
                        resolve();
                        unsubscribe();
                    }
                });
            });

            console.log(`Canvas App Initialized. User: ${this.userId}`);
            return this;
        } catch (error) {
            console.error("Canvas Init Error:", error);
            throw error;
        }
    }
}

// ============================================
// 3. GEMINI API CLIENT
// ============================================
class GeminiAPI {
    constructor() {
        this.apiKey = ""; // Handled by environment
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
    }

    async _call(url, payload) {
        let attempt = 0;
        const maxRetries = 4;
        const delays = [1000, 2000, 4000, 8000];

        while (attempt <= maxRetries) {
            try {
                const response = await fetch(`${url}?key=${this.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    // Don't retry client errors (4xx) except 429 (Too Many Requests)
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        throw new Error(`API Client Error ${response.status}: ${await response.text()}`);
                    }
                    throw new Error(`API Error ${response.status}`);
                }
                return await response.json();
            } catch (e) {
                if (attempt === maxRetries) throw e;
                await new Promise(r => setTimeout(r, delays[attempt]));
                attempt++;
            }
        }
    }

    /**
     * Generate Text
     * @param {string} prompt 
     * @param {Object} options { systemPrompt, jsonMode (boolean), googleSearch (boolean) } 
     */
    async generateText(prompt, options = {}) {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {}
        };

        if (options.systemPrompt) {
            payload.systemInstruction = { parts: [{ text: options.systemPrompt }] };
        }
        
        if (options.jsonMode) {
            payload.generationConfig.responseMimeType = "application/json";
        }

        if (options.googleSearch) {
            payload.tools = [{ "google_search": {} }];
        }

        const result = await this._call(`${this.baseUrl}/${CONFIG.MODELS.TEXT}:generateContent`, payload);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) throw new Error("No text generated");
        return options.jsonMode ? JSON.parse(text) : text;
    }

    /**
     * Generate Image (Imagen 4)
     * @param {string} prompt 
     * @returns {Promise<string>} Base64 PNG
     */
    async generateImage(prompt) {
        const payload = {
            instances: [{ prompt }],
            parameters: { sampleCount: 1 }
        };
        const result = await this._call(`${this.baseUrl}/${CONFIG.MODELS.IMAGE_GEN}:predict`, payload);
        const base64 = result.predictions?.[0]?.bytesBase64Encoded;
        if (!base64) throw new Error("No image generated");
        return base64;
    }

    /**
     * Edit Image (Gemini 2.5 Flash)
     * @param {string} prompt - Instructions like "Make it sunny"
     * @param {string} base64Image - Source image
     */
    async editImage(prompt, base64Image) {
        // Strip data prefix if present
        const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
        
        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: "image/png", data: cleanBase64 } }
                ]
            }],
            generationConfig: { responseModalities: ['IMAGE'] }
        };
        
        const result = await this._call(`${this.baseUrl}/${CONFIG.MODELS.IMAGE_EDIT}:generateContent`, payload);
        const imgData = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (!imgData) throw new Error("Image edit failed");
        return imgData;
    }

    /**
     * Text to Speech
     * @param {string} text 
     * @param {Object} config { voice: 'Kore', speakers: [{name: 'A', voice: 'Puck'}] }
     */
    async generateSpeech(text, config = {}) {
        const payload = {
            contents: [{ parts: [{ text }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {}
            }
        };

        if (config.speakers) {
            payload.generationConfig.speechConfig.multiSpeakerVoiceConfig = {
                speakerVoiceConfigs: config.speakers.map(s => ({
                    speaker: s.name,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
                }))
            };
        } else {
            payload.generationConfig.speechConfig.voiceConfig = {
                prebuiltVoiceConfig: { voiceName: config.voice || "Kore" }
            };
        }

        const result = await this._call(`${this.baseUrl}/${CONFIG.MODELS.TTS}:generateContent`, payload);
        const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) throw new Error("TTS generation failed");
        return audioData; // Returns PCM-16 Base64
    }
}

// ============================================
// 4. FIRESTORE MANAGER (AUTO-CHUNKING)
// ============================================
class FirestoreManager {
    constructor(canvasApp) {
        this.app = canvasApp;
    }

    _getRef(pathSegments) {
        return doc(this.app.db, ...pathSegments);
    }

    /**
     * Save data to Firestore. Auto-chunks if string/base64 is too large.
     * @param {string} collectionName 
     * @param {string} docId 
     * @param {any} data - Object or Base64 string
     * @param {boolean} isPublic 
     */
    async save(collectionName, docId, data, isPublic = false) {
        await this.app.ready;
        const prefix = isPublic ? ['public', 'data'] : ['users', this.app.userId];
        const fullPath = [CONFIG.FIRESTORE.ROOT_COLLECTION, this.app.appId, ...prefix, collectionName, docId];

        // 1. Serialize
        let content = typeof data === 'string' ? data : JSON.stringify(data);
        const isLarge = content.length > CONFIG.FIRESTORE.CHUNK_SIZE;

        // 2. Metadata Document
        const metaDoc = {
            isChunked: isLarge,
            timestamp: new Date().toISOString(),
            // If it's not large and it's an object, save directly. If it's a large string, save chunks.
            data: isLarge ? null : data 
        };

        if (isLarge) {
            metaDoc.chunkCount = Math.ceil(content.length / CONFIG.FIRESTORE.CHUNK_SIZE);
            const chunks = [];
            for (let i = 0; i < metaDoc.chunkCount; i++) {
                const start = i * CONFIG.FIRESTORE.CHUNK_SIZE;
                const end = start + CONFIG.FIRESTORE.CHUNK_SIZE;
                chunks.push(content.substring(start, end));
            }

            // Save Chunks in Subcollection
            await Promise.all(chunks.map((chunkData, index) => {
                const chunkPath = [...fullPath, 'chunks', index.toString()];
                return setDoc(this._getRef(chunkPath), { data: chunkData });
            }));
        }

        // Save Meta
        await setDoc(this._getRef(fullPath), metaDoc);
    }

    /**
     * Load data. Auto-assembles chunks if needed.
     */
    async load(collectionName, docId, isPublic = false) {
        await this.app.ready;
        const prefix = isPublic ? ['public', 'data'] : ['users', this.app.userId];
        const fullPath = [CONFIG.FIRESTORE.ROOT_COLLECTION, this.app.appId, ...prefix, collectionName, docId];

        const docSnap = await getDoc(this._getRef(fullPath));
        if (!docSnap.exists()) return null;

        const meta = docSnap.data();

        if (!meta.isChunked) {
            return meta.data;
        }

        // Reassemble Chunks
        const chunkPromises = [];
        for (let i = 0; i < meta.chunkCount; i++) {
            const chunkPath = [...fullPath, 'chunks', i.toString()];
            chunkPromises.push(getDoc(this._getRef(chunkPath)));
        }

        const chunkSnaps = await Promise.all(chunkPromises);
        const fullString = chunkSnaps.map(s => s.data().data).join('');

        try {
            return JSON.parse(fullString); // Try parsing if it was an object
        } catch {
            return fullString; // Return as string (likely base64)
        }
    }

    /**
     * Real-time listener
     */
    subscribe(collectionName, docId, callback, isPublic = false) {
        const prefix = isPublic ? ['public', 'data'] : ['users', this.app.userId];
        const fullPath = [CONFIG.FIRESTORE.ROOT_COLLECTION, this.app.appId, ...prefix, collectionName, docId];

        return onSnapshot(this._getRef(fullPath), async (snap) => {
            if (!snap.exists()) {
                callback(null);
                return;
            }
            const meta = snap.data();
            if(!meta.isChunked) {
                callback(meta.data);
            } else {
                // Warning: Real-time chunk re-assembly is heavy.
                // For this lib, we just notify updates happened for chunks, 
                // typically you'd trigger a manual load() here.
                callback({ _isChunked: true, timestamp: meta.timestamp }); 
            }
        });
    }
}

// ============================================
// 5. ASSET MANAGER & OPTIMIZER
// ============================================
class AssetManager {
    constructor(canvasApp, firestore, gemini) {
        this.app = canvasApp;
        this.db = firestore;
        this.gemini = gemini;
        this.cache = new Map(); // Memory Cache
    }

    async getImage(assetId, prompt, options = {}) {
        const { force = false, public: isPublic = false } = options;
        
        // 1. Memory Check
        if (!force && this.cache.has(assetId)) return this.cache.get(assetId);

        // 2. Firestore Check
        if (!force) {
            const cached = await this.db.load('assets', assetId, isPublic);
            if (cached) {
                const url = `data:image/jpeg;base64,${cached}`;
                this.cache.set(assetId, url);
                return url;
            }
        }

        // 3. Generate
        UI.showToast(`Generating image: ${assetId}...`);
        const rawBase64 = await this.gemini.generateImage(prompt);
        
        // 4. Compress (PNG -> JPEG) to save space/bandwidth
        const compressedBase64 = await Optimizer.compressImage(rawBase64);

        // 5. Save & Cache
        await this.db.save('assets', assetId, compressedBase64, isPublic);
        const finalUrl = `data:image/jpeg;base64,${compressedBase64}`;
        this.cache.set(assetId, finalUrl);
        
        return finalUrl;
    }

    async getAudio(assetId, text, options = {}) {
        const { force = false, public: isPublic = false, voice, speakers } = options;

        if (!force && this.cache.has(assetId)) return this.cache.get(assetId);

        if (!force) {
            const cached = await this.db.load('assets', assetId, isPublic);
            if (cached) {
                const blob = Optimizer.pcmToWav(cached);
                const url = URL.createObjectURL(blob);
                this.cache.set(assetId, url);
                return url;
            }
        }

        UI.showToast(`Generating audio: ${assetId}...`);
        const pcmBase64 = await this.gemini.generateSpeech(text, { voice, speakers });
        
        // Save raw PCM to Firestore (it's efficient enough for 24kHz mono)
        await this.db.save('assets', assetId, pcmBase64, isPublic);

        const blob = Optimizer.pcmToWav(pcmBase64);
        const url = URL.createObjectURL(blob);
        this.cache.set(assetId, url);
        return url;
    }
}

// ============================================
// 6. UTILS & UI
// ============================================
class Optimizer {
    static compressImage(base64Png) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const cvs = document.createElement('canvas');
                cvs.width = img.width;
                cvs.height = img.height;
                const ctx = cvs.getContext('2d');
                ctx.fillStyle = '#FFFFFF'; // JPEG needs bg
                ctx.fillRect(0,0,cvs.width,cvs.height);
                ctx.drawImage(img, 0, 0);
                resolve(cvs.toDataURL('image/jpeg', 0.7).split(',')[1]);
            };
            img.src = `data:image/png;base64,${base64Png}`;
        });
    }

    static pcmToWav(base64Pcm, sampleRate = 24000) {
        const binary = atob(base64Pcm);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for(let i=0; i<len; i++) bytes[i] = binary.charCodeAt(i);
        const pcm16 = new Int16Array(bytes.buffer);

        const buffer = new ArrayBuffer(44 + pcm16.byteLength);
        const view = new DataView(buffer);

        // WAV Header
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + pcm16.byteLength, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, pcm16.byteLength, true);

        // Data
        const offset = 44;
        for (let i = 0; i < pcm16.length; i++) {
            view.setInt16(offset + (i * 2), pcm16[i], true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }
}

class UI {
    static showToast(msg, duration = 3000) {
        const div = document.createElement('div');
        div.className = "fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg z-50 animate-bounce";
        div.innerText = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), duration);
    }

    static createLoader() {
        return `<div class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>`;
    }
}

// ============================================
// 7. INITIALIZER (EXPORT)
// ============================================
export async function initCanvas(appId) {
    const app = new CanvasApp(appId);
    await app.ready;
    
    const gemini = new GeminiAPI();
    const db = new FirestoreManager(app);
    const assets = new AssetManager(app, db, gemini);
    
    return { app, db, assets, gemini, ui: UI };
}
