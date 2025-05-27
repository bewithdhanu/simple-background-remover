// @ts-check
/**
 * SimpleBackgroundRemover - Remove image backgrounds in the browser using ONNX models.
 * @module SimpleBackgroundRemover
 *
 * @typedef {Object} SimpleBackgroundRemoverOptions
 * @property {string} [modelUrl] - URL to the ONNX model.
 * @property {string} [modelCacheKey] - Cache key for the model in IndexedDB.
 *
 * @typedef {Object} RemoveBackgroundOptions
 * @property {'image'|'base64'} [return] - Return type (default: 'image')
 * @property {ProgressCallback} [onProgress] - Progress callback
 *
 * @callback ProgressCallback
 * @param {number} percent
 * @param {string} message
 */

// NOTE: This library expects 'onnxruntime-web' (as 'ort') to be loaded globally in the browser.
// For example, include via: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
/* global ort */

class SimpleBackgroundRemover {
    /**
     * @param {SimpleBackgroundRemoverOptions} [options]
     */
    constructor(options = {}) {
        this.modelUrl = options.modelUrl || 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx';
        this.modelCacheKey = options.modelCacheKey || 'rmbg_model_v1.4';
        this.session = null;
        this.modelLoaded = false;
        this.modelLoading = false;
        this.onProgress = null;
    }

    /**
     * Remove background from an image.
     * @param {HTMLImageElement|string} imageOrBase64 - Image element or base64 data URL string
     * @param {RemoveBackgroundOptions} [opts] - Options
     * @returns {Promise<HTMLImageElement|string>} - Image element or base64 string
     */
    async removeBackground(imageOrBase64, opts = {}) {
        const onProgress = opts.onProgress || this.onProgress;
        this._emitProgress(0, 'Starting background removal...', onProgress);
        let img;
        if (typeof imageOrBase64 === 'string') {
            this._emitProgress(2, 'Decoding base64 image...', onProgress);
            img = await this._base64ToImage(imageOrBase64);
        } else if (imageOrBase64 instanceof window.Image) {
            img = imageOrBase64;
        } else {
            throw new Error('Input must be an HTMLImageElement or a base64 string');
        }
        if (!this.modelLoaded && !this.modelLoading) {
            this.modelLoading = true;
            await this._loadModelWithProgress(onProgress);
            this.modelLoaded = true;
            this.modelLoading = false;
        } else if (!this.modelLoaded && this.modelLoading) {
            this._emitProgress(10, 'Model is loading, please wait.', onProgress);
            // Wait until model is loaded
            while (this.modelLoading) {
                await new Promise(res => setTimeout(res, 100));
            }
        } else {
            this._emitProgress(10, 'Model already loaded.', onProgress);
        }
        if (!this.session) throw new Error('Model not loaded');
        this._emitProgress(15, 'Preprocessing image...', onProgress);
        const inputTensor = await this._preprocessImage(img);
        this._emitProgress(35, 'Running AI inference...', onProgress);
        const feeds = { 'input': inputTensor };
        const results = await this.session.run(feeds);
        this._emitProgress(70, 'Processing mask...', onProgress);
        const mask = results.output;
        const canvas = this._applyMask(img, mask);
        this._emitProgress(90, 'Generating result...', onProgress);
        let result;
        if (opts.return === 'base64') {
            result = canvas.toDataURL('image/png');
        } else {
            result = await this._canvasToImage(canvas);
        }
        this._emitProgress(100, 'Complete!', onProgress);
        return result;
    }

    /**
     * Emit progress event.
     * @private
     * @param {number} percent
     * @param {string} message
     * @param {ProgressCallback} [onProgressOverride]
     */
    _emitProgress(percent, message, onProgressOverride) {
        const cb = onProgressOverride || this.onProgress;
        if (typeof cb === 'function') {
            try { cb(percent, message); } catch (e) {}
        }
    }

