import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', timeout: 60_000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    glob('*.test.js', { cwd: testsRoot })
      .then((files) => {
        files.forEach((file) => mocha.addFile(path.resolve(testsRoot, file)));
        try {
          mocha.run((failures) => {
            if (failures > 0) {
              reject(new Error(`${failures} integration test(s) failed.`));
            } else {
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      })
      .catch(reject);
  });
}
