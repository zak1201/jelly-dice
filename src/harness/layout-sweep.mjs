// Screen-space check: does any resting object overlap the control column or the heading?
import fs from 'node:fs';
const OUT = './shots';
export default async ({ send, evaluate, sleep }) => {
  const J = (e) => evaluate(`JSON.stringify(${e})`).then((s) => (s === undefined ? null : JSON.parse(s)));
  const res = [];
  for (const t of [9, 3, 5, 0]) {
    await evaluate(`__jelly.setType(${t})`); await sleep(300);
    for (let i = 0; i < 60 && (await evaluate('__jelly.app.mode')) !== 'settled'; i++) await sleep(200);
    await sleep(300);
    const r = await J(`(() => {
      const panel = document.getElementById('controls').getBoundingClientRect(), brand = document.querySelector('.brand').getBoundingClientRect();
      const P = __jelly.physics, out = [];
      for (let s = 0; s < P.count; s++) {
        // screen bbox of the object's lattice nodes (box lattice encloses the object)
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        const pr = __jelly.types[__jelly.slotType[s]].geo.proxy.u; // lattice coords of surface proxy points
        for (let i = 0; i < 125; i++) { const p = __jelly.project([P.x[(s * 125 + i) * 3], P.x[(s * 125 + i) * 3 + 1], P.x[(s * 125 + i) * 3 + 2]]); }
        const c = __jelly.project(P.dice[s].cm);
        out.push({ cx: Math.round(c[0]), cy: Math.round(c[1]) });
      }
      return { panelLeft: Math.round(panel.left), panelTop: Math.round(panel.top), brandRight: Math.round(brand.right), brandBottom: Math.round(brand.bottom), centers: out };
    })()`);
    res.push({ type: await evaluate('__jelly.state().type'), ...r });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/sweep-${process.env.VW || 'w'}-${t}.png`, Buffer.from(shot.result.data, 'base64'));
  }
  return res;
};
