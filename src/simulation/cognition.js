export class CognitionBridge {
  constructor(config, onSnapshot) {
    this.worker = new Worker(new URL('../workers/cognition.worker.js', import.meta.url), { type: 'module' });
    this.snapshot = null;
    this.ready = false;
    this.onSnapshot = onSnapshot;
    this.worker.onmessage = event => {
      if (event.data.type === 'ready') this.ready = true;
      if (event.data.type === 'snapshot') {
        this.snapshot = event.data;
        this.onSnapshot?.(event.data);
      }
    };
    this.worker.postMessage({ type: 'init', config });
  }

  tick(input) { if (this.ready) this.worker.postMessage({ type: 'tick', input }); }
  feedback(feedback) { this.worker.postMessage({ type: 'feedback', feedback }); }
  event(kind, magnitude = .5, payload = {}, now = 0) { this.worker.postMessage({ type: 'event', kind, magnitude, payload, now }); }
  setPersonality(traits) { this.worker.postMessage({ type: 'personality', traits }); }
  reset(config) { this.worker.postMessage({ type: 'reset', config }); }
  dispose() { this.worker.terminate(); }
}
