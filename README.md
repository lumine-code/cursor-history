# cursor-history

Navigate backward and forward through recent cursor positions.

## Features

- **Cross-file navigation**: revisits saved cursor locations across open and closed files.
- **Per-editor navigation**: optionally limits traversal to the current editor.
- **Movement thresholds**: records positions after configurable row or column movement.
- **Live markers**: tracks edits so saved positions move with their buffers.
- **Destination flash**: briefly highlights a location after landing there.
- **Serializable state**: restores valid cursor history with the workspace session.

## Installation

To install `cursor-history` search for _cursor-history_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/cursor-history`.

## Commands

Commands available in `lumine-text-editor`:

- `cursor-history:prev`: visit the previous saved position.
- `cursor-history:next`: visit the next saved position.
- `cursor-history:prev-within-editor`: visit the previous position in the current editor.
- `cursor-history:next-within-editor`: visit the next position in the current editor.
- `cursor-history:clear`: remove every saved position.
- `cursor-history:dump-history`: print the current history to the developer console.
- `cursor-history:toggle-debug`: toggle diagnostic logging.

## Configuration

The package settings control history length, row and column movement thresholds, closed-file behavior, per-file deduplication, pane search, pending editors, destination flashes, ignored commands, and debug logging.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
