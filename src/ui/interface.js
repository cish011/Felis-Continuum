import { COATS, EYE_COLORS, PERSONALITIES, NEED_DEFINITIONS, ACTION_LABELS } from '../data/catalog.js';
import { clamp } from '../core/math.js';
import { events } from '../core/events.js';

const $ = selector => document.querySelector(selector);

export class SimulationUI {
  constructor(profile) {
    this.profile = profile;
    this.debug = false;
    this.settingsOpen = false;
    this.lastIntent = '';
    this.context = null;
    this.bindElements();
    this.buildNeeds();
    this.buildOptions();
    this.bindControls();
  }

  bindElements() {
    this.elements = {
      loading: $('#loading-screen'), loadingStatus: $('#loading-status'), welcome: $('#welcome'),
      enter: $('#enter-world'), catName: $('#cat-name'), catMood: $('#cat-mood'),
      intent: $('#intent-label'), intentDetail: $('#intent-detail'), clock: $('#world-clock'),
      weather: $('#weather-label'), debugPanel: $('#debug-panel'), settingsPanel: $('#settings-panel'),
      fps: $('#fps-label'), gait: $('#debug-gait'), speed: $('#debug-speed'),
      attention: $('#debug-attention'), commitment: $('#debug-commitment'), surface: $('#debug-surface'),
      utilities: $('#utility-list'), debugToggle: $('#debug-toggle'), settingsToggle: $('#settings-toggle'),
      catCard: $('#cat-card'), statusToggle: $('#status-toggle'), cameraDock: $('.camera-dock'),
      context: $('#context-prompt'), contextLabel: $('#context-label'), reticle: $('#reticle'),
      held: $('#held-item'), heldLabel: $('#held-label'), petHint: $('#pet-hint'), toasts: $('#toast-stack'),
      nameInput: $('#name-input'), coat: $('#coat-select'), fur: $('#fur-slider'), size: $('#size-slider'),
      eye: $('#eye-select'), personality: $('#personality-select'), collar: $('#collar-toggle'),
    };
  }

  buildNeeds() {
    const host = $('#need-bars');
    host.innerHTML = '';
    this.needElements = {};
    for (const [key, definition] of Object.entries(NEED_DEFINITIONS)) {
      const row = document.createElement('div');
      row.className = 'need-row';
      row.innerHTML = `<span>${definition.label}</span><i style="--tone:${definition.tone};--value:50%"></i><em>50</em>`;
      host.appendChild(row);
      this.needElements[key] = { bar: row.querySelector('i'), value: row.querySelector('em'), definition };
    }
  }

  buildOptions() {
    this.fillSelect(this.elements.coat, COATS, this.profile.coat);
    this.fillSelect(this.elements.eye, EYE_COLORS, this.profile.eyeColor);
    this.fillSelect(this.elements.personality, PERSONALITIES, this.profile.personality);
  }

  fillSelect(select, values, selected) {
    for (const [value, data] of Object.entries(values)) {
      const option = document.createElement('option');
      option.value = value; option.textContent = data.label; option.selected = value === selected;
      select.appendChild(option);
    }
  }

