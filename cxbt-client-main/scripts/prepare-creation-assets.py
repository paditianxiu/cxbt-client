"""Build the creation screen's web assets from the original cache and GameMesh.

UI artwork and dimensions come from select_character.lua / sys/skinF.lua.
The original sysavatar_list RPC supplied outfit colors and combinations; the
local presets below reconstruct the supplied screenshot from matching assets.
"""

from pathlib import Path
import json
import re
import shutil
import struct

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "AvatarStar_cache"
GAME_MESH = ROOT / "GameMesh"
OUTPUT = ROOT / "cxbt-client/public/assets/creation"
AVATAR = "mesh/character/thirdperson/avatar"
SKIN = (244, 198, 145)
provenance = {}


def save_image(image, name, sources):
    destination = OUTPUT / (name + ".png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    provenance[destination.relative_to(OUTPUT).as_posix()] = sources
    return name + ".png"


def nine_slice(image, size, margins):
    """Match Gui.Image's fixed edges before CSS scaling, avoiding GPU seams."""
    left, top, right, bottom = margins
    width, height = image.size
    result = Image.new("RGBA", size)
    xs, ys = [0, left, width - right, width], [0, top, height - bottom, height]
    dx, dy = [0, left, size[0] - right, size[0]], [0, top, size[1] - bottom, size[1]]
    for y in range(3):
        for x in range(3):
            if dx[x] == dx[x + 1] or dy[y] == dy[y + 1]:
                continue
            # Some original skins have no center strip (e.g. 68px high with
            # 40/28px edges). Gui.Image stretches the boundary texel there.
            source_left, source_top = min(xs[x], width - 1), min(ys[y], height - 1)
            patch = image.crop((source_left, source_top, max(xs[x + 1], source_left + 1), max(ys[y + 1], source_top + 1)))
            patch = patch.resize((dx[x + 1] - dx[x], dy[y + 1] - dy[y]), Image.Resampling.LANCZOS)
            result.paste(patch, (dx[x], dy[y]))
    return result


def face_canvas(frame, size, center):
    result = Image.new("RGBA", (512, 512))
    frame = frame.resize(size, Image.Resampling.LANCZOS)
    result.paste(frame, (round(center[0] * 512 - size[0] / 2), round(center[1] * 512 - size[1] / 2)))
    return result


def recolor(path, colors):
    """PDE _m RGB channels select recolorable regions in the _c texture."""
    color = Image.open(CACHE / path).convert("RGBA")
    mask_path = CACHE / path.replace("_c.dds", "_m.dds")
    if not mask_path.exists():
        return color
    pixels = np.asarray(color).astype(np.float32)
    mask = np.asarray(Image.open(mask_path).convert("RGB").resize(color.size)).astype(np.float32) / 255
    mask /= np.maximum(mask.sum(axis=2, keepdims=True), 1)
    factors = np.asarray(colors, dtype=np.float32) / 128
    multiplier = (1 - mask.sum(axis=2, keepdims=True)) + mask @ factors
    pixels[:, :, :3] = np.clip(pixels[:, :, :3] * multiplier, 0, 255)
    return Image.fromarray(pixels.astype(np.uint8))


def mesh(source, name):
    """Copy an existing GameMesh GLB, stripping material image dependencies.

Geometry, skeleton, bind matrices and weights stay byte-for-byte unchanged;
the creation runtime assigns the composited and recolored cache materials.
"""
    source_path = GAME_MESH / (source + ".glb")
    data = source_path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + length])
    for key in ("images", "textures", "samplers"):
        document.pop(key, None)
    for material in document.get("materials", []):
        material["pbrMetallicRoughness"] = {"metallicFactor": 0, "roughnessFactor": 0.85}
        material.pop("extras", None)
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    tail = data[20 + length:]
    destination = OUTPUT / "models" / (name + ".glb")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail))
                            + struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail)
    provenance[destination.relative_to(OUTPUT).as_posix()] = ["GameMesh/" + source + ".glb"]
    return "models/" + name + ".glb"


