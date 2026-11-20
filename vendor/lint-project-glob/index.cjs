"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Both pinned consumers require a synchronous CommonJS entry.
const { globSync: findFiles, hasMagic } = require("glob");

const globOptions = new Set(["cwd", "absolute", "dot", "expandDirectories", "ignore"]);
const dynamicOptions = new Set(["caseSensitiveMatch"]);

function checkOptions(options, allowed) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("@edupi/lint-project-glob expects an options object");
  }
  for (const key of Reflect.ownKeys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(`@edupi/lint-project-glob does not support option ${String(key)}`);
    }
  }
}

function patternsOf(value, name) {
  const patterns = typeof value === "string" ? [value] : value;
  if (!Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === "string")) {
    throw new TypeError(`@edupi/lint-project-glob expects ${name} to be a string or an array of strings`);
  }
  return patterns.filter(pattern => pattern.length > 0);
}

function checkBoolean(options, key) {
  if (options[key] !== undefined && typeof options[key] !== "boolean") {
    throw new TypeError(`@edupi/lint-project-glob expects ${key} to be a boolean`);
  }
}

// A file cannot have descendants. Appending /** therefore expands directory
// matches without turning an ordinary file pattern into a basename search.
function withDescendants(patterns) {
  return patterns.flatMap(pattern => [pattern, `${pattern.replace(/\/+$/, "")}/**`]);
}

function globSync(patterns, options = {}) {
  checkOptions(options, globOptions);
  for (const key of ["absolute", "dot", "expandDirectories"]) checkBoolean(options, key);
  if (options.cwd !== undefined && typeof options.cwd !== "string"
    && !(options.cwd instanceof URL && options.cwd.protocol === "file:")) {
    throw new TypeError("@edupi/lint-project-glob expects cwd to be a path or file URL");
  }

  const positive = [];
  const ignored = options.ignore === undefined ? [] : patternsOf(options.ignore, "ignore");
  for (const pattern of patternsOf(patterns, "patterns")) {
    if (pattern.startsWith("!") && !pattern.startsWith("!(")) {
      if (pattern.length > 1) ignored.push(pattern.slice(1));
    } else {
      positive.push(pattern);
    }
  }
  if (positive.length === 0) return [];

  return findFiles(options.expandDirectories === false ? positive : withDescendants(positive), {
    cwd: options.cwd,
    absolute: options.absolute ?? false,
    dot: options.dot ?? false,
    nodir: true,
    follow: true,
    nocase: false,
    ignore: withDescendants(ignored),
  });
}

function isDynamicPattern(pattern, options = {}) {
  checkOptions(options, dynamicOptions);
  checkBoolean(options, "caseSensitiveMatch");
  if (typeof pattern !== "string") {
    throw new TypeError("@edupi/lint-project-glob expects one pattern string");
  }
  return pattern.startsWith("!") || hasMagic(pattern, {
    magicalBraces: true,
    nocase: options.caseSensitiveMatch === false,
  });
}

module.exports = { globSync, isDynamicPattern };
