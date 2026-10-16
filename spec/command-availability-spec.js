const path = require("node:path");

describe("Cursor History command availability", () => {
  let main, editor;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("cursor-history");
    editor = null;
  });
  it("keeps an empty history unavailable without initializing it to query it", async () => {
    spyOn(main, "getHistory").and.callThrough();
    const target = lumine.workspace.getElement();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(false);
    editor = await lumine.workspace.open();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(true);
    expect(main.getHistory).not.toHaveBeenCalled();
  });

  it("reopens the last closed file from an empty pane without a source position", async () => {
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
    editor.setCursorBufferPosition([3, 2]);
    const history = main.getHistory();
    history.add({ editor, point: editor.getCursorBufferPosition() });
    const uri = editor.getURI();
    editor.destroy();
    const target = lumine.workspace.getActivePane().getElement();
    expect(lumine.workspace.getActiveTextEditor()).toBeUndefined();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(true);
    expect(lumine.commands.canDispatch(target, "cursor-history:prev-within-editor")).toBe(false);

    await lumine.commands.dispatch(target, "cursor-history:prev");

    editor = lumine.workspace.getActiveTextEditor();
    expect(editor.getURI()).toBe(uri);
    expect(editor.getCursorBufferPosition()).toEqual([3, 2]);
    expect(history.entries).toHaveLength(1);
    expect(history.index).toBe(0);
  });

  it("opens recorded positions while a non-editor pane item is active", async () => {
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
    editor.setCursorBufferPosition([4, 1]);
    const history = main.getHistory();
    history.add({ editor, point: editor.getCursorBufferPosition() });
    editor.destroy();
    const preview = {
      element: document.createElement("div"),
      getTitle: () => "History preview",
      getURI: () => "cursor-history-spec://empty-context-preview",
    };
    await lumine.workspace.open(preview);
    try {
      expect(lumine.workspace.getActiveTextEditor()).toBeUndefined();
      expect(lumine.commands.canDispatch(preview.element, "cursor-history:prev")).toBe(true);
      await lumine.commands.dispatch(preview.element, "cursor-history:prev");
      editor = lumine.workspace.getActiveTextEditor();
      expect(editor.getCursorBufferPosition()).toEqual([4, 1]);
    } finally {
      await lumine.workspace.paneForItem(preview)?.destroyItem(preview);
    }
  });

  it("uses restored positions before initializing history, including forward navigation", async () => {
    const uri = path.join(__dirname, "fixtures", "sample-2.js");
    main.state = {
      history: {
        index: 0,
        entries: [
          { point: [1, 0], URI: path.join(__dirname, "fixtures", "sample-1.js") },
          { point: [6, 1], URI: uri },
        ],
      },
    };
    const getHistory = spyOn(main, "getHistory").and.callThrough();
    const target = lumine.workspace.getElement();
    expect(lumine.commands.canDispatch(target, "cursor-history:next")).toBe(true);
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(true);
    expect(getHistory).not.toHaveBeenCalled();
    expect(main.history).toBeFalsy();

    await lumine.commands.dispatch(target, "cursor-history:next");

    editor = lumine.workspace.getActiveTextEditor();
    expect(editor.getURI()).toBe(uri);
    expect(editor.getCursorBufferPosition()).toEqual([6, 1]);
  });

  it("can return from an empty pane to an unnamed editor in another pane", async () => {
    editor = await lumine.workspace.open();
    editor.setText("zero\none\ntwo");
    editor.setCursorBufferPosition([1, 2]);
    main.getHistory().add({ editor, point: editor.getCursorBufferPosition() });
    const empty = lumine.workspace.getActivePane().splitRight();
    try {
      expect(lumine.workspace.getActiveTextEditor()).toBeUndefined();
      expect(lumine.commands.canDispatch(empty.getElement(), "cursor-history:prev")).toBe(true);
      await lumine.commands.dispatch(empty.getElement(), "cursor-history:prev");
      expect(lumine.workspace.getActiveTextEditor()).toBe(editor);
      expect(editor.getCursorBufferPosition()).toEqual([1, 2]);
    } finally {
      empty.destroy();
    }
  });

  it("queries existing entries without validating paths or traversing history", async () => {
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
    const history = main.getHistory();
    history.add({ editor, point: editor.getCursorBufferPosition() });
    editor.destroy();
    const validate = spyOn(history.entries[0], "isValid").and.callThrough();
    spyOn(history, "findIndex").and.throwError("Availability must not scan entries");
    spyOn(main, "getHistory").and.throwError("Availability must not initialize history");
    expect(lumine.commands.canDispatch(lumine.workspace.getElement(), "cursor-history:prev")).toBe(
      true,
    );
    expect(validate).not.toHaveBeenCalled();
  });

  it("invalidates availability when positions are recorded or cleared", async () => {
    const history = main.getHistory();
    const invalidate = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
    invalidate.calls.reset();
    history.add({ editor, point: editor.getCursorBufferPosition() });
    expect(invalidate).toHaveBeenCalled();
    invalidate.calls.reset();
    history.add({ editor, point: [1, 0] });
    expect(invalidate).not.toHaveBeenCalled();
    editor.destroy();
    invalidate.calls.reset();
    const target = lumine.workspace.getElement();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(true);

    await lumine.commands.dispatch(target, "cursor-history:clear");

    expect(invalidate).toHaveBeenCalled();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(false);
    invalidate.calls.reset();
    await lumine.commands.dispatch(target, "cursor-history:clear");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
