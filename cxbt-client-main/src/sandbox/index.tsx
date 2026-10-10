import { useState } from 'react';
import ModelViewer from './modes/ModelViewer';
import CharacterController from './modes/CharacterController';

export default function SandboxApp() {
  const [activeMode, setActiveMode] = useState<'viewer' | 'controller'>('controller');

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a' }}>
      {/* 顶部导航栏 */}
      <div style={{ 
        height: '60px', 
        backgroundColor: '#1e293b', 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0 20px',
        borderBottom: '1px solid #334155',
        gap: '15px'
      }}>
        <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '18px', marginRight: '20px' }}>
          🧩 开发者沙盒
        </div>
        
        <button 
          onClick={() => setActiveMode('viewer')}
          style={{
            padding: '8px 16px',
            backgroundColor: activeMode === 'viewer' ? '#37f4d3' : 'transparent',
            color: activeMode === 'viewer' ? '#0f172a' : '#94a3b8',
            border: activeMode === 'viewer' ? 'none' : '1px solid #475569',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: activeMode === 'viewer' ? 'bold' : 'normal',
            transition: 'all 0.2s'
          }}>
          🛠️ 模型与动作查看器
        </button>

        <button 
          onClick={() => setActiveMode('controller')}
          style={{
            padding: '8px 16px',
            backgroundColor: activeMode === 'controller' ? '#37f4d3' : 'transparent',
            color: activeMode === 'controller' ? '#0f172a' : '#94a3b8',
            border: activeMode === 'controller' ? 'none' : '1px solid #475569',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: activeMode === 'controller' ? 'bold' : 'normal',
            transition: 'all 0.2s'
          }}>
          🎮 跑跳行为控制器
        </button>
      </div>

      {/* 模式渲染区 */}
      <div style={{ flex: 1, position: 'relative' }}>
        {activeMode === 'viewer' && <ModelViewer />}
        {activeMode === 'controller' && <CharacterController />}
      </div>
    </div>
  );
}
