'use strict';
const $ = selector => document.querySelector(selector);
const paths = {
  search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2v3l2 3 3 1 2 2 3-2h3l2-3-1-3 1-3-3-2-1-3-3 1Z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  link: '<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  retry: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name] || paths.play;
  return svg;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(iconName, label, className) {
  const node = el('button', className);
  node.type = 'button';
  node.append(icon(iconName), el('span', '', label));
  return node;
}
function buttonState(node, iconName, label) {
  node.replaceChildren(icon(iconName), el('span', '', label));
}
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon));
let currentJob = null;
let jobTimer;
let libraryTimer;
let toastTimer;
let requestNumber = 0;
let isSubmitting = false;
let selectedMatch = 0;
let expandedCandidates = false;
let selectedCandidate = null;
let library = [];
let librarySignature = '';
let libraryLoad = 0;
const saving = new Set();
let selections = [];
let selectionsExpanded = false;
let selectionSubmitting = false;
let selectionLoad = 0;
const removingSelections = new Set();
const libraryRows = new Map();
const activeStatuses = ['queued', 'recognizing', 'searching'];
const previewBox = $('#preview');

function youtubeVideoId(candidate) {
  if (/^[A-Za-z0-9_-]{11}$/.test(candidate.youtube_id || '')) return candidate.youtube_id;
  try {
    const url = new URL(candidate.source_url);
    let value = '';
    if (url.hostname === 'youtu.be') value = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      value = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(value || '') ? value : '';
  } catch { return ''; }
}

const API_BASE = String(window.MUSIC_API_BASE || '').replace(/\/+$/, '');
let userToken = readStorage(localStorage, 'music_user_token');
let currentUser = null;
let adminToken = readStorage(sessionStorage, 'music_admin_token');
let adminUsers = [];
let selectedAdminUser = null;
let adminRequestNumber = 0;
let initializing = false;
let exportTimer;
let exportRequestNumber = 0;
let exportRows = [];
let exportSignature = '';
let cleanupExportId = null;
let cleanupBusy = false;
const verifiedExports = new Set();
const watchingDownloads = new Set();
function readStorage(storage, key) {
  try { return storage.getItem(key) || ''; } catch { return ''; }
}
function backendUrl(path) {
  return new URL(`${API_BASE}${path}`, location.href).href;
}
function mediaUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = /^https?:\/\//i.test(value) ? new URL(value) : new URL(backendUrl(value));
    const backend = new URL(API_BASE || location.origin, location.href);
    return url.origin === backend.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
