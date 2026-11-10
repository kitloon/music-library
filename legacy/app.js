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

function sourceLabel(source) {
  return {'识别结果': 'Recognition result', '本机文件': 'Uploaded file'}[source] || source;
}
function englishError(message) {
  if (!message) return '';
  const text = String(message);
  if (!/[\u3400-\u9fff]/.test(text)) return text;
  const messages = {
    '管理员密码不正确': 'Incorrect administrator password.',
    '管理员登录已失效': 'Your administrator session expired. Sign in again.',
    '密码格式无效': 'Invalid password format.',
    '尝试次数较多': 'Too many attempts. Try again in 15 minutes.',
    '浏览器身份已失效': 'This browser identity has expired. Create a new library.',
    '身份凭证无效': 'Your identity is invalid. Sign in or create a new library.',
    '浏览器初始化标识无效': 'Reload this page and try again.',
    '目前没有可导出的音乐': 'There is no music to export.',
    '导出记录不存在': 'This export no longer exists.',
    '用户不存在': 'This user no longer exists.',
    '请先确认音乐已保存到 pendrive': 'Confirm that the music is saved to your USB drive and plays correctly.',
    '请先完整下载这份 ZIP': 'Download the entire ZIP and verify your backup before cleanup.',
    '有音乐缺少文件位置': 'Some music files are missing. Contact the administrator before exporting.',
    '音乐文件校验失败': 'Audio verification failed. The export is incomplete. Contact the administrator.',
    '音乐数据读取失败': 'Could not read the music. Create a new export.',
    '导出未完成': 'The export is incomplete. Download it again.',
    '导出已中断': 'The export was interrupted. Download it again.',
    '这份导出正在处理或已清理': 'This export is being processed or was already cleaned up. Refresh exports.',
    '这份导出正在处理': 'This export is being processed. Please wait.',
    '清理已中断': 'Cleanup was interrupted. Confirm your backup and retry.',
    '部分音乐清理未完成': 'Some music could not be cleaned up. Confirm your backup and retry.',
    '文件尚未清理': 'The file has not been cleaned up. Retry cleanup.',
    '最长 30 分钟': 'Full audio must be 30 minutes or shorter.',
    '存储空间不足': 'Storage is full. Contact the administrator.',
    '已有三首歌在处理中': 'Three songs are already processing. Please wait.',
    '识别任务不存在': 'This recognition task no longer exists. Search again.',
    '未识别到歌曲': 'No song was recognized. Upload a clip with clearer music.',
    '已认出歌曲': 'The song was recognized, but no playable version was found yet.',
    '识别服务暂时不可用': 'Recognition is temporarily unavailable. Retry or upload a clip.',
    '免费识别服务暂时不可用': 'Recognition is temporarily unavailable. Try again later.',
    '曲库条目不存在': 'This song no longer exists in your library.',
    '音乐文件尚未就绪': 'The music file is not ready yet.',
    '文件无法作为完整音频解码': 'This file could not be decoded. Choose another audio file.',
    '无法验证音频时长': 'The audio duration could not be verified.',
    '下载文件的时长与完整版不一致': 'The downloaded audio length did not match. Choose another version.',
    '保存未完成': 'The file was not saved completely. Upload it again.',
    '下载失败': 'Download failed. Retry or choose another source.',
    '导入被中断': 'Import was interrupted. Upload the file again.',
    'YouTube 要求额外验证': 'YouTube requires additional verification. Preview another version or upload your own audio.',
    '云端下载超时': 'The cloud download timed out. Try again later.',
    '云端下载连接中断': 'The cloud download connection was interrupted. Try again later.',
    '云端下载服务暂时不可用': 'The cloud download service is temporarily unavailable. Try again later.',
    '播放链接已失效': 'This playback link expired. Press Play again.',
    '音乐文件已移走': 'The music file was moved. Import it again.',
    '待下载已满': 'Your selection is full. Submit this batch first.',
    '待保存的歌曲较多': 'Too many songs are waiting. Wait for a download to finish.',
    '这个版本已失效': 'This version is no longer available. Search again.',
    '仅支持试听和收藏链接': 'This source supports previews and saved links only.',
    '请选择文件或链接': 'Choose an audio file or a link.',
    '正在清理': 'This music is being cleaned up. Please wait.',
    '文件不能超过': 'This file is too large. Choose a smaller file.',
    '音频无法解码或超过处理时间': 'The audio could not be decoded or took too long. Choose another file.',
    '公开链接': 'Use a public video link from a supported platform.',
    '链接格式无效': 'Invalid link format.',
    '请粘贴一个短视频链接': 'Paste one video link.',
    '请求来源不匹配': 'The request origin is not allowed. Reopen the official website.'
  };
  const match = Object.keys(messages).find(key => text.includes(key));
  return match ? messages[match] : 'The operation could not be completed. Please try again or contact the administrator.';
}

