const path = require("node:path");

describe("Cursor history historical issue controls", () => {
  let main, editor;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
  });

  it("returns to the recorded editor when two panes share the same file URI", async () => {
    const originalPane = lumine.workspace.getActivePane();
    const secondPane = originalPane.splitRight({ copyActiveItem: true });
    const copy = secondPane.getActiveItem();
    expect(copy).not.toBe(editor);
    expect(copy.getURI()).toBe(editor.getURI());
    copy.setCursorBufferPosition([2, 1]);
    main
      .getHistory()
      .add({ editor: copy, URI: copy.getURI(), point: copy.getCursorBufferPosition() });
    copy.setCursorBufferPosition([10, 0]);
    editor.setCursorBufferPosition([4, 0]);
    secondPane.activate();

    await main.getHistory().jump(copy, "prev");

    expect(lumine.workspace.getActivePane()).toBe(secondPane);
    expect(copy.getCursorBufferPosition()).toEqual([2, 1]);
    expect(editor.getCursorBufferPosition()).toEqual([4, 0]);
  });

  it("tracks the starting cursor through the actual Go To Line prompt", async () => {
    await lumine.packages.activatePackage("go-to-line");
    editor.setCursorBufferPosition([2, 1]);
    editor.element.focus();
    await lumine.commands.dispatch(editor.element, "go-to-line:toggle");
    const dialog = lumine.workspace.getElement().querySelector(".go-to-line lumine-input-dialog");
    expect(dialog).not.toBeNull();
    dialog.getModel().getQueryEditor().setText("12");
    advanceClock(100);
    await lumine.commands.dispatch(dialog, "core:confirm");
    expect(editor.getCursorBufferPosition().row).toBe(11);

    await lumine.commands.dispatch(editor.element, "cursor-history:prev");

    expect(editor.getCursorBufferPosition()).toEqual([2, 1]);
  });

  it("accepts a non-element command target and inspects an unsaved history entry", async () => {
    expect(() =>
      lumine.commands.dispatch(window, "cursor-history-control:non-element"),
    ).not.toThrow();
    const untitled = await lumine.workspace.open();
    main
      .getHistory()
      .add({ editor: untitled, URI: untitled.getURI(), point: untitled.getCursorBufferPosition() });
    expect(() => main.getHistory().inspect()).not.toThrow();
  });
});
