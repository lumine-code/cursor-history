// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript"],
  viewport: { width: 1100, height: 730 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("editing/signal.js");
    await lumine.project.setPaths([fixture("editing")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Cursor after jumping to the end of the file.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          state.editor.setCursorBufferPosition([2, 4]);
          lumine.views.getView(state.editor).blur();
          lumine.views.getView(state.editor).focus();
          lumine.commands.dispatch(lumine.views.getView(state.editor), "core:move-to-bottom");
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      },
      ready() {
        return Boolean(
          document.querySelector("lumine-workspace")?.getBoundingClientRect().height > 0 &&
          document.body.innerText.trim().length > 0,
        );
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "Cursor History returns to the previous editing location.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "cursor-history:prev");
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(state.editor.getCursorBufferPosition().row === 2);
      },
    },
  ],
  async cleanup() {},
};
