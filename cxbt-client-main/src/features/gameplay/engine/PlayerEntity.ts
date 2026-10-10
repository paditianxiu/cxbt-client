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

  // 战术动作状态
  private isRolling: boolean = false;
  private rollTimer: number = 0;
  private rollDuration: number = 0.8;

  private isAttacking: boolean = false;
  private attackTimer: number = 0;
  private attackDuration: number = 0.6;

  // 强制动作模式（用于沙盒动作选项独立测试）
  private forcedAction: string | null = null;

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
        mainSkeleton.bones.forEach((bone: any, index: number) => {
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
      if (this.mixer) {
        this.mixer.stopAllAction();
      }
      this.actions = {};

      for (const [actionName, path] of Object.entries(animMap)) {
        if (!path) continue;
        const clip = await fetchClip(path, actionName);
        this.actions[actionName] = this.mixer.clipAction(clip);
      }
      
      // 加载完毕后，应用默认或强制动作
      if (this.forcedAction && this.actions[this.forcedAction]) {
        this.playAction(this.forcedAction, 0.2, true);
      } else if (this.actions['idle']) {
        this.playAction('idle', 0.2, true);
      }
    } catch (err) {
      console.error('[PlayerEntity] Animation Loading Error:', err);
    }
  }

  // =========================================
  // 3. 动作播放控制 (Action Control)
  // =========================================
  public playAction(actionName: string, duration: number = 0.2, loop: boolean = true) {
    if (!this.actions[actionName]) return;
    const prev = this.actions[this.currentActionName];
    const next = this.actions[actionName];

    if (this.currentActionName === actionName && next.isRunning()) return;

    next.reset();
    if (!loop) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.play();

    if (prev && prev !== next) {
      next.crossFadeFrom(prev, duration, true);
    }
    this.currentActionName = actionName;
  }

  /**
   * 触发翻滚动作
   */
  public roll(): boolean {
    if (this.isRolling || this.isJumping || !this.actions['roll']) return false;
    this.isRolling = true;
    const clipDuration = this.actions['roll'].getClip()?.duration;
    this.rollDuration = clipDuration ? Math.min(clipDuration, 1.0) : 0.8;
    this.rollTimer = this.rollDuration;
    this.playAction('roll', 0.15, false);
    return true;
  }

  /**
   * 触发近战攻击或射击动作
   */
  public attack(): boolean {
    if (this.isAttacking || this.isRolling || !this.actions['attack']) return false;
    this.isAttacking = true;
    const clipDuration = this.actions['attack'].getClip()?.duration;
    this.attackDuration = clipDuration ? Math.min(clipDuration, 1.2) : 0.6;
    this.attackTimer = this.attackDuration;
    this.playAction('attack', 0.1, false);
    return true;
  }

  /**
   * 触发起跳
   */
  public jump(): boolean {
    if (this.isJumping || this.isRolling) return false;
    this.isJumping = true;
    this.jumpVelocity = 6.0;
    return true;
  }

  /**
   * 强制播放指定动作（用于动作调试面板）
   * @param actionName null 表示恢复自动状态机
   */
  public setForcedAction(actionName: string | null) {
    this.forcedAction = actionName;
    if (actionName && this.actions[actionName]) {
      this.playAction(actionName, 0.2, true);
    } else if (!actionName) {
      // 恢复状态机时重置当前动作标记以便平滑切回
      this.currentActionName = '';
      if (this.actions['idle']) {
        this.playAction('idle', 0.2, true);
      }
    }
  }

  public getCurrentAction(): string {
    return this.currentActionName;
  }

  public getLoadedActions(): string[] {
    return Object.keys(this.actions);
  }

  // =========================================
  // 4. 控制指令接收 (Controller Input)
  // =========================================
  public setInput(direction: any, cameraYaw: number, jumpCmd: boolean) {
    this.targetDirection.copy(direction);
    this.targetCameraYaw = cameraYaw;
    this.isMoving = direction.lengthSq() > 0.01;

    // 仅在非起跳状态下允许跳跃
    if (jumpCmd && !this.isJumping && !this.isRolling) {
      this.jump();
    }
  }

  // =========================================
  // 5. 物理引擎与帧刷新 (Engine Loop)
  // =========================================
  public update(delta: number) {
    if (!this.isReady) return;

    // 1. 如果处于强制动作调试模式
    if (this.forcedAction && this.actions[this.forcedAction]) {
      if (this.currentActionName !== this.forcedAction) {
        this.playAction(this.forcedAction, 0.2, true);
      }
      if (this.mixer) {
        this.mixer.update(delta);
      }
      return;
    }

    // 2. 状态机计时更新
    if (this.isRolling) {
      this.rollTimer -= delta;
      if (this.rollTimer <= 0) {
        this.isRolling = false;
      }
    }

    if (this.isAttacking) {
      this.attackTimer -= delta;
      if (this.attackTimer <= 0) {
        this.isAttacking = false;
      }
    }

    // 3. 动画状态机决策
    let nextAction = 'idle';
    if (this.isRolling && this.actions['roll']) {
      nextAction = 'roll';
    } else if (this.isAttacking && this.actions['attack']) {
      nextAction = 'attack';
    } else if (this.isJumping && this.actions['jump']) {
      nextAction = 'jump';
    } else if (this.isMoving && this.actions['run']) {
      nextAction = 'run';
    }

    // 状态切换 (执行动画的 CrossFade 平滑过渡)
    if (this.currentActionName !== nextAction && this.actions[nextAction]) {
      const isOneShot = nextAction === 'roll' || nextAction === 'attack';
      this.playAction(nextAction, 0.15, !isOneShot);
    }

    // 4. 更新动作时间轴
    if (this.mixer) {
      this.mixer.update(delta);
    }

    // 5. 转身与平移物理
    if (this.isRolling) {
      const rollSpeed = 8.5;
      const moveX = Math.sin(this.modelGroup.rotation.y) * rollSpeed * delta;
      const moveZ = Math.cos(this.modelGroup.rotation.y) * rollSpeed * delta;
      this.modelGroup.position.x += moveX;
      this.modelGroup.position.z += moveZ;
    } else if (this.isMoving && !this.isAttacking) {
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

    // 6. 简单重力物理计算
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
