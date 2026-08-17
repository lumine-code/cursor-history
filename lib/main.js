let History;

const { CompositeDisposable, Disposable } = require("lumine");
const DEFAULT_IGNORE_COMMANDS = [
  "cursor-history:next",
  "cursor-history:prev",
  "cursor-history:next-within-editor",
  "cursor-history:prev-within-editor",
  "cursor-history:clear",
];

function getClosestEditorForTarget(target) {
  if (target && target.closest("lumine-text-editor")) {
    const editor = target.closest("lumine-text-editor").getModel();
    if (editor && !editor.isMini()) {
      return editor;
    }
  }
}

class Location {
  constructor(editor, command) {
    this.command = command;
    this.editor = editor;
    this.point = editor.getCursorBufferPosition();
    this.URI = editor.getURI();
    this.reason = null;
  }

  computeNeedToSave(editor, options) {
    if (this.isFocusLost(editor)) {
      this.reason = "focus lost";
    } else if (this.isMovedEnough(editor, options)) {
      this.reason = "moved enough";
    }
    return this.reason != null;
  }

  isFocusLost(editor) {
    return this.URI ? this.URI !== editor.getURI() : this.editor !== editor;
  }

  isMovedEnough(editor, options) {
    const traversal = editor.getCursorBufferPosition().traversalFrom(this.point);
    if (traversal.row === 0) {
      return Math.abs(traversal.column) > options.columnDelta;
    } else {
      return Math.abs(traversal.row) > options.rowDelta;
    }
  }
}

