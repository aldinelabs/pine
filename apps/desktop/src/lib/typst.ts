/**
 * Typst documents compiled in the renderer with typst.ts. The compiler gets
 * the text fonts file-viewer publishes and, for documents with CJK text, the
 * Sarasa Gothic SC that Pine already ships: Typst reads only TrueType and
 * OpenType, so the WOFF2 files are decoded to TrueType first.
 */
import type { TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";
import sarasaBoldUrl from "@/assets/fonts/SarasaGothicSC-Bold.woff2?url";
import sarasaRegularUrl from "@/assets/fonts/SarasaGothicSC-Regular.woff2?url";

export interface TypstPage {
  width: number;
  height: number;
  /** A standalone SVG document for the page. */
  svg: string;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** CJK ideographs, kana, Hangul, and full-width forms and punctuation. */
const CJK_TEXT = /[⺀-⿟　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

export function hasCjkText(source: string): boolean {
  return CJK_TEXT.test(source);
}

async function decodeWoff2(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to read a font (${response.status}).`);
  const { default: decompress } = await import("woff2-encoder/decompress");
  return decompress(await response.arrayBuffer());
}

/**
 * Fonts are fixed once a compiler starts, so documents with and without CJK
 * text get separate compilers; Latin-only ones skip decoding Sarasa.
 */
const engines = new Map<boolean, Promise<TypstSnippet>>();

function engine(cjk: boolean): Promise<TypstSnippet> {
  let created = engines.get(cjk);
  if (!created) {
    created = createEngine(cjk);
    engines.set(cjk, created);
    created.catch(() => engines.delete(cjk));
  }
  return created;
}

async function createEngine(cjk: boolean): Promise<TypstSnippet> {
  const [{ MemoryAccessModel }, { TypstSnippet }, sarasa] = await Promise.all([
    import("@myriaddreamin/typst.ts"),
    import("@myriaddreamin/typst.ts/contrib/snippet"),
    cjk
      ? Promise.all([decodeWoff2(sarasaRegularUrl), decodeWoff2(sarasaBoldUrl)])
      : Promise.resolve([]),
  ]);
  const base = new URL("file-viewer/wasm/typst/", document.baseURI).href;
  // A snippet of its own, unlike the shared `$typst`, fetches no packages
  // from the network: imports of Typst Universe packages fail instead.
  const snippet = new TypstSnippet();
  snippet.use(
    TypstSnippet.withAccessModel(new MemoryAccessModel()),
    TypstSnippet.preloadFontAssets({
      assets: ["text"],
      assetUrlPrefix: { text: `${base}fonts/`, _: `${base}fonts/` },
    }),
    ...(sarasa.length ? [TypstSnippet.preloadFonts(sarasa)] : []),
  );
  snippet.setCompilerInitOptions({
    getModule: () => `${base}typst_ts_web_compiler_bg.wasm`,
  });
  snippet.setRendererInitOptions({
    getModule: () => `${base}typst_ts_renderer_bg.wasm`,
  });
  return snippet;
}

/** Compiles a single-file Typst document to one SVG with every page. */
export async function compileTypst(source: string): Promise<string> {
  const snippet = await engine(hasCjkText(source));
  // The interactive script typst.ts adds by default is not valid XML, and
  // pages shown as images would not run it anyway.
  return snippet.svg({
    mainContent: source,
    data_selection: { body: true, defs: true, css: true, js: false },
  });
}

const numberAttribute = (element: Element, name: string) =>
  Number.parseFloat(element.getAttribute(name) ?? "") || 0;

/**
 * Splits typst.ts's document SVG into standalone pages, each carrying the
 * shared glyph definitions and styles.
 */
export function splitTypstPages(svg: string): TypstPage[] {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.namespaceURI !== SVG_NAMESPACE || root.localName !== "svg")
    throw new Error("Typst produced no SVG.");
  const shared = Array.from(root.children).filter(
    (child) => child.localName === "defs" || child.localName === "style",
  );
  const width =
    numberAttribute(root, "data-width") || numberAttribute(root, "width");
  const height =
    numberAttribute(root, "data-height") || numberAttribute(root, "height");
  const groups = Array.from(root.getElementsByTagName("g")).filter((group) =>
    group.classList.contains("typst-page"),
  );
  const serializer = new XMLSerializer();
  if (!groups.length)
    return [{ width, height, svg: serializer.serializeToString(root) }];
  return groups.map((group) => {
    const pageWidth = numberAttribute(group, "data-page-width") || width;
    const pageHeight = numberAttribute(group, "data-page-height") || height;
    const page = parsed.createElementNS(SVG_NAMESPACE, "svg");
    page.setAttribute("viewBox", `0 0 ${pageWidth} ${pageHeight}`);
    page.setAttribute("width", String(pageWidth));
    page.setAttribute("height", String(pageHeight));
    for (const node of shared) page.append(node.cloneNode(true));
    const content = group.cloneNode(true) as Element;
    content.removeAttribute("transform");
    page.append(content);
    return {
      width: pageWidth,
      height: pageHeight,
      svg: serializer.serializeToString(page),
    };
  });
}

/**
 * The compiler rejects with its diagnostics as Rust debug text; this keeps
 * each diagnostic's message.
 */
export function typstErrorMessages(reason: unknown): string[] {
  const text = reason instanceof Error ? reason.message : String(reason);
  const messages = [...text.matchAll(/message: "((?:[^"\\]|\\.)*)"/g)].map(
    (match) => match[1].replace(/\\(.)/g, "$1"),
  );
  return messages.length ? [...new Set(messages)] : [text.trim()];
}
