// Run against a running Vite server: npm run smoke:creation -- http://127.0.0.1:5173
// Requires Node 22+ and Chromium. Screenshots and browser state stay in /tmp.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = await mkdtemp(join(tmpdir(), 'avatar-creation-smoke-'));
const browser = spawn(process.env.CHROMIUM_PATH ?? 'chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', `--user-data-dir=${output}/profile`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const errors = [];
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    browser.stderr.on('data', (data) => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    browser.once('error', reject);
    browser.once('exit', (code) => reject(new Error(`Chromium exited: ${code}`)));
    setTimeout(() => reject(new Error('Chromium startup timed out')), 15000).unref();
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails);
    } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      errors.push(message.params.response.url);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}; screenshots: ${output}`)), 45000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const settled = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const waitFor = async (expression) => {
    for (let i = 0; i < 150; i += 1) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Page wait timed out: ${expression}`);
  };
  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await settled();
  };
  const pointerClick = async (selector) => {
    const target = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return { x, y, reachable: element === document.elementFromPoint(x, y) || element.contains(document.elementFromPoint(x, y)) };
    })()`);
    assert.ok(target.reachable, `${selector} must receive pointer events`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
    await settled();
  };
  const screenshot = async (name, previewOnly = false) => {
    await settled();
    const clip = previewOnly ? await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(typeof previewOnly === 'string' ? previewOnly : '.creation-character')}).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    })()`) : undefined;
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'));
    return data;
  };
  const ready = () => waitFor(`document.querySelector('[data-preview-status]')?.dataset.previewStatus === 'ready' && document.fonts.status === 'loaded'`);
  const navigate = async (path) => {
    await call('Page.navigate', { url: `${base}${path}` });
    await ready();
  };
  const setName = async (name) => {
    await evaluate(`(() => {
      const input = document.querySelector('#character-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await settled();
  };
  const setInput = async (selector, value) => {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await settled();
  };
  const lobbyReady = () => waitFor(`document.querySelector('.lobby-avatar [data-preview-status]')?.dataset.previewStatus === 'ready' && document.querySelector('.lobby-portrait [data-preview-status]')?.dataset.previewStatus === 'ready'`);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1279, height: 954, deviceScaleFactor: 1, mobile: false });
  await navigate('/create-character?job=assassin');
  await screenshot('creation-default');
  for (const name of ['', 'ab', '十五个字符以上的名称不应该通过创建验证']) {
    await setName(name);
    await click('.creation-finish');
    assert.equal(await evaluate(`document.querySelector('#character-name').getAttribute('aria-invalid')`), 'true');
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true);
  }
  await setName('');
  await click('.creation-settings');
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), '音乐音量');
  await click('.creation-modal input[type="checkbox"]');
  await click('.creation-dialog-close');
  // Freeze the animation so image comparisons detect real geometry/material changes.
  for (const [label, count] of [['头饰', 4], ['眼睛', 3], ['嘴巴', 4], ['配饰', 4]]) {
    const selector = `[aria-label="${label}编号"]`;
    const initial = await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    let previous = await screenshot(`before-${label}`, true);
    for (let index = 0; index < count; index += 1) {
      await click(`[aria-label="下一个${label}"]`);
      const next = await screenshot(`option-${label}-${index}`, true);
      assert.notEqual(next, previous, `${label} must update the rendered scene`);
      previous = next;
    }
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`), initial);
  }
  for (const label of ['手枪', '狙击枪', '短刀']) {
    await click(`[aria-label="${label}"]`);
    assert.notEqual(await evaluate(`document.querySelector('[data-weapon]').dataset.weapon`), 'none');
    await screenshot(`weapon-${label}`);
    await click(`[aria-label="${label}"]`);
    assert.equal(await evaluate(`document.querySelector('[data-weapon]').dataset.weapon`), 'none');
  }
  const beforeDrag = await screenshot('before-drag');
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 630, y: 520, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 770, y: 520, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 770, y: 520, button: 'left', clickCount: 1 });
  assert.notEqual(await screenshot('after-drag'), beforeDrag, 'Dragging must rotate the mesh');
  await click('[aria-label="初始形象 II"]');
  await ready();
  await screenshot('creation-female');
  await setName('测试角色😀');
  await click('.creation-finish');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('avatarstar.character')).name`), '测试角色😀');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('avatarstar.character')).appearance.gender`), 1);
  await lobbyReady();
  assert.equal(await evaluate('location.pathname'), '/lobby');
  assert.equal(await evaluate(`document.querySelector('.lobby-name').textContent`), '测试角色😀');
  assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-loaded-preset]').dataset.loadedPreset`), 'assassin-female');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await screenshot('lobby-default');
  await click('.lobby-play');
  await waitFor(`document.querySelector('[data-game-mode-ready]') !== null`);
  assert.equal(await evaluate(`document.querySelector('.game-mode-title h1').textContent`), '凌云要塞');
  for (const label of ['练习赛', '战场', '创想乐园', '冒险远征', '快速匹配']) {
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="${label}"]')`), true);
  }
  await click('[aria-label="战场"]');
  assert.match(await evaluate(`document.querySelector('.lobby-status').textContent`), /本地演示/);
  await click('[aria-label="快速匹配"]');
  assert.match(await evaluate(`document.querySelector('.lobby-status').textContent`), /没有游戏服务器/);
  await screenshot('lobby-game-mode');
  await click('[aria-label="练习赛"]');
  await waitFor(`document.querySelector('[data-practice-room-ready]') !== null`);
  assert.equal(await evaluate(`document.querySelector('.practice-room-title').textContent`), '练习赛');
  for (const label of ['全部', '团队', '占点', '夺旗', '夺宝', '歼灭', '爆破', '生存']) {
    assert.equal(await evaluate(`!!document.querySelector('.practice-mode-button[aria-label="${label}"]')`), true);
  }
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.practice-mode-mark img')).length`), 8);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.practice-mode-mark img')).every((image) => image.complete && image.naturalWidth > 0)`), true);
  for (const label of ['NO', '状态', '房间名称', '房主', '地图', 'Watch', '模式', '人数']) {
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.practice-room-header span')).some((node) => node.textContent === ${JSON.stringify(label)})`), true);
  }
  for (const label of ['返回凌云要塞', '观战', '创建房间', '进入房间']) {
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="${label}"]')`), true);
  }
  await pointerClick('[aria-label="创建房间"]');
  await waitFor(`document.querySelector('[data-create-room-ready]') !== null`);
  for (const label of ['房间名称', '密码', '人数', '人数平衡', '模式选择', '地图选择', '确定', '取消']) {
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-create-room-ready] label, [data-create-room-ready] h3, [data-create-room-ready] button')).some((node) => node.textContent?.includes(${JSON.stringify(label)}) || node.getAttribute('aria-label') === ${JSON.stringify(label)})`), `${label} should be visible`);
  }
  assert.equal(await evaluate(`document.querySelectorAll('.create-room-mode').length`), 6);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.create-room-mode img')).every((image) => image.complete && image.naturalWidth > 0)`), true);
  assert.equal(await evaluate(`document.querySelectorAll('.create-room-map').length`), 6);
  const mapCatalog = await evaluate(`fetch('/assets/lobby/catalog.json').then((response) => response.json())`);
  const mapSources = await evaluate(`fetch('/assets/lobby/sources.json').then((response) => response.json())`);
  assert.ok(mapCatalog.maps.length >= 55);
  assert.equal(mapCatalog.maps[0].id, 'random');
  assert.equal(mapCatalog.maps.find((map) => map.id === 'level1').name, '钟楼小镇');
  for (const map of mapCatalog.maps.filter((entry) => entry.cover)) {
    if (map.id === 'random') continue;
    const level = map.id.slice('level'.length);
    const source = mapSources[map.cover]?.[0];
    assert.ok(source === `ui/mapsandbg/previewmaps/skinc_smallmap_level${level}.tga` ||
      source === `AvatarStar_cache/ui/mapsandbg/previewmaps/skinc_smallmap_level${level}.tga` ||
      source === `AvatarStar_zh_cn_cache/ui/mapsandbg/previewmaps/skinc_smallmap_level${level}.tga` ||
      source === `ui/mapsandbg/maptextures/level${level}_map_image.dds`, `${map.id} must use its own cached image`);
  }
  assert.equal(await evaluate(`(async () => {
    const catalog = await fetch('/assets/lobby/catalog.json').then((response) => response.json());
    return (await Promise.all(catalog.maps.filter((map) => map.cover)
      .map((map) => fetch('/assets/lobby/' + map.cover).then((response) => response.ok)))).every(Boolean);
  })()`), true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-map-id="level1"] .create-room-map-image')).backgroundImage.includes('mapCoverLevel1')`), true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-map-id="level5"] .create-room-map-image')).backgroundImage.includes('mapCoverLevel5')`), true);
  const mapPageBefore = await evaluate(`document.querySelector('.create-room-pages span').textContent`);
  await pointerClick('[aria-label="地图下一页"]');
  assert.notEqual(await evaluate(`document.querySelector('.create-room-pages span').textContent`), mapPageBefore);
  const mapPageCount = Math.ceil(mapCatalog.maps.length / 6);
  for (let page = 2; page < mapPageCount; page += 1) await pointerClick('[aria-label="地图下一页"]');
  assert.equal(await evaluate(`document.querySelector('.create-room-pages span').textContent`), `${mapPageCount} / ${mapPageCount}`);
  await pointerClick('[data-map-id="level10009"]');
  assert.equal(await evaluate(`document.querySelector('[data-map-id="level10009"]').getAttribute('aria-pressed')`), 'true');
  for (let page = 1; page < Math.ceil(mapCatalog.maps.length / 6); page += 1) await pointerClick('[aria-label="地图上一页"]');
  await pointerClick('[data-map-id="level1"]');
  assert.equal(await evaluate(`document.querySelector('[data-map-id="level1"]').getAttribute('aria-pressed')`), 'true');
  await pointerClick('.create-room-mode[aria-label="占点"]');
  assert.equal(await evaluate(`document.querySelector('.create-room-mode[aria-label="占点"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`(() => { const select = document.querySelector('[aria-label="游戏模式分类"]'); const rect = select.getBoundingClientRect(); return select === document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); })()`), true);
  await evaluate(`(() => { const select = document.querySelector('[aria-label="游戏模式分类"]'); select.value = 'survival'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await settled();
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.create-room-map-mode b')).every((node) => node.textContent === '生存')`), true);
  await pointerClick('[aria-label="取消"]');
  assert.equal(await evaluate(`document.querySelector('[data-create-room-ready]') === null`), true);
  await screenshot('practice-room');
  await pointerClick('[aria-label="创建房间"]');
  await setInput('#create-room-name', '测试练习赛房间');
  await pointerClick('[data-map-id="level1"]');
  await pointerClick('.create-room-dialog-actions button:first-child');
  await waitFor(`document.querySelector('[data-room-settings-ready]') !== null`);
  assert.equal(await evaluate(`document.querySelector('.room-team-panel h2').textContent`), '测试练习赛房间');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.room-map-image')).backgroundImage.includes('roomMapLevel1')`), true);
  assert.equal(await evaluate(`document.querySelector('.room-score-red').textContent`), '1');
  await screenshot('room-settings');
  await pointerClick('.room-team-list.blue .room-player-row:first-child');
  assert.equal(await evaluate(`document.querySelector('.room-score-blue').textContent`), '1');
  await setInput('.room-chat-input input', '测试消息');
  await pointerClick('.room-chat-input button');
  assert.match(await evaluate(`document.querySelector('.room-chat-panel').textContent`), /测试消息/);
  await pointerClick('.room-actions button:nth-child(3)');
  await waitFor(`document.querySelector('[data-create-room-ready]') !== null`);
  assert.equal(await evaluate(`document.querySelector('#create-room-players').disabled`), true);
  await setInput('#create-room-name', '已修改房间');
  await pointerClick('.create-room-dialog-actions button:first-child');
  assert.equal(await evaluate(`document.querySelector('.room-team-panel h2').textContent`), '已修改房间');
  await pointerClick('.room-actions button:first-child');
  assert.equal(await evaluate(`document.querySelector('[data-room-settings-ready]') === null`), true);
  await click('[aria-label="返回凌云要塞"]');
  await waitFor(`document.querySelector('[data-game-mode-ready]') !== null`);
  await click('.lobby-menu [aria-label="角色"]');
  assert.equal(await evaluate(`document.querySelector('[data-game-mode-ready]') === null`), true);
  console.log('PASS: creation and entry into the saved character’s lobby');
  const catalogue = await evaluate(`fetch('/assets/lobby/catalog.json').then(response => response.json())`);
  for (const category of ['equipment', 'items', 'gestures', 'avatars']) {
    await click(`[data-category="${category}"]`);
    assert.equal(await evaluate(`Number(document.querySelector('[data-item-count]').dataset.itemCount)`), catalogue.counts[category]);
    // Every item must be reachable through the page controls, including the last page.
    const pages = Math.ceil(catalogue.counts[category] / 24);
    await setInput('[aria-label="背包页码"]', pages);
    const last = catalogue.items.filter(item => item.category === category).at(-1).id;
    assert.equal(await evaluate(`!!document.querySelector('[data-item-id="${last}"]')`), true);
    await screenshot(`lobby-${category}-last-page`);
  }
  await click('[data-category="equipment"]');
  for (const id of ['pistol_01', 'sniperrifle_01', 'knives_01', 'stick_sh01', 'bow_01', 'crossbow_01', 'grenade_01', 'grenadelauncher_01', 'machinegun_01', 'rpg_01', 'shield_01', 'shotgun_01', 'smg_01', 'sprayer_01']) {
    await setInput('.lobby-search input', id);
    await click(`[data-item-id="${id}"]`);
    await lobbyReady();
    assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-weapon]').dataset.weapon`), id);
    await screenshot(`lobby-${id}`);
    for (const [action, label] of [['attack', '预览攻击动作'], ['reload', '预览装填动作']]) {
      const clip = catalogue.weapons[id].actions?.[action];
      if (!clip) continue;
      await click(`[aria-label="${label}"]`);
      await lobbyReady();
      assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-animation]').dataset.animation`), clip);
      const before = await screenshot(`lobby-${id}-${action}`, '.lobby-avatar');
      await evaluate('new Promise(resolve => setTimeout(resolve, 250))');
      const data = await evaluate(`fetch('/assets/creation/' + ${JSON.stringify(clip)}).then(response => response.json())`);
      // The original sprayer shoot clip is a fixed pose; its effect was VFX.
      if (data.tracks.some(track => track.positions.length > 1)) {
        assert.ok(await screenshot(`lobby-${id}-${action}-moving`, '.lobby-avatar') !== before, `${id} ${action} must animate the character`);
      }
    }
  }
  // Assign the current sprayer preview to slot 4, then preview it with the keyboard.
  console.log('PASS: full inventory pagination, 14 weapon families and original actions');
  await click('.lobby-quick-slot:nth-child(4)');
  await click('.lobby-preview-controls button');
  await lobbyReady();
  await evaluate('document.activeElement.blur()');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', code: 'Digit4' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4' });
  await lobbyReady();
  assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-weapon]').dataset.weapon`), 'sprayer_01');
  for (const id of ['wing01_indie', 'wing05_indie', 'wing23_indie', 'wing45_indie']) {
    await setInput('.lobby-search input', id);
    await click(`[data-item-id="${id}"]`);
    await lobbyReady();
    assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-attachment]').dataset.attachment`), id);
    const before = await screenshot(`lobby-${id}`, '.lobby-avatar');
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    assert.ok(await screenshot(`lobby-${id}-moving`, '.lobby-avatar') !== before, `${id} must render its independent animation`);
    await click('[aria-label="向右旋转角色"]');
    await click('[aria-label="向右旋转角色"]');
    await screenshot(`lobby-${id}-rotated`);
    await click('.lobby-preview-controls button');
    await lobbyReady();
  }
  await click('[data-category="gestures"]');
  console.log('PASS: quickbar and independent wing previews');
  await click('[data-item-id="gesture_ride"]');
  await lobbyReady();
  await screenshot('lobby-gesture');
  assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-weapon]').dataset.weapon`), 'none');
  await click('[data-category="avatars"]');
  for (const id of ['guardian-male', 'biochemist-male', 'gunner-female']) {
    await click(`[data-item-id="${id}"]`);
    await lobbyReady();
    assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-loaded-preset]').dataset.loadedPreset`), id);
    await screenshot(`lobby-card-${id}`);
  }
  await click('.lobby-preview-controls button');
  await lobbyReady();
  assert.equal(await evaluate(`document.querySelector('.lobby-avatar [data-loaded-preset]').dataset.loadedPreset`), 'assassin-female');
  await click('[data-category="equipment"]');
  await evaluate(`(() => {
    document.querySelector('[data-item-id="pistol_01"]').click();
    setTimeout(() => document.querySelector('[data-item-id="sniperrifle_01"]').click(), 20);
    setTimeout(() => document.querySelector('[data-item-id="knives_01"]').click(), 40);
  })()`);
  await waitFor(`document.querySelector('.lobby-avatar [data-weapon]')?.dataset.weapon === 'knives_01' && document.querySelector('.lobby-avatar [data-preview-status]')?.dataset.previewStatus === 'ready'`);
  assert.equal(await evaluate(`document.querySelectorAll('.lobby-avatar canvas').length`), 1);
  await evaluate(`document.documentElement.dataset.beforeReload = 'true'`);
  await call('Page.reload');
  await waitFor(`!document.documentElement.dataset.beforeReload && document.querySelector('.lobby-name') !== null`);
  await lobbyReady();
  assert.equal(await evaluate(`document.querySelector('.lobby-name').textContent`), '测试角色😀');
  for (const [width, height] of [[1151, 720], [800, 600], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await settled();
    assert.equal(await evaluate(`(() => {
      const bounds = document.querySelector('.lobby-screen').getBoundingClientRect();
      return bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
    })()`), true, `Lobby must fit ${width}x${height}`);
    await screenshot(`lobby-${width}x${height}`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1279, height: 954, deviceScaleFactor: 1, mobile: false });
  await click('.lobby-footer [aria-label="设置"]');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await settled();
  assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true);
  await click('.lobby-footer [aria-label="设置"]');
  await click('.lobby-exit');
  console.log('PASS: lobby refresh, layouts, dialogs and exit');
  assert.equal(await evaluate(`document.querySelector('.game-title').textContent.trim()`), '职业选择');
  await click('.start-button');
  await ready();
  const modelImages = new Set();
  for (const [job, position] of [['guardian', 1], ['gunner', 3], ['biochemist', 4], ['assassin', 2]]) {
    // Exercise the actual return/select/create flow without reloading the page.
    await click('.creation-back');
    await click(`.role-choice:nth-child(${position})`);
    await waitFor(`document.querySelector('[data-loaded-preset]')?.dataset.loadedPreset === '${job}-male'`);
    await screenshot(`${job}-selection`);
    await click('.start-button');
    await ready();
    await waitFor(`document.querySelector('[data-loaded-preset]')?.dataset.loadedPreset === '${job}-male'`);
    for (const gender of ['male', 'female']) {
      if (gender === 'female') await click('[aria-label="初始形象 II"]');
      await waitFor(`document.querySelector('[data-loaded-preset]')?.dataset.loadedPreset === '${job}-${gender}'`);
      await screenshot(`${job}-${gender}`);
      // Neutralize the page background so the regression check compares models,
      // not profession labels, weapon icons or the color of the backdrop.
      await evaluate(`document.querySelector('.creation-character').style.background = '#222'`);
      const rendered = await screenshot(`${job}-${gender}-model`, true);
      assert.equal(modelImages.has(rendered), false, 'Each profession and gender must render its own model');
      modelImages.add(rendered);
      await evaluate(`document.querySelector('.creation-character').style.background = ''`);
      const initialHair = await evaluate(`document.querySelector('[aria-label="头饰编号"]').textContent`);
      for (let option = 0; option < 4; option += 1) await click('[aria-label="下一个头饰"]');
      assert.equal(await evaluate(`document.querySelector('[aria-label="头饰编号"]').textContent`), initialHair);
    }
    const count = await evaluate(`document.querySelectorAll('.creation-weapon').length`);
    for (let index = 0; index < count; index += 1) {
      await click(`.creation-weapon:nth-child(${index + 1})`);
      await screenshot(`${job}-weapon-${index}`);
    }
  }
  // Rapidly switch while GLBs are loading; stale completions must not win.
  await click('.creation-back');
  await evaluate(`(() => {
    const choices = document.querySelectorAll('.role-choice');
    choices[0].click();
    setTimeout(() => choices[2].click(), 20);
    setTimeout(() => choices[3].click(), 40);
  })()`);
  await waitFor(`document.querySelector('[data-loaded-preset]')?.dataset.loadedPreset === 'biochemist-male'`);
  assert.equal(await evaluate(`document.querySelectorAll('.character-stage canvas').length`), 1);
  await navigate('/create-character?job=assassin');
  for (const [width, height] of [[1920, 1080], [800, 600], [390, 844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await settled();
    assert.equal(await evaluate(`(() => {
      const bounds = document.querySelector('.creation-screen').getBoundingClientRect();
      return bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
    })()`), true, `Screen must fit ${width}x${height}`);
    await screenshot(`creation-${width}x${height}`);
  }
  assert.deepEqual(errors, [], 'Browser console and HTTP requests must be error-free');
  console.log(`PASS: creation, 4 jobs / 8 appearances, lobby navigation and persistence, full inventory, 14 weapon families and actions, independent wing rigs, gestures, avatar cards, quickbar, rapid switching, responsive layouts.\nScreenshots: ${output}`);
  await send('Browser.close');
} finally {
  socket?.close();
  browser.kill();
}