async function api(path, options = {}) {
  const {auth = 'user', ...requestOptions} = options;
  const headers = {...requestOptions.headers};
  const token = auth === 'admin' ? adminToken : auth === 'user' ? userToken : '';
  if (auth === 'user' && !token) throw new Error('正在准备曲库，请稍候。');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try { response = await fetch(backendUrl(path), {...requestOptions, headers, referrerPolicy: 'no-referrer'}); }
  catch { throw new Error('连接中断，请重试。'); }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch { throw new Error('服务没有响应，请重试。'); }
  if (!response.ok) {
    if (response.status === 401 && auth === 'user') showInvalidIdentity();
    if (response.status === 401 && auth === 'admin') clearAdmin();
    const error = new Error(typeof data.detail === 'string' ? data.detail : '请检查输入后重试。');
    error.status = response.status;
    throw error;
  }
  return data;
}
function showInvalidIdentity() {
  clearTimeout(jobTimer);
  clearTimeout(libraryTimer);
  pauseAll();
  const dialog = $('#identity-invalid-dialog');
  if (!dialog.open) dialog.showModal();
}
async function establishIdentity() {
  const establish = async () => {
    userToken = readStorage(localStorage, 'music_user_token');
    if (userToken) {
      currentUser = await api('/api/me');
      return;
    }
    let requestId = readStorage(localStorage, 'music_init_request');
    if (!requestId) {
      requestId = crypto.randomUUID();
      try { localStorage.setItem('music_init_request', requestId); }
      catch { throw new Error('请允许浏览器保存网站资料，以保留你的曲库。'); }
    }
    const result = await api('/api/session', {auth: 'none', method: 'POST', body: JSON.stringify({request_id: requestId})});
    localStorage.setItem('music_user_token', result.token);
    userToken = result.token;
    currentUser = result.user;
  };
  if (navigator.locks) await navigator.locks.request('tingjian-user-session', establish);
  else await establish();
}
function clearOwnLibrary() {
  pauseAll();
  clearTimeout(jobTimer);
  clearTimeout(libraryTimer);
  library = [];
  librarySignature = '';
  libraryLoad++;
  renderBatchProgress(null);
  libraryRows.clear();
  selectionLoad++;
  selections = [];
  selectionsExpanded = false;
  selectionSubmitting = false;
  removingSelections.clear();
  saving.clear();
  $('#selection-status').textContent = '';
  renderSelections();
  $('#library-list').replaceChildren();
  $('#library-total').textContent = '';
  currentJob = null;
  $('#job-section').hidden = true;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
function duration(seconds) {
  if (!Number.isFinite(Number(seconds)) || !seconds) return '';
  const total = Math.floor(Number(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function rememberJob(job) {
  currentJob = job;
  try { localStorage.setItem('tingjian_job', String(job.id)); } catch { /* Storage may be disabled. */ }
  renderJob(job);
  scheduleJob(job);
}
function pauseAll(except) {
  document.querySelectorAll('audio').forEach(audio => { if (audio !== except) audio.pause(); });
  if (!except || !previewBox.contains(except)) closePreview();
}
function closePreview() {
  previewBox.querySelectorAll('audio').forEach(audio => audio.pause());
  previewBox.replaceChildren();
  previewBox.hidden = true;
  $('#preview-home').append(previewBox);
}
function resetResults() {
  selectedMatch = 0;
  selectedCandidate = null;
  expandedCandidates = false;
  closePreview();
}
function submitting(value) {
  isSubmitting = value;
  $('#recognize-button').disabled = value;
  $('#clip-open').disabled = value;
  buttonState($('#recognize-button'), 'search', value ? '请稍候' : '找歌');
}
async function startJob(event) {
  event?.preventDefault();
  const text = $('#source-text').value.trim();
  if (!text || isSubmitting) return;
  if (currentJob && activeStatuses.includes(currentJob.status) && currentJob.source === text) return;
  const number = ++requestNumber;
  submitting(true);
  clearTimeout(jobTimer);
  resetResults();
  try {
    const job = await api('/api/jobs', {method: 'POST', body: JSON.stringify({text})});
    if (number === requestNumber) rememberJob(job);
  } catch (error) {
    if (number !== requestNumber) return;
    currentJob = null;
    try { localStorage.removeItem('tingjian_job'); } catch { /* Storage may be disabled. */ }
    $('#job-section').hidden = false;
    $('#job-title').textContent = '没有找到';
    $('#job-status').textContent = error.message;
    $('#job-status').className = 'status error';
    $('#retry-job').hidden = false;
    $('#sample-preview').hidden = true;
    $('#more-candidates').hidden = true;
    $('#candidates').replaceChildren();
    $('#matches').replaceChildren();
  } finally { if (number === requestNumber) submitting(false); }
}
function scheduleJob(job) {
  clearTimeout(jobTimer);
  if (!activeStatuses.includes(job.status)) return;
  jobTimer = setTimeout(async () => {
    try {
      const updated = await api(`/api/jobs/${encodeURIComponent(job.id)}`);
      if (currentJob?.id !== job.id) return;
      currentJob = updated;
      renderJob(updated);
      scheduleJob(updated);
    } catch (error) {
      if (currentJob?.id !== job.id) return;
      $('#job-status').textContent = error.message;
      $('#job-status').className = 'status error';
      $('#retry-job').hidden = false;
    }
  }, 2000);
}
function renderJob(job) {
  $('#job-section').hidden = false;
  const statuses = {queued: '正在找歌…', recognizing: '正在认歌…', searching: '正在找完整版…', needs_clip: '请选一段有音乐的片段。', failed: '请重试。'};
  const match = job.matches?.[selectedMatch];
  $('#job-title').textContent = match?.title || job.title || '正在找歌';
  $('#job-status').textContent = job.error || statuses[job.status] || '';
  $('#job-status').className = `status${activeStatuses.includes(job.status) ? ' loading' : ''}${job.error ? ' error' : ''}`;
  $('#retry-job').hidden = !['needs_clip', 'failed'].includes(job.status);
  renderCandidates(job);
}
function matchedCandidates(job) {
  let candidates = job.candidates || [];
  if (job.matches?.length > 1) {
    const match = job.matches[selectedMatch];
    candidates = candidates.filter(candidate => candidate.match_index !== undefined ? Number(candidate.match_index) === selectedMatch : candidate.match_id !== undefined ? String(candidate.match_id) === String(match.id ?? match.provider_id ?? selectedMatch) : true);
  }
  return candidates;
}
function savedItem(candidate) {
  const kind = candidate.download_allowed ? 'file' : 'link';
  return library.find(item => item.source_url === candidate.source_url && item.source === candidate.source && item.kind === kind);
}
function updateCandidateSaveButton(node, candidate) {
  const item = savedItem(candidate);
  const file = candidate.download_allowed;
  const pending = file && selections.some(selection => selection.candidate_id === candidate.id);
  const working = item && ['downloading', 'importing', 'queued', 'cloud_queued'].includes(item.status);
  let label = file ? '选入' : '收藏';
  let symbol = file ? 'plus' : 'link';
  if (saving.has(candidate.id)) label = file ? '选入中' : '保存中';
  else if (item?.status === 'ready') { label = '已保存'; symbol = 'check'; }
  else if (working) { label = ['cloud_queued', 'queued'].includes(item.status) ? '已排队' : '保存中'; symbol = 'download'; }
  else if (pending) { label = '已选'; symbol = 'check'; }
  buttonState(node, symbol, label);
  node.disabled = Boolean(pending || working || item?.status === 'ready' || saving.has(candidate.id) || (file && selectionSubmitting));
  node.setAttribute('aria-label', `${label === '选入' ? '选入待下载' : label} ${candidate.title}`);
}
function refreshCandidateSaveButtons(job) {
  const candidates = new Map((job.candidates || []).map(candidate => [candidate.id, candidate]));
  $('#candidates').querySelectorAll('[data-save-candidate]').forEach(node => {
    const candidate = candidates.get(node.dataset.saveCandidate);
    if (candidate) updateCandidateSaveButton(node, candidate);
  });
}
function renderCandidates(job) {
  closePreview();
  $('#matches').replaceChildren();
  if (job.matches?.length > 1) {
    job.matches.forEach((match, index) => {
      const node = button('play', match.title, `match-button${selectedMatch === index ? ' active' : ''}`);
      node.setAttribute('aria-pressed', String(index === selectedMatch));
      node.addEventListener('click', () => { selectedMatch = index; expandedCandidates = false; closePreview(); renderJob(job); });
      $('#matches').append(node);
    });
  }
  const matches = matchedCandidates(job);
  const sample = matches.find(candidate => candidate.source === '识别结果' && safeUrl(candidate.preview_url));
  $('#sample-preview').hidden = !sample;
  $('#sample-preview').onclick = sample ? event => showPreview(sample, $('#sample-preview'), event.currentTarget) : null;
  const versions = matches.filter(candidate => candidate !== sample);
  const visible = expandedCandidates ? versions : versions.slice(0, 1);
  $('#candidates').replaceChildren();
  visible.forEach(candidate => {
    const card = el('article', `candidate${selectedCandidate === candidate.id ? ' selected' : ''}`);
    card.dataset.candidateId = candidate.id;
    const info = el('div', 'track-info');
    info.append(el('div', 'track-title', candidate.title || '未命名音乐'));
    info.append(el('div', 'track-meta', [candidate.artist, candidate.version && candidate.version !== '版本待确认' ? candidate.version : '', candidate.source, duration(candidate.duration)].filter(Boolean).join(' · ')));
    const actions = el('div', 'track-actions');
    const preview = button('play', '试听', 'preview-button');
    preview.setAttribute('aria-label', `试听 ${candidate.title}`);
    preview.disabled = !youtubeVideoId(candidate) && !safeUrl(candidate.preview_url);
    if (preview.disabled) preview.title = '这个来源暂时没有可试听音源';
    preview.addEventListener('click', event => {
      selectedCandidate = candidate.id;
      $('#candidates').querySelectorAll('.candidate').forEach(node => node.classList.toggle('selected', node.dataset.candidateId === candidate.id));
      showPreview(candidate, card, event.currentTarget);
    });
    const save = button('download', '保存', 'primary');
    save.dataset.saveCandidate = candidate.id;
    updateCandidateSaveButton(save, candidate);
    save.addEventListener('click', () => saveCandidate(candidate, save));
    actions.append(preview, save);
    card.append(info, actions);
    $('#candidates').append(card);
  });
  $('#more-candidates').hidden = versions.length <= 1;
  $('#more-candidates').setAttribute('aria-expanded', String(expandedCandidates));
  buttonState($('#more-candidates'), expandedCandidates ? 'up' : 'down', expandedCandidates ? '收起' : '更多版本');
  if (job.status === 'ready' && !versions.length) $('#candidates').append(el('p', 'status', sample ? '暂未找到完整版。' : '暂未找到音乐，请重试。'));
}
function showPreview(candidate, host, trigger) {
  const videoId = youtubeVideoId(candidate);
  const audioUrl = safeUrl(candidate.preview_url);
  if (!videoId && !audioUrl) { toast('这个版本暂时无法试听，请换一个版本。'); return; }
  pauseAll();
  const box = previewBox;
  box.hidden = false;
  if (host === $('#sample-preview')) host.insertAdjacentElement('afterend', box);
  else (host || $('#preview-home')).append(box);
  const header = el('div', 'preview-head');
  const close = button('close', '', 'icon-button quiet');
  close.setAttribute('aria-label', '关闭试听');
  close.addEventListener('click', () => { closePreview(); trigger?.focus({preventScroll: true}); });
  header.append(el('span', '', candidate.title), close);
  box.append(header);
  if (videoId) {
    const frame = document.createElement('iframe');
    const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
    url.search = new URLSearchParams({autoplay: '1', playsinline: '1', rel: '0', origin: location.origin});
    frame.src = url.href;
    frame.title = `试听 ${candidate.title}`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    box.append(frame);
  } else if (audioUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = audioUrl;
    audio.preload = 'none';
    audio.addEventListener('play', () => pauseAll(audio));
    box.append(audio);
    audio.addEventListener('error', () => toast('这个版本暂时无法试听，请换一个版本。'));
    audio.play().catch(() => toast('请点击播放器中的播放按钮。'));
  }
  box.scrollIntoView({block: 'nearest', behavior: 'instant'});
}
async function saveCandidate(candidate, node) {
  if (saving.has(candidate.id) || (candidate.download_allowed && selectionSubmitting)) return;
  const token = userToken;
  const version = {job_id: currentJob.id, candidate_id: candidate.id};
  saving.add(candidate.id);
  updateCandidateSaveButton(node, candidate);
  updateSelectionControls();
  try {
    if (candidate.download_allowed) {
      const entry = await api('/api/selections', {method: 'POST', body: JSON.stringify(version)});
      if (token !== userToken) return;
      if (entry.id && entry.candidate_id && !entry.already_saved) {
        selectionLoad++;
        if (!selections.some(row => row.id === entry.id)) selections.push(entry);
        renderSelections();
        toast('已选入待下载');
      } else {
        await Promise.all([loadSelections(), loadLibrary()]);
        toast('这首歌已在我的音乐');
      }
    } else {
      await api('/api/library', {method: 'POST', body: JSON.stringify({...version, kind: 'link'})});
      if (token !== userToken) return;
      toast('链接已保存');
      await loadLibrary();
    }
  } catch (error) {
    if (token === userToken) {
      toast(error.message);
      if (candidate.download_allowed) await loadSelections();
    }
  } finally {
    if (token === userToken) {
      saving.delete(candidate.id);
      updateSelectionControls();
      if (currentJob) refreshCandidateSaveButtons(currentJob);
    }
  }
}

function updateSelectionControls() {
  $('#selection-submit').disabled = selectionSubmitting || !selections.length || saving.size > 0 || removingSelections.size > 0;
  $('#selection-list').querySelectorAll('[data-remove]').forEach(node => {
    node.disabled = selectionSubmitting || removingSelections.has(node.dataset.remove);
  });
}

function renderSelections() {
  const section = $('#selection-section');
  const list = $('#selection-list');
  const failedLoad = Boolean($('#selection-status').textContent);
  section.hidden = !selections.length && !failedLoad;
  $('#selection-retry').hidden = !failedLoad;
  $('#selection-submit').hidden = !selections.length;
  $('#selection-count').textContent = selections.length ? String(selections.length) : '';
  list.replaceChildren();
  if (selections.length <= 3) selectionsExpanded = false;
  const visible = selectionsExpanded ? selections : selections.slice(0, 3);
  for (const entry of visible) {
    const row = el('li');
    const info = el('div');
    info.append(el('div', 'track-title', entry.title || '未命名音乐'));
    if (entry.artist) info.append(el('div', 'track-meta', entry.artist));
    const remove = button('close', '', 'icon-button quiet');
    remove.dataset.remove = entry.id;
    remove.title = '移出待下载';
    remove.setAttribute('aria-label', `移出待下载 ${entry.title}`);
    remove.addEventListener('click', () => removeSelection(entry.id));
    row.append(info, remove);
    list.append(row);
  }
  const more = $('#selection-more');
  more.hidden = selections.length <= 3;
  more.setAttribute('aria-expanded', String(selectionsExpanded));
  buttonState(more, selectionsExpanded ? 'up' : 'down', selectionsExpanded ? '收起清单' : `查看全部 ${selections.length} 首`);
  updateSelectionControls();
  if (currentJob) refreshCandidateSaveButtons(currentJob);
}

async function loadSelections() {
  const ticket = ++selectionLoad;
  const token = userToken;
  try {
    const entries = await api('/api/selections');
    if (ticket !== selectionLoad || token !== userToken) return;
    selections = entries;
    $('#selection-status').textContent = '';
  } catch (error) {
    if (ticket !== selectionLoad || token !== userToken) return;
    $('#selection-status').textContent = error.message;
  }
  renderSelections();
}

async function removeSelection(id) {
  if (removingSelections.has(id) || selectionSubmitting) return;
  const token = userToken;
  const index = selections.findIndex(entry => entry.id === id);
  removingSelections.add(id);
  updateSelectionControls();
  try {
    await api(`/api/selections/${encodeURIComponent(id)}`, {method: 'DELETE'});
    if (token !== userToken) return;
    selectionLoad++;
    selections = selections.filter(entry => entry.id !== id);
    renderSelections();
    const controls = $('#selection-list').querySelectorAll('[data-remove]');
    (controls[Math.min(index, controls.length - 1)] || $('#source-text')).focus({preventScroll:true});
    toast('已移出待下载');
  } catch (error) {
    if (token === userToken) { toast(error.message); await loadSelections(); }
  } finally {
    if (token === userToken) { removingSelections.delete(id); updateSelectionControls(); }
  }
}

async function submitSelections() {
  if ($('#selection-submit').disabled) return;
  const ids = selections.map(entry => entry.id);
  const token = userToken;
  selectionSubmitting = true;
  updateSelectionControls();
  if (currentJob) refreshCandidateSaveButtons(currentJob);
  buttonState($('#selection-submit'), 'download', '提交中');
  try {
    const result = await api('/api/selections/submit', {method: 'POST', body: JSON.stringify({ids})});
    if (token !== userToken) return;
    const submitted = new Set(ids);
    selectionLoad++;
    selections = selections.filter(entry => !submitted.has(entry.id));
    renderSelections();
    toast(result.count ? `${result.count} 首已交后台下载，可以关掉网页` : '这些歌曲已处理');
  } catch (error) {
    if (token === userToken) toast(error.message);
  } finally {
    if (token === userToken) {
      await Promise.all([loadSelections(), loadLibrary()]);
      selectionSubmitting = false;
      buttonState($('#selection-submit'), 'download', '全部下载');
      updateSelectionControls();
      if (currentJob) refreshCandidateSaveButtons(currentJob);
    }
  }
}

$('#selection-more').addEventListener('click', () => { selectionsExpanded = !selectionsExpanded; renderSelections(); });
$('#selection-submit').addEventListener('click', submitSelections);
$('#selection-retry').addEventListener('click', loadSelections);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && userToken && !initializing && !selectionSubmitting && !saving.size && !removingSelections.size) {
    loadSelections();
    loadLibrary();
  }
});

function renderBatchProgress(batch) {
  const line = $('#batch-progress');
  const parts = [];
  if (batch && batch.total > 0) {
    parts.push('最近一批', `已下载 ${batch.ready}/${batch.total} 首`);
    if (batch.active) parts.push(`下载中 ${batch.active}`);
    parts.push(`排队 ${batch.queued}`);
    if (batch.failed) parts.push(`失败 ${batch.failed}`);
  }
  // Screen readers only need to announce real progress changes.
  if (line.textContent === parts.join(' · ')) return;
  line.replaceChildren();
  for (const [index, part] of parts.entries()) {
    if (index) line.append(' · ');
    line.append(el('span', '', part));
  }
}

function libraryStatusText(status) {
  if (status === 'ready') return '';
  if (['cloud_queued', 'queued'].includes(status)) return '已排队，会自动下载';
  return status === 'failed' ? '保存失败' : '正在保存…';
}
async function loadLibrary() {
  clearTimeout(libraryTimer);
  const ticket = ++libraryLoad;
  const token = userToken;
  try {
    const data = await api('/api/library?with_batch=true', {cache: 'no-store'});
    if (ticket !== libraryLoad || token !== userToken) return;
    const batch = data.batch || null;
    library = Array.isArray(data) ? data : data.items;
    renderBatchProgress(batch);
    const signature = JSON.stringify(library.map(({media_url, ...item}) => item));
    const changed = signature !== librarySignature;
    librarySignature = signature;
    $('#library-status').textContent = '';
    $('#library-retry').hidden = true;
    $('#library-total').textContent = library.length ? String(library.length) : '';
    if (changed) {
      renderLibrary();
      if (currentJob) {
        if (previewBox.hidden) renderCandidates(currentJob);
        else refreshCandidateSaveButtons(currentJob);
      }
    }
    if (batch?.active || library.some(item => ['downloading', 'importing', 'processing'].includes(item.status))) {
      libraryTimer = setTimeout(loadLibrary, 2000);
    } else if (batch?.queued || library.some(item => ['queued', 'cloud_queued'].includes(item.status))) {
      libraryTimer = setTimeout(loadLibrary, 10000);
    }
  } catch (error) {
    if (ticket !== libraryLoad || token !== userToken) return;
    $('#library-status').textContent = error.message;
    $('#library-status').className = 'status error';
    $('#library-retry').hidden = error.status === 401;
    if (!error.status || error.status === 429 || error.status >= 500) {
      libraryTimer = setTimeout(loadLibrary, 10000);
    }
  }
}
function createPlayer(item, row, adminUserId = null) {
  const audio = document.createElement('audio');
  audio.preload = 'none';
  const initialMedia = mediaUrl(item.media_url);
  if (initialMedia) audio.src = initialMedia;
  let playbackRefreshedAt = 0;
  const play = button('play', '', 'play-button');
  play.setAttribute('aria-label', `播放 ${item.title}`);
  play.setAttribute('aria-pressed', 'false');
  const controls = el('div', 'player');
  controls.hidden = true;
  const seek = document.createElement('input');
  seek.type = 'range'; seek.min = '0'; seek.max = String(item.duration || 1); seek.step = '0.1'; seek.value = '0';
  seek.setAttribute('aria-label', `${item.title} 播放进度`);
  const time = el('output');
  const updateTime = () => {
    const length = Number.isFinite(audio.duration) ? audio.duration : item.duration;
    seek.max = String(length || 1);
    seek.value = String(audio.currentTime);
    time.textContent = `${duration(audio.currentTime) || '0:00'} / ${duration(length) || '0:00'}`;
    seek.setAttribute('aria-valuetext', time.textContent);
  };
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('play', () => {
    pauseAll(audio);
    play.replaceChildren(icon('pause'));
    play.setAttribute('aria-label', `暂停 ${item.title}`);
    play.setAttribute('aria-pressed', 'true');
    controls.hidden = false;
  });
  audio.addEventListener('pause', () => {
    play.replaceChildren(icon('play'));
    play.setAttribute('aria-label', `播放 ${item.title}`);
    play.setAttribute('aria-pressed', 'false');
  });
  audio.addEventListener('error', () => toast('音乐无法播放，请重试。'));
  play.addEventListener('click', async () => {
    if (!audio.paused) { audio.pause(); return; }
    play.disabled = true;
    try {
      if (!playbackRefreshedAt || Date.now() - playbackRefreshedAt > 45 * 60 * 1000) {
        const endpoint = adminUserId ? `/api/admin/users/${encodeURIComponent(adminUserId)}/library/${encodeURIComponent(item.id)}/playback` : `/api/library/${encodeURIComponent(item.id)}/playback`;
        const playback = await api(endpoint, {auth: adminUserId ? 'admin' : 'user'});
        const url = mediaUrl(playback.media_url);
        if (!url) throw new Error('音乐地址无效，请重新加载。');
        const position = audio.currentTime;
        audio.src = url;
        if (position) audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, {once: true});
        playbackRefreshedAt = Date.now();
      }
      await audio.play();
    } catch (error) { toast(error.message || '音乐无法播放，请重试。'); }
    finally { play.disabled = false; }
  });
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); updateTime(); });
  updateTime();
  controls.append(seek, time);
  row.append(play);
  return {audio, controls};
}
function renderLibrary() {
  const query = $('#library-search').value.trim().toLocaleLowerCase();
  const list = $('#library-list');
  list.querySelector('.library-empty')?.remove();
  let visible = 0;
  library.forEach(item => {
    const {media_url, ...stableItem} = item;
    const signature = JSON.stringify(stableItem);
    let row = libraryRows.get(item.id);
    if (!row || row.dataset.signature !== signature) {
      const oldRow = row;
      if (oldRow?.contains(previewBox)) closePreview();
      row = el('article', 'library-row');
      row.dataset.signature = signature;
      let player;
      if (item.media_url && item.status === 'ready' && mediaUrl(item.media_url)) {
        player = createPlayer(item, row);
      } else if (item.kind === 'link' && safeUrl(item.source_url)) {
        const open = button('play', '', 'play-button');
        open.setAttribute('aria-label', `试听 ${item.title}`);
        open.addEventListener('click', event => showPreview(item, row, event.currentTarget));
        row.append(open);
      } else {
        const mark = el('span', 'play-button'); mark.setAttribute('aria-hidden', 'true'); mark.append(icon(item.status === 'failed' ? 'retry' : 'download')); row.append(mark);
      }
      const info = el('div', 'track-info');
      info.append(el('div', 'track-title', item.title || '未命名音乐'));
      info.append(el('div', 'track-meta', [item.artist, duration(item.duration), item.kind === 'link' ? '链接' : ''].filter(Boolean).join(' · ')));
      row.append(info);
      if (player) row.append(player.audio, player.controls);
      if (item.status !== 'ready') row.append(el('div', 'item-status', libraryStatusText(item.status)));
      if (item.error) row.append(el('div', 'item-error', item.error));
      if (item.status === 'failed' && item.kind === 'file' && item.source !== '本机文件') {
        const retry = button('retry', '重试', 'text-button retry-download');
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { await api(`/api/library/${encodeURIComponent(item.id)}/retry`, {method: 'POST'}); await loadLibrary(); }
          catch (error) { toast(error.message); retry.disabled = false; }
        });
        row.append(retry);
      }
      oldRow?.querySelector('audio')?.pause();
      if (oldRow) oldRow.replaceWith(row);
      else list.append(row);
      libraryRows.set(item.id, row);
    }
    row.hidden = ![item.title, item.artist, item.version].join(' ').toLocaleLowerCase().includes(query);
    if (!row.hidden) visible++;
  });
  for (const [id, row] of libraryRows) {
    if (!library.some(item => item.id === id)) {
      if (row.contains(previewBox)) closePreview();
      row.querySelector('audio')?.pause(); row.remove(); libraryRows.delete(id);
    }
  }
  if (!visible) list.append(el('p', 'library-empty', query ? '没有找到这首歌' : '保存的音乐会在这里'));
}
async function loadSettings() {
  try {
    const values = await api('/api/admin/settings', {auth: 'admin'});
    for (const key of ['acr', 'audd', 'youtube', 'jamendo']) $(`#${key}-state`).textContent = values[`${key}_configured`] ? '已连接' : '';
  } catch (error) { $('#settings-error').textContent = error.message; }
}
$('#recognize-form').addEventListener('submit', startJob);
$('#source-text').addEventListener('paste', () => setTimeout(() => { if (/https?:\/\//i.test($('#source-text').value)) startJob(); }, 0));
$('#retry-job').addEventListener('click', async () => {
  if (currentJob && activeStatuses.includes(currentJob.status)) {
    $('#job-status').textContent = '正在重新连接…';
    scheduleJob(currentJob);
  } else if (currentJob && !currentJob.source) $('#clip-file').click();
  else startJob();
});
$('#more-candidates').addEventListener('click', () => { expandedCandidates = !expandedCandidates; renderCandidates(currentJob); });
$('#clip-open').addEventListener('click', () => $('#clip-file').click());
$('#clip-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || isSubmitting) return;
  if (file.size > 100 * 1024 * 1024) { toast('片段不能超过 100 MB'); event.target.value = ''; return; }
  const number = ++requestNumber;
  submitting(true);
  clearTimeout(jobTimer);
  resetResults();
  $('#upload-status').hidden = false;
  $('#upload-status').textContent = '正在上传…';
  try {
    const data = new FormData(); data.append('file', file);
    const retryable = currentJob && !activeStatuses.includes(currentJob.status);
    const path = retryable ? `/api/jobs/${encodeURIComponent(currentJob.id)}/clip` : '/api/jobs/upload';
    const job = await api(path, {method: 'POST', body: data});
    if (number === requestNumber) rememberJob(job);
  } catch (error) { toast(error.message); }
  finally { if (number === requestNumber) submitting(false); $('#upload-status').hidden = true; event.target.value = ''; }
});
$('#search-toggle').addEventListener('click', () => {
  const show = $('#search-area').hidden;
  $('#search-area').hidden = !show;
  $('#search-toggle').setAttribute('aria-expanded', String(show));
  if (show) $('#library-search').focus();
  else { $('#library-search').value = ''; renderLibrary(); }
});
$('#library-search').addEventListener('input', renderLibrary);
$('#library-retry').addEventListener('click', loadLibrary);
function clearAdmin() {
  adminToken = '';
  try { sessionStorage.removeItem('music_admin_token'); } catch { /* Browser storage can be unavailable. */ }
  selectedAdminUser = null;
  adminRequestNumber++;
  $('#admin-library').querySelectorAll('audio').forEach(audio => audio.pause());
  $('#admin-library').replaceChildren();
  $('#admin-content').hidden = true;
  $('#admin-login-form').hidden = false;
  $('#admin-users').replaceChildren();
  $('#admin-user-detail').hidden = true;
  $('#admin-service-settings').open = false;
  resetExports();
}
function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
function lastSeen(value) {
  if (!value) return '未访问';
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}
function renderAdminUsers() {
  $('#admin-users').replaceChildren();
  for (const user of adminUsers) {
    const node = el('button', 'admin-user');
    node.type = 'button';
    node.setAttribute('aria-pressed', String(selectedAdminUser?.id === user.id));
    node.append(el('span', 'admin-user-name', user.display_name));
    node.append(el('span', 'admin-user-meta', `${user.collection_count} 首 · ${formatBytes(user.total_bytes)} · 最近 ${lastSeen(user.last_seen_at)}`));
    node.addEventListener('click', () => selectAdminUser(user));
    $('#admin-users').append(node);
  }
  if (!adminUsers.length) $('#admin-users').append(el('p', 'status', '暂时没有用户'));
}
async function loadAdminUsers() {
  $('#admin-status').textContent = '正在读取…';
  try {
    adminUsers = await api('/api/admin/users', {auth: 'admin'});
    $('#admin-login-form').hidden = true;
    $('#admin-content').hidden = false;
    $('#admin-status').textContent = '';
    renderAdminUsers();
    updateExportScopes();
    if (selectedAdminUser) {
      const user = adminUsers.find(row => row.id === selectedAdminUser.id);
      if (user) await selectAdminUser(user);
    }
    await loadSettings();
    if ($('#admin-export-section').open) await loadExports();
  } catch (error) {
    if (error.status === 401) $('#admin-login-error').textContent = '管理登录已过期，请重新输入密码。';
    else $('#admin-status').textContent = error.message;
  }
}
async function selectAdminUser(user) {
  const number = ++adminRequestNumber;
  $('#admin-library').querySelectorAll('audio').forEach(audio => audio.pause());
  selectedAdminUser = user;
  renderAdminUsers();
  $('#admin-user-detail').hidden = false;
  $('#admin-user-title').textContent = user.display_name;
  $('#admin-user-stats').textContent = `${user.collection_count} 首收藏 · ${user.file_count} 个文件 · ${formatBytes(user.total_bytes)}`;
  $('#admin-rename-form').hidden = true;
  $('#admin-library').replaceChildren(el('p', 'status', '正在读取…'));
  try {
    const items = await api(`/api/admin/users/${encodeURIComponent(user.id)}/library`, {auth: 'admin'});
    if (number !== adminRequestNumber) return;
    $('#admin-library').replaceChildren();
    for (const item of items) {
      const row = el('article', 'library-row');
      let player;
      if (item.status === 'ready' && item.kind === 'file' && mediaUrl(item.media_url)) player = createPlayer(item, row, user.id);
      else if (item.kind === 'link' && safeUrl(item.source_url)) {
        const link = el('a', 'play-button');
        link.href = safeUrl(item.source_url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `试听 ${item.title}`); link.append(icon('external')); row.append(link);
      } else {
        const mark = el('span', 'play-button'); mark.setAttribute('aria-hidden', 'true'); mark.append(icon('download')); row.append(mark);
      }
      const info = el('div', 'track-info');
      info.append(el('div', 'track-title', item.title));
      info.append(el('div', 'track-meta', [item.artist, duration(item.duration), libraryStatusText(item.status)].filter(Boolean).join(' · ')));
      row.append(info);
      if (player) row.append(player.audio, player.controls);
      $('#admin-library').append(row);
    }
    if (!items.length) $('#admin-library').append(el('p', 'status', '还没有收藏'));
  } catch (error) {
    if (number === adminRequestNumber && error.status !== 401) $('#admin-library').replaceChildren(el('p', 'error', error.message));
  }
}
function updateExportScopes() {
  const select = $('#export-scope');
  const previous = select.value;
  select.replaceChildren(el('option', '', '全部用户'));
  select.firstElementChild.value = '';
  for (const user of adminUsers) {
    const option = el('option', '', user.display_name);
    option.value = user.id;
    select.append(option);
  }
  select.value = adminUsers.some(user => user.id === previous) ? previous : '';
}
function resetExports() {
  clearTimeout(exportTimer);
  exportRequestNumber++;
  exportRows = [];
  exportSignature = '';
  cleanupExportId = null;
  verifiedExports.clear();
  watchingDownloads.clear();
  $('#export-list').replaceChildren();
  $('#export-status').textContent = '';
  $('#admin-export-section').open = false;
  if ($('#cleanup-dialog').open) $('#cleanup-dialog').close();
}
function exportScope(row) {
  return row.scope_user_id ? adminUsers.find(user => user.id === row.scope_user_id)?.display_name || '所选用户' : '全部用户';
}
function exportSummary(row) {
  const parts = [`${Number(row.file_count) || 0} 首音乐`];
  if (row.link_count) parts.push(`${row.link_count} 个链接`);
  parts.push(formatBytes(row.total_bytes));
  return parts.join(' · ');
}
function exportDownloaded(row) {
  return Boolean(row.downloaded || row.downloaded_at);
}
function renderExports() {
  const list = $('#export-list');
  list.replaceChildren();
  for (const row of exportRows.slice(0, 5)) {
    const card = el('article', 'export-card');
    const header = el('div', 'export-card-heading');
    header.append(el('strong', '', exportScope(row)), el('span', 'track-meta', lastSeen(row.created_at)));
    card.append(header, el('p', 'track-meta', exportSummary(row)));
    const status = {ready: exportDownloaded(row) ? 'ZIP 已传送完成' : '可以下载', downloading: '正在下载 ZIP…', downloaded: 'ZIP 已传送完成', cleaning: '正在清理…', cleanup_failed: '部分项目清理失败，可重试', cleaned: '已清理', failed: '导出未完成，请重试下载'}[row.status] || '正在处理…';
    card.append(el('p', 'status', status));
    if (row.error) card.append(el('p', 'error', row.error));
    const canDownload = !['cleaning', 'cleanup_failed', 'cleaned'].includes(row.status);
    if (canDownload) {
      const link = el('a', 'secondary export-download', row.status === 'downloading' ? '正在下载' : '下载 ZIP');
      link.prepend(icon('download'));
      const url = mediaUrl(row.download_url);
      if (url) link.href = url;
      link.setAttribute('download', '');
      link.setAttribute('aria-label', `下载 ${exportScope(row)} 的音乐 ZIP`);
      if (row.status === 'downloading') link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', async event => {
        event.preventDefault();
        if (row.status === 'downloading' || link.dataset.busy === 'true') return;
        link.dataset.busy = 'true';
        try {
          const latest = await api(`/api/admin/exports/${encodeURIComponent(row.id)}`, {auth: 'admin'});
          const downloadUrl = mediaUrl(latest.download_url);
          if (!downloadUrl) throw new Error('下载链接暂时不可用，请刷新导出记录。');
          const download = document.createElement('a');
          download.href = downloadUrl;
          download.setAttribute('download', '');
          download.hidden = true;
          document.body.append(download);
          download.click();
          download.remove();
          watchingDownloads.add(row.id);
          $('#export-status').textContent = '下载完成后，检查 pendrive 中的音乐。';
          clearTimeout(exportTimer);
          exportTimer = setTimeout(loadExports, 1500);
        } catch (error) { $('#export-status').textContent = error.message; }
        finally { link.dataset.busy = 'false'; }
      });
      card.append(link);
    }
    if (exportDownloaded(row) && !['downloading', 'cleaning', 'cleaned'].includes(row.status)) {
      const verify = el('label', 'export-verify');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = verifiedExports.has(row.id);
      verify.append(checkbox, el('span', '', row.file_count ? '已存入 pendrive，并确认能播放' : '已将导出清单存入 pendrive'));
      const clean = button('trash', row.status === 'cleanup_failed' ? '重试清理' : '清理已导出音乐', 'text-button cleanup-open');
      clean.disabled = !checkbox.checked;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) verifiedExports.add(row.id);
        else verifiedExports.delete(row.id);
        clean.disabled = !checkbox.checked;
      });
      clean.addEventListener('click', () => {
        if (!verifiedExports.has(row.id)) return;
        cleanupExportId = row.id;
        $('#cleanup-error').textContent = '';
        $('#cleanup-scope').textContent = exportScope(row);
        $('#cleanup-assurance').textContent = row.file_count ? '确认已存入 pendrive，并检查音乐能播放。' : '确认已将导出清单存入 pendrive。';
        $('#cleanup-summary').textContent = `将清理本次导出的 ${Number(row.file_count) || 0} 首音乐${row.link_count ? `和 ${row.link_count} 个链接` : ''}。范围仅包含此导出包中的项目。`;
        $('#cleanup-dialog').showModal();
      });
      card.append(verify, clean);
    }
    list.append(card);
  }
  if (!exportRows.length) list.append(el('p', 'status', '还没有导出记录'));
}
async function loadExports() {
  clearTimeout(exportTimer);
  if (!adminToken || !$('#admin-export-section').open) return;
  const number = ++exportRequestNumber;
  try {
    const rows = await api('/api/admin/exports', {auth: 'admin'});
    if (number !== exportRequestNumber || !adminToken) return;
    exportRows = Array.isArray(rows) ? rows : rows.items || [];
    const signature = JSON.stringify(exportRows.map(({download_url, ...row}) => row));
    if (signature !== exportSignature) {
      exportSignature = signature;
      renderExports();
    }
    for (const row of exportRows) {
      if (exportDownloaded(row) || row.error || ['cleaned', 'cleanup_failed'].includes(row.status)) watchingDownloads.delete(row.id);
    }
    if (watchingDownloads.size || exportRows.some(row => ['downloading', 'cleaning'].includes(row.status))) exportTimer = setTimeout(loadExports, 2000);
  } catch (error) {
    if (number === exportRequestNumber && adminToken) $('#export-status').textContent = error.message;
  }
}
$('#admin-export-section').addEventListener('toggle', () => {
  if ($('#admin-export-section').open && adminToken) loadExports();
  else clearTimeout(exportTimer);
});
$('#export-refresh').addEventListener('click', loadExports);
$('#export-create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  $('#export-status').textContent = '正在准备导出…';
  try {
    const row = await api('/api/admin/exports', {auth: 'admin', method: 'POST', body: JSON.stringify({user_id: $('#export-scope').value || null})});
    verifiedExports.delete(row.id);
    $('#export-status').textContent = '已准备好，点击下载 ZIP。';
    await loadExports();
  } catch (error) { $('#export-status').textContent = error.message; }
  finally { submit.disabled = false; }
});
$('#cleanup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!cleanupExportId || cleanupBusy || !verifiedExports.has(cleanupExportId)) return;
  const ident = cleanupExportId;
  cleanupBusy = true;
  $('#cleanup-confirm').disabled = true;
  $('#cleanup-error').textContent = '正在清理…';
  try {
    const result = await api(`/api/admin/exports/${encodeURIComponent(ident)}/cleanup`, {auth: 'admin', method: 'POST', body: JSON.stringify({confirmed: true})});
    $('#cleanup-dialog').close();
    if (result.status === 'cleaned') verifiedExports.delete(ident);
    $('#export-status').textContent = result.status === 'cleaning' ? '正在清理…' : result.status === 'cleanup_failed' ? '部分项目清理失败，可检查后重试。' : '已清理本次导出的音乐。';
    await Promise.all([loadLibrary(), loadAdminUsers(), loadExports()]);
  } catch (error) { $('#cleanup-error').textContent = error.message; }
  finally { cleanupBusy = false; $('#cleanup-confirm').disabled = false; }
});
$('#settings-open').addEventListener('click', async () => {
  pauseAll();
  $('#admin-login-error').textContent = '';
  $('#settings-error').textContent = '';
  $('#admin-status').textContent = '';
  $('#settings-dialog').showModal();
  if (adminToken) await loadAdminUsers();
  else clearAdmin();
});
$('#settings-dialog').addEventListener('close', () => {
  clearTimeout(exportTimer);
  $('#admin-library').querySelectorAll('audio').forEach(audio => audio.pause());
  $('#admin-password').value = '';
});
$('#admin-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true;
  $('#admin-login-error').textContent = '';
  try {
    const response = await api('/api/admin/login', {auth: 'none', method: 'POST', body: JSON.stringify({password: $('#admin-password').value})});
    adminToken = response.token;
    try { sessionStorage.setItem('music_admin_token', adminToken); } catch { /* Session remains valid for this page. */ }
    $('#admin-password').value = '';
    await loadAdminUsers();
  } catch (error) { $('#admin-login-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
$('#admin-refresh').addEventListener('click', loadAdminUsers);
$('#admin-logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', {auth: 'admin', method: 'POST'}); clearAdmin(); }
  catch (error) { if (error.status !== 401) $('#admin-status').textContent = error.message; }
});
$('#admin-rename-open').addEventListener('click', () => {
  if (!selectedAdminUser) return;
  $('#admin-display-name').value = selectedAdminUser.display_name;
  $('#admin-rename-form').hidden = false;
  $('#admin-display-name').focus();
});
$('#admin-rename-cancel').addEventListener('click', () => { $('#admin-rename-form').hidden = true; });
$('#admin-rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#admin-display-name').value.trim();
  if (!name || !selectedAdminUser) return;
  const userId = selectedAdminUser.id;
  const submit = event.submitter; submit.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}`, {auth: 'admin', method: 'PATCH', body: JSON.stringify({display_name: name})});
    await loadAdminUsers();
  } catch (error) { $('#admin-status').textContent = error.message; }
  finally { submit.disabled = false; }
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true;
  const values = Object.fromEntries([...new FormData(event.target)].filter(([, value]) => value.trim()));
  try { await api('/api/admin/settings', {auth: 'admin', method: 'PUT', body: JSON.stringify(values)}); event.target.reset(); toast('已保存'); loadSettings(); }
  catch (error) { $('#settings-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
$('#import-open').addEventListener('click', () => { $('#import-error').textContent = ''; $('#import-dialog').showModal(); });
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true; buttonState(submit, 'upload', '添加中');
  try { await api('/api/library/upload', {method: 'POST', body: new FormData(event.target)}); $('#import-dialog').close(); event.target.reset(); toast('音乐已添加'); await loadLibrary(); }
  catch (error) { $('#import-error').textContent = error.message; }
  finally { submit.disabled = false; buttonState(submit, 'plus', '添加'); }
});
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => document.getElementById(node.dataset.close).close());
async function init() {
  if (initializing) return;
  initializing = true;
  $('#session-status').textContent = '正在准备曲库…';
  $('#session-retry').hidden = true;
  submitting(true);
  $('#import-open').disabled = true;
  try {
    await establishIdentity();
    $('#session-status').textContent = '';
    await Promise.all([loadLibrary(), loadSelections()]);
    const jobId = readStorage(localStorage, 'tingjian_job');
    if (jobId) {
      try {
        const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (job.source) $('#source-text').value = job.source;
        rememberJob(job);
      } catch (error) {
        if (error.status === 404) localStorage.removeItem('tingjian_job');
        else if (error.status !== 401) toast(error.message);
      }
    }
  } catch (error) {
    $('#session-status').textContent = error.message;
    $('#session-retry').hidden = error.status === 401;
  } finally {
    initializing = false;
    submitting(false);
    $('#import-open').disabled = false;
  }
}
$('#session-retry').addEventListener('click', init);
$('#identity-invalid-dialog').addEventListener('cancel', event => event.preventDefault());
$('#identity-recreate').addEventListener('click', async event => {
  const node = event.currentTarget; node.disabled = true;
  try {
    for (const key of ['music_user_token', 'music_init_request', 'tingjian_job']) localStorage.removeItem(key);
    userToken = '';
    clearOwnLibrary();
    $('#identity-invalid-dialog').close();
    await init();
  } catch (error) { $('#identity-error').textContent = error.message; }
  finally { node.disabled = false; }
});
window.addEventListener('storage', event => {
  if (event.key !== 'music_user_token' || event.newValue === userToken || initializing) return;
  clearOwnLibrary();
  userToken = event.newValue || '';
  init();
});
init();
