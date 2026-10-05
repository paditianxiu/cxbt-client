// Three.js is consumed from the pinned runtime package; types are added when the asset pipeline gains a typed loader.
declare module 'three'

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export class GLTFLoader {
    loadAsync(url: string): Promise<{ scene: any; animations: any[] }>
    load(
      url: string,
      onLoad: (gltf: { scene: any; animations: any[] }) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: unknown) => void,
    ): void
  }
}

declare module 'three/examples/jsm/controls/OrbitControls.js';
