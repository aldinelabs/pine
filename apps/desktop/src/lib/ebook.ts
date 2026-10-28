/**
 * E-books as a list of chapters for Pine's reader: EPUB (read with JSZip),
 * FictionBook, UMD and compiled HTML help (CHM). A chapter loads its HTML
 * when opened, with its images and styles inlined, since the reader frame
 * reaches no network or files.
 */
import { dataUrl } from "./htmlSandbox";

export interface EbookChapter {
  title: string;
  depth: number;
  load: () => Promise<string>;
}

export interface Ebook {
  title?: string;
  author?: string;
  chapters: EbookChapter[];
  close?: () => void;
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function resolvePath(base: string, href: string): string {
  const url = new URL(href, `https://book/${base}`);
  return decodeURIComponent(url.pathname.slice(1));
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  css: "text/css",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
const mimeOf = (path: string) =>
  MIME[path.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream";

export async function readEpub(buffer: ArrayBuffer): Promise<Ebook> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const text = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`The book has no ${path}.`);
    return file.async("string");
  };
  const xml = (
    source: string,
    type: DOMParserSupportedType = "application/xml",
  ) => new DOMParser().parseFromString(source, type);
  const container = xml(await text("META-INF/container.xml"));
  const opfPath = container
    .querySelector("rootfile")
    ?.getAttribute("full-path");
  if (!opfPath) throw new Error("The book has no package document.");
  const opf = xml(await text(opfPath));
  const manifest = new Map<
    string,
    { href: string; type: string; properties: string }
  >();
  for (const item of Array.from(opf.getElementsByTagName("item")))
    manifest.set(item.getAttribute("id") ?? "", {
      href: resolvePath(opfPath, item.getAttribute("href") ?? ""),
      type: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  const spine = Array.from(opf.getElementsByTagName("itemref"))
    .map((ref) => manifest.get(ref.getAttribute("idref") ?? "")?.href)
    .filter((href): href is string => Boolean(href));
  const metadata = (name: string) =>
    Array.from(opf.getElementsByTagName("*"))
      .find((element) => element.localName === name)
      ?.textContent?.trim() || undefined;

  /** Inlines a chapter's images and style sheets as data URLs. */
  async function loadChapter(path: string): Promise<string> {
    const document = xml(await text(path), "application/xhtml+xml");
    const parsed = document.querySelector("parsererror")
      ? xml(await text(path), "text/html")
      : document;
    const inline = async (resource: string) => {
      const file = zip.file(resource);
      return file
        ? dataUrl(await file.async("uint8array"), mimeOf(resource))
        : undefined;
    };
    for (const image of Array.from(parsed.querySelectorAll("img[src]"))) {
      const url = await inline(resolvePath(path, image.getAttribute("src")!));
      if (url) image.setAttribute("src", url);
      else image.removeAttribute("src");
    }
    for (const image of Array.from(parsed.getElementsByTagName("*")).filter(
      (element) => element.localName === "image",
    )) {
      const href =
        image.getAttribute("href") ?? image.getAttribute("xlink:href");
      const url = href ? await inline(resolvePath(path, href)) : undefined;
      if (url) {
        image.setAttribute("href", url);
        image.removeAttribute("xlink:href");
      }
    }
    for (const link of Array.from(
      parsed.querySelectorAll('link[rel~="stylesheet"][href]'),
    )) {
      const cssPath = resolvePath(path, link.getAttribute("href")!);
      const file = zip.file(cssPath);
      if (!file) {
        link.remove();
        continue;
      }
      let css = await file.async("string");
      const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(
        (match) => match[1],
      );
      for (const url of new Set(urls)) {
        if (/^(data|https?):/.test(url)) continue;
        const inlined = await inline(resolvePath(cssPath, url));
        if (inlined) css = css.split(url).join(inlined);
      }
      const style = parsed.createElement("style");
      style.textContent = css;
      link.replaceWith(style);
    }
    for (const script of Array.from(parsed.querySelectorAll("script")))
      script.remove();
    return new XMLSerializer().serializeToString(parsed);
  }

  // Titles come from the navigation document (EPUB 3) or the NCX (EPUB 2).
  const titles = new Map<string, { title: string; depth: number }>();
  const nav = [...manifest.values()].find((item) =>
    item.properties.split(" ").includes("nav"),
  );
  if (nav) {
    const document = xml(await text(nav.href), "application/xhtml+xml");
    const toc =
      Array.from(document.getElementsByTagName("nav")).find(
        (element) =>
          element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ===
          "toc",
      ) ?? document.getElementsByTagName("nav")[0];
    for (const link of Array.from(toc?.getElementsByTagName("a") ?? [])) {
      const href = link.getAttribute("href");
      if (!href) continue;
      let depth = 0;
      for (
        let node = link.parentElement;
        node && node !== toc;
        node = node.parentElement
      )
        if (node.localName === "ol") depth++;
      const target = resolvePath(nav.href, href.split("#")[0]);
      if (!titles.has(target))
        titles.set(target, {
          title: link.textContent?.trim() ?? "",
          depth: Math.max(0, depth - 1),
        });
    }
  } else {
    const ncx = [...manifest.values()].find(
      (item) => item.type === "application/x-dtbncx+xml",
    );
    if (ncx) {
      const document = xml(await text(ncx.href));
      for (const point of Array.from(
        document.getElementsByTagName("navPoint"),
      )) {
        const src = point
          .getElementsByTagName("content")[0]
          ?.getAttribute("src");
        if (!src) continue;
        let depth = 0;
        for (
          let node = point.parentElement;
          node?.localName === "navPoint";
          node = node.parentElement
        )
          depth++;
        const target = resolvePath(ncx.href, src.split("#")[0]);
        if (!titles.has(target))
          titles.set(target, {
            title:
              point.getElementsByTagName("text")[0]?.textContent?.trim() ?? "",
            depth,
          });
      }
    }
  }
  return {
    title: metadata("title"),
    author: metadata("creator"),
    chapters: spine.map((path, index) => ({
      title: titles.get(path)?.title || `${index + 1}`,
      depth: titles.get(path)?.depth ?? 0,
      load: () => loadChapter(path),
    })),
  };
}

export async function readFb2(buffer: ArrayBuffer): Promise<Ebook> {
  const { parseFb2Book } = await import("@file-viewer/renderer-epub");
  const book = parseFb2Book(buffer);
  const image = (id: string) => {
    const found = book.images.get(id);
    return found
      ? `<img src="${dataUrl(found.bytes, found.mimeType)}" alt="">`
      : "";
  };
  type Chapter = (typeof book.chapters)[number];
  const flatten = (chapters: Chapter[], depth: number): EbookChapter[] =>
    chapters.flatMap((chapter) => [
      {
        title: chapter.title,
        depth,
        load: () =>
          Promise.resolve(
            `<h2>${escape(chapter.title)}</h2>${chapter.imageIds.map(image).join("")}${chapter.paragraphs
              .map((paragraph) => `<p>${escape(paragraph)}</p>`)
              .join("")}`,
          ),
      },
      ...flatten(chapter.children, depth + 1),
    ]);
  const intro: EbookChapter[] =
    book.annotation || book.coverImageId
      ? [
          {
            title: book.title,
            depth: 0,
            load: () =>
              Promise.resolve(
                `${book.coverImageId ? image(book.coverImageId) : ""}<h1>${escape(book.title)}</h1><p>${escape(book.authors.join(", "))}</p>${book.annotation ? `<p>${escape(book.annotation)}</p>` : ""}`,
              ),
          },
        ]
      : [];
  return {
    title: book.title,
    author: book.authors.join(", ") || undefined,
    chapters: [...intro, ...flatten(book.chapters, 0)],
  };
}

export async function readUmd(buffer: ArrayBuffer): Promise<Ebook> {
  const { parseUmdBook } = await import("@file-viewer-internal/umd-parser");
  const book = parseUmdBook(buffer);
  return {
    title: book.title,
    author: book.author || undefined,
    chapters: book.chapters.map((chapter) => ({
      title: chapter.title,
      depth: 0,
      load: () =>
        Promise.resolve(
          `<h2>${escape(chapter.title)}</h2>${chapter.images
            .map(
              (item) =>
                `<img src="${dataUrl(item.bytes, item.mimeType)}" alt="">`,
            )
            .join("")}${chapter.content
            .split(/\n+/)
            .filter((line) => line.trim())
            .map((line) => `<p>${escape(line.trim())}</p>`)
            .join("")}`,
        ),
    })),
  };
}

/** Compiled HTML help, read by file-viewer's CHM worker. */
export async function readChm(buffer: ArrayBuffer): Promise<Ebook> {
  const [chm, security] = await Promise.all([
    import("@file-viewer/renderer-chm"),
    import("@file-viewer/renderer-chm/security"),
  ]);
  const base = new URL("file-viewer/vendor/chm/", document.baseURI).href;
  const client = new chm.ChmWorkerClient({
    workerUrl: `${base}chm.worker.js`,
    wasmModuleUrl: `${base}chm_wasm.js`,
    wasmUrl: `${base}chm_wasm_bg.wasm`,
  });
  try {
    const { manifest } = await client.open(buffer);
    const encoding = manifest.encoding;
    const inline = async (path: string) =>
      dataUrl(await client.read(path), mimeOf(path));
    async function loadTopic(path: string): Promise<string> {
      const source = chm.decodeChmText(await client.read(path), encoding);
      const page = chm.sanitizeChmHtmlDocument(source, path);
      let html = page.html;
      for (const resource of new Set(page.resourcePaths)) {
        let url: string;
        if (resource.toLowerCase().endsWith(".css")) {
          const css = security.sanitizeChmCss(
            chm.decodeChmText(await client.read(resource), encoding),
            resource,
          );
          let rewritten = css.css;
          for (const nested of new Set(css.resourcePaths))
            rewritten = rewritten
              .split(`${chm.CHM_INTERNAL_RESOURCE_SCHEME}${nested}`)
              .join(await inline(nested).catch(() => ""));
          url = dataUrl(new TextEncoder().encode(rewritten), "text/css");
        } else url = await inline(resource).catch(() => "");
        html = html
          .split(`${chm.CHM_INTERNAL_RESOURCE_SCHEME}${resource}`)
          .join(url);
      }
      return html;
    }
    type Node = (typeof manifest.contents)[number];
    const flatten = (nodes: Node[], depth: number): EbookChapter[] =>
      nodes.flatMap((node) => [
        ...(node.path
          ? [{ title: node.title, depth, load: () => loadTopic(node.path!) }]
          : []),
        ...flatten(node.children, depth + (node.path ? 1 : 0)),
      ]);
    let chapters = flatten(manifest.contents, 0);
    if (!chapters.length)
      chapters = manifest.topics.map((topic) => ({
        title: topic.title,
        depth: 0,
        load: () => loadTopic(topic.path),
      }));
    if (!chapters.length && manifest.homePath)
      chapters = [
        {
          title: manifest.title,
          depth: 0,
          load: () => loadTopic(manifest.homePath),
        },
      ];
    return { title: manifest.title, chapters, close: () => client.destroy() };
  } catch (error) {
    client.destroy();
    throw error;
  }
}
