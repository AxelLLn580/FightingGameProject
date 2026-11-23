"use strict";

const WIDTH = 960;
const HEIGHT = 501;
const FLOOR = 407;
const MAX_HEALTH = 300;
const CANCEL_COST = 50;
const GRAVITY = 0.62;
const moves = {
  light: { startup: 5, active: 4, total: 17, range: 80, damage: 14, stun: 19, rank: 1 },
  heavy: { startup: 9, active: 5, total: 28, range: 105, damage: 25, stun: 24, rank: 2 },
  launcher: { startup: 8, active: 5, total: 30, range: 96, damage: 20, stun: 37, rank: 3 },
};
const bindings = [
  { left: "KeyA", right: "KeyD", jump: "KeyW", guard: "KeyS", light: "KeyF", heavy: "KeyG", launcher: "KeyH", cancel: "KeyJ" },
  { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", guard: "ArrowDown", light: "KeyI", heavy: "KeyO", launcher: "KeyP", cancel: "BracketLeft" },
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const grounded = (fighter) => fighter.y === FLOOR;

function fighter(x, color, facing) {
  return { x, y: FLOOR, vy: 0, color, facing, health: MAX_HEALTH, meter: 50,
    stun: 0, attack: null, guard: false, combo: 0, buffer: null, cancelFlash: 0,
    idlePhase: 0, walkPhase: 0, walkBlend: 0, walkDirection: 1 };
}

function updateFighter(player, opponent, controls, held, pressed) {
  player.stun = Math.max(0, player.stun - 1);
  player.cancelFlash = Math.max(0, player.cancelFlash - 1);

  if (player.attack) {
    player.attack.age++;
    if (player.attack.age >= player.attack.move.total) player.attack = null;
  }
  if (!player.attack && grounded(player) && !player.stun && opponent.x !== player.x) {
    player.facing = Math.sign(opponent.x - player.x);
  }
  for (const name of Object.keys(moves)) {
    if (pressed.has(controls[name])) player.buffer = { name, frames: 9 };
  }
  if (player.buffer && --player.buffer.frames <= 0) player.buffer = null;
  if (player.stun) return;

  if (pressed.has(controls.cancel) && player.attack?.hit && player.meter >= CANCEL_COST) {
    player.meter -= CANCEL_COST;
    player.attack = null;
    player.cancelFlash = 13;
  }

  player.guard = grounded(player) && !player.attack && held.has(controls.guard);
  if (player.buffer && !player.guard) {
    const { name } = player.buffer;
    const move = moves[name];
    const chain = player.attack?.hit && (move.rank > player.attack.move.rank
      || (player.attack.name === "launcher" && name !== "launcher" && !grounded(player)));
    if ((!player.attack || chain) && (name !== "launcher" || grounded(player))) {
      player.attack = { name, move, age: 0, hit: false, spent: false };
      player.buffer = null;
    }
  }
  if (player.attack || player.guard) return;

  const direction = Number(held.has(controls.right)) - Number(held.has(controls.left));
  player.x += direction * (grounded(player) ? 4.8 : 3.5);
  if (grounded(player) && pressed.has(controls.jump)) player.vy = -12;
  return direction;
}

function active(attack) {
  return attack && attack.age >= attack.move.startup && attack.age < attack.move.startup + attack.move.active;
}

function contact(from, to) {
  const attack = from.attack;
  if (!active(attack) || attack.spent) return null;
  const distance = (to.x - from.x) * from.facing;
  if (distance < -12 || distance > attack.move.range || Math.abs(to.y - from.y) > 57) return null;
  attack.spent = true;
  return { from, to, attack, blocked: to.guard };
}

function resolveHit({ from, to, attack, blocked }) {
  const { move, name } = attack;
  if (blocked) {
    from.combo = 0;
    to.stun = 10;
    to.x += from.facing * 20;
    return;
  }

  attack.hit = true;
  from.combo++;
  from.meter = Math.min(100, from.meter + 9);
  to.meter = Math.min(100, to.meter + 5);
  to.health = Math.max(0, to.health - Math.ceil(move.damage * Math.max(0.35, 1 - (from.combo - 1) * 0.12)));
  to.attack = null;
  to.guard = false;
  to.stun = move.stun;
  to.x += from.facing * 11;
  if (name === "launcher") {
    to.vy = -13;
    from.vy = -12;
  } else if (!grounded(to)) {
    to.vy = Math.min(to.vy, -3);
  }
}

function step(players, held, pressed, training) {
  const [one, two] = players;
  const startingX = players.map((player) => player.x);
  const idle = new Set();
  const movement = [
    updateFighter(one, two, bindings[0], held, pressed),
    updateFighter(two, one, bindings[1], training ? idle : held, training ? idle : pressed),
  ];
  if (!two.stun) one.combo = 0;
  if (!one.stun) two.combo = 0;

  for (const player of players) {
    player.y = Math.min(FLOOR, player.y + player.vy);
    player.vy = grounded(player) ? 0 : player.vy + GRAVITY;
    player.x = clamp(player.x, 28, WIDTH - 28);
  }

  if (Math.abs(one.y - two.y) < 65 && Math.abs(one.x - two.x) < 46) {
    const [left, right] = one.x <= two.x ? [one, two] : [two, one];
    left.x = clamp((left.x + right.x) / 2 - 23, 28, WIDTH - 74);
    right.x = left.x + 46;
  }

  players.forEach((player, index) => {
    const travel = player.x - startingX[index];
    const walking = grounded(player) && travel * movement[index] > 0.25;
    player.idlePhase += 0.075;
    if (walking) {
      player.walkDirection = Math.sign(travel) * player.facing;
      player.walkPhase += Math.abs(travel) * 0.047;
    }
    player.walkBlend = clamp(player.walkBlend + (walking ? 0.2 : -0.2), 0, 1);
  });

  // Capture both contacts before applying stun so simultaneous strikes can trade.
  const hits = [contact(one, two), contact(two, one)];
  for (const hit of hits) {
    if (hit) resolveHit(hit);
  }
  for (const player of players) player.x = clamp(player.x, 28, WIDTH - 28);
  if (training && two.health === 0) two.health = MAX_HEALTH;
}

function boot() {
  const canvas = document.querySelector("#arena");
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
  const mode = document.querySelector("#mode");
  const held = new Set();
  const pressed = new Set();
  const keys = new Set(bindings.flatMap(Object.values));
  let training = true;
  let players;
  let accumulator = 0;
  let previous;

  function reset() {
    players = [fighter(405, "#70e2c4", 1), fighter(451, "#ffab67", -1)];
    held.clear();
    pressed.clear();
    accumulator = 0;
  }
  mode.addEventListener("click", () => {
    training = !training;
    mode.textContent = training ? "Switch to local versus" : "Switch to practice";
    reset();
  });
  document.querySelector("#reset").addEventListener("click", reset);
  window.addEventListener("keydown", (event) => {
    if (!keys.has(event.code)) return;
    event.preventDefault();
    if (!event.repeat) pressed.add(event.code);
    held.add(event.code);
  });
  window.addEventListener("keyup", (event) => held.delete(event.code));
  window.addEventListener("blur", () => {
    held.clear();
    pressed.clear();
  });

  function box(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  function label(value, x, y, size, color = "#eef0e8", align = "left") {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px monospace`;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  function bar(x, y, width, height, fraction, color, reverse) {
    box(x, y, width, height, "#384455");
    box(reverse ? x + width * (1 - fraction) : x, y, width * fraction, height, color);
  }
  const pixel = 3;
  const snap = (value) => Math.round(value / pixel) * pixel;

  function pixelPath(points, color, width = 6) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let index = 1; index < points.length; index++) {
      const [x, y] = points[index - 1];
      const [nextX, nextY] = points[index];
      const dx = nextX - x;
      const dy = nextY - y;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / pixel));
      for (let step = 0; step <= steps; step++) {
        ctx.rect(snap(x + dx * step / steps - width / 2), snap(y + dy * step / steps - width / 2), width, width);
      }
    }
    ctx.fill();
  }
  function drawFighter(player) {
    const { x, y, color, facing, attack, stun, guard, cancelFlash, idlePhase, walkPhase, walkBlend, walkDirection } = player;
    const airborne = !grounded(player);
    const moving = attack || guard || stun || airborne ? 0 : walkBlend;
    const breath = Math.sin(idlePhase);
    const stride = Math.sin(walkPhase);
    const hip = [0, -43 + breath * (1 - moving) - Math.abs(stride) * 4 * moving];
    const lean = stun ? -9 : attack ? 9 : 4 + 6 * moving * walkDirection;
    const shoulder = [lean, hip[1] - 31 + breath * 1.5 * (1 - moving)];
    const head = [shoulder[0] + 3, shoulder[1] - 16];

    ctx.save();
    ctx.translate(snap(x), snap(y));
    ctx.scale(facing, 1);
    if (cancelFlash) {
      const radius = snap(51 + (13 - cancelFlash) * 2);
      const center = -48;
      pixelPath([[0, center - radius], [radius, center], [0, center + radius], [-radius, center], [0, center - radius]], "#fff0bc", pixel);
    }
    for (const side of [-1, 1]) {
      const phase = walkPhase + (side === 1 ? Math.PI : 0);
      const swing = Math.sin(phase) * walkDirection * moving;
      const lift = Math.max(0, Math.cos(phase)) * 15 * moving;
      const foot = [side * 12 * (1 - moving) + swing * 24, -4 - lift - (airborne ? (side === 1 ? 13 : 6) : 0)];
      const knee = [foot[0] * 0.55 + 5 + lift * 0.3, (hip[1] + foot[1]) / 2 - lift * 0.18];
      ctx.globalAlpha = side === -1 ? 0.54 : 1;
      pixelPath([hip, knee, foot, [foot[0] + 7, foot[1]]], color);

      let elbow = [shoulder[0] + side * 8 - swing * 11, shoulder[1] + 16];
      let hand = [shoulder[0] + 12 + side * 7 - swing * 21, shoulder[1] + 6 + moving * 18 + breath * 1.5];
      if (guard) {
        elbow = [shoulder[0] + 10, shoulder[1] + 13];
        hand = [shoulder[0] + 23 + side * 3, shoulder[1] - 8 + side * 5];
      } else if (side === 1 && active(attack)) {
        const raised = attack.name === "launcher";
        elbow = [27, shoulder[1] + (raised ? -5 : 5)];
        hand = [Math.min(59, attack.move.range - 33), shoulder[1] + (raised ? -28 : 3)];
      }
      pixelPath([shoulder, elbow, hand], color);
    }
    ctx.globalAlpha = 1;
    pixelPath([hip, shoulder, head], color);
    const [headX, headY] = head.map(snap);
    box(headX - 9, headY - 12, 18, 24, color);
    box(headX - 12, headY - 9, 24, 18, color);
    box(headX - 6, headY - 6, 12, 12, "#11172b");
    box(headX + 3, headY - 3, 3, 3, color);
    ctx.restore();
  }
  function drawArena() {
    box(0, 0, WIDTH, HEIGHT, "#11172b");
    box(0, 126, WIDTH, 282, "#242d4d");
    box(0, 252, WIDTH, 156, "#31527a");

    for (let column = 0; column < 16; column++) {
      const x = column * 63;
      const roof = 306 - ((column * 3) % 7) * 12;
      box(x, roof, 51, 408 - roof, "#242d4d");
      for (let y = roof + 12; y < 348; y += 18) {
        box(x + 9 + ((column + y / 3) % 3) * 12, y, 6, 6, "#d99762");
      }
    }

    for (let x = 27; x < WIDTH; x += 180) {
      box(x, 174, 9, 234, "#11172b");
      box(x - 9, 174, 24, 6, "#7586a3");
      box(x - 9, 180, 12, 6, "#fff0bc");
    }
    box(0, 372, WIDTH, 6, "#7586a3");
    for (let x = 12; x < WIDTH; x += 42) box(x, 378, 6, 30, "#7586a3");
    box(0, 408, WIDTH, HEIGHT - 408, "#242d4d");
    box(0, 408, WIDTH, 6, "#d99762");
    box(0, 462, WIDTH, HEIGHT - 462, "#11172b");
    for (let x = 18; x < WIDTH; x += 48) {
      box(x, 438, 24, 6, "#7586a3");
      box(x + 12, 480, 24, 6, "#31527a");
    }
  }
  function draw() {
    drawArena();
    players.forEach(drawFighter);
    players.forEach((player, index) => {
      const right = index === 1;
      const x = right ? 590 : 40;
      label(right ? (training ? "DUMMY" : "PLAYER 2") : "PLAYER 1", right ? 920 : 40, 42, 21, player.color, right ? "right" : "left");
      bar(x, 51, 330, 19, player.health / MAX_HEALTH, player.color, right);
      bar(x, 77, 330, 6, player.meter / 100, "#f9d780", right);
      label(`METER ${player.meter}`, right ? 920 : 40, 108, 18, "#f9d780", right ? "right" : "left");
      if (player.combo > 1) label(`${player.combo} HIT COMBO`, right ? 920 : 40, 141, 23, player.color, right ? "right" : "left");
    });
    label(training ? "PRACTICE" : "LOCAL VERSUS", WIDTH / 2, 51, 21, "#fff0bc", "center");
    const defeated = players.filter((player) => player.health === 0);
    if (defeated.length) {
      box(245, 182, 470, 98, "#11151d");
      const result = defeated.length === 2 ? "DRAW" : defeated[0] === players[0] ? "PLAYER 2 WINS" : "PLAYER 1 WINS";
      label(result, WIDTH / 2, 226, 32, "#eef0e8", "center");
      label("Reset round to play again", WIDTH / 2, 254, 16, "#eef0e8", "center");
    }
  }
  function frame(time) {
    const interval = 1000 / 60;
    accumulator += Math.min(100, time - (previous ?? time));
    previous = time;
    while (accumulator >= interval) {
      if (players.every((player) => player.health > 0)) step(players, held, pressed, training);
      pressed.clear();
      accumulator -= interval;
    }
    draw();
    requestAnimationFrame(frame);
  }
  reset();
  requestAnimationFrame(frame);
}

if (typeof document !== "undefined") boot();