    /**
     * Load the ONNX model with progress reporting.
     * @private
     * @param {ProgressCallback} [onProgress]
     */
    async _loadModelWithProgress(onProgress) {
        this._emitProgress(5, 'Checking model cache...', onProgress);
        const cachedModel = await this._getCachedModel();
        if (cachedModel) {
            this._emitProgress(15, 'Loading cached model...', onProgress);
            this.session = await globalThis.ort.InferenceSession.create(cachedModel);
            this._emitProgress(30, 'Model loaded from cache.', onProgress);
            return;
        }
        this._emitProgress(10, 'Downloading model...', onProgress);
        if (typeof globalThis.ort === 'undefined' || !globalThis.ort.InferenceSession) {
            throw new Error('onnxruntime-web (ort) is not loaded. Please include it via a <script> tag or import.');
        }
        globalThis.ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/';
        const modelBuffer = await this._downloadAndCacheModelWithProgress(onProgress);
        this._emitProgress(80, 'Loading model...', onProgress);
        this.session = await globalThis.ort.InferenceSession.create(modelBuffer);
        this._emitProgress(90, 'Model loaded.', onProgress);
    }

    /**
     * Download and cache the ONNX model with progress.
     * @private
     * @param {ProgressCallback} [onProgress]
     * @returns {Promise<Uint8Array>}
     */
    async _downloadAndCacheModelWithProgress(onProgress) {
        const response = await fetch(this.modelUrl);
        if (!response.ok) throw new Error('Model download failed');
        if (!response.body) throw new Error('Response body is null');
        const totalSize = parseInt(response.headers.get('content-length') || '0');
        const reader = response.body.getReader();
        const chunks = [];
        let downloadedSize = 0;
        let lastPercent = 10;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            downloadedSize += value.length;
            if (totalSize > 0) {
                const percent = 10 + Math.round((downloadedSize / totalSize) * 60); // 10-70%
                if (percent !== lastPercent) {
                    this._emitProgress(percent, `Downloading model... ${percent}% (${Math.round(downloadedSize / 1024 / 1024)}MB)`, onProgress);
                    lastPercent = percent;
                }
            }
        }
        const modelBuffer = new Uint8Array(downloadedSize);
        let offset = 0;
        for (const chunk of chunks) {
            modelBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        this._emitProgress(75, 'Caching model for future use...', onProgress);
        await this._cacheModel(modelBuffer);
        return modelBuffer;
    }

    /**
     * Convert base64 string to HTMLImageElement.
     * @private
     * @param {string} base64
     * @returns {Promise<HTMLImageElement>}
     */
    async _base64ToImage(base64) {
        return new Promise((resolve, reject) => {
            const img = new window.Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = base64;
        });
    }

    /**
     * Try to load the model from cache, or download and cache it.
     * @private
     */
    async _loadModel() {
        const cachedModel = await this._getCachedModel();
        if (cachedModel) {
            this.session = await globalThis.ort.InferenceSession.create(cachedModel);
            return;
        }
        if (typeof globalThis.ort === 'undefined' || !globalThis.ort.InferenceSession) {
            throw new Error('onnxruntime-web (ort) is not loaded. Please include it via a <script> tag or import.');
        }
        globalThis.ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.14.0/';
        const modelBuffer = await this._downloadAndCacheModel();
        this.session = await globalThis.ort.InferenceSession.create(modelBuffer);
    }

    /**
     * Get the cached model from IndexedDB.
     * @private
     * @returns {Promise<Uint8Array|null>}
     */
    async _getCachedModel() {
        if (!window.indexedDB) return null;
        return new Promise((resolve) => {
            const request = indexedDB.open('ModelCache', 1);
            request.onerror = () => resolve(null);
            request.onupgradeneeded = (event) => {
                const target = event.target;
                if (!target) return resolve(null);
                const db = /** @type {IDBOpenDBRequest} */(target).result;
                if (!db.objectStoreNames.contains('models')) {
                    db.createObjectStore('models');
                }
            };
            request.onsuccess = (event) => {
                const target = event.target;
                if (!target) return resolve(null);
                const db = /** @type {IDBOpenDBRequest} */(target).result;
                const transaction = db.transaction(['models'], 'readonly');
                const store = transaction.objectStore('models');
                const getRequest = store.get(this.modelCacheKey);
                getRequest.onsuccess = () => {
                    if (getRequest.result && getRequest.result.data) {
                        resolve(getRequest.result.data);
                    } else {
                        resolve(null);
                    }
                };
                getRequest.onerror = () => resolve(null);
            };
        });
    }

