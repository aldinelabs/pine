import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  archiveProperties,
  dbfProperties,
  drawioProperties,
  excalidrawProperties,
  mermaidProperties,
  mindMapProperties,
  zipComment,
} from "../structure";

describe("structure properties", () => {
  it("reads a ZIP file's comment", async () => {
    const zip = new JSZip().file("a.txt", "a");
    const bytes = await zip.generateAsync({
      type: "uint8array",
      comment: "Release build",
    });
    expect(zipComment(bytes)).toBe("Release build");
    expect(
      zipComment(
        await new JSZip().file("a", "a").generateAsync({ type: "uint8array" }),
      ),
    ).toBe("");
    expect(zipComment(new Uint8Array(40))).toBeUndefined();
  });

  it("totals an archive's entries and marks it encrypted", () => {
    expect(
      archiveProperties(
        {
          entries: [
            { path: "a", size: 1024 },
            { path: "b", size: 512 },
          ],
          encrypted: true,
        },
        "en-US",
      ),
    ).toEqual([
      { key: "entries", type: "number", value: 2 },
      { key: "uncompressedSize", value: "1.5 KB" },
      { key: "encrypted", type: "boolean", value: true },
    ]);
    expect(archiveProperties({ encrypted: false }, "en-US")).toEqual([]);
  });

  it("reads the editor of a draw.io and Excalidraw file", () => {
    expect(
      drawioProperties(
        '<mxfile host="Electron" modified="2024-01-02T03:04:05.000Z" version="21.6.5"><diagram/></mxfile>',
      ),
    ).toEqual([
      { key: "application", value: "draw.io 21.6.5" },
      {
        key: "documentModified",
        type: "date",
        value: "2024-01-02T03:04:05.000Z",
      },
    ]);
    expect(drawioProperties("<svg/>")).toEqual([]);
    expect(
      excalidrawProperties(
        '{"type":"excalidraw","source":"https://excalidraw.com"}',
      ),
    ).toEqual([{ key: "application", value: "excalidraw.com" }]);
    expect(excalidrawProperties("{")).toEqual([]);
  });

  it("reads a Mermaid title from front matter or a title line", () => {
    expect(
      mermaidProperties("---\ntitle: Flow\n---\nflowchart LR\n A-->B"),
    ).toEqual([{ key: "title", value: "Flow" }]);
    expect(mermaidProperties('pie\n  title Pets\n  "Dogs": 3')).toEqual([
      { key: "title", value: "Pets" },
    ]);
    expect(mermaidProperties("flowchart LR\n A-->B")).toEqual([]);
  });

  it("counts a mind map's topics across sheets", () => {
    const sheet = {
      root: {
        data: { text: "Plan" },
        children: [
          { data: { text: "A" } },
          { data: { text: "B" }, children: [{ data: {} }] },
        ],
      },
    };
    expect(mindMapProperties([sheet, { root: { data: {} } }])).toEqual([
      { key: "title", value: "Plan" },
      { key: "topics", type: "number", value: 5 },
      { key: "sheets", type: "number", value: 2 },
    ]);
  });

  it("reads a DBF table's format and last update", () => {
    const header = new Uint8Array(32);
    header.set([0x03, 124, 5, 9]);
    expect(dbfProperties(header.buffer)).toEqual([
      { key: "version", value: "dBASE III" },
      { key: "documentModified", value: "2024-05-09" },
    ]);
  });
});
