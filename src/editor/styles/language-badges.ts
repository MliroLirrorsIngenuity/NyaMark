/**
 * Colour + monogram badges for the code-block language picker.
 *
 * Crepe renders each row as `<li class="language-list-item" data-language="TypeScript">Name</li>`
 * where the label is a plain Vue text node. Its `renderLanguage` hook returns a
 * string that Vue escapes, so markup injected there renders literally -- the
 * `data-language` attribute is the only usable hook, hence CSS rules instead of
 * a render override.
 *
 * Entries are `[name, monogram, background, foreground?]`; `name` must match
 * `LanguageDescription.name` from @codemirror/language-data exactly. Colours are
 * the languages' own brand/linguist colours, because recognising a row by colour
 * is much faster than reading it at 12px.
 *
 * Only the common languages are listed. @codemirror/language-data ships ~150,
 * and the long tail deliberately falls back to a neutral grey badge so the
 * everyday ones stand out instead of drowning in a wall of colour.
 */
type Badge = [
  name: string,
  monogram: string,
  background: string,
  foreground?: string,
];

const LANGUAGE_BADGES: Badge[] = [
  // The first block of @codemirror/language-data, i.e. the everyday languages.
  ['C', 'C', '#a8b9cc', '#16202b'], // stays clear of the fallback grey

  ['C++', 'C+', '#00599c'],
  ['CQL', 'CQ', '#1287b1'],
  ['CSS', 'CS', '#1572b6'],
  ['Go', 'Go', '#00add8'],
  ['HTML', '<>', '#e34c26'],
  ['Java', 'Jv', '#e76f00'],
  ['JavaScript', 'JS', '#f7df1e', '#1b1b1b'],
  ['Jinja', 'Ji', '#b41717'],
  ['JSON', '{}', '#cbcb41', '#1b1b1b'],
  ['JSX', 'JX', '#61dafb', '#0f2b33'],
  ['LESS', 'Le', '#1d365d'],
  ['Liquid', 'Lq', '#4f9ec4'],
  ['MariaDB SQL', 'Ma', '#003545'],
  ['Markdown', 'MD', '#519aba'],
  ['MS SQL', 'MS', '#cc2927'],
  ['MySQL', 'My', '#00758f'],
  ['PHP', 'Ph', '#777bb4'],
  ['PLSQL', 'PL', '#c74634'],
  ['PostgreSQL', 'Pg', '#336791'],
  ['Python', 'Py', '#3776ab'],
  ['Rust', 'Rs', '#ce422b'],
  ['Sass', 'Sa', '#cf649a'],
  ['SCSS', 'SS', '#c6538c'],
  ['SQL', 'SQ', '#e38c00'],
  ['SQLite', 'Sl', '#0f80cc'],
  ['TSX', 'TX', '#3178c6'],
  ['TypeScript', 'TS', '#3178c6'],
  ['WebAssembly', 'Wa', '#654ff0'],
  ['XML', 'XM', '#f1662a'],
  ['YAML', 'YM', '#cb171e'],

  // Common enough in the long tail to be worth colouring.
  ['C#', 'C#', '#68217a'],
  ['Clojure', 'Cl', '#5881d8'],
  ['ClojureScript', 'CJ', '#5881d8'],
  ['CMake', 'Cm', '#064f8c'],
  ['CoffeeScript', 'Cf', '#6f4e37'],
  ['Common Lisp', 'Ls', '#3fb68b'],
  ['Crystal', 'Cr', '#3b3b3b'],
  ['D', 'D', '#ba595e'],
  ['Dart', 'Da', '#0175c2'],
  ['diff', '±', '#4d9a4d'],
  ['Dockerfile', 'Dk', '#2496ed'],
  ['Elm', 'Em', '#60b5cc', '#0f2b33'],
  ['Erlang', 'Er', '#a90533'],
  ['F#', 'F#', '#b845fc'],
  ['Fortran', 'Fo', '#734f96'],
  ['Groovy', 'Gr', '#4298b8'],
  ['Haskell', 'Hs', '#5e5086'],
  ['Haxe', 'Hx', '#df7900'],
  ['HTTP', 'Ht', '#005c9c'],
  ['Julia', 'Jl', '#9558b2'],
  ['Kotlin', 'Kt', '#7f52ff'],
  ['LaTeX', 'LT', '#008080'],
  ['Lua', 'Lu', '#2c2d72'],
  ['Nginx', 'Ng', '#009639'],
  ['Objective-C', 'OC', '#438eff'],
  ['Objective-C++', 'O+', '#438eff'],
  ['OCaml', 'Ml', '#ef7a08'],
  ['Pascal', 'Pa', '#c7b53f', '#1b1b1b'],
  ['Perl', 'Pl', '#39457e'],
  ['PowerShell', 'PS', '#5391fe'],
  ['ProtoBuf', 'Pb', '#4285f4'],
  ['Pug', 'Pg', '#a86454'],
  ['Puppet', 'Pp', '#ffae1a', '#1b1b1b'],
  ['R', 'R', '#276dc3'],
  ['Ruby', 'Rb', '#cc342d'],
  ['Scala', 'Sc', '#dc322f'],
  ['Scheme', 'Sm', '#1e4aec'],
  ['Shell', '>_', '#4eaa25'],
  ['Smalltalk', 'St', '#596706'],
  ['Swift', 'Sw', '#f05138'],
  ['Tcl', 'Tc', '#c9a44b', '#1b1b1b'],
  ['TOML', 'TL', '#9c4221'],
  ['Turtle', 'Tt', '#77bb44'],
  ['VB.NET', 'VB', '#945db7'],
  ['Verilog', 'Vl', '#8f96e0'],
  ['VHDL', 'Vh', '#8b90a8'],
  ['Vue', 'Vu', '#42b883'],
];

const SELECTOR_PREFIX =
  '.ny-editor-root .milkdown .milkdown-code-block .language-list-item';

/**
 * One custom-property-only rule per language. The badge geometry lives in a
 * single `::before` rule in crepe-overrides so these stay ~70 bytes each.
 */
export const languageBadgeCss = LANGUAGE_BADGES.map(
  ([name, monogram, background, foreground]) =>
    `${SELECTOR_PREFIX}[data-language="${name}"]{--ny-lang-label:'${monogram}';--ny-lang-bg:${background}${
      foreground ? `;--ny-lang-fg:${foreground}` : ''
    }}`
).join('\n');
