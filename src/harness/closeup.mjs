// Close-up diagnostics: clipped screenshots of one object in normal / thickness / AO debug views.
import fs from 'node:fs';
const OUT = './shots';
export default async ({ send, evaluate, sleep }) => {
  const J = (expr) => evaluate(`JSON.stringify(${expr})`).then((s) => (s === undefined ? null : JSON.parse(s)));
  const tag = process.env.TAG || 'obj';
  for (let i = 0; i < 40 && (await evaluate('__jelly.app.mode')) !== 'settled'; i++) await sleep(250);
  await sleep(600);
  const p = await J('__jelly.project(__jelly.physics.dice[1].cm)');
  const clip = { x: Math.max(0, p[0] - 190), y: Math.max(0, p[1] - 170), width: 380, height: 320, scale: 1 };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    fs.writeFileSync(`${OUT}/${tag}-${name}.png`, Buffer.from(r.result.data, 'base64'));
  };
  await shot('normal');
  await evaluate('__jelly.app.debugView = 1'); await sleep(300); await shot('thick');
  await evaluate('__jelly.app.debugView = 0'); await sleep(300);
  return { p, state: await J('__jelly.state().dice[1]') };
};
