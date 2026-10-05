// Run against Vite: node scripts/smoke-gameplay.mjs http://127.0.0.1:5173
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const output = await mkdtemp(join(tmpdir(), 'avatar-gameplay-smoke-'));
const browser = spawn(process.env.CHROMIUM_PATH ?? 'chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', `--user-data-dir=${output}/profile`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const errors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(message.params.response.url);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 90000);
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
  const waitFor = async (expression, label = expression) => {
    for (let i = 0; i < 300; i += 1) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${label}; ${JSON.stringify(errors)}; screenshots: ${output}`);
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const pointerClick = async (selector) => {
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  };
  const key = async (code, hold = 0) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: code.replace(/^Key/, ''), code });
    if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: code.replace(/^Key/, ''), code });
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `${base}/` });
  await waitFor('document.readyState === "complete"');
  await evaluate(`localStorage.setItem('avatarstar.character', JSON.stringify({version:1,name:'测试角色',jobId:'assassin',appearance:{gender:0,hair:0,eyes:0,mouth:0,accessory:0}}))`);
  await call('Page.navigate', { url: `${base}/lobby` });
  await waitFor(`document.querySelector('.lobby-play') !== null`);
  await click('.lobby-play');
  await waitFor(`document.querySelector('[aria-label="练习赛"]') !== null`);
  await click('[aria-label="练习赛"]');
  await waitFor(`document.querySelector('[aria-label="创建房间"]') !== null`);
  await click('[aria-label="创建房间"]');
  await waitFor(`document.querySelector('[data-map-id="level1"]') !== null`);
  await click('[data-map-id="level1"]');
  await click('.create-room-dialog-actions button:first-child');
  await waitFor(`document.querySelector('[data-room-settings-ready]') !== null`);
  await pointerClick('.room-start');
  await waitFor('document.pointerLockElement === document.body', 'pointer lock on start');
  await waitFor(`document.querySelector('[data-gameplay-ready="true"]') !== null`, 'map and avatar');
  assert.equal(await evaluate(`document.querySelectorAll('.battle-inventory button').length > 0`), true);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.battle-root')).cursor`), 'none');
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(output, 'battle.png'), Buffer.from(data, 'base64'));
  const point = await evaluate(`(() => { const r = document.querySelector('.battle-canvas canvas').getBoundingClientRect(); return {x:r.width/2,y:r.height/2}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  const heading = await evaluate(`document.querySelector('.battle-map-marker').style.transform`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 70, y: point.y });
  await waitFor(`document.querySelector('.battle-map-marker').style.transform !== ${JSON.stringify(heading)}`, 'mouse look');
  const marker = () => evaluate(`document.querySelector('.battle-map-marker').style.left`);
  const start = await marker();
  await key('KeyA', 400);
  const left = await marker();
  await key('KeyD', 400);
  const right = await marker();
  assert.notEqual(left, start, 'A should move the character');
  assert.notEqual(right, left, 'D should move opposite A');
  await key('Space');
  await key('Digit2');
  assert.equal(await evaluate(`document.querySelectorAll('.battle-inventory button.active').length`), 1);
  assert.deepEqual(errors, []);
  console.log(`PASS: battle load, HUD, pointer lock, A/D, jump and weapon input; screenshot: ${output}/battle.png`);
} finally {
  socket?.close();
  browser.kill();
}
