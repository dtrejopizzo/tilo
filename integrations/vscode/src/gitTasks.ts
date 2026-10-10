import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as vscode from "vscode"
import type { TiloState } from "./state"

const exec = promisify(execFile)

interface GitRepository {
  rootUri: vscode.Uri
  state: { onDidChange: vscode.Event<void>; HEAD?: { name?: string } }
}
interface GitApi {
  repositories: GitRepository[]
  onDidOpenRepository: vscode.Event<GitRepository>
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, timeout: 15_000 })
  return stdout.trim()
}

async function defaultBranch(cwd: string): Promise<string> {
  const head = await git(cwd, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").catch(() => "")
  if (head) return head // e.g. origin/main
  for (const b of ["main", "master"]) {
    if (await git(cwd, "rev-parse", "--verify", "--quiet", b).then(() => true, () => false)) return b
  }
  return "main"
}

// Branches whose work landed: merged into the default branch, or whose remote was deleted
// after a PR (GitHub squash merges don't show up in --merged; the upstream is reported "gone").
export async function landedBranches(cwd: string): Promise<Set<string>> {
  const base = await defaultBranch(cwd)
  const local = base.replace(/^origin\//, "")
  const landed = new Set<string>()
  // Merged into the remote default branch (PR merged on GitHub) or into the local one
  for (const target of new Set([base, local])) {
    const merged = await git(cwd, "branch", "--merged", target, "--format=%(refname:short)").catch(() => "")
    for (const b of merged.split("\n").map((s) => s.trim()).filter(Boolean)) landed.add(b)
  }
  const tracking = await git(cwd, "for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads").catch(() => "")
  for (const line of tracking.split("\n")) {
    const [name, ...rest] = line.trim().split(" ")
    if (name && rest.join(" ").includes("gone")) landed.add(name)
  }
  landed.delete(local)
  return landed
}

// Completes Tilo tasks created from TODOs on a branch once that branch is merged
export class GitTaskWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | undefined
  private done = new Set<string>()

  constructor(private readonly state: TiloState) {
    void this.init()
  }

  private async init() {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>("vscode.git")
    const exports = ext?.isActive ? ext.exports : await Promise.resolve(ext?.activate()).catch(() => undefined)
    const api = exports?.getAPI(1)
    if (!api) return
    const watch = (repo: GitRepository) => this.disposables.push(repo.state.onDidChange(() => this.schedule()))
    api.repositories.forEach(watch)
    this.disposables.push(api.onDidOpenRepository(watch), this.state.onDidChange(() => this.schedule()))
    this.api = api
    this.schedule()
  }

  private api: GitApi | undefined

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.check(), 5_000)
  }

  async check() {
    const tasks = (this.state.day?.tasks ?? []).filter((t) => {
      const ref = t.source_ref as { branch?: string } | null
      return t.status === "todo" && t.source === "code" && ref?.branch && !this.done.has(t.id)
    })
    if (!tasks.length || !this.api) return
    const completed: string[] = []
    for (const repo of this.api.repositories) {
      const landed = await landedBranches(repo.rootUri.fsPath).catch(() => new Set<string>())
      const repoName = repo.rootUri.fsPath.split(/[\\/]/).pop()
      for (const t of tasks) {
        const ref = t.source_ref as { branch: string; file?: string; repo?: string }
        const inRepo = ref.file?.startsWith(repo.rootUri.fsPath) || ref.repo === repoName
        if (!inRepo || !landed.has(ref.branch) || this.done.has(t.id)) continue
        this.done.add(t.id)
        const r = await this.state.act((c) => c.updateTask(t.id, { status: "done" }))
        if (r) completed.push(`${t.title} (${ref.branch})`)
      }
    }
    if (completed.length) {
      void vscode.window.showInformationMessage(
        completed.length === 1 ? `Mergeaste la rama: completé “${completed[0]}”.` : `Mergeaste ramas: completé ${completed.length} tareas.`,
      )
    }
  }

  dispose() {
    clearTimeout(this.timer)
    this.disposables.forEach((d) => d.dispose())
  }
}
