import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlayerEntity } from '../../features/gameplay/engine/PlayerEntity';

// 武器与动作预设配置
export interface WeaponActionSet {
  id: string;
  name: string;
  actions: {
    idle: string;
    run: string;
    jump: string;
    roll?: string;
    attack?: string;
  };
}

export const WEAPON_SUITES: WeaponActionSet[] = [
  {
    id: 'smg_01',
    name: '冲锋枪套件 (SMG)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/smg_01-run.json',
      jump: '/assets/gameplay/animations/smg_01-jump.json',
      roll: '/assets/gameplay/animations/smg_01-roll.json'
    }
  },
  {
    id: 'pistol_01',
    name: '手枪套件 (Pistol)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/pistol_01-run.json',
      jump: '/assets/gameplay/animations/pistol_01-jump.json',
      roll: '/assets/gameplay/animations/pistol_01-roll.json'
    }
  },
  {
    id: 'shotgun_01',
    name: '霰弹枪套件 (Shotgun)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/shotgun_01-run.json',
      jump: '/assets/gameplay/animations/shotgun_01-jump.json',
      roll: '/assets/gameplay/animations/shotgun_01-roll.json'
    }
  },
  {
    id: 'sniperrifle_01',
    name: '狙击步枪套件 (Sniper)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/sniperrifle_01-run.json',
      jump: '/assets/gameplay/animations/sniperrifle_01-jump.json',
      roll: '/assets/gameplay/animations/sniperrifle_01-roll.json'
    }
  },
  {
    id: 'machinegun_01',
    name: '重机枪套件 (Machinegun)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/machinegun_01-run.json',
      jump: '/assets/gameplay/animations/machinegun_01-jump.json',
      roll: '/assets/gameplay/animations/machinegun_01-roll.json'
    }
  },
  {
    id: 'knives_01',
    name: '近战军刀套件 (Knives - 含攻击)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/knives_01-run.json',
      jump: '/assets/gameplay/animations/knives_01-jump.json',
      roll: '/assets/gameplay/animations/knives_01-roll.json',
      attack: '/assets/gameplay/animations/knives_01-attack.json'
    }
  },
  {
    id: 'shield_01',
    name: '战术盾牌套件 (Shield - 含攻击)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/shield_01-run.json',
      jump: '/assets/gameplay/animations/shield_01-jump.json',
      roll: '/assets/gameplay/animations/shield_01-roll.json',
      attack: '/assets/gameplay/animations/shield_01-attack.json'
    }
  },
  {
    id: 'bow_01',
    name: '复合弓套件 (Bow)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/bow_01-run.json',
      jump: '/assets/gameplay/animations/bow_01-jump.json',
      roll: '/assets/gameplay/animations/bow_01-roll.json'
    }
  },
  {
    id: 'rpg_01',
    name: '火箭筒套件 (RPG)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/rpg_01-run.json',
      jump: '/assets/gameplay/animations/rpg_01-jump.json',
      roll: '/assets/gameplay/animations/rpg_01-roll.json'
    }
  },
  {
    id: 'grenade_01',
    name: '战术手雷套件 (Grenade)',
    actions: {
      idle: '/assets/creation/idle.json',
      run: '/assets/gameplay/animations/grenade_01-run.json',
      jump: '/assets/gameplay/animations/grenade_01-jump.json',
      roll: '/assets/gameplay/animations/grenade_01-roll.json'
    }
  }
];

const ACTION_LABELS: Record<string, string> = {
  idle: '待机 (Idle)',
  run: '奔跑 (Run)',
  jump: '跳跃 (Jump)',
  roll: '战术翻滚 (Roll)',
  attack: '近战攻击 (Attack)'
};

