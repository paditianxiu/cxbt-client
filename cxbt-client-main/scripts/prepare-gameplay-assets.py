"""Stage converted PDE scene models and original in-game artwork for Vite."""

from pathlib import Path
import json
import re
import shutil
import struct
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "AvatarStar_cache"
MESH = ROOT / "GameMesh"
OUTPUT = ROOT / "cxbt-client/public/assets/gameplay"
CATALOG = ROOT / "cxbt-client/public/assets/lobby/catalog.json"

HUD = [
    "skin_ingame_bg01_red", "skin_ingame_bg02", "skin_ingame_heart",
    "skin_ingame_heart01", "skin_ingame_heart02", "skin_ingame_timebg_red",
    "skin_ingame_timebg_blue", "skin_ingame_timeicon_bg", "skin_ingame_tuanzhan",
    "skin_ingame_danyao_01", "skin_ingame_danyao_02",
    "skin_ingame_icon_ammobg_row", "skin_ingame_skill_bg",
    "skin_ingame_skill_bg02", "skin_ingame_timebg_redicon", "skin_ingame_timebg_blueicon",
    "skin_ingame_bg01_blue", "skin_ingame_bg04", "small_map_mask", "map_cursor01",
]

SKILL_ICONS = ("ballistic", "bandage_heal", "assimilation", "bloodpoison")

SOUNDS = {
    "jump": "motion/jump_pt1.wav", "land": "motion/jump_pt2.wav",
    "roll": "motion/roll_general.wav", "step1": "motion/walk_01.wav",
    "step2": "motion/walk_02.wav", "step3": "motion/walk_03.wav",
    "pistol": "weapon/pistol_swap_mono.wav", "sniperrifle": "weapon/sniper_swap_mono.wav",
    "shotgun": "weapon/shotgun_swap_mono.wav", "smg": "weapon/smg_swap_mono.wav",
    "machinegun": "weapon/machine_swap_mono.wav", "knives": "weapon/knife_swap_mono.wav",
    "grenade": "weapon/grenade_swap_mono.wav", "rpg": "weapon/rocket_swap_sh_mono.wav",
    "bow": "weapon/bow_swap.wav", "crossbow": "weapon/sb-at_crossbow-swap.wav",
    "shield": "weapon/shield_swap_mono.wav", "sprayer": "weapon/sb-at_sprayer-swap.wav",
    "grenadelauncher": "weapon/sb-at_grenlauncher-swap.wav",
    "fire-pistol": "weapon/pistol_2.wav", "fire-sniperrifle": "weapon/sniper_fire.wav",
    "fire-shotgun": "weapon/shotgun_fire_mono.wav", "fire-smg": "weapon/smg_fire_mono_4.wav",
    "fire-machinegun": "weapon/machine_fire_mono.wav", "fire-knives": "weapon/knife_2.wav",
    "fire-bow": "weapon/bow_fire_b.wav", "fire-crossbow": "weapon/sb-at_crossbow-fire.wav",
    "fire-grenadelauncher": "weapon/sb-at_grenlauncher-fire.wav",
    "fire-grenade": "weapon/grenade_2.wav", "fire-shield": "weapon/shield_fire_pt1.wav",
    "fire-rpg": "weapon/rocket_2.wav",
}


def copy_asset(source: Path):
    destination = OUTPUT / source.relative_to(MESH)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists() or destination.stat().st_size != source.stat().st_size:
        shutil.copyfile(source, destination)


def stage_model(source: Path):
    copy_asset(source)
    data = source.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + length])
    for image in document.get("images", []):
        if "uri" in image:
            texture = (source.parent / image["uri"]).resolve()
            if texture.is_relative_to(MESH) and texture.exists():
                copy_asset(texture)
    return source.relative_to(MESH).as_posix()


def read_glb(source: Path):
    data = source.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    return data, json.loads(data[20:20 + length]), 28 + length


def mesh_positions(glb, mesh_index):
    data, document, binary_start = glb
    primitive = document["meshes"][mesh_index]["primitives"][0]
    accessor = document["accessors"][primitive["attributes"]["POSITION"]]
    view = document["bufferViews"][accessor["bufferView"]]
    offset = binary_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    return {tuple(round(value * 100) for value in struct.unpack_from("<fff", data, offset + i * stride))
            for i in range(accessor["count"])}


