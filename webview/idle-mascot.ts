const minIntervalMs = 10_000;
const maxIntervalMs = 20_000;
const spriteSize = 48;

type Move = readonly [time: number, x: number, y: number, rotation?: number, easing?: string, scaleY?: number];
type Scene = {
  name: string;
  rotation: number;
  moves: readonly Move[];
  poses: readonly [time: number, tile: number][];
  flip?: boolean;
  easing?: string;
  grounded?: boolean;
};

const enum DailyPose {
  Yawn = 13,
  Drowsy,
  Nod,
  Curled,
  Stretched,
  PawUp,
  Lick,
  Scratch,
  HeadTilt,
  WaterBowl,
  Lap,
  TailUp,
  TailOut,
  BellyUp,
  OnSide,
}

// The original thirteen tiles cover the sill poses, steps, and eating.
const scenes: readonly (Scene | ((panel: DOMRect) => Scene))[] = [
  {
    name: 'play',
    rotation: 0,
    moves: [
      [0, 0, 34], [540, 0, 0], [1750, 0, 0], [2010, -10, -11], [2280, -20, 0],
      [2440, -20, 0], [2700, -30, -7], [2980, -39, 0], [3170, -39, 0],
      [3420, -41, 0], [3700, -41, 0], [3960, -51, -7], [4220, -61, 0],
      [4930, -61, 0], [5520, -61, 44], [5750, -61, 44],
    ],
    poses: [
      [0, 0], [1080, 1], [1250, 0], [1750, 3], [2280, 2], [2440, 3],
      [2980, 2], [3170, 4], [3700, 3], [4220, 2], [4380, 5],
    ],
  },
  {
    name: 'gaze',
    rotation: 0,
    moves: [[0, 0, 34], [580, 0, 0], [3150, 0, 0], [3770, 0, 34]],
    poses: [[0, 0], [1320, 1], [1490, 0], [2490, 1], [2650, 0]],
  },
  {
    name: 'top',
    rotation: 180,
    moves: [[0, 0, -34], [630, 0, 0], [2450, 0, 0], [3100, 0, -34]],
    poses: [[0, 0], [1330, 1], [1500, 0]],
  },
  {
    name: 'left',
    rotation: 90,
    moves: [[0, -34, 0], [630, 0, 0], [2450, 0, 0], [3100, -34, 0]],
    poses: [[0, 0], [1330, 1], [1500, 0]],
  },
  {
    name: 'expression',
    rotation: 0,
    moves: [[0, 0, 34], [550, 0, 0], [3150, 0, 0], [3790, 0, 34]],
    poses: [[0, 0], [1050, 6], [1940, 1], [2640, 0]],
  },
  ({ width }) => walk(width, true),
  ({ width }) => walk(width, false),
  {
    name: 'butterfly',
    rotation: 0,
    moves: [
      [0, 0, 48], [450, 0, 0], [1050, 0, 0], [1280, -10, -11], [1550, -22, 0],
      [1800, -22, 0], [2090, -34, -9], [2360, -44, 0], [2580, -44, 0],
      [2780, -54, 0], [3170, -54, 0], [3390, -53, 0], [3950, -53, 0], [4450, -53, 48],
    ],
    poses: [[0, 2], [1050, 3], [1550, 2], [1800, 3], [2360, 2], [2580, 4], [3390, 5]],
  },
  {
    name: 'eat',
    rotation: 0,
    moves: [[0, 0, 48], [520, 0, 0], [3690, 0, 0], [4220, 0, 48]],
    poses: [
      [0, 10], [920, 11], [1170, 10], [1390, 11], [1640, 10],
      [1860, 11], [2110, 10], [2350, 11], [2580, 10], [2820, 12],
    ],
  },
  pop,
  onSill('yawn', 3420, [
    [0, DailyPose.Drowsy], [950, DailyPose.Nod], [1190, DailyPose.Yawn],
    [2140, DailyPose.Nod], [2460, DailyPose.Drowsy],
  ], [
    [820, 0, 0], [1120, 0, 0, -3, 'ease-out', .97], [1520, 0, 0, 3, 'ease-in-out', 1.065],
    [1870, 0, 0, 4, 'ease-in-out', 1.035], [2230, 0, 0, -2], [2610, 0, 0],
  ]),
  onSill('doze', 4520, [
    [0, DailyPose.Drowsy], [920, DailyPose.Nod], [1550, DailyPose.Drowsy],
    [2130, DailyPose.Nod], [3080, DailyPose.Drowsy], [3390, DailyPose.Nod], [3910, DailyPose.HeadTilt],
  ], [
    [720, 0, 0], [1320, 0, 0, -5, 'ease-in-out', .96], [1680, 0, 0],
    [1930, 0, 0], [2680, 0, 0, -6, 'ease-in-out', .96], [3220, 0, 0],
    [3800, 0, 0, -6, 'ease-out', .96], [3980, 0, 0, 4], [4370, 0, 0],
  ]),
  {
    name: 'nap',
    rotation: 0,
    grounded: true,
    moves: [
      [0, 0, 48], [520, 0, 0], [1060, 0, 0], [1510, -3, 0],
      [2160, -3, 0, 0, 'ease-in-out', 1.065], [2830, -3, 0],
      [3490, -3, 0, 0, 'ease-in-out', 1.065], [4190, -3, 0],
      [4790, -3, 0, 0, 'ease-in-out', 1.05],
      [5160, -3, 0], [5750, -3, 48],
    ],
    poses: [[0, DailyPose.Drowsy], [980, DailyPose.Nod], [1330, DailyPose.Curled]],
  },
  onSill('stretch', 3590, [
    [0, DailyPose.HeadTilt], [1060, DailyPose.Stretched], [2600, DailyPose.HeadTilt],
  ], [
    [920, 0, 0], [1260, -2, 0], [2060, -6, 0], [2500, -5, 0], [2850, 0, 0],
  ]),
  onSill('groom', 3900, [
    [0, DailyPose.Nod], [910, DailyPose.PawUp], [1290, DailyPose.Lick], [1520, DailyPose.PawUp],
    [1780, DailyPose.Lick], [2010, DailyPose.PawUp], [2270, DailyPose.Lick],
    [2510, DailyPose.PawUp], [3020, DailyPose.Nod],
  ]),
  onSill('scratch', 3520, [
    [0, DailyPose.HeadTilt], [1020, DailyPose.Scratch], [1230, DailyPose.HeadTilt],
    [1420, DailyPose.Scratch], [1620, DailyPose.HeadTilt], [1810, DailyPose.Scratch],
    [2010, DailyPose.HeadTilt], [2200, DailyPose.Scratch], [2420, DailyPose.HeadTilt],
  ]),
  onSill('drink', 4180, [
    [0, DailyPose.WaterBowl], [990, DailyPose.Lap], [1310, DailyPose.WaterBowl],
    [1580, DailyPose.Lap], [1900, DailyPose.WaterBowl], [2170, DailyPose.Lap],
    [2490, DailyPose.WaterBowl], [2760, DailyPose.Lap], [3080, DailyPose.WaterBowl],
  ]),
  onSill('tilt', 3650, [
    [0, DailyPose.Drowsy], [980, DailyPose.HeadTilt], [2080, DailyPose.Drowsy],
    [2450, DailyPose.HeadTilt], [3090, DailyPose.Drowsy],
  ], [
    [820, 0, 0], [1280, 0, 0, 4], [1880, 0, 0, 2], [2180, 0, 0],
    [2680, 0, 0, 3], [3220, 0, 0],
  ]),
  onSill('wag', 3560, [
    [0, DailyPose.TailUp], [880, DailyPose.TailOut], [1110, DailyPose.TailUp],
    [1340, DailyPose.TailOut], [1570, DailyPose.TailUp], [1800, DailyPose.TailOut],
    [2030, DailyPose.TailUp], [2260, DailyPose.TailOut], [2500, DailyPose.TailUp],
  ]),
  {
    name: 'roll',
    rotation: 0,
    grounded: true,
    moves: [
      [0, 0, 48], [520, 0, 0], [1050, 0, 0], [1360, -4, 0, -4], [1790, -9, 0],
      [2140, -10, 0, -4], [2570, -9, 0, 1], [3130, -6, 0, 3],
      [3650, -3, 0], [4300, -3, 0], [4820, -3, 48],
    ],
    poses: [[0, DailyPose.OnSide], [1350, DailyPose.BellyUp], [3120, DailyPose.OnSide]],
  },
];