module.exports = {
  serialize() {
    return {
      history: this.history ? this.history.serialize() : this.state.history,
    };
  },

  activate(state = {}) {
    this.state = state;
    this.trackedLocation = null; // expose to make test easy
    this.mouseCheckTimeout = null;
    this.pendingTimeouts = new Set();
    this.ignoreCommands = new Set(DEFAULT_IGNORE_COMMANDS);

    const jump = (...args) => this.getHistory().jump(...args);
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add("lumine-text-editor", {
        // Shorthand methods, not arrows: the registry calls a handler on the
        // element, and these read the editor off it.
        "cursor-history:next": {
          description: "Go forward again through the jumps already stepped back.",
          didDispatch() {
            jump(this.getModel(), "next");
          },
        },
        "cursor-history:prev": {
          description: "Go back to where the cursor was before the last jump.",
          didDispatch() {
            jump(this.getModel(), "prev");
          },
        },
        "cursor-history:next-within-editor": {
          description: "Go forward through the jumps made in this editor alone.",
          didDispatch() {
            jump(this.getModel(), "next", this.getModel());
          },
        },
        "cursor-history:prev-within-editor": {
          description: "Go back through the jumps made in this editor alone.",
          didDispatch() {
            jump(this.getModel(), "prev", this.getModel());
          },
        },
        "cursor-history:dump-history": {
          description: "Print the recorded positions to the console.",
          didDispatch: () => this.getHistory().log("DUMP"),
        },
        "cursor-history:clear": {
          description: "Forget every position the history is holding.",
          didDispatch: () => this.history && this.history.clear(),
        },
        "cursor-history:toggle-debug": {
          description: "Turn the package's debug logging on or off.",
          didDispatch: () => this.toggleDebug(),
        },
      }),
      lumine.config.observe("cursor-history.ignoreCommands", (value) =>
        this.setIgnoreCommands(value),
      ),
      lumine.config.observe(
        "cursor-history.rowDeltaToRemember",
        (value) => (this.rowDeltaToRemember = value),
      ),
      lumine.config.observe(
        "cursor-history.columnDeltaToRemember",
        (value) => (this.columnDeltaToRemember = value),
      ),
    );

    this.observeMouse();
    this.observeCommands();
  },

  deactivate() {
    for (const timeout of this.pendingTimeouts || []) clearTimeout(timeout);
    this.subscriptions?.dispose();
    if (this.history) this.history.destroy();
    this.subscriptions = this.history = this.mouseCheckTimeout = this.pendingTimeouts = null;
  },

  setIgnoreCommands(commands) {
    this.ignoreCommands = new Set(DEFAULT_IGNORE_COMMANDS.concat(commands));
  },

  toggleDebug() {
    const newValue = !lumine.config.get("cursor-history.debug");
    lumine.config.set("cursor-history.debug", newValue);
    console.log("debug: ", newValue);
  },

  getHistory() {
    if (!this.history) {
      if (!History) History = require("./history");
      this.history = History.create(this.state);
    }
    return this.history;
  },

  // Mouse handling updates the cursor during event propagation.
  // To track cursor position change caused by mouse click, I use mousedown event.
  //  - Event capture phase: Cursor position is not yet changed.
  //  - Event bubbling phase: Cursor position updated to clicked position.
  observeMouse() {
    let location, trackingEditor;

    const handleCapture = (event) => {
      this.cancelTimeout(this.mouseCheckTimeout);
      trackingEditor = getClosestEditorForTarget(event.target);
      if (trackingEditor) {
        // When mousedown event was not bubbled by explicitly suppressed by hyperclick,
        // We compare location after 300ms.
        // To avoid duplicate location check, this task is cancelled when mousedown was normally bubled.
        location = new Location(trackingEditor, "mousedown");
        this.mouseCheckTimeout = this.checkLocationChange(location, 300);
      }
    };

    const handleBubble = (event) => {
      this.cancelTimeout(this.mouseCheckTimeout);
      if (trackingEditor && trackingEditor === getClosestEditorForTarget(event.target)) {
        if (location) {
          this.checkLocationChange(location, 100);
          location = null;
        }
      }
    };

    const element = lumine.workspace.getElement();
    element.addEventListener("mousedown", handleCapture, true);
    element.addEventListener("mousedown", handleBubble, false);
    this.subscriptions.add(
      new Disposable(() => {
        element.removeEventListener("mousedown", handleCapture, true);
        element.removeEventListener("mousedown", handleBubble, false);
      }),
    );
  },

  observeCommands() {
    const isInterestingCommand = (type) => type.includes(":") && !this.ignoreCommands.has(type);
    let trackThrottled, trackingEditor;
    this.subscriptions.add(
      lumine.commands.onWillDispatch(({ type, target }) => {
        if (isInterestingCommand(type) && (trackingEditor = getClosestEditorForTarget(target))) {
          if (!trackThrottled) {
            this.trackedLocation = new Location(trackingEditor, type);
          }
          this.cancelTimeout(trackThrottled);
          trackThrottled = this.schedule(() => (trackThrottled = null), 100);
        }
      }),
      lumine.commands.onDidDispatch(({ type, target }) => {
        const location = this.trackedLocation;
        this.trackedLocation = null;
        if (
          location &&
          isInterestingCommand(type) &&
          trackingEditor === getClosestEditorForTarget(target)
        ) {
          // To wait cursor position is set on final destination.
          this.checkLocationChange(location, 100);
        }
      }),
    );
  },

  checkLocationChange(location, timeout) {
    if (!location) {
      throw new Error("empty location now not allowed for checkLocationChange()");
    }

    return this.schedule(() => {
      const editor = lumine.workspace.getActiveTextEditor();
      const options = {
        rowDelta: this.rowDeltaToRemember,
        columnDelta: this.columnDeltaToRemember,
      };
      if (editor && location.computeNeedToSave(editor, options)) {
        this.getHistory().add(location);
      }
    }, timeout);
  },

  schedule(callback, timeout) {
    const handle = setTimeout(() => {
      this.pendingTimeouts?.delete(handle);
      callback();
    }, timeout);
    this.pendingTimeouts.add(handle);
    return handle;
  },

  cancelTimeout(handle) {
    if (handle == null) return;
    clearTimeout(handle);
    this.pendingTimeouts?.delete(handle);
  },
};
