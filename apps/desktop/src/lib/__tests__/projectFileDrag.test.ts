import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dragFileTarget,
  PROJECT_ENTRY_DRAG_TYPE,
  readProjectEntryDrag,
  startNativeFileDrag,
} from "../projectFileDrag";

const entry = {
  folderId: "folder-1",
  projectId: "p1",
  relativePath: "out/report.md",
};

function installPine(runtime?: "web") {
  const pine = {
    ...(runtime ? { runtime } : {}),
    startProjectFileDrag: vi.fn(),
    startPresentedFileDrag: vi.fn(),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return pine;
}

function dragStart() {
  const data = new Map<string, string>();
  const transfer = {
    effectAllowed: "uninitialized",
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
  const event = new Event("dragstart", { cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return { event, transfer: transfer as unknown as DataTransfer };
}

describe("dragFileTarget", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "pine");
  });

  it("drags a project file as a tree entry and a native file", () => {
    const pine = installPine();
    const { event, transfer } = dragStart();

    dragFileTarget(event, { source: "project", ...entry });

    expect(readProjectEntryDrag(transfer)).toEqual([entry]);
    expect(transfer.effectAllowed).toBe("copyMove");
    expect(event.defaultPrevented).toBe(true);
    expect(pine.startProjectFileDrag).toHaveBeenCalledWith(entry);
  });

  it("keeps the browser drag of a project file on the web", () => {
    const pine = installPine("web");
    const { event, transfer } = dragStart();

    dragFileTarget(event, { source: "project", ...entry });

    expect(transfer.types).toContain(PROJECT_ENTRY_DRAG_TYPE);
    expect(event.defaultPrevented).toBe(false);
    expect(pine.startProjectFileDrag).not.toHaveBeenCalled();
  });

  it("drags a presented file natively by its path", () => {
    const pine = installPine();
    const { event, transfer } = dragStart();

    dragFileTarget(event, { source: "presented", path: "/tmp/report.md" });

    expect(transfer.types).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(pine.startPresentedFileDrag).toHaveBeenCalledWith({
      path: "/tmp/report.md",
    });
  });

  it("cancels dragging a presented file on the web", () => {
    const pine = installPine("web");
    const { event } = dragStart();

    dragFileTarget(event, { source: "presented", path: "/tmp/report.md" });

    expect(event.defaultPrevented).toBe(true);
    expect(pine.startPresentedFileDrag).not.toHaveBeenCalled();
  });
});

describe("startNativeFileDrag", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "pine");
  });

  it("starts the native drag for either source", () => {
    const pine = installPine();

    startNativeFileDrag({ source: "project", ...entry });
    startNativeFileDrag({ source: "presented", path: "/tmp/a.md" });

    expect(pine.startProjectFileDrag).toHaveBeenCalledWith(entry);
    expect(pine.startPresentedFileDrag).toHaveBeenCalledWith({
      path: "/tmp/a.md",
    });
  });
});
