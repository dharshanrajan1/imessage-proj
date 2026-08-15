// Motion primitives.
//
// The dashboard's transitions used to be CSS @keyframes (a 0.4s fadeIn on every
// tab switch) and transition-driven hover lifts. Both have the same flaw: they
// run to completion from a fixed start value. Switch tabs twice quickly and the
// second switch restarts the fade from opacity 0 rather than continuing from
// wherever the first one had got to, so the UI visibly stutters and rejects the
// input it just accepted.
//
// A spring solves that by having no duration at all. It has a position, a
// velocity and a target; retargeting mid-flight just changes the target and the
// existing velocity carries through. Nothing restarts, nothing is
// uninterruptible.
//
// Two rules keep it cheap, and both were learned the hard way:
//
//   1. ONE rAF loop for every spring in the app, not one per spring. The
//      chemistry section alone can put 134 bars on screen; 134 independent rAF
//      loops each doing their own DOM writes is not 134x the work of one, it's
//      worse, because the browser cannot batch across them.
//
//   2. Only `transform` and `opacity` are ever animated. Those are composited.
//      Animating `width` (which this file used to do for the bars) forces
//      layout on every frame, for every bar, and the result was visible jitter
//      the moment a scroll brought a batch of them into view.
//
// Deliberately NOT here: a cross-fade between whole views. Swapping tabs meant
// layer-promoting two ~1,500-element subtrees and re-compositing both every
// frame, while Chart.js ran its own entry animation on the incoming charts. It
// visibly stuttered, and the grid cell holding both had to size to the taller
// one, so the page jumped when the outgoing view finally left. A tab switch
// doesn't need a transition -- the indicator sliding is what communicates it.
// Views are swapped instantly; see renderView() in app.js.
//
// Zero dependencies, matching the rest of the project.

// Damping ratio 1.0 is critically damped: it settles as fast as possible with
// no overshoot. That's the right default for UI that appears and disappears.
// Only motion carrying real momentum (a flick, a drag release) should dip below
// 1.0 into bounce territory -- this dashboard has no drag gestures, so nothing
// here does.
const DEFAULT_DAMPING = 1.0;

// Seconds to essentially reach the target. Not a duration -- the spring is
// still solving after this -- but it's the number that behaves like one when
// you're tuning by feel.
const DEFAULT_RESPONSE = 0.35;

// Below these deltas the motion is under a pixel and under a pixel-per-second;
// continuing to burn frames on it is invisible.
const REST_DISPLACEMENT = 0.001;
const REST_VELOCITY = 0.005;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Every running spring, keyed by element, so a second call on the same element
// can read the in-flight position/velocity instead of starting cold. This is
// the whole point -- see the file header.
const running = new WeakMap();

/* --------------------------------------------------------------------------
   The shared ticker

   One rAF loop drives every live spring. Integration for all of them happens
   inside a single frame callback, so the browser sees one batch of style
   writes per frame instead of N interleaved ones.
   -------------------------------------------------------------------------- */

const live = new Set();
let ticking = false;
let lastTime = 0;

function tick(now) {
  // A tab that was backgrounded mid-spring returns with a multi-second gap that
  // would blow the integrator up. Clamp to ~4 frames at 60Hz.
  const dt = Math.min((now - lastTime) / 1000, 0.064);
  lastTime = now;

  // Snapshot: a spring's onComplete can start or stop others, and mutating the
  // set while iterating it would skip entries.
  for (const s of [...live]) s.advance(dt);

  if (live.size) requestAnimationFrame(tick);
  else ticking = false;
}

function startTicking() {
  if (ticking) return;
  ticking = true;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

// Physical spring constants from the designer-facing pair. Response maps to the
// natural frequency, damping ratio scales the drag against it.
function constants(response, damping) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega };
}

/**
 * Spring a numeric value from its current presentation value to `to`, calling
 * `onUpdate(value)` each frame.
 *
 * Retargeting: calling spring() again on the same (el, key) pair picks up the
 * live position and velocity of the existing spring rather than restarting.
 * `from` is only consulted when there is no spring already in flight.
 *
 * @returns {Promise<void>} resolves when the spring comes to rest; never
 *   rejects, and resolves immediately if superseded, so awaiting it is safe.
 */
