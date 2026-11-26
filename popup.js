'use strict';
const $ = id => document.getElementById(id);
let promptOrderSaving = false;
let prompts = [], folders = [], activeFolder = null, selected = new Set(), editing = null, timer, currentId = null, dragData = null, view = 'all';
const expanded = new Set();
let draftImages = [], imageLoading = false, imageRevision = 0, imageQueue = Promise.resolve(), pendingImages = 0, composeIds = [];
let storageReady = false;
const imageHashCache = new Map();
const getImages = p => Array.isArray(p?.images) ? p.images.filter(x => typeof x === 'string') : p?.image ? [p.image] : [];
const key = path => JSON.stringify(path);
const startsWithPath = (path, prefix) => prefix.every((part, i) => path[i] === part);
function addPath(list, path) { for (let i = 1; i <= path.length; i++) { const part = path.slice(0, i); if (!list.some(p => key(p) === key(part))) list.push(part); } }
async function imageKey(src) {
  if (!imageHashCache.has(src)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    imageHashCache.set(src, 'sha256-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  return imageHashCache.get(src);
}
async function encodeStorage(items) {
  const imageBlobs = {}, encoded = [];
  for (const item of items) {
    const imageRefs = [];
    for (const src of getImages(item)) { const id = await imageKey(src); imageBlobs[id] = src; imageRefs.push(id); }
    const copy = {...item}; delete copy.image; delete copy.images; delete copy.imageRefs;
    if (imageRefs.length) copy.imageRefs = imageRefs;
    encoded.push(copy);
  }
  return {encoded, imageBlobs};
}
function decodeStorage(items, imageBlobs) {
  return items.map(item => {
    if (!Array.isArray(item.imageRefs)) return item;
    const images = item.imageRefs.map(id => { if (typeof imageBlobs[id] !== 'string') throw new Error('参考图数据不完整'); return imageBlobs[id]; });
    const copy = {...item, images}; delete copy.imageRefs; return copy;
  });
}
async function saveAll(nextPrompts, nextFolders) {
  if (!storageReady) throw new Error('数据尚未安全读取');
  const {encoded, imageBlobs} = await encodeStorage(nextPrompts);
  await chrome.storage.local.set({prompts: encoded, folders: nextFolders, imageBlobs});
  prompts = nextPrompts; folders = nextFolders; render();
}
const uid = () => crypto.randomUUID();
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(timer); timer = setTimeout(() => $('toast').classList.remove('show'), 2500); }
async function save(next) { await saveAll(next, folders); }
function button(label, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b; }
function download(items, all = false) { const data = { format: 'prompt-library', version: 2, exportedAt: new Date().toISOString(), prompts: items, folders: all ? folders : folders.filter(folder => items.some(p => startsWithPath(p.categoryPath || [], folder))) }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `提示词收藏-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已导出 ${items.length} 条提示词`); }
function edit(item) { imageRevision++; imageLoading = false; $('imageDrop').classList.remove('imageLoading'); pendingImages = 0; imageQueue = Promise.resolve(); draftImages = [...getImages(item)]; $('imageNotice').textContent = ''; renderImageDraft(); editing = item?.id ?? null; $('dialogTitle').textContent = item ? '编辑提示词' : '新建提示词'; $('title').value = item?.title ?? ''; $('content').value = item?.content ?? ''; $('tags').value = (item?.tags ?? []).join(', '); $('newCategoryName').value = ''; updateCategoryOptions(item?.categoryPath || activeFolder || []); $('editor').showModal(); $('title').focus(); }
function updateCategoryOptions(path) {
  const select = $('category'); select.replaceChildren();
  const root = document.createElement('option'); root.value = '[]'; root.textContent = '未分类'; select.append(root);
  for (const folder of sortedFolders()) { const option = document.createElement('option'); option.value = key(folder); option.textContent = folder.join(' / '); select.append(option); }
  select.value = key(path); if (!select.value) select.value = '[]';
}
function sortedFolders() { return [...folders]; }
function setDropTarget(element, target, root = false) {
  element.addEventListener('dragover', e => { if (!dragData && !e.dataTransfer.types.includes('text/plain')) return; e.preventDefault(); e.dataTransfer.dropEffect = dragData ? 'move' : 'copy'; element.classList.add('dropTarget'); });
  element.addEventListener('dragleave', e => { if (!element.contains(e.relatedTarget)) element.classList.remove('dropTarget'); });
  element.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation(); element.classList.remove('dropTarget');
    try {
      if (dragData?.type === 'folder') {
        const old = dragData.path, parent = target || [];
        if (startsWithPath(parent, old)) { toast('不能移动到自身或子分类中'); return; }
        const dest = [...parent, old.at(-1)];
        if (key(dest) === key(old)) return;
        if (folders.some(p => key(p) === key(dest))) { toast('目标位置已有同名分类'); return; }
        const replace = p => startsWithPath(p, old) ? [...dest, ...p.slice(old.length)] : p;
        const nextPrompts = prompts.map(p => ({...p, categoryPath: replace(p.categoryPath || [])}));
        const nextFolders = folders.map(replace); const nextActive = activeFolder && startsWithPath(activeFolder, old) ? replace(activeFolder) : activeFolder;
        await saveAll(nextPrompts, nextFolders); activeFolder = nextActive; expanded.add(key(parent)); expanded.add(key(dest)); render(); toast('分类及其中的提示词已移动');
      } else if (dragData?.type === 'prompt') {
        if (root) { toast('请拖到具体分类或“未分类”'); return; }
        const id = dragData.id; await save(prompts.map(p => p.id === id ? {...p, categoryPath: target || [], updatedAt: new Date().toISOString()} : p)); toast('提示词已移动');
      } else {
        const text = e.dataTransfer.getData('text/plain').trim(); if (!text) return;
        edit(); $('content').value = text; $('title').value = text.split(/\r?\n/)[0].slice(0, 40); updateCategoryOptions(target || []); toast('请确认内容并保存');
      }
    } catch { toast('保存失败，请重试'); } finally { dragData = null; }
  });
}
function renderFolders() {
  const list = $('folderList'); list.replaceChildren();
  for (const id of ['all','uncategorized','favorites','recent','frequent','trash']) $(id).classList.toggle('active', view === id);
  function draw(parent, depth) {
    const children = sortedFolders().filter(f => f.length === parent.length + 1 && startsWithPath(f, parent));
    for (const folder of children) {
      const row = document.createElement('div'); row.className = 'folderRow' + (key(activeFolder) === key(folder) ? ' active' : ''); row.style.paddingLeft = `${depth * 14}px`; row.draggable = true;
      row.ondragstart = e => { dragData = {type:'folder', path: folder}; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', folder.join(' / ')); e.stopPropagation(); };
      row.ondragend = () => { dragData = null; document.querySelectorAll('.dropTarget').forEach(el => el.classList.remove('dropTarget')); };
      setDropTarget(row, folder);
      const hasChildren = folders.some(f => f.length === folder.length + 1 && startsWithPath(f, folder));
      const toggle = document.createElement('button'); toggle.className = 'folderToggle'; toggle.textContent = hasChildren ? (expanded.has(key(folder)) ? '▾' : '▸') : '·'; toggle.setAttribute('aria-label', expanded.has(key(folder)) ? '收起分类' : '展开分类'); toggle.onclick = () => { if (expanded.has(key(folder))) expanded.delete(key(folder)); else expanded.add(key(folder)); render(); };
      const name = document.createElement('button'); name.className = 'folderName'; name.textContent = '📁  ' + folder.at(-1); name.title = folder.join(' / '); name.onclick = () => { view = 'folder'; activeFolder = folder; if (hasChildren) expanded.add(key(folder)); render(); };
      const index = children.findIndex(f => key(f) === key(folder));
      const move = (direction, label) => { const b = document.createElement('button'); b.className = 'folderMove'; b.textContent = direction < 0 ? '↑' : '↓'; b.title = label; b.setAttribute('aria-label', `${label} ${folder.at(-1)}`); b.disabled = index + direction < 0 || index + direction >= children.length; b.onclick = async e => { e.stopPropagation(); const next = [...folders]; const a = next.findIndex(f => key(f) === key(folder)), other = next.findIndex(f => key(f) === key(children[index + direction])); [next[a], next[other]] = [next[other], next[a]]; try { await saveAll(prompts, next); } catch { toast('排序保存失败'); } }; return b; };
      row.append(toggle, name, move(-1,'上移'), move(1,'下移')); list.append(row); if (expanded.has(key(folder))) draw(folder, depth + 1);
    }
  }
  draw([], 0); $('renameFolder').disabled = $('deleteFolder').disabled = !activeFolder?.length;
}
function matchesFolder(p) {
  if (view === 'trash') return !!p.deletedAt;
  if (p.deletedAt) return false;
  if (view === 'favorites') return !!p.favorite;
  if (view === 'recent' || view === 'frequent') return (p.useCount || 0) > 0;
  return view === 'all' || key(p.categoryPath || []) === key(activeFolder);
}
function visiblePrompts() {
  const query = $('search').value.trim().toLowerCase();
  const items = prompts.filter(p => matchesFolder(p) && [p.title,p.content,...p.tags].some(s => s.toLowerCase().includes(query)));
  if (view === 'recent') items.sort((a,b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
  if (view === 'frequent') items.sort((a,b) => (b.useCount || 0) - (a.useCount || 0) || (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
  if (view === 'trash') items.sort((a,b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  return items;
}
function renderDetail() {
  const ids = [...selected].filter(id => prompts.some(p => p.id === id && !p.deletedAt));
  $('selectionPanel').hidden = !ids.length || view === 'trash';
  if (ids.length && view !== 'trash') { $('detailEmpty').hidden = true; $('detailContent').hidden = true; renderSelection(ids); return; }
  const p = prompts.find(x => x.id === currentId); $('detailEmpty').hidden = !!p; $('detailContent').hidden = !p; if (!p) return;
  $('detailTitle').textContent = p.title; $('detailPath').textContent = p.categoryPath?.length ? p.categoryPath.join(' / ') : '未分类'; $('detailText').textContent = p.content;
  const detailImages = getImages(p); $('detailImageSection').hidden = !detailImages.length; $('detailImages').replaceChildren(); detailImages.forEach((src, i) => { const img = document.createElement('img'); img.className = 'detailImage'; img.src = src; img.alt = `提示词效果参考图 ${i + 1}`; enableImageViewer(img); $('detailImages').append(img); });
  $('detailTags').replaceChildren(); for (const tag of p.tags) { const el = document.createElement('span'); el.className = 'tag'; el.textContent = tag; $('detailTags').append(el); }
  const trashed = !!p.deletedAt; $('detailEdit').hidden = $('detailExport').hidden = $('detailCopy').hidden = $('detailFavorite').hidden = trashed; $('detailRestore').hidden = !trashed;
  $('detailDelete').textContent = trashed ? '永久删除' : '删除'; $('detailFavorite').textContent = p.favorite ? '★ 已收藏' : '☆ 收藏';
  $('detailFavorite').onclick = async () => { try { await save(prompts.map(x => x.id === p.id ? {...x, favorite: !p.favorite} : x)); } catch { toast('保存失败'); } };
  $('detailRestore').onclick = async () => { try { await save(prompts.map(x => x.id === p.id ? {...x, deletedAt: null} : x)); currentId = null; render(); toast('已恢复提示词'); } catch { toast('恢复失败'); } };
  $('detailEdit').onclick = () => edit(p); $('detailExport').onclick = () => download([p]);
  $('detailCopy').onclick = async () => { try { await navigator.clipboard.writeText(p.content); await save(prompts.map(x => x.id === p.id ? {...x, useCount:(x.useCount || 0) + 1, lastUsedAt:new Date().toISOString()} : x)); toast('已复制提示词'); } catch { toast('复制失败，请重试'); } };
  $('detailDelete').onclick = async () => { if (confirm(trashed ? `永久删除“${p.title}”？此操作无法撤销。` : `将“${p.title}”移入回收站？`)) { try { await save(trashed ? prompts.filter(x => x.id !== p.id) : prompts.map(x => x.id === p.id ? {...x, deletedAt:new Date().toISOString()} : x)); selected.delete(p.id); currentId = null; render(); toast(trashed ? '已永久删除' : '已移入回收站'); } catch { toast('保存失败，请重试'); } } };
}
function render() {
  renderFolders(); const query = $('search').value.trim().toLowerCase();
  const visible = visiblePrompts();
  $('count').textContent = prompts.filter(p => !p.deletedAt).length; $('listTitle').textContent = ({all:'全部提示词',uncategorized:'未分类',favorites:'我的收藏',recent:'最近使用',frequent:'经常使用',trash:'回收站'})[view] || activeFolder?.at(-1) || '分类'; $('resultCount').textContent = `${visible.length} 条提示词`;
  $('exportAll').disabled = !prompts.some(p => !p.deletedAt); $('selectAll').hidden = $('exportSelected').hidden = $('compose').hidden = view === 'trash'; const selectionCount = prompts.filter(p => !p.deletedAt && selected.has(p.id)).length; $('compose').disabled = !selectionCount; $('compose').textContent = `组合复制 (${selectionCount})`; $('exportSelected').disabled = !selected.size; $('exportSelected').textContent = `导出选中 (${selected.size})`;
  $('selectAll').disabled = !visible.length; $('selectAll').textContent = visible.length && visible.every(p => selected.has(p.id)) ? '取消全选' : '全选';
  $('list').replaceChildren(); $('empty').hidden = visible.length > 0; $('emptyTitle').textContent = query ? '没有找到相关提示词' : '这里还没有提示词'; $('emptyText').textContent = query ? '试试其他关键词' : '新建或拖入文字，开始收藏';
  for (const [index, p] of visible.entries()) {
    const card = document.createElement('article'); card.className = 'card' + (p.id === currentId ? ' active' : ''); card.draggable = view !== 'trash';
    card.ondragstart = e => { dragData = {type:'prompt', id:p.id}; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.title); }; card.ondragend = () => { dragData = null; document.querySelectorAll('.dropTarget').forEach(el => el.classList.remove('dropTarget')); };
    card.onclick = () => { currentId = p.id; render(); };
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(p.id); check.setAttribute('aria-label', `选择 ${p.title}`); check.onclick = e => e.stopPropagation(); check.onchange = () => { check.checked ? selected.add(p.id) : selected.delete(p.id); render(); };
    const body = document.createElement('div'); body.className = 'cardBody'; const title = document.createElement('h3'); title.textContent = p.title + (p.favorite ? '　★' : ''); const content = document.createElement('p'); content.textContent = p.content; const path = document.createElement('div'); path.className = 'folderPath'; path.textContent = p.categoryPath?.length ? p.categoryPath.join(' / ') : '未分类'; body.append(title, content, path); card.append(check, body);
    if (['all', 'folder', 'uncategorized', 'favorites'].includes(view)) {
      const controls = document.createElement('div'); controls.className = 'promptOrder';
      for (const [direction, label, symbol] of [[-1, '上移', '↑'], [1, '下移', '↓']]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'promptOrderButton'; b.textContent = symbol; b.title = `${label}提示词`; b.setAttribute('aria-label', `${label}提示词 ${p.title}`); b.disabled = promptOrderSaving || index + direction < 0 || index + direction >= visible.length;
        b.onclick = async e => {
          e.stopPropagation(); if (promptOrderSaving) return;
          const neighbor = visible[index + direction]; if (!neighbor) return;
          const next = [...prompts], from = next.findIndex(item => item.id === p.id), to = next.findIndex(item => item.id === neighbor.id);
          if (from < 0 || to < 0) return;
          [next[from], next[to]] = [next[to], next[from]]; promptOrderSaving = true; controls.querySelectorAll('button').forEach(button => button.disabled = true);
          try { await save(next); } catch { toast('排序保存失败，请重试'); } finally { promptOrderSaving = false; render(); }
        };
        controls.append(b);
      }
      card.append(controls);
    }
    $('list').append(card);
  }
  renderDetail();
}
for (const id of ['all','uncategorized','favorites','recent','frequent','trash']) $(id).onclick = () => { view = id; activeFolder = id === 'uncategorized' ? [] : null; currentId = null; render(); };
setDropTarget($('all'), [], true); setDropTarget($('uncategorized'), []);
const center = document.querySelector('.center'); center.addEventListener('dragover', e => { if (!dragData && e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); center.classList.add('dropTarget'); } }); center.addEventListener('dragleave', e => { if (!center.contains(e.relatedTarget)) center.classList.remove('dropTarget'); }); center.addEventListener('drop', e => { if (dragData) return; e.preventDefault(); center.classList.remove('dropTarget'); const text = e.dataTransfer.getData('text/plain').trim(); if (text) { edit(); $('content').value = text; $('title').value = text.split(/\r?\n/)[0].slice(0,40); toast('请确认内容并保存'); } });

function enableImageViewer(img) {
  img.title = '双击查看原图'; img.tabIndex = 0;
  img.addEventListener('dblclick', event => { event.stopPropagation(); openImageViewer(img.src); });
  img.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openImageViewer(img.src); } });
}
function openImageViewer(src) {
  const image = $('viewerImage'); image.onload = () => { $('viewerDimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight}`; }; image.src = src;
  $('viewerDimensions').textContent = ''; $('viewerStatus').textContent = ''; $('viewerCanvas').classList.remove('actualSize'); $('viewerZoom').textContent = '查看原始尺寸'; $('imageViewer').showModal();
}
$('viewerClose').onclick = () => $('imageViewer').close();
$('viewerZoom').onclick = () => { const actual = $('viewerCanvas').classList.toggle('actualSize'); $('viewerZoom').textContent = actual ? '适应窗口' : '查看原始尺寸'; };
$('viewerCopy').onclick = async () => {
  const img = $('viewerImage'); if (!img.complete || !img.naturalWidth) { $('viewerStatus').textContent = '图片尚未加载完成'; return; }
  try {
    // Clipboard image support is PNG; preserve PNG bytes and convert other formats at their original dimensions.
    const png = img.src.startsWith('data:image/png;') ? fetch(img.src).then(r => r.blob()) : new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d'); if (!context) { reject(new Error('图片处理失败')); return; }
      context.drawImage(img, 0, 0); canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败')), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({'image/png': png})]); $('viewerStatus').textContent = '图片已复制';
  } catch { $('viewerStatus').textContent = '复制图片失败，请重试'; }
};
function renderImageDraft() {
  const grid = $('imagePreviews'); grid.replaceChildren();
  draftImages.forEach((src, i) => { const item = document.createElement('div'); item.className = 'imagePreviewItem'; const img = document.createElement('img'); img.src = src; img.alt = `参考图 ${i + 1}`; enableImageViewer(img); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'imageRemove'; remove.textContent = '×'; remove.title = '移除图片'; remove.setAttribute('aria-label', `移除参考图 ${i + 1}`); remove.onclick = () => { draftImages.splice(i, 1); renderImageDraft(); }; const controls = document.createElement('div'); controls.className = 'imageOrder'; for (const [delta, label, glyph] of [[-1,'左移','←'],[1,'右移','→']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = glyph; b.title = label; b.setAttribute('aria-label', `${label}参考图 ${i + 1}`); b.disabled = i + delta < 0 || i + delta >= draftImages.length; b.onclick = () => { [draftImages[i], draftImages[i + delta]] = [draftImages[i + delta], draftImages[i]]; renderImageDraft(); }; controls.append(b); } item.append(img, remove, controls); grid.append(item); });
}
function loadImages(files) {
  const batch = [...files]; if (!batch.length) return;
  const revision = imageRevision; pendingImages++; imageLoading = true; $('imageDrop').classList.add('imageLoading');
  imageQueue = imageQueue.then(async () => {
    let added = 0, rejected = 0, duplicateHere = 0, reused = 0;
    for (const file of batch) {
      if (revision !== imageRevision) return;
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) { rejected++; continue; }
      try {
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = data; });
        if (revision !== imageRevision) return; if (draftImages.includes(data)) { duplicateHere++; continue; } if (prompts.some(p => getImages(p).includes(data))) reused++; draftImages.push(data); added++; renderImageDraft();
      } catch { rejected++; }
    }
    if (revision === imageRevision) $('imageNotice').textContent = `已添加 ${added} 张${reused ? `，其中 ${reused} 张与已有图片相同，将共用存储` : ''}${duplicateHere ? `，跳过 ${duplicateHere} 张本提示词中已有的图片` : ''}${rejected ? `，${rejected} 张格式不支持或超过 8 MB` : ''}。保存后生效。`;
  }).finally(() => { if (revision === imageRevision) { pendingImages--; imageLoading = pendingImages > 0; if (!imageLoading) $('imageDrop').classList.remove('imageLoading'); } });
}
$('imageDrop').onclick = () => $('imageFile').click();
$('imageDrop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('imageFile').click(); } };
$('imageFile').onchange = e => { loadImages(e.target.files); e.target.value = ''; };
$('editor').addEventListener('paste', e => { const files = [...e.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean); if (files.length) { e.preventDefault(); loadImages(files); } });
$('imageDrop').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; $('imageDrop').classList.add('dragging'); } });
$('imageDrop').addEventListener('dragleave', () => $('imageDrop').classList.remove('dragging'));
$('imageDrop').addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); $('imageDrop').classList.remove('dragging'); const files = [...e.dataTransfer.files]; if (files.length) loadImages(files); else toast('请拖入图片文件'); });
function reorderSelection(ids) { selected = new Set(ids); }
function renderSelection(ids) {
  $('selectionCount').textContent = `(${ids.length})`; const list = $('selectionList'); list.replaceChildren();
  ids.forEach((id, i) => {
    const p = prompts.find(x => x.id === id), card = document.createElement('article'); card.className = 'selectionCard';
    const top = document.createElement('div'); top.className = 'selectionCardTop';
    const number = document.createElement('span'); number.className = 'selectionNumber'; number.textContent = String(i + 1).padStart(2, '0');
    const title = document.createElement('span'); title.className = 'selectionTitle'; title.textContent = p.title; title.title = p.title;
    const move = (delta, label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = delta < 0 ? '↑' : '↓'; b.setAttribute('aria-label', `${label} ${p.title}`); b.title = label; b.disabled = i + delta < 0 || i + delta >= ids.length; b.onclick = () => { [ids[i], ids[i + delta]] = [ids[i + delta], ids[i]]; reorderSelection(ids); render(); }; return b; };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `取消选择 ${p.title}`); remove.title = '取消选择'; remove.onclick = () => { selected.delete(id); render(); };
    top.append(number, title, move(-1, '上移'), move(1, '下移'), remove);
    const path = document.createElement('div'); path.className = 'selectionPath'; path.textContent = p.categoryPath?.length ? p.categoryPath.join(' / ') : '未分类';
    const excerpt = document.createElement('div'); excerpt.className = 'selectionExcerpt'; excerpt.textContent = p.content;
    card.append(top, path, excerpt); if (getImages(p).length) { const gallery = document.createElement('div'); gallery.className = 'selectionGallery'; getImages(p).forEach((src, i) => { const img = document.createElement('img'); img.className = 'selectionImage'; img.src = src; img.alt = `${p.title}的效果参考图 ${i + 1}`; enableImageViewer(img); gallery.append(img); }); card.append(gallery); } list.append(card);
  });
}
$('clearSelection').onclick = () => { selected.clear(); render(); };
$('openComposer').onclick = () => $('compose').click();
function renderComposer() {
  const list = $('composeList'); list.replaceChildren();
  composeIds = composeIds.filter(id => prompts.some(p => p.id === id && !p.deletedAt));
  composeIds.forEach((id, i) => {
    const p = prompts.find(x => x.id === id), row = document.createElement('div'); row.className = 'composeItem';
    const number = document.createElement('span'); number.className = 'composeNumber'; number.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'composeName'; name.textContent = p.title; name.title = (p.categoryPath || []).join(' / ') || '未分类';
    const move = (direction, label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = direction < 0 ? '↑' : '↓'; b.title = label; b.setAttribute('aria-label', `${label} ${p.title}`); b.disabled = i + direction < 0 || i + direction >= composeIds.length; b.onclick = () => { [composeIds[i], composeIds[i + direction]] = [composeIds[i + direction], composeIds[i]]; reorderSelection(composeIds); render(); renderComposer(); }; return b; };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = '从组合移除'; remove.setAttribute('aria-label', `从组合移除 ${p.title}`); remove.onclick = () => { composeIds.splice(i, 1); selected.delete(id); render(); renderComposer(); };
    row.append(number); if (getImages(p).length) { const img = document.createElement('img'); img.className = 'composeImage'; img.src = getImages(p)[0]; img.alt = `${p.title}的效果参考图，共 ${getImages(p).length} 张`; enableImageViewer(img); row.append(img); } row.append(name, move(-1, '上移'), move(1, '下移'), remove); list.append(row);
  });
  const separator = $('composeSeparator').value.replace(/\\n/g, '\n');
  $('composePreview').value = composeIds.map(id => prompts.find(p => p.id === id).content).join(separator);
  $('composeCopy').disabled = !composeIds.length;
}
$('compose').onclick = () => { composeIds = [...selected].filter(id => prompts.some(p => p.id === id && !p.deletedAt)); renderComposer(); $('composeDialog').showModal(); };
$('composeSeparator').onchange = renderComposer;
$('composeClose').onclick = $('composeCancel').onclick = () => $('composeDialog').close();
$('composeCopy').onclick = async () => {
  if (!composeIds.length) return;
  try { await navigator.clipboard.writeText($('composePreview').value); } catch { toast('复制失败，请重试'); return; }
  const ids = new Set(composeIds), now = new Date().toISOString();
  try { await save(prompts.map(p => ids.has(p.id) ? {...p, useCount:(p.useCount || 0) + 1, lastUsedAt:now} : p)); } catch { toast('已复制，但使用记录保存失败'); return; }
  $('composeDialog').close(); toast(`已复制 ${ids.size} 条组合提示词`);
};
$('createCategory').onclick = async () => {
  const input = $('newCategoryName'), name = input.value.trim();
  if (!name) { toast('请输入新分类名称'); input.focus(); return; }
  const parent = JSON.parse($('category').value), path = [...parent, name];
  if (folders.some(f => key(f) === key(path))) { toast('该上级分类下已存在同名分类'); return; }
  const next = folders.map(f => [...f]); addPath(next, path);
  try { await saveAll(prompts, next); parent.forEach((_, i) => expanded.add(key(parent.slice(0, i + 1)))); updateCategoryOptions(path); input.value = ''; toast('分类已创建并选中'); } catch { toast('创建分类失败，请重试'); }
};
$('newFolder').onclick = async () => {
  const parent = activeFolder?.length ? activeFolder : [];
  const name = prompt(parent.length ? `在“${parent.join(' / ')}”下新建子分类：` : '新建一级分类：');
  if (name === null) return; const clean = name.trim(); if (!clean) { toast('分类名称不能为空'); return; }
  const path = [...parent, clean]; if (folders.some(p => key(p) === key(path))) { toast('该分类已存在'); return; }
  try { const next = folders.map(p => [...p]); addPath(next, path); await saveAll(prompts, next); activeFolder = path; view = 'folder'; if (parent.length) expanded.add(key(parent)); render(); } catch { toast('保存失败，请重试'); }
};
$('renameFolder').onclick = async () => {
  if (!activeFolder?.length) return; const name = prompt('输入新的分类名称：', activeFolder.at(-1)); if (name === null) return;
  const clean = name.trim(); if (!clean) { toast('分类名称不能为空'); return; } const old = activeFolder, nextPath = [...old.slice(0,-1), clean];
  if (key(old) === key(nextPath)) return; if (folders.some(p => key(p) === key(nextPath))) { toast('同级分类名称已存在'); return; }
  const replace = p => startsWithPath(p, old) ? [...nextPath, ...p.slice(old.length)] : p;
  try { await saveAll(prompts.map(p => ({...p, categoryPath: replace(p.categoryPath || [])})), folders.map(replace)); activeFolder = nextPath; render(); } catch { toast('保存失败，请重试'); }
};
$('deleteFolder').onclick = async () => {
  if (!activeFolder?.length) return; const old = activeFolder;
  if (!confirm(`删除“${old.join(' / ')}”及其子分类？其中的提示词会移到未分类，不会删除。`)) return;
  try { await saveAll(prompts.map(p => startsWithPath(p.categoryPath || [], old) ? {...p, categoryPath: []} : p), folders.filter(p => !startsWithPath(p, old))); activeFolder = null; view = 'all'; render(); } catch { toast('保存失败，请重试'); }
};
$('add').onclick = () => edit(); $('close').onclick = $('cancel').onclick = () => $('editor').close(); $('search').oninput = render;
$('form').onsubmit = async event => { event.preventDefault(); if (imageLoading) { toast('图片正在读取，请稍候'); return; } const title = $('title').value.trim(), content = $('content').value.trim(); if (!title || !content) { toast('请填写标题和提示词内容'); return; } const tags = [...new Set($('tags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean))]; const existing = prompts.find(p => p.id === editing); const item = { ...existing, id: editing || uid(), title, content, tags, image: null, images: [...draftImages], categoryPath: JSON.parse($('category').value), createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }; try { await save(existing ? prompts.map(p => p.id === editing ? item : p) : [item, ...prompts]); currentId = item.id; $('editor').close(); render(); toast('保存成功'); } catch { toast('保存失败，请重试'); } };
$('selectAll').onclick = () => { const visible = visiblePrompts(); const all = visible.every(p => selected.has(p.id)); visible.forEach(p => all ? selected.delete(p.id) : selected.add(p.id)); render(); };
$('exportAll').onclick = () => { const items = prompts.filter(p => !p.deletedAt); if (items.length) download(items, true); }; $('exportSelected').onclick = () => { const items = prompts.filter(p => !p.deletedAt && selected.has(p.id)); if (items.length) download(items); };
$('imageLibrary').onclick = () => {
  const byImage = new Map();
  for (const p of prompts) for (const src of new Set(getImages(p))) { if (!byImage.has(src)) byImage.set(src, []); byImage.get(src).push(p); }
  $('librarySummary').textContent = `共 ${byImage.size} 张不同图片，关联 ${prompts.filter(p => getImages(p).length).length} 条提示词（含回收站）。`;
  const grid = $('libraryGrid'); grid.replaceChildren();
  if (!byImage.size) { const empty = document.createElement('p'); empty.className = 'libraryEmpty'; empty.textContent = '还没有参考图，可以在新建或编辑提示词时添加。'; grid.append(empty); }
  for (const [src, owners] of byImage) {
    const card = document.createElement('article'); card.className = 'libraryCard';
    const img = document.createElement('img'); img.src = src; img.alt = '效果参考图'; enableImageViewer(img); card.append(img);
    const label = document.createElement('p'); label.className = 'libraryCardLabel'; label.textContent = `关联 ${owners.length} 条提示词`; card.append(label);
    const links = document.createElement('div'); links.className = 'libraryLinks';
    for (const p of owners) { const link = document.createElement('button'); link.type = 'button'; link.textContent = p.title + (p.deletedAt ? '（回收站）' : ''); link.title = (p.categoryPath || []).join(' / ') || '未分类'; link.onclick = () => {
      $('libraryDialog').close(); selected.clear(); $('search').value = ''; currentId = p.id;
      if (p.deletedAt) { view = 'trash'; activeFolder = null; }
      else if (p.categoryPath?.length) { view = 'folder'; activeFolder = p.categoryPath; p.categoryPath.forEach((_, i) => expanded.add(key(p.categoryPath.slice(0, i + 1)))); }
      else { view = 'uncategorized'; activeFolder = []; }
      render();
    }; links.append(link); }
    card.append(links); grid.append(card);
  }
  $('libraryDialog').showModal();
};
$('libraryClose').onclick = () => $('libraryDialog').close();
$('cleanImages').onclick = async () => {
  const control = $('cleanImages'); control.disabled = true;
  try {
    const before = prompts.reduce((sum, p) => sum + getImages(p).length, 0);
    const next = prompts.map(p => { const images = [...new Set(getImages(p))]; return {...p, image: null, images}; });
    const after = next.reduce((sum, p) => sum + p.images.length, 0);
    const unique = new Set(next.flatMap(p => p.images)).size;
    await saveAll(next, folders);
    alert(`图片整理完成：移除同一提示词内 ${before - after} 张重复图；${after} 处引用共用 ${unique} 张不同图片。`);
  } catch { toast('整理失败，原有数据未更改'); } finally { control.disabled = false; }
};
$('importBtn').onclick = () => $('file').click();
$('file').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { let parsed; try { parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON'); } const { added, skipped } = parsePromptImport(parsed, prompts, uid); { const nextFolders = folders.map(p => [...p]); added.forEach(p => addPath(nextFolders, p.categoryPath || [])); if (parsed?.format === 'prompt-library' && Array.isArray(parsed.folders)) parsed.folders.filter(p => Array.isArray(p) && p.length && p.every(x => typeof x === 'string' && x.trim())).forEach(p => addPath(nextFolders, p.map(x => x.trim()))); if (added.length || nextFolders.length !== folders.length) await saveAll([...added, ...prompts], nextFolders); } toast(`导入 ${added.length} 条，跳过 ${skipped} 条重复记录；相同图片共用存储`); } catch (err) { toast(`导入失败：${err.message || '文件无法读取'}`); } finally { e.target.value = ''; } };
(async () => { try { const result = await chrome.storage.local.get(['prompts', 'folders', 'imageBlobs']); prompts = decodeStorage(Array.isArray(result.prompts) ? result.prompts : [], result.imageBlobs || {}); folders = Array.isArray(result.folders) ? result.folders : []; prompts.forEach(p => addPath(folders, p.categoryPath || [])); storageReady = true; render(); } catch { toast('读取本地数据失败，已停止保存以保护数据'); } })();

