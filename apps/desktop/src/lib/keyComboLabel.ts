/**
 * Display label for a key press an agent asked for, such as press_key's
 * `key: "t", modifiers: ["cmd", "shift"]` → "⇧ + ⌘ + T" on macOS and
 * "Shift + Win + T" elsewhere. The key may also carry its own modifiers
 * ("cmd+a"), as browser_press_key accepts.
 */

type Modifier = "fn" | "ctrl" | "alt" | "shift" | "cmd";

const MODIFIER_ALIASES: Record<string, Modifier> = {
  fn: "fn",
  function: "fn",
  ctrl: "ctrl",
  control: "ctrl",
  ctl: "ctrl",
  "⌃": "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  "⌥": "alt",
  shift: "shift",
  "⇧": "shift",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "cmd",
  win: "cmd",
  windows: "cmd",
  "⌘": "cmd",
};

/** macOS order: ⌃ ⌥ ⇧ ⌘; elsewhere Ctrl, Alt, Shift, Win. */
const MODIFIER_ORDER: readonly Modifier[] = [
  "fn",
  "ctrl",
  "alt",
  "shift",
  "cmd",
];

const MAC_MODIFIER_LABELS: Record<Modifier, string> = {
  fn: "fn",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  cmd: "⌘",
};

const OTHER_MODIFIER_LABELS: Record<Modifier, string> = {
  fn: "Fn",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  cmd: "Win",
};

const NAMED_KEYS: Record<string, string> = {
  tab: "Tab",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  spacebar: "Space",
  " ": "Space",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  forwarddelete: "Forward Delete",
  fwddelete: "Forward Delete",
  deleteforward: "Forward Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pgup: "Page Up",
  pagedown: "Page Down",
  pgdn: "Page Down",
  pgdown: "Page Down",
  up: "↑",
  uparrow: "↑",
  arrowup: "↑",
  down: "↓",
  downarrow: "↓",
  arrowdown: "↓",
  left: "←",
  leftarrow: "←",
  arrowleft: "←",
  right: "→",
  rightarrow: "→",
  arrowright: "→",
  minus: "-",
  equal: "=",
  leftbracket: "[",
  rightbracket: "]",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  comma: ",",
  period: ".",
  slash: "/",
  grave: "`",
  numpadadd: "Num +",
  numpadsubtract: "Num -",
  numpadmultiply: "Num *",
  numpaddivide: "Num /",
  numpaddecimal: "Num .",
};

function keyLabel(key: string, mac: boolean): string {
  const lower = key.toLowerCase();
  if (lower === "return" || lower === "enter") return mac ? "Return" : "Enter";
  if (lower === "numpadenter") return mac ? "Num Return" : "Num Enter";
  const named = NAMED_KEYS[lower];
  if (named) return named;
  const fKey = /^f(\d{1,2})$/u.exec(lower);
  if (fKey) return `F${fKey[1]}`;
  const numpad = /^numpad(\d)$/u.exec(lower);
  if (numpad) return `Num ${numpad[1]}`;
  if ([...key].length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Splits "cmd+shift+t" into its parts; "+" and "cmd++" keep the plus key. */
function splitCombo(key: string): string[] {
  if (key === "+" || !key.includes("+")) return [key];
  const parts = key.split("+").map((part) => part.trim());
  if (parts.at(-1) === "") {
    parts.pop();
    while (parts.at(-1) === "") parts.pop();
    parts.push("+");
  }
  return parts.filter(Boolean);
}

export function formatKeyCombo(
  key: string,
  modifiers: readonly unknown[] = [],
  platform: string = "darwin",
): string {
  const mac = platform === "darwin";
  const held = new Set<Modifier>();
  const names = [
    ...modifiers.filter((value): value is string => typeof value === "string"),
  ];
  const parts = splitCombo(key.trim() || key);
  const main = parts.at(-1) ?? key;
  names.push(...parts.slice(0, -1));
  const unknown: string[] = [];
  for (const name of names) {
    const modifier = MODIFIER_ALIASES[name.trim().toLowerCase()];
    if (modifier) held.add(modifier);
    else if (name.trim()) unknown.push(name.trim());
  }
  const labels = mac ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS;
  const mainModifier = MODIFIER_ALIASES[main.toLowerCase()];
  // A bare modifier press ("shift") shows as that modifier.
  if (mainModifier && !held.has(mainModifier)) held.add(mainModifier);
  const segments = [
    ...MODIFIER_ORDER.filter((modifier) => held.has(modifier)).map(
      (modifier) => labels[modifier],
    ),
    ...unknown.map((name) => keyLabel(name, mac)),
  ];
  if (!mainModifier) segments.push(keyLabel(main, mac));
  return segments.join(" + ");
}
