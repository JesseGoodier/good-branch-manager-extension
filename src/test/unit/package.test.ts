import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('package.json contributions', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')
  ) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      menus: {
        commandPalette: Array<{ command: string; when: string }>;
        'view/item/context': Array<{ command: string; group: string; when: string }>;
      };
    };
  };

  test('registers core branch commands', () => {
    const commands = new Set(pkg.contributes.commands.map((command) => command.command));
    for (const id of [
      'goodBranchManager.checkout',
      'goodBranchManager.createPullRequest',
      'goodBranchManager.pullBranch',
      'goodBranchManager.refresh'
    ]) {
      assert.ok(commands.has(id), `missing command ${id}`);
    }
  });

  test('keeps tree commands out of the command palette', () => {
    const hidden = new Set(
      pkg.contributes.menus.commandPalette
        .filter((entry) => entry.when === 'false')
        .map((entry) => entry.command)
    );
    assert.ok(hidden.has('goodBranchManager.checkout'));
    assert.ok(hidden.has('goodBranchManager.pullBranch'));
  });

  test('scopes context menu items to the branches view', () => {
    for (const entry of pkg.contributes.menus['view/item/context']) {
      assert.match(entry.when, /view == goodBranchManager\.branches/);
      assert.ok(entry.group.length > 0);
    }
  });
});
