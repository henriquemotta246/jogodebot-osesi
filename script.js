'use strict';
/* ==========================================================
   FUTEBOL DE BOTÃO 2D — Vanilla JS + Canvas
   Seções: constantes · áudio · menu · setup · física · regras
           · entrada (mouse/teclado/gamepad) · IA · desenho
   ========================================================== */

/* ---------- Constantes ---------- */
const W = 900, H = 560;                       // tamanho lógico do canvas
const FX = 50, FY = 40, FW = W - 2 * FX, FH = H - 2 * FY, CY = H / 2; // campo
const MOUTH = 150;                            // largura da boca do gol
const STEP = 1 / 240;                         // passo fixo da física
const MAXDRAG = 130, MAXV = 1250;             // arrasto máx. (px) e velocidade máx. do chute
const COLORS = ['#d63a2f', '#2f6fdd'];
const RK = 'botao_ranking_v1';
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');

let g = null;                                 // estado da partida
const keys = new Set();                       // teclas pressionadas
const menu = { mode: 'local', min: 5 };

/* Traves (círculos fixos) */
const posts = [FX, W - FX].flatMap(x => [CY - MOUTH / 2, CY + MOUTH / 2]
  .map(y => ({ type: 'post', team: -2, x, y, r: 5, m: 0, vx: 0, vy: 0 })));

/* ---------- Áudio (Web Audio API) ---------- */
let ac;
function tone(f, d, type = 'sine', v = .2) {
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = type; o.frequency.value = f;
    gn.gain.setValueAtTime(v, ac.currentTime);
    gn.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d);
    o.connect(gn).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) { /* áudio indisponível */ }
}
const sfx = {
  ball: n => tone(200 + n * 350, .08, 'triangle', .06 + n * .25),
  btn: n => tone(110, .06, 'square', .03 + n * .12),
  whistle: () => { tone(2200, .25, 'sine', .15); setTimeout(() => tone(2450, .4, 'sine', .15), 280); },
  goal: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .25, 'sawtooth', .12), i * 110))
};

/* ---------- Menu e telas ---------- */
function show(id) { $(id).classList.add('on'); }
function hide(id) { $(id).classList.remove('on'); }
function pick(attr, btn) {
  document.querySelectorAll('[' + attr + ']').forEach(b => b.classList.toggle('on', b === btn));
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  menu.mode = b.dataset.mode; pick('data-mode', b);
  $('n1').value = menu.mode === 'pc' ? 'Computador' : 'Jogador 2';
});
document.querySelectorAll('[data-min]').forEach(b => b.onclick = () => {
  menu.min = +b.dataset.min; pick('data-min', b);
});
$('start').onclick = startGame;
$('again').onclick = startGame;
$('back').onclick = toMenu;
$('tomenu').onclick = toMenu;
function toMenu() { g = null; hide('over'); hide('game'); show('menu'); renderRank($('rank1')); }

/* ---------- Ranking (localStorage) ---------- */
function loadRank() { try { return JSON.parse(localStorage.getItem(RK)) || []; } catch (e) { return []; } }
function saveRank(e) {
  const r = loadRank(); r.push(e);
  r.sort((a, b) => b.diff - a.diff || b.gols - a.gols);
  try { localStorage.setItem(RK, JSON.stringify(r.slice(0, 10))); } catch (err) { /* cheio/bloqueado */ }
}
function renderRank(el, n = 5) {
  const r = loadRank().slice(0, n); el.textContent = '';
  if (!r.length) { el.textContent = 'Nenhuma vitória registrada ainda.'; return; }
  const t = document.createElement('table');
  r.forEach((e, i) => { const tr = t.insertRow(); [i + 1 + 'º', e.win, e.score, e.date].forEach(v => tr.insertCell().textContent = v); });
  el.appendChild(t);
}
renderRank($('rank1'));

