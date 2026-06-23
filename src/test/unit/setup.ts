import Module from 'module';

const originalRequire = Module.prototype.require;

Module.prototype.require = function (this: NodeRequire, id: string) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: unknown) => defaultValue
        })
      },
      extensions: {
        getExtension: () => undefined
      }
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return originalRequire.apply(this, arguments as any);
};
