import { icon } from '../icons.js';
import { esc, prefersReducedMotion } from '../dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 320;
const CY = 200;
const RING_R = 128;
const CORE_R = 72;
const CORNERS = [[112, 120], [528, 120], [528, 296], [112, 296]];
const DEFAULT_ATTACKERS = ['security', 'edge_cases', 'state', 'regression'];
const ATTACKER_NAME = { security: 'SECURITY', edge_cases: 'EDGE CASE', state: 'STATE', regression: 'REGRESSION' };
const ATTACKER_GLYPH = { security: 'security', edge_cases: 'edge_cases', state: 'state', regression: 'regression' };

const CLOSED_GLYPH = '<path d="M3 11 Q20 21 37 11"/><path d="M11 16 L9 20 M20 18 L20 22 M29 16 L31 20"/>';
const OPEN_GLYPH = '<path d="M2 12 Q20 -3 38 12 Q20 27 2 12 Z" class="eye__sclera"/><circle cx="20" cy="12" r="6" class="eye__iris"/><circle cx="20" cy="12" r="2.5" class="eye__pupil"/>';

const ringPos = (i, n) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [CX + RING_R * Math.cos(a), CY + RING_R * Math.sin(a)];
};

// Point on the core edge facing (x, y).
const coreEdge = (x, y) => {
  const dx = x - CX;
  const dy = y - CY;
  const len = Math.hypot(dx, dy) || 1;
  return [CX + (dx / len) * CORE_R, CY + (dy / len) * CORE_R];
};

const eyeState = (stage, mutant) => {
  if (!mutant) return stage === 'idle' ? 'dormant' : 'sealed';
  return mutant.status;
};