/* ---------- Criação de corpos e partida ---------- */
function mk(type, team, x, y, idx) {
  const b = { type, team, x, y, vx: 0, vy: 0, idx };
  if (type === 'ball') Object.assign(b, { r: 9, m: .4, k: .8 });
  else if (type === 'gk') Object.assign(b, { r: 0, w: 14, h: 64, m: 2.5, k: 2.2, hx: x }); // retângulo, só vertical
  else Object.assign(b, { r: 20, m: 1, k: 1.7 });
  return b;
}
const FORM = [[150, -135], [150, 135], [260, -60], [260, 60], [350, 0]]; // formação (dist. da linha de fundo, dy)
function setup() {
  g.bodies = [];
  for (const t of [0, 1]) {
    const s = t ? -1 : 1, bx = t ? W - FX : FX;
    g.bodies.push(mk('gk', t, bx + s * 26, CY, 0));
    FORM.forEach((f, i) => g.bodies.push(mk('btn', t, bx + s * f[0], CY + f[1], i + 1)));
  }
  g.ball = mk('ball', -1, W / 2, CY);
  g.bodies.push(g.ball);
  g.last = -1;
}
function startGame() {
  g = {
    mode: menu.mode, time: menu.min * 60, score: [0, 0], shots: [0, 0], poss: [0, 0],
    names: [$('n0').value.trim() || 'Casa', $('n1').value.trim() || 'Visitante'],
    turn: 0, streak: 0, state: 'aim', aim: { ang: 0, pow: 0, charge: false, dir: 1 },
    parts: [], pp: {}, aiT: 0, plan: null, msg: '', msgT: 0, acc: 0, gt: 0, conceded: 0,
    foul: false, out: false, touched: false, shooter: null, drag: false
  };
  setup(); selectDefault();
  $('n0h').textContent = g.names[0]; $('n1h').textContent = g.names[1];
  hide('menu'); hide('over'); show('game'); sfx.whistle();
}

/* ---------- Física ---------- */
function onHit(a, b, v) {
  const n = Math.min(1, v / 700);
  const ball = a.type === 'ball' ? a : b.type === 'ball' ? b : null;
  if (ball) {
    const o = ball === a ? b : a;
    if (o.team >= 0) { g.last = o.team; if (o === g.shooter) g.touched = true; }
    sfx.ball(n);
  } else sfx.btn(n);
  // falta: botão chutado bate em adversário antes de tocar na bola
  const s = g.shooter;
  if (g.state === 'moving' && s && !g.touched) {
    const other = a === s ? b : b === s ? a : null;
    if (other && other.team === 1 - s.team) g.foul = true;
  }
}
/* Resolve colisão; n aponta de a para b */
function resolve(a, b, nx, ny, ov) {
  const ia = a.m ? 1 / a.m : 0, ib = b.m ? 1 / b.m : 0, s = ia + ib;
  if (!s) return;
  a.x -= nx * ov * ia / s; a.y -= ny * ov * ia / s;
  b.x += nx * ov * ib / s; b.y += ny * ov * ib / s;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;
  const j = -(1 + .85) * rv / s;               // restituição 0.85, conserva momento
  a.vx -= j * ia * nx; a.vy -= j * ia * ny;
  b.vx += j * ib * nx; b.vy += j * ib * ny;
  onHit(a, b, -rv);
}
function collide(a, b) {
  if (a.type === 'gk' && b.type === 'gk') return;
  if (a.type === 'gk') [a, b] = [b, a];        // retângulo sempre como b
  if (b.type === 'gk') {                       // círculo x retângulo
    const px = Math.max(b.x - b.w / 2, Math.min(a.x, b.x + b.w / 2));
    const py = Math.max(b.y - b.h / 2, Math.min(a.y, b.y + b.h / 2));
    const dx = px - a.x, dy = py - a.y, d = Math.hypot(dx, dy);
    if (d >= a.r) return;
    if (d < 1e-6) resolve(a, b, b.x > a.x ? 1 : -1, 0, a.r);
    else resolve(a, b, dx / d, dy / d, a.r - d);
    return;
  }
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), rr = a.r + b.r;
  if (d >= rr || d < 1e-6) return;
  resolve(a, b, dx / d, dy / d, rr - d);       // círculo x círculo
}
function walls(b) {
  const r = b.r;
  if (b.type === 'gk') {                       // goleiro: só vertical, perto do gol
    b.vx = 0; b.x = b.hx;
    const L = MOUTH / 2 + 30 - b.h / 2;
    if (b.y < CY - L) { b.y = CY - L; b.vy = 0; }
    if (b.y > CY + L) { b.y = CY + L; b.vy = 0; }
    return;
  }
  const ball = b.type === 'ball', mouth = ball && Math.abs(b.y - CY) < MOUTH / 2;
  if (b.y < FY + r) { b.y = FY + r; b.vy = Math.abs(b.vy) * .8; }
  if (b.y > FY + FH - r) { b.y = FY + FH - r; b.vy = -Math.abs(b.vy) * .8; }
  if (!mouth) {                                // a bola passa só pela boca do gol
    if (b.x < FX + r) { b.x = FX + r; if (ball && b.vx < -30) g.out = true; b.vx = Math.abs(b.vx) * .8; }
    if (b.x > W - FX - r) { b.x = W - FX - r; if (ball && b.vx > 30) g.out = true; b.vx = -Math.abs(b.vx) * .8; }
  }
}
function step() {
  const bs = g.bodies;
  for (const b of bs) {
    b.x += b.vx * STEP; b.y += b.vy * STEP;
    const f = Math.exp(-b.k * STEP); b.vx *= f; b.vy *= f;   // atrito gradual
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAXV * 1.2) { b.vx *= MAXV * 1.2 / sp; b.vy *= MAXV * 1.2 / sp; }
    if (sp < 10) b.vx = b.vy = 0;
    walls(b);
  }
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) collide(bs[i], bs[j]);
    if (bs[i].type !== 'gk') for (const p of posts) collide(bs[i], p);
  }
  for (const b of bs) walls(b);
  const bl = g.ball;                           // gol: bola cruzou a linha dentro da boca
  if (Math.abs(bl.y - CY) < MOUTH / 2) {
    if (bl.x < FX - bl.r * .5) scored(1);
    else if (bl.x > W - FX + bl.r * .5) scored(0);
  }
}
const moving = () => g.bodies.some(b => b.vx * b.vx + b.vy * b.vy > 100);

