"""JSON-lines bpy bridge for a headless Blender process.

Listens on 127.0.0.1 only. bpy calls stay on the main thread.
Stdout may contain Blender noise; readiness is the TCP listen, not a log line.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
from typing import Any

import bpy


HOST = "127.0.0.1"
OBJECT_KINDS = ("mesh", "empty", "light")


def vec3(value: Any) -> list[float]:
    return [round(float(value[0]), 6), round(float(value[1]), 6), round(float(value[2]), 6)]


def is_locked(obj: Any) -> bool:
    return bool(all(obj.lock_location) and all(obj.lock_rotation) and all(obj.lock_scale))


def set_locked(obj: Any, value: bool) -> None:
    obj.lock_location = (value, value, value)
    obj.lock_rotation = (value, value, value)
    obj.lock_scale = (value, value, value)


def scir_type(obj: Any) -> str:
    custom = obj.get("scir_type")
    if custom in ("scene", "mesh", "empty", "light"):
        return str(custom)
    if obj.type == "MESH":
        return "mesh"
    if obj.type == "LIGHT":
        return "light"
    if obj.type == "EMPTY":
        return "empty"
    return obj.type.lower()


def link(obj: Any) -> None:
    collection = bpy.context.scene.collection
    if obj.name not in collection.objects:
        collection.objects.link(obj)


def clear_objects() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def make_empty(name: str, location: tuple[float, float, float] = (0.0, 0.0, 0.0), parent: Any | None = None, kind: str = "empty") -> Any:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj["scir_type"] = kind
    link(obj)
    if parent is not None:
        obj.parent = parent
    obj.location = location
    return obj


def make_mesh(name: str, location: tuple[float, float, float] = (0.0, 0.0, 0.0), parent: Any | None = None) -> Any:
    import bmesh

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    obj["scir_type"] = "mesh"
    bm = bmesh.new()
    try:
        bmesh.ops.create_cube(bm, size=2.0)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    link(obj)
    if parent is not None:
        obj.parent = parent
    obj.location = location
    return obj


def make_light(name: str, location: tuple[float, float, float] = (2.0, 2.0, 2.0), parent: Any | None = None) -> Any:
    data = bpy.data.lights.new(name, "POINT")
    obj = bpy.data.objects.new(name, data)
    obj["scir_type"] = "light"
    link(obj)
    if parent is not None:
        obj.parent = parent
    obj.location = location
    return obj


def object_by_id(target: str) -> Any:
    obj = bpy.data.objects.get(target)
    if obj is None:
        raise KeyError(target)
    return obj


def select_only(obj: Any | None) -> None:
    view = bpy.context.view_layer
    for item in bpy.data.objects:
        item.select_set(False)
    if obj is None:
        view.objects.active = None
        return
    obj.select_set(True)
    view.objects.active = obj


def snapshot() -> dict[str, Any]:
    objects: list[dict[str, Any]] = []
    for obj in bpy.data.objects:
        kind = scir_type(obj)
        if kind not in ("scene", "mesh", "empty", "light"):
            continue
        item: dict[str, Any] = {
            "id": obj.name,
            "type": kind,
            "properties": {
                "location": vec3(obj.location),
                "scale": vec3(obj.scale),
                "locked": is_locked(obj),
            },
        }
        if obj.parent is not None:
            item["parent"] = obj.parent.name
        objects.append(item)
    selection = [item.name for item in bpy.context.view_layer.objects if item.select_get()]
    return {
        "objects": objects,
        "selection": selection,
        "meta": {
            "units": "m",
            "restoreScope": "exposed-state",
        },
    }


def loc(params: dict[str, Any], default: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    x = params.get("x")
    y = params.get("y")
    z = params.get("z")
    return (
        float(x) if isinstance(x, (int, float)) else default[0],
        float(y) if isinstance(y, (int, float)) else default[1],
        float(z) if isinstance(z, (int, float)) else default[2],
    )


def create_object(params: dict[str, Any]) -> None:
    kind = str(params.get("kind") or "")
    if kind not in OBJECT_KINDS:
        raise ValueError(f"kind must be one of {OBJECT_KINDS}")
    name = params.get("id")
    if not isinstance(name, str) or not name:
        prefix = {"mesh": "mesh", "empty": "empty", "light": "light"}[kind]
        index = 1
        name = f"{prefix}_{index:02d}"
        while name in bpy.data.objects:
            index += 1
            name = f"{prefix}_{index:02d}"
    if name in bpy.data.objects:
        raise ValueError(f'Object "{name}" already exists')
    parent_name = params.get("parent")
    parent = object_by_id(str(parent_name)) if isinstance(parent_name, str) and parent_name else bpy.data.objects.get("scene_01")
    position = loc(params)
    if kind == "mesh":
        obj = make_mesh(name, position, parent)
    elif kind == "light":
        obj = make_light(name, position, parent)
    else:
        obj = make_empty(name, position, parent, "empty")
    select_only(obj)


def execute(action: dict[str, Any]) -> None:
    name = action.get("action")
    target = action.get("target")
    params = action.get("params") or {}

    if name == "create_object":
        create_object(params)
        return

    if name == "select":
        select_only(object_by_id(str(target)) if target else None)
        return

    obj = object_by_id(str(target))

    if name == "delete":
        bpy.data.objects.remove(obj, do_unlink=True)
        return
    if name == "set_locked":
        set_locked(obj, bool(params.get("value")))
        return
    if name == "set_location":
        obj.location = loc(params, tuple(obj.location))  # type: ignore[arg-type]
        return
    if name == "set_scale":
        obj.scale = loc(params, tuple(obj.scale))  # type: ignore[arg-type]
        return
    raise ValueError(f'Adapter cannot execute "{name}"')


def apply_state(state: dict[str, Any]) -> None:
    specs = list(state.get("objects") or [])
    wanted = {str(item["id"]) for item in specs if item.get("id")}
    for obj in list(bpy.data.objects):
        if obj.name not in wanted:
            bpy.data.objects.remove(obj, do_unlink=True)

    pending = list(specs)
    guard = 0
    while pending and guard < 32:
        guard += 1
        remaining = []
        for spec in pending:
            name = str(spec["id"])
            parent_name = spec.get("parent")
            parent = None
            if isinstance(parent_name, str) and parent_name:
                parent = bpy.data.objects.get(parent_name)
                if parent is None:
                    remaining.append(spec)
                    continue
            kind = str(spec.get("type") or "empty")
            obj = bpy.data.objects.get(name)
            if obj is None:
                position = (0.0, 0.0, 0.0)
                if kind == "mesh":
                    obj = make_mesh(name, position, parent)
                elif kind == "light":
                    obj = make_light(name, position, parent)
                elif kind == "scene":
                    obj = make_empty(name, position, parent, "scene")
                else:
                    obj = make_empty(name, position, parent, "empty")
            elif parent is not None and obj.parent != parent:
                obj.parent = parent
            props = spec.get("properties") or {}
            location = props.get("location")
            scale = props.get("scale")
            if isinstance(location, list) and len(location) == 3:
                obj.location = (float(location[0]), float(location[1]), float(location[2]))
            if isinstance(scale, list) and len(scale) == 3:
                obj.scale = (float(scale[0]), float(scale[1]), float(scale[2]))
            set_locked(obj, bool(props.get("locked")))
        pending = remaining

    selection = state.get("selection") or []
    if selection:
        try:
            select_only(object_by_id(str(selection[0])))
        except KeyError:
            select_only(None)
    else:
        select_only(None)


def seed() -> None:
    clear_objects()
    scene_01 = make_empty("scene_01", kind="scene")
    scene_02 = make_empty("scene_02", kind="scene")
    cube = make_mesh("cube_01", (0.0, 0.0, 0.0), scene_01)
    lock = make_empty("lock_01", (1.5, 0.0, 0.0), scene_01, "empty")
    set_locked(lock, True)
    make_light("light_01", (2.0, 2.0, 2.0), scene_01)
    make_mesh("extra_01", (5.0, 0.0, 0.0), scene_02)
    select_only(cube)


def load_document(path: str) -> None:
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)


def save_document(path: str) -> None:
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)


def dispatch(request: dict[str, Any]) -> Any:
    method = request.get("method")
    if method == "bootstrap":
        if request.get("seed"):
            seed()
        else:
            document = request.get("document")
            if not document:
                raise RuntimeError("bootstrap requires seed or document")
            load_document(str(document))
        return {"ready": True, **snapshot()}
    if method == "snapshot":
        return snapshot()
    if method == "execute":
        execute(request["action"])
        return {}
    if method == "restore":
        apply_state(request["state"])
        return snapshot()
    if method == "save":
        save_document(str(request["document"]))
        return {}
    if method == "load":
        load_document(str(request["document"]))
        return {}
    if method == "shutdown":
        return {}
    raise ValueError(f"unknown method {method}")


def handle_conn(conn: socket.socket) -> str | None:
    try:
        buf = b""
        while b"\n" not in buf:
            chunk = conn.recv(65536)
            if not chunk:
                return None
            buf += chunk
        line = buf.split(b"\n", 1)[0]
        request = json.loads(line.decode("utf-8"))
    except (OSError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        # TCP probes (waitForPort) close without a JSON line. Keep serving.
        return None
    try:
        result = dispatch(request)
        payload = {"ok": True, "result": result if result is not None else {}}
    except Exception as error:
        payload = {"ok": False, "error": f"APPLICATION_ERROR: {error}"}
    try:
        conn.sendall((json.dumps(payload) + "\n").encode("utf-8"))
    except OSError:
        return None
    method = request.get("method") if isinstance(request, dict) else None
    return str(method) if method else None


def serve(port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, port))
    sock.listen(8)
    try:
        while True:
            conn, addr = sock.accept()
            if addr[0] not in ("127.0.0.1", "::1"):
                conn.close()
                continue
            try:
                method = handle_conn(conn)
            finally:
                conn.close()
            if method == "shutdown":
                return
    finally:
        sock.close()


def script_args() -> list[str]:
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    if "--port" in argv:
        return argv[argv.index("--port") :]
    return argv[1:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--document")
    parser.add_argument("--seed", action="store_true")
    args = parser.parse_args(script_args())
    if args.seed:
        seed()
    elif args.document:
        load_document(args.document)
    else:
        seed()
    serve(args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
