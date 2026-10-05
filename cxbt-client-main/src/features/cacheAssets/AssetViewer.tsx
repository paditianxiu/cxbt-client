import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  collectCollisionMeshes,
  disposeCacheScene,
  loadCacheAsset,
  loadCacheManifest,
  type CacheAsset,
  type CacheManifest,
} from './loader';
import './AssetViewer.css';

function Preview({ asset }: { asset: CacheAsset }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('加载中…');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let frame = 0;
    let root: any;
    let helper: any;
    setStatus('加载中…');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#182333');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    camera.position.set(2, 1, 3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8491a3, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    scene.add(sun);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    loadCacheAsset(asset).then((gltf) => {
      if (cancelled) {
        disposeCacheScene(gltf.scene);
        return;
      }
      root = gltf.scene;
      scene.add(root);
      let meshes = 0;
      let skinned = 0;
      let bones = 0;
      root.traverse((object: any) => {
        if (object.isBone) bones += 1;
        if (!object.isMesh) return;
        meshes += 1;
        if (object.isSkinnedMesh) skinned += 1;
        if (asset.kind === 'collision') {
          const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
          oldMaterials.forEach((material: any) => material.dispose());
          object.material = new THREE.MeshBasicMaterial({ color: '#51e6c2', wireframe: true });
        }
      });
      if (asset.kind === 'skeleton') {
        helper = new THREE.SkeletonHelper(root);
        scene.add(helper);
      }
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      if (bounds.isEmpty()) root.traverse((object: any) => {
        if (object.isBone) bounds.expandByPoint(object.getWorldPosition(new THREE.Vector3()));
      });
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.05);
        camera.position.copy(center).add(new THREE.Vector3(0.5, 0.3, 1).normalize().multiplyScalar(radius * 3.2));
        camera.near = Math.max(radius / 1000, 0.001);
        camera.far = Math.max(radius * 30, 100);
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
      }
      renderer.render(scene, camera);
      if (asset.kind === 'physics') {
        setStatus(`已加载碰撞参数：${asset.actors ?? 0} 个刚体定义`);
      } else if (asset.empty) {
        setStatus('源文件为空碰撞容器，无碰撞几何');
      } else {
        const collisions = collectCollisionMeshes(root).length;
        setStatus(`已加载：${meshes} 个网格，${skinned} 个蒙皮网格，${bones} 根骨骼，${collisions} 个碰撞网格`);
      }
    }).catch((error: unknown) => {
      if (!cancelled) setStatus(`加载失败：${String(error)}`);
    });

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (root) disposeCacheScene(root);
      if (helper) {
        helper.geometry.dispose();
        helper.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [asset]);

  return <>
    <div className="cache-preview" ref={mountRef} />
    <p className="cache-status" role="status" data-testid="asset-status">{status}</p>
  </>;
}

export default function AssetViewer() {
  const [manifest, setManifest] = useState<CacheManifest>();
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    loadCacheManifest(controller.signal).then((data) => {
      setManifest(data);
      const requested = new URLSearchParams(location.search).get('asset');
      setSelected(data.assets.find((asset) => asset.source === requested)?.source ?? data.assets[0]?.source ?? '');
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => controller.abort();
  }, []);
  const asset = manifest?.assets.find((entry) => entry.source === selected);
  const filtered = manifest?.assets.filter((entry) => entry.source.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return <main className="cache-viewer">
    <aside>
      <a href={import.meta.env.BASE_URL}>返回角色选择</a>
      <h1>AvatarStar 资源预览</h1>
      <p>模型、骨骼与碰撞数据</p>
      {manifest && <p>{manifest.counts.mesh} 个模型 · {manifest.counts.skeleton} 个骨骼 · {manifest.counts.collision} 个碰撞文件 · {manifest.counts.physics ?? 0} 组碰撞参数</p>}
      <label htmlFor="asset-filter">搜索资源</label>
      <input id="asset-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="输入名称或路径" />
      <label htmlFor="asset-select">资源列表（{filtered.length}）</label>
      <select id="asset-select" size={18} value={selected} onChange={(event) => {
        setSelected(event.target.value);
        const url = new URL(location.href);
        url.searchParams.set('asset', event.target.value);
        history.replaceState(null, '', url);
      }}>
        {filtered.map((entry) => <option key={entry.source} value={entry.source}>{entry.source}</option>)}
      </select>
      {error && <p role="alert">{error}</p>}
    </aside>
    <section>
      {asset && <>
        <h2>{asset.source}</h2>
        {asset.warnings?.map((warning) => <p role="alert" key={warning}>{warning}</p>)}
        <Preview asset={asset} />
        <p>拖动旋转 · 滚轮缩放 · 右键平移</p>
      </>}
    </section>
  </main>;
}
