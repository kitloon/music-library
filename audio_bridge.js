/* One media element survives route changes and unlocks continuous playback. */
(() => {
  'use strict';
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.hidden = true;
  audio.setAttribute('playsinline', '');
  document.body.append(audio);
  let state = 'paused';
  let revision = 0;

  function publish(ended = false, error = '') {
    window.dispatchEvent(new CustomEvent('music-audio', {detail: JSON.stringify({
      state,
      current: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      ended,
      error
    })}));
  }

  function trustedMediaUrl(value) {
    const url = new URL(value, location.href);
    const permitted = [location.origin, 'https://kitloon-music-api.onrender.com'];
    if (!permitted.includes(url.origin) || !['https:', 'http:'].includes(url.protocol)) {
      throw new Error('Invalid music address. Reopen your library.');
    }
    return url.href;
  }

  audio.addEventListener('playing', () => { state = 'playing'; publish(); });
  audio.addEventListener('pause', () => { state = 'paused'; publish(); });
  audio.addEventListener('waiting', () => { state = 'loading'; publish(); });
  audio.addEventListener('ended', () => { state = 'paused'; publish(true); });
  audio.addEventListener('error', () => {
    if (!audio.error) return;
    state = 'error';
    publish(false, 'Unable to play this track. Tap Play again.');
  });
  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) {
    audio.addEventListener(event, () => publish());
  }

  window.musicAudio = {
    async play(url) {
      const ticket = ++revision;
      if (url) {
        const next = trustedMediaUrl(url);
        if (audio.getAttribute('src') !== next) audio.src = next;
      }
      if (!audio.getAttribute('src')) return;
      if (audio.ended) audio.currentTime = 0;
      state = 'loading';
      publish();
      try {
        await audio.play();
      } catch (error) {
        if (ticket !== revision || error.name === 'AbortError') return;
        state = 'error';
        publish(false, 'Tap Play to continue.');
      }
    },
    resume() { return window.musicAudio.play(); },
    pause() { revision++; audio.pause(); state = 'paused'; publish(); },
    seek(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(value, audio.duration));
      publish();
    },
    stop() {
      revision++;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      state = 'paused';
      publish();
    },
    metadata(title, artist) {
      if ('mediaSession' in navigator && 'MediaMetadata' in window) {
        navigator.mediaSession.metadata = new MediaMetadata({title: title || 'T.Music', artist: artist || ''});
      }
    }
  };

  if ('mediaSession' in navigator) {
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack']) {
      try {
        navigator.mediaSession.setActionHandler(action, () => {
          window.dispatchEvent(new CustomEvent('music-action', {detail:JSON.stringify({action})}));
        });
      } catch (_) { /* The browser may support only some media actions. */ }
    }
  }

  let installPrompt;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    window.dispatchEvent(new CustomEvent('music-install-ready'));
  });
  window.musicInstall = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const outcome = await installPrompt.userChoice;
    installPrompt = null;
    return outcome.outcome === 'accepted';
  };
})();
