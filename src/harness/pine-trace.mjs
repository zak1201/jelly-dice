// Browser trace: switch to the pine cone several times and record per-second motion until settled.
export default async ({ evaluate, sleep }) => {
  const runs = [];
  for (let run = 0; run < 4; run++) {
    await evaluate(`__jelly.setType(${run % 2 === 0 ? 1 : 0})`); await sleep(300);
    if (run % 2 === 1) { for (let i = 0; i < 40 && (await evaluate('__jelly.app.mode')) !== 'settled'; i++) await sleep(250); continue; }
    const rows = [];
    let settledAt = -1;
    for (let t = 1; t <= 12; t++) {
      await sleep(1000);
      const s = JSON.parse(await evaluate(`JSON.stringify(__jelly.physics.dice.slice(0, __jelly.physics.count).map((D) => [+D.speed.toFixed(2), +D.spin.toFixed(2), +D.wobble.toFixed(2), D.asleep ? 1 : 0, D.contact, +D.calmT.toFixed(2)]))`));
      rows.push(`${t}s ${JSON.stringify(s)}`);
      if (settledAt < 0 && (await evaluate('__jelly.app.mode')) === 'settled') settledAt = t;
      if (settledAt > 0 && t >= settledAt + 1) break;
    }
    runs.push({ run, settledAt, rows });
  }
  return runs;
};
