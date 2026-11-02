/** Minimal subprocess environment for the code-generation caller only.
 * This reduces accidental inheritance; it is not an OS sandbox or secret boundary.
 */
export function codegenAgentEnvironment(source: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  if (!source.ANTHROPIC_API_KEY) throw new Error("Missing required agent credential");
  return {
    NODE_ENV: source.NODE_ENV,
    PATH: source.PATH,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    TZ: source.TZ,
    HOME: home,
    TMPDIR: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_CACHE_HOME: `${home}/.cache`,
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
  };
}
