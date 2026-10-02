/**
 * How the operator should type the next command.
 *
 * `npx` runs the package from a throwaway cache and puts nothing on PATH, so
 * telling an npx user to type `cca-agent status` sends them to "command not
 * found". Detect that and echo back the form that will actually work.
 */
const script = process.argv[1] ?? "";
const viaNpx = process.env.npm_command === "exec" || /[\\/]_npx[\\/]/.test(script) || /[\\/]dlx[^\\/]*[\\/]/.test(script);

export const CMD = viaNpx ? "npx @hammerock/cca-agent@latest" : "cca-agent";
