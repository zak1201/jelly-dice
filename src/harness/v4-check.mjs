// Edge real-time check of the v4 page: every object type, typed input (zh/en), language toggle.
import fs from 'node:fs';
const OUT = process.env.SHOTS || './shots';
export default async ({ send, evaluate, sleep, click }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const J = (expr) => evaluate(`JSON.stringify(${expr})`).then((s) => (s === undefined ? null : JSON.parse(s)));
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  };
  const waitSettled = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await evaluate('__jelly.app.mode')) === 'settled') return (Date.now() - t0) / 1000; await sleep(250); }
    return -1;
  };
  const out = { types: [] };
  out.start = await J('({ lang: __jelly.app.lang, title: document.title, h1: document.getElementById("title").textContent })');
  out.diceSettle = await waitSettled(9000);
  out.dice = await J('__jelly.state()');
  await shot('00-dice');
  for (let t = 1; t < 10; t++) {
    const t0 = Date.now();
    await evaluate(`__jelly.setType(${t})`);
    for (let i = 0; i < 40 && (await evaluate(`__jelly.app.type`)) !== t; i++) await sleep(50);
    const switchMs = Date.now() - t0;
    const settle = await waitSettled(10000);
    const st = await J('__jelly.state()');
    out.types.push({ t, id: st.type, switchMs, settle, results: st.results, total: await evaluate('document.getElementById("totalNum").textContent'),
      h1: await evaluate('document.getElementById("title").textContent'), gpuErrors: st.gpuErrors, nan: st.nanResets, frameMs: st.frameMs, physMs: st.physMs });
    await shot(`${String(t).padStart(2, '0')}-${st.type}`);
  }
  // typed input: Chinese, English, unknown word
  await evaluate(`(() => { const i = document.getElementById('objInput'); i.value = '苹果'; document.getElementById('objForm').requestSubmit(); })()`);
  await sleep(600);
  out.typedZh = await evaluate('__jelly.state().type');
  await evaluate(`(() => { const i = document.getElementById('objInput'); i.value = '  Phone '; document.getElementById('objForm').requestSubmit(); })()`);
  await sleep(600);
  out.typedEn = await evaluate('__jelly.state().type');
  await evaluate(`(() => { const i = document.getElementById('objInput'); i.value = '独角兽'; document.getElementById('objForm').requestSubmit(); })()`);
  await sleep(200);
  out.unknownMsg = await evaluate('document.getElementById("objMsg").textContent');
  // language toggle by a real click
  const lb = await J("(r => [r.x + r.width / 2, r.y + r.height / 2])(document.getElementById('langBtn').getBoundingClientRect())");
  const before = await evaluate('__jelly.app.lang');
  await click(lb[0], lb[1]); await sleep(400);
  out.langToggle = { before, after: await evaluate('__jelly.app.lang'), htmlLang: await evaluate('document.documentElement.lang'),
    h1: await evaluate('document.getElementById("title").textContent'), roll: await evaluate('document.querySelector("#rollBtn .roll-text").textContent'),
    chips: await J('[...document.querySelectorAll("#objects .chip")].map((b) => b.textContent)') };
  await waitSettled(8000);
  await shot('20-lang-toggled');
  out.final = await J('__jelly.state()');
  return out;
};