/* ---------- Regras e turnos ---------- */
function shoot(p, ang, pow) {
  const v = pow * MAXV;
  p.vx = p.type === 'gk' ? 0 : Math.cos(ang) * v;
  p.vy = Math.sin(ang) * v;
  Object.assign(g, { shooter: p, touched: false, foul: false, out: false, state: 'moving', acc: 0 });
  g.shots[p.team]++;
  g.aim.charge = false; g.aim.pow = 0; g.drag = false;
  sfx.btn(.8);
}
function endTurn() {
  if (g.time <= 0) return finish();
  if (g.foul) { g.msg = 'Falta! Perdeu a vez.'; sfx.whistle(); }
  else if (g.out) g.msg = 'Bola pra fora! Perdeu a vez.';
  else g.msg = '';
  if (!g.foul && !g.out && g.touched && g.streak < 2) { g.streak++; if (g.msg === '') g.msg = 'Tocou na bola: joga de novo!'; }
  else { g.turn = 1 - g.turn; g.streak = 0; }
  g.msgT = 2.5; g.state = 'aim'; g.plan = null; g.aiT = 0;
  selectDefault();
}
function scored(t) {
  g.score[t]++; g.conceded = 1 - t; g.state = 'goal'; g.gt = 2.6; g.msg = '';
  g.ball.vx = g.ball.vy = 0;
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 380;
    g.parts.push({ x: W / 2, y: CY, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 200, a: 1 + Math.random(), c: ['#f2b632', COLORS[t], '#fff', '#4fd47c'][i % 4] });
  }
  sfx.goal();
}
function finish() {
  g.state = 'over'; sfx.whistle();
  const [a, b] = g.score, w = a === b ? -1 : a > b ? 0 : 1;
  $('res').textContent = w < 0 ? 'Empate!' : 'Vitória de ' + g.names[w] + '!';
  $('final').textContent = `${g.names[0]} ${a} x ${b} ${g.names[1]}`;
  const tp = (g.poss[0] + g.poss[1]) || 1;
  const rows = [['Gols', a, b], ['Chutes', g.shots[0], g.shots[1]],
    ['Posse', Math.round(g.poss[0] / tp * 100) + '%', Math.round(g.poss[1] / tp * 100) + '%']];
  const st = $('stats'); st.textContent = '';
  rows.forEach(r => { const tr = st.insertRow(); [r[1], r[0], r[2]].forEach(v => tr.insertCell().textContent = v); });
  if (w >= 0) saveRank({ win: g.names[w], score: `${g.names[0]} ${a}x${b} ${g.names[1]}`, diff: Math.abs(a - b), gols: Math.max(a, b), date: new Date().toLocaleDateString('pt-BR') });
  renderRank($('rank2'), 10);
  show('over');
}

