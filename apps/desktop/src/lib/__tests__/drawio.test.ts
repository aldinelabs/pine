import { describe, expect, it } from "vitest";
import {
  labelText,
  parseStyle,
  readDrawioPages,
  renderDrawioPage,
} from "../drawio";

const model = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="group" value="" style="swimlane;startSize=20;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="200" height="120" as="geometry"/>
  </mxCell>
  <mxCell id="a" value="&lt;b&gt;Start&lt;/b&gt;" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="group">
    <mxGeometry x="20" y="40" width="80" height="40" as="geometry"/>
  </mxCell>
  <mxCell id="b" value="End" style="ellipse;" vertex="1" parent="1">
    <mxGeometry x="400" y="140" width="80" height="40" as="geometry"/>
  </mxCell>
  <mxCell id="e" style="endArrow=block;dashed=1;" edge="1" parent="1" source="a" target="b">
    <mxGeometry relative="1" as="geometry"/>
  </mxCell>
  <mxCell id="label" value="yes" style="edgeLabel;" vertex="1" connectable="0" parent="e">
    <mxGeometry x="-0.2" relative="1" as="geometry"/>
  </mxCell>
  <mxCell id="hidden" value="secret" vertex="1" parent="1" visible="0">
    <mxGeometry x="900" y="900" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel>`;

async function deflated(text: string): Promise<string> {
  const stream = new Blob([encodeURIComponent(text)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}

describe("drawio", () => {
  it("reads plain and compressed pages", async () => {
    const pages = await readDrawioPages(
      `<mxfile><diagram name="One">${model}</diagram><diagram name="Two">${await deflated(model)}</diagram></mxfile>`,
    );
    expect(pages.map((page) => page.name)).toEqual(["One", "Two"]);
    expect(pages[1].model.localName).toBe("mxGraphModel");
  });

  it("draws shapes in place, edges with their labels, and skips hidden cells", async () => {
    const [page] = await readDrawioPages(model);
    const svg = new DOMParser().parseFromString(
      renderDrawioPage(page),
      "image/svg+xml",
    ).documentElement;
    // The child of the swimlane is placed relative to it.
    const start = Array.from(svg.querySelectorAll("rect")).find(
      (rect) => rect.getAttribute("fill") === "#dae8fc",
    );
    expect([start?.getAttribute("x"), start?.getAttribute("y")]).toEqual([
      "120",
      "140",
    ]);
    expect(start?.getAttribute("rx")).toBeTruthy();
    expect(svg.querySelector("ellipse")).not.toBeNull();
    const edge = svg.querySelector("polyline")!;
    expect(edge.getAttribute("stroke-dasharray")).toBe("3 3");
    expect(edge.getAttribute("marker-end")).toMatch(/^url\(#m\d\)$/);
    expect(svg.textContent).toContain("Start");
    expect(svg.textContent).toContain("yes");
    expect(svg.textContent).not.toContain("secret");
  });

  it("parses styles and HTML labels", () => {
    expect(parseStyle("ellipse;whiteSpace=wrap;fillColor=#fff;")).toEqual({
      shape: "ellipse",
      whiteSpace: "wrap",
      fillColor: "#fff",
    });
    expect(labelText("<div>One</div><div>Two<br>Three</div>")).toBe(
      "One\nTwo\nThree",
    );
  });

  it("rejects files without pages", async () => {
    await expect(readDrawioPages("<mxfile/>")).rejects.toThrow();
    await expect(readDrawioPages("<broken")).rejects.toThrow();
  });
});
