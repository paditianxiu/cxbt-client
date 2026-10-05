import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { disposeCacheScene } from '../cacheAssets/loader';
import { assetUrl, type Appearance, type CreationAssets, type CreationAttachment, type CreationPreset, type CreationWeapon } from './assets';

type IdleData = { fps: number; duration?: number; tracks: { name: string; positions: number[][]; rotations: number[][] }[] };

export default function CharacterPreview({ assets, preset, appearance, motion, weapons, weaponIndex, animation, attachment, rotation = 0, view = 'full' }: {
  assets: CreationAssets;
  preset: CreationPreset;
  appearance: Appearance;
  motion: boolean;
  weapons: CreationWeapon[];
  weaponIndex: number | null;
  animation?: string;
  attachment?: CreationAttachment;
  rotation?: number;
  view?: 'full' | 'portrait';
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const appearanceRef = useRef(appearance);
  const motionRef = useRef(motion);
  const controllerRef = useRef<((value: Appearance) => void) | null>(null);
  const weaponControllerRef = useRef<((value: number | null) => void) | null>(null);
  const weaponRef = useRef(weaponIndex);
  const rotationRef = useRef(rotation);
  const [status, setStatus] = useState('loading');
  useEffect(() => () => {
    const renderer = rendererRef.current;
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    rendererRef.current = null;
  }, []);
  useEffect(() => {
    appearanceRef.current = appearance;
    controllerRef.current?.(appearance);
  }, [appearance]);
  useEffect(() => { motionRef.current = motion; }, [motion]);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);
  useEffect(() => {
    weaponRef.current = weaponIndex;
    weaponControllerRef.current?.(weaponIndex);
  }, [weaponIndex]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frame = 0;
    let mixer: any;
    let attachmentMixer: any;
    let attachmentRoot: any;
    let root: any;
    let dragX: number | null = null;
    let yaw = -0.035;
    const scenes: any[] = [];
    const textures = new Set<any>();
    const materials = new Set<any>();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.01, 100);
    camera.position.set(0, 0.87, 3.45);
    camera.lookAt(0, 0.72, 0);
    if (view === 'portrait') {
      camera.position.set(0, 1.1, 1.52);
      camera.lookAt(0, 1.08, 0);
    }
    // Keep one WebGL context while selecting items; only scene resources change.
    const renderer = rendererRef.current ?? new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0, 0);
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.65));
    const light = new THREE.DirectionalLight(0xffead8, 2.3);
    light.position.set(-2, 4, 5);
    scene.add(light);
    const rim = new THREE.DirectionalLight(0xdcaaff, 2.5);
    rim.position.set(2, 3, -3);
    scene.add(rim);
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    delete mount.dataset.loadedPreset;
    setStatus('loading');

    const loadModel = async (path: string) => {
      const gltf = await loader.loadAsync(assetUrl(path));
      if (disposed) {
        disposeCacheScene(gltf.scene);
        throw new Error('disposed');
      }
      scenes.push(gltf.scene);
      return gltf.scene;
    };
    const loadTexture = async (path: string) => {
      const texture = await textureLoader.loadAsync(assetUrl(path));
      if (disposed) {
        texture.dispose();
        throw new Error('disposed');
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      textures.add(texture);
      return texture;
    };
    const material = (map: any, color = '#ffffff', face = false) => {
      const value = new THREE.MeshPhongMaterial({ map, color, shininess: 12,
        specular: '#191319', transparent: face, depthWrite: !face,
        side: THREE.FrontSide, alphaTest: face ? 0.015 : 0 });
      materials.add(value);
      return value;
    };

    const build = async () => {
      const [body, bodyMap, idleResponse] = await Promise.all([
        loadModel(assets.models.body01), loadTexture(preset.body), fetch(assetUrl(animation ?? 'idle.json')),
      ]);
      if (!idleResponse.ok) throw new Error('待机动画加载失败');
      const idle: IdleData = await idleResponse.json();
      if (disposed) return;
      root = body;
      let skeleton: any;
      root.traverse((object: any) => {
        if (object.isSkinnedMesh) {
          skeleton = object.skeleton;
          object.material.dispose();
          object.material = material(bodyMap);
          object.frustumCulled = false;
        }
      });
      if (!skeleton) throw new Error('角色骨骼缺失');
      const boneIndices = new Map<string, number>(skeleton.bones.map((bone: any, index: number) => [bone.name, index]));
      const addPart = async (path: string, partMaterial: any, renderOrder = 0, offset?: number[]) => {
        const part = await loadModel(path);
        const group = new THREE.Group();
        const meshes: any[] = [];
        part.traverse((object: any) => { if (object.isMesh) meshes.push(object); });
        for (const object of meshes) {
          if (offset) object.geometry.translate(...offset);
          if (object.isSkinnedMesh) {
            const indices = object.geometry.attributes.skinIndex;
            const oldSkeleton = object.skeleton;
            for (let i = 0; i < indices.array.length; i += 1) {
              const name = oldSkeleton.bones[indices.array[i]].name;
              const target = boneIndices.get(name);
              if (target === undefined) throw new Error(`配件骨骼缺失：${name}`);
              indices.array[i] = target;
            }
            indices.needsUpdate = true;
            object.bind(skeleton, new THREE.Matrix4());
            oldSkeleton.dispose();
          }
          object.material.dispose();
          object.material = partMaterial;
          object.renderOrder = renderOrder;
          object.frustumCulled = false;
          group.add(object);
        }
        root.add(group);
        return group;
      };
      const skinMaterial = material(null, assets.skinColor);
      const eyeMaps = await Promise.all(preset.eyes.map(loadTexture));
      const rightEyeMaps = eyeMaps.map((map) => {
        const mirrored = map.clone();
        mirrored.repeat.x = -1;
        mirrored.offset.x = 1;
        mirrored.needsUpdate = true;
        textures.add(mirrored);
        return mirrored;
      });
      const mouthMaps = await Promise.all(preset.mouths.map(loadTexture));
      const eyeMaterial = material(eyeMaps[0], '#ffffff', true);
      const rightEyeMaterial = material(rightEyeMaps[0], '#ffffff', true);
      const mouthMaterial = material(mouthMaps[0], '#ffffff', true);
      await Promise.all([
        addPart(assets.models.head01, skinMaterial),
        addPart(assets.models.l_eye, eyeMaterial, 2),
        addPart(assets.models.r_eye, rightEyeMaterial, 2),
        addPart(assets.models.mouth, mouthMaterial, 3),
        loadTexture(assets.models.noseTexture).then((map) => addPart(assets.models.nose, material(map, '#ffffff', true), 4)),
        ...preset.ears.map((path, index) => addPart(path, skinMaterial, 0, [index === 0 ? 0.235 : -0.235, 1.04, 0.035])),
      ]);
      const hairs = await Promise.all(preset.hair.map(async (part) => addPart(part.model, material(await loadTexture(part.texture)))));
      const accessories = await Promise.all(preset.accessories.map(async (part) => addPart(part.model, material(await loadTexture(part.texture)))));
      await Promise.all(preset.fixedParts.map(async (part) => addPart(part.model, material(await loadTexture(part.texture)))));
      if (disposed) return;
      controllerRef.current = (value) => {
        hairs.forEach((hair, index) => { hair.visible = index === value.hair; });
        eyeMaterial.map = eyeMaps[value.eyes];
        rightEyeMaterial.map = rightEyeMaps[value.eyes];
        mouthMaterial.map = mouthMaps[value.mouth];
        const selected = preset.accessorySets[value.accessory];
        accessories.forEach((part, index) => { part.visible = selected.includes(index); });
      };
      controllerRef.current(appearanceRef.current);
      const makeClip = (data: IdleData, name: string, boneNames: { has: (name: string) => boolean } = boneIndices) => new THREE.AnimationClip(name, data.duration ?? -1, data.tracks.flatMap((track) => {
        if (!boneNames.has(track.name)) return [];
        const times = track.positions.map((_, index) => index / data.fps);
        return [new THREE.VectorKeyframeTrack(`${track.name}.position`, times, track.positions.flat()),
          new THREE.QuaternionKeyframeTrack(`${track.name}.quaternion`, times, track.rotations.flat())];
      }));
      if (attachment) {
        const [model, map] = await Promise.all([loadModel(attachment.model), attachment.texture ? loadTexture(attachment.texture) : Promise.resolve(null)]);
        if (disposed) return;
        attachmentRoot = model;
        const attachmentMaterial = material(map);
        attachmentMaterial.side = THREE.DoubleSide;
        attachmentMaterial.alphaTest = 0.1;
        model.traverse((object: any) => {
          if (!object.isMesh) return;
          object.material.dispose();
          object.material = attachmentMaterial;
          object.frustumCulled = false;
        });
        // Indie rigs use chest as their attachment origin. Their inverse bind
        // matrices retain the source root offset; resetting the root bone
        // normalizes the skinned mesh without applying that offset twice.
        const anchor = model.getObjectByName(attachment.bone);
        const parentIndex = boneIndices.get(attachment.bone);
        if (!anchor || parentIndex === undefined) throw new Error('装备挂点缺失');
        anchor.position.set(0, 0, 0);
        anchor.quaternion.identity();
        anchor.scale.set(1, 1, 1);
        // The avatar chest's bind axes differ from the indie rig's Y-up frame.
        // Cancel that bind rotation, retaining subsequent avatar motion.
        root.updateMatrixWorld(true);
        const host = skeleton.bones[parentIndex];
        const offset = new THREE.Group();
        host.getWorldQuaternion(offset.quaternion).invert();
        offset.add(model);
        host.add(offset);
        if (attachment.animation) {
          const response = await fetch(assetUrl(attachment.animation));
          if (!response.ok) throw new Error('装备动画加载失败');
          const data: IdleData = await response.json();
          if (disposed) return;
          const names = new Set<string>();
          model.traverse((object: any) => { if (object.isBone && object !== anchor) names.add(object.name); });
          const clip = makeClip(data, attachment.id, names);
          if (!clip.tracks.length) throw new Error('装备动画与独立骨骼不匹配');
          attachmentMixer = new THREE.AnimationMixer(model);
          attachmentMixer.clipAction(clip).play();
          attachmentMixer.update(0);
        }
      }
      const weaponModels = await Promise.all(weapons.map(async (weapon) => {
        const response = await fetch(assetUrl(animation ?? weapon.animation));
        if (!response.ok) throw new Error(`${weapon.label}动作加载失败`);
        const data: IdleData = await response.json();
        const parts = await Promise.all(weapon.parts.map(async (part) => {
          const [model, map] = await Promise.all([loadModel(part.model), part.texture ? loadTexture(part.texture) : Promise.resolve(null)]);
          if (disposed) return model;
          const partMaterial = material(map);
          model.traverse((object: any) => {
            if (!object.isMesh) return;
            object.material.dispose();
            object.material = partMaterial;
            object.frustumCulled = false;
          });
          const index = boneIndices.get(part.bone);
          if (index === undefined) throw new Error(`武器挂点缺失：${part.bone}`);
          skeleton.bones[index].add(model);
          model.visible = false;
          return model;
        }));
        return { parts, clip: makeClip(data, weapon.id) };
      }));
      if (disposed) return;
      mixer = new THREE.AnimationMixer(root);
      const idleClip = makeClip(idle, 'Idle');
      weaponControllerRef.current = (value) => {
        weaponModels.forEach((entry, index) => entry.parts.forEach((part) => { part.visible = index === value; }));
        mixer.stopAllAction();
        mixer.clipAction(value === null ? idleClip : weaponModels[value].clip).reset().play();
        mixer.update(0);
      };
      weaponControllerRef.current(weaponRef.current);
      scene.add(root);
      renderer.render(scene, camera);
      mount.dataset.loadedPreset = preset.id;
      setStatus('ready');
    };
    void build().catch((error: unknown) => {
      if (!disposed) setStatus(error instanceof Error ? error.message : '角色加载失败');
    });
    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const pointerDown = (event: PointerEvent) => {
      dragX = event.clientX;
      mount.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (dragX === null) return;
      yaw += (event.clientX - dragX) * 0.008;
      dragX = event.clientX;
    };
    const pointerUp = () => { dragX = null; };
    mount.addEventListener('pointerdown', pointerDown);
    mount.addEventListener('pointermove', pointerMove);
    mount.addEventListener('pointerup', pointerUp);
    mount.addEventListener('pointercancel', pointerUp);
    let previous = performance.now();
    const animate = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (motionRef.current) { mixer?.update(delta); attachmentMixer?.update(delta); }
      if (root) root.rotation.y = yaw + rotationRef.current;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      controllerRef.current = null;
      weaponControllerRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mount.removeEventListener('pointerdown', pointerDown);
      mount.removeEventListener('pointermove', pointerMove);
      mount.removeEventListener('pointerup', pointerUp);
      mount.removeEventListener('pointercancel', pointerUp);
      mixer?.stopAllAction();
      attachmentMixer?.stopAllAction();
      if (attachmentRoot) attachmentMixer?.uncacheRoot(attachmentRoot);
      if (root) mixer?.uncacheRoot(root);
      scenes.forEach(disposeCacheScene);
      textures.forEach((texture) => texture.dispose());
      materials.forEach((value) => value.dispose());
      renderer.renderLists.dispose();
    };
  }, [assets, preset, weapons, animation, attachment, view]);

  return <div className="creation-character" ref={mountRef} data-preview-status={status} data-animation={animation ?? (weaponIndex === null ? 'idle.json' : weapons[weaponIndex].animation)} data-weapon={weaponIndex === null ? 'none' : weapons[weaponIndex].id}
    data-attachment={attachment?.id ?? 'none'} role="img" aria-label="角色三维预览，拖动可旋转角色">
    {status !== 'ready' && <span className="creation-loading" role="status">{status === 'loading' ? '角色载入中…' : status}</span>}
  </div>;
}
