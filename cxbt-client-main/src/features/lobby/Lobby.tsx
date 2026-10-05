import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import CharacterPreview from '../characterCreation/CharacterPreview';
import { assetUrl, CREATION_JOBS, initialAppearance, loadCreationAssets, type Appearance, type CreationAssets, type CreationAttachment, type CreationJob, type CreationWeapon } from '../characterCreation/assets';
import type { SavedCharacter } from '../characterCreation/character';
import GameModeLobby from '../gameMode/GameModeLobby';
import PracticeRoom from '../gameMode/PracticeRoom';
import type { RoomConfig } from '../gameMode/CreateRoomDialog';
import Gameplay from '../gameplay/Gameplay';
import { loadLobbyAssets, lobbyUrl, type InventoryCategory, type InventoryItem, type LobbyAssets } from './assets';
import GlobalChat from './GlobalChat';
import './Lobby.css';

const PAGE_SIZE = 24;
const NO_WEAPONS: CreationWeapon[] = [];
const MUSIC_BASE = `${import.meta.env.BASE_URL}assets/lobby/`;
const TABS: { id: InventoryCategory; label: string; icon: string }[] = [
  { id: 'equipment', label: '装备', icon: 'tabEquipment' },
  { id: 'items', label: '道具', icon: 'tabItems' },
  { id: 'gestures', label: '表情', icon: 'tabGestures' },
  { id: 'avatars', label: '造型卡', icon: 'tabAvatars' },
];
const MENUS = [['info', '角色'], ['guild', '公会'], ['mission', '任务'], ['enhance', '强化'],
  ['shop', '商城'], ['avatar', '造型屋'], ['auction', '拍卖行'], ['rank', '排行榜']];
const FOOTER = [['message', '聊天'], ['huodong', '活动'], ['junxian', '军衔'], ['sign', '签到'],
  ['friend', '好友'], ['mail', '邮件'], ['setup', '设置']];
const QUICK_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

function validAppearance(assets: CreationAssets, character: SavedCharacter): Appearance {
  const gender = character.appearance.gender === 1 ? 1 : 0;
  const preset = assets.jobs[character.jobId].presets[gender];
  const fallback = initialAppearance(preset, gender);
  const saved = character.appearance;
  return { gender, hair: saved.hair < preset.hair.length ? saved.hair : fallback.hair,
    eyes: saved.eyes < preset.eyes.length ? saved.eyes : 0,
    mouth: saved.mouth < preset.mouths.length ? saved.mouth : 0,
    accessory: saved.accessory < preset.accessorySets.length ? saved.accessory : fallback.accessory };
}

