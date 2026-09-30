// Trusted-input checks (CDP Input.*): drag + poke a die and an object, Roll button, Space, sound; then reduced motion.
import fs from 'node:fs';
const OUT = './shots';
export default async ({ send, evaluate, mouse, click, key, sleep }) => {
  const J = (e) => evaluate(`JSON.stringify(${e})`).then((s) => (s === undefined ? null : JSON.parse(s)));
  const settled = async (ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await evaluate('__jelly.app.mode')) === 'settled') return (Date.now() - t0) / 1000; await sleep(200); } return -1; };
  const center = (sel) => J(`(r => [r.x + r.width / 2, r.y + r.height / 2])(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
  const out = {};
  const dragTest = async (label) => {
    await settled();
    // grab the top of object 1 and pull up-right for ~0.5 s
    const p = await J('__jelly.project([__jelly.physics.dice[1].cm[0], __jelly.physics.dice[1].cm[1] + 0.35, __jelly.physics.dice[1].cm[2]])');
    const hit = await J(`!!__jelly.pickDie(${p[0]}, ${p[1]})`);
    await mouse('mouseMoved', p[0], p[1]);
    await mouse('mousePressed', p[0], p[1], 1);
    for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', p[0] + k * 5, p[1] - k * 6, 1); await sleep(40); }
    await sleep(350);
    const during = await J('({ grabbed: !!__jelly.physics.grab, slot: __jelly.physics.grab && __jelly.physics.grab.slot, stretch: +__jelly.physics.dice[1].grabStretch.toFixed(2), y: +__jelly.physics.dice[1].cm[1].toFixed(2) })');
    await mouse('mouseReleased', p[0] + 60, p[1] - 72, 0);
    const released = await J('!__jelly.physics.grab');
    const settle = await settled();
    // quick tap = poke
    const q = await J('__jelly.project(__jelly.physics.dice[0].cm)');
    await mouse('mouseMoved', q[0], q[1]); await mouse('mousePressed', q[0], q[1], 1); await sleep(60); await mouse('mouseReleased', q[0], q[1], 0);
    await sleep(120);
    const poke = await J('({ wobble: +__jelly.physics.dice[0].wobble.toFixed(3), asleep: __jelly.physics.dice[0].asleep })');
    out[label] = { hitAtStart: hit, during, released, settleAfterRelease: settle, poke };
  };
  await dragTest('dice');
  await evaluate('__jelly.setType(6)'); await sleep(400);
  await dragTest('apple');
  // Toss button (real click) and Space key
  await settled();
  const n0 = await evaluate('__jelly.app.rollCount');
  const rb = await center('#rollBtn');
  await click(rb[0], rb[1]); await sleep(250);
  const afterClick = (await evaluate('__jelly.app.rollCount')) - n0;
  await settled();
  const cv = await center('#stage');
  await mouse('mouseMoved', cv[0], 40); // pointer over the page, no focus needed on the standalone page
  await key('Space', ' ', 32); await sleep(250);
  const afterSpace = (await evaluate('__jelly.app.rollCount')) - n0;
  out.rolls = { afterClick, afterSpace, settle: await settled(), results: await J('__jelly.state().results') };
  // Sound on via a real click (AudioContext must start from the gesture)
  const sb = await center('#soundBtn');
  await click(sb[0], sb[1]); await sleep(400);
  out.sound = await J('({ on: __jelly.sound.on, ctx: __jelly.sound.ctx && __jelly.sound.ctx.state, label: document.querySelector("#soundBtn .sound-text").textContent })');
  await click(sb[0], sb[1]); await sleep(200);
  out.soundOff = await J('({ on: __jelly.sound.on })');
  // Reduced motion: emulate, reload, check the opening objects start at rest (no drop)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload', {});
  await sleep(300);
  for (let i = 0; i < 60 && !(await evaluate('!!(window.__jelly && __jelly.app.ready)')); i++) await sleep(250);
  await sleep(150);
  out.reducedStart = await J('__jelly.physics.dice.slice(0, 3).map((D) => ({ y: +D.cm[1].toFixed(2), speed: +D.speed.toFixed(2) }))');
  out.reducedSettle = await settled(8000);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/reduced-motion.png`, Buffer.from(r.result.data, 'base64'));
  return out;
};
