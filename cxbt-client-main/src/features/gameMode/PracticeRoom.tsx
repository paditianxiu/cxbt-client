import { useState, type CSSProperties } from 'react';
import type { LobbyAssets } from '../lobby/assets';
import { lobbyUrl } from '../lobby/assets';
import CreateRoomDialog, { type RoomConfig } from './CreateRoomDialog';
import RoomSettings from './RoomSettings';
import './PracticeRoom.css';
import { apiFetch } from '../../api';
import { useEffect, useCallback } from 'react';

type PracticeRoomProps = {
  assets: LobbyAssets;
  hostName: string;
  hostIcon: string;
  weaponIds: string[];
  onBack: () => void;
  onStart: (room: RoomConfig) => void;
  onStatus: (message: string) => void;
};

type Room = {
  id: number;
  name: string;
  host: string;
  map: string;
  mode: string;
  players: string;
  state: string;
};

const COLUMNS = [
  ['ID', '65px'], ['状态', '61px'], ['房间名称', '185px'], ['房主', '164px'],
  ['地图', '142px'], ['Watch', '70px'], ['模式', '60px'], ['人数', '66px'],
] as const;
const EMPTY_ROWS = Array.from({ length: 8 }, (_, index) => index);

type ApiRoom = {
  id: string;
  name: string;
  hostId: number;
  mapName: string;
  modeName: string;
  players: any;
  maxPlayers: number;
  state: string;
};
const MODES = [
  { id: 'all', label: '全部', icon: 'practiceModeAll' },
  { id: 'team', label: '团队', icon: 'practiceModeTeam' },
  { id: 'occupy', label: '占点', icon: 'practiceModeOccupy' },
  { id: 'flag', label: '夺旗', icon: 'practiceModeFlag' },
  { id: 'treasure', label: '夺宝', icon: 'practiceModeTreasure' },
  { id: 'kill', label: '歼灭', icon: 'practiceModeKill' },
  { id: 'blast', label: '爆破', icon: 'practiceModeBlast' },
  { id: 'survival', label: '生存', icon: 'practiceModeSurvival' },
] as const;

function art(assets: LobbyAssets, key: string): CSSProperties {
  return { backgroundImage: `url("${lobbyUrl(assets.ui[key])}")` };
}

function buttonArt(assets: LobbyAssets, key: string): CSSProperties {
  return {
    '--art': `url("${lobbyUrl(assets.ui[`${key}_normal`])}")`,
    '--hover-art': `url("${lobbyUrl(assets.ui[`${key}_hover`])}")`,
    '--down-art': `url("${lobbyUrl(assets.ui[`${key}_down`])}")`,
  } as CSSProperties;
}

function ActionButton({ assets, icon, label, className, onClick, 'aria-label': ariaLabel }: {
  assets: LobbyAssets;
  icon: string;
  label: string;
  className?: string;
  'aria-label'?: string;
  onClick: () => void;
}) {
  return <button className={`practice-action ${className ?? ''}`} aria-label={ariaLabel ?? label} style={buttonArt(assets, 'practiceButton')} onClick={onClick}>
    <img src={lobbyUrl(assets.ui[icon])} alt="" />
    <span>{label}</span>
  </button>;
}

function EmptyRow({ index }: { index: number }) {
  return <div className="practice-room-row" role="row" aria-label={`空房间 ${index + 1}`}>
    {COLUMNS.map(([label]) => <span key={label} role="cell">-</span>)}
  </div>;
}

