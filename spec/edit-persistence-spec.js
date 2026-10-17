const path = require("node:path");

describe("Cursor history persistence during edits", () => {
  let main, editor, history;

  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage("cursor-history")).mainModule;
    editor = await lumine.workspace.open(path.join(__dirname, "fixtures", "sample-1.js"));
    editor.setText("const value = '🚀';\r\n".repeat(200));
    history = main.getHistory();
    for (let row = 1; row <= 100; row++) history.add({ editor, point: [row, 0] });
    await main.saving;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("cursor-history");
    editor?.destroy();
  });

  it("persists one complete snapshot for all points shifted by a transaction", async () => {
    const write = spyOn(main.workspaceState, "update").and.callThrough();
    const serialize = spyOn(history, "serialize").and.callThrough();
    const buffer = editor.getBuffer();
    buffer.transact(() => {
      buffer.insert([0, 0], "\n");
      buffer.insert([0, 0], "\n");
    });

    expect(write.calls.count()).toBe(1);
    expect(serialize.calls.count()).toBe(1);
    const points = write.calls.mostRecent().args[1].entries.map((entry) => entry.point);
    expect(points).toEqual(Array.from({ length: 100 }, (_, i) => [i + 3, 0]));
    await main.saving;
    expect(main.workspaceState.get("history").entries.map((entry) => entry.point)).toEqual(points);

    write.calls.reset();
    buffer.undo();
    expect(write.calls.count()).toBe(1);
    await main.saving;
    expect(main.workspaceState.get("history").entries[0].point).toEqual([1, 0]);
    write.calls.reset();
    buffer.redo();
    expect(write.calls.count()).toBe(1);
    await main.saving;
    expect(main.workspaceState.get("history").entries[0].point).toEqual([3, 0]);
  });

  it("does not write history when an edit leaves every tracked point unchanged", () => {
    const write = spyOn(main.workspaceState, "update").and.callThrough();
    editor.getBuffer().append("\n");
    expect(write).not.toHaveBeenCalled();
  });

  it("retains tracked entries across a sustained series of committed writes", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const component = lumine.views.getView(editor).component;
    editor.setCursorBufferPosition([0, 0]);
    for (let row = 0; row < 20; row++) {
      editor.insertNewline();
      component.updateSync();
      await main.saving;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(main.history).toBe(history);
      expect(history.buffers.size).toBe(1);
      expect(main.workspaceState.get("history").entries[99].point).toEqual([101 + row, 0]);
    }
  });

  it("does not persist intermediate points from an aborted transaction", async () => {
    const write = spyOn(main.workspaceState, "update").and.callThrough();
    const buffer = editor.getBuffer();
    buffer.transact(() => {
      buffer.insert([0, 0], "\n");
      buffer.abortTransaction();
    });
    expect(write).not.toHaveBeenCalled();
    await main.saving;
    expect(main.workspaceState.get("history").entries[0].point).toEqual([1, 0]);
    buffer.insert([0, 0], "\n");
    expect(write.calls.count()).toBe(1);
    await main.saving;
    expect(main.workspaceState.get("history").entries[0].point).toEqual([2, 0]);
  });

  it("still persists a directly moved marker immediately", async () => {
    const write = spyOn(main.workspaceState, "update").and.callThrough();
    history.entries[0].marker.setHeadBufferPosition([150, 0]);
    expect(write.calls.count()).toBe(1);
    await main.saving;
    expect(main.workspaceState.get("history").entries[0].point).toEqual([150, 0]);
  });

  it("owns one buffer subscription and releases it with the final entry", () => {
    expect(history.buffers.size).toBe(1);
    const subscription = history.buffers.get(editor.getBuffer()).subscription;
    const dispose = spyOn(subscription, "dispose").and.callThrough();
    history.clear();
    expect(dispose.calls.count()).toBe(1);
    expect(history.buffers.size).toBe(0);
  });

  it("groups marker moves after history is restored and releases a closed editor", async () => {
    const state = history.serialize();
    history.destroy();
    const History = require("../lib/history");
    const changed = jasmine.createSpy("changed");
    history = main.history = History.deserialize(state, { onDidChange: changed });
    editor.getBuffer().insert([0, 0], "\n");
    expect(changed.calls.count()).toBe(1);
    expect(history.entries[99].point).toEqual([101, 0]);
    editor.destroy();
    expect(history.buffers.size).toBe(0);
  });
});
