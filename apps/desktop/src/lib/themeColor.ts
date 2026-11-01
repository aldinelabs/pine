/**
 * Browsers tint their own chrome, and an installed Pine its status bar, with
 * the `theme-color` meta tag. It follows the page background so the bar
 * matches Pine's chosen theme rather than only the system's light or dark mode.
 */
export function syncThemeColor(): void {
  const root = document.documentElement;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  function apply(): void {
    const background = getComputedStyle(document.body).backgroundColor;
    // Some browsers only read hex or rgb, so resolve oklch through a canvas.
    let color = background;
    if (context) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      color = `rgb(${red}, ${green}, ${blue})`;
    }
    for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
      meta.remove();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.append(meta);
  }

  apply();
  new MutationObserver(apply).observe(root, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}
