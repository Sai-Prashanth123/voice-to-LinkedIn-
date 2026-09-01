/**
 * How to run the `claude` command, on any of the three platforms.
 *
 * WHY THIS IS NOT JUST THE STRING "claude"
 *
 * On Windows npm installs a `claude.cmd` launcher, and a .cmd file cannot be started by
 * CreateProcess — the thing Node's execFile and spawn use. So it has to go through the command
 * processor. The obvious way is `shell: true`, which Node deprecates (DEP0190) for a good reason:
 * with a shell, arguments are concatenated into one string rather than escaped, so anything
 * containing a space or a quote changes the command being run. The prompts this passes are long
 * English sentences containing both.
 *
 * Invoking cmd.exe explicitly and handing it an argument ARRAY keeps the escaping that shell:true
 * throws away.
 *
 * Written once here because install.mjs and work.mjs both need it, and a fix applied to one of
 * them would be a fix that quietly did not reach the other.
 */

/**
 * @param {string[]} args Arguments for the claude command itself.
 * @returns {{ file: string, args: string[] }} Ready for execFile or spawn, with no shell option.
 */
export function claudeCommand(args = []) {
  if (process.platform === "win32") {
    const shell = process.env.ComSpec || "cmd.exe";
    // /d skips AutoRun scripts, /s /c is the documented form for passing a command through.
    return { file: shell, args: ["/d", "/s", "/c", "claude", ...args] };
  }
  return { file: "claude", args };
}
