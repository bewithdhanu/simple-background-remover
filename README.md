[![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-blue?logo=github)](https://github.com/bewithdhanu/simple-background-remover)

# Simple Background Remover

Remove image backgrounds in the browser using ONNX models and [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web). Fast, easy, and privacy-friendly—no server upload required!

## Features
- **Runs entirely in the browser** (no server needed)
- **ONNX model** for high-quality background removal
- **Progress callback** for UI feedback
- **Supports HTMLImageElement and base64 input**
- **Caches model in IndexedDB** for fast repeated use

## Installation

### Via npm (for bundlers like Webpack, Vite, etc.)
```bash
npm install simple-background-remover onnxruntime-web
```

### Via CDN (for direct browser use)
```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/bewithdhanu/simple-background-remover/main.js"></script>
```

## Usage

### In the Browser (CDN)
```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/bewithdhanu/simple-background-remover/main.min.js"></script>
<script>
  const remover = new window.SimpleBackgroundRemover();
  remover.onProgress = (percent, message) => {
    console.log(percent, message);
  };
  // Assume you have an <img id="inputImg"> in your HTML
  const img = document.getElementById('inputImg');
  remover.removeBackground(img).then(resultImg => {
    document.body.appendChild(resultImg);
  });
</script>
```

### In a Bundler/Node (ESM or CJS)
```js
import SimpleBackgroundRemover from 'simple-background-remover';
// or: const SimpleBackgroundRemover = require('simple-background-remover');
import 'onnxruntime-web'; // Make sure ort is loaded globally

const remover = new SimpleBackgroundRemover();
remover.removeBackground(imageElement, {
  onProgress: (percent, message) => console.log(percent, message),
  return: 'base64', // or 'image'
}).then(result => {
  // result is a base64 string or HTMLImageElement
});
```

## API

### `new SimpleBackgroundRemover(options?)`
- `options.modelUrl` (string): Custom ONNX model URL (default: RMBG 1.4)
- `options.modelCacheKey` (string): Cache key for IndexedDB (default: 'rmbg_model_v1.4')

### `removeBackground(imageOrBase64, opts?)`
- `imageOrBase64`: HTMLImageElement or base64 data URL string
- `opts.return`: `'image'` (default) or `'base64'`
- `opts.onProgress`: function(percent, message) — progress callback
- **Returns:** Promise<HTMLImageElement | string>

#### Example
```js
const result = await remover.removeBackground(imageElement, {
  return: 'base64',
  onProgress: (percent, message) => console.log(percent, message),
});
```

### Progress Callback
The progress callback receives two arguments:
- `percent` (number): Progress percentage (0-100)
- `message` (string): Status message

## Browser Support
- Modern browsers with [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) and [WebAssembly](https://webassembly.org/)
- Not supported in Node.js (browser only)

## Model
- Default: [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)
- You can use your own ONNX model by passing a custom `modelUrl`.

## Contributing
Pull requests and issues are welcome! Please open an issue to discuss your idea or bug.

## License
MIT 