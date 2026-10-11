const { Point } = require("lumine");

describe("Cursor jumps preserve unnamed buffer identity", () => {
  let main, first, second, sibling, history;
  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    lumine.config.set("cursor-history.flashOnLand", false);
    first = await lumine.workspace.open();
    second = await lumine.workspace.open();
    first.setText("first\nline\nline\nline\nlast");
    second.setText("second\nline\nline\nline\nlast");
    first.setCursorBufferPosition([4, 0]);
    second.setCursorBufferPosition([4, 0]);
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded("cursor-history"))
      await lumine.packages.unloadPackage("cursor-history");
    first?.destroy();
    second?.destroy();
    sibling?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    main = first = second = sibling = history = null;
  });

  for (const single of [false, true]) {
    it(`keeps distinct buffers at the same position with single-entry mode ${single}`, async () => {
      lumine.config.set("cursor-history.keepSingleEntryPerBuffer", single);
      history = main.getHistory();
      history.add({ editor: first, point: new Point(0, 0) });
      history.add({ editor: second, point: new Point(0, 0) });
      expect(history.getValidEntries().map((entry) => entry.editor)).toEqual([first, second]);
      await lumine.commands.dispatch(first.getElement(), "cursor-history:prev-within-editor");
      expect(first.getCursorBufferPosition().toArray()).toEqual([0, 0]);
      expect(second.getCursorBufferPosition().toArray()).toEqual([4, 0]);
      expect(history.getValidEntries().some((entry) => entry.editor === second)).toBe(true);
    });
  }

  it("still keeps the newest duplicate for split editors sharing one buffer", async () => {
    lumine.config.set("cursor-history.keepSingleEntryPerBuffer", false);
    const pane = lumine.workspace.paneForItem(first);
    pane.activateItem(first);
    sibling = pane.splitRight({ copyActiveItem: true }).getActiveItem();
    expect(sibling.getBuffer()).toBe(first.getBuffer());
    history = main.getHistory();
    history.add({ editor: first, point: new Point(0, 0) });
    const older = history.getValidEntries().at(-1);
    history.add({ editor: sibling, point: new Point(0, 0) });
    const latest = history.getValidEntries().at(-1);
    await lumine.commands.dispatch(first.getElement(), "cursor-history:prev");
    expect(older.destroyed).toBe(true);
    expect(latest.isValid()).toBe(true);
    expect(lumine.workspace.getActiveTextEditor()).toBe(sibling);
    expect(sibling.getCursorBufferPosition().toArray()).toEqual([0, 0]);
  });
});
