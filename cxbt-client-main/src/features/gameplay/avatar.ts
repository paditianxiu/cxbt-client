import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl, type Appearance, type CreationAssets, type CreationPreset, type CreationWeapon } from '../characterCreation/assets';

type ClipData = {
  fps: number;
  duration?: number;
  tracks: { name: string; positions: number[][]; rotations: number[][] }[];
};

export type BattleAvatar = {
  root: any;
  update: (delta: number) => void;
  setMoving: (moving: boolean) => void;
  setWeapon: (index: number) => void;
  jump: () => void;
  roll: () => void;
  attack: () => void;
  reload: () => void;
  dispose: () => void;
};

export async function createBattleAvatar(assets: CreationAssets, preset: CreationPreset,
  appearance: Appearance, weapons: CreationWeapon[]): Promise<BattleAvatar> {
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const textures: any[] = [];
  const materials: any[] = [];
  const loadModel = async (path: string) => (await loader.loadAsync(assetUrl(path))).scene;
  const loadTexture = async (path: string) => {
    const texture = await textureLoader.loadAsync(assetUrl(path));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    textures.push(texture);
    return texture;
  };
  const material = (map: any, color = '#ffffff', transparent = false) => {
    const result = new THREE.MeshPhongMaterial({ map, color, shininess: 12,
      specular: '#191319', transparent, depthWrite: !transparent, alphaTest: transparent ? 0.015 : 0 });
    materials.push(result);
    return result;
  };
  const root = await loadModel(assets.models.body01);
  const bodyMap = await loadTexture(preset.body);
  let skeleton: any;
  root.traverse((object: any) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    skeleton = object.skeleton;
    object.material = material(bodyMap);
    object.frustumCulled = false;
  });
  if (!skeleton) throw new Error('角色骨骼缺失');
  const bones = skeleton;
  const boneIndices = new Map<string, number>(bones.bones.map((bone: any, index: number) => [bone.name, index]));
  const addPart = async (path: string, partMaterial: any, offset?: number[]) => {
    const part = await loadModel(path);
    const group = new THREE.Group();
    const meshes: any[] = [];
    part.traverse((object: any) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    for (const object of meshes) {
      if (offset) object.geometry.translate(offset[0], offset[1], offset[2]);
      if (object instanceof THREE.SkinnedMesh) {
        const indices = object.geometry.attributes.skinIndex;
        const oldSkeleton = object.skeleton;
        for (let index = 0; index < indices.array.length; index += 1) {
          const target = boneIndices.get(oldSkeleton.bones[indices.array[index]].name);
          if (target === undefined) throw new Error('角色配件骨骼缺失');
          indices.array[index] = target;
        }
        indices.needsUpdate = true;
        object.bind(bones, new THREE.Matrix4());
      }
      object.material.dispose();
      object.material = partMaterial;
      object.frustumCulled = false;
      group.add(object);
    }
    root.add(group);
    return group;
  };

  const eyes = await Promise.all(preset.eyes.map(loadTexture));
  const rightEyes = eyes.map((texture) => {
    const mirror = texture.clone();
    mirror.repeat.x = -1;
    mirror.offset.x = 1;
    mirror.needsUpdate = true;
    textures.push(mirror);
    return mirror;
  });
  const mouths = await Promise.all(preset.mouths.map(loadTexture));
  await Promise.all([
    addPart(assets.models.head01, material(null, assets.skinColor)),
    addPart(assets.models.l_eye, material(eyes[appearance.eyes] ?? eyes[0], '#ffffff', true)),
    addPart(assets.models.r_eye, material(rightEyes[appearance.eyes] ?? rightEyes[0], '#ffffff', true)),
    addPart(assets.models.mouth, material(mouths[appearance.mouth] ?? mouths[0], '#ffffff', true)),
    loadTexture(assets.models.noseTexture).then((map) => addPart(assets.models.nose, material(map, '#ffffff', true))),
    ...preset.ears.map((path, index) => addPart(path, material(null, assets.skinColor),
      [index === 0 ? 0.235 : -0.235, 1.04, 0.035])),
    ...preset.fixedParts.map(async (part) => addPart(part.model, material(await loadTexture(part.texture)))),
    ...preset.hair.map(async (part, index) => {
      const group = await addPart(part.model, material(await loadTexture(part.texture)));
      group.visible = index === appearance.hair;
    }),
    ...preset.accessories.map(async (part, index) => {
      const group = await addPart(part.model, material(await loadTexture(part.texture)));
      group.visible = (preset.accessorySets[appearance.accessory] ?? []).includes(index);
    }),
  ]);

  const makeClip = (data: ClipData, name: string) => new THREE.AnimationClip(name, data.duration ?? -1,
    data.tracks.flatMap((track) => {
      if (!boneIndices.has(track.name)) return [];
      const positionTimes = track.positions.map((_, index) => index / data.fps);
      const rotationTimes = track.rotations.map((_, index) => index / data.fps);
      return [new THREE.VectorKeyframeTrack(`${track.name}.position`, positionTimes, track.positions.flat()),
        new THREE.QuaternionKeyframeTrack(`${track.name}.quaternion`, rotationTimes, track.rotations.flat())];
    }));
  const fetchClip = async (path: string, name: string) => {
    const response = await fetch(path.startsWith('gameplay:')
      ? `${import.meta.env.BASE_URL}assets/gameplay/animations/${path.slice(9)}` : assetUrl(path));
    if (!response.ok) throw new Error(`动画加载失败: ${name}`);
    return makeClip(await response.json() as ClipData, name);
  };
  const entries = await Promise.all(weapons.map(async (weapon) => {
    const set = weapon.animation.match(/thirdperson-male-(.+)-stdidle/)?.[1] ?? weapon.id;
    const [idle, run, jump, roll, shoot, reload] = await Promise.all([
      fetchClip(weapon.animation, `${weapon.id}-idle`),
      fetchClip(`gameplay:${set}-run.json`, `${weapon.id}-run`),
      fetchClip(`gameplay:${set}-jump.json`, `${weapon.id}-jump`).catch(() => null),
      fetchClip(`gameplay:${set}-roll.json`, `${weapon.id}-roll`).catch(() => null),
      weapon.actions?.attack ? fetchClip(weapon.actions.attack, `${weapon.id}-shoot`)
        : fetchClip(`gameplay:${set}-attack.json`, `${weapon.id}-shoot`).catch(() => null),
      weapon.actions?.reload ? fetchClip(weapon.actions.reload, `${weapon.id}-reload`) : Promise.resolve(null),
    ]);
    const parts = await Promise.all(weapon.parts.map(async (part) => {
      const model = await loadModel(part.model);
      const map = part.texture ? await loadTexture(part.texture) : null;
      const partMaterial = material(map);
      model.traverse((object: any) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.material = partMaterial;
        object.frustumCulled = false;
      });
      const bone = bones.bones[boneIndices.get(part.bone) ?? -1];
      if (!bone) throw new Error(`武器挂点缺失: ${part.bone}`);
      bone.add(model);
      return model;
    }));
    return { idle, run, jump, roll, shoot, reload, parts };
  }));
  const mixer = new THREE.AnimationMixer(root);
  let selected = 0;
  let moving = false;
  let action: any = null;
  let transient = 0;
  const play = (clip: any, once = false) => {
    const next = mixer.clipAction(clip);
    if (action === next && !once) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (action && action !== next) next.crossFadeFrom(action, 0.12, true);
    action = next;
    transient = once ? clip.duration : 0;
  };
  const base = () => play(moving ? entries[selected].run : entries[selected].idle);
  const avatar: BattleAvatar = {
    root,
    update(delta) {
      mixer.update(delta);
      if (transient > 0) {
        transient -= delta;
        if (transient <= 0) { transient = 0; base(); }
      }
    },
    setMoving(value) { if (moving !== value) { moving = value; if (!transient) base(); } },
    setWeapon(index) {
      selected = Math.max(0, Math.min(index, entries.length - 1));
      entries.forEach((entry, slot) => entry.parts.forEach((part) => { part.visible = slot === selected; }));
      transient = 0;
      base();
    },
    attack() { play(entries[selected].shoot ?? entries[selected].idle, true); },
    reload() { if (entries[selected].reload) play(entries[selected].reload, true); },
    jump() { if (entries[selected].jump) play(entries[selected].jump, true); },
    roll() { if (entries[selected].roll) play(entries[selected].roll, true); },
    dispose() {
      mixer.stopAllAction();
      root.traverse((object: any) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      materials.forEach((entry) => entry.dispose());
      textures.forEach((entry) => entry.dispose());
      bones.dispose();
    },
  };
  avatar.setWeapon(0);
  return avatar;
}
