import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CacheAsset = {
  source: string;
  kind: 'mesh' | 'skeleton' | 'collision' | 'physics';
  status: 'ok' | 'error';
  url?: string;
  skeleton?: string;
  collision?: string;
  empty?: boolean;
  unbound?: boolean;
  warnings?: string[];
  error?: string;
  primitives?: number;
  bones?: number;
  actors?: number;
};

export type CacheManifest = {
  version: number;
  counts: Record<string, number>;
  failed: number;
  textures: number;
  assets: CacheAsset[];
};

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/cache/`;

export async function loadCacheManifest(signal?: AbortSignal): Promise<CacheManifest> {
  const response = await fetch(`${ASSET_BASE}manifest.json`, { signal });
  if (!response.ok) throw new Error(`资源清单加载失败：${response.status}`);
  const manifest: CacheManifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('资源清单格式不受支持');
  }
  return manifest;
}

export async function loadCacheAsset(asset: CacheAsset) {
  if (asset.status !== 'ok' || !asset.url) throw new Error(asset.error ?? '资源未成功转换');
  return new GLTFLoader().loadAsync(`${ASSET_BASE}${asset.url}`);
}

// Collision GLBs contain the original indexed triangle meshes. Keep them out
// of the visible render scene unless the caller wants a collision debug view.
export function collectCollisionMeshes(root: any) {
  const colliders: {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array;
    matrixWorld: number[];
    surfaceId: number;
  }[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object: any) => {
    if (!object.isMesh || object.userData.kind !== 'collision') return;
    colliders.push({
      positions: object.geometry.attributes.position.array,
      indices: object.geometry.index.array,
      matrixWorld: object.matrixWorld.toArray(),
      surfaceId: object.userData.collision.surfaceId,
    });
  });
  return colliders;
}

export function disposeCacheScene(root: any): void {
  const disposed = new Set<any>();
  const dispose = (resource: any) => {
    if (resource && !disposed.has(resource)) {
      disposed.add(resource);
      resource.dispose();
    }
  };
  root.traverse((object: any) => {
    if (object.geometry) dispose(object.geometry);
    if (object.skeleton) dispose(object.skeleton);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if ((value as any)?.isTexture) dispose(value);
      }
      dispose(material);
    }
  });
}
