import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'JesseGoodier.good-branch-manager';

suite('Extension integration', () => {
  test('extension is present and activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Expected extension ${EXTENSION_ID} to be loaded`);
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);
  });

  test('registers the branches tree view command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('goodBranchManager.refresh'));
    assert.ok(commands.includes('goodBranchManager.checkout'));
    assert.ok(commands.includes('goodBranchManager.pullDefault'));
  });
});