function onSill(name: string, leaveAt: number, poses: Scene['poses'], gestures: readonly Move[] = []): Scene {
  return {
    name,
    rotation: 0,
    grounded: true,
    moves: [[0, 0, spriteSize], [520, 0, 0], ...gestures, [leaveAt, 0, 0], [leaveAt + 500, 0, spriteSize]],
    poses,
  };
}

function walk(width: number, toRight: boolean): Scene {
  const left = -spriteSize;
  const right = width;
  const duration = Math.min(9000, Math.max(1800, (right - left) / (toRight ? .095 : .14)));
  const stride = toRight ? 112 : 80;
  const steps = [7, 8, 9, 8];
  const poses: [number, number][] = [];
  for (let time = 0; time < duration; time += stride) {
    poses.push([time, steps[poses.length % steps.length]]);
  }
  return {
    name: toRight ? 'walk-right' : 'walk-left',
    rotation: 0,
    flip: toRight,
    easing: 'linear',
    moves: [[0, toRight ? left : right, 0], [duration, toRight ? right : left, 0]],
    poses,
  };
}

function pop({ width, height }: DOMRect): Scene {
  const half = spriteSize / 2;
  const reach = spriteSize - 1;
  const edges = [
    { x: -spriteSize, y: height * .66 - half, dx: reach, dy: 0, rotation: 90 },
    { x: width, y: height * .44 - half, dx: -reach, dy: 0, rotation: -90 },
    { x: width * .48 - half, y: -spriteSize, dx: 0, dy: reach, rotation: 180 },
    { x: width * .64 - half, y: height, dx: 0, dy: -reach, rotation: 0 },
  ];
  const moves: Move[] = [];
  let time = 0;
  while (edges.length > 0) {
    const [{ x, y, dx, dy, rotation }] = edges.splice(Math.floor(Math.random() * edges.length), 1);
    moves.push(
      [time, x, y, rotation],
      [time + 150, x + dx, y + dy, rotation],
      [time + 300, x + dx, y + dy, rotation],
      // Stay outside until the next peek starts at another edge.
      [time + 430, x, y, rotation, 'steps(1, end)'],
    );
    time += 560;
  }
  const [, x, y, rotation] = moves.at(-1)!;
  moves.push([time, x, y, rotation]);
  return { name: 'pop', rotation: 0, moves, poses: [[0, 0]] };
}

