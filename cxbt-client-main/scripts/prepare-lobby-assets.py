"""Prepare the original lobby skin and complete local inventory catalogue.

Reads lobbyMain.lua/personalInfo.lua skins, weapon Lua and GameMesh metadata.
Server-owned inventory, prices and stats are not invented: the catalogue exposes
all available lobby item icons, with previews only for verified model/anim links.
"""
from pathlib import Path
import importlib.util
import json
import re
import shutil
import struct
from collections import Counter
from PIL import Image, ImageOps

spec = importlib.util.spec_from_file_location("creation", Path(__file__).with_name("prepare-creation-assets.py"))
creation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(creation)
ROOT, CACHE, GAME_MESH = creation.ROOT, creation.CACHE, creation.GAME_MESH
MAP_CACHE = ROOT / "AvatarStar_zh_cn_cache"
OUTPUT = ROOT / "cxbt-client/public/assets/lobby"
creation.OUTPUT = OUTPUT
UI = CACHE / "ui/skinf"
WEAPON_NAMES = {"pistol": "手枪", "sniperrifle": "狙击枪", "knives": "短刀", "smg": "步枪",
                "shotgun": "散弹枪", "bow": "复合弓", "machinegun": "机关枪", "rpg": "火箭筒",
                "shield": "盾牌", "grenade": "手雷", "grenadelauncher": "榴弹发射器",
                "crossbow": "弩", "sprayer": "生化喷射器", "stick": "手杖"}
ITEM_NAMES = {"bengdai": "绷带", "bandage_02": "急救绷带", "food_cookies": "饼干", "food_ham": "火腿",
              "food_lobster": "龙虾", "leechdom_first_aid_kit": "急救包", "ticket_anabiosis": "复活券",
              "ticket_anabiosis_all": "全体复活券", "instrument_life": "生命探测器", "gift_zongzi": "粽子",
              "gift_mooncake": "月饼", "gift_sweet": "糖果", "leechdom_cardiac": "强心剂",
              "leechdom_blood_serum": "血清", "humancard": "造型卡"}
PREFIX_NAMES = {"piece": "合成碎片", "gem": "宝石", "gem2": "宝石", "baoxiang": "宝箱", "yaoshi": "钥匙",
                "card": "造型卡", "choujiang": "抽奖券", "loudspeaker": "喇叭", "intensify": "强化材料",
                "book": "技能书", "pet": "宠物道具", "wing": "翅膀", "ring": "戒指", "badge": "徽章"}
GESTURES = {"salute": "敬礼", "russia": "俄罗斯舞", "ride": "骑马舞", "pity": "可怜", "nobody": "Nobody",
            "mj": "月球漫步", "help": "求助", "disdain": "鄙视", "defiance": "挑衅", "congratulate": "祝贺",
            "charge": "冲锋", "beck": "招手", "ancient": "古典舞", "street1": "街舞"}
animations = {}
missing = []


def art(name, source, size=None, margins=None):
    path = CACHE / source
    image = Image.open(path).convert("RGBA")
    if size:
        image = creation.nine_slice(image, size, margins) if margins else image.resize(size, Image.Resampling.LANCZOS)
    return creation.save_image(image, "ui/" + name, [source])


def map_image(name, path, size):
    image = ImageOps.contain(Image.open(path).convert("RGBA"), size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, "#292b29")
    canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    return creation.save_image(canvas, "ui/" + name, [path.relative_to(CACHE).as_posix()])


