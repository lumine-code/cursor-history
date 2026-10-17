const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Cursor history during project restoration", () => {
  let directory, roots, main, editor, item, command;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cursor-project-owner-")));
    roots = [path.join(directory, "a"), path.join(directory, "b")];
    roots.forEach((root) => fs.mkdirSync(root));
    const sourcePath = path.join(roots[0], "source.txt");
    fs.writeFileSync(sourcePath, "zero\none\ntwo\nthree\n");
    lumine.project.setPaths([roots[0]]);
    lumine.config.set("cursor-history.rowDeltaToRemember", 1);
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    editor = lumine.workspace.buildTextEditor();
    editor.getBuffer().setPath(sourcePath);
    editor.setText(fs.readFileSync(sourcePath, "utf8"));
    editor.setCursorBufferPosition([0, 0]);
    lumine.textEditors.add(editor, { role: "document" });
    const element = document.createElement("div");
    element.appendChild(editor.getElement());
    item = {
      getTitle: () => "Retained source editor",
      getURI: () => "lumine://cursor-history-audit-retained-source",
      getDefaultLocation: () => "right",
      getAllowedLocations: () => ["right"],
      getElement: () => element,
      getActiveEmbeddedTextEditor: () => editor,
      destroy: () => editor.destroy(),
    };
    const dock = lumine.workspace.getRightDock();
    dock.getActivePane().addItem(item);
    dock.getActivePane().activateItem(item);
    dock.show();
    editor.getElement().focus();
    expect(lumine.workspace.getFocusedTextEditor()).toBe(editor);
    command = lumine.commands.add(editor.getElement(), "audit:jump-source", () =>
      editor.setCursorBufferPosition([3, 0]),
    );
  });

  afterEach(async () => {
    command?.dispose();
    await lumine.packages.deactivatePackage("cursor-history");
    const pane = lumine.workspace.paneForItem(item);
    if (pane) await pane.destroyItem(item, true);
    else editor?.destroy();
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    const real = fs.realpathSync(directory);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith("cursor-project-owner-")
    )
      throw new Error("Unsafe cursor project fixture cleanup");
    fs.rmSync(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("records a deferred jump while the project remains current", async () => {
    lumine.commands.dispatch(editor.getElement(), "audit:jump-source");
    await conditionPromise(() => main.pendingTimeouts.size === 0);
    await main.saving;
    expect(main.workspaceState.get("history").entries.length).toBe(1);
  });

  it("retires an outgoing jump before incoming storage precedes its restored roots", async () => {
    lumine.commands.dispatch(editor.getElement(), "audit:jump-source");
    expect(main.pendingTimeouts.size).toBeGreaterThan(0);
    let reached, resume;
    const rebound = new Promise((resolve) => (reached = resolve));
    const held = new Promise((resolve) => (resume = resolve));
    const switchProject = lumine.packages.storage.switchProject.bind(lumine.packages.storage);
    spyOn(lumine.packages.storage, "switchProject").and.callFake(async (paths) => {
      await switchProject(paths);
      reached();
      await held;
    });
    const transition = lumine.project.setState([roots[1]]);
    try {
      await rebound;
      expect(lumine.project.getPaths()).toEqual([roots[0]]);
      expect(lumine.workspace.getFocusedTextEditor()).toBe(editor);
      await conditionPromise(() => main.pendingTimeouts.size === 0);
      await main.saving;
      expect(main.workspaceState.get("history")).toBeUndefined();
    } finally {
      resume();
      await transition;
    }
  });
});