/* ---------- Seleção e mira ---------- */
const teamPieces = t => g.bodies.filter(b => b.team === t);
function aimAtBall() {
  const s = g.sel, b = g.ball;
  g.aim.ang = Math.atan2(b.y - s.y, b.x - s.x); g.aim.pow = 0; g.aim.charge = false;
}
function selectDefault() {
  const b = g.ball;
  g.sel = teamPieces(g.turn).filter(p => p.type === 'btn')
    .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
  aimAtBall();
}
function cycle(d) {
  const l = teamPieces(g.turn); g.sel = l[(l.indexOf(g.sel) + d + l.length) % l.length]; aimAtBall();
}
const humanTurn = () => g && (g.mode === 'local' || g.turn === 0);
function startCharge() { g.aim.charge = true; g.aim.pow = 0; g.aim.dir = 1; }
function fire() { g.aim.charge = false; shoot(g.sel, g.aim.ang, Math.max(.08, g.aim.pow)); }

/* ---------- Entrada: mouse / toque (estilingue) ---------- */
function pt(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
function inside(b, p) {
  return b.type === 'gk' ? Math.abs(p.x - b.x) < b.w / 2 + 12 && Math.abs(p.y - b.y) < b.h / 2 + 8
    : Math.hypot(p.x - b.x, p.y - b.y) < b.r + 8;
}
cv.addEventListener('pointerdown', e => {
  if (!g || g.state !== 'aim' || !humanTurn()) return;
  const hit = teamPieces(g.turn).find(b => inside(b, pt(e)));
  if (!hit) return;
  g.sel = hit; g.drag = true; g.aim.pow = 0; cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!g || !g.drag) return;
  const p = pt(e), s = g.sel, dx = s.x - p.x, dy = s.y - p.y;   // dispara no sentido oposto ao arrasto
  g.aim.ang = Math.atan2(dy, dx); g.aim.pow = Math.min(1, Math.hypot(dx, dy) / MAXDRAG);
});
cv.addEventListener('pointerup', () => {
  if (!g || !g.drag) return;
  g.drag = false;
  if (g.aim.pow > .08) shoot(g.sel, g.aim.ang, g.aim.pow); else g.aim.pow = 0;
});

/* ---------- Entrada: teclado ---------- */
const KM = [
  { prev: ['KeyA'], next: ['KeyD'], up: ['KeyW'], dn: ['KeyS'], fire: ['Space'] },
  { prev: ['ArrowLeft'], next: ['ArrowRight'], up: ['ArrowUp'], dn: ['ArrowDown'], fire: ['Enter'] }
];
function kmap(t) {
  if (g.mode !== 'pc') return KM[t];           // contra o PC: P1 usa WASD e setas
  const m = {}; for (const k in KM[0]) m[k] = [...KM[0][k], ...KM[1][k]]; return m;
}
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && g && $('game').classList.contains('on')) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (!g || g.state !== 'aim' || !humanTurn()) return;
  const m = kmap(g.turn);
  if (m.prev.includes(e.code)) cycle(-1);
  if (m.next.includes(e.code)) cycle(1);
  if (m.fire.includes(e.code)) startCharge();
});
addEventListener('keyup', e => {
  keys.delete(e.code);
  if (g && g.state === 'aim' && humanTurn() && g.aim.charge && kmap(g.turn).fire.includes(e.code)) fire();
});