def map_cover(name, path, size):
    """Convert the localized preview card used by the original room dialog."""
    image = Image.open(path).convert("RGBA").resize(size, Image.Resampling.LANCZOS)
    destination = OUTPUT / "ui" / (name + ".png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    creation.provenance[destination.relative_to(OUTPUT).as_posix()] = [path.relative_to(ROOT).as_posix()]
    return "ui/" + destination.name


def map_catalogue():
    icons = (CACHE / "scripts/sys/iconsD.lua").read_text()
    previews = icons.split("PreviewMaps =", 1)[1].split("PreviewMapsDisable =", 1)[0]
    level_ids = {int(value) for value in re.findall(r"\blevel(\d+)\s*=\s*Gui.Image", previews) if int(value) > 0}
    game_text = (CACHE / "scripts/game_text.lua").read_text()
    names = {int(number): name for number, name in re.findall(
        r'id_datalist_\w*level(\d+)\s*=\s*"([^"]+)"', game_text
    )}
    minimaps = {}
    for path in (CACHE / "ui/mapsandbg/maptextures").glob("level*_map_image.dds"):
        match = re.fullmatch(r"level(\d+)_map_image", path.stem)
        if match:
            minimaps[int(match[1])] = path
    level_ids.update(names)
    level_ids.update(minimaps)
    preview_paths = {}
    for root in (MAP_CACHE / "ui/mapsandbg/previewmaps", CACHE / "ui/mapsandbg/previewmaps"):
        if not root.exists():
            continue
        for path in root.glob("skinc_smallmap_level*.tga"):
            match = re.fullmatch(r"skinc_smallmap_level(\d+|_random)(?:_elite)?", path.stem)
            if not match or "_disabled" in path.stem or "_elite" in path.stem:
                continue
            key = "random" if match[1] == "_random" else int(match[1])
            preview_paths.setdefault(key, path)
    level_ids.update(value for value in preview_paths if value != "random")
    random_cover = map_cover("mapCoverRandom", preview_paths["random"], (182, 103)) if "random" in preview_paths else None
    random_room = map_cover("roomMapRandom", preview_paths["random"], (306, 172)) if "random" in preview_paths else None
    maps = [{"id": "random", "name": "随机地图", "cover": random_cover, "roomImage": random_room,
             "coverCard": random_cover is not None}]
    for level_id in sorted(level_ids):
        key = f"level{level_id}"
        source = f"ui/mapsandbg/previewmaps/skinc_smallmap_{key}.tga"
        cover = None
        room_image = None
        preview = preview_paths.get(level_id)
        if preview:
            cover = map_cover(f"mapCover{key.title()}", preview, (182, 103))
        elif (CACHE / source).exists():
            cover = art(f"mapCover{key.title()}", source, (182, 103))
        if (CACHE / source).exists():
            room_image = art(f"roomMap{key.title()}", source, (306, 172))
        elif level_id in minimaps:
            room_image = map_image(f"roomMap{key.title()}", minimaps[level_id], (306, 172))
        elif preview:
            room_image = map_cover(f"roomMap{key.title()}", preview, (306, 172))
        if cover is None and level_id in minimaps:
            cover = map_image(f"mapCover{key.title()}", minimaps[level_id], (182, 103))
        maps.append({"id": key, "name": names.get(level_id, f"地图 {level_id}"), "cover": cover, "roomImage": room_image,
                     "coverCard": preview is not None})
    return maps


def icon(path):
    destination = OUTPUT / "icons" / (path.stem + ".png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.open(path).convert("RGBA").save(destination)
    creation.provenance[destination.relative_to(OUTPUT).as_posix()] = [path.relative_to(CACHE).as_posix()]
    return "icons/" + destination.name


def animation(source):
    if not (CACHE / source).exists():
        return None
    name = source.removeprefix("animation/character/").removesuffix(".anim").replace("/", "-") + ".json"
    destination = "animations/" + name
    animations[destination] = source
    return "../lobby/" + destination


def weapon_preview(path):
    text = path.read_text(errors="replace")
    animation_match = re.search(r'weapon.animation_set\s*=\s*"([^"]+)"', text)
    if not animation_match:
        return None
    animation_set = animation_match[1].lower()
    directory = f"animation/character/thirdperson/male/{animation_set}"
    idle = next((f"{directory}/{name}.anim" for name in ("stdidlemenu", "stdidle")
                 if (CACHE / directory / (name + ".anim")).exists()), None)
    if idle is None:
        return None  # Boss-only weapons do not animate the avatar skeleton.
    mesh_refs = re.findall(r'weapon:SetMesh\("([^"]+)",\s*"([^"]+)"', text)
    if not mesh_refs:
        return None
    parts = []
    for slot, source in mesh_refs:
        source = "mesh/weapon/" + source.lower()
        glb = GAME_MESH / (source + ".glb")
        if not glb.exists():
            missing.append({"weapon": path.stem, "source": source})
            return None
        data = glb.read_bytes()
        doc = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
        model = creation.mesh(source, path.stem + "-" + slot)
        texture = None
        if doc.get("images"):
            image_path = (glb.parent / doc["images"][0]["uri"]).resolve()
            relative = image_path.relative_to(GAME_MESH)
            destination = OUTPUT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                shutil.copyfile(image_path, destination)
            texture = "../lobby/" + relative.as_posix()
            creation.provenance[relative.as_posix()] = ["GameMesh/" + relative.as_posix()]
        parts.append({"model": "../lobby/" + model, "texture": texture,
                      "bone": "handweapon_l" if slot in ("rvl", "lv") else "handweapon_r"})
    actions = {}
    for key, candidates in {"attack": ["stdshoot", "stdattack1", "stdattack"], "reload": ["stdreload"]}.items():
        source = next((f"{directory}/{name}.anim" for name in candidates if (CACHE / directory / (name + ".anim")).exists()), None)
        if source:
            actions[key] = animation(source)
    return {"id": path.stem, "label": path.stem, "icon": "", "parts": parts, "animation": animation(idle), "actions": actions}


def wing_preview(name):
    match = re.match(r"wing_?(\d+)", name)
    if not match:
        return None
    family = "wing" + match[1]
    source = f"mesh/character/thirdperson/avatar/indie/wing/mesh_{family}_indie_lod0.mesh"
    glb = GAME_MESH / (source + ".glb")
    if not glb.exists():
        return None
    data = glb.read_bytes()
    doc = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
    texture = None
    if doc.get("images"):
        image = (glb.parent / doc["images"][0]["uri"]).resolve()
        relative = image.relative_to(GAME_MESH)
        destination = OUTPUT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(image, destination)
        texture = "../lobby/" + relative.as_posix()
        creation.provenance[relative.as_posix()] = ["GameMesh/" + relative.as_posix()]
    # Several wing variants share a rig (e.g. wing05 uses wing03.skel).
    rig = doc.get("skins", [{}])[0].get("name", family)
    idle = next((f"animation/character/indie/wing/{base}/{clip}.anim"
                 for base in dict.fromkeys([rig, family]) for clip in ("idle", "idle_an", "fly")
                 if (CACHE / f"animation/character/indie/wing/{base}/{clip}.anim").exists()), None)
    # showidle on the early wings animates the 68-bone avatar, not the wing rig.
    character_idle = f"animation/character/indie/wing/{rig}/showidle.anim"
    return {"id": name, "model": "../lobby/" + creation.mesh(source, family), "texture": texture,
            "bone": "chest", "animation": animation(idle) if idle else None,
            "characterAnimation": animation(character_idle)}


def label(name):
    if name in ITEM_NAMES:
        return ITEM_NAMES[name]
    prefix, _, suffix = name.partition("_")
    if prefix == "gesture":
        return GESTURES.get(suffix, "动作 · " + suffix)
    kind = WEAPON_NAMES.get(prefix) or PREFIX_NAMES.get(prefix)
    if kind:
        return kind + (" · " + suffix if suffix else "")
    for prefix, value in PREFIX_NAMES.items():
        if name.startswith(prefix):
            return value + " · " + name[len(prefix):].lstrip("_")
    return name


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ui = {}
    direct = {
        "frame": "skin_windowtop_background01_02.tga", "portraitFrame": "skin_windowtop_background03_under.tga",
        "gameMap": "skin_lingyunyaosai_map.tga",
        "gameTitleBar": "skin_playgame_bg25.tga", "gameTitleTab": "skin_playgame_bg30.tga",
        "gameTheme01_normal": "skin_lingyunyaosai_button01_normal.tga",
        "gameTheme01_hover": "skin_lingyunyaosai_button01_hover.tga",
        "gameTheme01_down": "skin_lingyunyaosai_button01_down.tga",
        "gameTheme02_normal": "skin_lingyunyaosai_button02_normal.tga",
        "gameTheme02_hover": "skin_lingyunyaosai_button02_hover.tga",
        "gameTheme02_down": "skin_lingyunyaosai_button02_down.tga",
        "gameTheme03_normal": "skin_lingyunyaosai_button03_normal.tga",
        "gameTheme03_hover": "skin_lingyunyaosai_button03_hover.tga",
        "gameTheme03_down": "skin_lingyunyaosai_button03_down.tga",
        "gameTheme04_normal": "skin_lingyunyaosai_button04_normal.tga",
        "gameTheme04_hover": "skin_lingyunyaosai_button04_hover.tga",
        "gameTheme04_down": "skin_lingyunyaosai_button04_down.tga",
        "gameTheme05_normal": "skin_lingyunyaosai06_button_normal.tga",
        "gameTheme05_hover": "skin_lingyunyaosai06_button_hover.tga",
        "gameTheme05_down": "skin_lingyunyaosai06_button_down.tga",
        "gameQuickMatch_normal": "skin_lingyunyaosai05_button_normal.tga",
        "gameQuickMatch_hover": "skin_lingyunyaosai05_button_hover.tga",
        "gameQuickMatch_down": "skin_lingyunyaosai05_button_down.tga",
        "practiceTitleBar": "skin_playgame_bg35.tga", "practiceTitleTab": "skin_playgame_bg29.tga",
        "practiceAdvance": "skin_playgame_bg26.tga", "practiceInternalTop": "skin_playgame_bg19.tga",
        "practiceIconBack": "skin_button_icon_back.tga", "practiceIconWatch": "skin_lianxisai_icon01.tga",
        "practiceIconCreate": "skin_button_icon_newroom.tga", "practiceIconEnter": "skin_button_icon_enter.tga",
        "practiceIconNovice": "skin_button_icon_novice.tga",
        "practiceModeTab": "skin_playgame_mode_tab.tga",
        "practiceModeAll": "lobby/skin_icon_suiji.tga", "practiceModeTeam": "lobby/skin_icon_tuanzhan.tga",
        "practiceModeOccupy": "lobby/skin_icon_zhandian.tga", "practiceModeFlag": "lobby/skin_icon_duoqi.tga",
        "practiceModeTreasure": "lobby/skin_icon_duobao.tga", "practiceModeKill": "lobby/skin_icon_jianmie.tga",
        "practiceModeBlast": "lobby/skin_icon_baopo.tga", "practiceModeSurvival": "lobby/skin_icon_shenghua.tga",
        "createRoomPageLeft": "skin_playgame_arrow_2.tga", "createRoomPageRight": "skin_playgame_arrow.tga",
        "createRoomComboBg": "skin_common_combobox_bg_normal.tga",
        "createRoomComboButton": "skin_common_combobox_button_normal.tga",
        "createRoomInput": "skin_avatarroom_bg06.tga",
        "createRoomInputDown": "skin_avatarroom_bg06_down.tga",
        "createRoomCheck": "skin_common_background_icon07.tga",
        "createRoomModeBlank": "skin_playgame_mode_blank.tga", "createRoomModeTab": "skin_playgame_mode_tab.tga",
        "roomScore": "skin_room_point_title01.tga", "roomHost": "skin_room_icon_host.tga",
        "roomIconInvite": "skin_button_icon_invite.tga", "roomIconSetup": "skin_button_icon_roomsetup.tga",
        "roomIconStart": "skin_button_icon_start.tga",
        "practiceButton_normal": "skin_common_button02_normal_10.tga",
        "practiceButton_hover": "skin_common_button02_hover_10.tga",
        "practiceButton_down": "skin_common_button02_down_10.tga",
        "practiceButton_disabled": "skin_common_button02_disabled_10.tga",
        "practiceStart_normal": "skin_playgame_button2_normal.tga",
        "practiceStart_hover": "skin_playgame_button2_hover.tga",
        "practiceStart_down": "skin_playgame_button2_down.tga",
        "practiceStart_disabled": "skin_playgame_button2_disabled.tga",
        "practiceRow_normal": "skin_playgame_bg01_normal.tga", "practiceRow_hover": "skin_playgame_bg01_hover.tga",
        "practiceRow_down": "skin_playgame_bg01_down.tga", "practiceRow_disabled": "skin_playgame_bg01_disabled.tga",
        "practiceHeader_normal": "skin_playgame_bg20_normal.tga", "practiceHeader_hover": "skin_playgame_bg20_hover.tga",
        "practiceHeader_down": "skin_playgame_bg20_down.tga",
        "practiceCell": "skin_playgame_bg18.tga", "practiceCellDark": "skin_playgame_bg17.tga",
        "slot": "skin_common_background06_01.tga", "slotSelected": "skin_common_background05.tga",
        "occupiedSlot": "skin_common_weapon_bg01.tga",
        "quickSlot": "skin_common_background07_01.tga",
        "slotLogo": "skin_common_background_icon04.tga", "slotStar": "skin_common_background_icon10.tga",
        "slotRing": "skin_common_background_icon01.tga", "slotFlame": "skin_common_background_icon02.tga",
        "quickStar": "skin_common_background_icon05.tga", "reward": "skin_common_online_award.tga",
        "vip": "skin_common_buff_vip_normal.tga",
        "renew": "skin_common_renew_normal.tga", "delete": "skin_common_lajitong_normal.tga",
        "expand": "skin_common_addbag_normal.tga", "repair": "skin_common_repair_normal.tga",
        "repairAll": "skin_common_allrepair_normal.tga", "upgrade": "skin_common_weaponup_normal.tga",
        "rotateLeft": "skin_common_pagebar_left_normal_01.tga", "rotateRight": "skin_common_pagebar_right_normal_01.tga",
        "pageLeft": "skin_common_pagebar_left_normal.tga", "pageRight": "skin_common_pagebar_right_normal.tga",
        "tabEquipment": "skin_tabicon_wuqi.tga", "tabItems": "skin_tabicon_daoju.tga",
        "tabGestures": "skin_tabicon_shoushi.tga", "tabAvatars": "skin_tabicon_zaoxingka.tga",
        "statsTitle": "skin_info_bg07.tga",
    }
    for key, source in direct.items():
        ui[key] = art(key, "ui/skinf/" + source)
    maps = map_catalogue()
    slices = {
        "content": ("skin_common_background18.tga", (1128, 645), (40, 40, 40, 40)),
        "inventory": ("skin_common_background32.tga", (592, 508), (35, 35, 35, 35)),
        "grid": ("skin_common_background11_01.tga", (573, 357), (30, 30, 30, 30)),
        "quickbar": ("skin_common_background19.tga", (1104, 125), (20, 40, 20, 28)),
        "stats": ("skin_info_bg03.tga", (494, 70), (30, 0, 30, 0)),
        "power": ("skin_info_bg05.tga", (172, 81), (10, 10, 10, 10)),
        "powerFrame": ("skin_info_bg03.tga", (180, 93), (30, 0, 30, 0)),
        "modal": ("skin_common_background18.tga", (470, 290), (40, 40, 40, 40)),
        "practiceModePanel": ("skin_common_background32.tga", (863, 118), (35, 35, 35, 35)),
        "practiceRoomPanel": ("skin_common_background22.tga", (863, 469), (35, 35, 35, 35)),
        "practiceListFrame": ("skin_playgame_bg13.tga", (853, 395), (30, 30, 30, 30)),
        "createRoom": ("skin_tanchubox.tga", (730, 566), (35, 35, 35, 35)),
        "createRoomModePanel": ("skin_common_background23.tga", (614, 92), (14, 14, 14, 14)),
        "createRoomMapPanel": ("skin_common_background23.tga", (614, 280), (14, 14, 14, 14)),
        "createRoomMapFrame": ("skin_common_background13.tga", (182, 103), (10, 10, 10, 10)),
        "createRoomMapHighlight": ("skin_common_background08_01.tga", (182, 103), (8, 8, 8, 8)),
        "roomInfoPanel": ("skin_common_background22.tga", (395, 645), (35, 35, 35, 35)),
        "roomTeamPanel": ("skin_common_background32.tga", (726, 591), (35, 35, 35, 35)),
        "roomTeamFrame": ("skin_playgame_bg13.tga", (714, 389), (30, 30, 30, 30)),
        "roomSmallMapBg": ("skin_smallmapbg01.tga", (374, 281), (50, 0, 50, 0)),
        "roomChatInput": ("skin_playgame_bg18.tga", (384, 38), (20, 16, 20, 16)),
        "roomChatPanel": ("skin_playgame_bg17.tga", (384, 267), (7, 7, 7, 7)),
        "roomRedRow": ("skin_room_bg02_normal.tga", (349, 46), (52, 0, 12, 0)),
        "roomBlueRow": ("skin_room_bg03_normal.tga", (349, 46), (52, 0, 12, 0)),
    }
    for key, (source, size, margins) in slices.items():
        ui[key] = art(key, "ui/skinf/" + source, size, margins)
    for state in ("normal", "hover", "down", "disabled"):
        for key, source, size, margins in (
            ("mainTab", f"skin_tab11_{state}.tga", (206, 42), (30, 20, 30, 20)),
            ("bagTab", f"skin_tab01_{state}.tga", (136, 38), (20, 0, 40, 0)),
            ("button", f"skin_common_button_{state}.tga", (71, 40), (20, 18, 20, 18)),
        ):
            ui[f"{key}_{state}"] = art(f"{key}_{state}", "ui/skinf/" + source, size, margins)
        ui[f"menu_{state}"] = art(f"menu_{state}", f"ui/skinf/skin_menu_{state}_01.tga")
    for name in ("info", "guild", "mission", "enhance", "shop", "avatar", "auction", "rank"):
        ui["menu-" + name] = art("menu-" + name, f"ui/skinf/skin_menu_{name}.tga")
    for name in ("message", "huodong", "junxian", "sign", "friend", "mail", "setup"):
        ui["footer-" + name] = art("footer-" + name, f"ui/skinf/skin_menu_2_{name}.tga")
    for i in range(1, 7):
        ui[f"stat{i}"] = art(f"stat{i}", f"ui/skinf/skin_info_icon{i:02d}.tga")
    catalogue = []
    previews = {}
    icons = sorted((UI / "lobby").glob("*.tga"))
    for path in icons:
        name = path.stem
        if name.endswith("_disabled") or name.startswith("skin_"):
            continue
        prefix = name.split("_")[0]
        category = "equipment" if prefix in WEAPON_NAMES or name.startswith(("badge", "wing", "ring")) else "items"
        if prefix == "gesture":
            category = "gestures"
        elif prefix in ("card", "avatar") or name == "humancard":
            category = "avatars"
        entry = {"id": name, "name": label(name), "category": category, "icon": icon(path)}
        weapon_lua = CACHE / "weapon" / (name + ".lua")
        if category == "equipment" and weapon_lua.exists():
            preview = weapon_preview(weapon_lua)
            if preview:
                preview["label"] = entry["name"]
                preview["icon"] = "../lobby/" + entry["icon"]
                previews[name] = preview
                entry["weapon"] = name
        if category == "gestures":
            entry["animation"] = animation(f"animation/character/gesture/{name}.anim")
        if name.startswith("wing"):
            preview = wing_preview(name)
            if preview:
                entry["attachment"] = preview
        catalogue.append(entry)
    config = json.loads((ROOT / "cxbt-client/public/assets/creation/config.json").read_text())
    jobs = {"guardian": "护卫兵", "gunner": "重装兵", "assassin": "突击兵", "biochemist": "生化专家"}
    for job, data in config["jobs"].items():
        for gender, preset in enumerate(data["presets"]):
            catalogue.append({"id": preset["id"], "name": jobs[job] + (" · I" if gender == 0 else " · II"),
                              "category": "avatars", "icon": "../creation/" + data["icon"], "preset": {"jobId": job, "gender": gender}})
    order = {name: i for i, name in enumerate(["pistol_01", "sniperrifle_01", "knives_01", "stick_sh01", "smg_01", "shotgun_01", "bow_01", "machinegun_01", "rpg_01", "shield_01", "sprayer_01"])}
    catalogue.sort(key=lambda item: (order.get(item["id"], 100 if item.get("weapon") or item.get("attachment") or item.get("preset") else 200), item["id"]))
    manifest = {"ui": ui, "maps": maps, "items": catalogue, "weapons": previews,
                "counts": dict(Counter(item["category"] for item in catalogue))}
    (OUTPUT / "catalog.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    (OUTPUT / "animation-sources.json").write_text(json.dumps(animations, indent=2))
    (OUTPUT / "sources.json").write_text(json.dumps(creation.provenance, ensure_ascii=False, indent=2))
    (OUTPUT / "unavailable-models.json").write_text(json.dumps(missing, ensure_ascii=False, indent=2))
    print(f"Prepared {len(catalogue)} items, {len(previews)} weapon previews, "
          f"{sum('attachment' in item for item in catalogue)} wing previews, {len(animations)} animations: {manifest['counts']}", flush=True)


if __name__ == "__main__":
    main()
