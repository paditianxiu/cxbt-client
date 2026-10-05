import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { LobbyAssets } from '../lobby/assets';
import { lobbyUrl } from '../lobby/assets';
import './CreateRoomDialog.css';

type CreateRoomDialogProps = {
  assets: LobbyAssets;
  onClose: () => void;
  onCreate: (room: RoomConfig) => void;
  initialRoom?: RoomConfig;
};

export type RoomConfig = {
  name: string;
  password: string;
  maxPlayers: number;
  balanceTeams: boolean;
  modeId: string;
  modeName: string;
  mapId: string;
  mapName: string;
};

type Mode = {
  id: string;
  label: string;
  icon: string;
};

type MapChoice = {
  id: string;
  mapId: string;
  name: string;
  cover: string | null;
  coverCard: boolean;
  mode: Mode;
};

const VISIBLE_MODES: Mode[] = [
  { id: 'team', label: '团队', icon: 'practiceModeTeam' },
  { id: 'occupy', label: '占点', icon: 'practiceModeOccupy' },
  { id: 'flag', label: '夺旗', icon: 'practiceModeFlag' },
  { id: 'treasure', label: '夺宝', icon: 'practiceModeTreasure' },
  { id: 'kill', label: '歼灭', icon: 'practiceModeKill' },
  { id: 'blast', label: '爆破', icon: 'practiceModeBlast' },
];

const ALL_MODES: Mode[] = [
  { id: 'all', label: '全部', icon: 'practiceModeAll' },
  ...VISIBLE_MODES,
  { id: 'survival', label: '生存', icon: 'practiceModeSurvival' },
];

const MAP_PAGE_SIZE = 6;

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

function buildMaps(mode: Mode, assets: LobbyAssets): MapChoice[] {
  return assets.maps.map((map) => ({
    id: `${mode.id}-${map.id}`,
    mapId: map.id,
    name: map.name,
    cover: map.cover,
    coverCard: Boolean(map.coverCard),
    mode,
  }));
}

