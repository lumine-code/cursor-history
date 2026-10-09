const path = require("node:path");

describe("Cursor history pending jump lifetime", () => {
  let main, editor, history;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
    editor.setText(Array.from({ length: 30 }, (_, row) => `line ${row}`).join("\n"));
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    history = main.getHistory();
    for (const row of [1, 8]) {
      editor.setCursorBufferPosition([row, 0]);
      history.add({ editor, point: editor.getCursorBufferPosition(), URI: editor.getURI() });
    }
    editor.setCursorBufferPosition([15, 0]);
  });

  function holdRealOpens() {
    const open = lumine.workspace.open.bind(lumine.workspace);
    const releases = [];
    spyOn(lumine.workspace, "open").and.callFake(async (...args) => {
      const result = await open(...args);
      await new Promise((resolve) => releases.push(resolve));
      return result;
    });
    return releases;
  }

  it("does not restore a retired entry or flash after package off/on", async () => {
    const releases = holdRealOpens();
    const landing = spyOn(history, "land").and.callThrough();
    const jumping = history.jump(editor, "prev");
    await conditionPromise(() => releases.length === 1, "history open completed");
    await lumine.packages.deactivatePackage("cursor-history");
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;

    releases[0]();
    await expectAsync(jumping).toBeResolved();

    expect(landing).not.toHaveBeenCalled();
    expect(editor.getCursorBufferPosition()).toEqual([15, 0]);
    expect(main.history).toBeNull();
  });

  it("keeps the newest jump when real opens complete in reverse order", async () => {
    const releases = holdRealOpens();
    const first = history.jump(editor, "prev");
    await conditionPromise(() => releases.length === 1, "first history open completed");
    const second = history.jump(editor, "prev");
    await conditionPromise(() => releases.length === 2, "second history open completed");
    releases[1]();
    await second;
    expect(editor.getCursorBufferPosition()).toEqual([1, 0]);

    releases[0]();
    await first;

    expect(editor.getCursorBufferPosition()).toEqual([1, 0]);
    expect(history.index).toBe(0);
  });

  it("discards an obsolete open failure after deactivation", async () => {
    let reject;
    spyOn(lumine.workspace, "open").and.returnValue(
      new Promise((_resolve, fail) => (reject = fail)),
    );
    const jumping = history.jump(editor, "prev");
    await lumine.packages.deactivatePackage("cursor-history");

    reject(new Error("old open failure"));

    await expectAsync(jumping).toBeResolved();
  });

  it("preserves a live open failure", async () => {
    const error = new Error("live open failure");
    spyOn(lumine.workspace, "open").and.returnValue(Promise.reject(error));
    await expectAsync(history.jump(editor, "prev")).toBeRejectedWith(error);
  });

  it("skips cursor restoration when an actual URI opener returns a non-text pane item", async () => {
    const uri = path.join(__dirname, "fixtures", "sample-1.js");
    editor.getBuffer().setPath(uri);
    editor.destroy();
    const currentEditor = await lumine.workspace.open();
    const paneItem = {
      getTitle: () => "Alternative view",
      getURI: () => uri,
      getElement: () => element,
    };
    const element = document.createElement("div");
    const opener = lumine.workspace.addOpener((target) => (target === uri ? paneItem : undefined));
    try {
      await expectAsync(history.jump(currentEditor, "prev")).toBeResolved();
      expect(lumine.workspace.getActivePaneItem()).toBe(paneItem);
    } finally {
      opener.dispose();
      await lumine.workspace.paneForItem(paneItem)?.destroyItem(paneItem);
    }
  });
});