function tilePosition(tile: number) {
  return `${(tile % 4) * 100 / 3}% ${Math.floor(tile / 4) * 100 / 6}%`;
}

export function createIdleMascot(parent: HTMLElement) {
  const mascot = document.createElement('div');
  mascot.className = 'idle-mascot';
  mascot.hidden = true;
  mascot.setAttribute('aria-hidden', 'true');
  const cat = document.createElement('div');
  cat.className = 'mascot-cat';
  const ball = document.createElement('div');
  ball.className = 'mascot-ball';
  ball.hidden = true;
  const butterfly = document.createElement('div');
  butterfly.className = 'mascot-butterfly';
  butterfly.hidden = true;
  const wings = document.createElement('div');
  wings.className = 'mascot-wings';
  butterfly.append(wings);
  mascot.append(ball, cat, butterfly);
  parent.append(mascot);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let available = false;
  let timer: number | undefined;
  let animations: Animation[] = [];

  function stop() {
    mascot.hidden = true;
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function play() {
    const choice = scenes[Math.floor(Math.random() * scenes.length)];
    mascot.hidden = false;
    const scene = typeof choice === 'function' ? choice(mascot.getBoundingClientRect()) : choice;
    mascot.dataset.scene = scene.name;
    const duration = scene.moves.at(-1)![0];
    const options: KeyframeAnimationOptions = { duration, fill: 'both' };
    const flip = scene.flip ? ' scaleX(-1)' : '';
    // The sprite box extends one pixel past the sill. Keep breathing and leaning anchored there.
    cat.style.transformOrigin = scene.grounded ? '50% calc(100% - 1px)' : '';
    const movement = cat.animate(scene.moves.map(([time, x, y, rotation = scene.rotation, easing = scene.easing ?? 'ease-in-out', scaleY = 1]) => ({
      offset: time / duration,
      transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scaleY(${scaleY})${flip}`,
      easing,
    })), options);
    const expressions = cat.animate([
      ...scene.poses.map(([time, tile]) => ({
        offset: time / duration, backgroundPosition: tilePosition(tile), easing: 'steps(1, end)',
      })),
      { offset: 1, backgroundPosition: tilePosition(scene.poses.at(-1)![1]) },
    ], options);
    animations = [movement, expressions];

    ball.hidden = scene.name !== 'play';
    if (!ball.hidden) animations.push(ball.animate([
      { offset: 0, opacity: 0 },
      { offset: 2350 / duration, opacity: 0 },
      { offset: 2440 / duration, opacity: 1, transform: 'translateX(0)' },
      { offset: 3270 / duration, opacity: 1, transform: 'translateX(0)', easing: 'ease-out' },
      { offset: 3760 / duration, opacity: 1, transform: 'translateX(-22px) rotate(-270deg)' },
      { offset: 4420 / duration, opacity: 1, transform: 'translateX(-22px) rotate(-270deg)' },
      { offset: 4520 / duration, opacity: 0 },
      { offset: 1, opacity: 0 },
    ], options));

    butterfly.hidden = scene.name !== 'butterfly';
    if (!butterfly.hidden) {
      const flight = [
        [0, 38, -23, 1], [450, -18, -36, 1], [920, -44, -23, 1],
        [1260, -51, -38, 1], [1660, -63, -28, 1], [2060, -77, -38, 1],
        [2350, -81, -24, 1], [2610, -75, -13, 1], [2810, -78, 1, 1],
        [3170, -78, 1, 1], [3440, -84, -19, 1], [3820, -110, -38, 1],
        [4140, -132, -55, 0], [4450, -132, -55, 0],
      ];
      animations.push(butterfly.animate(flight.map(([time, x, y, opacity]) => ({
        offset: time / duration,
        transform: `translate(${x}px, ${y}px)`,
        opacity,
        easing: 'ease-in-out',
      })), options));
      animations.push(wings.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(.42)' }, { transform: 'scaleX(1)' }], {
        duration: 180, iterations: Math.ceil(duration / 180),
      }));
    }

    movement.onfinish = () => {
      if (animations[0] === movement) stop();
    };
  }

  function canPlay() {
    return available && !document.hidden && !reducedMotion.matches &&
      !document.body.classList.contains('vscode-reduce-motion');
  }

  function schedule() {
    const interval = minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
    timer = window.setTimeout(() => {
      if (!canPlay()) return;
      stop();
      play();
      schedule();
    }, interval);
  }

  function restart() {
    window.clearTimeout(timer);
    stop();
    if (canPlay()) schedule();
  }

  document.addEventListener('visibilitychange', restart);
  reducedMotion.addEventListener('change', restart);
  return {
    restart,
    setAvailable(isAvailable: boolean) {
      if (available === isAvailable) return;
      available = isAvailable;
      restart();
    },
  };
}