export function spring(el, key, { from = 0, to, onUpdate, damping = DEFAULT_DAMPING,
                                  response = DEFAULT_RESPONSE, velocity = 0,
                                  onComplete } = {}) {
  let springs = running.get(el);
  if (!springs) running.set(el, (springs = new Map()));

  const existing = springs.get(key);
  // Presentation value, not target value: an interrupted spring continues from
  // where it visually is.
  const position = existing ? existing.position : from;
  const vel = existing ? existing.velocity : velocity;
  if (existing) {
    live.delete(existing);
    existing.resolve();          // the superseded caller stops waiting
  }

  // Reduced motion: skip the physics entirely and land on the target.
  if (reduceMotion.matches) {
    springs.delete(key);
    onUpdate(to);
    if (onComplete) onComplete();
    return Promise.resolve();
  }

  const { stiffness, damping: c } = constants(response, damping);

  return new Promise(resolve => {
    const state = {
      position, velocity: vel, resolve,
      advance(dt) {
        const displacement = this.position - to;
        const accel = -stiffness * displacement - c * this.velocity;
        this.velocity += accel * dt;
        this.position += this.velocity * dt;

        if (Math.abs(this.position - to) < REST_DISPLACEMENT &&
            Math.abs(this.velocity) < REST_VELOCITY) {
          this.position = to;
          this.velocity = 0;
          onUpdate(to);
          live.delete(this);
          if (springs.get(key) === this) springs.delete(key);
          if (onComplete) onComplete();
          resolve();
          return;
        }
        onUpdate(this.position);
      },
    };

    springs.set(key, state);
    live.add(state);
    startTicking();
  });
}

/**
 * Slide the tab bar's selection indicator to `target`.
 *
 * The indicator is one element that moves, rather than a border painted on
 * whichever tab is active. That difference is the point: a moving indicator
 * shows the selection travelling from where it was to where it now is, which is
 * what makes the tab bar feel like one control instead of several.
 *
 * Position and width are both driven through `transform` on a 1px-wide base, so
 * this stays on the compositor like everything else here.
 */
export function moveIndicator(indicator, target) {
  if (!target) { indicator.style.opacity = '0'; return; }

  const parent = indicator.parentElement.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const toX = rect.left - parent.left;
  const toW = rect.width;

  const paint = (x, w) => {
    indicator.style.transform = `translate3d(${x}px,0,0) scaleX(${w})`;
  };

  // First placement shouldn't animate in from x=0 -- there was no previous
  // selection for it to have travelled from.
  const first = indicator.style.opacity === '' || indicator.style.opacity === '0';
  if (first) {
    paint(toX, toW);
    indicator.style.opacity = '1';
    indicator._x = toX;
    indicator._w = toW;
    return;
  }

  const fromX = indicator._x ?? toX;
  const fromW = indicator._w ?? toW;

  // X and width are separate springs. Decomposing lets each settle on its own
  // terms; driving width off the x-spring's progress would couple them into a
  // single stretch that reads as rubbery.
  spring(indicator, 'x', {
    from: fromX, to: toX, response: 0.3,
    onUpdate: v => { indicator._x = v; paint(v, indicator._w); },
  });
  spring(indicator, 'w', {
    from: fromW, to: toW, response: 0.3,
    onUpdate: v => { indicator._w = v; paint(indicator._x, v); },
  });
}

/**
 * Grow a bar to its value once, the first time it's actually seen.
 *
 * Driven by `transform: scaleX` on a full-width fill, NOT by `width`. Width was
 * the original implementation and it was the single worst performance mistake
 * in this file: the chemistry section can put 134 bars on screen at once, and
 * animating their widths relayed out the page every frame as you scrolled.
 * scaleX is composited, so the same 134 bars cost nothing.
 *
 * Tying it to an IntersectionObserver makes the motion mean "this just arrived
 * on screen". The previous CSS width transition re-ran on every render,
 * including ones caused by filtering -- motion with no event behind it.
 */
export function growBars(root, selector = '[data-fill]') {
  // A section that rebuilds part of itself (the chemistry "show all" toggle)
  // calls this for its own subtree, and the view-level call then sweeps the
  // whole view. Marking claimed bars keeps the second call from resetting bars
  // that are already mid-flight.
  const bars = [...root.querySelectorAll(selector)].filter(b => !b.dataset.grown);
  if (!bars.length) return;
  bars.forEach(b => { b.dataset.grown = '1'; });

  const target = bar => (parseFloat(bar.dataset.fill) || 0) / 100;

  if (reduceMotion.matches) {
    bars.forEach(bar => { bar.style.transform = `scaleX(${target(bar)})`; });
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const bar = entry.target;
      obs.unobserve(bar);
      // will-change is set here and cleared on settle rather than living in the
      // stylesheet: a permanent hint on all 134 bars would promote 134 layers
      // and hold them for the life of the page.
      bar.style.willChange = 'transform';
      spring(bar, 'fill', {
        from: 0, to: target(bar), response: 0.5,
        onUpdate: v => { bar.style.transform = `scaleX(${v})`; },
        onComplete: () => { bar.style.willChange = ''; },
      });
    });
  }, { threshold: 0.1 });

  bars.forEach(bar => { bar.style.transform = 'scaleX(0)'; observer.observe(bar); });
}

export const prefersReducedMotion = () => reduceMotion.matches;