async function api(path, options = {}) {
  const {auth = 'user', ...requestOptions} = options;
  const headers = {...requestOptions.headers};
  const token = auth === 'admin' ? adminToken : auth === 'user' ? userToken : '';
  if (auth === 'user' && !token) throw new Error('Preparing your library. Please wait.');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try { response = await fetch(backendUrl(path), {...requestOptions, headers, referrerPolicy: 'no-referrer'}); }
  catch { throw new Error('Connection lost. Please try again.'); }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch { throw new Error('The service did not respond. Please try again.'); }
  if (!response.ok) {
    if (response.status === 401 && auth === 'user' && token === userToken) showInvalidIdentity();
    if (response.status === 401 && auth === 'admin') clearAdmin();
    const error = new Error(englishError(typeof data.detail === 'string' ? data.detail : 'Check your input and try again.'));
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
      catch { throw new Error('Allow browser storage to keep your library.'); }
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
  ownerPlayer.reset();
  requestNumber++;
  resetResults();
  $('#source-text').value = '';
  $('#library-search').value = '';
  $('#upload-status').hidden = true;
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
  $('#toast').textContent = englishError(message);
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
  for (const player of [ownerPlayer, adminPlayer]) {
    if (player.audio !== except) player.pause();
  }
  previewBox.querySelectorAll('audio').forEach(audio => { if (audio !== except) audio.pause(); });
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
  buttonState($('#recognize-button'), 'search', value ? 'Please wait' : 'Find music');
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
    $('#job-title').textContent = 'No results';
    $('#job-status').textContent = englishError(error.message);
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
      $('#job-status').textContent = englishError(error.message);
      $('#job-status').className = 'status error';
      $('#retry-job').hidden = false;
    }
  }, 2000);
}
function renderJob(job) {
  $('#job-section').hidden = false;
  const statuses = {queued: 'Finding music…', recognizing: 'Recognizing music…', searching: 'Finding full versions…', needs_clip: 'Upload a clip with clear music.', failed: 'Please try again.'};
  const match = job.matches?.[selectedMatch];
  $('#job-title').textContent = match?.title || job.title || 'Finding music';
  $('#job-status').textContent = englishError(job.error) || statuses[job.status] || '';
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
  let label = file ? 'Select' : 'Save link';
  let symbol = file ? 'plus' : 'link';
  if (saving.has(candidate.id)) label = file ? 'Selecting' : 'Saving';
  else if (item?.status === 'ready') { label = 'Saved'; symbol = 'check'; }
  else if (working) { label = ['cloud_queued', 'queued'].includes(item.status) ? 'Queued' : 'Saving'; symbol = 'download'; }
  else if (pending) { label = 'Selected'; symbol = 'check'; }
  buttonState(node, symbol, label);
  node.disabled = Boolean(pending || working || item?.status === 'ready' || saving.has(candidate.id) || (file && selectionSubmitting));
  node.setAttribute('aria-label', `${label === 'Select' ? 'Add to downloads' : label} ${candidate.title}`);
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
    info.append(el('div', 'track-title', candidate.title || 'Untitled music'));
    info.append(el('div', 'track-meta', [candidate.artist, candidate.version && candidate.version !== '版本待确认' ? candidate.version : '', sourceLabel(candidate.source), duration(candidate.duration)].filter(Boolean).join(' · ')));
    const actions = el('div', 'track-actions');
    const preview = button('play', 'Preview', 'preview-button');
    preview.setAttribute('aria-label', `Preview ${candidate.title}`);
    preview.disabled = !youtubeVideoId(candidate) && !safeUrl(candidate.preview_url);
    if (preview.disabled) preview.title = 'No preview is available for this source';
    preview.addEventListener('click', event => {
      selectedCandidate = candidate.id;
      $('#candidates').querySelectorAll('.candidate').forEach(node => node.classList.toggle('selected', node.dataset.candidateId === candidate.id));
      showPreview(candidate, card, event.currentTarget);
    });
    const save = button('download', 'Save', 'primary');
    save.dataset.saveCandidate = candidate.id;
    updateCandidateSaveButton(save, candidate);
    save.addEventListener('click', () => saveCandidate(candidate, save));
    actions.append(preview, save);
    card.append(info, actions);
    $('#candidates').append(card);
  });
  $('#more-candidates').hidden = versions.length <= 1;
  $('#more-candidates').setAttribute('aria-expanded', String(expandedCandidates));
  buttonState($('#more-candidates'), expandedCandidates ? 'up' : 'down', expandedCandidates ? 'Show less' : 'More versions');
  if (job.status === 'ready' && !versions.length) $('#candidates').append(el('p', 'status', sample ? 'No full version found yet.' : 'No music found. Please try again.'));
}
function showPreview(candidate, host, trigger) {
  const videoId = youtubeVideoId(candidate);
  const audioUrl = safeUrl(candidate.preview_url);
  if (!videoId && !audioUrl) { toast('This version cannot be previewed. Choose another version.'); return; }
  pauseAll();
  const box = previewBox;
  box.hidden = false;
  if (host === $('#sample-preview')) host.insertAdjacentElement('afterend', box);
  else (host || $('#preview-home')).append(box);
  const header = el('div', 'preview-head');
  const close = button('close', '', 'icon-button quiet');
  close.setAttribute('aria-label', 'Close preview');
  close.addEventListener('click', () => { closePreview(); trigger?.focus({preventScroll: true}); });
  header.append(el('span', '', candidate.title), close);
  box.append(header);
  if (videoId) {
    const frame = document.createElement('iframe');
    const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
    url.search = new URLSearchParams({autoplay: '1', playsinline: '1', rel: '0', origin: location.origin});
    frame.src = url.href;
    frame.title = `Preview ${candidate.title}`;
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
    audio.addEventListener('error', () => toast('This version cannot be previewed. Choose another version.'));
    audio.play().catch(() => toast('Press Play in the player.'));
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
        toast('Added to downloads');
      } else {
        await Promise.all([loadSelections(), loadLibrary()]);
        toast('This song is already in My Music');
      }
    } else {
      await api('/api/library', {method: 'POST', body: JSON.stringify({...version, kind: 'link'})});
      if (token !== userToken) return;
      toast('Link saved');
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
    info.append(el('div', 'track-title', entry.title || 'Untitled music'));
    if (entry.artist) info.append(el('div', 'track-meta', entry.artist));
    const remove = button('close', '', 'icon-button quiet');
    remove.dataset.remove = entry.id;
    remove.title = 'Remove from pending downloads';
    remove.setAttribute('aria-label', `Remove from pending downloads ${entry.title}`);
    remove.addEventListener('click', () => removeSelection(entry.id));
    row.append(info, remove);
    list.append(row);
  }
  const more = $('#selection-more');
  more.hidden = selections.length <= 3;
  more.setAttribute('aria-expanded', String(selectionsExpanded));
  buttonState(more, selectionsExpanded ? 'up' : 'down', selectionsExpanded ? 'Show less' : `View all ${selections.length} songs`);
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
    $('#selection-status').textContent = englishError(error.message);
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
    toast('Removed from pending downloads');
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
  buttonState($('#selection-submit'), 'download', 'Submitting');
  try {
    const result = await api('/api/selections/submit', {method: 'POST', body: JSON.stringify({ids})});
    if (token !== userToken) return;
    const submitted = new Set(ids);
    selectionLoad++;
    selections = selections.filter(entry => !submitted.has(entry.id));
    renderSelections();
    toast(result.count ? `${result.count} songs queued. You can close this page.` : 'These songs have already been processed');
  } catch (error) {
    if (token === userToken) toast(error.message);
  } finally {
    if (token === userToken) {
      await Promise.all([loadSelections(), loadLibrary()]);
      selectionSubmitting = false;
      buttonState($('#selection-submit'), 'download', 'Download all');
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
    parts.push('Latest batch', `Downloaded ${batch.ready}/${batch.total}`);
    if (batch.active) parts.push(`Downloading ${batch.active}`);
    parts.push(`Queued ${batch.queued}`);
    if (batch.failed) parts.push(`Failed ${batch.failed}`);
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
  if (['cloud_queued', 'queued'].includes(status)) return 'Queued. Download will start automatically.';
  return status === 'failed' ? 'Save failed' : 'Saving…';
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
    $('#library-status').textContent = englishError(error.message);
    $('#library-status').className = 'status error';
    $('#library-retry').hidden = error.status === 401;
    if (!error.status || error.status === 429 || error.status >= 500) {
      libraryTimer = setTimeout(loadLibrary, 10000);
    }
  }
}
// Keep the same audio element for the whole playlist so the user's first tap
// also unlocks subsequent tracks on browsers with per-element autoplay rules.
function createLibraryPlayer(audio, autoAdvance) {
  const tracks = new WeakMap();
  let current = null;
  let request = 0;
  let advanceOnEnd = false;
  const controls = el('div', 'player');
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.step = '0.1';
  const time = el('output');
  controls.append(seek, time);

  function showPlaying(track, playing) {
    track.button.replaceChildren(icon(playing ? 'pause' : 'play'));
    track.button.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + track.item.title);
    track.button.setAttribute('aria-pressed', String(playing));
  }

  function updateTime() {
    if (!current) return;
    const length = Number.isFinite(audio.duration) ? audio.duration : current.item.duration;
    seek.max = String(length || 1);
    seek.value = String(audio.currentTime || 0);
    time.textContent = (duration(audio.currentTime) || '0:00') + ' / ' + (duration(length) || '0:00');
    seek.setAttribute('aria-valuetext', time.textContent);
  }

  function pause() {
    request++;
    advanceOnEnd = false;
    audio.pause();
    if (current) showPlaying(current, false);
  }

  function reset() {
    pause();
    current = null;
    controls.remove();
    audio.removeAttribute('src');
    audio.load();
  }

  async function start(track, fromBeginning = false) {
    const previous = current;
    const switching = previous !== track;
    if (switching && previous) previous.position = audio.ended ? 0 : audio.currentTime;
    pauseAll(audio);
    pause();
    const ticket = request;
    current = track;
    try {
      // The list already contains a freshly signed URL. Start within the tap
      // when possible and renew it when an old tab outlives that signature.
      const renew = Date.now() - track.signedAt >= 45 * 60 * 1000 || audio.error;
      if (renew) {
        const data = await api(track.endpoint, {auth: track.auth});
        if (ticket !== request) return;
        track.url = mediaUrl(data.media_url);
        track.signedAt = Date.now();
      }
      if (!track.url) throw new Error('Invalid audio URL. Reload the library.');
      if (switching || renew || !audio.getAttribute('src')) {
        audio.src = track.url;
        audio.currentTime = fromBeginning ? 0 : track.position;
      } else if (audio.ended || fromBeginning) {
        audio.currentTime = 0;
      }
      track.row.append(controls);
      seek.setAttribute('aria-label', track.item.title + ' Playback position');
      updateTime();
      advanceOnEnd = autoAdvance;
      await audio.play();
    } catch (error) {
      if (ticket === request) {
        advanceOnEnd = false;
        if (error.name !== 'AbortError') toast('Unable to play this song. Press Play again.');
      }
    }
  }

  audio.addEventListener('playing', () => {
    if (current && !audio.paused) showPlaying(current, true);
  });
  audio.addEventListener('pause', () => {
    if (current && audio.paused) showPlaying(current, false);
  });
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('timeupdate', updateTime);
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); updateTime(); });
  audio.addEventListener('ended', () => {
    if (!current || !audio.ended) return;
    showPlaying(current, false);
    if (!advanceOnEnd || current.row.hidden || !current.row.isConnected) return;
    for (let row = current.row.nextElementSibling; row; row = row.nextElementSibling) {
      if (!row.hidden && tracks.has(row)) {
        start(tracks.get(row), true);
        break;
      }
    }
  });
  audio.addEventListener('error', () => {
    if (current && audio.error) {
      showPlaying(current, false);
      toast('Unable to play music. Please try again.');
    }
  });

  function add(item, row, adminUserId) {
    const play = button('play', '', 'play-button');
    const prefix = adminUserId ? '/api/admin/users/' + encodeURIComponent(adminUserId) : '/api';
    const track = {item, row, button: play, position: 0, url: mediaUrl(item.media_url),
      signedAt: Date.now(), auth: adminUserId ? 'admin' : 'user',
      endpoint: prefix + '/library/' + encodeURIComponent(item.id) + '/playback'};
    tracks.set(row, track);
    showPlaying(track, false);
    play.addEventListener('click', () => {
      if (current === track && !audio.paused) pause();
      else start(track);
    });
    row.append(play);
  }
  function remove(row) {
    if (current && current.row === row) reset();
  }
  return {audio, add, pause, reset, remove};
}
const ownerPlayer = createLibraryPlayer($('#library-audio'), true);
const adminPlayer = createLibraryPlayer($('#admin-audio'), false);
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
      if (item.kind === 'file' && item.status === 'ready' && mediaUrl(item.media_url)) {
        ownerPlayer.add(item, row);
      } else if (item.kind === 'link' && safeUrl(item.source_url)) {
        const open = button('play', '', 'play-button');
        open.setAttribute('aria-label', `Preview ${item.title}`);
        open.addEventListener('click', event => showPreview(item, row, event.currentTarget));
        row.append(open);
      } else {
        const mark = el('span', 'play-button'); mark.setAttribute('aria-hidden', 'true'); mark.append(icon(item.status === 'failed' ? 'retry' : 'download')); row.append(mark);
      }
      const info = el('div', 'track-info');
      info.append(el('div', 'track-title', item.title || 'Untitled music'));
      info.append(el('div', 'track-meta', [item.artist, duration(item.duration), item.kind === 'link' ? 'Link' : ''].filter(Boolean).join(' · ')));
      row.append(info);
      if (item.status !== 'ready') row.append(el('div', 'item-status', libraryStatusText(item.status)));
      if (item.error) row.append(el('div', 'item-error', englishError(item.error)));
      if (item.status === 'failed' && item.kind === 'file' && item.source !== '本机文件') {
        const retry = button('retry', 'Retry', 'text-button retry-download');
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { await api(`/api/library/${encodeURIComponent(item.id)}/retry`, {method: 'POST'}); await loadLibrary(); }
          catch (error) { toast(error.message); retry.disabled = false; }
        });
        row.append(retry);
      }
      ownerPlayer.remove(oldRow);
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
      ownerPlayer.remove(row); row.remove(); libraryRows.delete(id);
    }
  }
  if (!visible) list.append(el('p', 'library-empty', query ? 'No matching music' : 'Your saved music will appear here'));
}
async function loadSettings() {
  try {
    const values = await api('/api/admin/settings', {auth: 'admin'});
    for (const key of ['acr', 'audd', 'youtube', 'jamendo']) $(`#${key}-state`).textContent = values[`${key}_configured`] ? 'Connected' : '';
  } catch (error) { $('#settings-error').textContent = englishError(error.message); }
}
$('#recognize-form').addEventListener('submit', startJob);
$('#source-text').addEventListener('paste', () => setTimeout(() => { if (/https?:\/\//i.test($('#source-text').value)) startJob(); }, 0));
$('#retry-job').addEventListener('click', async () => {
  if (currentJob && activeStatuses.includes(currentJob.status)) {
    $('#job-status').textContent = 'Reconnecting…';
    scheduleJob(currentJob);
  } else if (currentJob && !currentJob.source) $('#clip-file').click();
  else startJob();
});
$('#more-candidates').addEventListener('click', () => { expandedCandidates = !expandedCandidates; renderCandidates(currentJob); });
$('#clip-open').addEventListener('click', () => $('#clip-file').click());
$('#clip-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || isSubmitting) return;
  if (file.size > 100 * 1024 * 1024) { toast('Clips must be 100 MB or smaller'); event.target.value = ''; return; }
  const number = ++requestNumber;
  submitting(true);
  clearTimeout(jobTimer);
  resetResults();
  $('#upload-status').hidden = false;
  $('#upload-status').textContent = 'Uploading…';
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
  adminPlayer.reset();
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
  if (!value) return 'Never visited';
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString('en-GB', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}
function renderAdminUsers() {
  $('#admin-users').replaceChildren();
  for (const user of adminUsers) {
    const node = el('button', 'admin-user');
    node.type = 'button';
    node.setAttribute('aria-pressed', String(selectedAdminUser?.id === user.id));
    node.append(el('span', 'admin-user-name', user.display_name));
    node.append(el('span', 'admin-user-meta', `${user.collection_count} songs · ${formatBytes(user.total_bytes)} · Last seen ${lastSeen(user.last_seen_at)}`));
    node.addEventListener('click', () => selectAdminUser(user));
    $('#admin-users').append(node);
  }
  if (!adminUsers.length) $('#admin-users').append(el('p', 'status', 'No users yet'));
}
async function loadAdminUsers() {
  $('#admin-status').textContent = 'Loading…';
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
    if (error.status === 401) $('#admin-login-error').textContent = 'Your administrator session expired. Sign in again.';
    else $('#admin-status').textContent = englishError(error.message);
  }
}
async function selectAdminUser(user) {
  const number = ++adminRequestNumber;
  adminPlayer.reset();
  selectedAdminUser = user;
  renderAdminUsers();
  $('#admin-user-detail').hidden = false;
  $('#admin-user-title').textContent = user.display_name;
  $('#admin-user-stats').textContent = `${user.collection_count} saved · ${user.file_count} files · ${formatBytes(user.total_bytes)}`;
  $('#admin-rename-form').hidden = true;
  $('#admin-library').replaceChildren(el('p', 'status', 'Loading…'));
  try {
    const items = await api(`/api/admin/users/${encodeURIComponent(user.id)}/library`, {auth: 'admin'});
    if (number !== adminRequestNumber) return;
    $('#admin-library').replaceChildren();
    for (const item of items) {
      const row = el('article', 'library-row');
      if (item.status === 'ready' && item.kind === 'file' && mediaUrl(item.media_url)) adminPlayer.add(item, row, user.id);
      else if (item.kind === 'link' && safeUrl(item.source_url)) {
        const link = el('a', 'play-button');
        link.href = safeUrl(item.source_url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Preview ${item.title}`); link.append(icon('external')); row.append(link);
      } else {
        const mark = el('span', 'play-button'); mark.setAttribute('aria-hidden', 'true'); mark.append(icon('download')); row.append(mark);
      }
      const info = el('div', 'track-info');
      info.append(el('div', 'track-title', item.title));
      info.append(el('div', 'track-meta', [item.artist, duration(item.duration), libraryStatusText(item.status)].filter(Boolean).join(' · ')));
      row.append(info);
      $('#admin-library').append(row);
    }
    if (!items.length) $('#admin-library').append(el('p', 'status', 'No saved music yet'));
  } catch (error) {
    if (number === adminRequestNumber && error.status !== 401) $('#admin-library').replaceChildren(el('p', 'error', englishError(error.message)));
  }
}
function updateExportScopes() {
  const select = $('#export-scope');
  const previous = select.value;
  select.replaceChildren(el('option', '', 'All users'));
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
  return row.scope_user_id ? adminUsers.find(user => user.id === row.scope_user_id)?.display_name || 'Selected user' : 'All users';
}
function exportSummary(row) {
  const parts = [`${Number(row.file_count) || 0} songs`];
  if (row.link_count) parts.push(`${row.link_count} links`);
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
    const status = {ready: exportDownloaded(row) ? 'ZIP download complete' : 'Ready to download', downloading: 'Downloading ZIP…', downloaded: 'ZIP download complete', cleaning: 'Cleaning up…', cleanup_failed: 'Some items could not be cleaned up. Retry.', cleaned: 'Cleaned up', failed: 'Export incomplete. Download again.'}[row.status] || 'Processing…';
    card.append(el('p', 'status', status));
    if (row.error) card.append(el('p', 'error', englishError(row.error)));
    const canDownload = !['cleaning', 'cleanup_failed', 'cleaned'].includes(row.status);
    if (canDownload) {
      const link = el('a', 'secondary export-download', row.status === 'downloading' ? 'Downloading' : 'Download ZIP');
      link.prepend(icon('download'));
      const url = mediaUrl(row.download_url);
      if (url) link.href = url;
      link.setAttribute('download', '');
      link.setAttribute('aria-label', `Download music ZIP for ${exportScope(row)}`);
      if (row.status === 'downloading') link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', async event => {
        event.preventDefault();
        if (row.status === 'downloading' || link.dataset.busy === 'true') return;
        link.dataset.busy = 'true';
        try {
          const latest = await api(`/api/admin/exports/${encodeURIComponent(row.id)}`, {auth: 'admin'});
          const downloadUrl = mediaUrl(latest.download_url);
          if (!downloadUrl) throw new Error('The download link is unavailable. Refresh exports.');
          const download = document.createElement('a');
          download.href = downloadUrl;
          download.setAttribute('download', '');
          download.hidden = true;
          document.body.append(download);
          download.click();
          download.remove();
          watchingDownloads.add(row.id);
          $('#export-status').textContent = 'After downloading, check the music on your USB drive.';
          clearTimeout(exportTimer);
          exportTimer = setTimeout(loadExports, 1500);
        } catch (error) { $('#export-status').textContent = englishError(error.message); }
        finally { link.dataset.busy = 'false'; }
      });
      card.append(link);
    }
    if (exportDownloaded(row) && !['downloading', 'cleaning', 'cleaned'].includes(row.status)) {
      const verify = el('label', 'export-verify');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = verifiedExports.has(row.id);
      verify.append(checkbox, el('span', '', row.file_count ? 'Saved to my USB drive and playback checked' : 'Export manifest saved to my USB drive'));
      const clean = button('trash', row.status === 'cleanup_failed' ? 'Retry cleanup' : 'Clean up exported music', 'text-button cleanup-open');
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
        $('#cleanup-assurance').textContent = row.file_count ? 'Confirm the music is saved to your USB drive and plays correctly.' : 'Confirm the export manifest is saved to your USB drive.';
        $('#cleanup-summary').textContent = `Clean up ${Number(row.file_count) || 0} songs${row.link_count ? ` and ${row.link_count} links` : ''} included in this export. Only items in this export are affected.`;
        $('#cleanup-dialog').showModal();
      });
      card.append(verify, clean);
    }
    list.append(card);
  }
  if (!exportRows.length) list.append(el('p', 'status', 'No exports yet'));
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
    if (number === exportRequestNumber && adminToken) $('#export-status').textContent = englishError(error.message);
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
  $('#export-status').textContent = 'Preparing export…';
  try {
    const row = await api('/api/admin/exports', {auth: 'admin', method: 'POST', body: JSON.stringify({user_id: $('#export-scope').value || null})});
    verifiedExports.delete(row.id);
    $('#export-status').textContent = 'Ready. Download the ZIP.';
    await loadExports();
  } catch (error) { $('#export-status').textContent = englishError(error.message); }
  finally { submit.disabled = false; }
});
$('#cleanup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!cleanupExportId || cleanupBusy || !verifiedExports.has(cleanupExportId)) return;
  const ident = cleanupExportId;
  cleanupBusy = true;
  $('#cleanup-confirm').disabled = true;
  $('#cleanup-error').textContent = 'Cleaning up…';
  try {
    const result = await api(`/api/admin/exports/${encodeURIComponent(ident)}/cleanup`, {auth: 'admin', method: 'POST', body: JSON.stringify({confirmed: true})});
    $('#cleanup-dialog').close();
    if (result.status === 'cleaned') verifiedExports.delete(ident);
    $('#export-status').textContent = result.status === 'cleaning' ? 'Cleaning up…' : result.status === 'cleanup_failed' ? 'Some items could not be cleaned up. Check and retry.' : 'Music from this export has been cleaned up.';
    await Promise.all([loadLibrary(), loadAdminUsers(), loadExports()]);
  } catch (error) { $('#cleanup-error').textContent = englishError(error.message); }
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
  adminPlayer.reset();
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
  } catch (error) { $('#admin-login-error').textContent = englishError(error.message); }
  finally { submit.disabled = false; }
});
$('#admin-refresh').addEventListener('click', loadAdminUsers);
$('#admin-logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', {auth: 'admin', method: 'POST'}); clearAdmin(); }
  catch (error) { if (error.status !== 401) $('#admin-status').textContent = englishError(error.message); }
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
  } catch (error) { $('#admin-status').textContent = englishError(error.message); }
  finally { submit.disabled = false; }
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true;
  const values = Object.fromEntries([...new FormData(event.target)].filter(([, value]) => value.trim()));
  try { await api('/api/admin/settings', {auth: 'admin', method: 'PUT', body: JSON.stringify(values)}); event.target.reset(); toast('Saved'); loadSettings(); }
  catch (error) { $('#settings-error').textContent = englishError(error.message); }
  finally { submit.disabled = false; }
});
$('#import-open').addEventListener('click', () => { $('#import-error').textContent = ''; $('#import-dialog').showModal(); });
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true; buttonState(submit, 'upload', 'Adding');
  try { await api('/api/library/upload', {method: 'POST', body: new FormData(event.target)}); $('#import-dialog').close(); event.target.reset(); toast('Music added'); await loadLibrary(); }
  catch (error) { $('#import-error').textContent = englishError(error.message); }
  finally { submit.disabled = false; buttonState(submit, 'plus', 'Add'); }
});
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => document.getElementById(node.dataset.close).close());
let identityChangedDuringInit = false;
async function init() {
  if (initializing) return;
  initializing = true;
  $('#session-status').textContent = 'Preparing your library…';
  $('#session-retry').hidden = true;
  submitting(true);
  $('#import-open').disabled = true;
  try {
    await establishIdentity();
    if (identityChangedDuringInit) return;
    $('#session-status').textContent = '';
    await Promise.all([loadLibrary(), loadSelections()]);
    if (identityChangedDuringInit) return;
    const jobId = readStorage(localStorage, 'tingjian_job');
    if (jobId) {
      try {
        const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (identityChangedDuringInit) return;
        if (job.source) $('#source-text').value = job.source;
        rememberJob(job);
      } catch (error) {
        if (error.status === 404) localStorage.removeItem('tingjian_job');
        else if (error.status !== 401) toast(error.message);
      }
    }
  } catch (error) {
    $('#session-status').textContent = englishError(error.message);
    $('#session-retry').hidden = error.status === 401;
  } finally {
    initializing = false;
    submitting(false);
    $('#import-open').disabled = false;
    if (identityChangedDuringInit) {
      identityChangedDuringInit = false;
      init();
    }
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
  } catch (error) { $('#identity-error').textContent = englishError(error.message); }
  finally { node.disabled = false; }
});
window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== 'music_user_token') return;
  const token = readStorage(localStorage, 'music_user_token');
  if (token === userToken) return;
  clearOwnLibrary();
  userToken = token;
  if (initializing) identityChangedDuringInit = true;
  else init();
});
init();