def weapon_asset(name, label):
    """Use the weapon Lua's actual model parts and animation set."""
    lua_source = f"weapon/{name}.lua"
    lua = (CACHE / lua_source).read_text()
    animation_set = re.search(r'weapon.animation_set = "([^"]+)"', lua)[1]
    parts = []
    for slot, source in re.findall(r'weapon:SetMesh\("([^"]+)", "([^"]+)"\)', lua):
        glb = GAME_MESH / "mesh/weapon" / (source + ".glb")
        data = glb.read_bytes()
        document = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
        texture_path = (glb.parent / document["images"][0]["uri"]).resolve()
        texture = save_image(Image.open(texture_path).convert("RGBA"), f"textures/{name}-{slot}",
                             ["GameMesh/" + texture_path.relative_to(GAME_MESH).as_posix(), lua_source])
        parts.append({"model": mesh("mesh/weapon/" + source, name + "-" + slot), "texture": texture,
                      "bone": "handweapon_l" if slot == "rvl" else "handweapon_r"})
    icon_source = "ui/skinf/lobby/" + name + ".tga"
    return {"id": name, "label": label, "parts": parts, "animation": f"animations/{animation_set}.json",
            "icon": save_image(Image.open(CACHE / icon_source).convert("RGBA"), "ui/" + name, [icon_source])}


def assassin_presets():
    presets = []
    hair_color = [(248, 235, 209), (122, 88, 127), (150, 150, 150)]
    for gender, base, hairs in (
        ("male", "malecommandos", ["malecommandos", "malecommandoss", "malecommandosss", "malecommandos02"]),
        ("female", "femalecommandos", ["femalecommandos", "femalecommandoss", "femalecommandos01", "femalecommandos02"]),
    ):
        body = Image.new("RGBA", (1024, 1024), (*SKIN, 255))
        palettes = {
            "outerwear": [(155, 136, 137), (74, 62, 53), (216, 202, 177)],
            "trousers": [(215, 207, 186), (132, 91, 121), (117, 112, 108)],
            "glove": [(135, 78, 130), SKIN, (205, 196, 170)],
            "shoes": [(93, 84, 91), (128, 128, 128), (128, 128, 128)],
        }
        sources = []
        for slot, palette in palettes.items():
            source = f"{AVATAR}/dress/{slot}/tex_{base}_{slot}_c.dds"
            body.alpha_composite(recolor(source, palette).resize(body.size, Image.Resampling.LANCZOS))
            sources.extend([source, source.replace("_c.dds", "_m.dds")])
        preset = {"body": save_image(body, f"textures/{gender}-body", sources), "hair": [], "ears": [], "accessories": []}
        for hair in hairs:
            source = f"{AVATAR}/head/hair/tex_{hair}_hair_c.dds"
            # The plain hair texture uses red for hair; the goggles style uses green.
            palette = [hair_color[1], hair_color[1], hair_color[2]] if hair == base or gender == 'female' else hair_color
            preset["hair"].append({"model": mesh(f"{AVATAR}/head/hair/mesh_{hair}_hair_lod0.mesh", hair),
                "texture": save_image(recolor(source, palette), "textures/" + hair, [source, source.replace("_c.dds", "_m.dds")])})
        ear_base = "malecommandos" if gender == "male" else "avatar"
        for side in ("left", "right"):
            preset["ears"].append(mesh(f"{AVATAR}/head/ear/mesh_{ear_base}_ear_{side}.mesh", f"{gender}-ear-{side}"))
        eye_source = f"{AVATAR}/head/eye/tex_{base}_eye_c.dds"
        eye = recolor(eye_source, [(57, 35, 51), (28, 19, 29), (169, 49, 192)])
        # Each source tile depicts the opposite eye to the base l_eye UV island.
        preset["eyes"] = [save_image(face_canvas(eye.crop((128 * x, 128 * y, 128 * (x + 1), 128 * (y + 1))).transpose(Image.Transpose.FLIP_LEFT_RIGHT), (120, 172), (0.335, 0.69)),
                         f"textures/{gender}-eye-{index}", [eye_source, eye_source.replace("_c.dds", "_m.dds")])
                         for index, (x, y) in enumerate(((0, 0), (1, 2), (0, 2)))]
        mouth_source = f"{AVATAR}/head/mouth/tex_{base}_mouth_c.dds"
        mouth = recolor(mouth_source, [(98, 53, 52), (98, 53, 52), (128, 128, 128)])
        preset["mouths"] = [save_image(face_canvas(mouth.crop((256 * x, 128 * y, 256 * (x + 1), 128 * (y + 1))), (144, 72), (0.50, 0.55)),
                            f"textures/{gender}-mouth-{index}", [mouth_source])
                            for index, (x, y) in enumerate(((1, 0), (0, 1), (1, 1), (0, 2)))]
        accessory_source = f"{AVATAR}/trinket/lowerbody/tex_{base}_trinket_c.dds"
        accessory_texture = save_image(recolor(accessory_source, [(156, 112, 166), (177, 158, 141), (128, 128, 128)]),
                                       f"textures/{gender}-accessories", [accessory_source])
        for number in ("01", "02"):
            preset["accessories"].append({"model": mesh(f"{AVATAR}/trinket/lowerbody/mesh_{base}{number}_trinket_lod0.mesh", f"{gender}-accessory-{number}"),
                                          "texture": accessory_texture})
        preset["id"] = "assassin-" + gender
        preset["fixedParts"] = []
        preset["accessorySets"] = [[], [0], [1], [0, 1]]
        preset["defaultHair"] = 1
        presets.append(preset)
    return presets


