import { useEffect, useRef, useState, type CSSProperties } from 'react';
import CharacterPreview from './CharacterPreview';
import { assetUrl, CREATION_JOBS, initialAppearance, loadCreationAssets, type Appearance, type CreationAssets, type CreationJob } from './assets';
import './CharacterCreation.css';
import { CHARACTER_KEY, type SavedCharacter, saveCharacter } from './character';

const INITIAL_APPEARANCE: Appearance = { gender: 0, hair: 1, eyes: 0, mouth: 0, accessory: 3 };
const PARTS = [
  { key: 'hair', label: '头饰', options: 'hair' }, { key: 'eyes', label: '眼睛', options: 'eyes' },
  { key: 'mouth', label: '嘴巴', options: 'mouths' }, { key: 'accessory', label: '配饰', options: 'accessorySets' },
] as const;

export default function CharacterCreation({ jobId = 'assassin', onBack, onComplete }: {
  jobId?: CreationJob;
  onBack: () => void;
  onComplete: (character: SavedCharacter) => void;
}) {
  const [assets, setAssets] = useState<CreationAssets>();
  const [error, setError] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(INITIAL_APPEARANCE);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [scale, setScale] = useState(1);
  const [settings, setSettings] = useState(false);
  const [motion, setMotion] = useState(true);
  const [volume, setVolume] = useState(0.38);
  const [weapon, setWeapon] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const job = CREATION_JOBS[jobId];

  useEffect(() => {
    const controller = new AbortController();
    loadCreationAssets(controller.signal).then((config) => {
      if (controller.signal.aborted) return;
      setAppearance(initialAppearance(config.jobs[jobId].presets[0]));
      setAssets(config);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => controller.abort();
  }, [jobId]);
  useEffect(() => {
    const resize = () => setScale(Math.min(innerWidth / 1200, innerHeight / 900));
    resize();
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, assets]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettings((value) => !value);
      }
      if (event.key === 'Tab' && settings) {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, input');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, [settings]);
  useEffect(() => {
    if (!settings) return;
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [settings]);

  const finish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (settings) return;
    const clean = name.trim();
    if (Array.from(clean).length < 3 || Array.from(clean).length > 14) {
      setNameError('请输入3～14个字符');
      nameRef.current?.focus();
      return;
    }
    try {
      const character = await saveCharacter(clean, jobId, appearance);
      onComplete(character);
    } catch (e: any) {
      setNameError(e.message || '角色保存失败');
    }
  };

  if (!assets) return <main className="creation-viewport"><p role="status">{error || '正在载入角色创建…'}</p></main>;
  const jobAssets = assets.jobs[jobId];
  const preset = jobAssets.presets[appearance.gender];
  const art = (key: string): CSSProperties => ({ '--art': `url("${assetUrl(assets.ui[key])}")` } as CSSProperties);
  const buttonArt = (prefix: string): CSSProperties => ({
    '--art': `url("${assetUrl(assets.ui[`${prefix}_normal`])}")`,
    '--hover-art': `url("${assetUrl(assets.ui[`${prefix}_hover`])}")`,
    '--down-art': `url("${assetUrl(assets.ui[`${prefix}_down`])}")`,
  } as CSSProperties);

  return <main className="creation-viewport">
    <form className="creation-screen" onSubmit={finish} style={{ transform: `scale(${scale})`, backgroundImage: `url("${assetUrl(jobAssets.background)}")` }}
      onPointerDown={() => { void audioRef.current?.play().catch(() => undefined); }}>
      <audio ref={audioRef} src={`${import.meta.env.BASE_URL}assets/character-selection.ogg`} loop preload="none" />
      <div className="creation-sparkles" aria-hidden="true">
        {Array.from({ length: 42 }, (_, index) => <img key={index} src={assetUrl(assets.ui.sparkle)} alt=""
          style={{ left: 30 + index * 137 % 1130, top: 70 + index * 211 % 740,
            width: 5 + index % 4 * 3, opacity: 0.12 + index % 5 * 0.045 }} />)}
      </div>
      <img className="creation-frame-art" src={assetUrl(assets.ui.frame)} alt="" draggable={false} />
      <h1 className="creation-title">角色创建</h1>

      <CharacterPreview assets={assets} preset={preset} appearance={appearance} motion={motion} weapons={jobAssets.weapons} weaponIndex={weapon} />

      <aside className="creation-customization creation-panel" style={art('panel')} aria-label="角色外观设置">
        <label className="creation-section-label creation-name-label creation-pill" style={art('pill')} htmlFor="character-name">输入角色名称</label>
        <input ref={nameRef} id="character-name" className="creation-name" style={art('input')} value={name} autoComplete="off"
          aria-invalid={!!nameError} aria-describedby="character-name-help" onChange={(event) => { setName(event.target.value); setNameError(''); }} />
        <p id="character-name-help" className={'creation-name-help' + (nameError ? ' has-error' : '')}>{nameError || '请输入3～14个字符'}</p>
        <div className="creation-section-label creation-gender-label creation-pill" style={art('pill')}>初始形象选择</div>
        <div className="creation-genders" role="group" aria-label="初始形象选择">
          {['male', 'female'].map((gender, index) => <button type="button" className={'creation-gender art-button' + (appearance.gender === index ? ' selected' : '')}
            style={buttonArt(gender)} key={gender} aria-label={`初始形象 ${index === 0 ? 'I' : 'II'}`} aria-pressed={appearance.gender === index}
            onClick={() => setAppearance(initialAppearance(jobAssets.presets[index], index))} />)}
        </div>
        <div className="creation-section-label creation-appearance-label creation-pill" style={art('pill')}>选择外观</div>
        <div className="creation-parts">
          {PARTS.map((part) => <div className="creation-part" key={part.key}>
            <span>{part.label}</span>
            <button className="creation-arrow art-button" style={buttonArt('left')} type="button" aria-label={`上一个${part.label}`}
              onClick={() => setAppearance((value) => ({ ...value, [part.key]: (value[part.key] + preset[part.options].length - 1) % preset[part.options].length }))} />
            <output className="creation-part-value" style={art('page')} aria-label={`${part.label}编号`}>{appearance[part.key] + 1}</output>
            <button className="creation-arrow art-button" style={buttonArt('right')} type="button" aria-label={`下一个${part.label}`}
              onClick={() => setAppearance((value) => ({ ...value, [part.key]: (value[part.key] + 1) % preset[part.options].length }))} />
          </div>)}
        </div>
      </aside>

      <aside className="creation-job" aria-label={`${job.name}职业介绍`}>
        <div className="creation-job-title" style={art('jobPill')}>
          <img src={assetUrl(jobAssets.icon)} alt="" /><span>{job.name}</span>
        </div>
        <div className="creation-description" style={art('description')}><p>{job.description}</p></div>
        <div className="creation-stats">
          {['上手度', '攻击', '防御', '生存'].map((label, index) => <div className="creation-stat creation-pill" style={art('pill')} key={label}>
            <span>{label}</span><div aria-label={`${label} ${job.stats[index]}级`}>
              {Array.from({ length: 5 }, (_, diamond) => <img key={diamond} alt="" src={assetUrl(assets.ui[diamond < job.stats[index] ? 'diamondOn' : 'diamondOff'])} />)}
            </div>
          </div>)}
        </div>
      </aside>
      <aside className="creation-weapons creation-panel" style={art('weaponPanel')} aria-label="武器展示">
        <div className="creation-weapon-label creation-pill" style={art('pill')}>武器展示</div>
        <div className="creation-weapon-options">
          {jobAssets.weapons.map((entry, index) => <button key={entry.id} type="button"
            className={'creation-weapon' + (weapon === index ? ' selected' : '')} aria-label={entry.label} aria-pressed={weapon === index}
            onClick={() => setWeapon((value) => value === index ? null : index)}>
            <img src={assetUrl(entry.icon)} alt="" />
          </button>)}
        </div>
        {weapon !== null && <div className="creation-weapon-caption" role="status">{jobAssets.weapons[weapon].label}</div>}
      </aside>

      <button className="creation-action creation-back art-button" style={buttonArt('button')} type="button" onClick={onBack}>
        <img src={assetUrl(assets.ui.back)} alt="" /><span>返回</span>
      </button>
      <button className="creation-action creation-finish art-button" style={buttonArt('finish')} type="submit">完成创建</button>
      <button className="creation-action creation-settings art-button" style={buttonArt('button')} type="button" onClick={() => setSettings(true)}>
        <img src={assetUrl(assets.ui.settings)} alt="" /><span>设置</span>
      </button>

      {settings && <div className="creation-modal-shade">
        <section ref={dialogRef} className="creation-modal creation-panel" style={art('modalPanel')} role="dialog" aria-modal="true" aria-labelledby="creation-dialog-title">
          <h2 id="creation-dialog-title">设置</h2>
          <>
            <label>音乐音量 <input aria-label="音乐音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
            <label><input type="checkbox" checked={motion} onChange={(event) => setMotion(event.target.checked)} />角色待机动作</label>
          </>
          <button type="button" className="creation-dialog-close creation-action art-button" style={buttonArt('button')} onClick={() => setSettings(false)}>确定</button>
        </section>
      </div>}
    </form>
  </main>;
}
