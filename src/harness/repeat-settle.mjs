// Browser: drop each object type several times (switching via the dice in between) and record settle times.
export default async ({ evaluate, sleep }) => {
  const types = (process.env.TYPES || '1').split(',').map(Number), reps = +(process.env.REPS || 5);
  const settled = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await evaluate('__jelly.app.mode')) === 'settled') return +((Date.now() - t0) / 1000).toFixed(1); await sleep(200); } return -1; };
  const out = {};
  for (const t of types) {
    out[t] = [];
    for (let r = 0; r < reps; r++) {
      await evaluate('__jelly.setType(0)'); await sleep(250); await settled(9000);
      await evaluate(`__jelly.setType(${t})`); await sleep(250);
      out[t].push(await settled(12000));
      await evaluate('__jelly.roll()'); await sleep(250);
      out[t].push(await settled(12000));
    }
  }
  out.errors = JSON.parse(await evaluate('JSON.stringify(__jelly.state().gpuErrors)'));
  return out;
};
