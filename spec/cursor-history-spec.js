const path = require("node:path");
const { it, beforeEach, afterEach } = require("./async-spec-helpers");

describe("cursor-history", () => {
  let commandDisposable;
  let editor;
  let editorElement;
  let main;
  let sampleOne;
  let sampleTwo;

  beforeEach(async () => {
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
  });

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

  it("activates the existing editor when navigating across files", async () => {
    const history = main.getHistory();
    editor.setCursorBufferPosition([4, 2]);
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });

    const secondEditor = await lumine.workspace.open(sampleTwo);
    secondEditor.setCursorBufferPosition([8, 0]);
    await history.jump(secondEditor, "prev");

    expect(lumine.workspace.getActiveTextEditor()).toBe(editor);
    expect(editor.getCursorBufferPosition()).toEqual([4, 2]);
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

  it("clears entries and their markers", () => {
    const history = main.getHistory();
    history.add({ editor, point: editor.getCursorBufferPosition(), URI: sampleOne });
    const entry = history.entries[0];
    history.clear();

    expect(history.entries).toEqual([]);
    expect(entry.destroyed).toBe(true);
  });
});
