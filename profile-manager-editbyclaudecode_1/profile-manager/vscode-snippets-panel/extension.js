// PM Snippets -- panel ở thanh bên trái VS Code, liệt kê mọi snippet trong **/.vscode/*.code-snippets
// của workspace, gom nhóm theo phần trước dấu ":" trong tên (vd "xlv3: like tweet" -> nhóm xlv3).
// Bấm 1 dòng = chèn snippet tại con trỏ của file đang mở (Tab vẫn nhảy được giữa các ô ${1}, ${2}...).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const GLOB = '**/.vscode/*.code-snippets';

// .code-snippets là JSONC: bỏ comment // và /* */ (trừ khi nằm trong chuỗi) + dấu phẩy thừa cuối object/array.
function parseJsonc(text) {
  let out = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  let res = ''; inStr = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) { res += c; if (c === '\\') { res += out[++i]; } else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    if (c === ',' && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    res += c;
  }
  return JSON.parse(res);
}

function splitName(name) {
  const i = name.indexOf(':');
  return i > 0 ? { group: name.slice(0, i).trim(), label: name.slice(i + 1).trim() } : { group: 'Khác', label: name };
}

class SnippetTree {
  constructor() { this._emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this._emitter.event; this.groups = []; this.files = []; }

  async load() {
    const uris = await vscode.workspace.findFiles(GLOB, '**/node_modules/**');
    const groups = new Map();
    this.files = uris.map((u) => u.fsPath).sort();
    for (const file of this.files) {
      let data;
      try { data = parseJsonc(fs.readFileSync(file, 'utf-8')); } catch (e) { vscode.window.showWarningMessage(`PM Snippets: lỗi đọc ${path.basename(file)} -- ${e.message}`); continue; }
      for (const [name, s] of Object.entries(data)) {
        if (!s || s.body === undefined) continue;
        const { group, label } = splitName(name);
        const body = Array.isArray(s.body) ? s.body.join('\n') : String(s.body);
        const prefix = Array.isArray(s.prefix) ? s.prefix[0] : s.prefix;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push({ name, label, prefix, body, file, description: s.description });
      }
    }
    this.groups = [...groups.entries()].map(([group, items]) => ({ group, items }));
    this._emitter.fire();
  }

  getChildren(el) { return el ? el.items : this.groups; }

  getTreeItem(el) {
    if (el.items) {
      const t = new vscode.TreeItem(`${el.group} (${el.items.length})`, vscode.TreeItemCollapsibleState.Expanded);
      t.iconPath = new vscode.ThemeIcon('folder'); return t;
    }
    const t = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.None);
    t.description = el.prefix || '';
    t.iconPath = new vscode.ThemeIcon('symbol-snippet');
    t.contextValue = 'snippet';
    t.tooltip = new vscode.MarkdownString(`**${el.name}**${el.description ? '\n\n' + el.description : ''}\n\n\`\`\`js\n${el.body}\n\`\`\``);
    t.command = { command: 'pmSnippets.insert', title: 'Chèn snippet', arguments: [el] };
    return t;
  }
}

function activate(ctx) {
  const tree = new SnippetTree();
  let lastEditor = vscode.window.activeTextEditor;
  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((e) => { if (e) lastEditor = e; }));
  ctx.subscriptions.push(vscode.window.createTreeView('pmSnippets.list', { treeDataProvider: tree, showCollapseAll: true }));

  const watcher = vscode.workspace.createFileSystemWatcher(GLOB);
  ['onDidChange', 'onDidCreate', 'onDidDelete'].forEach((ev) => watcher[ev](() => tree.load()));
  ctx.subscriptions.push(watcher);

  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('pmSnippets.insert', async (s) => {
    const target = vscode.window.activeTextEditor || (lastEditor && !lastEditor.document.isClosed ? lastEditor : null);
    if (!target) return vscode.window.showWarningMessage('Mở 1 file và đặt con trỏ ở chỗ cần chèn trước đã.');
    const editor = await vscode.window.showTextDocument(target.document, { viewColumn: target.viewColumn, preserveFocus: false });
    await editor.insertSnippet(new vscode.SnippetString(s.body));
  });

  reg('pmSnippets.refresh', () => tree.load());

  reg('pmSnippets.openFile', async () => {
    const file = tree.files[0];
    if (!file) return vscode.window.showInformationMessage('Chưa có file .vscode/*.code-snippets nào trong workspace.');
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  });

  reg('pmSnippets.edit', async (s) => {
    const doc = await vscode.workspace.openTextDocument(s.file);
    const idx = doc.getText().indexOf(JSON.stringify(s.name));
    const pos = doc.positionAt(Math.max(idx, 0));
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
  });

  reg('pmSnippets.addFromSelection', async () => {
    const editor = vscode.window.activeTextEditor || lastEditor;
    const code = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
    if (!code) return vscode.window.showWarningMessage('Bôi đen đoạn code cần lưu trong editor trước đã.');
    const groupNames = tree.groups.map((g) => g.group);
    const group = await vscode.window.showQuickPick([...groupNames, '+ Nhóm mới...'], { placeHolder: 'Chọn nhóm' });
    if (!group) return;
    const groupName = group === '+ Nhóm mới...' ? await vscode.window.showInputBox({ prompt: 'Tên nhóm mới' }) : group;
    if (!groupName) return;
    const label = await vscode.window.showInputBox({ prompt: 'Tên snippet (hiện trong panel)' });
    if (!label) return;
    const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''));
    const prefix = await vscode.window.showInputBox({ prompt: 'Prefix (chữ gõ để gọi snippet)', value: 'pm-' + slug.charAt(0).toLowerCase() + slug.slice(1) });
    if (!prefix) return;

    let file = tree.files[0];
    if (!file) {
      const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      if (!root) return vscode.window.showWarningMessage('Chưa mở thư mục nào.');
      file = path.join(root.uri.fsPath, '.vscode', 'profile-manager.code-snippets');
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{\n}\n');
    }
    // Indent chung bỏ đi, "$" thành "\$" để VS Code không hiểu nhầm là biến snippet.
    const lines = code.replace(/\r/g, '').replace(/\s+$/, '').split('\n');
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
    const body = lines.map((l) => l.slice(indent).replace(/\$/g, '\\$'));
    const name = `${groupName}: ${label}`;
    const entry = `  ${JSON.stringify(name)}: {\n    "scope": "javascript", "prefix": ${JSON.stringify(prefix)},\n    "body": [${body.map((l) => JSON.stringify(l)).join(', ')}]\n  }`;

    const text = fs.readFileSync(file, 'utf-8');
    const end = text.lastIndexOf('}');
    const before = text.slice(0, end).replace(/\s*$/, '');
    const sep = before.endsWith('{') || before.endsWith(',') ? '' : ',';
    fs.writeFileSync(file, `${before}${sep}\n${entry}\n${text.slice(end)}`);
    await tree.load();
    vscode.window.showInformationMessage(`Đã lưu snippet "${name}" (${prefix}).`);
  });

  tree.load();
}

function deactivate() {}

module.exports = { activate, deactivate, parseJsonc };
