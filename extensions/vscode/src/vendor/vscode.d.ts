/**
 * Minimal ambient declaration of the VS Code extension API — just the surface
 * this extension uses. It exists so the extension typechecks OFFLINE in this
 * monorepo (where `@types/vscode` isn't installed). In a real development setup
 * you `pnpm add -D @types/vscode` and this shim is shadowed/removed.
 *
 * Intentionally loose in places (the real types are authoritative at runtime).
 */
declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }
  export namespace Disposable {
    export function from(...items: Disposable[]): Disposable;
  }

  export class Position {
    constructor(line: number, character: number);
    readonly line: number;
    readonly character: number;
  }

  export class Range {
    constructor(
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    );
    readonly start: Position;
    readonly end: Position;
  }

  export class Uri {
    static file(path: string): Uri;
    static parse(value: string): Uri;
    readonly fsPath: string;
    readonly path: string;
    toString(): string;
  }

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
  }

  export class Diagnostic {
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
    code?: string | number;
    source?: string;
    severity: DiagnosticSeverity;
    range: Range;
    message: string;
  }

  export interface DiagnosticCollection {
    set(uri: Uri, diagnostics: Diagnostic[] | undefined): void;
    delete(uri: Uri): void;
    clear(): void;
    dispose(): void;
  }

  export class MarkdownString {
    constructor(value?: string);
    appendMarkdown(value: string): MarkdownString;
    appendText(value: string): MarkdownString;
    isTrusted?: boolean;
    value: string;
  }

  export class Hover {
    constructor(contents: MarkdownString | MarkdownString[], range?: Range);
  }

  export class ThemeIcon {
    constructor(id: string);
  }

  export interface Command {
    command: string;
    title: string;
    arguments?: unknown[];
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
  }

  export class TreeItem {
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
    label: string;
    description?: string;
    tooltip?: string | MarkdownString;
    iconPath?: ThemeIcon;
    command?: Command;
    contextValue?: string;
    collapsibleState?: TreeItemCollapsibleState;
  }

  export interface Event<T> {
    (listener: (e: T) => void): Disposable;
  }

  export class EventEmitter<T> {
    readonly event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export interface TreeDataProvider<T> {
    onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
  }

  export enum CodeActionKind {
    QuickFix = "quickfix",
  }
  export namespace CodeActionKind {
    export const QuickFix: any;
  }

  export class CodeAction {
    constructor(title: string, kind?: any);
    command?: Command;
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
    kind?: any;
  }

  export interface TextLine {
    readonly text: string;
    readonly lineNumber: number;
  }

  export interface TextDocument {
    readonly uri: Uri;
    readonly fileName: string;
    readonly languageId: string;
    getText(range?: Range): string;
    lineAt(line: number): TextLine;
    offsetAt(position: Position): number;
    positionAt(offset: number): Position;
  }

  export interface TextEditor {
    readonly document: TextDocument;
    readonly selection: { active: Position };
  }

  export interface CancellationToken {
    readonly isCancellationRequested: boolean;
  }

  export type ProviderResult<T> =
    | T
    | undefined
    | null
    | Thenable<T | undefined | null>;

  export interface HoverProvider {
    provideHover(
      document: TextDocument,
      position: Position,
      token: CancellationToken,
    ): ProviderResult<Hover>;
  }

  export interface CodeActionProvider {
    provideCodeActions(
      document: TextDocument,
      range: Range,
      context: CodeActionContext,
      token: CancellationToken,
    ): ProviderResult<CodeAction[]>;
  }

  export interface CodeActionContext {
    readonly diagnostics: readonly Diagnostic[];
  }

  export type DocumentSelector =
    | string
    | { language?: string; scheme?: string; pattern?: string }
    | Array<string | { language?: string; scheme?: string; pattern?: string }>;

  export interface OutputChannel {
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
    dispose(): void;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
  }

  export enum ProgressLocation {
    Notification = 15,
    Window = 10,
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
    readonly extensionPath: string;
  }

  export namespace commands {
    export function registerCommand(
      command: string,
      callback: (...args: any[]) => any,
    ): Disposable;
    export function executeCommand<T = unknown>(
      command: string,
      ...rest: any[]
    ): Thenable<T>;
  }

  export namespace window {
    export const activeTextEditor: TextEditor | undefined;
    export function showInformationMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showWarningMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showErrorMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    export function showInputBox(options?: {
      prompt?: string;
      placeHolder?: string;
      value?: string;
    }): Thenable<string | undefined>;
    export function createOutputChannel(name: string): OutputChannel;
    export function registerTreeDataProvider<T>(
      viewId: string,
      provider: TreeDataProvider<T>,
    ): Disposable;
    export function showTextDocument(
      document: TextDocument | Uri,
    ): Thenable<TextEditor>;
    export function withProgress<R>(
      options: { location: ProgressLocation; title?: string },
      task: () => Thenable<R>,
    ): Thenable<R>;
  }

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    export function getConfiguration(section?: string): WorkspaceConfiguration;
    export function openTextDocument(uri: Uri): Thenable<TextDocument>;
    export function onDidSaveTextDocument(
      listener: (document: TextDocument) => void,
    ): Disposable;
    export function createFileSystemWatcher(globPattern: string): {
      onDidChange: Event<Uri>;
      onDidCreate: Event<Uri>;
      onDidDelete: Event<Uri>;
      dispose(): void;
    };
  }

  export namespace languages {
    export function createDiagnosticCollection(
      name?: string,
    ): DiagnosticCollection;
    export function registerHoverProvider(
      selector: DocumentSelector,
      provider: HoverProvider,
    ): Disposable;
    export function registerCodeActionsProvider(
      selector: DocumentSelector,
      provider: CodeActionProvider,
      metadata?: { providedCodeActionKinds?: any[] },
    ): Disposable;
  }

  export namespace env {
    export function openExternal(target: Uri): Thenable<boolean>;
  }
}
