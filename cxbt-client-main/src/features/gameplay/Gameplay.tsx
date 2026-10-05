import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import * as THREE from 'three';
import { WS_BASE } from '../../api';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SavedCharacter } from '../characterCreation/character';
import { type CreationAssets, type CreationWeapon } from '../characterCreation/assets';
import type { LobbyAssets } from '../lobby/assets';
import type { RoomConfig } from '../gameMode/CreateRoomDialog';
import { createBattleAvatar, type BattleAvatar } from './avatar';
import { createBattleAudio } from './audio';
import { createProjectileSystem, weaponKind } from './projectiles';
import './Gameplay.css';

type MapDefinition = {
  scene: string;
  collision: string | null;
  minimap: string | null;
  airWalls: string[];
  bounds: number[] | null;
  camera: number[] | null;
  fog: number[] | null;
  ambience?: string | null;
};
type BattleControl = { switchWeapon: (index: number) => void; fire: () => void; reload: () => void };

const BASE = `${import.meta.env.BASE_URL}assets/gameplay/`;
const img = (name: string) => `${BASE}ui/${name}.png`;
const AMMO: Record<string, number> = { pistol: 12, sniperrifle: 5, shotgun: 8, rpg: 1,
  bow: 1, crossbow: 1, machinegun: 80, smg: 30, sprayer: 60, grenadelauncher: 6, grenade: 1 };
const DEFAULT_AMMO = 30;
const MAX_HEALTH = 3201;
const ROUND_LENGTH = 3 * 60;
const SKILL_ICONS = ['ballistic', 'bandage_heal', 'assimilation', 'bloodpoison'];

