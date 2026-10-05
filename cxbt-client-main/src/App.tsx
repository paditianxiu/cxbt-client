import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import CharacterCreation from './features/characterCreation/CharacterCreation'
import Lobby from './features/lobby/Lobby'
import { readCharacter, fetchCharacterFromServer } from './features/characterCreation/character'
import AuthOverlay from './features/auth/AuthOverlay'
import { getToken } from './api'
import CharacterPreview from './features/characterCreation/CharacterPreview'
import { initialAppearance, loadCreationAssets, type CreationAssets, type CreationJob, type CreationWeapon } from './features/characterCreation/assets'

type Hero = {
  id: string
  name: string
  englishName: string
  icon: string
  title: string
  accent: string
  description: string[]
  stats: { label: string; value: number }[]
  weapon: string
}

const heroes: Hero[] = [
  {
    id: 'guardian',
    name: '护卫兵',
    englishName: 'Guardian',
    icon: '/assets/guardian-icon.png',
    title: '/assets/guardian-title.png',
    accent: '#37f4d3',
    description: ['“护卫兵”视救助生命、捍卫和平为天职。', '步枪、散弹枪、复合弓，轻量便捷，适合移动作战。', '“群体治疗技能”和“辅助攻击技能”将提升团队的整体作战能力。'],
    stats: [{ label: '上手度', value: 5 }, { label: '攻击', value: 3 }, { label: '防御', value: 2 }, { label: '生存', value: 5 }],
    weapon: '步枪 / 散弹枪',
  },
  {
    id: 'assassin',
    name: '突击兵',
    englishName: 'Assassin',
    icon: '/assets/assassin-icon.png',
    title: '/assets/assassin-title.png',
    accent: '#d482f6',
    description: ['“突击兵”是潜入战线的快速猎手。', '双枪、冲锋枪和近战武器，适合高速切入与撤离。', '“隐身技能”和“爆发攻击技能”可以撕开敌方的防线。'],
    stats: [{ label: '上手度', value: 3 }, { label: '攻击', value: 5 }, { label: '防御', value: 2 }, { label: '生存', value: 3 }],
    weapon: '双枪 / 冲锋枪',
  },
  {
    id: 'gunner',
    name: '重装兵',
    englishName: 'Gunner',
    icon: '/assets/gunner-icon.png',
    title: '/assets/gunner-title.png',
    accent: '#f3c54c',
    description: ['“重装兵”用厚重装甲和强大火力压制敌人。', '机枪、火箭筒和重型武器，适合正面突破与阵地战。', '“护盾技能”和“范围火力技能”是团队的坚实后盾。'],
    stats: [{ label: '上手度', value: 4 }, { label: '攻击', value: 5 }, { label: '防御', value: 5 }, { label: '生存', value: 4 }],
    weapon: '机枪 / 火箭筒',
  },
  {
    id: 'biochemist',
    name: '生化专家',
    englishName: 'Biochemist',
    icon: '/assets/biochemist-icon.png',
    title: '/assets/biochemist-title.png',
    accent: '#ed789b',
    description: ['“生化专家”操控危险的生化能量。', '生化枪、毒雾和爆炸物，适合区域控制和持续伤害。', '“治疗技能”和“毒素技能”会改变整场战斗的节奏。'],
    stats: [{ label: '上手度', value: 4 }, { label: '攻击', value: 4 }, { label: '防御', value: 3 }, { label: '生存', value: 4 }],
    weapon: '生化枪 / 毒雾',
  },
]

const NO_WEAPONS: CreationWeapon[] = [];

function HeroScene({ hero }: { hero: Hero }) {
  const [assets, setAssets] = useState<CreationAssets>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadCreationAssets(controller.signal).then((config) => {
      if (!controller.signal.aborted) setAssets(config);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => controller.abort();
  }, []);

  if (!assets) return <div className="creation-loading" role="status">{error || '角色载入中…'}</div>;
  const preset = assets.jobs[hero.id as CreationJob].presets[0];
  return <CharacterPreview assets={assets} preset={preset} appearance={initialAppearance(preset)}
    motion={true} weapons={NO_WEAPONS} weaponIndex={null} />;
}


function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <div className="stat-diamonds" aria-label={label + value + '级'}>
        {Array.from({ length: 5 }, (_, index) => <i className={index < value ? 'filled' : ''} key={index} />)}
      </div>
    </div>
  )
}


