import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODELS = [
  { name: '男突击兵', path: '/assets/creation/models/malecommandos.glb' },
  { name: '男护卫兵', path: '/assets/creation/models/guardman.glb' },
  { name: '男重装兵', path: '/assets/creation/models/heavyman.glb' },
  { name: '男生化专家', path: '/assets/creation/models/shenghuanan00.glb' }
];

const ANIMATIONS = [
  { name: '待机呼吸', path: '/assets/creation/idle.json' },
  { name: '静止 (T-Pose)', path: null }
];

export default function ModelViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  
  // 调试状态控制
  const [activeModel, setActiveModel] = useState(MODELS[0].path);
  const [activeAnim, setActiveAnim] = useState<string | null>(ANIMATIONS[0].path);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [status, setStatus] = useState('就绪');

  // Three.js 核心引用
  const sceneRef = useRef<any | null>(null);
  const modelGroupRef = useRef<any | null>(null);
  const skeletonHelperRef = useRef<any | null>(null);
  const axesHelperRef = useRef<any | null>(null);
  const gridHelperRef = useRef<any | null>(null);
  const mixerRef = useRef<any | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1e293b');
    sceneRef.current = scene;

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);

    const grid = new THREE.GridHelper(10, 10, 0x555555, 0x222222);
    scene.add(grid);
    gridHelperRef.current = grid;

    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }
      
      if ((window as any).__SANDBOX_AUTO_ROTATE && modelGroupRef.current) {
        modelGroupRef.current.rotation.y += 1.0 * delta;
      }

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
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    setStatus('加载模型中...');
    const loader = new GLTFLoader();

    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      modelGroupRef.current = null;
    }
    if (skeletonHelperRef.current) {
      scene.remove(skeletonHelperRef.current);
      skeletonHelperRef.current = null;
    }

    loader.load(activeModel, (gltf) => {
      const model = gltf.scene;
      
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const axes = new THREE.AxesHelper(2);
      axesHelperRef.current = axes;
      model.add(axes);
      axes.visible = showAxes;

      const skeleton = new THREE.SkeletonHelper(model);
      skeletonHelperRef.current = skeleton;
      scene.add(skeleton);
      skeleton.visible = showSkeleton;

      scene.add(model);
      modelGroupRef.current = model;

      if (activeAnim) {
        setStatus('加载动画中...');
        const mixer = new THREE.AnimationMixer(model);
        mixerRef.current = mixer;

        fetch(activeAnim)
          .then(res => res.json())
          .then(data => {
            const clip = new THREE.AnimationClip('anim', data.duration ?? -1, data.tracks.flatMap((track: any) => {
              const positionTimes = track.positions.map((_: any, index: number) => index / data.fps);
              const rotationTimes = track.rotations.map((_: any, index: number) => index / data.fps);
              return [
                new THREE.VectorKeyframeTrack(`${track.name}.position`, positionTimes, track.positions.flat()),
                new THREE.QuaternionKeyframeTrack(`${track.name}.quaternion`, rotationTimes, track.rotations.flat())
              ];
            }));
            const action = mixer.clipAction(clip);
            action.play();
            setStatus('加载完成 (含动画)');
          })
          .catch(err => setStatus(`动画加载失败: ${err}`));
      } else {
        mixerRef.current = null;
        setStatus('加载完成 (无动作)');
      }

    }, undefined, (err) => {
      setStatus(`模型加载失败: ${err}`);
    });

  }, [activeModel, activeAnim]);

  useEffect(() => {
    if (skeletonHelperRef.current) skeletonHelperRef.current.visible = showSkeleton;
    if (axesHelperRef.current) axesHelperRef.current.visible = showAxes;
    if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
  }, [showSkeleton, showAxes, showGrid]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      <div style={{
        position: 'absolute', top: 20, right: 20, 
        background: 'rgba(15, 23, 42, 0.9)', color: '#f8fafc',
        padding: '20px', borderRadius: '12px', 
        fontFamily: 'sans-serif', width: '300px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2)'
      }}>
        <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
          🛠️ 模型开发调试器
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>选择职业模型：</label>
          <select 
            style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            value={activeModel} 
            onChange={e => setActiveModel(e.target.value)}>
            {MODELS.map(m => <option key={m.path} value={m.path}>{m.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', marginBottom: '5px' }}>选择当前动作：</label>
          <select 
            style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            value={activeAnim ?? ''} 
            onChange={e => setActiveAnim(e.target.value || null)}>
            {ANIMATIONS.map(a => <option key={a.name} value={a.path || ''}>{a.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', borderTop: '1px solid #334155', paddingTop: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showSkeleton} onChange={e => setShowSkeleton(e.target.checked)} style={{ marginRight: '10px' }}/>
            显示骨骼线框 (Skeleton)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAxes} onChange={e => setShowAxes(e.target.checked)} style={{ marginRight: '10px' }}/>
            显示中心坐标轴 (Axes)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} style={{ marginRight: '10px' }}/>
            显示地面网格 (Grid)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#37f4d3' }}>
            <input type="checkbox" checked={autoRotate} onChange={e => {
              setAutoRotate(e.target.checked);
              (window as any).__SANDBOX_AUTO_ROTATE = e.target.checked;
            }} style={{ marginRight: '10px' }}/>
            开启模型自转
          </label>
        </div>

        <div style={{ marginTop: '20px', fontSize: '12px', color: '#94a3b8', background: '#0f172a', padding: '10px', borderRadius: '6px' }}>
          <strong>状态日志：</strong> <br/>
          {status}
        </div>
      </div>
    </div>
  );
}
