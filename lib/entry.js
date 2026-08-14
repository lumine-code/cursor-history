const { CompositeDisposable, Point } = require("lumine");
const { existsSync } = require("fs");
const { basename } = require("path");

// A URI can be opened by any pane item — an image view, a PDF, a preview — so the
// item found for it is only usable here when it is actually a text editor.
function editorForURI(uri) {
  const pane = uri && lumine.workspace.paneForURI(uri);
  const item = pane?.itemForURI(uri);
  return lumine.workspace.isTextEditor(item) ? item : undefined;
}

// Wrapper for Point or Marker.
//  For alive editor, use Marker to track up-to-date position.
//  For destroyed editor, use Point.
module.exports = class Entry {
  static deserialize(state) {
    return new Entry({
      editor: editorForURI(state.URI),
      point: Point.fromObject(state.point),
      URI: state.URI,
    });
  }

  serialize() {
    return {
      point: this.point.serialize(),
      URI: this.URI,
    };
  }

  constructor({ editor, point, URI }) {
    this.point = point;
    this.URI = URI;
    this.destroyed = false;

    if (!editor || !editor.isAlive()) return;

    this.editor = editor;
    this.marker = editor.markBufferPosition(point);

    this.subscriptions = new CompositeDisposable(
      this.marker.onDidChange(({ newHeadBufferPosition }) => {
        this.point = newHeadBufferPosition;
      }),
      editor.onDidDestroy(() => {
        if (editor.getURI()) this.unSubscribe();
        else this.destroy();
      }),
    );
  }

  unSubscribe() {
    if (this.subscriptions) {
      this.subscriptions.dispose();
      this.subscriptions = null;

      this.marker.destroy();
      this.marker = null;

      this.editor = null;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.unSubscribe();
    this.point = this.URI = this.marker = null;
  }

  isValid() {
    if (this.destroyed) {
      return false;
    }

    const editorIsAlive = this.editor && this.editor.isAlive();
    if (lumine.config.get("cursor-history.excludeClosedBuffer")) {
      return editorIsAlive;
    } else {
      return editorIsAlive || (this.URI && existsSync(this.URI));
    }
  }

  isAtSameRow(other) {
    return (
      ((this.URI && this.URI === other.URI) || (this.editor && this.editor === other.editor)) &&
      this.isValid() &&
      other.isValid() &&
      other.point.row === this.point.row &&
      other.URI === this.URI
    );
  }

  toString() {
    return `${this.point}, ${this.URI}`;
  }

  inspect() {
    if (this.destroyed) {
      return "[Destroyed]";
    } else {
      const file = this.URI ? basename(this.URI) : "-";
      const invalid = this.isValid() ? "" : " [Invalid]";
      return `${this.point}, ${file}` + invalid;
    }
  }
};