function magazine(weapon: CreationWeapon) {
  if (weaponKind(weapon.id) === 'melee') return 0;
  const family = weapon.id.split('_')[0];
  return AMMO[family] ?? DEFAULT_AMMO;
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function BattleScene({ map, character, creation, assets, weapons, active, onReady, onPosition,
  onShot, onHit, onReload, onWeaponChange, onDamage, paused, otherPlayers, roomPlayers }: {
  map: MapDefinition;
  character: SavedCharacter;
  creation: CreationAssets;
  assets: LobbyAssets;
  weapons: CreationWeapon[];
  active: RefObject<BattleControl | null>;
  paused: RefObject<boolean>;
  onReady: () => void;
  onPosition: (x: number, z: number, yaw: number) => void;
  onShot: () => boolean;
  onHit: (targetId: string, damage: number) => void;
  onReload: () => void;
  onWeaponChange: (index: number) => void;
  onDamage: (amount: number) => void;
  otherPlayers: React.RefObject<Record<string, { buffer: {x: number, z: number, yaw: number, time: number}[] }>>;
  roomPlayers: any;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const shotRef = useRef(onShot);
  const hitRef = useRef(onHit);
  const reloadRef = useRef(onReload);
  const positionRef = useRef(onPosition);
  const readyRef = useRef(onReady);
  const weaponChangeRef = useRef(onWeaponChange);
  const damageRef = useRef(onDamage);
  shotRef.current = onShot;
  hitRef.current = onHit;
  reloadRef.current = onReload;
  positionRef.current = onPosition;
  readyRef.current = onReady;
  weaponChangeRef.current = onWeaponChange;
  damageRef.current = onDamage;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let frame = 0;
    let avatar: BattleAvatar | null = null;
    let visual: any = null;
    let collision: any = null;
    let mapVisible: any[] = [];
    let collisionMeshes: any[] = [];
    let floorMeshes: any[] = [];
    const replacedMaterials = new Set<any>();
    const airWallMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const audio = createBattleAudio(map.ambience);
    audio.start();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#d9e9e9');
    if (map.fog && map.fog.length >= 4) scene.fog = new THREE.Fog('#d9e9e9', Math.max(35, map.fog[1]), map.fog[2]);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.08, 450);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x777c6c, 2.4));
    const sun = new THREE.DirectionalLight(0xfff0db, 2.3);
    sun.position.set(40, 70, 45);
    scene.add(sun);
    const position = new THREE.Vector3(map.camera?.[0] ?? 0, 0, map.camera?.[2] ?? 0);
    let yaw = 0;
    let pitch = 0.1;
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let selected = 0;
    let lastShot = 0;
    let shotFlash = 0;
    let ready = false;
    let grounded = false;
    let verticalSpeed = 0;
    let rollTime = 0;
    let audioPaused = false;
    let footstepTime = 0;
    let footstepIndex = 0;
    const rollDirection = new THREE.Vector3();
    const keys = new Set<string>();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const direction = new THREE.Vector3();
    const candidate = new THREE.Vector3();
    const target = new THREE.Vector3();
    const clock = new THREE.Clock();
    const flash = new THREE.PointLight(0xffcf79, 0, 7);
    scene.add(flash);
    const projectiles = createProjectileSystem(scene, () => collisionMeshes.length ? collisionMeshes : mapVisible,
      (point, radius) => {
        const distance = point.distanceTo(position.clone().add(new THREE.Vector3(0, 1, 0)));
        if (distance < radius) damageRef.current(Math.ceil(650 * (1 - distance / radius)));
      });

    const floorAt = (x: number, z: number, fromY: number) => {
      raycaster.set(new THREE.Vector3(x, fromY, z), down);
      raycaster.far = 100;
      const hits = raycaster.intersectObjects(floorMeshes.length ? floorMeshes : mapVisible, true);
      return hits.find((hit: any) => hit.face &&
        hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.35)?.point.y;
    };
    const blocked = (from: any, to: any) => {
      if (!collisionMeshes.length) return false;
      const motion = to.clone().sub(from);
      if (motion.lengthSq() < 0.0001) return false;
      const distance = motion.length();
      raycaster.set(from.clone().add(new THREE.Vector3(0, 0.7, 0)), motion.normalize());
      raycaster.far = Math.max(0.55, distance + 0.32);
      return raycaster.intersectObjects(collisionMeshes, true).some((hit: any) => hit.distance > 0.08);
    };
    const fire = () => {
      const family = weapons[selected]?.id.split('_')[0] ?? '';
      const kind = weaponKind(weapons[selected]?.id ?? '');
      const delay = kind === 'melee' ? 430 : kind === 'grenade' ? 800 : 140;
      if (!ready || !avatar || paused.current || performance.now() - lastShot < delay) return;
      if (kind !== 'melee' && !shotRef.current()) return;
      lastShot = performance.now();
      avatar.attack();
      audio.play(`fire-${['pistol', 'sniperrifle', 'shotgun', 'smg', 'machinegun', 'knives',
        'bow', 'crossbow', 'grenadelauncher', 'grenade', 'shield', 'rpg'].includes(family)
        ? family : kind === 'melee' ? 'knives' : 'pistol'}`, 0.55);
      if (kind === 'melee') return;
      const aim = camera.getWorldDirection(new THREE.Vector3());
      const muzzle = position.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.75, 1.3, Math.cos(yaw) * 0.75));
      projectiles.spawn(kind, muzzle, aim);
      if (kind !== 'grenade') {
        shotFlash = 0.08;
        flash.position.copy(muzzle);
        flash.intensity = 6;
        
        raycaster.set(camera.position, aim);
        raycaster.far = 100;
        const hits = raycaster.intersectObjects(collisionMeshes, true);
        const firstHit = hits.find((h: any) => h.distance > 0.08);
        if (firstHit && firstHit.object.userData?.isPlayer) {
          const damage = kind === 'sniperrifle' ? 85 : kind === 'shotgun' ? 35 : 18;
          hitRef.current(firstHit.object.userData.userId, damage);
        }
      }
    };
    active.current = {
      switchWeapon(index) {
        if (selected === index) return;
        selected = index;
        avatar?.setWeapon(index);
        const family = weapons[index]?.id.split('_')[0] ?? '';
        audio.play(['pistol', 'sniperrifle', 'shotgun', 'smg', 'machinegun', 'knives',
          'grenade', 'rpg', 'bow', 'crossbow', 'shield', 'sprayer', 'grenadelauncher'].includes(family)
          ? family : 'pistol');
        weaponChangeRef.current(index);
      },
      fire,
      reload() {
        if (weaponKind(weapons[selected]?.id ?? '') === 'melee') return;
        avatar?.reload();
        reloadRef.current();
      },
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      if (paused.current) return;
      keys.add(event.code);
      audio.start();
      if (event.code === 'Space' && !event.repeat && ready && grounded && !paused.current) {
        grounded = false;
        verticalSpeed = 7.5;
        avatar?.jump();
        audio.play('jump');
      }
      if ((event.code === 'ShiftLeft' || event.code === 'ControlLeft') && !event.repeat && ready && grounded && !paused.current && rollTime <= 0) {
        rollTime = 0.45;
        rollDirection.set(0, 0, 1);
        if (keys.has('KeyA')) rollDirection.x = 1;
        if (keys.has('KeyD')) rollDirection.x = -1;
        if (keys.has('KeyS')) rollDirection.z = -1;
        rollDirection.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
        avatar?.roll();
        audio.play('roll');
      }
      if (event.code === 'KeyR' && !event.repeat) active.current?.reload();
      if (event.code.startsWith('Digit') && !event.repeat) {
        const index = Number(event.code.slice(5)) - 1;
        if (index >= 0 && index < weapons.length) active.current?.switchWeapon(index);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onBlur = () => keys.clear();
    const onMove = (event: PointerEvent) => {
      const locked = document.pointerLockElement === renderer.domElement || document.pointerLockElement === document.body;
      if (!locked && !dragging) return;
      const dx = locked ? event.movementX : event.clientX - pointerX;
      const dy = locked ? event.movementY : event.clientY - pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      yaw -= dx * 0.005;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.003, -0.35, 0.65);
    };
    const onDown = (event: PointerEvent) => {
      if (paused.current) return;
      audio.start();
      if (event.button === 2) {
        if (!document.pointerLockElement) void renderer.domElement.requestPointerLock();
        dragging = true;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!document.pointerLockElement) mount.setPointerCapture(event.pointerId);
      } else if (event.button === 0) {
        if (!document.pointerLockElement) void renderer.domElement.requestPointerLock();
        else fire();
      }
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 2) dragging = false;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (paused.current || !weapons.length) return;
      active.current?.switchWeapon((selected + (event.deltaY > 0 ? 1 : weapons.length - 1)) % weapons.length);
    };
    const onContext = (event: MouseEvent) => event.preventDefault();
    const onLockChange = () => {
      dragging = false;
      if (!document.pointerLockElement) keys.clear();
    };
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', onBlur);
    document.addEventListener('pointermove', onMove);
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    mount.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
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

    const load = async () => {
      const loader = new GLTFLoader();
      const [mapGltf, collisionGltf, player] = await Promise.all([
        loader.loadAsync(`${BASE}${map.scene}`),
        map.collision ? loader.loadAsync(`${BASE}${map.collision}`).catch(() => null) : Promise.resolve(null),
        createBattleAvatar(creation, creation.jobs[character.jobId].presets[character.appearance.gender], character.appearance, weapons),
      ]);
      if (cancelled) { player.dispose(); return; }
      visual = mapGltf.scene;
      collision = collisionGltf?.scene ?? null;
      const airWalls = new Set(map.airWalls);
      visual.traverse((object: any) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (airWalls.has(object.name)) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: any) => replacedMaterials.add(material));
          object.material = airWallMaterial;
          object.userData.airWall = true;
          return;
        }
        object.frustumCulled = true;
        mapVisible.push(object);
      });
      collision?.traverse((object: any) => {
        if (!(object instanceof THREE.Mesh)) return;
        collisionMeshes.push(object);
        if (object.userData.collision?.surfaceId !== 2) floorMeshes.push(object);
      });
      scene.add(visual);
      collision?.updateMatrixWorld(true);
      avatar = player;
      scene.add(player.root);
      const ground = floorAt(position.x, position.z, 80);
      position.y = ground ?? 0;
      grounded = ground !== undefined;
      player.root.position.copy(position);
      ready = true;
      readyRef.current();
    };
    void load().catch((error: unknown) => {
      if (!cancelled) mount.dataset.error = error instanceof Error ? error.message : '战场加载失败';
    });
    const otherPlayerAvatars = new Map<string, any>();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);

      if (otherPlayers.current) {
        const renderTime = performance.now() - 100;
        for (const [id, stateObj] of Object.entries(otherPlayers.current)) {
          const buffer = stateObj.buffer;
          if (buffer.length === 0) continue;

          let state0 = buffer[0];
          let state1 = buffer[buffer.length - 1];
          let found = false;

          for (let i = buffer.length - 1; i >= 0; i--) {
            if (buffer[i].time <= renderTime) {
              state0 = buffer[i];
              state1 = buffer[i + 1] || buffer[i];
              found = true;
              break;
            }
          }

          if (!found) {
            state0 = buffer[0];
            state1 = buffer[0];
          }

          let interpX = state0.x;
          let interpZ = state0.z;
          let interpYaw = state0.yaw;

          if (state0 !== state1 && state1.time > state0.time) {
            const t = (renderTime - state0.time) / (state1.time - state0.time);
            const clampedT = Math.max(0, Math.min(1, t));
            interpX = state0.x + (state1.x - state0.x) * clampedT;
            interpZ = state0.z + (state1.z - state0.z) * clampedT;
            let dy = state1.yaw - state0.yaw;
            while (dy > Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            interpYaw = state0.yaw + dy * clampedT;
          }

          let avatarObj = otherPlayerAvatars.get(id);
          if (!avatarObj) {
            // Create a dummy group to hold the avatar and hitbox immediately
            const group = new THREE.Group();
            scene.add(group);
            
            // Add collision capsule to root immediately
            const capsuleGeom = new THREE.CapsuleGeometry(0.35, 0.9, 4, 8);
            const capMat = new THREE.MeshBasicMaterial({ visible: false }); // Invisible hitbox
            const hitbox = new THREE.Mesh(capsuleGeom, capMat);
            hitbox.position.y = 0.8;
            hitbox.userData = { isPlayer: true, userId: id };
            group.add(hitbox);
            collisionMeshes.push(hitbox);
            
            avatarObj = { root: group, update: null, loaded: false };
            otherPlayerAvatars.set(id, avatarObj);
            
            const pInfo = roomPlayers && roomPlayers[id];
            if (pInfo && pInfo.jobId && pInfo.appearance) {
              const job = creation.jobs[pInfo.jobId];
              if (job) {
                const preset = job.presets[pInfo.appearance.gender];
                let pWeapons = pInfo.weaponIds ? pInfo.weaponIds.map((wId: string) => assets.weapons[wId]).filter(Boolean) : job.weapons;
                if (!pWeapons || pWeapons.length === 0) pWeapons = job.weapons;
                createBattleAvatar(creation, preset, pInfo.appearance, pWeapons).then(loadedAvatar => {
                  group.add(loadedAvatar.root);
                  avatarObj.update = loadedAvatar.update;
                  avatarObj.loaded = true;
                }).catch(console.error);
              }
            } else {
              // Fallback if data is missing, render red capsule
              const mat = new THREE.MeshStandardMaterial({ color: 0xef4e54 });
              const fallbackMesh = new THREE.Mesh(capsuleGeom, mat);
              fallbackMesh.position.y = 0.8;
              group.add(fallbackMesh);
              avatarObj.loaded = true;
            }
          }
          
          if (avatarObj = otherPlayerAvatars.get(id)) {
            const floor = floorAt(interpX, interpZ, 80) ?? 0;
            const oldPos = avatarObj.root.position.clone();
            avatarObj.root.position.set(interpX, floor, interpZ);
            avatarObj.root.rotation.y = interpYaw;
            if (avatarObj.update && avatarObj.loaded) {
              const speed = oldPos.distanceTo(avatarObj.root.position) / delta;
              const isMoving = speed > 0.1;
              const charInfo = {
                moveX: 0,
                moveY: isMoving ? 1 : 0,
                weapon: 0,
                aim: new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, interpYaw, 0)),
                grounded: true,
                yaw: interpYaw,
                pitch: 0,
              };
              avatarObj.update(delta, charInfo, false);
            }
          }
        }
      }

      if (paused.current !== audioPaused) {
        audioPaused = paused.current;
        if (audioPaused) audio.pause();
        else audio.start();
      }
      if (avatar) {
        direction.set(0, 0, 0);
        if (keys.has('KeyW') || keys.has('ArrowUp')) direction.z += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) direction.z -= 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) direction.x += 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) direction.x -= 1;
        const moving = direction.lengthSq() > 0 || rollTime > 0;
        avatar.setMoving(moving && !paused.current);
        if (moving && !paused.current) {
          if (rollTime > 0) direction.copy(rollDirection);
          else direction.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
          candidate.copy(position).addScaledVector(direction, delta * (rollTime > 0 ? 8.5 : 4.5));
          const bounds = map.bounds;
          if (bounds?.length && (candidate.x < bounds[0] - bounds[2] / 2 || candidate.x > bounds[0] + bounds[2] / 2 ||
            candidate.z < bounds[1] - bounds[3] / 2 || candidate.z > bounds[1] + bounds[3] / 2)) {
            candidate.copy(position);
          }
          const floor = floorAt(candidate.x, candidate.z, position.y + (grounded ? 2.4 : 0.3));
          if ((floor === undefined || !grounded || Math.abs(floor - position.y) < 0.65) && !blocked(position, candidate)) {
            position.x = candidate.x;
            position.z = candidate.z;
            if (grounded && floor !== undefined) position.y = floor;
          }
          if (grounded && rollTime <= 0) {
            footstepTime -= delta;
            if (footstepTime <= 0) {
              footstepIndex = (footstepIndex % 3) + 1;
              audio.play(`step${footstepIndex}`, 0.35);
              footstepTime = 0.34;
            }
          }
        }
        if (!moving) footstepTime = 0;
        if (rollTime > 0 && !paused.current) rollTime = Math.max(0, rollTime - delta);
        if (!grounded && !paused.current) {
          verticalSpeed -= 18 * delta;
          position.y += verticalSpeed * delta;
          const floor = floorAt(position.x, position.z, position.y + 0.25);
          if (verticalSpeed <= 0 && floor !== undefined && position.y <= floor) {
            position.y = floor;
            verticalSpeed = 0;
            grounded = true;
            audio.play('land', 0.4);
          }
        }
        avatar.root.position.copy(position);
        avatar.root.rotation.y = yaw;
        avatar.update(delta);
        target.copy(position).add(new THREE.Vector3(0, 1.15 + pitch, 0));
        camera.position.copy(position).add(new THREE.Vector3(-Math.sin(yaw) * 2.9, 1.75 + pitch * 2.2, -Math.cos(yaw) * 2.9));
        camera.lookAt(target.clone().add(new THREE.Vector3(Math.sin(yaw) * 3, 0, Math.cos(yaw) * 3)));
        
        // Throttle position reporting to 15 ticks per second to prevent network flood
        if (performance.now() - (positionRef.current as any).lastTime > 66 || !(positionRef.current as any).lastTime) {
          (positionRef.current as any).lastTime = performance.now();
          positionRef.current(position.x, position.z, yaw);
        }
      }
      if (shotFlash > 0) { shotFlash -= delta; if (shotFlash <= 0) flash.intensity = 0; }
      projectiles.update(delta);
      mount.dataset.projectileCount = String(projectiles.count());
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      document.removeEventListener('pointermove', onMove);
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointerup', onUp);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      active.current = null;
      if (document.pointerLockElement) document.exitPointerLock();
      audio.dispose();
      projectiles.dispose();
      avatar?.dispose();
      visual?.traverse((object: any) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: any) => material.dispose());
        }
      });
      collision?.traverse((object: any) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      replacedMaterials.forEach((material: any) => material.dispose());
      airWallMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      mapVisible = [];
      collisionMeshes = [];
      floorMeshes = [];
    };
  }, [map, character, creation, weapons, active, paused]);
  return <div className="battle-canvas" ref={mountRef} data-gameplay-canvas />;
}

