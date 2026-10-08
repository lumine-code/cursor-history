const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

describe("cursor-history", () => {
  let commandDisposable;
  let editor;
  let editorElement;
  let main;
  let sampleOne;
  let sampleTwo;
  let tempDir;
  let temporaryEditors;
  const tempRoot = fs.realpathSync(os.tmpdir());

  beforeEach(async () => {
    tempDir = null;
    temporaryEditors = new Set();
    sampleOne = path.join(__dirname, "fixtures", "sample-1.js");
    sampleTwo = path.join(__dirname, "fixtures", "sample-2.js");
    jasmine.attachToDOM(lumine.workspace.getElement());

    commandDisposable = lumine.commands.add("lumine-text-editor", {
      "test:move-down-five"() {
        this.getModel().moveDown(5);
      },
    });

    const pack = await lumine.packages.activatePackage("cursor-history");
    main = pack.mainModule;
    editor = await lumine.workspace.open(sampleOne);
    editorElement = editor.element;
  });

  afterEach(() => {
    commandDisposable.dispose();
    for (const temporaryEditor of temporaryEditors) {
      if (!temporaryEditor.isDestroyed()) temporaryEditor.destroy();
    }
    if (tempDir) {
      expect(path.dirname(path.resolve(tempDir))).toBe(path.resolve(tempRoot));
      expect(path.basename(tempDir).startsWith("cursor-history-spec-")).toBe(true);
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  async function openTemporaryEditor() {
    tempDir ??= fs.mkdtempSync(path.join(tempRoot, "cursor-history-spec-"));
    const filePath = path.join(tempDir, "source.txt");
    fs.writeFileSync(filePath, "zero\none\nsecond\nthird\n");
    const temporaryEditor = await lumine.workspace.open(filePath);
    temporaryEditor.setCursorBufferPosition([1, 2]);
    temporaryEditors.add(temporaryEditor);
    return temporaryEditor;
  }

  it("creates history lazily", () => {
    expect(main.history).toBeFalsy();
    expect(main.getHistory().entries).toEqual([]);
  });

  it("records a cursor position after a command moves far enough", () => {
    editor.setCursorBufferPosition([1, 3]);
    lumine.commands.dispatch(editorElement, "test:move-down-five");
    advanceClock(100);

    expect(main.history.entries).toHaveLength(1);
    expect(main.history.entries[0].point).toEqual([1, 3]);
    expect(main.history.entries[0].URI).toBe(sampleOne);
  });

  it("does not record movement below the configured threshold", () => {
    editor.setCursorBufferPosition([1, 0]);
    lumine.commands.dispatch(editorElement, "core:move-down");
    advanceClock(100);
    expect(main.history).toBeFalsy();
  });

  it("finishes tracking against the actually focused embedded editor", () => {
    const embeddedEditor = {};
    const location = {
      computeNeedToSave: jasmine.createSpy("computeNeedToSave").and.returnValue(false),
    };
    spyOn(lumine.workspace, "getFocusedTextEditor").and.returnValue(embeddedEditor);
    spyOn(lumine.workspace, "getActiveTextEditor").and.returnValue(editor);

    main.checkLocationChange(location, 100);
    advanceClock(100);

    expect(location.computeNeedToSave).toHaveBeenCalledWith(embeddedEditor, {
      rowDelta: main.rowDeltaToRemember,
      columnDelta: main.columnDeltaToRemember,
    });
  });

  it("navigates backward and forward within an editor", async () => {
    const history = main.getHistory();
    editor.setCursorBufferPosition([1, 0]);
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });
    editor.setCursorBufferPosition([6, 0]);
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });
    editor.setCursorBufferPosition([11, 0]);

    await history.jump(editor, "prev", editor);
    expect(editor.getCursorBufferPosition()).toEqual([6, 0]);
    await history.jump(editor, "prev", editor);
    expect(editor.getCursorBufferPosition()).toEqual([1, 0]);
    await history.jump(editor, "next", editor);
    expect(editor.getCursorBufferPosition()).toEqual([6, 0]);
  });

  it("uses the active editor when a menu command starts outside an editor", async () => {
    const panelButton = document.createElement("button");
    lumine.workspace.getElement().appendChild(panelButton);
    const history = main.getHistory();
    spyOn(history, "jump").and.returnValue(Promise.resolve());

    await lumine.commands.dispatch(panelButton, "cursor-history:prev");

    expect(history.jump).toHaveBeenCalledWith(editor, "prev", undefined);
    panelButton.remove();
  });

  it("activates the existing editor when navigating across files", async () => {
    const history = main.getHistory();
    editor.setCursorBufferPosition([4, 2]);
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });

    const secondEditor = await lumine.workspace.open(sampleTwo);
    secondEditor.setCursorBufferPosition([8, 0]);
    const open = spyOn(lumine.workspace, "open").and.callThrough();
    await history.jump(secondEditor, "prev");

    expect(lumine.workspace.getActiveTextEditor()).toBe(editor);
    expect(editor.getCursorBufferPosition()).toEqual([4, 2]);
    expect(open).toHaveBeenCalledWith(editor, { searchAllPanes: true });
  });

  it("reopens a closed file when its entry is visited", async () => {
    const history = main.getHistory();
    const secondEditor = await lumine.workspace.open(sampleTwo);
    secondEditor.setCursorBufferPosition([6, 1]);
    history.add({
      editor: secondEditor,
      point: secondEditor.getCursorBufferPosition(),
      URI: sampleTwo,
    });
    secondEditor.destroy();
    lumine.workspace.getActivePane().activateItem(editor);

    await history.jump(editor, "prev");
    const reopened = lumine.workspace.getActiveTextEditor();
    expect(reopened.getURI()).toBe(sampleTwo);
    expect(reopened.getCursorBufferPosition()).toEqual([6, 1]);
  });

  it("serializes valid entries and restores their points", () => {
    const history = main.getHistory();
    editor.setCursorBufferPosition([3, 4]);
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });

    const state = main.serialize();
    expect(state.history.entries).toEqual([{ point: [3, 4], URI: sampleOne }]);
    expect(state.history.index).toBe(1);
  });

  it("deserializes an entry whose URI is open as a non-editor pane item", async () => {
    const uri = "cursor-history-spec://preview";
    const opener = lumine.workspace.addOpener((itemURI) => {
      if (itemURI === uri) {
        return {
          element: document.createElement("div"),
          getURI: () => uri,
          getTitle: () => "Preview",
        };
      }
    });

    try {
      await lumine.workspace.open(uri);
      main.state = { history: { index: 1, entries: [{ point: [2, 1], URI: uri }] } };
      const history = main.getHistory();

      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].editor).toBeUndefined();
      expect(history.entries[0].point).toEqual([2, 1]);
    } finally {
      opener.dispose();
    }
  });

  it("clears entries and their markers", () => {
    const history = main.getHistory();
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });
    const entry = history.entries[0];
    history.clear();

    expect(history.entries).toEqual([]);
    expect(entry.destroyed).toBe(true);
  });

  describe("renamed and saved history targets", () => {
    for (const operation of ["rename", "save-as"]) {
      it(`follows ${operation} through serialization and closing/reopening`, async () => {
        const source = await openTemporaryEditor();
        const history = main.getHistory();
        history.add({
          editor: source,
          point: source.getCursorBufferPosition(),
          URI: source.getURI(),
        });
        const entry = history.entries[0];
        const targetPath = path.join(tempDir, "target.txt");

        if (operation === "rename") {
          fs.renameSync(source.getPath(), targetPath);
          source.getBuffer().setPath(targetPath);
        } else {
          await source.saveAs(targetPath);
        }
        const targetURI = source.getURI();
        expect(entry.URI).toBe(targetURI);
        expect(history.serialize().entries).toEqual([{ point: [1, 2], URI: targetURI }]);
        source.destroy();
        expect(entry.isValid()).toBe(true);
        expect(history.serialize().entries).toEqual([{ point: [1, 2], URI: targetURI }]);
        lumine.workspace.getActivePane().activateItem(editor);

        await history.jump(editor, "prev");

        const reopened = lumine.workspace.getActiveTextEditor();
        temporaryEditors.add(reopened);
        expect(reopened.getURI()).toBe(targetURI);
        expect(reopened.getCursorBufferPosition()).toEqual([1, 2]);
      });
    }

    it("restores the renamed URI after the package generation is unloaded", async () => {
      const source = await openTemporaryEditor();
      const history = main.getHistory();
      history.add({
        editor: source,
        point: source.getCursorBufferPosition(),
        URI: source.getURI(),
      });
      const targetPath = path.join(tempDir, "renamed.txt");
      fs.renameSync(source.getPath(), targetPath);
      source.getBuffer().setPath(targetPath);
      const targetURI = source.getURI();
      source.destroy();
      const state = main.serialize();
      expect(state.history.entries).toEqual([{ point: [1, 2], URI: targetURI }]);

      await lumine.packages.deactivatePackage("cursor-history");
      ({ mainModule: main } = await lumine.packages.activatePackage("cursor-history"));
      main.state = state;
      const restored = main.getHistory();
      expect(restored.entries).toHaveLength(1);
      expect(restored.entries[0].URI).toBe(targetURI);
      lumine.workspace.getActivePane().activateItem(editor);

      await restored.jump(editor, "prev");

      const reopened = lumine.workspace.getActiveTextEditor();
      temporaryEditors.add(reopened);
      expect(reopened.getURI()).toBe(targetURI);
      expect(reopened.getCursorBufferPosition()).toEqual([1, 2]);
    });

    it("retains an untitled position after its first save and closing", async () => {
      tempDir = fs.mkdtempSync(path.join(tempRoot, "cursor-history-spec-"));
      const source = await lumine.workspace.open();
      temporaryEditors.add(source);
      source.setText("zero\none\nsecond\n");
      source.setCursorBufferPosition([1, 2]);
      const history = main.getHistory();
      history.add({
        editor: source,
        point: source.getCursorBufferPosition(),
        URI: source.getURI(),
      });
      const entry = history.entries[0];

      await source.saveAs(path.join(tempDir, "first-save.txt"));
      const targetURI = source.getURI();
      source.destroy();

      expect(entry.destroyed).toBe(false);
      expect(entry.isValid()).toBe(true);
      expect(history.serialize().entries).toEqual([{ point: [1, 2], URI: targetURI }]);
    });

    it("uses the live URI when a location captured before Save As arrives later", async () => {
      const source = await openTemporaryEditor();
      const location = {
        editor: source,
        point: source.getCursorBufferPosition(),
        URI: source.getURI(),
      };
      await source.saveAs(path.join(tempDir, "saved.txt"));
      const history = main.getHistory();

      history.add(location);

      expect(history.entries[0].URI).toBe(source.getURI());
    });

    for (const cleanup of ["clear", "deactivate"]) {
      it(`releases the path subscription after ${cleanup}`, async () => {
        const source = await openTemporaryEditor();
        const subscribe = spyOn(source, "onDidChangePath").and.callThrough();
        const history = main.getHistory();
        history.add({
          editor: source,
          point: source.getCursorBufferPosition(),
          URI: source.getURI(),
        });
        const entry = history.entries[0];
        expect(subscribe).toHaveBeenCalledTimes(1);
        const registration = subscribe.calls.mostRecent().returnValue;
        const dispose = spyOn(registration, "dispose").and.callThrough();

        if (cleanup === "clear") history.clear();
        else await lumine.packages.deactivatePackage("cursor-history");
        expect(dispose).toHaveBeenCalledTimes(1);
        source.getBuffer().setPath(path.join(tempDir, "after-cleanup.txt"));
        expect(entry.URI).toBeNull();
      });
    }
  });
});
