# AvatarStar 浏览器客户端

```bash
npm install
npm run dev
```

从 `/` 的职业选择页点击「开始创建」，完成后自动进入 `/lobby` 大厅。也可以直接访问 `/create-character?job=assassin`。支持 `guardian`、`gunner`、`assassin`、`biochemist` 四个职业，以及各自的男女模型；刷新大厅会恢复本地保存的角色。

![角色创建](docs/character-creation.png)

## 角色创建

界面以 `AvatarStar_cache/scripts/select_character.lua` 的 1200×900 坐标为基准，等比适配窗口。面板、按钮、职业背景、图标、字体、武器和背景光点均来自缓存。九宫格边距来自 `scripts/sys/skinF.lua`，职业属性和可用介绍来自 Lua。

中间使用 Three.js 加载 `GameMesh` 中由 PDEModelTools 转换的 GLB。角色部件按骨骼名称重映射到同一套骨骼，保留网格和蒙皮权重；服装使用原始 DDS 图层合成，发色等通过 `_m.dds` 遮罩着色。支持拖动旋转、男女形象、头饰/眼睛/嘴巴/配饰切换。男突击兵默认选项为创建截图中的 `2 / 1 / 1 / 4`，女突击兵默认使用大厅截图的紫色双马尾。

职业切换会更换整套资源：护卫兵使用 guardman/guardwoman，重装兵使用 heavyman/heavywoman，突击兵使用 malecommandos/femalecommandos，生化专家使用 shenghuanan/shenghuanv。快速切换时会清理旧场景，避免过期的加载结果覆盖新角色。

待机使用原始 `idlea.anim`。选择武器后，加载武器 Lua 指定的网格、骨骼挂点与 `stdidlemenu.anim` 持握动作；再次点击收起武器。设置弹窗支持音量和待机动作开关、Esc 关闭与键盘焦点约束。

## 大厅与背包

![大厅背包](docs/lobby.png)

大厅依据 `scripts/lobby/lobbyMain.lua`、`personalInfo.lua` 和 `scripts/sys/skinF.lua` 布局，复用原始大厅边框、顶部导航、物品图标、背包面板和快捷栏素材。左侧及顶部头像显示创建时保存的角色。

背包默认开放缓存中的全部 1,208 个条目：611 件装备、569 件道具、14 个表情和 14 个造型条目（包含 8 个本地职业形象）。每页 24 格，支持分类、搜索、翻页和整理，不依赖服务端发放物品。

- 点击 484 件可关联武器 Lua 的装备，加载对应网格、挂点和原始持握动作。背包底部的上箭头、锤子、ALL 按钮分别预览攻击、装填、恢复持握；悬停可查看提示。
- 35 个翅膀条目可预览模型，保留独立骨骼并挂到角色胸骨，校正角色与翅膀的骨骼坐标。翅膀播放自身待机片段，共享骨骼的变体复用对应骨骼动作；存在 `showidle` 时，同时播放角色的展示动作。
- 表情播放原始动作，造型条目切换预览职业和性别；「重置」恢复创建时的角色。
- 拖动物品到快捷栏，或选中物品后点击空快捷格分配；按 `1`～`0`、`-`、`=` 预览，右键清空快捷格。快捷栏在当前大厅会话内保留。
- 模型支持拖动及左右按钮旋转；设置支持音量、动作开关和返回职业选择。

部分戒指、徽章和其他图标缺少可确认的三维关联，仍完整列在背包中，并明确显示没有对应预览资源。139 个动画由 PDEModelTools 的 `.anim` 解析器导出，保持原始 60 fps 采样；恒定轨道仅保存一帧和完整时长。喷射器的原始射击片段是固定姿势，喷射特效尚未接入。

## 素材生成

在仓库根目录运行，依赖 Python 的 Pillow、NumPy，以及 Blender 4.5+：

```bash
python3 cxbt-client/scripts/prepare-creation-assets.py
blender -b --factory-startup --python-exit-code 1 --python PDEModelTools/export_creation_animation.py
python3 cxbt-client/scripts/prepare-lobby-assets.py
blender -b --factory-startup --python-exit-code 1 --python PDEModelTools/export_lobby_animations.py
```

输出为 `public/assets/creation/`（约 53 MiB）与 `public/assets/lobby/`（约 330 MiB）。`config.json` 描述创建资源，`catalog.json` 描述背包及装备预览，`sources.json` 记录图片与模型来源；每个动画 JSON 同样包含原始 `.anim` 路径。页面只加载当前预览所需的模型与动画。生成流程保持 `AvatarStar_cache` 和 `GameMesh` 不变；背景音乐复用 `public/assets/character-selection.ogg`。

在无声卡的 Linux 环境，可为 Blender 设置 `ALSOFT_DRIVERS=null SDL_AUDIODRIVER=dummy`，避免音频服务导致后台进程退出等待。

## 验证

在 `cxbt-client/` 运行：

```bash
npm run lint
npm run build
# 先启动 Vite；需要 Node 22+ 和 Chromium
npm run smoke:creation -- http://127.0.0.1:5173
```

可用 `CHROMIUM_PATH` 指定 Chromium。测试实际加载 WebGL，覆盖创建时的外观切换、四职业八种形象、武器、旋转、名称校验，以及进入大厅、本地角色恢复、全量背包分页、14 类武器的持握/攻击/装填、翅膀独立骨骼、表情、造型卡、快捷栏、快速切换和不同窗口尺寸，同时检查浏览器异常及 HTTP 错误。截图写入运行结果打印的 `/tmp/avatar-creation-smoke-*` 目录。

PDEModelTools 扩展已在 Blender 5.2.2 中构建并通过 `extension validate`。另外抽查导入了身体、头部和护目镜发型，确认 68 根骨骼、蒙皮与静止姿态渲染正常；大厅新增抽查 wing01、wing23、wing45 的骨骼、蒙皮和纹理渲染。35 个翅膀的动画轨道均与独立骨骼匹配。动画通过相同解析器导出，在浏览器中检查实际蒙皮与持握效果。

## 离线复原范围

缓存没有原服 `sysavatar_list` 返回的完整外观组合、颜色和部件变换，也没有 `player_create` 服务。八种职业外观使用已确认的游戏部件，配色、面部贴图布局和耳朵位置为本地重建参数。生化专家的原版介绍文本在这份缓存中缺失。

「完成创建」校验 3～14 个 Unicode 字符，将名字、职业和外观保存到当前浏览器的 `localStorage['avatarstar.character']`，随后进入大厅。物品展示以本地素材目录为准；缺失的正式名称用资源分类及编号标识，货币与属性是参考画面的展示初值。账号、公会、商城、充值及开始对局等入口尚未连接游戏服务器，点击会说明当前支持范围。