def avatar_part(source, name, palette):
    """Read the matching diffuse map from GameMesh, including numbered trinkets."""
    glb = GAME_MESH / AVATAR / (source + ".glb")
    data = glb.read_bytes()
    document = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
    png = (glb.parent / document["images"][0]["uri"]).resolve()
    texture_source = png.relative_to(GAME_MESH / "textures").with_suffix(".dds").as_posix()
    return {
        "model": mesh(f"{AVATAR}/{source}", name),
        "texture": save_image(recolor(texture_source, palette), f"textures/{name}", [texture_source]),
    }


def profession_presets(job):
    # Outfit families exist in the cache even though sysavatar_list is absent.
    # Only explicitly available parts are selected; textures are taken from their
    # GameMesh material references rather than inferred from similarly named files.
    families = {
        "guardian": [
            ("guardman", "guardman", ["guardman", "guardmans", "guardman01", "guardman02"]),
            ("guardwoman", "guardwoman", ["guardwoman", "guardwomans", "guardwomanss", "guardwoman02"]),
        ],
        "gunner": [
            ("heavyman", "heavyman", ["heavyman", "heavymans", "heavymanss", "heavymansss"]),
            ("heavywoman", "heavywoman", ["heavywoman", "heavywomans", "heavywomanss", "heavywomansss"]),
        ],
        "biochemist": [
            ("shenghuanan00", "guardman", ["shenghuanan00", "shenghuanan01", "shenghuanan02", "shenghuanan03"]),
            ("shenghuanv03", "guardwoman", ["shenghuanv00", "shenghuanv01", "shenghuanv02", "shenghuanv03"]),
        ],
    }
    # The masks are RGB tint slots. Colors reconstruct each profession's palette;
    # no material or mesh from the assassin preset is reused for these outfits.
    accents = {"guardian": (67, 145, 157), "gunner": (193, 146, 57), "biochemist": (174, 82, 86)}
    accent = accents[job]
    palettes = {
        "outerwear": [accent, (82, 77, 66), (217, 208, 176)],
        "trousers": [(196, 186, 157), accent, (100, 91, 78)],
        "glove": [accent, SKIN, (198, 184, 149)],
        "shoes": [(82, 73, 62), (128, 128, 128), accent],
    }
    hair_palette = [(121, 89, 52), accent, (180, 176, 157)]
    presets = []
    for gender_index, (base, face_base, hairs) in enumerate(families[job]):
        gender = "male" if gender_index == 0 else "female"
        identity = f"{job}-{gender}"
        body = Image.new("RGBA", (1024, 1024), (*SKIN, 255))
        sources = []
        for slot, palette in palettes.items():
            # This cache has one shared biochemical trousers atlas.
            texture_base = "shenghuanan00" if job == "biochemist" and slot == "trousers" else base
            source = f"{AVATAR}/dress/{slot}/tex_{texture_base}_{slot}_c.dds"
            body.alpha_composite(recolor(source, palette).resize(body.size, Image.Resampling.LANCZOS))
            sources.extend([source, source.replace("_c.dds", "_m.dds")])
        preset = {"id": identity, "body": save_image(body, f"textures/{identity}-body", sources),
                  "hair": [], "ears": [], "fixedParts": [], "accessories": [], "defaultHair": 0}
        for hair in hairs:
            slot = "helmet" if job == "biochemist" and gender_index == 0 else "hair"
            source = f"head/{slot}/mesh_{hair}_{slot}_lod0.mesh"
            if not (GAME_MESH / AVATAR / (source + ".glb")).exists():
                source = f"head/{slot}/mesh_{hair}_{slot}.mesh"
            preset["hair"].append(avatar_part(source, hair, hair_palette))
        ear_base = face_base if face_base in ("guardman", "heavywoman") else "avatar"
        for side in ("left", "right"):
            preset["ears"].append(mesh(f"{AVATAR}/head/ear/mesh_{ear_base}_ear_{side}.mesh", f"{identity}-ear-{side}"))
        eye_source = f"{AVATAR}/head/eye/tex_{face_base}_eye_c.dds"
        eye = recolor(eye_source, [(59, 40, 29), (27, 24, 21), accent])
        preset["eyes"] = [save_image(face_canvas(eye.crop((128 * x, 128 * y, 128 * (x + 1), 128 * (y + 1)))
                                                 .transpose(Image.Transpose.FLIP_LEFT_RIGHT), (120, 172), (0.335, 0.69)),
                                      f"textures/{identity}-eye-{index}", [eye_source])
                          for index, (x, y) in enumerate(((0, 0), (1, 2), (0, 2)))]
        mouth_source = f"{AVATAR}/head/mouth/tex_{face_base}_mouth_c.dds"
        mouth = recolor(mouth_source, [(98, 53, 52), (98, 53, 52), (128, 128, 128)])
        preset["mouths"] = [save_image(face_canvas(mouth.crop((256 * x, 128 * y, 256 * (x + 1), 128 * (y + 1))),
                                                   (144, 72), (0.5, 0.55)), f"textures/{identity}-mouth-{index}", [mouth_source])
                            for index, (x, y) in enumerate(((1, 0), (0, 1), (1, 1), (0, 2)))]
        if job == "biochemist":
            coat = "shenghuanan00" if gender_index == 0 else "shenghuanv00"
            preset["fixedParts"].append(avatar_part(f"trinket/upperbody/mesh_{coat}_trinket_lod0.mesh", coat + "-coat", [accent] * 3))
            belt = "shenghuananvip" if gender_index == 0 else "shenghuanvvip"
            preset["accessories"].append(avatar_part(f"trinket/lowerbody/mesh_{belt}_trinket01_lod0.mesh", belt + "-belt", [accent] * 3))
            preset["accessorySets"] = [[], [0]]
        else:
            count = (7 if gender_index == 0 else 6) if job == "gunner" else 2
            for number in range(1, count + 1):
                preset["accessories"].append(avatar_part(f"trinket/lowerbody/mesh_{base}{number:02d}_trinket_lod0.mesh",
                                                       f"{identity}-accessory-{number}", [accent, (177, 158, 141), (128, 128, 128)]))
            indices = list(range(count))
            preset["accessorySets"] = [[], indices[::2], indices[1::2], indices]
        presets.append(preset)
    return presets


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ui = {
        "background": "bg_normal.dds", "frame": "skin_windowtop_background01_03.tga",
        "panel": "skin_chara_bg01_10.tga", "pill": "skin_chara_bg01_title01.tga",
        "jobPill": "skin_chara_bg01_title02.tga", "description": "skin_chara_bg02_11.tga",
        "diamondOn": "skin_chara_icon_02.tga", "diamondOff": "skin_chara_icon_01.tga",
        "page": "skin_common_pagebar_bg.tga", "back": "skin_button_icon_backsmall.tga",
        "settings": "skin_button_icon_setupsmall.tga", "jobIcon": "skin_common_icon03.tga",
        "input": "skin_avatarroom_bg06.tga",
    }
    for state in ("normal", "hover", "down", "disabled"):
        ui["button_" + state] = f"skin_common_button01_{state}_10.tga"
        ui["finish_" + state] = f"skin_common_button01_{state}_10.tga"
        for direction in ("left", "right"):
            ui[direction + "_" + state] = f"skin_common_pagebar_{direction}_{state}.tga"
    for gender, number in (("male", "02"), ("female", "01")):
        for state in ("normal", "hover", "down"):
            ui[gender + "_" + state] = f"skin_chara_icon{number}_{state}.tga"
    for key, filename in list(ui.items()):
        source = "ui/skinf/" + filename
        image = Image.open(CACHE / source).convert("RGBA")
        sizes = {"panel": ((248, 501), (25, 25, 25, 25)), "pill": ((216, 31), (30, 0, 30, 0)),
                 "jobPill": ((303, 67), (80, 0, 40, 0)), "description": ((390, 210), (0, 23, 0, 23)),
                 "page": ((48, 27), (10, 10, 10, 10)), "input": ((218, 32), (6, 6, 6, 6))}
        if key.startswith("button_"):
            image = nine_slice(image, (124, 56), (40, 25, 40, 25))
        elif key.startswith("finish_"):
            image = nine_slice(image, (255, 66), (40, 25, 40, 25))
        elif key in sizes:
            image = nine_slice(image, *sizes[key])
        ui[key] = save_image(image, "ui/" + key, [source])
    source = "ui/skinf/skin_chara_bg01_10.tga"
    panel = Image.open(CACHE / source).convert("RGBA")
    ui["weaponPanel"] = save_image(nine_slice(panel, (248, 136), (25, 25, 25, 25)), "ui/weaponPanel", [source])
    ui["modalPanel"] = save_image(nine_slice(panel, (370, 260), (25, 25, 25, 25)), "ui/modalPanel", [source])
    sparkle_source = "vfx/textures/vfx_glow_8.dds"
    ui["sparkle"] = save_image(Image.open(CACHE / sparkle_source).convert("RGBA"), "ui/sparkle",
                               [sparkle_source, "vfx/vfx_ui_creat_glowp.vfx"])
    for name in ("pistol_01", "sniperrifle_01", "knives_01"):
        source = "ui/skinf/lobby/" + name + ".tga"
        ui[name] = save_image(Image.open(CACHE / source).convert("RGBA"), "ui/" + name, [source])
    models = {part: mesh(f"{AVATAR}/basemodel/{part}.mesh", part)
              for part in ("body01", "head01", "l_eye", "r_eye", "mouth", "nose")}
    nose_source = f"{AVATAR}/head/nose/tex_huweinan_nose_c.dds"
    nose = recolor(nose_source, [(95, 53, 34)] * 3)
    models["noseTexture"] = save_image(face_canvas(nose, (24, 24), (0.5, 0.95)), "textures/nose", [nose_source])
    jobs = {}
    screenshot_presets = assassin_presets()
    for job, background, icon_number, weapons in (
        ("guardian", "bg_normal02", "01", [("smg_01", "步枪"), ("shotgun_01", "散弹枪"), ("bow_01", "复合弓")]),
        ("gunner", "bg_normal31", "02", [("machinegun_01", "机关枪"), ("rpg_01", "火箭筒"), ("shield_01", "盾牌")]),
        ("assassin", "bg_normal", "03", [("pistol_01", "手枪"), ("sniperrifle_01", "狙击枪"), ("knives_01", "短刀")]),
        ("biochemist", "bg_normal04", "04", [("sprayer_01", "生化喷射器")]),
    ):
        background_source = f"ui/skinf/{background}.dds"
        icon_source = f"ui/skinf/skin_common_icon{icon_number}.tga"
        jobs[job] = {
            "background": save_image(Image.open(CACHE / background_source).convert("RGBA"), "ui/" + background, [background_source]),
            "icon": save_image(Image.open(CACHE / icon_source).convert("RGBA"), "ui/job-" + job, [icon_source]),
            "weapons": [weapon_asset(name, label) for name, label in weapons],
            "presets": screenshot_presets if job == "assassin" else profession_presets(job),
        }
    shutil.copyfile(CACHE / "fonts/simhei.ttf", OUTPUT / "simhei.ttf")
    provenance["simhei.ttf"] = ["fonts/simhei.ttf"]
    config = {"ui": ui, "models": models, "jobs": jobs, "skinColor": "#f4c691"}
    (OUTPUT / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    (OUTPUT / "sources.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {len(provenance)} creation assets in {OUTPUT}")


if __name__ == "__main__":
    main()