export default function Lobby({ character, onExit }: { character: SavedCharacter; onExit: () => void }) {
  const [creation, setCreation] = useState<CreationAssets>();
  const [assets, setAssets] = useState<LobbyAssets>();
  const [error, setError] = useState('');
  const [category, setCategory] = useState<InventoryCategory>('equipment');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [sorted, setSorted] = useState(false);
  const [selected, setSelected] = useState<InventoryItem>();
  const [weaponId, setWeaponId] = useState<string>();
  const [attachment, setAttachment] = useState<CreationAttachment>();
  const [animation, setAnimation] = useState<string>();
  const [appearance, setAppearance] = useState(character.appearance);
  const [previewJob, setPreviewJob] = useState<CreationJob>(character.jobId);
  const [rotation, setRotation] = useState(0);
  const [revision, setRevision] = useState(0);
  const [motion, setMotion] = useState(true);
  const [volume, setVolume] = useState(0.38);
  const [scale, setScale] = useState(1);
  const [dialog, setDialog] = useState<{ title: string; message?: string }>();
  const [gameModeLobby, setGameModeLobby] = useState(false);
  const [practiceRoom, setPracticeRoom] = useState(false);
  const [battleRoom, setBattleRoom] = useState<RoomConfig>();
  const [globalChatOpen, setGlobalChatOpen] = useState(false);
  const [quickbar, setQuickbar] = useState<(string | null)[]>([]);
  const [status, setStatus] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const musicTrack = gameModeLobby || practiceRoom ? 'music-fortress' : 'music-lobby';

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([loadCreationAssets(controller.signal), loadLobbyAssets(controller.signal)]).then(([config, catalogue]) => {
      if (controller.signal.aborted) return;
      setCreation(config);
      setAssets(catalogue);
      setAppearance(validAppearance(config, character));
      const defaults = config.jobs[character.jobId].weapons.map((weapon) => weapon.id);
      setQuickbar(Array.from({ length: 12 }, (_, index) => defaults[index] ?? null));
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [character]);
  useEffect(() => {
    const resize = () => setScale(Math.min(innerWidth / 1440, innerHeight / 900));
    resize();
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, assets]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || battleRoom) return;
    audio.load();
    void audio.play().catch(() => undefined);
  }, [musicTrack, battleRoom, assets, creation]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDialog(undefined); }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, input');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener('keydown', keydown);
    return () => {
      removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [dialog]);

  const previewWeapons = useMemo(() => weaponId && assets?.weapons[weaponId] ? [assets.weapons[weaponId]] : NO_WEAPONS, [weaponId, assets]);
  const battleWeapons = useMemo(() => quickbar.filter((id): id is string => Boolean(id)), [quickbar]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const items = assets?.items.filter((item) => item.category === category && (!search || `${item.name} ${item.id}`.toLocaleLowerCase().includes(search))) ?? [];
    return sorted ? [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) : items;
  }, [assets, category, query, sorted]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const chooseItem = (item: InventoryItem) => {
    setSelected(item);
    setWeaponId(undefined);
    setAttachment(undefined);
    setAnimation(undefined);
    setMotion(true);
    if (item.weapon) {
      setWeaponId(item.weapon);
      setStatus(`${item.name} · 持握预览`);
    } else if (item.attachment) {
      setAttachment(item.attachment);
      setAnimation(item.attachment.characterAnimation ?? undefined);
      setStatus(`${item.name} · 翅膀预览`);
    } else if (item.animation) {
      setWeaponId(undefined);
      setAnimation(item.animation);
      setStatus(`${item.name} · 动作预览`);
    } else if (item.preset && creation) {
      const preset = creation.jobs[item.preset.jobId].presets[item.preset.gender];
      setPreviewJob(item.preset.jobId);
      setAppearance(initialAppearance(preset, item.preset.gender));
      setStatus(`${item.name} · 造型预览`);
    } else {
      setStatus(`${item.name}${item.category === 'equipment' ? ' · 暂无对应的角色预览资源' : ''}`);
    }
  };
  const chooseCategory = (value: InventoryCategory) => { setCategory(value); setPage(0); setQuery(''); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (dialog || battleRoom || practiceRoom || gameModeLobby || event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') { setDialog({ title: '设置' }); return; }
      const index = QUICK_KEYS.indexOf(event.key);
      if (index < 0) return;
      const item = assets?.items.find((entry) => entry.id === quickbar[index]);
      if (item) chooseItem(item);
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  });

  if (!assets || !creation) return <main className="lobby-viewport"><p role="status">{error || '正在进入大厅…'}</p></main>;
  if (battleRoom) return <Gameplay room={battleRoom} character={character} creation={creation} assets={assets}
    weaponIds={battleWeapons} onExit={() => setBattleRoom(undefined)} />;
  const art = (key: string): CSSProperties => ({ backgroundImage: `url("${lobbyUrl(assets.ui[key])}")` });
  const buttonArt = (key: string): CSSProperties => ({ '--art': `url("${lobbyUrl(assets.ui[`${key}_normal`])}")`,
    '--hover-art': `url("${lobbyUrl(assets.ui[`${key}_hover`])}")`, '--down-art': `url("${lobbyUrl(assets.ui[`${key}_down`])}")` } as CSSProperties);
  const preset = creation.jobs[previewJob].presets[appearance.gender];
  const originalAppearance = validAppearance(creation, character);
  const originalPreset = creation.jobs[character.jobId].presets[originalAppearance.gender];
  const reset = () => {
    setAppearance(originalAppearance); setPreviewJob(character.jobId); setRotation(0);
    setWeaponId(undefined); setAttachment(undefined); setAnimation(undefined); setSelected(undefined); setRevision((value) => value + 1); setStatus('');
  };
  const assignQuickbar = (index: number, id: string) => {
    if (!assets.items.some((item) => item.id === id)) return;
    setQuickbar((slots) => slots.map((value, slot) => slot === index ? id : value));
  };
  const moduleDialog = (title: string) => setDialog({ title, message: `${title}功能需要连接游戏服务器。当前可以在背包中浏览物品、试穿造型并预览装备动作。` });

  return <main className="lobby-viewport">
    <div className="lobby-screen" data-lobby-ready="true" style={{ transform: `scale(${scale})`, backgroundImage: `url("${assetUrl(creation.ui.background)}")` }}
      onPointerDown={() => { void audioRef.current?.play().catch(() => undefined); }}>
      <audio ref={audioRef} src={`${MUSIC_BASE}${musicTrack}.ogg`} loop preload="auto"
        aria-label={musicTrack === 'music-lobby' ? '大厅背景音乐' : '凌云要塞背景音乐'} />
      <img className="lobby-frame" src={lobbyUrl(assets.ui.frame)} alt="" draggable={false} />
      <header className="lobby-header">
        <div className="lobby-portrait" style={art('portraitFrame')}>
          <CharacterPreview assets={creation} preset={originalPreset} appearance={originalAppearance} motion={false}
            weapons={NO_WEAPONS} weaponIndex={null} view="portrait" />
        </div>
        <span className="lobby-level">1</span>
        <img className="lobby-job-icon" src={assetUrl(creation.jobs[character.jobId].icon)} alt={CREATION_JOBS[character.jobId].name} />
        <span className="lobby-name">{character.name}</span>
        <span className="lobby-exp">0 / 100 <span>EXP</span></span>
        <span className="lobby-gold">100000</span><span className="lobby-cash">0</span><span className="lobby-gems">0</span>
        <img className="lobby-vip" src={lobbyUrl(assets.ui.vip)} alt="VIP" />
        <button className="lobby-recharge" onClick={() => moduleDialog('在线充值')}>在线充值</button>
        <nav className="lobby-menu" aria-label="大厅导航">
          {MENUS.map(([key, label]) => <button key={key} className={'lobby-art-button' + (key === 'info' ? ' active' : '')}
            style={buttonArt('menu')} aria-label={label} onClick={() => {
              if (key === 'info') { setPracticeRoom(false); setGameModeLobby(false); chooseCategory('equipment'); }
              else if (key === 'avatar') { setPracticeRoom(false); setGameModeLobby(false); chooseCategory('avatars'); }
              else moduleDialog(label);
            }}>
            <img src={lobbyUrl(assets.ui[`menu-${key}`])} alt="" /><span>{label}</span>
          </button>)}
          <button className="lobby-reward" onClick={() => moduleDialog('在线奖励')} aria-label="在线奖励"><img src={lobbyUrl(assets.ui.reward)} alt="" /><span>00:01:00</span></button>
        </nav>
        <button className="lobby-play" aria-label={practiceRoom ? '返回凌云要塞' : gameModeLobby ? '返回大厅' : '开始游戏'} onClick={() => {
          if (practiceRoom) { setPracticeRoom(false); setGameModeLobby(true); }
          else setGameModeLobby((value) => !value);
          setStatus('');
        }}>开始<br />游戏</button>
      </header>
      {practiceRoom ? <PracticeRoom assets={assets} hostName={character.name} hostIcon={assetUrl(creation.jobs[character.jobId].icon)}
        weaponIds={battleWeapons} onBack={() => { setPracticeRoom(false); setGameModeLobby(true); setStatus(''); }} onStart={setBattleRoom} onStatus={setStatus} />
        : gameModeLobby ? <GameModeLobby assets={assets} onPractice={() => { setPracticeRoom(true); setStatus(''); }} onStatus={setStatus} /> : <>
      <nav className="lobby-main-tabs" aria-label="角色页面">
        {['背包', '技能', '宠物'].map((label, index) => <button key={label} className={'lobby-art-button' + (index === 0 ? ' active' : '')}
          style={buttonArt('mainTab')} onClick={() => index === 0 ? chooseCategory('equipment') : moduleDialog(label)}>{label}</button>)}
      </nav>
      <div className="lobby-content" style={art('content')}>
        <section className="lobby-character-panel" aria-label="角色装备预览">
          <div className="lobby-character-glow" />
          <div className="lobby-avatar">
            <CharacterPreview key={revision} assets={creation} preset={preset} appearance={appearance} motion={motion} weapons={previewWeapons}
              weaponIndex={previewWeapons.length ? 0 : null} animation={animation} attachment={attachment} rotation={rotation} />
          </div>
          <div className="lobby-power-frame" style={art('powerFrame')} />
          <div className="lobby-power" style={art('power')}><span>战斗力</span><b>0</b><small>冒险实力</small></div>
          {['slotStar', 'slotFlame', 'slotRing', 'slotRing'].map((key, index) => <button key={index}
            className={`lobby-equipped-slot slot-${index}`} style={art('slot')} aria-label={['徽章', '翅膀', '左戒指', '右戒指'][index]}
            onClick={() => { chooseCategory('equipment'); setQuery(index === 0 ? 'badge' : index === 1 ? 'wing' : 'ring'); }}>
            <img src={lobbyUrl(assets.ui[key])} alt="" />
          </button>)}
          <div className="lobby-preview-controls">
            <button className="lobby-art-button" style={buttonArt('button')} onClick={reset}>重置</button>
            <button style={art('rotateLeft')} aria-label="向左旋转角色" onClick={() => setRotation((value) => value - Math.PI / 6)} />
            <button style={art('rotateRight')} aria-label="向右旋转角色" onClick={() => setRotation((value) => value + Math.PI / 6)} />
          </div>
          <div className="lobby-character-stats" style={art('stats')}>
            <span className="lobby-stats-title" style={art('statsTitle')}>角色属性</span>
            <div className="lobby-stat-modes">战场 <span>冒险远征</span></div>
            <div className="lobby-stat-values">{[['生命值', '2300', 1], ['耐力值', '0', 6], ['活力值', '0', 2], ['恢复力', '0', 3], ['护甲值', '0', 4], ['破甲值', '0', 5]].map(([label, value, icon]) =>
              <div key={label}><img src={lobbyUrl(assets.ui[`stat${icon}`])} alt="" /><span>{label}</span><b>{value}</b></div>)}</div>
          </div>
        </section>
        <section className="lobby-inventory" style={art('inventory')} aria-label="背包">
          <h1>背包</h1>
          <label className="lobby-search"><span className="sr-only">搜索物品</span><input placeholder="搜索物品" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
          <button className="lobby-renew" style={art('renew')} onClick={() => setStatus('全部物品均可在当前背包中预览')}>全部续费</button>
          <nav className="lobby-bag-tabs" aria-label="物品分类">
            {TABS.map((tab) => <button key={tab.id} className={'lobby-art-button' + (category === tab.id ? ' active' : '')} style={buttonArt('bagTab')}
              aria-pressed={category === tab.id} data-category={tab.id} onClick={() => chooseCategory(tab.id)}>
              <img src={lobbyUrl(assets.ui[tab.icon])} alt="" /><span>{tab.label}</span>
            </button>)}
          </nav>
          <div className="lobby-inventory-grid-frame" style={art('grid')}>
            <div className="lobby-inventory-grid" role="grid" aria-label={`${TABS.find((tab) => tab.id === category)?.label}，共${filtered.length}项`} data-item-count={filtered.length}>
              {Array.from({ length: PAGE_SIZE }, (_, index) => {
                const item = pageItems[index];
                return <button key={item?.id ?? `empty-${index}`} role="gridcell" className={'lobby-item' + (item && selected?.id === item.id ? ' selected' : '')}
                  style={{ ...art(item ? 'occupiedSlot' : 'slot'), '--selected-art': `url("${lobbyUrl(assets.ui.slotSelected)}")` } as CSSProperties}
                  disabled={!item} data-item-id={item?.id} aria-label={item?.name ?? '空格'} aria-selected={!!item && selected?.id === item.id}
                  title={item ? `${item.name}\n${item.id}${item.weapon || item.attachment || item.animation || item.preset ? '\n点击预览，拖动到快捷栏' : ''}` : undefined}
                  draggable={!!item} onDragStart={(event) => { if (item) event.dataTransfer.setData('text/plain', item.id); }}
                  onClick={() => { if (item) chooseItem(item); }}>
                  <img src={lobbyUrl(item?.icon ?? assets.ui.slotLogo)} alt="" draggable={false} />
                  {item && quickbar.includes(item.id) && <span className="lobby-equipped-mark">E</span>}
                </button>;
              })}
            </div>
            {filtered.length === 0 && <p className="lobby-empty" role="status">没有找到对应物品</p>}
          </div>
          <div className="lobby-bag-tools">
            <button style={art('delete')} aria-label="清除装备预览" onClick={reset} />
            <button style={art('expand')} aria-label="查看全部物品" onClick={() => { setQuery(''); setPage(0); setStatus(`背包已开放全部 ${assets.items.length} 项物品`); }} />
            <div className="lobby-pages">
              <button style={art('pageLeft')} aria-label="背包上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} />
              <input aria-label="背包页码" type="number" min="1" max={pageCount} value={currentPage + 1} onChange={(event) => setPage(Math.min(pageCount - 1, Math.max(0, Number(event.target.value) - 1)))} />
              <span>/ {pageCount}</span>
              <button style={art('pageRight')} aria-label="背包下一页" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} />
            </div>
            <button style={art('upgrade')} aria-label="预览攻击动作" title="预览攻击动作" disabled={!previewWeapons[0]?.actions?.attack} onClick={() => { setAnimation(previewWeapons[0].actions?.attack); setStatus(`${selected?.name ?? ''} · 攻击动作`); }} />
            <button style={art('repair')} aria-label="预览装填动作" title="预览装填动作" disabled={!previewWeapons[0]?.actions?.reload} onClick={() => { setAnimation(previewWeapons[0].actions?.reload); setStatus(`${selected?.name ?? ''} · 装填动作`); }} />
            <button style={art('repairAll')} aria-label="恢复持握动作" title="恢复持握动作" onClick={() => setAnimation(undefined)} />
            <button className="lobby-art-button lobby-sort" style={buttonArt('button')} onClick={() => { setSorted((value) => !value); setPage(0); }}>整理</button>
          </div>
          <span className="lobby-item-count">共 {filtered.length} 项</span>
        </section>
        <section className="lobby-quickbar" style={art('quickbar')} aria-label="快捷栏">
          <span>快捷栏</span>
          <div>{quickbar.map((id, index) => {
            const item = assets.items.find((entry) => entry.id === id);
            return <button key={index} className="lobby-quick-slot" style={art(item ? 'occupiedSlot' : 'quickSlot')} aria-label={`快捷栏 ${QUICK_KEYS[index]}${item ? ' ' + item.name : ''}`}
              onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); assignQuickbar(index, event.dataTransfer.getData('text/plain')); }}
              onClick={() => item ? chooseItem(item) : selected && assignQuickbar(index, selected.id)}
              onContextMenu={(event) => { event.preventDefault(); setQuickbar((slots) => slots.map((value, slot) => slot === index ? null : value)); }}>
              <img src={lobbyUrl(item?.icon ?? assets.ui.quickStar)} alt="" /><small>{QUICK_KEYS[index]}</small>
            </button>;
          })}</div>
        </section>
      </div>
      </>}
      <div className="lobby-status" role="status">{status}</div>
      <nav className="lobby-footer" aria-label="大厅工具">
        {FOOTER.map(([key, label]) => <button key={key} aria-label={label} onClick={() => {
          if (key === 'setup') setDialog({ title: '设置' });
          else if (key === 'chat') setGlobalChatOpen(true);
          else moduleDialog(label);
        }}>
          <img src={lobbyUrl(assets.ui[`footer-${key}`])} alt="" />
        </button>)}
      </nav>
      {globalChatOpen && <GlobalChat hostName={character.name} onClose={() => setGlobalChatOpen(false)} />}
      {dialog && <div className="lobby-modal-shade">
        <section ref={dialogRef} className="lobby-modal" style={art('modal')} role="dialog" aria-modal="true" aria-labelledby="lobby-dialog-title">
          <h2 id="lobby-dialog-title">{dialog.title}</h2>
          {dialog.title === '设置' ? <>
            <label>音乐音量 <input aria-label="音乐音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
            <label><input type="checkbox" checked={motion} onChange={(event) => setMotion(event.target.checked)} />播放角色动作</label>
            <button className="lobby-exit lobby-art-button" style={buttonArt('button')} onClick={onExit}>返回角色选择</button>
          </> : <p>{dialog.message}</p>}
          <button className="lobby-dialog-close lobby-art-button" style={buttonArt('button')} onClick={() => setDialog(undefined)}>确定</button>
        </section>
      </div>}
    </div>
  </main>;
}