  bindControls() {
    this.elements.enter.addEventListener('click', () => {
      this.elements.welcome.classList.add('closed');
      events.emit('enter');
    });
    document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('[data-camera]').forEach(item => item.classList.toggle('active', item === button));
      const index = ['follow', 'close', 'free'].indexOf(button.dataset.camera);
      this.elements.cameraDock.dataset.cameraIndex = String(Math.max(0, index));
      events.emit('camera', { mode: button.dataset.camera });
    }));
    this.elements.cameraDock.dataset.cameraIndex = '0';
    this.elements.statusToggle.addEventListener('click', () => {
      const expanded = this.elements.catCard.classList.toggle('collapsed') === false;
      this.elements.statusToggle.setAttribute('aria-expanded', String(expanded));
      this.noteActivity();
    });
    this.elements.debugToggle.addEventListener('click', () => this.toggleDebug());
    this.elements.settingsToggle.addEventListener('click', () => this.toggleSettings());
    $('#randomize-cat').addEventListener('click', () => events.emit('randomize-cat'));

    const emitProfile = () => {
      const temperament = PERSONALITIES[this.elements.personality.value];
      this.profile = {
        ...this.profile,
        name: this.elements.nameInput.value.trim() || 'Morrow',
        coat: this.elements.coat.value,
        furLength: Number(this.elements.fur.value),
        bodySize: Number(this.elements.size.value),
        eyeColor: this.elements.eye.value,
        personality: this.elements.personality.value,
        traits: { ...temperament.traits },
        collar: this.elements.collar.checked,
      };
      this.elements.catName.textContent = this.profile.name;
      this.elements.catMood.textContent = temperament.mood;
      events.emit('profile', { profile: this.profile });
    };
    for (const element of [this.elements.nameInput, this.elements.coat, this.elements.fur, this.elements.size, this.elements.eye, this.elements.personality, this.elements.collar]) {
      element.addEventListener('input', emitProfile);
      element.addEventListener('change', emitProfile);
    }

    this.hudHidden = false;
    this.activityTimer = 0;
    this.activityEvents = ['pointermove', 'pointerdown', 'wheel', 'keydown'];
    this.noteActivityBound = () => this.noteActivity();
    for (const type of this.activityEvents) window.addEventListener(type, this.noteActivityBound, { passive: true });
    this.keyboardBound = event => {
      if (event.code === 'KeyH' && !/INPUT|SELECT|TEXTAREA/.test(event.target?.tagName ?? '')) {
        this.hudHidden = !this.hudHidden;
        document.body.classList.toggle('hud-hidden', this.hudHidden);
        this.toast(this.hudHidden ? 'Interface hidden · H to restore' : 'Interface restored', 1500);
      } else if (event.code === 'KeyD' && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(event.target?.tagName ?? '')) {
        this.toggleDebug();
      }
    };
    window.addEventListener('keydown', this.keyboardBound);
  }

  noteActivity() {
    document.body.classList.remove('hud-idle');
    clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      if (!this.debug && !this.settingsOpen && !document.body.classList.contains('pet-mode')) document.body.classList.add('hud-idle');
    }, 6200);
  }

  toggleDebug(force) {
    this.debug = force ?? !this.debug;
    this.elements.debugToggle.classList.toggle('active', this.debug);
    this.elements.debugToggle.setAttribute('aria-pressed', String(this.debug));
    this.elements.debugPanel.classList.toggle('hidden', !this.debug);
    if (this.debug) this.toggleSettings(false);
    events.emit('debug', { enabled: this.debug });
    this.noteActivity();
  }

  toggleSettings(force) {
    this.settingsOpen = force ?? !this.settingsOpen;
    this.elements.settingsToggle.classList.toggle('active', this.settingsOpen);
    this.elements.settingsToggle.setAttribute('aria-pressed', String(this.settingsOpen));
    this.elements.settingsPanel.classList.toggle('hidden', !this.settingsOpen);
    if (this.settingsOpen && this.debug) this.toggleDebug(false);
    this.noteActivity();
  }

  loadingStatus(text) { this.elements.loadingStatus.textContent = text; }
  finishLoading() { setTimeout(() => this.elements.loading.classList.add('closed'), 180); }

  update(snapshot, motion, metrics = {}) {
    if (!snapshot) return;
    for (const [key, parts] of Object.entries(this.needElements)) {
      let value = snapshot.needs?.[key] ?? .5;
      if (key === 'energy' || key === 'comfort') value = value;
      parts.bar.style.setProperty('--value', `${clamp(value) * 100}%`);
      parts.value.textContent = Math.round(clamp(value) * 100);
    }
    const goal = snapshot.intention?.goal ?? 'observe';
    if (goal !== this.lastIntent) {
      const labels = ACTION_LABELS[goal] ?? ACTION_LABELS.observe;
      this.elements.intent.textContent = labels[0];
      this.elements.intentDetail.textContent = labels[1];
      this.lastIntent = goal;
    }
    this.elements.gait.textContent = motion?.gait ?? 'idle';
    this.elements.speed.textContent = `${(motion?.speed ?? 0).toFixed(2)} m/s`;
    this.elements.attention.textContent = snapshot.perception?.attention?.label ?? snapshot.perception?.attention?.type ?? 'ambient room';
    this.elements.commitment.textContent = `${Math.round((snapshot.intention?.commitment ?? 0) * 100)}%`;
    this.elements.surface.textContent = metrics.surface ?? 'oak floor';
    this.elements.fps.textContent = `${Math.round(metrics.fps ?? 60)} FPS`;
    this.updateUtilities(snapshot.utilities ?? {}, goal);
  }

  updateUtilities(utilities, winner) {
    if (!this.debug) return;
    const entries = Object.entries(utilities).sort((a,b) => b[1]-a[1]).slice(0, 8);
    this.elements.utilities.innerHTML = entries.map(([name, score]) =>
      `<div class="utility ${name === winner ? 'winner' : ''}"><span>${name}</span><i style="--score:${Math.min(100, score * 100)}%"></i><b>${score.toFixed(2)}</b></div>`
    ).join('');
  }

  setClock(hour) {
    const whole = Math.floor(hour) % 24;
    const minutes = Math.floor((hour - Math.floor(hour)) * 60);
    this.elements.clock.textContent = `${String(whole).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
    this.elements.weather.textContent = `${hour > 19 || hour < 6 ? 'NIGHT' : hour > 16 ? 'GOLDEN HOUR' : 'CLEAR'} · ${hour > 8 && hour < 17 ? 'SUN PATCHES' : 'INDOORS'}`;
  }

  setPointer(x, y) {
    this.elements.reticle.style.left = `${x}px`;
    this.elements.reticle.style.top = `${y}px`;
    this.elements.context.style.left = `${x}px`;
    this.elements.context.style.top = `${y + 24}px`;
  }

  showContext(label) {
    this.context = label;
    this.elements.contextLabel.textContent = label;
    this.elements.context.classList.remove('hidden');
    document.body.classList.add('has-context');
  }

  hideContext() {
    this.context = null;
    this.elements.context.classList.add('hidden');
    document.body.classList.remove('has-context');
  }

  setHeld(label) {
    this.elements.held.classList.toggle('hidden', !label);
    if (label) this.elements.heldLabel.textContent = label;
  }

  applyProfile(profile) {
    this.profile = profile;
    this.elements.nameInput.value = profile.name ?? 'Morrow';
    this.elements.coat.value = profile.coat ?? 'silverTabby';
    this.elements.fur.value = profile.furLength ?? .42;
    this.elements.size.value = profile.bodySize ?? 1;
    this.elements.eye.value = profile.eyeColor ?? 'lichen';
    this.elements.personality.value = profile.personality ?? 'observer';
    this.elements.collar.checked = profile.collar !== false;
    this.elements.catName.textContent = profile.name ?? 'Morrow';
    this.elements.catMood.textContent = PERSONALITIES[profile.personality]?.mood ?? 'quietly curious';
  }

  setPetting(active) {
    document.body.classList.toggle('pet-mode', active);
    this.elements.petHint.classList.toggle('hidden', !active);
  }

  toast(message, duration = 2600) {
    const element = document.createElement('div');
    element.className = 'toast'; element.textContent = message;
    this.elements.toasts.appendChild(element);
    setTimeout(() => {
      element.classList.add('leaving');
      setTimeout(() => element.remove(), 260);
    }, duration);
  }
}
