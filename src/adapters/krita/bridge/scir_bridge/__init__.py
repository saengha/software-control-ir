"""PyKrita localhost TCP bridge for Software Control IR.

Listens on 127.0.0.1 only. Dispatch runs on the Qt main thread.
Restore rewrites the exposed layer graph (name, opacity, visibility, lock, order),
not pixel buffers.
"""

from __future__ import annotations

import json
import os
import traceback
from typing import Any

from krita import Extension, Krita, Node  # type: ignore
from PyQt5.QtCore import QByteArray
from PyQt5.QtNetwork import QHostAddress, QTcpServer, QTcpSocket

HOST = "127.0.0.1"
DOCUMENT_ID = "document_01"
_DOC = None


def _app():
    return Krita.instance()


def active_document():
    global _DOC
    if _DOC is not None:
        return _DOC
    app = _app()
    doc = app.activeDocument()
    if doc is not None:
        _DOC = doc
        return doc
    documents = app.documents()
    if documents:
        _DOC = documents[0]
        return documents[0]
    return None


def ensure_view(doc) -> None:
    app = _app()
    window = app.activeWindow()
    if window is None:
        windows = app.windows()
        window = windows[0] if windows else None
    if window is None:
        return
    seen = False
    try:
        for view in window.views():
            if view.document() == doc:
                seen = True
                break
    except Exception:
        seen = False
    if not seen:
        window.addView(doc)


def opacity_pct(node: Node) -> int:
    return int(round(int(node.opacity()) * 100 / 255))


def set_opacity_pct(node: Node, value: int) -> None:
    clamped = max(0, min(100, int(value)))
    node.setOpacity(int(round(clamped * 255 / 100)))


def walk_nodes(node: Node, parent_id: str | None, objects: list[dict[str, Any]], z_base: int = 0) -> int:
    children = list(node.childNodes())
    for index, child in enumerate(children):
        item: dict[str, Any] = {
            "id": child.name(),
            "type": "layer",
            "properties": {
                "opacity": opacity_pct(child),
                "visible": bool(child.visible()),
                "locked": bool(child.locked()),
                "z": z_base + index,
            },
        }
        if parent_id:
            item["parent"] = parent_id
        objects.append(item)
        walk_nodes(child, child.name(), objects, 0)
    return z_base + len(children)


def snapshot() -> dict[str, Any]:
    doc = active_document()
    if doc is None:
        raise RuntimeError("no Krita document is open")
    objects: list[dict[str, Any]] = [
        {
            "id": DOCUMENT_ID,
            "type": "document",
            "properties": {"locked": False},
        }
    ]
    walk_nodes(doc.rootNode(), DOCUMENT_ID, objects)
    selection: list[str] = []
    current = doc.activeNode()
    if current is not None and current != doc.rootNode():
        selection = [current.name()]
    return {
        "objects": objects,
        "selection": selection,
        "meta": {
            "restoreScope": "exposed-state",
            "units": "px",
        },
    }


def find_node(doc, target: str) -> Node:
    if target == DOCUMENT_ID:
        raise KeyError(target)

    def search(node: Node) -> Node | None:
        if node.name() == target:
            return node
        for child in node.childNodes():
            found = search(child)
            if found is not None:
                return found
        return None

    found = search(doc.rootNode())
    if found is None:
        raise KeyError(target)
    return found


def parent_node(doc, parent_id: str | None) -> Node:
    if parent_id in (None, DOCUMENT_ID):
        return doc.rootNode()
    return find_node(doc, str(parent_id))


def unique_name(doc, prefix: str) -> str:
    index = 1
    name = f"{prefix}_{index:02d}"
    existing = {item["id"] for item in snapshot()["objects"]}
    while name in existing:
        index += 1
        name = f"{prefix}_{index:02d}"
    return name


