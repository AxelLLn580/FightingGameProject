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
    stun: 0, attack: null, guard: false, combo: 0, buffer: null, cancelFlash: 0,
    idlePhase: 0, walkPhase: 0, walkBlend: 0, walkDirection: 1, impact: null };
}

function updateFighter(player, opponent, controls, held, pressed) {
  player.stun = Math.max(0, player.stun - 1);
  player.cancelFlash = Math.max(0, player.cancelFlash - 1);
  if (player.impact && --player.impact.frames === 0) player.impact = null;

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
  to.impact = { frames: 12, x: to.x - from.facing * 15, y: to.y - 58, direction: from.facing, name, blocked };
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
    ctx.font = `italic 800 ${size}px system-ui`;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  function bar(x, y, width, height, fraction, color, reverse) {
    box(x, y, width, height, "#384455");
    box(reverse ? x + width * (1 - fraction) : x, y, width * fraction, height, color);
  }
  function strokePath(points, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.stroke();
  }
  function inkPath(points, color, width) {
    strokePath(points, "#141b2b", width + 5);
    strokePath(points, color, width);
  }
  function polygon(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fill();
  }
  function drawFighter(player) {
    const { x, y, color, facing, attack, stun, guard, cancelFlash, idlePhase, walkPhase, walkBlend, walkDirection } = player;
    const airborne = !grounded(player);
    const moving = attack || guard || stun || airborne ? 0 : walkBlend;
    const breath = Math.sin(idlePhase);
    const stride = Math.sin(walkPhase);
    const anticipation = attack && attack.age < attack.move.startup ? attack.age / attack.move.startup : 0;
    const release = attack && attack.age >= attack.move.startup
      ? Math.max(0, 1 - (attack.age - attack.move.startup) / (attack.move.active + 7)) : 0;
    const hip = [0, -43 + breath * (1 - moving) - Math.abs(stride) * 4 * moving + anticipation * 8];
    const lean = stun && !guard ? -14 : 4 + 6 * moving * walkDirection - anticipation * 15 + release * 16;
    const shoulder = [lean, hip[1] - 31 + breath * 1.5 * (1 - moving)];
    const head = [shoulder[0] + 3, shoulder[1] - 16];

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (cancelFlash) {
      ctx.strokeStyle = "#f9efb1";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -46, 55 + (13 - cancelFlash) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (release > 0.45) {
      const reach = attack.name === "light" ? 56 : 76;
      const height = attack.name === "launcher" ? -41 : 2;
      ctx.globalAlpha = release * 0.55;
      polygon([[15, shoulder[1] + 14], [reach, shoulder[1] + height], [reach + 13, shoulder[1] + height - 12], [36, shoulder[1] - 5]], color);
      ctx.globalAlpha = 1;
    }
    const shadow = color === "#70e2c4" ? "#3a9388" : "#ba6445";
    for (const side of [-1, 1]) {
      const phase = walkPhase + (side === 1 ? Math.PI : 0);
      const swing = Math.sin(phase) * walkDirection * moving;
      const lift = Math.max(0, Math.cos(phase)) * 15 * moving;
      const foot = [side * 12 * (1 - moving) + swing * 24, -4 - lift - (airborne ? (side === 1 ? 13 : 6) : 0)];
      const knee = [foot[0] * 0.55 + 5 + lift * 0.3, (hip[1] + foot[1]) / 2 - lift * 0.18];
      const limb = side === -1 ? shadow : color;
      inkPath([hip, knee, foot, [foot[0] + 7, foot[1]]], limb, 7);

      let elbow = [shoulder[0] + side * 8 - swing * 11, shoulder[1] + 16];
      let hand = [shoulder[0] + 12 + side * 7 - swing * 21, shoulder[1] + 6 + moving * 18 + breath * 1.5];
      if (guard) {
        elbow = [shoulder[0] + 10, shoulder[1] + 13];
        hand = [shoulder[0] + 23 + side * 3, shoulder[1] - 8 + side * 5];
      } else if (side === 1 && attack) {
        const raised = attack.name === "launcher";
        elbow = [elbow[0] - 18 * anticipation + 26 * release, elbow[1] - 12 * release];
        hand = [hand[0] - 29 * anticipation + (attack.name === "light" ? 26 : 38) * release,
          hand[1] + 10 * anticipation - (raised ? 44 : 4) * release];
      }
      inkPath([shoulder, elbow, hand], limb, 7);
    }
    inkPath([hip, shoulder, head], color, 9);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#141b2b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(...head, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    polygon([[head[0] - 9, head[1] + 2], [head[0] + 9, head[1] + 5], [head[0] + 2, head[1] + 10], [head[0] - 6, head[1] + 8]], shadow);
    strokePath([[head[0] + 2, head[1] - 4], [head[0] + 8, head[1] - 2]], "#141b2b", 2.5);
    ctx.restore();
  }
  function drawImpact({ x, y, direction, name, frames, blocked }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(direction, 1);
    ctx.rotate(name === "launcher" ? -0.85 : -0.18);
    ctx.globalAlpha = frames / 12;
    const size = 17 + (12 - frames) * 3 + (name === "light" ? 0 : 9);
    const points = [[-1, 0], [-size, -size * 0.4], [-size * 0.18, -size * 0.18],
      [size * 0.6, -size], [size * 0.38, -size * 0.18], [size * 1.4, 0],
      [size * 0.28, size * 0.18], [size * 0.7, size * 0.85], [-size * 0.2, size * 0.24], [-size * 0.65, size * 0.55]];
    polygon(points, blocked ? "#55caff" : "#ff995e");
    ctx.scale(0.55, 0.55);
    polygon(points, "#fff7d5");
    ctx.restore();
  }
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
  sky.addColorStop(0, "#243754");
  sky.addColorStop(0.65, "#825e78");
  sky.addColorStop(1, "#ec9e7f");

  function draw() {
    box(0, 0, WIDTH, FLOOR, sky);
    for (let x = 0; x < WIDTH; x += 67) {
      const roof = 305 - (x % 9) * 9;
      box(x, roof, 55, FLOOR - roof, "#42435d");
      for (let y = roof + 12; y < 340; y += 18) box(x + 12, y, 19, 4, "#c78e80");
    }
    for (let x = -30; x < WIDTH; x += 180) {
      polygon([[x, 190], [x + 18, 190], [x + 112, FLOOR], [x + 96, FLOOR]], "#282b43");
      box(x, 185, 98, 10, "#353951");
      box(x + 54, 195, 29, 4, "#f4be96");
    }
    box(0, 371, WIDTH, 5, "#303048");
    box(0, FLOOR, WIDTH, 93, "#262d45");
    box(0, FLOOR, WIDTH, 4, "#e0a188");
    for (let x = -24; x < WIDTH; x += 78) {
      polygon([[x, 431], [x + 38, 431], [x + 54, 440], [x + 14, 440]], "#795d6a");
    }
    box(0, 458, WIDTH, 4, "#151d32");
    for (const player of players) {
      ctx.fillStyle = "#171c30";
      ctx.beginPath();
      ctx.ellipse(player.x, FLOOR + 4, 25, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    players.forEach(drawFighter);
    for (const player of players) {
      if (player.impact) drawImpact(player.impact);
    }
    players.forEach((player, index) => {
      const right = index === 1;
      const x = right ? 590 : 40;
      label(right ? (training ? "DUMMY" : "PLAYER 2") : "PLAYER 1", right ? 920 : 40, 42, 17, player.color, right ? "right" : "left");
      bar(x, 51, 330, 19, player.health / MAX_HEALTH, player.color, right);
      bar(x, 77, 330, 6, player.meter / 100, "#f9d780", right);
      label(`METER ${player.meter}`, right ? 920 : 40, 104, 13, "#f9d780", right ? "right" : "left");
      if (player.combo > 1) label(`${player.combo} HIT COMBO`, right ? 920 : 40, 141, 23, player.color, right ? "right" : "left");
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
