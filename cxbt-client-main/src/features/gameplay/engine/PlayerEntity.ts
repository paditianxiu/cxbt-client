import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 玩家实体引擎类 (与 React 完全解耦的纯粹 3D 逻辑)
 * 可在沙盒、实际游戏世界通用。
 */
export class PlayerEntity {
  public modelGroup: any;
  public mixer: any = null;
  public isReady: boolean = false;

  private actions: Record<string, any> = {};
  private currentActionName: string = 'idle';

  // 物理与移动参数
  private speed: number = 5.0;
  private gravity: number = -15.0;
  private jumpVelocity: number = 0;
  private isJumping: boolean = false;

  // 控制指令缓存
  private targetDirection = new THREE.Vector3();
  private targetCameraYaw: number = 0;
  private isMoving: boolean = false;

  constructor(scene: any) {
    this.modelGroup = new THREE.Group();
    scene.add(this.modelGroup);
  }

  // =========================================
  // 1. 资源组装 (Avatar Builder)
  // =========================================
  public async loadAvatar(headPath: string, bodyPath: string) {
    const loader = new GLTFLoader();
    try {
      const [headGltf, bodyGltf] = await Promise.all([
        loader.loadAsync(headPath),
        loader.loadAsync(bodyPath)
      ]);

      const headScene = headGltf.scene;
      this.modelGroup.add(headScene);

      // 提取身体模型中的蒙皮网格 (SkinnedMesh) 并重绑到主骨架
      const bodyScene = bodyGltf.scene;
      let mainSkeleton: any = null;
      
      headScene.traverse((child: any) => {
        if (child.isSkinnedMesh && !mainSkeleton) {
          mainSkeleton = child.skeleton;
        }
      });

      // 提取主骨架的骨骼映射 (名称 -> 索引)
      const boneIndices = new Map<string, number>();
      if (mainSkeleton) {
        mainSkeleton.bones.forEach((bone, index) => {
          boneIndices.set(bone.name, index);
        });
      }

      const bodyMeshes: any[] = [];
      bodyScene.traverse((child: any) => {
        if (child.isSkinnedMesh) bodyMeshes.push(child);
      });
      
      bodyMeshes.forEach(mesh => {
        if (mainSkeleton) {
          // 重新映射顶点绑定的骨骼索引 (极其关键，否则模型会变成面条怪物)
          const indices = mesh.geometry.attributes.skinIndex;
          const oldSkeleton = mesh.skeleton;
          if (oldSkeleton) {
            for (let i = 0; i < indices.array.length; i++) {
              const boneName = oldSkeleton.bones[indices.array[i]].name;
              const targetIdx = boneIndices.get(boneName);
              if (targetIdx !== undefined) {
                indices.array[i] = targetIdx;
              }
            }
            indices.needsUpdate = true;
          }
          mesh.bind(mainSkeleton, new THREE.Matrix4());
        }
        headScene.add(mesh);
      });

      // 初始化混合器
      this.mixer = new THREE.AnimationMixer(this.modelGroup);
      this.isReady = true;

      // 返回被组装好的头节点，以供外部(沙盒)挂载骨骼辅助线等调试工具
      return headScene;
    } catch (err) {
      console.error('[PlayerEntity] Avatar Loading Error:', err);
      throw err;
    }
  }

  // =========================================
  // 2. 动画解析与加载 (Animation System)
  // =========================================
  public async loadAnimations(animMap: Record<string, string>) {
    if (!this.mixer) {
      console.warn('[PlayerEntity] Please loadAvatar before loadAnimations.');
      return;
    }

    const fetchClip = async (path: string, name: string) => {
      const response = await fetch(path);
      const data = await response.json();
      return new THREE.AnimationClip(name, data.duration ?? -1, data.tracks.flatMap((track: any) => {
        const positionTimes = track.positions.map((_: any, idx: number) => idx / data.fps);
        const rotationTimes = track.rotations.map((_: any, idx: number) => idx / data.fps);
        return [
          new THREE.VectorKeyframeTrack(`${track.name}.position`, positionTimes, track.positions.flat()),
          new THREE.QuaternionKeyframeTrack(`${track.name}.quaternion`, rotationTimes, track.rotations.flat())
        ];
      }));
    };

    try {
      for (const [actionName, path] of Object.entries(animMap)) {
        const clip = await fetchClip(path, actionName);
        this.actions[actionName] = this.mixer.clipAction(clip);
      }
      
      // 加载完毕后，默认播放待机动作
      if (this.actions['idle']) {
        this.actions['idle'].play();
        this.currentActionName = 'idle';
      }
    } catch (err) {
      console.error('[PlayerEntity] Animation Loading Error:', err);
    }
  }

  // =========================================
  // 3. 控制指令接收 (Controller Input)
  // =========================================
  /**
   * 外部仅能通过此接口干预玩家意图，隔离实现细节
   * @param direction - 基于键盘输入的原始 XYZ 移动趋势
   * @param cameraYaw - 当前相机的偏航角，用于计算真正的世界移动方向
   * @param jumpCmd - 是否触发起跳指令
   */
  public setInput(direction: any, cameraYaw: number, jumpCmd: boolean) {
    this.targetDirection.copy(direction);
    this.targetCameraYaw = cameraYaw;
    this.isMoving = direction.lengthSq() > 0.01;

    // 仅在非起跳状态下允许跳跃
    if (jumpCmd && !this.isJumping) {
      this.isJumping = true;
      this.jumpVelocity = 6.0;
    }
  }

  // =========================================
  // 4. 物理引擎与帧刷新 (Engine Loop)
  // =========================================
  public update(delta: number) {
    if (!this.isReady) return;

    // 1. 动画状态机决策
    let nextAction = 'idle';
    if (this.isJumping) {
      nextAction = 'jump';
    } else if (this.isMoving) {
      nextAction = 'run';
    }

    // 状态切换 (执行动画的 CrossFade 平滑过渡)
    if (this.currentActionName !== nextAction && this.actions[nextAction] && this.actions[this.currentActionName]) {
      const prev = this.actions[this.currentActionName];
      const next = this.actions[nextAction];
      next.reset().play();
      next.crossFadeFrom(prev, 0.2, true);
      this.currentActionName = nextAction;
    }

    // 2. 更新动作时间轴
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // 3. 转身与平移物理
    if (this.isMoving) {
      const angle = Math.atan2(this.targetDirection.x, this.targetDirection.z);
      const targetRotation = this.targetCameraYaw + angle;
      
      let diff = targetRotation - this.modelGroup.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      this.modelGroup.rotation.y += diff * 10 * delta; // 转身插值速度为 10

      const moveX = Math.sin(this.modelGroup.rotation.y) * this.speed * delta;
      const moveZ = Math.cos(this.modelGroup.rotation.y) * this.speed * delta;
      this.modelGroup.position.x += moveX;
      this.modelGroup.position.z += moveZ;
    }

    // 4. 简单重力物理计算
    if (this.isJumping) {
      this.modelGroup.position.y += this.jumpVelocity * delta;
      this.jumpVelocity += this.gravity * delta;
      if (this.modelGroup.position.y <= 0) {
        this.modelGroup.position.y = 0;
        this.isJumping = false;
      }
    }
  }
}
