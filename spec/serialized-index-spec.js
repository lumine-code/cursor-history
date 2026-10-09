const fs = require("fs");
const os = require("os");
const path = require("path");

describe("Cursor history indexes after serialization filters closed editors", () => {
  let root, editors, history, restored;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      spyOn(lumine.shell, method).and.resolveTo();
    }
    spyOn(lumine.application, "openWindow").and.resolveTo();
    lumine.config.set("cursor-history.excludeClosedBuffer", true);
    lumine.config.set("cursor-history.flashOnLand", false);
    jasmine.attachToDOM(lumine.workspace.getElement());
    const main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    history = main.getHistory();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-history-index-")));
    editors = [];
    for (const name of ["first", "second", "third"]) {
      const file = path.join(root, `${name}.txt`);
      fs.writeFileSync(file, "first row\nsecond row\nthird row\n");
      const editor = await lumine.workspace.open(file);
      editors.push(editor);
      history.add({ editor, point: editor.getCursorBufferPosition() });
    }
    editors[2].setCursorBufferPosition([2, 0]);
  });

  afterEach(async () => {
    restored?.destroy();
    for (const editor of editors ?? []) if (!editor.isDestroyed()) editor.destroy();
    if (lumine.packages.isPackageLoaded("cursor-history")) {
      await lumine.packages.deactivatePackage("cursor-history");
    }
    if (!root) return;
    const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("History fixture cleanup must remain within its owned temporary directory.");
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("keeps the head sentinel within the filtered history", async () => {
    editors[0].destroy();
    const state = history.serialize();
    expect(state.entries.length).toBe(2);
    expect(state.index).toBe(2);
    restored = history.constructor.deserialize(state);
    await restored.jump(editors[2], "prev");
    expect(editors[2].getCursorBufferPosition()).toEqual([0, 0]);
  });

  it("preserves the selected history entry when a preceding entry is filtered", async () => {
    await history.jump(editors[2], "prev");
    editors[0].destroy();
    const state = history.serialize();
    expect(state.entries.length).toBe(3);
    expect(state.index).toBe(1);
    restored = history.constructor.deserialize(state);
    await restored.jump(editors[2], "prev");
    expect(lumine.workspace.getActiveTextEditor()).toBe(editors[1]);
  });
});
