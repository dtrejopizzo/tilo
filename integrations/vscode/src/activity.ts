import * as vscode from "vscode"

// Tracks real editing activity: typing, selection changes, saves and window focus.
// Active time only accumulates while the last activity is recent, so stepping away pauses it.
export class ActivityTracker implements vscode.Disposable {
  lastActivity = Date.now()
  private disposables: vscode.Disposable[] = []
  private readonly activityEmitter = new vscode.EventEmitter<void>()
  readonly onActivity = this.activityEmitter.event

  constructor() {
    const touch = () => {
      this.lastActivity = Date.now()
      this.activityEmitter.fire()
    }
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === "file" && touch()),
      vscode.window.onDidChangeTextEditorSelection(touch),
      vscode.workspace.onDidSaveTextDocument(touch),
      vscode.window.onDidChangeWindowState((s) => s.focused && touch()),
      vscode.window.onDidChangeActiveTextEditor(touch),
    )
  }

  idleMs() {
    return Date.now() - this.lastActivity
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose())
  }
}
