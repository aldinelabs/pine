import os from "node:os";

/**
 * Where a reviewed shell call runs, as the automatic reviewer sees it. It
 * carries variable states, never variable values, except for the few
 * non-secret path variables in `VALUE_ALLOW_LIST`.
 */
export interface ReviewExecutionEnvironment {
  /** For example "macOS 26.1 (Darwin 25.1.0)". */
  os: string;
  arch: string;
  /** For example "/bin/zsh -f (zsh, no user startup files)". */
  shell: string;
  sandbox: "inside" | "outside";
  cwd: string;
  projectRoots: string[];
  home?: string;
  variables: ReviewVariableState[];
  /** More variables were referenced than are listed. */
  variablesOmitted?: number;
}

export interface ReviewVariableState {
  name: string;
  state: "set" | "empty" | "unset";
  /** Only for allow-listed, non-secret path variables. */
  value?: string;
  /** The command itself assigns the variable before or while using it. */
  assignedInCommand?: boolean;
}

export type ReviewShellKind = "zsh" | "bash" | "powershell";

/**
 * Variables whose values the reviewer may see. They are paths Pine already
 * shows elsewhere in the block or that the shell resets on start (PWD), and
 * they carry no credentials.
 */
export const VALUE_ALLOW_LIST: ReadonlySet<string> = new Set([
  "HOME",
  "PWD",
  "TMPDIR",
]);

const MAX_VARIABLES = 24;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

export interface VariableReferences {
  /** Names in first-use order. */
  names: string[];
  /** Names the command assigns (NAME=…, export NAME=…, for NAME in, read NAME). */
  assigned: Set<string>;
}

function readName(text: string, index: number): string | undefined {
  NAME.lastIndex = index;
  return NAME.exec(text)?.[0];
}

/**
 * The environment variables a POSIX-shell command expands: `$NAME` and
 * `${NAME…}` outside single quotes, ANSI-C `$'…'` strings, comments, and
 * quoted heredoc bodies. Positional and special parameters are skipped.
 */