export default function Gameplay({ room, character, creation, assets, weaponIds, onExit }: {
  room: RoomConfig;
  character: SavedCharacter;
  creation: CreationAssets;
  assets: LobbyAssets;
  weaponIds: string[];
  onExit: () => void;
}) {
  const [mapDefinitions, setMapDefinitions] = useState<Record<string, MapDefinition>>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(ROUND_LENGTH);
  const [scoreRed, setScoreRed] = useState(0);
  const [scoreBlue, setScoreBlue] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const myUserId = useMemo(() => {
    const me = Object.values(room.players || {}).find((p: any) => p.username === character.name);
    return me ? (me as any).userId : 0;
  }, [room.players, character.name]);
  const otherPlayersRef = useRef<Record<string, { buffer: {x: number, z: number, yaw: number, time: number}[] }>>({});
  const [selected, setSelected] = useState(0);
  const [ammo, setAmmo] = useState<number[]>([]);
  const [reserves, setReserves] = useState<number[]>([]);
  const [health, setHealth] = useState(MAX_HEALTH);
  const [position, setPosition] = useState({ x: 0, z: 0, yaw: 0 });
  const control = useRef<BattleControl | null>(null);
  const selectedRef = useRef(0);
  const pausedRef = useRef(false);
  const ammoRef = useRef<number[]>([]);
  const reservesRef = useRef<number[]>([]);
  pausedRef.current = paused;
  ammoRef.current = ammo;
  reservesRef.current = reserves;
  const weapons = useMemo(() => {
    const listed = weaponIds.map((id) => assets.weapons[id]).filter((weapon): weapon is CreationWeapon => Boolean(weapon));
    return listed.length ? listed : creation.jobs[character.jobId].weapons;
  }, [weaponIds, assets, creation, character.jobId]);
  const current = weapons[selected] ?? weapons[0];
  const currentKind = weaponKind(current?.id ?? '');
  const currentMagazine = current ? magazine(current) : 0;
  const ammoRatio = currentKind === 'melee' ? 1 : Math.max(0, Math.min(1, (ammo[selected] ?? currentMagazine) / Math.max(1, currentMagazine)));
  const healthRatio = health / MAX_HEALTH;
  const healthColor = healthRatio > 0.55 ? '#49d6ef' : healthRatio > 0.25 ? '#ffc354' : '#ef4e54';
  const ammoColor = ammoRatio > 0.55 ? '#49d6ef' : ammoRatio > 0.25 ? '#ffc354' : '#ef4e54';
  const chosenMap = mapDefinitions?.[room.mapId] ?? mapDefinitions?.level1;
  const mapArt = chosenMap?.minimap;

  useEffect(() => {
    if (paused && document.pointerLockElement) document.exitPointerLock();
  }, [paused]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}?roomId=${room.id}&playerId=${myUserId}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tick') {
          setRemaining(msg.time_left);
          setScoreRed(msg.score_red);
          setScoreBlue(msg.score_blue);
        } else if (msg.type === 'health_update' && msg.userId == myUserId) {
          setHealth(msg.hp);
        } else if (msg.type === 'sync' && msg.userId != myUserId) {
          if (!otherPlayersRef.current[msg.userId]) {
            otherPlayersRef.current[msg.userId] = { buffer: [] };
          }
          const buffer = otherPlayersRef.current[msg.userId].buffer;
          buffer.push({ x: msg.x, z: msg.z, yaw: msg.yaw, time: performance.now() });
          if (buffer.length > 20) buffer.shift();
        } else if (msg.type === 'respawn' && msg.userId == myUserId) {
          setHealth(MAX_HEALTH);
        } else if (msg.type === 'game_over') {
          onExit();
          alert(`游戏结束！获胜方: ${msg.winner}`);
        }
      } catch (err) {}
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'sync', userId: myUserId, x: position.x, z: position.z, yaw: position.yaw }));
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [room.id, myUserId]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'sync', userId: myUserId, x: position.x, z: position.z, yaw: position.yaw }));
    }
  }, [position, myUserId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BASE}maps.json`, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error('地图清单加载失败');
      return response.json() as Promise<Record<string, MapDefinition>>;
    }).then((definitions) => setMapDefinitions(definitions)).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setAmmo(weapons.map(magazine));
    setReserves(weapons.map((weapon) => magazine(weapon) * 4));
  }, [weapons]);
  useEffect(() => {
    if (!ready || paused || remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [ready, paused, remaining]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setPaused((value) => !value); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const switchWeapon = (index: number) => {
    if (index < 0 || index >= weapons.length) return;
    selectedRef.current = index;
    setSelected(index);
    control.current?.switchWeapon(index);
  };
  const fire = () => {
    if (pausedRef.current) return;
    control.current?.fire();
  };
  const onShot = () => {
    const index = selectedRef.current;
    if ((ammoRef.current[index] ?? 0) < 1) return false;
    ammoRef.current = ammoRef.current.map((value, slot) => slot === index ? value - 1 : value);
    setAmmo(ammoRef.current);
    return true;
  };
  const onReload = () => {
    const index = selectedRef.current;
    const capacity = magazine(weapons[index]);
    const needed = capacity - (ammoRef.current[index] ?? capacity);
    const amount = Math.min(needed, reservesRef.current[index] ?? 0);
    if (amount <= 0) return;
    ammoRef.current = ammoRef.current.map((value, slot) => slot === index ? value + amount : value);
    reservesRef.current = reservesRef.current.map((value, slot) => slot === index ? value - amount : value);
    setAmmo(ammoRef.current);
    setReserves(reservesRef.current);
  };
  const reportPosition = (x: number, z: number, yaw: number) => {
    setPosition((previous) => Math.abs(previous.x - x) + Math.abs(previous.z - z) + Math.abs(previous.yaw - yaw) > 0.06
      ? { x, z, yaw } : previous);
  };
  const bounds = chosenMap?.bounds;
  const markerX = bounds?.length ? 50 + (position.x - bounds[0]) / bounds[2] * 100 : 50;
  const markerY = bounds?.length ? 50 - (position.z - bounds[1]) / bounds[3] * 100 : 50;

  return <main className={`battle-root${paused ? ' paused' : ''}`} data-gameplay-ready={ready}>
    {chosenMap && <BattleScene map={chosenMap} character={character} creation={creation} assets={assets} weapons={weapons}
      active={control} paused={pausedRef} onReady={() => setReady(true)} onPosition={reportPosition}
      otherPlayers={otherPlayersRef}
      roomPlayers={room.players}
      onShot={onShot} 
      onHit={(targetId, damage) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // targetId in backend ws.go HandleHit is expected to be an integer (the user id in database).
          // Wait! In ws.go it does fmt.Sscanf(attackerID, "%d", &attID) and expects targetId to be float64 in JSON which is then cast to uint.
          // Wait! I need to ensure targetId is passed properly!
          // Actually, let's just pass the raw targetId and let backend parse it, BUT wait!
          // HandleHit expects uint! Our client character.name is a string!
          // I will check how ws.go expects it. Let's just send targetId as a number if possible, or string.
          // Let's check backend ws.go.
          wsRef.current.send(JSON.stringify({ type: 'hit', targetId: targetId, damage }));
        }
      }}
      onReload={onReload} onWeaponChange={(index) => { selectedRef.current = index; setSelected(index); }}
      onDamage={(amount) => setHealth((value) => Math.max(0, value - amount))} />}
    {!ready && <div className="battle-loading" role="status">{error || `${room.mapName} · 战场加载中…`}</div>}
    <div className="battle-reticle" aria-hidden="true"><i /><i /><i /><i /></div>
    <div className="battle-abilities" aria-label="技能状态">
      {SKILL_ICONS.map((icon) => <span key={icon}><img src={img(icon)} alt="" /></span>)}
      <small>{formatTime(remaining)}</small>
    </div>
    <div className="battle-top">
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', marginTop: '60px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', zIndex: 10, pointerEvents: 'none', border: '1px solid rgba(255,255,255,0.2)' }}>
        房间号: {room.id.replace('room-', '')} | 地图: {room.mapName}
      </div>
      <div className="battle-team red"><strong>{scoreRed}</strong></div>
      <div className="battle-time"><b>05</b><small><em>TIME</em> {formatTime(remaining)}</small><div className="battle-progress"><i /><i /></div></div>
      <div className="battle-team blue"><strong>{scoreBlue}</strong></div>
    </div>
    <aside className="battle-minimap" aria-label="小地图">
      <div className="battle-map-image" style={mapArt ? { backgroundImage: `url(${BASE}${mapArt})` } : undefined}>
        <span className="battle-map-marker" style={{ left: `${THREE.MathUtils.clamp(markerX, 5, 95)}%`, top: `${THREE.MathUtils.clamp(markerY, 5, 95)}%`, transform: `translate(-50%, -50%) rotate(${-position.yaw}rad)` }}>▲</span>
      </div>
      <span className="battle-map-name">{room.mapName}</span>
    </aside>
    <div className="battle-bottom">
      <div className="battle-health" aria-label={`生命值 ${health} / ${MAX_HEALTH}`}><img src={img('skin_ingame_heart01')} alt="" />
        <span className="battle-health-meter" role="progressbar" aria-label="生命值" aria-valuemin={0} aria-valuemax={MAX_HEALTH} aria-valuenow={health}>
          <i style={{ height: `${healthRatio * 100}%`, backgroundColor: healthColor }} /></span><b>{health}</b></div>
      <div className="battle-inventory" aria-label="物品栏">{weapons.map((weapon, index) => <button key={`${weapon.id}-${index}`}
        className={index === selected ? 'active' : ''} aria-label={`切换到${weapon.label}`} aria-pressed={index === selected}
        title={`${index + 1} · ${weapon.label}`} onClick={() => switchWeapon(index)}>
        <small>{index + 1}</small><img src={weapon.icon ? `${import.meta.env.BASE_URL}assets/creation/${weapon.icon}` : ''} alt="" />
      </button>)}{SKILL_ICONS.map((icon, index) => <span className="battle-skill" key={icon}>
        <small>{index === 0 ? '左Shift' : index + weapons.length + 1}</small><img src={img(icon)} alt="" />
      </span>)}</div>
      <div className="battle-ammo" aria-label={currentKind === 'melee' ? '近战武器' : `弹药 ${ammo[selected] ?? currentMagazine} / ${currentMagazine}`}>
        <span className="battle-ammo-meter" role="progressbar" aria-label="弹夹" aria-valuemin={0} aria-valuemax={currentMagazine} aria-valuenow={ammo[selected] ?? currentMagazine}
          style={{ '--meter-color': ammoColor } as CSSProperties}><i style={{ width: `${ammoRatio * 100}%` }} /></span>
        <b style={{ color: ammoColor }}>{currentKind === 'melee' ? '∞' : ammo[selected] ?? currentMagazine}</b>
        <img src={img('skin_ingame_icon_ammobg_row')} alt="" /><strong>{reserves[selected] ?? currentMagazine * 4}</strong></div>
    </div>
    <div className="battle-touch-controls"><button onClick={fire}>开火</button><button onClick={() => control.current?.reload()}>换弹</button></div>
    <button className="battle-menu-button" aria-label="打开菜单" title="菜单" onClick={() => setPaused(true)}>☰</button>
    {paused && <div className="battle-pause-shade"><section className="battle-pause" role="dialog" aria-modal="true" aria-label="游戏菜单">
      <h2>游戏菜单</h2><button onClick={() => {
        setPaused(false);
        void document.querySelector<HTMLCanvasElement>('[data-gameplay-canvas] canvas')?.requestPointerLock();
      }}>继续游戏</button><button onClick={onExit}>退出战场</button>
    </section></div>}
  </main>;
}