export default function CreateRoomDialog({ assets, onClose, onCreate, initialRoom }: CreateRoomDialogProps) {
  const [roomName, setRoomName] = useState(initialRoom?.name ?? '我的房间');
  const [password, setPassword] = useState(initialRoom?.password ?? '');
  const [maxPlayers, setMaxPlayers] = useState(String(initialRoom?.maxPlayers ?? 16));
  const [balanceTeams, setBalanceTeams] = useState(initialRoom?.balanceTeams ?? true);
  const [modeId, setModeId] = useState(initialRoom?.modeId ?? 'team');
  const [mapPage, setMapPage] = useState(Math.max(0, Math.floor(assets.maps.findIndex((map) => map.id === initialRoom?.mapId) / MAP_PAGE_SIZE)));
  const [selectedMap, setSelectedMap] = useState(`${initialRoom?.modeId ?? 'team'}-${initialRoom?.mapId ?? 'random'}`);

  const mode = ALL_MODES.find((entry) => entry.id === modeId) ?? VISIBLE_MODES[0];
  const maps = useMemo(() => buildMaps(mode, assets), [mode, assets]);
  const pageCount = Math.max(1, Math.ceil(maps.length / MAP_PAGE_SIZE));
  const pageMaps = maps.slice(mapPage * MAP_PAGE_SIZE, (mapPage + 1) * MAP_PAGE_SIZE);

  useEffect(() => {
    const previous = document.activeElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    addEventListener('keydown', keydown);
    const first = document.querySelector<HTMLElement>('[data-create-room-dialog] input');
    first?.focus();
    return () => {
      removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);

  const chooseMode = (next: Mode) => {
    setModeId(next.id);
    setMapPage(0);
    setSelectedMap(`${next.id}-${assets.maps[0]?.id ?? 'random'}`);
  };

  const confirm = () => {
    const selected = maps.find((entry) => entry.id === selectedMap) ?? maps[0];
    onCreate({ name: roomName.trim() || '我的房间', password, maxPlayers: Number(maxPlayers), balanceTeams,
      modeId: mode.id, modeName: mode.label, mapId: selected.mapId, mapName: selected.name });
  };

  return <div className="create-room-shade" data-create-room-dialog>
    <section className="create-room-dialog" style={art(assets, 'createRoom')} role="dialog" aria-modal="true"
      aria-labelledby="create-room-title" data-create-room-ready="true">
      <h2 id="create-room-title">{initialRoom ? '房间设置' : '创建房间'}</h2>

      <div className="create-room-row create-room-name-row">
        <label htmlFor="create-room-name">房间名称</label>
        <input id="create-room-name" style={art(assets, 'createRoomInput')} value={roomName} maxLength={18} onChange={(event) => setRoomName(event.target.value)} />
        <label className="create-room-password-label" htmlFor="create-room-password">密码</label>
        <input id="create-room-password" style={art(assets, 'createRoomInput')} type="password" value={password} maxLength={6} onChange={(event) => setPassword(event.target.value)} />
      </div>

      <div className="create-room-row create-room-player-row">
        <label htmlFor="create-room-players">人数</label>
        <select id="create-room-players" value={maxPlayers} onChange={(event) => setMaxPlayers(event.target.value)}
          style={art(assets, 'createRoomComboBg')} disabled={Boolean(initialRoom)}>
          {['4', '6', '8', '10', '12', '16'].map((count) => <option key={count} value={count}>{count} 人</option>)}
        </select>
        <label className="create-room-balance"><input type="checkbox" checked={balanceTeams} onChange={(event) => setBalanceTeams(event.target.checked)} />人数平衡</label>
      </div>

      <div className="create-room-section create-room-mode-section">
        <h3>模式选择</h3>
        <label className="create-room-mode-select"><span className="sr-only">游戏模式分类</span>
          <select value={modeId} aria-label="游戏模式分类" onChange={(event) => chooseMode(ALL_MODES.find((entry) => entry.id === event.target.value) ?? VISIBLE_MODES[0])}>
            {ALL_MODES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <div className="create-room-mode-panel" style={art(assets, 'createRoomModePanel')}>
          {VISIBLE_MODES.map((entry) => <button key={entry.id} className={`create-room-mode${modeId === entry.id ? ' selected' : ''}`}
            style={art(assets, 'createRoomModeBlank')}
            aria-label={entry.label} aria-pressed={modeId === entry.id} onClick={() => chooseMode(entry)}>
            <img src={lobbyUrl(assets.ui[entry.icon])} alt="" /><span>{entry.label}</span>
          </button>)}
        </div>
      </div>

      <div className="create-room-section create-room-map-section">
        <h3>地图选择</h3>
        <div className="create-room-map-panel" style={art(assets, 'createRoomMapPanel')}>
          <div className="create-room-map-grid">
            {pageMaps.map((mapChoice) => <button key={mapChoice.id} className={`create-room-map${selectedMap === mapChoice.id ? ' selected' : ''}`}
              style={art(assets, selectedMap === mapChoice.id ? 'createRoomMapHighlight' : 'createRoomMapFrame')}
              data-map-id={mapChoice.mapId} aria-label={mapChoice.name} aria-pressed={selectedMap === mapChoice.id} onClick={() => setSelectedMap(mapChoice.id)}>
              <span className={`create-room-map-image${mapChoice.cover ? '' : ' missing'}`}
                style={mapChoice.cover ? { backgroundImage: `url("${lobbyUrl(mapChoice.cover)}")` } : undefined}>
                {mapChoice.cover ? null : '暂无地图图像'}
              </span>
              {(!mapChoice.cover || !mapChoice.coverCard) && <span className="create-room-map-mode"><img src={lobbyUrl(assets.ui[mapChoice.mode.icon])} alt="" /><b>{mapChoice.mode.label}</b></span>}
              {(!mapChoice.cover || !mapChoice.coverCard) && <span className="create-room-map-name">{mapChoice.name}{mapChoice.name === '随机地图' && <small> RANDOM</small>}</span>}
            </button>)}
          </div>
          <div className="create-room-pages" aria-label="地图分页">
            <button style={art(assets, 'createRoomPageLeft')} aria-label="地图上一页" disabled={mapPage === 0} onClick={() => setMapPage((page) => Math.max(0, page - 1))} />
            <span>{mapPage + 1} / {pageCount}</span>
            <button style={art(assets, 'createRoomPageRight')} aria-label="地图下一页" disabled={mapPage + 1 >= pageCount} onClick={() => setMapPage((page) => Math.min(pageCount - 1, page + 1))} />
          </div>
        </div>
      </div>

      <div className="create-room-dialog-actions">
        <button className="create-room-button lobby-art-button" style={buttonArt(assets, 'practiceButton')} onClick={confirm}>确定</button>
        <button className="create-room-button lobby-art-button" style={buttonArt(assets, 'practiceButton')} onClick={onClose}>取消</button>
      </div>
    </section>
  </div>;
}