def seed() -> dict[str, Any]:
    global _DOC
    app = _app()
    for doc in list(app.documents()):
        try:
            doc.close()
        except Exception:
            pass
    _DOC = None
    doc = app.createDocument(512, 512, "board", "RGBA", "U8", "", 72.0)
    if doc is None:
        raise RuntimeError("Krita createDocument failed")
    _DOC = doc
    ensure_view(doc)
    root = doc.rootNode()
    children = list(root.childNodes())
    paint = children[0] if children else doc.createNode("paint_01", "paintlayer")
    paint.setName("paint_01")
    paint.setLocked(False)
    paint.setVisible(True)
    set_opacity_pct(paint, 100)
    if paint not in root.childNodes():
        root.addChildNode(paint, None)
    for extra in list(root.childNodes()):
        if extra.name() not in ("paint_01", "lock_01"):
            try:
                extra.remove()
            except Exception:
                extra.setVisible(False)
    lock = doc.createNode("lock_01", "paintlayer")
    lock.setName("lock_01")
    root.addChildNode(lock, None)
    lock.setLocked(True)
    lock.setVisible(True)
    set_opacity_pct(lock, 100)
    doc.setActiveNode(paint)
    doc.refreshProjection()
    return snapshot()


def create_layer(doc, params: dict[str, Any]) -> None:
    kind = str(params.get("kind") or "paint")
    if kind != "paint":
        raise ValueError("kind must be paint")
    name = params.get("id")
    if not isinstance(name, str) or not name:
        name = unique_name(doc, "paint")
    existing = {item["id"] for item in snapshot()["objects"]}
    if name in existing:
        raise ValueError(f'Object "{name}" already exists')
    parent = parent_node(doc, params.get("parent") if isinstance(params.get("parent"), str) else DOCUMENT_ID)
    node = doc.createNode(name, "paintlayer")
    node.setName(name)
    parent.addChildNode(node, None)
    node.setLocked(False)
    node.setVisible(True)
    set_opacity_pct(node, 100)
    doc.setActiveNode(node)
    doc.refreshProjection()


def execute(action: dict[str, Any]) -> None:
    doc = active_document()
    if doc is None:
        raise RuntimeError("no Krita document is open")
    name = action.get("action")
    target = action.get("target")
    params = action.get("params") or {}

    if name == "create_layer":
        create_layer(doc, params)
        return

    if name == "select":
        if not target:
            return
        if target == DOCUMENT_ID:
            return
        doc.setActiveNode(find_node(doc, str(target)))
        return

    if not target or target == DOCUMENT_ID:
        if name == "delete":
            raise ValueError("cannot delete the document")
        raise KeyError(target)

    node = find_node(doc, str(target))

    if name == "delete":
        if node.childNodes():
            raise ValueError(f'Cannot delete "{target}" while it still has children')
        node.remove()
        doc.refreshProjection()
        return
    if name == "set_locked":
        node.setLocked(bool(params.get("value")))
        return
    if name == "set_opacity":
        set_opacity_pct(node, int(params.get("value")))
        doc.refreshProjection()
        return
    if name == "set_visible":
        node.setVisible(bool(params.get("value")))
        doc.refreshProjection()
        return
    raise ValueError(f'Adapter cannot execute "{name}"')


def apply_state(state: dict[str, Any]) -> None:
    doc = active_document()
    if doc is None:
        raise RuntimeError("no Krita document is open")
    specs = [item for item in (state.get("objects") or []) if item.get("type") == "layer"]
    wanted = [str(item["id"]) for item in specs if item.get("id")]

    def collect(node: Node) -> list[Node]:
        found = []
        for child in node.childNodes():
            found.append(child)
            found.extend(collect(child))
        return found

    for node in collect(doc.rootNode()):
        if node.name() not in wanted:
            try:
                node.remove()
            except Exception:
                pass

    for spec in specs:
        name = str(spec["id"])
        parent_id = spec.get("parent") if isinstance(spec.get("parent"), str) else DOCUMENT_ID
        try:
            node = find_node(doc, name)
        except KeyError:
            parent = parent_node(doc, parent_id)
            node = doc.createNode(name, "paintlayer")
            node.setName(name)
            parent.addChildNode(node, None)
        props = spec.get("properties") or {}
        if "opacity" in props:
            set_opacity_pct(node, int(props["opacity"]))
        if "visible" in props:
            node.setVisible(bool(props["visible"]))
        node.setLocked(bool(props.get("locked")))

    selection = state.get("selection") or []
    if selection and selection[0] != DOCUMENT_ID:
        try:
            doc.setActiveNode(find_node(doc, str(selection[0])))
        except KeyError:
            pass
    doc.refreshProjection()


