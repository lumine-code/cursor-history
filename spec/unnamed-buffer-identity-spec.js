const { Point } = require("lumine");

describe("Cursor History unnamed buffer identity", () => {
  let main, first, second, sibling, history;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    first = await lumine.workspace.open();
    second = await lumine.workspace.open();
    first.setText("first\nline\nline\nline\nlast");
    second.setText("second\nline\nline\nline\nlast");
    expect(first.getURI()).toBeUndefined();
    expect(second.getURI()).toBeUndefined();
    first.setCursorBufferPosition([4, 0]);
    second.setCursorBufferPosition([4, 0]);
  });

  afterEach(async () => {
    first?.destroy();
    second?.destroy();
    sibling?.destroy();
    if (lumine.packages.isPackageActive("cursor-history"))
      await lumine.packages.deactivatePackage("cursor-history");
    if (lumine.packages.isPackageLoaded("cursor-history"))
      await lumine.packages.unloadPackage("cursor-history");
    await lumine.fileWatchClient.settlePendingTeardown();
    main = first = second = sibling = history = null;
  });

  async function recordAndReturn(single, enableAfterRecord = false) {
    lumine.config.set("cursor-history.keepSingleEntryPerBuffer", single);
    lumine.config.set("cursor-history.flashOnLand", false);
    history = main.getHistory();
    history.add({ editor: first, point: new Point(0, 0) });
    history.add({ editor: second, point: new Point(1, 0) });
    if (enableAfterRecord) lumine.config.set("cursor-history.keepSingleEntryPerBuffer", true);
    expect(history.getValidEntries().map(({ editor }) => editor)).toEqual([first, second]);
    lumine.workspace.getActivePane().activateItem(first);
    spyOn(history, "jump").and.callThrough();
    lumine.commands.dispatch(first.getElement(), "cursor-history:prev-within-editor");
    expect(history.jump).toHaveBeenCalledTimes(1);
    await history.jump.calls.mostRecent().returnValue;
    expect(lumine.workspace.getActiveTextEditor()).toBe(first);
    expect(first.getCursorBufferPosition().toArray()).toEqual([0, 0]);
  }

  it("keeps each unnamed editor reachable with the one-entry option enabled", async () => {
    await recordAndReturn(true);
  });

  it("keeps ordinary unnamed history when the one-entry option is disabled", async () => {
    await recordAndReturn(false);
  });

  it("preserves distinct unnamed buffers when the option is enabled for existing history", async () => {
    await recordAndReturn(false, true);
  });

  it("keeps one entry for two actual split editors sharing an unnamed buffer", async () => {
    lumine.workspace.getActivePane().activateItem(first);
    sibling = (
      await lumine.workspace.copyPaneItem(lumine.workspace.getActivePane().getActiveItem(), {
        sourcePane: lumine.workspace.getActivePane(),
        splitDirection: "right",
      })
    ).pane.getActiveItem();
    expect(sibling.getBuffer()).toBe(first.getBuffer());
    expect(sibling.getURI()).toBeUndefined();
    lumine.config.set("cursor-history.keepSingleEntryPerBuffer", true);
    history = main.getHistory();
    history.add({ editor: first, point: new Point(0, 0) });
    history.add({ editor: sibling, point: new Point(1, 0) });
    expect(history.getValidEntries().map(({ editor }) => editor)).toEqual([sibling]);
  });
});
