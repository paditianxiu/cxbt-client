import { useState, type CSSProperties, type FormEvent } from 'react';
import type { LobbyAssets } from '../lobby/assets';
import { lobbyUrl } from '../lobby/assets';
import type { RoomConfig } from './CreateRoomDialog';
import './RoomSettings.css';
import { apiFetch, WS_BASE, getToken } from '../../api';
import { useEffect } from 'react';

type RoomSettingsProps = {
  assets: LobbyAssets;
  room: RoomConfig;
  hostName: string;
  hostIcon: string;
  onLeave: () => void;
  onSettings: () => void;
  onStart: (room?: any) => void;
  onStatus: (message: string) => void;
};

const TEAM_SLOTS = Array.from({ length: 8 }, (_, index) => index);

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

export default function RoomSettings({ assets, room, hostName, hostIcon, onLeave, onSettings, onStart, onStatus }: RoomSettingsProps) {
  const [team, setTeam] = useState<'red' | 'blue'>('red');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([`进入房间: ${room.name}`]);
  const map = assets.maps.find((entry) => entry.id === room.mapId);
  const mapImage = map?.roomImage ?? map?.cover ?? (room.mapId === 'random' ? 'ui/createRoomMapRandom.png' : null);
  const slotsPerTeam = Math.min(8, Math.ceil(room.maxPlayers / 2));
  const players = Object.values((room as any).players || {}) as any[];
  const redPlayers = players.filter(p => p.team === 'red');
  const bluePlayers = players.filter(p => p.team === 'blue');

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    // Send to WS instead of just local
    const ws = (window as any)._roomWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', message, userId: hostName }));
    }
    setDraft('');
  };

  useEffect(() => {
    if (!room.id) return;
    const ws = new WebSocket(`${WS_BASE}?roomId=${room.id}&playerId=${hostName}`);
    (window as any)._roomWs = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'start_game') {
        document.body.requestPointerLock();
        apiFetch('/rooms').then(rooms => {
          const latest = (rooms || []).find((r: any) => r.id === room.id);
          if (latest) onStart(latest);
          else onStart();
        }).catch(() => onStart());
      } else if (msg.type === 'join' || msg.type === 'leave') {
        setMessages((current) => [...current.slice(-47), `系统: 玩家 ${msg.userId} ${msg.type === 'join' ? '进入' : '离开'}了房间`]);
      } else if (msg.type === 'chat') {
        setMessages((current) => [...current.slice(-47), `${msg.userId}: ${msg.message}`]);
      }
    };
    return () => ws.close();
  }, [room.id, hostName]);

  return <div className="practice-room-root room-settings-root" data-room-settings-ready="true">
    <div className="practice-room-content" style={art(assets, 'content')}>
      <div className="practice-room-topbar" style={art(assets, 'practiceInternalTop')} />

      <aside className="room-info-panel" style={art(assets, 'roomInfoPanel')} aria-label="房间地图与聊天">
        <div className="room-map-panel" style={art(assets, 'roomSmallMapBg')}>
          <div className="room-map-image" style={mapImage ? { backgroundImage: `url("${lobbyUrl(mapImage)}")` } : undefined}>
            {mapImage ? null : room.mapName}
          </div>
          <dl className="room-map-details">
            <dt>房间名称</dt><dd>{room.name}</dd>
            <dt>房主</dt><dd>{hostName}</dd>
            <dt>游戏模式</dt><dd>{room.modeName}</dd>
            <dt>游戏人数</dt><dd>{room.maxPlayers}</dd>
          </dl>
        </div>
        <div className="room-chat-panel" style={art(assets, 'roomChatPanel')} aria-label="房间聊天记录">
          {messages.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
        </div>
        <form className="room-chat-input" style={art(assets, 'roomChatInput')} onSubmit={sendMessage}>
          <input aria-label="聊天消息" value={draft} maxLength={120} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit">发送</button>
        </form>
      </aside>

      <section className="room-team-panel" style={art(assets, 'roomTeamPanel')} aria-label="房间队伍">
        <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {room.name} 
          <span style={{ fontSize: '12px', color: '#f5e9c9', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #7e5634' }}>
            ID: {(room as any).id}
          </span>
        </h2>
        {room.password && <span className="room-password">房间密码: {room.password}</span>}
        <div className="room-score" style={art(assets, 'roomScore')} aria-label={`红队 ${redPlayers.length} 人，蓝队 ${bluePlayers.length} 人`}>
          <span className="room-score-red">{redPlayers.length}</span>
          <span className="room-score-blue">{bluePlayers.length}</span>
        </div>
        <div className="room-teams-frame" style={art(assets, 'roomTeamFrame')}>
          {(['red', 'blue'] as const).map((side) => {
            const teamPlayers = side === 'red' ? redPlayers : bluePlayers;
            return <div key={side} className={`room-team-list ${side}`} aria-label={side === 'red' ? '红队' : '蓝队'}>
              {TEAM_SLOTS.map((slot) => {
                const player = teamPlayers[slot];
                const occupied = !!player;
                const available = slot < slotsPerTeam;
                const isHost = player && player.userId === (room as any).hostId;
                
                return <button key={slot} className={`room-player-row${occupied ? ' occupied' : ''}`}
                  style={art(assets, side === 'red' ? 'roomRedRow' : 'roomBlueRow')}
                  aria-label={occupied ? `${player.username}，${isHost ? '房主' : '玩家'}，${side === 'red' ? '红队' : '蓝队'}` : `${side === 'red' ? '红队' : '蓝队'}空位 ${slot + 1}`}
                  disabled={!available || occupied} onClick={() => setTeam(side)}>
                  {occupied && <><img className="room-player-job" src={hostIcon} alt="" /><span className="room-player-name">LV 1 {player.username}</span>
                    {isHost && <img className="room-player-host" src={lobbyUrl(assets.ui.roomHost)} alt="房主" />}</>}
                </button>;
              })}
            </div>
          })}
        </div>
        <div className="room-actions">
          <button className="room-action lobby-art-button" style={buttonArt(assets, 'practiceButton')} onClick={async () => {
            try {
              if (room.id) await apiFetch(`/rooms/${room.id}/leave`, { method: 'POST' });
              onLeave();
            } catch (e) {
              onLeave();
            }
          }}>
            <img src={lobbyUrl(assets.ui.practiceIconBack)} alt="" />返回
          </button>
          <button className="room-action lobby-art-button" style={buttonArt(assets, 'practiceButton')}
            onClick={async () => {
              try {
                if (room.id) {
                  await apiFetch(`/rooms/${room.id}/invite`, { method: 'POST' });
                  onStatus('邀请已发送至全局频道');
                }
              } catch (e: any) {
                onStatus(e.message || '邀请失败');
              }
            }}>
            <img src={lobbyUrl(assets.ui.roomIconInvite)} alt="" />邀请
          </button>
          <button className="room-action lobby-art-button" style={buttonArt(assets, 'practiceButton')} onClick={onSettings}>
            <img src={lobbyUrl(assets.ui.roomIconSetup)} alt="" />房间设置
          </button>
          <button className="room-action room-start lobby-art-button" style={buttonArt(assets, 'practiceStart')}
            onClick={async () => {
              try {
                if (room.id) {
                  await apiFetch(`/rooms/${room.id}/start`, { method: 'POST' });
                  // onStart() will be handled by WS 'start_game' event
                } else {
                  void document.body.requestPointerLock();
                  onStart();
                }
              } catch (e: any) {
                onStatus(e.message || '无法开始游戏');
              }
            }}>
            <img src={lobbyUrl(assets.ui.roomIconStart)} alt="" />开始游戏
          </button>
        </div>
      </section>
    </div>
    <div className="practice-room-title-bar" style={art(assets, 'practiceTitleBar')}>
      <div className="practice-room-title-tab" style={art(assets, 'practiceTitleTab')}><h1 className="practice-room-title">练习赛</h1></div>
    </div>
  </div>;
}