def save_document(path: str) -> None:
    doc = active_document()
    if doc is None:
        raise RuntimeError("no Krita document is open")
    if not doc.saveAs(path):
        raise RuntimeError(f"Krita saveAs failed: {path}")


def load_document(path: str) -> None:
    global _DOC
    app = _app()
    for doc in list(app.documents()):
        try:
            doc.close()
        except Exception:
            pass
    _DOC = None
    doc = app.openDocument(path)
    if doc is None:
        raise RuntimeError(f"Krita openDocument failed: {path}")
    _DOC = doc
    ensure_view(doc)


def dispatch(request: dict[str, Any]) -> Any:
    method = request.get("method")
    if method == "bootstrap":
        if request.get("seed"):
            return {"ready": True, **seed()}
        document = request.get("document")
        if document:
            load_document(str(document))
        doc = active_document()
        if doc is None:
            return {"ready": True, **seed()}
        ensure_view(doc)
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
        try:
            app = _app()
            for doc in list(app.documents()):
                try:
                    doc.setModified(False)
                    doc.close()
                except Exception:
                    pass
            from PyQt5.QtWidgets import QApplication

            instance = QApplication.instance()
            if instance is not None:
                instance.quit()
        except Exception:
            pass
        return {}
    raise ValueError(f"unknown method {method}")


class LineServer(QTcpServer):
    def __init__(self) -> None:
        super().__init__()
        self._buffers: dict[QTcpSocket, bytes] = {}

    def incomingConnection(self, handle: int) -> None:  # noqa: N802
        sock = QTcpSocket(self)
        if not sock.setSocketDescriptor(handle):
            sock.deleteLater()
            return
        if sock.peerAddress().toString() not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            sock.close()
            sock.deleteLater()
            return
        self._buffers[sock] = b""
        sock.readyRead.connect(lambda s=sock: self._read(s))
        sock.disconnected.connect(lambda s=sock: self._gone(s))

    def _read(self, sock: QTcpSocket) -> None:
        self._buffers[sock] = self._buffers.get(sock, b"") + bytes(sock.readAll())
        buf = self._buffers[sock]
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            self._buffers[sock] = buf
            if not line.strip():
                continue
            request: dict[str, Any] | None = None
            try:
                request = json.loads(line.decode("utf-8"))
                result = dispatch(request)
                payload = {"ok": True, "result": result if result is not None else {}}
            except Exception as error:
                payload = {
                    "ok": False,
                    "error": f"APPLICATION_ERROR: {error}\n{traceback.format_exc()}",
                }
            data = (json.dumps(payload) + "\n").encode("utf-8")
            sock.write(QByteArray(data))
            sock.flush()
            method = request.get("method") if isinstance(request, dict) else None
            if method == "shutdown":
                sock.disconnectFromHost()

    def _gone(self, sock: QTcpSocket) -> None:
        self._buffers.pop(sock, None)
        sock.deleteLater()


class ScirExtension(Extension):
    def __init__(self, parent):
        super().__init__(parent)
        self.server: LineServer | None = None

    def setup(self) -> None:
        port = os.environ.get("SCIR_KRITA_PORT")
        log_path = os.environ.get("SCIR_KRITA_LOG")
        if not port:
            return
        server = LineServer()
        ok = server.listen(QHostAddress.LocalHost, int(port))
        if log_path:
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write(f"listen={ok} port={port} error={server.errorString()}\n")
        if not ok:
            raise RuntimeError(f"BRIDGE_ERROR: cannot listen on 127.0.0.1:{port}")
        self.server = server

    def createActions(self, window) -> None:  # noqa: N802
        return


if os.environ.get("SCIR_KRITA_AS_PLUGIN") == "1":
    _extension = ScirExtension(Krita.instance())
    try:
        Scripter.addExtension(_extension)
    except NameError:
        Krita.instance().addExtension(_extension)