function App() {
  const [scale, setScale] = useState(() => Math.min(innerWidth / 1440, innerHeight / 900))
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('job') ?? 'assassin')
  const [started, setStarted] = useState(() => location.pathname.endsWith('/create-character') || new URLSearchParams(window.location.search).get('screen') === 'creation')
  const [inLobby, setInLobby] = useState(() => location.pathname.endsWith('/lobby'))
  const [character, setCharacter] = useState(readCharacter)
  const [isAuth, setIsAuth] = useState(!!getToken())
  const musicRef = useRef<HTMLAudioElement>(null)
  const hero = heroes.find((item) => item.id === selectedId) ?? heroes[0]

  useEffect(() => {
    if (isAuth) {
      fetchCharacterFromServer().then(char => {
        if (char) {
          setCharacter(char);
          setInLobby(true); // Auto enter lobby if has character
        }
      });
    }
  }, [isAuth])

  useEffect(() => {
    const resize = () => setScale(Math.min(innerWidth / 1440, innerHeight / 900))
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const navigate = () => {
      const params = new URLSearchParams(location.search)
      setSelectedId(params.get('job') ?? 'assassin')
      setInLobby(location.pathname.endsWith('/lobby'))
      setCharacter(readCharacter())
      setStarted(location.pathname.endsWith('/create-character') || params.get('screen') === 'creation')
    }
    addEventListener('popstate', navigate)
    return () => removeEventListener('popstate', navigate)
  }, [])

  useEffect(() => {
    const music = musicRef.current
    if (!music) return
    music.volume = 0.38
    void music.play().catch(() => undefined)
  }, [])

  const startMusic = () => {
    void musicRef.current?.play().catch(() => undefined)
  }

  if (!isAuth) {
    return <AuthOverlay onLogin={() => setIsAuth(true)} />
  }

  if (inLobby && character) return <Lobby character={character} onExit={() => {
    setInLobby(false);
    setStarted(false);
    history.pushState(null, '', import.meta.env.BASE_URL);
  }} />

  if (started || inLobby) return <CharacterCreation key={hero.id} jobId={hero.id as CreationJob} onComplete={(created) => {
    setCharacter(created);
    setStarted(false);
    setInLobby(true);
    history.pushState(null, '', `${import.meta.env.BASE_URL}lobby`);
  }} onBack={() => {
    setStarted(false)
    setInLobby(false)
    history.pushState(null, '', import.meta.env.BASE_URL)
  }} />



  return (
    <main className="game-page" style={{ '--hero-accent': hero.accent } as CSSProperties}>
      <div className="game-window" style={{ transform: `scale(${scale})` }} onPointerDown={startMusic}>
        <audio ref={musicRef} loop preload="auto" aria-label="职业选择背景音乐">
          <source src="/assets/character-selection.ogg" type="audio/ogg" />
        </audio>
        <div className="gold-trim top-trim" aria-hidden="true" />
        <header className="game-title">
          <span>职业选择</span>
        </header>

        {character && <button className="resume-lobby" type="button" onClick={() => {
          setInLobby(true);
          history.pushState(null, '', `${import.meta.env.BASE_URL}lobby`);
        }}>返回大厅</button>}

        <section className="game-content">
          <div className="role-ribbon">
            <img src={hero.title} alt="" />
            <span>{hero.englishName}</span>
          </div>

          <aside className="hero-info">
            <div className="job-pill"><span className="job-symbol">✚</span><b>{hero.name}</b></div>
            <div className="description">
              {hero.description.map((line) => <p key={line}><i />{line}</p>)}
            </div>
            <div className="stat-panel">
              {hero.stats.map((stat) => <StatBar key={stat.label} {...stat} />)}
            </div>
            <div className="weapon-note"><span>推荐武器</span><b>{hero.weapon}</b></div>
          </aside>

          <section className="character-stage" aria-label={hero.name + ' 3D展示'}>
            <div className="stage-stars" aria-hidden="true" />
            <div className="stage-floor" aria-hidden="true" />
            <HeroScene hero={hero} />
          </section>

          <nav className="role-list" aria-label="职业选择">
            {heroes.map((item) => (
              <button
                className={'role-choice ' + (item.id === hero.id ? 'selected' : '')}
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setStarted(false) }}
                style={{ '--choice-accent': item.accent } as CSSProperties}
                aria-pressed={item.id === hero.id}
              >
                <img src={item.icon} alt="" />
                <span><b>{item.englishName}</b><small>{item.name}</small></span>
              </button>
            ))}
          </nav>
        </section>

        <footer className="game-actions">
          <button className="gold-button side-button" type="button">
            <img src="/assets/back-icon.png" alt="" />返回
          </button>
          <button className={'gold-button start-button ' + (started ? 'started' : '')} type="button" onClick={() => {
            setStarted(true)
            history.pushState(null, '', `${import.meta.env.BASE_URL}create-character?job=${hero.id}`)
          }}>
            <img src="/assets/enter-icon.png" alt="" />
            {started ? '已选择' : '开始创建'}
          </button>
          <button className="gold-button side-button" type="button">
            <img src="/assets/settings-icon.png" alt="" />设置
          </button>
        </footer>
        {started && <div className="selection-toast">已选择 {hero.name}，准备创建角色</div>}
        <div className="gold-trim bottom-trim" aria-hidden="true" />
      </div>
    </main>
  )
}

export default App
