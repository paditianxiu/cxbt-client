import * as THREE from 'three';

export type WeaponKind = 'melee' | 'grenade' | 'rocket' | 'arrow' | 'bullet';

export function weaponKind(id: string): WeaponKind {
  const family = id.split('_')[0];
  if (['knives', 'shield', 'stick'].includes(family)) return 'melee';
  if (['grenade', 'grenadelauncher'].includes(family)) return 'grenade';
  if (family === 'rpg') return 'rocket';
  if (['bow', 'crossbow'].includes(family)) return 'arrow';
  return 'bullet';
}

type Projectile = {
  mesh: any;
  velocity: any;
  lifetime: number;
  kind: WeaponKind;
};

export function createProjectileSystem(scene: any, targets: () => any[],
  onExplosion: (point: any, radius: number) => void) {
  const projectiles: Projectile[] = [];
  const impacts: { mesh: any; lifetime: number }[] = [];
  const raycaster = new THREE.Raycaster();
  const up = new THREE.Vector3(0, 1, 0);

  const release = (mesh: any) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  };
  const impact = (point: any, explosive: boolean) => {
    if (explosive) onExplosion(point, 3.5);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(explosive ? 0.9 : 0.09, 12, 8),
      new THREE.MeshBasicMaterial({ color: explosive ? 0xff9a31 : 0xffe6a3,
        transparent: true, opacity: explosive ? 0.45 : 0.9, depthWrite: false }));
    mesh.position.copy(point);
    scene.add(mesh);
    impacts.push({ mesh, lifetime: explosive ? 0.25 : 0.1 });
  };
  const spawn = (kind: Exclude<WeaponKind, 'melee'>, origin: any, aim: any) => {
    const radius = kind === 'grenade' ? 0.14 : kind === 'rocket' ? 0.09 : kind === 'arrow' ? 0.025 : 0.018;
    const length = kind === 'grenade' ? 0.22 : kind === 'rocket' ? 0.55 : kind === 'arrow' ? 0.65 : 0.32;
    const geometry = kind === 'grenade'
      ? new THREE.SphereGeometry(radius, 10, 8)
      : new THREE.CylinderGeometry(radius, radius, length, 8);
    const color = kind === 'grenade' ? 0x718044 : kind === 'rocket' ? 0x555b50
      : kind === 'arrow' ? 0xd3a16e : 0xffe6a4;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
    const direction = aim.clone().normalize();
    const speed = kind === 'grenade' ? 15 : kind === 'rocket' ? 29 : kind === 'arrow' ? 42 : 85;
    const velocity = direction.clone().multiplyScalar(speed);
    if (kind === 'grenade') velocity.y += 5;
    mesh.name = `projectile-${kind}`;
    mesh.position.copy(origin);
    if (kind !== 'grenade') mesh.quaternion.setFromUnitVectors(up, direction);
    scene.add(mesh);
    projectiles.push({ mesh, velocity, lifetime: kind === 'grenade' ? 2.3 : 2, kind });
  };
  const update = (delta: number) => {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index];
      projectile.lifetime -= delta;
      if (projectile.kind === 'grenade') projectile.velocity.y -= 18 * delta;
      const step = projectile.velocity.clone().multiplyScalar(delta);
      raycaster.set(projectile.mesh.position, step.clone().normalize());
      raycaster.far = step.length();
      const hit = raycaster.intersectObjects(targets(), true)[0];
      if (hit || projectile.lifetime <= 0) {
        impact(hit?.point ?? projectile.mesh.position, projectile.kind === 'grenade' || projectile.kind === 'rocket');
        release(projectile.mesh);
        projectiles.splice(index, 1);
        continue;
      }
      projectile.mesh.position.add(step);
      if (projectile.kind !== 'grenade') projectile.mesh.quaternion.setFromUnitVectors(up, projectile.velocity.clone().normalize());
    }
    for (let index = impacts.length - 1; index >= 0; index -= 1) {
      const entry = impacts[index];
      entry.lifetime -= delta;
      if (entry.lifetime <= 0) { release(entry.mesh); impacts.splice(index, 1); }
    }
  };
  const dispose = () => {
    projectiles.forEach(({ mesh }) => release(mesh));
    impacts.forEach(({ mesh }) => release(mesh));
    projectiles.length = 0;
    impacts.length = 0;
  };
  return { spawn, update, dispose, count: () => projectiles.length };
}
