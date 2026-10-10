import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlayerEntity } from '../../features/gameplay/engine/PlayerEntity';

const ANIM_PATHS = {
  idle: '/assets/creation/idle.json',
  run: '/assets/gameplay/animations/smg_01-run.json',
  jump: '/assets/gameplay/animations/smg_01-jump.json'
};

export default function CharacterController() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在加载引擎类...');
  
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showMesh, setShowMesh] = useState(true);

  const skeletonHelperRef = useRef<any | null>(null);
  const modelRef = useRef<any | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. 初始化纯场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1e293b');
    
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 3, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, -5);
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(50, 50, 0x555555, 0x222222));

    // 2. 引入我们刚写的游戏底层引擎类！
    const player = new PlayerEntity(scene);

    player.loadAvatar('/assets/creation/models/malecommandos.glb', '/assets/creation/models/body01.glb')
      .then(async (headScene) => {
        // 沙盒专属特权：获取到底层组装好的头节点，用来挂载调试骨架线
        const skeleton = new THREE.SkeletonHelper(headScene);
        skeletonHelperRef.current = skeleton;
        scene.add(skeleton);
        modelRef.current = headScene;

        await player.loadAnimations(ANIM_PATHS);
        setStatus('PlayerEntity 引擎加载完毕！纯解耦模式运行中');
      })
      .catch(err => setStatus(`引擎加载失败: ${err}`));

    // 3. 将本地沙盒的键盘事件喂给 PlayerEntity
    const keys = { w: false, a: false, s: false, d: false, space: false };
    const direction = new THREE.Vector3();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') keys.w = true;
      if (e.code === 'KeyA') keys.a = true;
      if (e.code === 'KeyS') keys.s = true;
      if (e.code === 'KeyD') keys.d = true;
      if (e.code === 'Space') keys.space = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') keys.w = false;
      if (e.code === 'KeyA') keys.a = false;
      if (e.code === 'KeyS') keys.s = false;
      if (e.code === 'KeyD') keys.d = false;
      if (e.code === 'Space') keys.space = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // 4. 极致干净的帧循环
    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // 把本帧的物理输入意图打包，发送给引擎处理
      direction.set(0, 0, 0);
      if (keys.w) direction.z -= 1;
      if (keys.s) direction.z += 1;
      if (keys.a) direction.x -= 1;
      if (keys.d) direction.x += 1;
      direction.normalize();

      const cameraYaw = Math.atan2(
        camera.position.x - player.modelGroup.position.x, 
        camera.position.z - player.modelGroup.position.z
      );

      player.setInput(direction, cameraYaw, keys.space);

      // 让引擎自行计算本帧所有的位移、物理、转身、动作过渡
      player.update(delta);

      // 视角跟随
      controls.target.copy(player.modelGroup.position);
      controls.target.y += 1;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  // 开关调试网格和骨架
  useEffect(() => {
    if (skeletonHelperRef.current) skeletonHelperRef.current.visible = showSkeleton;
    if (modelRef.current) {
      modelRef.current.traverse((child: any) => {
        if (child.isMesh) child.visible = showMesh;
      });
    }
  }, [showSkeleton, showMesh]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 20, left: 20, 
        background: 'rgba(15, 23, 42, 0.9)', color: '#f8fafc',
        padding: '15px 25px', borderRadius: '8px', 
        fontFamily: 'sans-serif'
      }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#37f4d3' }}>🎮 PlayerEntity 引擎测试台</h3>
        <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
          <b>W A S D</b> : 移动 <br/>
          <b>Space</b> : 跳跃 <br/>
          <b>鼠标左键</b> : 旋转视角
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', borderTop: '1px solid #334155', paddingTop: '15px', marginTop: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showSkeleton} onChange={e => setShowSkeleton(e.target.checked)} style={{ marginRight: '10px' }}/>
            显示骨骼连线 (Skeleton)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMesh} onChange={e => setShowMesh(e.target.checked)} style={{ marginRight: '10px' }}/>
            显示模型网格 (Mesh)
          </label>
        </div>

        <p style={{ marginTop: '15px', fontSize: '12px', color: '#94a3b8' }}>
          状态: {status}
        </p>
      </div>
    </div>
  );
}