/* ---------- Entrada: controle humano por frame (teclado contínuo + gamepad) ---------- */
function control(dt) {
  const t = g.turn, a = g.aim;
  if (g.mode === 'pc' && t === 1) return ai(dt);
  const m = kmap(t), sg = Math.cos(a.ang) >= 0 ? -1 : 1;   // "cima" aponta mais para cima
  if (m.up.some(k => keys.has(k))) a.ang += sg * 2.2 * dt;
  if (m.dn.some(k => keys.has(k))) a.ang -= sg * 2.2 * dt;
  if (a.charge) {                                          // força vai e volta enquanto segura
    a.pow += a.dir * dt * 1.1;
    if (a.pow >= 1) { a.pow = 1; a.dir = -1; }
    if (a.pow <= 0) { a.pow = 0; a.dir = 1; }
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads[t] || pads[0];
  if (!pad) return;
  const bt = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
  if (Math.hypot(pad.axes[0], pad.axes[1]) > .45) a.ang = Math.atan2(pad.axes[1], pad.axes[0]);
  const L = bt(4) || bt(14), R = bt(5) || bt(15), A = bt(0);
  if (L && !g.pp.l) cycle(-1);
  if (R && !g.pp.r) cycle(1);
  if (A && !g.pp.a) startCharge();
  if (!A && g.pp.a && a.charge) fire();
  g.pp.l = L; g.pp.r = R; g.pp.a = A;
}

/* ---------- Inteligência artificial ---------- */
function planAI() {
  const t = g.turn, b = g.ball, gx = t ? FX : W - FX, own = t ? W - FX : FX;
  const gd = Math.atan2(CY - b.y, gx - b.x), ux = Math.cos(gd), uy = Math.sin(gd);
  const cx = b.x - ux * (20 + b.r), cy = b.y - uy * (20 + b.r);   // ponto de contato que empurra a bola ao gol
  let best = null;
  for (const p of g.bodies) {
    if (p.team !== t || p.type !== 'btn') continue;
    const behind = (b.x - p.x) * ux + (b.y - p.y) * uy > 0;       // está "atrás" da bola?
    const d = Math.hypot(cx - p.x, cy - p.y);
    const sc = d + (behind ? 0 : 250) + Math.random() * 40;
    if (!best || sc < best.sc) best = { p, sc, behind };
  }
  const gk = g.bodies.find(q => q.team === t && q.type === 'gk');
  if (Math.abs(b.x - own) < 230 && (!best.behind || Math.random() < .3)) {   // defender: alinhar goleiro
    const dy = b.y - gk.y;
    if (Math.abs(dy) > 12) return { p: gk, ang: dy > 0 ? Math.PI / 2 : -Math.PI / 2, pow: Math.min(1, Math.abs(dy) * 2.2 / MAXV + .02) };
  }
  const p = best.p, tx = best.behind ? cx : b.x, ty = best.behind ? cy : b.y;
  const d = Math.hypot(tx - p.x, ty - p.y);
  return {
    p, ang: Math.atan2(ty - p.y, tx - p.x) + (Math.random() - .5) * .07,
    pow: Math.max(.5, Math.min(1, (d * 1.7 + 350) / MAXV + (Math.random() - .5) * .1))
  };
}
function ai(dt) {
  g.aiT += dt;
  if (!g.plan) { g.plan = planAI(); g.sel = g.plan.p; g.aim.ang = g.plan.ang; g.aim.pow = 0; }
  if (g.aiT > .5) g.aim.pow = Math.min(g.plan.pow, (g.aiT - .5) * 2);   // mostra a "carga" da mira
  if (g.aiT > 1.1) { const p = g.plan; g.plan = null; g.aiT = 0; shoot(p.p, p.ang, p.pow); }
}

/* ---------- Loop principal ---------- */
function update(dt) {
  g.msgT = Math.max(0, g.msgT - dt);
  g.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.a -= dt * .4; });
  g.parts = g.parts.filter(p => p.a > 0);
  if (g.state === 'goal') {                    // comemoração e reinício (saída de bola do time que sofreu)
    g.gt -= dt;
    if (g.gt <= 0) {
      if (g.time <= 0) return finish();
      setup(); g.turn = g.conceded; g.streak = 0; g.state = 'aim'; g.plan = null; g.aiT = 0; selectDefault(); sfx.whistle();
    }
    return;
  }
  g.time = Math.max(0, g.time - dt);
  if (g.last >= 0) g.poss[g.last] += dt;
  if (g.state === 'moving') {
    g.acc += dt;
    while (g.acc >= STEP && g.state === 'moving') { step(); g.acc -= STEP; }
    if (g.state === 'moving' && !moving()) endTurn();
  } else if (g.state === 'aim') {
    if (g.time <= 0) return finish();
    control(dt);
  }
}
function hud() {
  const s = Math.ceil(g.time);
  $('clock').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  $('s0').textContent = g.score[0]; $('s1').textContent = g.score[1];
  const t = $('turn'); t.textContent = 'Vez: ' + g.names[g.turn]; t.style.color = COLORS[g.turn];
  $('sel').textContent = g.sel ? 'Selecionado: ' + (g.sel.type === 'gk' ? 'Goleiro' : 'Botão ' + g.sel.idx) : '';
  $('msg').textContent = g.msgT > 0 ? g.msg : '';
}
let lt = 0;
function loop(ts) {
  const dt = Math.min(.05, (ts - lt) / 1000 || 0); lt = ts;
  if (g) { if (g.state !== 'over') update(dt); if (g) { draw(); hud(); } }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- Desenho ---------- */
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#5a3920'; ctx.fillRect(0, 0, W, H);                       // moldura de madeira
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
  for (let y = 4; y < H; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + (y % 3)); ctx.stroke(); }
  for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#1f7a3d' : '#23863f'; ctx.fillRect(FX + i * FW / 10, FY, FW / 10, FH); }
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;               // linhas
  ctx.strokeRect(FX, FY, FW, FH);
  ctx.beginPath(); ctx.moveTo(W / 2, FY); ctx.lineTo(W / 2, FY + FH); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, CY, 60, 0, 7); ctx.stroke();
  ctx.strokeRect(FX, CY - 110, 90, 220); ctx.strokeRect(W - FX - 90, CY - 110, 90, 220);
  for (const x of [FX - 30, W - FX]) {                                         // gols com rede
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x, CY - MOUTH / 2, 30, MOUTH);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 30; k += 6) { ctx.beginPath(); ctx.moveTo(x + k, CY - MOUTH / 2); ctx.lineTo(x + k, CY + MOUTH / 2); ctx.stroke(); }
    for (let k = 0; k <= MOUTH; k += 10) { ctx.beginPath(); ctx.moveTo(x, CY - MOUTH / 2 + k); ctx.lineTo(x + 30, CY - MOUTH / 2 + k); ctx.stroke(); }
  }
  posts.forEach(p => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); });

  for (const b of g.bodies) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';                                          // sombra
    if (b.type === 'gk') ctx.fillRect(b.x - b.w / 2 + 3, b.y - b.h / 2 + 3, b.w, b.h);
    else { ctx.beginPath(); ctx.arc(b.x + 3, b.y + 4, b.r, 0, 7); ctx.fill(); }
  }
  for (const b of g.bodies) {
    if (b.type === 'ball') {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.stroke();
    } else if (b.type === 'gk') {
      ctx.fillStyle = COLORS[b.team]; ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    } else {
      const gr = ctx.createRadialGradient(b.x - 6, b.y - 6, 2, b.x, b.y, b.r);
      gr.addColorStop(0, '#fff8'); gr.addColorStop(.25, COLORS[b.team]); gr.addColorStop(1, COLORS[b.team]);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 6, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.idx, b.x, b.y + 1);
    }
  }

  if (g.state === 'aim' && g.sel) {                                            // seleção e seta de mira
    const s = g.sel, a = g.aim, pulse = 3 + Math.sin(performance.now() / 150) * 2;
    ctx.strokeStyle = '#f2b632'; ctx.lineWidth = 3;
    if (s.type === 'gk') ctx.strokeRect(s.x - s.w / 2 - pulse, s.y - s.h / 2 - pulse, s.w + 2 * pulse, s.h + 2 * pulse);
    else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r + pulse, 0, 7); ctx.stroke(); }
    let ang = a.ang; if (s.type === 'gk') ang = Math.sin(ang) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const len = 40 + a.pow * 130, ex = s.x + Math.cos(ang) * len, ey = s.y + Math.sin(ang) * len;
    ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(ang) * 260, s.y + Math.sin(ang) * 260); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = `hsl(${120 - a.pow * 120},90%,55%)`; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - .45) * 14, ey - Math.sin(ang - .45) * 14);
    ctx.lineTo(ex - Math.cos(ang + .45) * 14, ey - Math.sin(ang + .45) * 14); ctx.fill();
  }

  for (const p of g.parts) { ctx.globalAlpha = Math.min(1, p.a); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 7, 4); }
  ctx.globalAlpha = 1;
  if (g.state === 'goal') {                                                    // comemoração
    const sc = 1 + Math.sin(g.gt * 9) * .06;
    ctx.save(); ctx.translate(W / 2, CY); ctx.scale(sc, sc);
    ctx.font = '900 100px "Arial Black",Impact,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.strokeText('GOOOL!', 0, 0);
    ctx.fillStyle = '#f2b632'; ctx.fillText('GOOOL!', 0, 0); ctx.restore();
  }
}