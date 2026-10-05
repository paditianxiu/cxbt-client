// Load every converted GLB through the actual Three.js runtime. PNG references
// are checked on disk here; browser smoke tests exercise decoding/rendering.
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoadingManager, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;
const output = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../public/assets/cache', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.failed, 0, 'Export contains failures');
const manager = new LoadingManager();
const checkedTextures = new Set();
manager.addHandler(/\.png$/, {
  load(url, onLoad, _progress, onError) {
    const texture = new Texture();
    const filename = decodeURIComponent(url);
    const check = checkedTextures.has(filename) ? Promise.resolve() : readFile(filename).then((data) => {
      assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', filename);
      checkedTextures.add(filename);
    });
    check.then(() => onLoad(texture), onError);
    return texture;
  },
});
const loader = new GLTFLoader(manager);
const counts = { assets: 0, meshes: 0, skinnedMeshes: 0, bones: 0, colliders: 0, emptyCollisions: 0, physics: 0 };
const textureFailures = [];
manager.onError = (url) => textureFailures.push(url);

for (const asset of manifest.assets) {
  assert.equal(asset.status, 'ok', asset.source);
  const filename = path.join(output, asset.url);
  const buffer = await readFile(filename);
  assert.equal(buffer.readUInt32LE(8), buffer.length, `${asset.source}: GLB byte length`);
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString());
  for (const material of document.materials ?? []) {
    for (const uri of Object.values(material.extras?.pdeTextureMaps ?? {})) {
      assert.ok((await stat(path.resolve(path.dirname(filename), decodeURIComponent(uri)))).size > 0);
    }
  }
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), `${path.dirname(filename)}/`);
  gltf.scene.updateMatrixWorld(true);
  let meshes = 0;
  let bones = 0;
  const resources = new Set();
  gltf.scene.traverse((object) => {
    if (object.isBone) bones += 1;
    if (!object.isMesh) return;
    meshes += 1;
    const geometry = object.geometry;
    const positions = geometry.attributes.position;
    assert.ok(positions.count > 0, asset.source);
    for (const attribute of Object.values(geometry.attributes)) {
      assert.equal(attribute.count, positions.count, `${asset.source}: attribute length`);
      assert.ok(attribute.array.every(Number.isFinite), `${asset.source}: finite attributes`);
    }
    assert.ok(geometry.index.array.every((index) => index < positions.count), `${asset.source}: indices`);
    if (object.isSkinnedMesh) {
      counts.skinnedMeshes += 1;
      const joints = geometry.attributes.skinIndex;
      const weights = geometry.attributes.skinWeight;
      assert.ok(joints.array.every((index) => index < object.skeleton.bones.length), `${asset.source}: skin indices`);
      for (let i = 0; i < weights.count; i += 1) {
        const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        assert.ok(Math.abs(total - 1) < 1e-5, `${asset.source}: weight normalization`);
      }
      for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 32))) {
        const original = new Vector3().fromBufferAttribute(positions, i);
        const skinned = object.applyBoneTransform(i, original.clone());
        assert.ok(original.distanceTo(skinned) < 0.001, `${asset.source}: bind pose displacement`);
      }
      resources.add(object.skeleton);
    }
    if (asset.kind === 'collision') {
      assert.equal(object.userData.collision.shape, 'trimesh');
      counts.colliders += 1;
    }
    resources.add(geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      if (material.map) resources.add(material.map);
    }
  });
  if (asset.primitives !== undefined) assert.equal(meshes, asset.primitives, asset.source);
  if (asset.bones !== undefined) assert.equal(bones, asset.bones, asset.source);
  if (asset.kind === 'physics') {
    assert.ok(gltf.scene.userData.pdePhysics, `${asset.source}: physics metadata`);
    counts.physics += 1;
  }
  if (asset.empty) {
    assert.equal(meshes, 0, asset.source);
    counts.emptyCollisions += 1;
  }
  resources.forEach((resource) => resource.dispose());
  counts.assets += 1;
  counts.meshes += meshes;
  counts.bones += bones;
  if (counts.assets % 500 === 0) console.log(`Validated ${counts.assets}/${manifest.assets.length}`);
}
assert.equal(textureFailures.length, 0, textureFailures.join('\n'));
const report = { ...counts, colorTextures: checkedTextures.size, warnings: manifest.assets.filter((asset) => asset.warnings).map(({ source, warnings }) => ({ source, warnings })) };
await writeFile(path.join(output, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