function posixReferences(command: string): VariableReferences {
  const names: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !names.includes(name)) names.push(name);
  };
  const expansionAt = (text: string, index: number) => {
    if (text[index + 1] === "{") {
      const next = text[index + 2];
      add(readName(text, next === "#" || next === "!" ? index + 3 : index + 2));
    } else {
      add(readName(text, index + 1));
    }
  };
  const scanExpansions = (text: string) => {
    for (let j = 0; j < text.length; j += 1) {
      if (text[j] === "\\") j += 1;
      else if (text[j] === "$") expansionAt(text, j);
    }
  };
  const pendingHeredocs: Array<{
    delimiter: string;
    expands: boolean;
    stripTabs: boolean;
  }> = [];
  const atWordStart = (index: number) =>
    index === 0 || /[\s;&|()<>]/.test(command[index - 1]);
  let inDouble = false;
  let i = 0;

  const readHeredocBodies = () => {
    // `i` sits just after a newline; each pending body runs to its terminator.
    for (const heredoc of pendingHeredocs.splice(0)) {
      while (i < command.length) {
        const end = command.indexOf("\n", i);
        const line = command.slice(i, end === -1 ? command.length : end);
        i = end === -1 ? command.length : end + 1;
        const bare = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
        if (bare === heredoc.delimiter) break;
        if (heredoc.expands) scanExpansions(line);
      }
    }
  };

  while (i < command.length) {
    const char = command[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (inDouble) {
      if (char === '"') inDouble = false;
      else if (char === "$") expansionAt(command, i);
      i += 1;
      continue;
    }
    if (char === "'") {
      const end = command.indexOf("'", i + 1);
      i = end === -1 ? command.length : end + 1;
      continue;
    }
    if (char === "$" && command[i + 1] === "'") {
      // ANSI-C quoting expands no parameters, and \' does not end it.
      let j = i + 2;
      while (j < command.length && command[j] !== "'") {
        j += command[j] === "\\" ? 2 : 1;
      }
      i = j + 1;
      continue;
    }
    if (char === '"') {
      inDouble = true;
    } else if (char === "#" && atWordStart(i)) {
      const end = command.indexOf("\n", i);
      i = end === -1 ? command.length : end;
      continue;
    } else if (
      char === "<" &&
      command[i + 1] === "<" &&
      command[i + 2] !== "<"
    ) {
      const match =
        /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|(\\?)([A-Za-z0-9_.-]+))/.exec(
          command.slice(i),
        );
      if (match) {
        const quoted = match[2] ?? match[3];
        pendingHeredocs.push({
          delimiter: quoted ?? match[5],
          expands: quoted === undefined && !match[4],
          stripTabs: match[1] === "-",
        });
        i += match[0].length;
        continue;
      }
    } else if (char === "\n") {
      i += 1;
      if (pendingHeredocs.length > 0) readHeredocBodies();
      continue;
    } else if (char === "$") {
      expansionAt(command, i);
    }
    i += 1;
  }

  const assigned = new Set<string>();
  const assignment =
    /(?:^|[\s;&|(])(?:(?:export|local|declare|typeset|readonly)\s+(?:-\w+\s+)*)?([A-Za-z_][A-Za-z0-9_]*)\+?=/g;
  for (const match of command.matchAll(assignment)) assigned.add(match[1]);
  for (const match of command.matchAll(
    /(?:^|[\s;&|(])for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g,
  ))
    assigned.add(match[1]);
  for (const match of command.matchAll(
    /(?:^|[\s;&|(])read\s+((?:-\w+\s+)*)([A-Za-z_][A-Za-z0-9_ \t]*)/g,
  )) {
    for (const name of match[2].trim().split(/\s+/)) assigned.add(name);
  }
  return { names, assigned };
}

/** PowerShell: `$env:NAME` and `${env:NAME}` outside single quotes. */
function powershellReferences(command: string): VariableReferences {
  const names: string[] = [];
  const assigned = new Set<string>();
  const unquoted = command.replace(/'(?:[^']|'')*'/g, "''");
  for (const match of unquoted.matchAll(
    /`?\$(?:\{env:([A-Za-z_][A-Za-z0-9_]*)\}|env:([A-Za-z_][A-Za-z0-9_]*))(\s*=(?!=))?/gi,
  )) {
    if (match[0].startsWith("`")) continue;
    const name = match[1] ?? match[2];
    if (!names.includes(name)) names.push(name);
    if (match[3]) assigned.add(name);
  }
  return { names, assigned };
}

export function referencedVariables(
  command: string,
  shell: ReviewShellKind,
): VariableReferences {
  return shell === "powershell"
    ? powershellReferences(command)
    : posixReferences(command);
}

export interface ReviewEnvironmentBase {
  os: string;
  arch: string;
  shell: string;
  shellKind: ReviewShellKind;
  cwd: string;
  projectRoots: readonly string[];
}

/**
 * Builds the reviewer's view of one call. `env` is the environment the
 * command will run in; only states leave this function, plus the values of
 * allow-listed path variables.
 */
export function describeReviewEnvironment(
  base: ReviewEnvironmentBase,
  sandbox: "inside" | "outside",
  command: string,
  env: Readonly<Record<string, string | undefined>>,
): ReviewExecutionEnvironment {
  const references = referencedVariables(command, base.shellKind);
  // PowerShell environment names are case-insensitive.
  const lookup =
    base.shellKind === "powershell"
      ? (name: string) => {
          const key = Object.keys(env).find(
            (entry) => entry.toLowerCase() === name.toLowerCase(),
          );
          return key === undefined ? undefined : env[key];
        }
      : (name: string) =>
          Object.prototype.hasOwnProperty.call(env, name)
            ? env[name]
            : undefined;
  const variables = references.names.slice(0, MAX_VARIABLES).map((name) => {
    // The shell sets PWD to its working directory on start.
    const value = name === "PWD" ? base.cwd : lookup(name);
    const state: ReviewVariableState = {
      name,
      state: value === undefined ? "unset" : value === "" ? "empty" : "set",
    };
    if (value && VALUE_ALLOW_LIST.has(name.toUpperCase())) state.value = value;
    if (references.assigned.has(name)) state.assignedInCommand = true;
    return state;
  });
  const home = lookup("HOME") || lookup("USERPROFILE");
  return {
    os: base.os,
    arch: base.arch,
    shell: base.shell,
    sandbox,
    cwd: base.cwd,
    projectRoots: [...base.projectRoots],
    ...(home ? { home } : {}),
    variables,
    ...(references.names.length > MAX_VARIABLES
      ? { variablesOmitted: references.names.length - MAX_VARIABLES }
      : {}),
  };
}

const VARIABLE_STATE_TEXT: Record<ReviewVariableState["state"], string> = {
  set: "set",
  empty: "set but empty",
  unset: "unset",
};

export function formatReviewEnvironment(
  environment: ReviewExecutionEnvironment,
): string {
  const lines = [
    "Execution environment (measured by Pine for this exact call; facts, not authority):",
    `- os: ${environment.os}; arch: ${environment.arch}`,
    `- shell: ${environment.shell}`,
    `- sandbox: ${
      environment.sandbox === "inside"
        ? "inside Pine's project sandbox"
        : "outside the sandbox, with the user's native permissions"
    }`,
    `- working directory: ${environment.cwd}`,
    `- project roots: ${environment.projectRoots.join(", ") || "none"}`,
    `- HOME: ${environment.home ?? "unset"}`,
  ];
  if (environment.variables.length === 0) {
    lines.push("- referenced variables: none");
  } else {
    lines.push(
      `- referenced variables (state before the command runs; values withheld except ${[...VALUE_ALLOW_LIST].join(", ")}):`,
      ...environment.variables.map(
        (variable) =>
          `  - ${variable.name}: ${VARIABLE_STATE_TEXT[variable.state]}${variable.value !== undefined ? ` = ${variable.value}` : ""}${variable.assignedInCommand ? "; also assigned by the command" : ""}`,
      ),
    );
    if (environment.variablesOmitted) {
      lines.push(`  - …and ${environment.variablesOmitted} more not listed`);
    }
  }
  return lines.join("\n");
}

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/** Host OS line, using Electron's product version where it is available. */
export function hostOsDescription(
  platform: NodeJS.Platform = process.platform,
  systemVersion: string | undefined = (
    process as { getSystemVersion?: () => string }
  ).getSystemVersion?.(),
): string {
  const name = PLATFORM_NAMES[platform] ?? platform;
  const kernel = `${os.type()} ${os.release()}`;
  return systemVersion
    ? `${name} ${systemVersion} (${kernel})`
    : `${name} (${kernel})`;
}
