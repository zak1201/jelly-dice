// Mobile layout check: bottom sheet, chips row, framing; zh then en; one object switch.
import fs from 'node:fs';
const OUT = './shots';
export default async ({ send, evaluate, sleep }) => {
  const J = (e) => evaluate(`JSON.stringify(${e})`).then((s) => (s === undefined ? null : JSON.parse(s)));
  const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
  const settle = async () => { for (let i = 0; i < 40 && (await evaluate('__jelly.app.mode')) !== 'settled'; i++) await sleep(250); await sleep(500); };
  await settle(); await shot('m-dice-' + (await evaluate('__jelly.app.lang')));
  await evaluate('__jelly.setType(7)'); await sleep(300); await settle(); await shot('m-phone');
  const layout = await J(`(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const objs = __jelly.physics.dice.slice(0, __jelly.physics.count).map((D) => __jelly.project(D.cm).map(Math.round));
    return { vw: innerWidth, vh: innerHeight, brand: r('.brand'), controls: r('#controls'), topbar: r('.topbar'), hint: r('#hint'), objects: objs,
      overflowX: document.documentElement.scrollWidth > innerWidth, chipsScroll: document.getElementById('objects').scrollWidth };
  })()`);
  return layout;
};
