'use strict';
// Accept only recognizable prompt fields and known collection containers.
function parsePromptImport(input, existing = [], makeId = () => crypto.randomUUID()) {
  const rows = [];
  const containers = new Set(['prompts', 'data', 'items', 'entries', 'favorites', 'favourites', 'collections', 'groups', 'categories', 'list', 'records']);
  const titleKeys = ['title', 'name', 'label', '标题', '名称'];
  const contentKeys = ['content', 'prompt', 'text', 'body', 'template', 'value', '提示词', '内容'];
  const firstText = (obj, keys) => keys.map(k => obj[k]).find(v => typeof v === 'string' && v.trim());
  function collect(node, depth = 0) {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(item => collect(item, depth + 1)); return; }
    if (firstText(node, contentKeys)) { rows.push(node); return; }
    for (const [key, value] of Object.entries(node)) {
      if (containers.has(key.toLowerCase()) && value && typeof value === 'object') collect(value, depth + 1);
    }
  }
  // 白无常 AI 提示词宝典 backups store prompt records in ID-keyed maps.
  if (input && input.format === 'bwc-prompts-backup' && input.userData && typeof input.userData === 'object') {
    for (const key of ['customPrompts', 'editedBuiltInPrompts']) {
      const collection = input.userData[key];
      if (collection && typeof collection === 'object') Object.values(collection).forEach(item => collect(item));
    }
  } else {
    collect(input);
  }
  if (!rows.length) throw new Error('没有识别到提示词，请检查 JSON 的字段格式');
  const ownFormat = input && !Array.isArray(input) && input.format === 'prompt-library';
  const ids = new Set(existing.map(p => p.id));
  const signatures = new Set(existing.map(p => `${p.title.trim()}\u0000${p.content.trim()}`));
  const added = []; let skipped = 0;
  for (const row of rows) {
    const content = firstText(row, contentKeys).trim();
    const title = (firstText(row, titleKeys) || content.split(/\r?\n/)[0].slice(0, 40)).trim();
    const signature = `${title}\u0000${content}`;
    const originalId = ownFormat && typeof row.id === 'string' && row.id ? row.id : null;
    if ((originalId && ids.has(originalId)) || signatures.has(signature)) { skipped++; continue; }
    const rawTags = row.tags ?? row.tag ?? row.labels ?? row.标签 ?? [];
    const tags = (Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? rawTags.split(/[,，]/) : []).filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean);
    if (input?.format === 'bwc-prompts-backup' && typeof row.category === 'string' && row.category.trim()) tags.push(row.category.trim());
    const now = new Date().toISOString();
    const item = { id: originalId || makeId(), title, content, tags: [...new Set(tags)], createdAt: typeof row.createdAt === 'string' ? row.createdAt : now, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : now };
    if (ownFormat && Array.isArray(row.images)) item.images = row.images.filter(image => typeof image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(image) && image.length <= 12 * 1024 * 1024);
    if (ownFormat && !Array.isArray(row.images) && typeof row.image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(row.image) && row.image.length <= 12 * 1024 * 1024) item.image = row.image;
    if (ownFormat) { item.favorite = row.favorite === true; item.useCount = Number.isSafeInteger(row.useCount) && row.useCount > 0 ? row.useCount : 0; if (typeof row.lastUsedAt === 'string') item.lastUsedAt = row.lastUsedAt; }
    if (ownFormat && Array.isArray(row.categoryPath) && row.categoryPath.every(x => typeof x === 'string' && x.trim())) item.categoryPath = row.categoryPath.map(x => x.trim());
    else if (input?.format === 'bwc-prompts-backup' && typeof row.category === 'string' && row.category.trim()) item.categoryPath = [row.category.trim()];
    ids.add(item.id); signatures.add(signature); added.push(item);
  }
  return { added, skipped };
}
if (typeof module !== 'undefined') module.exports = { parsePromptImport };