export function createScene2D(container) {
  container.dataset.testid = 'scene';
  container.classList.add('scene');
  container.innerHTML = `
    <svg class="scene__svg" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="">
      <circle class="scene__orbit" cx="${CX}" cy="${CY}" r="168"/>
      <circle class="scene__ring" cx="${CX}" cy="${CY}" r="${RING_R}"/>
      <circle class="scene__block-ring" cx="${CX}" cy="${CY}" r="150"/>
      <circle class="scene__core" cx="${CX}" cy="${CY}" r="${CORE_R}"/>
      <rect class="scene__bar" x="290" y="186" width="44" height="4" rx="2" opacity="0.3"/>
      <rect class="scene__bar" x="296" y="196" width="50" height="4" rx="2" opacity="0.24"/>
      <rect class="scene__bar" x="290" y="206" width="34" height="4" rx="2" opacity="0.24"/>
      <g class="scene__beams"></g>
      <g class="scene__eyes"></g>
      <g class="scene__attackers"></g>
      <g class="scene__blocked">
        <g transform="translate(${CX - 14} ${CY - 34})" class="scene__blocked-icon">${icon('ban', { size: 28 })}</g>
        <text class="scene__blocked-label" x="${CX}" y="${CY + 20}" text-anchor="middle">BLOCKED · STAGE 0</text>
      </g>
    </svg>`;

  const svg = container.querySelector('svg');
  const eyesLayer = svg.querySelector('.scene__eyes');
  const attackersLayer = svg.querySelector('.scene__attackers');
  const beamsLayer = svg.querySelector('.scene__beams');
  let eyeCount = 0;
  let eyeIdKey = '';
  let attackerKey = '';
  let lastSeq = null;
  let attackerIds = [];

  function buildEyes(n, mutants = []) {
    eyesLayer.textContent = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = ringPos(i, n);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'eye');
      g.setAttribute('data-testid', 'scene-eye');
      const mid = String(mutants[i]?.id ?? `M${i + 1}`);
      g.setAttribute('data-mutant-id', mid);
      g.setAttribute('data-state', 'dormant');
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      g.innerHTML = `
        <g transform="translate(-20 -12)">
          <g class="eye__lid">${CLOSED_GLYPH}</g>
          <g class="eye__open">${OPEN_GLYPH}</g>
        </g>
        <text class="eye__label" y="28" text-anchor="middle"></text>`;
      g.querySelector('.eye__label').textContent = mid;
      eyesLayer.appendChild(g);
    }
    eyeCount = n;
  }

  function buildAttackers(ids) {
    attackersLayer.textContent = '';
    ids.forEach((id, i) => {
      const [x, y] = CORNERS[i % CORNERS.length];
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'attacker');
      g.setAttribute('data-attacker-id', id);
      g.setAttribute('transform', `translate(${x} ${y})`);
      g.innerHTML = `
        <circle class="attacker__disc" r="15"/>
        <g class="attacker__icon" transform="translate(-7.5 -7.5)">${icon(ATTACKER_GLYPH[id] ?? 'info', { size: 15 })}</g>
        <text class="attacker__label" y="30" text-anchor="middle">${esc(ATTACKER_NAME[id] ?? String(id).toUpperCase())}</text>`;
      attackersLayer.appendChild(g);
    });
  }

  let liveBeam = null;
  let beamTimer = null;
  function clearBeam() {
    if (beamTimer) clearTimeout(beamTimer);
    beamTimer = null;
    if (liveBeam) liveBeam.remove();
    liveBeam = null;
  }

  function fireBeam(beam, mutants) {
    // Hidden view or backgrounded tab: CSS animations never finish, so skip.
    if (document.hidden || !container.getClientRects().length) return;
    clearBeam();
    const idx = attackerIds.indexOf(beam.attackerId);
    const from = idx === -1 ? [CX, CY] : CORNERS[idx % CORNERS.length];
    let to;
    const mIdx = beam.mutantId ? mutants.findIndex((m) => m.id === beam.mutantId) : -1;
    if (mIdx !== -1) to = ringPos(mIdx, eyeCount);
    else to = coreEdge(from[0], from[1]);
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', `beam beam--${beam.tone}`);
    line.setAttribute('x1', from[0].toFixed(1));
    line.setAttribute('y1', from[1].toFixed(1));
    line.setAttribute('x2', to[0].toFixed(1));
    line.setAttribute('y2', to[1].toFixed(1));
    line.style.setProperty('--beam-len', len.toFixed(1));
    const done = () => {
      if (liveBeam === line) clearBeam();
      else line.remove();
    };
    line.addEventListener('animationend', done);
    line.addEventListener('animationcancel', done);
    beamsLayer.appendChild(line);
    liveBeam = line;
    beamTimer = setTimeout(done, 600);
  }

  return {
    update(model) {
      const stage = model.stage;
      container.dataset.sceneStage = stage;
      container.classList.toggle('scene--dimmed', !!model.dimmed);
      svg.dataset.stage = stage;
      svg.setAttribute('aria-label', model.summary ?? '');

      const mutants = model.mutants ?? [];
      const n = Math.max(8, mutants.length);
      const idKey = mutants.map((m) => m.id).join('|');
      if (n !== eyeCount || idKey !== eyeIdKey) {
        eyeIdKey = idKey;
        buildEyes(n, mutants);
      }
      const eyes = eyesLayer.children;
      for (let i = 0; i < eyes.length; i++) {
        const m = mutants[i];
        const st = eyeState(stage, m);
        const el = eyes[i];
        if (el.getAttribute('data-state') !== st) el.setAttribute('data-state', st);
        const label = el.querySelector('.eye__label');
        const text = st === 'survived' ? `${el.getAttribute('data-mutant-id')} · survived` : el.getAttribute('data-mutant-id');
        if (label.textContent !== text) label.textContent = text;
      }

      const ids = model.attackers?.length ? model.attackers.map((a) => a.id) : DEFAULT_ATTACKERS;
      const key = ids.join('|');
      if (key !== attackerKey) {
        attackerKey = key;
        attackerIds = ids;
        buildAttackers(ids);
      }

      const beam = model.beam ?? null;
      const seq = beam?.seq ?? null;
      if (beam && seq !== lastSeq && !prefersReducedMotion() && stage !== 'blocked') fireBeam(beam, mutants);
      lastSeq = seq;
    },
  };
}
