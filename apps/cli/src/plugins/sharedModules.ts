// Module resolve hooks, registered by PluginScanner before it imports a
// plugin. They resolve the packages the CLI shares with plugins from the CLI's
// own position, wherever the importing plugin is installed.
const SHARED = [
  '@chronicle.app/auth',
  '@chronicle.app/etl',
  '@chronicle.app/etl-sqlite',
  '@chronicle.app/logging',
  '@chronicle.app/schema',
];

/** Whether `specifier` names a package the CLI shares with plugins. */
export const isShared = (specifier: string) =>
  SHARED.some(name => specifier === name || specifier.startsWith(`${name}/`));

let parentURL: string;

export async function initialize(data: { parentURL: string }): Promise<void> {
  parentURL = data.parentURL;
}

export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (specifier: string, context: { parentURL?: string }) => Promise<unknown>
): Promise<unknown> {
  if (isShared(specifier)) {
    return nextResolve(specifier, { ...context, parentURL });
  }
  return nextResolve(specifier, context);
}