def air_wall_meshes(scene_path: Path, collision_path: Path):
    if not collision_path.exists():
        return []
    visual, collision = read_glb(scene_path), read_glb(collision_path)
    wall_vertices = set()
    for node in collision[1].get("nodes", []):
        if node.get("extras", {}).get("collision", {}).get("surfaceId") == 2:
            wall_vertices.update(mesh_positions(collision, node["mesh"]))
    if not wall_vertices:
        return []
    names = []
    for node in visual[1].get("nodes", []):
        if "mesh" not in node:
            continue
        vertices = mesh_positions(visual, node["mesh"])
        if len(vertices) >= 6 and len(vertices & wall_vertices) / len(vertices) >= 0.95:
            names.append(node["name"])
    return names


def number_list(text, call):
    match = re.search(r"level:" + call + r"\(([^)]+)\)", text)
    return [float(value) for value in match[1].split(",")] if match else None


def stage_minimap(text):
    match = re.search(r'level:SetMapTexture\("([^"]+)"\)', text)
    if not match:
        return None
    source = CACHE / match[1].lower()
    if not source.exists():
        return None
    target = OUTPUT / "minimaps" / (source.stem + ".png")
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        Image.open(source).convert("RGBA").save(target)
    return target.relative_to(OUTPUT).as_posix()


def main():
    maps = json.loads(CATALOG.read_text())["maps"]
    manifest = {}
    air_wall_cache = {}
    for entry in maps:
        name = entry["id"]
        if name == "random":
            continue
        script = CACHE / "mesh/scene" / name / "script.lua"
        if not script.exists():
            continue
        text = script.read_text(errors="replace")
        match = re.search(r'level:AddMesh\("([^"]+)"\)', text)
        if not match:
            continue
        mesh = MESH / "mesh/scene" / (match[1] + ".glb")
        if not mesh.exists():
            continue
        collision = mesh.with_name(mesh.name.replace(".mesh.glb", ".physx.glb"))
        key = (mesh, collision)
        if key not in air_wall_cache:
            air_wall_cache[key] = air_wall_meshes(mesh, collision)
        manifest[name] = {
            "scene": stage_model(mesh),
            "collision": stage_model(collision) if collision.exists() else None,
            "airWalls": air_wall_cache[key],
            "minimap": stage_minimap(text),
            "bounds": number_list(text, "SetMapInfo"),
            "camera": number_list(text, "SetCameraPosition"),
            "fog": number_list(text, "SetFog"),
            "ambience": (re.search(r'level:SetAmbienceAudio\("go/ambience_2d/([^\"]+)"\)', text) or [None, None])[1],
        }
    ui = CACHE / "ui/ingamef"
    for name in HUD:
        source = next((ui / (name + suffix) for suffix in (".tga", ".dds") if (ui / (name + suffix)).exists()), None)
        if source:
            target = OUTPUT / "ui" / (name + ".png")
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.open(source).convert("RGBA").save(target)
    for name in SKILL_ICONS:
        source = CACHE / "ui/skinf/lobby" / (name + ".tga")
        Image.open(source).convert("RGBA").save(OUTPUT / "ui" / (name + ".png"))
    audio = CACHE / "audio/wav"
    target_audio = OUTPUT / "audio"
    target_audio.mkdir(parents=True, exist_ok=True)
    for name, relative in SOUNDS.items():
        shutil.copyfile(audio / relative, target_audio / (name + ".wav"))
    for name, relative in (("battle", "music/theme_battle.wav"),
                           ("ambience_day", "ambience/ambience_day.wav"),
                           ("alien_boss", "ambience/alien_boss.wav"),
                           ("castle", "ambience/am_castle_lp.wav")):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(audio / relative),
                        "-c:a", "libvorbis", "-q:a", "3", str(target_audio / (name + ".ogg"))], check=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "maps.json").write_text(json.dumps(manifest, separators=(",", ":")))
    print(f"Staged {len(manifest)} playable map definitions")


if __name__ == "__main__":
    main()
