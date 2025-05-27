export interface SimpleBackgroundRemoverOptions {
  modelUrl?: string;
  modelCacheKey?: string;
}

export interface RemoveBackgroundOptions {
  return?: 'image' | 'base64';
  onProgress?: (percent: number, message: string) => void;
}

export default class SimpleBackgroundRemover {
  constructor(options?: SimpleBackgroundRemoverOptions);
  onProgress: ((percent: number, message: string) => void) | null;
  removeBackground(
    imageOrBase64: HTMLImageElement | string,
    opts?: RemoveBackgroundOptions
  ): Promise<HTMLImageElement | string>;
} 