import './style.css';
import { App } from './app';
import { Editor } from './editor/editor';
import { buildDock } from './ui/dock';
import { h, toast } from './ui/dom';
import { buildPalette, buildRightPanel } from './ui/panels';
import { simTab } from './ui/simtab';
import { buildTopbar, exportDialog, helpDialog, texturesDialog } from './ui/topbar';

const root = document.getElementById('app')!;
const canvas = h('canvas', { class: 'view mode-view' });
root.append(canvas);

const app = new App(canvas);
const editor = new Editor(app);
app.ui.exportDialog = () => exportDialog(app);
app.ui.help = helpDialog;
app.ui.textures = () => texturesDialog(app);
app.ui.pickAfk = () => editor.enterAfkMode();

const narrow = () => innerWidth <= 860;
let leftOpen = !narrow(), rightOpen = !narrow();
const left = buildPalette(app);
const right = buildRightPanel(app, simTab);
const applyPanels = () => {
  left.classList.toggle('hidden', !leftOpen);
  right.classList.toggle('hidden', !rightOpen);
  const wide = !narrow();
  root.style.setProperty('--lp', leftOpen && wide ? `${left.offsetWidth + 12}px` : '0px');
  root.style.setProperty('--rp', rightOpen && wide ? `${right.offsetWidth + 12}px` : '0px');
};
const topbar = buildTopbar(app, {
  left: () => { leftOpen = !leftOpen; if (narrow() && leftOpen) rightOpen = false; applyPanels(); },
  right: () => { rightOpen = !rightOpen; if (narrow() && rightOpen) leftOpen = false; applyPanels(); },
});
const dock = buildDock(app);

const drop = h('div', { class: 'drop-overlay' }, h('div', null, 'Datei hier ablegen', h('small', null, '.litematic · .schem · .nbt · Minecraft-.jar · Resourcepack-.zip')));
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; drop.classList.add('show'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('show');
  if (e.dataTransfer?.files.length) void app.importFiles(e.dataTransfer.files);
});

root.append(topbar, left, right, ...dock.elements, drop);
applyPanels();
window.addEventListener('resize', applyPanels);

try {
  const theme = localStorage.getItem('litecraft-theme');
  if (theme === 'day' || theme === 'night') app.view.setTheme(theme);
} catch { /* ignore */ }

let reported = false;
const loop = () => {
  requestAnimationFrame(loop);
  try {
    editor.update();
    app.view.frame();
    dock.frame();
  } catch (e) {
    if (!reported) { reported = true; console.error(e); toast(`Interner Fehler: ${(e as Error).message}`, 'error', 8000); }
  }
};
requestAnimationFrame(loop);

void app.start().then(() => {
  let seen = false;
  try { seen = !!localStorage.getItem('litecraft-seen'); localStorage.setItem('litecraft-seen', '1'); } catch { /* ignore */ }
  if (!seen && !app.packLabel()) {
    toast('Tipp: Lade deine Minecraft-Jar für Original-Texturen – sie bleibt lokal in deinem Browser.', 'info', 9000, { label: 'Texturen laden', run: () => texturesDialog(app) });
  }
});

Object.assign(window, { __lc: app });