export default function CharacterController() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在加载引擎类...');
  
  // 动作套件与动作选项状态
  const [activeSuiteId, setActiveSuiteId] = useState<string>(WEAPON_SUITES[0].id);
  const [actionOption, setActionOption] = useState<string>('auto'); // 'auto' | action name
  const [availableActions, setAvailableActions] = useState<string[]>(Object.keys(WEAPON_SUITES[0].actions));

  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showMesh, setShowMesh] = useState(true);

  const skeletonHelperRef = useRef<any | null>(null);
  const modelRef = useRef<any | null>(null);
  const playerRef = useRef<PlayerEntity | null>(null);
  const actionBadgeRef = useRef<HTMLSpanElement | null>(null);

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

    // 2. 引入游戏底层引擎类
    const player = new PlayerEntity(scene);
    playerRef.current = player;

    player.loadAvatar('/assets/creation/models/malecommandos.glb', '/assets/creation/models/body01.glb')
      .then(async (headScene) => {
        // 沙盒专属特权：获取到底层组装好的头节点，用来挂载调试骨架线
        const skeleton = new THREE.SkeletonHelper(headScene);
        skeletonHelperRef.current = skeleton;
        scene.add(skeleton);
        modelRef.current = headScene;

        const initialSuite = WEAPON_SUITES[0];
        await player.loadAnimations(initialSuite.actions);
        setAvailableActions(Object.keys(initialSuite.actions));
        setStatus('PlayerEntity 引擎加载完毕！动作系统就绪');
      })
      .catch(err => setStatus(`引擎加载失败: ${err}`));

    // 3. 将本地沙盒的键盘事件喂给 PlayerEntity
    const keys = { w: false, a: false, s: false, d: false, space: false };
    const direction = new THREE.Vector3();

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;

      if (e.code === 'KeyW') keys.w = true;
      if (e.code === 'KeyA') keys.a = true;
      if (e.code === 'KeyS') keys.s = true;
      if (e.code === 'KeyD') keys.d = true;
      if (e.code === 'Space') {
        e.preventDefault();
        keys.space = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        player.roll();
      }
      if (e.code === 'KeyJ') {
        player.attack();
      }
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

    // 4. 帧循环
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

      // 实时更新当前动作状态徽标 (避免 React state 频繁重渲染造成掉帧)
      if (actionBadgeRef.current) {
        const cur = player.getCurrentAction();
        actionBadgeRef.current.textContent = cur ? (ACTION_LABELS[cur] || cur) : 'idle';
      }

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

  // 切换武器动作套件
  const handleSuiteChange = async (suiteId: string) => {
    setActiveSuiteId(suiteId);
    const suite = WEAPON_SUITES.find(s => s.id === suiteId);
    if (!suite || !playerRef.current) return;

    setStatus(`正在加载 [${suite.name}] 动作资源...`);
    await playerRef.current.loadAnimations(suite.actions);
    const actions = Object.keys(suite.actions);
    setAvailableActions(actions);

    // 如果当前选中的强制动作在新的套件中不存在，重置为自动模式
    if (actionOption !== 'auto' && !actions.includes(actionOption)) {
      setActionOption('auto');
      playerRef.current.setForcedAction(null);
    }
    setStatus(`[${suite.name}] 动作套件加载成功！`);
  };

  // 切换动作选项模式 (自动模式 / 强制循环播放指定动作)
  const handleActionOptionChange = (option: string) => {
    setActionOption(option);
    if (playerRef.current) {
      playerRef.current.setForcedAction(option === 'auto' ? null : option);
    }
  };

  // 快捷手动触发动作
  const triggerRoll = () => {
    if (playerRef.current) playerRef.current.roll();
  };

  const triggerAttack = () => {
    if (playerRef.current) {
      const ok = playerRef.current.attack();
      if (!ok && !availableActions.includes('attack')) {
        setStatus('当前武器套件不包含 attack 动画，可切换近战军刀/战术盾牌测试');
      }
    }
  };

  const triggerJump = () => {
    if (playerRef.current) playerRef.current.jump();
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* 控制器与动作选项面板 */}
      <div style={{
        position: 'absolute', top: 20, left: 20, 
        background: 'rgba(15, 23, 42, 0.92)', color: '#f8fafc',
        padding: '18px 22px', borderRadius: '12px', 
        fontFamily: 'sans-serif', width: '320px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
        border: '1px solid #334155',
        backdropFilter: 'blur(8px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '10px', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, color: '#37f4d3', fontSize: '16px' }}>🎮 跑跳行为控制器</h3>
          <span style={{ fontSize: '11px', background: '#1e293b', border: '1px solid #475569', padding: '2px 8px', borderRadius: '12px', color: '#94a3b8' }}>
            沙盒调试
          </span>
        </div>

        {/* 1. 动作套件 (武器风格) 选择 */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#cbd5e1' }}>
            🔫 动作套件 (武器风格)：
          </label>
          <select 
            style={{ width: '100%', padding: '8px 10px', background: '#0f172a', color: 'white', border: '1px solid #475569', borderRadius: '6px', fontSize: '13px' }}
            value={activeSuiteId} 
            onChange={e => handleSuiteChange(e.target.value)}>
            {WEAPON_SUITES.map(suite => (
              <option key={suite.id} value={suite.id}>{suite.name}</option>
            ))}
          </select>
        </div>

        {/* 2. 动作选项模式 (自动 / 强制循环) */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#cbd5e1' }}>
            🎬 动作选项 / 运行模式：
          </label>
          <select 
            style={{ width: '100%', padding: '8px 10px', background: '#0f172a', color: 'white', border: '1px solid #475569', borderRadius: '6px', fontSize: '13px' }}
            value={actionOption} 
            onChange={e => handleActionOptionChange(e.target.value)}>
            <option value="auto">🎮 自由移动模式 (根据按键状态机过渡)</option>
            <optgroup label="── 强制循环指定动作 ──">
              {availableActions.map(act => (
                <option key={act} value={act}>🔄 循环播放: {ACTION_LABELS[act] || act}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* 3. 动作快捷触发按钮组 */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>⚡ 动作快捷触发测试：</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            <button 
              onClick={triggerJump}
              style={{
                padding: '6px 4px', background: '#1e293b', border: '1px solid #475569',
                borderRadius: '6px', color: '#f8fafc', fontSize: '12px', cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              title="按空格键 Space 亦可触发">
              🦘 跳跃
            </button>
            <button 
              onClick={triggerRoll}
              style={{
                padding: '6px 4px', background: '#1e293b', border: '1px solid #475569',
                borderRadius: '6px', color: '#f8fafc', fontSize: '12px', cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              title="按 Shift 键亦可触发">
              ⚡ 翻滚
            </button>
            <button 
              onClick={triggerAttack}
              disabled={!availableActions.includes('attack')}
              style={{
                padding: '6px 4px', 
                background: availableActions.includes('attack') ? '#1e293b' : '#0f172a', 
                border: `1px solid ${availableActions.includes('attack') ? '#475569' : '#334155'}`,
                borderRadius: '6px', 
                color: availableActions.includes('attack') ? '#f8fafc' : '#64748b', 
                fontSize: '12px', 
                cursor: availableActions.includes('attack') ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s'
              }}
              title="按 J 键亦可触发 (需近战/盾牌套件)">
              ⚔️ 攻击
            </button>
          </div>
        </div>

        {/* 4. 实时动作与按键指引 */}
        <div style={{ 
          background: '#0f172a', padding: '10px', borderRadius: '8px', 
          border: '1px solid #334155', marginBottom: '12px' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '13px' }}>
            <span style={{ color: '#94a3b8' }}>当前动作：</span>
            <span 
              ref={actionBadgeRef} 
              style={{ 
                color: '#37f4d3', fontWeight: 'bold', background: 'rgba(55, 244, 211, 0.1)',
                padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(55, 244, 211, 0.3)'
              }}>
              idle
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.6' }}>
            <b>W A S D</b> : 移动 &nbsp;|&nbsp; <b>Space</b> : 跳跃<br/>
            <b>Shift</b> : 战术翻滚 &nbsp;|&nbsp; <b>J</b> : 普攻/挥砍<br/>
            <b>鼠标左键</b> : 旋转视角
          </div>
        </div>
        
        {/* 5. 视图辅助选项 */}
        <div style={{ display: 'flex', gap: '15px', fontSize: '13px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showSkeleton} onChange={e => setShowSkeleton(e.target.checked)} style={{ marginRight: '6px' }}/>
            骨骼连线
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMesh} onChange={e => setShowMesh(e.target.checked)} style={{ marginRight: '6px' }}/>
            模型网格
          </label>
        </div>

        {/* 6. 状态提示 */}
        <p style={{ margin: '10px 0 0 0', fontSize: '11px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ℹ️ {status}
        </p>
      </div>
    </div>
  );
}
