"use strict";

const WIDTH = 960;
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
    stun: 0, attack: null, guard: false, combo: 0, buffer: null, cancelFlash: 0 };
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
  updateFighter(one, two, bindings[0], held, pressed);
  const idle = new Set();
  updateFighter(two, one, bindings[1], training ? idle : held, training ? idle : pressed);
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
    ctx.font = `bold ${size}px system-ui`;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  function bar(x, y, width, height, fraction, color, reverse) {
    box(x, y, width, height, "#384455");
    box(reverse ? x + width * (1 - fraction) : x, y, width * fraction, height, color);
  }
  function drawFighter(player) {
    const { x, y, color, facing, attack, stun, guard, cancelFlash } = player;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    if (cancelFlash) {
      ctx.strokeStyle = "#f9efb1";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -46, 55 + (13 - cancelFlash) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    const suit = stun && !guard ? "#f2eee2" : color;
    box(-19, -77, 38, 46, suit);
    box(-13, -101, 28, 23, suit);
    box(2, -95, 14, 5, "#263442");
    box(-19, -30, 13, 27, suit);
    box(7, -30, 13, 27, suit);
    if (guard) {
      box(18, -83, 12, 49, "#e0eeff");
    } else if (active(attack)) {
      const height = attack.name === "launcher" ? 53 : 16;
      box(15, -64 - (height - 16), attack.move.range - 23, height, suit);
    } else {
      box(13, -64, 22, 13, suit);
    }
    ctx.restore();
  }
  function draw() {
    box(0, 0, WIDTH, 500, "#1b2936");
    for (let x = 25; x < WIDTH; x += 113) {
      box(x, 157, 6, 250, "#314252");
      box(x + 10, 177, 91, 169, "#223443");
    }
    box(0, 366, WIDTH, 4, "#516270");
    box(0, FLOOR, WIDTH, 93, "#26323d");
    box(0, FLOOR, WIDTH, 3, "#73818b");
    for (let x = 24; x < WIDTH; x += 78) box(x, 445, 40, 4, "#52606a");
    players.forEach((player, index) => {
      const right = index === 1;
      const x = right ? 590 : 40;
      label(right ? (training ? "DUMMY" : "PLAYER 2") : "PLAYER 1", right ? 920 : 40, 42, 17, player.color, right ? "right" : "left");
      bar(x, 51, 330, 19, player.health / MAX_HEALTH, player.color, right);
      bar(x, 77, 330, 6, player.meter / 100, "#f9d780", right);
      label(`METER ${player.meter}`, right ? 920 : 40, 104, 13, "#f9d780", right ? "right" : "left");
      if (player.combo > 1) label(`${player.combo} HIT COMBO`, right ? 920 : 40, 141, 23, player.color, right ? "right" : "left");
      drawFighter(player);
    });
    label(training ? "PRACTICE" : "LOCAL VERSUS", WIDTH / 2, 51, 17, "#eef0e8", "center");
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
