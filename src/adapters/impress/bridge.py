"""JSON-lines UNO bridge for a headless LibreOffice Impress document.

Node starts soffice, then calls this script once per RPC with --port.
Stdout must contain exactly one line starting with SCIR_JSON:.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

HMM = 100  # LibreOffice units are 1/100 mm


def connect(port: int, attempts: int = 60) -> Any:
    import uno

    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver",
        local,
    )
    url = f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    last = None
    for _ in range(attempts):
        try:
            return resolver.resolve(url)
        except Exception as error:
            last = error
            time.sleep(0.5)
    raise RuntimeError(f"UNO connect failed: {last}") from last


def desktop_of(ctx: Any) -> Any:
    return ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)


def close_all(desktop: Any) -> None:
    components = desktop.getComponents()
    enum = components.createEnumeration()
    while enum.hasMoreElements():
        component = enum.nextElement()
        try:
            component.close(True)
        except Exception:
            pass


def impress_doc(desktop: Any) -> Any | None:
    enum = desktop.getComponents().createEnumeration()
    while enum.hasMoreElements():
        component = enum.nextElement()
        try:
            if component.supportsService("com.sun.star.presentation.PresentationDocument"):
                return component
        except Exception:
            continue
    return None


def mm(value: int) -> float:
    return round(value / HMM, 2)


def hmm(value: float) -> int:
    return int(round(value * HMM))


def hex_color(value: str) -> int:
    raw = value.lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        raise ValueError(f"invalid color {value}")
    return int(raw, 16)


def as_hex(color: int) -> str:
    return f"#{int(color) & 0xFFFFFF:06x}"


def kind_of(shape: Any) -> str:
    type_name = ""
    try:
        type_name = shape.getShapeType()
    except Exception:
        type_name = shape.getImplementationName() if hasattr(shape, "getImplementationName") else ""
    lowered = type_name.lower()
    if "ellipse" in lowered:
        return "ellipse"
    if "text" in lowered:
        return "textbox"
    return "rectangle"


def shape_text(shape: Any) -> str:
    try:
        return str(shape.String or "").replace("\r\n", "\n").replace("\r", "\n")
    except Exception:
        return ""


def is_locked(shape: Any) -> bool:
    try:
        return bool(shape.MoveProtect or shape.SizeProtect)
    except Exception:
        return False


def set_locked(shape: Any, value: bool) -> None:
    shape.MoveProtect = value
    shape.SizeProtect = value


def add_shape(doc: Any, page: Any, kind: str, name: str, x: float, y: float, width: float, height: float, **props: Any) -> Any:
    from com.sun.star.awt import Point, Size

    service = {
        "rectangle": "com.sun.star.drawing.RectangleShape",
        "ellipse": "com.sun.star.drawing.EllipseShape",
        "textbox": "com.sun.star.drawing.TextShape",
    }[kind]
    shape = doc.createInstance(service)
    shape.Size = Size(hmm(width), hmm(height))
    shape.Position = Point(hmm(x), hmm(y))
    page.add(shape)
    shape.Name = name
    if "fill" in props:
        fill = str(props.get("fill") or "")
        if fill.lower() in ("none", "transparent", ""):
            try:
                from com.sun.star.drawing.FillStyle import NONE as FILL_NONE

                shape.FillStyle = FILL_NONE
            except Exception:
                shape.FillStyle = 0
            try:
                from com.sun.star.drawing.LineStyle import NONE as LINE_NONE

                shape.LineStyle = LINE_NONE
            except Exception:
                pass
        else:
            try:
                from com.sun.star.drawing.FillStyle import SOLID

                shape.FillStyle = SOLID
            except Exception:
                shape.FillStyle = 1
            shape.FillColor = hex_color(fill)
    if "text" in props:
        try:
            shape.String = str(props["text"])
        except Exception:
            pass
    color = props.get("text_color") or props.get("textColor")
    if color:
        try:
            shape.CharColor = hex_color(str(color))
        except Exception:
            pass
    if props.get("locked"):
        set_locked(shape, True)
    return shape


def clear_page(page: Any) -> None:
    while page.getCount():
        page.remove(page.getByIndex(0))


def seed(doc: Any) -> None:
    pages = doc.DrawPages
    while pages.Count < 2:
        pages.insertNewByIndex(pages.Count)
    while pages.Count > 2:
        pages.remove(pages.getByIndex(pages.Count - 1))

    slide_01 = pages.getByIndex(0)
    slide_02 = pages.getByIndex(1)
    slide_01.Name = "slide_01"
    slide_02.Name = "slide_02"
    clear_page(slide_01)
    clear_page(slide_02)

    add_shape(
        doc,
        slide_01,
        "textbox",
        "title_01",
        12,
        12,
        250,
        28,
        fill="#0f1a14",
        text="Quarterly Review",
    )
    add_shape(doc, slide_01, "rectangle", "accent_01", 12, 48, 80, 5, fill="#e6a23c")
    add_shape(doc, slide_01, "ellipse", "logo_01", 240, 170, 20, 20, fill="#8fd0c4", locked=True)
    add_shape(
        doc,
        slide_02,
        "textbox",
        "body_02",
        12,
        20,
        180,
        40,
        fill="#0f1a14",
        text="Second slide is hidden from relevant state until activated.",
    )

    controller = doc.getCurrentController()
    controller.setCurrentPage(slide_01)
    controller.select(doc.DrawPages.getByIndex(0).getByIndex(0))


def seed_contrast(doc: Any) -> None:
    pages = doc.DrawPages
    while pages.Count < 1:
        pages.insertNewByIndex(pages.Count)
    while pages.Count > 1:
        pages.remove(pages.getByIndex(pages.Count - 1))

    slide_01 = pages.getByIndex(0)
    slide_01.Name = "slide_01"
    clear_page(slide_01)

    width = mm(slide_01.Width)
    height = mm(slide_01.Height)
    bg = add_shape(doc, slide_01, "rectangle", "bg_01", 0, 0, width, height, fill="#f4f7fb")
    try:
        from com.sun.star.drawing.LineStyle import NONE as LINE_NONE

        bg.LineStyle = LINE_NONE
    except Exception:
        pass
    add_shape(
        doc,
        slide_01,
        "textbox",
        "title_01",
        12,
        12,
        min(250, max(40, width - 24)),
        28,
        fill="none",
        text="Sample heading",
        text_color="#ffffff",
    )

    controller = doc.getCurrentController()
    controller.setCurrentPage(slide_01)
    controller.select(bg)


def find(doc: Any, target: str) -> tuple[str, Any, Any]:
    pages = doc.DrawPages
    for i in range(pages.Count):
        page = pages.getByIndex(i)
        if page.Name == target:
            return "slide", page, page
        for j in range(page.getCount()):
            shape = page.getByIndex(j)
            if shape.Name == target:
                return "shape", page, shape
    raise KeyError(target)


def snapshot(doc: Any) -> dict[str, Any]:
    objects: list[dict[str, Any]] = []
    pages = doc.DrawPages
    controller = doc.getCurrentController()
    active = "slide_01"
    try:
        active = controller.getCurrentPage().Name
    except Exception:
        pass

    selection: list[str] = []
    try:
        selected = controller.getSelection()
        name = getattr(selected, "Name", None)
        if isinstance(name, str) and name:
            selection = [name]
        elif hasattr(selected, "getCount"):
            for i in range(selected.getCount()):
                item = selected.getByIndex(i)
                item_name = getattr(item, "Name", None)
                if isinstance(item_name, str) and item_name:
                    selection.append(item_name)
    except Exception:
        pass

    for i in range(pages.Count):
        page = pages.getByIndex(i)
        page_id = page.Name or f"slide_{i + 1:02d}"
        if not page.Name:
            page.Name = page_id
        objects.append(
            {
                "id": page_id,
                "type": "slide",
                "properties": {
                    "title": page_id,
                    "width": mm(page.Width),
                    "height": mm(page.Height),
                    "locked": False,
                },
            }
        )
        for j in range(page.getCount()):
            shape = page.getByIndex(j)
            shape_id = shape.Name or f"{page_id}_shape_{j + 1}"
            if not shape.Name:
                shape.Name = shape_id
            fill = "none"
            try:
                style = int(shape.FillStyle)
                if style != 0:
                    fill = as_hex(shape.FillColor)
            except Exception:
                try:
                    fill = as_hex(shape.FillColor)
                except Exception:
                    fill = "#888888"
            text_color = "#000000"
            try:
                text_color = as_hex(shape.CharColor)
            except Exception:
                pass
            objects.append(
                {
                    "id": shape_id,
                    "type": kind_of(shape),
                    "parent": page_id,
                    "properties": {
                        "locked": is_locked(shape),
                        "fill": fill,
                        "text": shape_text(shape),
                        "textColor": text_color,
                        "x": mm(shape.Position.X),
                        "y": mm(shape.Position.Y),
                        "width": mm(shape.Size.Width),
                        "height": mm(shape.Size.Height),
                        "z": j + 1,
                    },
                }
            )

    return {"objects": objects, "selection": selection, "meta": {"activeSlide": active, "units": "mm"}}


def execute(doc: Any, action: dict[str, Any]) -> None:
    from com.sun.star.awt import Point, Size

    name = action["action"]
    target = action.get("target")
    params = action.get("params") or {}
    controller = doc.getCurrentController()

    if name == "select":
        if not target:
            controller.select(doc)
            return
        kind, page, obj = find(doc, target)
        if kind == "slide":
            controller.setCurrentPage(page)
        controller.select(obj)
        return

    if name == "set_active_slide":
        _, page, _ = find(doc, target)
        controller.setCurrentPage(page)
        controller.select(page)
        return

    if name == "create_shape":
        parent = params.get("parent")
        if not parent:
            parent = controller.getCurrentPage().Name
        _, page, _ = find(doc, str(parent))
        kind = str(params["kind"])
        shape_id = params.get("id") or f"{kind[:4]}_{page.getCount() + 1}"
        add_shape(
            doc,
            page,
            kind,
            str(shape_id),
            float(params["x"]),
            float(params["y"]),
            float(params["width"]),
            float(params["height"]),
            text=params.get("text", "Text" if kind == "textbox" else ""),
            fill="#0f1a14" if kind == "textbox" else "#4e7f74",
        )
        created = find(doc, str(shape_id))[2]
        controller.select(created)
        return

    kind, page, obj = find(doc, str(target))

    if name == "delete":
        if kind == "slide":
            doc.DrawPages.remove(obj)
        else:
            page.remove(obj)
        return

    if name == "set_locked":
        set_locked(obj, bool(params["value"]))
        return

    if name == "set_text":
        obj.String = str(params["value"])
        return

    if name == "set_fill":
        try:
            from com.sun.star.drawing.FillStyle import SOLID

            obj.FillStyle = SOLID
        except Exception:
            obj.FillStyle = 1
        obj.FillColor = hex_color(str(params["value"]))
        return

    if name == "move":
        obj.Position = Point(hmm(float(params["x"])), hmm(float(params["y"])))
        return

    if name == "resize":
        obj.Size = Size(hmm(float(params["width"])), hmm(float(params["height"])))
        return

    raise ValueError(f'Adapter cannot execute "{name}"')


def pv(**kwargs: Any) -> tuple[Any, ...]:
    from com.sun.star.beans import PropertyValue

    items = []
    for name, value in kwargs.items():
        item = PropertyValue()
        item.Name = name
        item.Value = value
        items.append(item)
    return tuple(items)


def as_system_path(value: str) -> str:
    if not value.startswith("file:"):
        return value
    try:
        import uno

        return str(uno.fileUrlToSystemPath(value))
    except Exception:
        return value


def isolation(ctx: Any) -> dict[str, str]:
    subst = ctx.ServiceManager.createInstanceWithContext("com.sun.star.util.PathSubstitution", ctx)
    user = as_system_path(str(subst.substituteVariables("$(user)", True)))
    install = as_system_path(str(subst.substituteVariables("$(instpath)", True)))
    return {"user": user, "install": install}


def load_document(desktop: Any, url: str) -> Any:
    return desktop.loadComponentFromURL(url, "_blank", 0, pv(Hidden=True, ReadOnly=False))


def save_document(doc: Any, url: str) -> None:
    doc.storeToURL(url, pv(FilterName="impress8", Overwrite=True))


def apply_state(doc: Any, state: dict[str, Any]) -> None:
    objects = state.get("objects") or []
    slides = [item for item in objects if item.get("type") == "slide"]
    shapes = [item for item in objects if item.get("type") != "slide"]
    pages = doc.DrawPages
    locked = False
    try:
        doc.lockControllers()
        locked = True
    except Exception:
        pass

    try:
        while pages.Count < len(slides):
            pages.insertNewByIndex(pages.Count)
        while pages.Count > len(slides):
            pages.remove(pages.getByIndex(pages.Count - 1))

        for index, slide in enumerate(slides):
            page = pages.getByIndex(index)
            page.Name = str(slide["id"])
            props = slide.get("properties") or {}
            try:
                if props.get("width") is not None:
                    page.Width = hmm(float(props["width"]))
                if props.get("height") is not None:
                    page.Height = hmm(float(props["height"]))
            except Exception:
                pass
            clear_page(page)

        for spec in sorted(shapes, key=lambda item: ((item.get("properties") or {}).get("z") or 0)):
            parent = spec.get("parent")
            if not parent:
                continue
            _, page, _ = find(doc, str(parent))
            props = spec.get("properties") or {}
            kind = str(spec.get("type") or "rectangle")
            if kind not in ("rectangle", "ellipse", "textbox"):
                kind = "rectangle"
            add_shape(
                doc,
                page,
                kind,
                str(spec["id"]),
                float(props.get("x") or 0),
                float(props.get("y") or 0),
                float(props.get("width") or 10),
                float(props.get("height") or 10),
                fill=str(props.get("fill") if props.get("fill") is not None else "#888888"),
                text=str(props.get("text") or ""),
                locked=bool(props.get("locked")),
                text_color=props.get("textColor"),
            )

        controller = doc.getCurrentController()
        meta = state.get("meta") or {}
        active = meta.get("activeSlide")
        if isinstance(active, str) and active:
            _, page, _ = find(doc, active)
            controller.setCurrentPage(page)
        selection = state.get("selection") or []
        if selection:
            try:
                _, _, obj = find(doc, str(selection[0]))
                controller.select(obj)
            except Exception:
                controller.select(doc)
        else:
            controller.select(doc)
    finally:
        if locked:
            try:
                doc.unlockControllers()
            except Exception:
                pass


def export_png(ctx: Any, doc: Any, url: str) -> None:
    page = doc.getCurrentController().getCurrentPage()
    try:
        exporter = ctx.ServiceManager.createInstanceWithContext(
            "com.sun.star.drawing.GraphicExportFilter",
            ctx,
        )
        exporter.setSourceDocument(page)
        if exporter.filter(pv(URL=url, MediaType="image/png")):
            return
    except Exception:
        pass
    doc.storeToURL(url, pv(FilterName="impress_png_Export", Overwrite=True))


def bootstrap(ctx: Any, document: str | None, seed_board: Any) -> Any:
    desktop = desktop_of(ctx)
    close_all(desktop)
    if seed_board == "contrast":
        doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, pv(Hidden=True))
        seed_contrast(doc)
        return doc
    if seed_board:
        doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, pv(Hidden=True))
        seed(doc)
        return doc
    if not document:
        raise RuntimeError("bootstrap requires a document URL")
    return load_document(desktop, document)


def reply(payload: dict[str, Any]) -> None:
    sys.stdout.write("SCIR_JSON:" + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    raw = sys.stdin.read()
    request = json.loads(raw)
    method = request.get("method")

    try:
        ctx = connect(args.port)
        desktop = desktop_of(ctx)
        if method == "bootstrap":
            bootstrap(
                ctx,
                request.get("document"),
                request.get("seed"),
            )
            reply({"ok": True, "result": {"ready": True, **isolation(ctx)}})
            return 0
        if method == "isolate":
            reply({"ok": True, "result": isolation(ctx)})
            return 0
        if method == "shutdown":
            close_all(desktop)
            try:
                desktop.terminate()
            except Exception:
                pass
            reply({"ok": True, "result": {}})
            return 0

        doc = impress_doc(desktop)
        if doc is None:
            raise RuntimeError("no Impress document is open")
        if method == "snapshot":
            reply({"ok": True, "result": snapshot(doc)})
            return 0
        if method == "execute":
            execute(doc, request["action"])
            reply({"ok": True, "result": {}})
            return 0
        if method == "save":
            save_document(doc, str(request["url"]))
            reply({"ok": True, "result": {}})
            return 0
        if method == "export_png":
            export_png(ctx, doc, str(request["url"]))
            reply({"ok": True, "result": {}})
            return 0
        if method == "restore":
            apply_state(doc, request["state"])
            reply({"ok": True, "result": snapshot(doc)})
            return 0
        if method == "load":
            close_all(desktop)
            load_document(desktop, str(request["url"]))
            reply({"ok": True, "result": {}})
            return 0
        raise ValueError(f"unknown method {method}")
    except Exception as error:
        reply({"ok": False, "error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