    /**
     * Download and cache the model.
     * @private
     * @returns {Promise<Uint8Array>}
     */
    async _downloadAndCacheModel() {
        const response = await fetch(this.modelUrl);
        if (!response.ok) throw new Error('Model download failed');
        const buffer = await response.arrayBuffer();
        const modelBuffer = new Uint8Array(buffer);
        await this._cacheModel(modelBuffer);
        return modelBuffer;
    }

    /**
     * Cache the model in IndexedDB.
     * @private
     * @param {Uint8Array} modelBuffer
     * @returns {Promise<void>}
     */
    async _cacheModel(modelBuffer) {
        if (!window.indexedDB) return;
        return new Promise((resolve) => {
            const request = indexedDB.open('ModelCache', 1);
            request.onerror = () => resolve();
            request.onupgradeneeded = (event) => {
                const target = event.target;
                if (!target) return resolve();
                const db = /** @type {IDBOpenDBRequest} */(target).result;
                if (!db.objectStoreNames.contains('models')) {
                    db.createObjectStore('models');
                }
            };
            request.onsuccess = (event) => {
                const target = event.target;
                if (!target) return resolve();
                const db = /** @type {IDBOpenDBRequest} */(target).result;
                const transaction = db.transaction(['models'], 'readwrite');
                const store = transaction.objectStore('models');
                const cacheData = {
                    data: modelBuffer,
                    timestamp: Date.now(),
                    version: '1.4'
                };
                store.put(cacheData, this.modelCacheKey);
                resolve();
            };
        });
    }

    /**
     * Preprocess the image for the model.
     * @private
     * @param {HTMLImageElement} img
     * @returns {Promise<any>} // ort.Tensor, but type is global
     */
    async _preprocessImage(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context from canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        ctx.drawImage(img, 0, 0, 1024, 1024);
        const imageData = ctx.getImageData(0, 0, 1024, 1024);
        const data = imageData.data;
        const tensorData = new Float32Array(1 * 3 * 1024 * 1024);
        for (let i = 0; i < 1024 * 1024; i++) {
            tensorData[i] = data[i * 4] / 255.0;     // R
            tensorData[1024 * 1024 + i] = data[i * 4 + 1] / 255.0; // G
            tensorData[2 * 1024 * 1024 + i] = data[i * 4 + 2] / 255.0; // B
        }
        return new globalThis.ort.Tensor('float32', tensorData, [1, 3, 1024, 1024]);
    }

    /**
     * Apply the mask to the image and return a canvas.
     * @private
     * @param {HTMLImageElement} img
     * @param {any} maskTensor // ort.Tensor, but type is global
     * @returns {HTMLCanvasElement}
     */
    _applyMask(img, maskTensor) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context from canvas');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        const maskData = maskTensor.data;
        const maskSize = Math.sqrt(maskData.length);
        for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
                const imgIdx = (y * img.width + x) * 4;
                const maskX = Math.floor((x / img.width) * maskSize);
                const maskY = Math.floor((y / img.height) * maskSize);
                const maskIdx = maskY * maskSize + maskX;
                const alpha = maskData[maskIdx] || 0;
                data[imgIdx + 3] = Math.round(alpha * 255);
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Convert a canvas to an HTMLImageElement.
     * @private
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<HTMLImageElement>}
     */
    async _canvasToImage(canvas) {
        return new Promise((resolve, reject) => {
            const img = new window.Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = canvas.toDataURL('image/png');
        });
    }
}

// Export for ESM and CJS
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = SimpleBackgroundRemover;
} else {
    /** @type {any} */ (window).SimpleBackgroundRemover = SimpleBackgroundRemover;
} 