export default function PracticeRoom({ assets, hostName, hostIcon, weaponIds, onBack, onStart, onStatus }: PracticeRoomProps) {
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('all');
  const [selectedRoom, setSelectedRoom] = useState<any>();
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<any>();
  const [roomList, setRoomList] = useState<any[]>([]);
  const [searchRoomId, setSearchRoomId] = useState('');

  const fetchRooms = useCallback(async () => {
    try {
      const data = await apiFetch('/rooms');
      setRoomList(data || []);
      setCreatedRoom((prev: any) => {
        if (!prev) return prev;
        const updated = (data || []).find((r: any) => r.id === prev.id);
        return updated || prev;
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const timer = setInterval(fetchRooms, 3000);
    return () => clearInterval(timer);
  }, [fetchRooms]);

  const chooseMode = (nextMode: (typeof MODES)[number]['id']) => {
    setMode(nextMode);
    setSelectedRoom(undefined);
    onStatus(`${MODES.find((entry) => entry.id === nextMode)?.label ?? '全部'}房间`);
  };

  return <section className="practice-room-layer" aria-label="练习赛房间列表" data-practice-room-ready="true">
    {createdRoom ? <RoomSettings assets={assets} room={createdRoom} hostName={hostName} hostIcon={hostIcon}
      onLeave={() => { setCreatedRoom(undefined); onStatus(''); }} onSettings={() => setCreateRoomOpen(true)} onStart={(r) => onStart(r || createdRoom)} onStatus={onStatus} /> :
    <div className="practice-room-root">
      <div className="practice-room-content" style={art(assets, 'content')}>
        <div className="practice-room-topbar" style={art(assets, 'practiceInternalTop')} />

        <aside className="practice-advance" style={art(assets, 'practiceAdvance')}>
          <p>在练习赛中可以自定义队友和对手，自由设置游戏房间。</p>
        </aside>

        <section className="practice-mode-panel" style={art(assets, 'practiceModePanel')} aria-label="模式选择">
          <h2>模式选择</h2>
          <div className="practice-mode-frame" style={art(assets, 'practiceListFrame')}>
            {MODES.map((entry) => <button key={entry.id} className={`practice-mode-button${mode === entry.id ? ' selected' : ''}`}
              aria-label={entry.label} aria-pressed={mode === entry.id} onClick={() => chooseMode(entry.id)}>
              <span className="practice-mode-mark"><img src={lobbyUrl(assets.ui[entry.icon])} alt="" /></span>
              <span className="practice-mode-label">{entry.label}</span>
            </button>)}
          </div>
        </section>

        <section className="practice-list-panel" style={art(assets, 'practiceRoomPanel')} aria-label="房间列表">
          <div className="practice-list-frame" style={art(assets, 'practiceListFrame')}>
            <div className="practice-room-table" role="table" aria-label="练习赛房间">
              <div className="practice-room-header" role="row" style={{ gridTemplateColumns: COLUMNS.map(([, width]) => width).join(' ') }}>
                {COLUMNS.map(([label]) => <span key={label} role="columnheader">{label}</span>)}
              </div>
              {roomList.length === 0 ? EMPTY_ROWS.map((index) => <EmptyRow key={index} index={index} />) : 
                roomList.map((room, i) => (
                  <div key={room.id} className={`practice-room-row ${selectedRoom?.id === room.id ? 'selected' : ''}`} onClick={() => setSelectedRoom(room)} role="row" style={{ gridTemplateColumns: COLUMNS.map(([, width]) => width).join(' '), cursor: 'pointer' }}>
                    <span role="cell" style={{ fontSize: '12px' }}>{room.id.replace('room-', '')}</span>
                    <span role="cell">{room.state === 'Playing' ? '游戏中' : '等待中'}</span>
                    <span role="cell">{room.name}</span>
                    <span role="cell">{"Host-" + room.hostId}</span>
                    <span role="cell">{room.mapName}</span>
                    <span role="cell">-</span>
                    <span role="cell">{room.modeName}</span>
                    <span role="cell">{Object.keys(room.players || {}).length}/{room.maxPlayers}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="practice-actions">
            <ActionButton assets={assets} icon="practiceIconBack" label="返回" aria-label="返回凌云要塞" onClick={onBack} />
            <ActionButton assets={assets} icon="practiceIconWatch" label="快速加入" onClick={async () => {
              onStatus('正在匹配中...');
              try {
                const res = await apiFetch('/rooms/quickmatch', { method: 'POST' });
                await apiFetch(`/rooms/${res.roomId}/join`, { method: 'POST', body: JSON.stringify({ password: '', weaponIds }) });
                const roomRes = await apiFetch('/rooms');
                const matched = roomRes.find((r: any) => r.id === res.roomId);
                if (matched) setCreatedRoom(matched);
              } catch (e: any) {
                onStatus(e.message || '没有匹配到房间');
              }
            }} />
            <ActionButton assets={assets} icon="practiceIconCreate" label="创建房间" onClick={() => setCreateRoomOpen(true)} />
            <button className="practice-action practice-enter" aria-label="进入房间" style={buttonArt(assets, 'practiceStart')} onClick={async () => {
              if (!selectedRoom) {
                onStatus('请选择一个房间后再进入');
                return;
              }
              try {
                await apiFetch(`/rooms/${selectedRoom.id}/join`, { method: 'POST', body: JSON.stringify({ password: '', weaponIds }) });
                setCreatedRoom(selectedRoom as any);
                onStatus(`已进入房间 · ${selectedRoom.name}`);
              } catch (e: any) {
                onStatus(e.message || '进入失败');
              }
            }}>
              <img src={lobbyUrl(assets.ui.practiceIconEnter)} alt="" /><span>进入房间</span>
            </button>
            <div style={{ position: 'absolute', left: '160px', top: '15px', display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.7)', padding: '4px', borderRadius: '4px', border: '1px solid #5a8a9e', zIndex: 10 }}>
              <input 
                type="text" 
                value={searchRoomId} 
                onChange={(e) => setSearchRoomId(e.target.value)}
                placeholder="输入房间ID..."
                style={{ background: 'transparent', border: 'none', color: 'white', width: '100px', outline: 'none', paddingLeft: '5px' }}
              />
              <button 
                onClick={async () => {
                  if (!searchRoomId) {
                    onStatus('请输入房间号');
                    return;
                  }
                  let targetId = searchRoomId.trim();
                  if (!targetId.startsWith('room-')) {
                    targetId = 'room-' + targetId;
                  }
                  try {
                    await apiFetch(`/rooms/${targetId}/join`, { method: 'POST', body: JSON.stringify({ password: '', weaponIds }) });
                    const roomRes = await apiFetch('/rooms');
                    const matched = roomRes.find((r: any) => r.id === targetId);
                    if (matched) {
                      setCreatedRoom(matched);
                      onStatus(`已进入房间 · ${matched.name}`);
                    }
                  } catch (e: any) {
                    onStatus(e.message || '加入失败，请检查房间号');
                  }
                }}
                style={{ background: 'linear-gradient(to bottom, #4f9ec4, #276380)', border: '1px solid #a3c2cf', color: 'white', cursor: 'pointer', borderRadius: '2px', padding: '2px 8px', marginLeft: '5px' }}
              >
                查找加入
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="practice-room-title-bar" style={art(assets, 'practiceTitleBar')}>
        <div className="practice-room-title-tab" style={art(assets, 'practiceTitleTab')}><h1 className="practice-room-title">练习赛</h1></div>
      </div>
    </div>}
    {createRoomOpen && <CreateRoomDialog assets={assets} initialRoom={createdRoom} onClose={() => setCreateRoomOpen(false)}
      onCreate={async (room) => {
        try {
          const newRoom = await apiFetch('/rooms', { method: 'POST', body: JSON.stringify({ ...room, weaponIds }) });
          setCreatedRoom(newRoom);
          setCreateRoomOpen(false);
          onStatus('');
        } catch (e: any) {
          onStatus('房间创建失败');
        }
      }} />}
  </section>;
}
