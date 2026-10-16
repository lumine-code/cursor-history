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
  it("requires a context editor without initializing history to query it", async () => {
    spyOn(main, "getHistory").and.callThrough();
    const target = lumine.workspace.getElement();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(false);
    editor = await lumine.workspace.open();
    expect(lumine.commands.canDispatch(target, "cursor-history:prev")).toBe(true);
    expect(main.getHistory).not.toHaveBeenCalled();
  });
});
